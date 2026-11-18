import { createHash } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import ReservationRaw from '../../models/reservations/reservation.model';
import ContractRaw from '../../models/contracts/contract.model';
import InventoryItemRaw from '../../models/inventory-items/inventory-item.model';
import ItemSpecificationRaw from '../../models/inventory-items/item-specification.model';
import ItemMovementRaw from '../../models/inventory-items/item-movement.model';
import ManagedCellStockRaw from '../../models/inventory-items/managed-cell-stock.model';
import ManagedItemInstanceRaw from '../../models/inventory-items/managed-item-instance.model';
import WarehouseCellRaw from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackRaw from '../../models/warehouse-map/warehouse-rack.model';
import CellAllocationRaw from '../../models/warehouse-map/cell-allocation.model';
import AccessSessionRaw from '../../models/access/managed-access-session.model';
import AccessVisitRaw from '../../models/access/managed-access-visit.model';
import { assertManagedAccessSessionScope, ManagedAccessError } from '../access/managed-access.service';
import { nextManagedStockLedgerRevision } from './managed-cell-stock.domain';
import { readManagedFacilityStockState } from './managed-unified-inbound.service';
import { buildRelocationPlan, ManagedRelocationDomainError, normalizeRelocation, RelocationCandidate, relocationRequestHash, relocationReservationVolumeDeltas, validateRelocationLevels } from './managed-inventory-v3-relocation.domain';
import { FacilityServiceType } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ItemMovementType } from '../../types/item-movement.type';
import { ManagedAccessPurpose, ManagedAccessSessionStatus, ManagedAccessVisitPurpose } from '../../types/managed-access.type';
import { UserRole } from '../../types/user.type';

type Actor = { _id: Types.ObjectId; role: UserRole };
type Plain = Record<string, any>;
export class ManagedV3RelocationError extends Error { constructor(public readonly status: number, public readonly code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new ManagedV3RelocationError(status, code, message); };
const id = (value: any) => String(value?._id ?? value ?? '');
const same = (left: any, right: any) => id(left) === id(right);
const round = (value: number, places: 3 | 6) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const live = { deletedAt: { $exists: false } };
const Reservation: any = ReservationRaw, Contract: any = ContractRaw, InventoryItem: any = InventoryItemRaw, ItemSpecification: any = ItemSpecificationRaw;
const ItemMovement: any = ItemMovementRaw, ManagedCellStock: any = ManagedCellStockRaw, ManagedItemInstance: any = ManagedItemInstanceRaw;
const WarehouseCell: any = WarehouseCellRaw, WarehouseRack: any = WarehouseRackRaw, CellAllocation: any = CellAllocationRaw;
const AccessSession: any = AccessSessionRaw, AccessVisit: any = AccessVisitRaw;
const oid = (value: unknown, name: string): Types.ObjectId => { if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, 'INVALID_INPUT', `${name} không hợp lệ.`); return new Types.ObjectId(value as string); };
const requestKey = (value: unknown): string => { if (typeof value !== 'string' || !/^[\w.:/-]{8,128}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key hợp lệ.'); return value as string; };
export const RELOCATION_DESTINATION_MIN_REMAINING_DAYS = 7;
const RELOCATION_DESTINATION_MIN_REMAINING_MS = RELOCATION_DESTINATION_MIN_REMAINING_DAYS * 24 * 60 * 60 * 1000;
export function relocationDestinationHasRunway(endDate: unknown, now = new Date()) {
  const timestamp = endDate instanceof Date ? endDate.getTime() : Date.parse(String(endDate ?? ''));
  return Number.isFinite(timestamp) && timestamp - now.getTime() >= RELOCATION_DESTINATION_MIN_REMAINING_MS;
}
const ifMatch = (value: unknown) => { const found = typeof value === 'string' ? value.trim().match(/^(?:W\/)?"(0|[1-9]\d*)"$/) : null; const number = found ? Number(found[1]) : NaN; if (!Number.isSafeInteger(number)) fail(typeof value === 'undefined' ? 428 : 400, 'IF_MATCH_REQUIRED', 'Cần If-Match là revision hiện tại.'); return number; };
const canonical = (value: any): any => value?.toHexString ? value.toHexString() : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => !['_id', '__v', 'createdAt', 'updatedAt'].includes(key) && value[key] !== undefined).sort().map(key => [key, canonical(value[key])])) : value;
const stableHash = (value: any) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const transactionUnavailable = (error: any) => error?.code === 20 || error?.codeName === 'IllegalOperation' || /transactions? (?:are|is) not supported|transaction numbers are only allowed/i.test(String(error?.message ?? ''));
const unknownCommit = (error: any) => error?.hasErrorLabel?.('UnknownTransactionCommitResult') || error?.errorLabels?.includes?.('UnknownTransactionCommitResult');

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try { let result!: T; await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15_000 }); return result; }
  finally { await session.endSession(); }
}
function signedContract(contract: any) {
  const active = contract?.contentVersions?.find((row: any) => row.version === contract.currentContentVersion);
  return contract?.status === 'SIGNED' && !!active && contract.signatures?.some((row: any) => row.version === active.version && row.contentHash === active.contentHash && row.signerRole === 'CUSTOMER') &&
    contract.signatures?.some((row: any) => row.version === active.version && row.contentHash === active.contentHash && ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(row.signerRole));
}
async function ownedScope(skuId: unknown, actor: Actor, session?: ClientSession) {
  if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ khách hàng được chuyển hàng trong Reservation của mình.');
  let skuQuery: any = InventoryItem.findOne({ _id: oid(skuId, 'skuId'), customerId: actor._id, inventorySchemaVersion: 3, skuStatus: 'ACTIVE', ...live });
  if (session) skuQuery = skuQuery.session(session);
  const sku: any = await skuQuery.lean().exec(); if (!sku) fail(404, 'SKU_NOT_FOUND', 'Không tìm thấy mặt hàng.');
  const reservationId = sku.reservationId ?? sku.managedReservationId, now = new Date();
  let reservationQuery: any = Reservation.findOne({ _id: reservationId, customerId: actor._id, facilityId: sku.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
    bookingFlowVersion: 3, status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now }, handoverAt: { $exists: true, $ne: null }, handoverByStaffId: { $exists: true, $ne: null },
    $or: [{ activeClosureRequestId: null }, { activeClosureRequestId: { $exists: false } }] });
  if (session) reservationQuery = reservationQuery.session(session);
  const reservation: any = await reservationQuery.lean().exec(); if (!reservation) fail(409, 'RENTAL_NOT_ACTIVE', 'Reservation cần đang hoạt động, trong kỳ thuê và đã bàn giao.');
  let contractQuery: any = Contract.findOne({ reservationId: reservation._id, customerId: actor._id, status: 'SIGNED' }); if (session) contractQuery = contractQuery.session(session);
  const contract: any = await contractQuery.lean().exec(); if (!signedContract(contract)) fail(409, 'CONTRACT_NOT_SIGNED', 'Hợp đồng hiện hành chưa được hai bên ký đầy đủ.');
  return { sku, reservation };
}
async function ownedSkuForHistory(skuId: unknown, actor: Actor) {
  if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ chủ sở hữu mới được tra cứu phiếu chuyển.');
  const sku: any = await InventoryItem.findOne({ _id: oid(skuId, 'skuId'), customerId: actor._id, inventorySchemaVersion: 3, ...live }).lean().exec();
  if (!sku) fail(404, 'SKU_NOT_FOUND', 'Không tìm thấy mặt hàng.');
  return sku;
}
async function eligibleReservations(sku: Plain, actor: Actor, requestedIds: string[], session?: ClientSession) {
  const ids = [...new Set(requestedIds.length ? requestedIds : [id(sku.reservationId ?? sku.managedReservationId)])];
  if (!ids.length || ids.length > 100) fail(422, 'INVALID_RESERVATION_SCOPE', 'Số Reservation trong thao tác không hợp lệ.');
  let query: any = Reservation.find({ _id: { $in: ids.map(value => new Types.ObjectId(value)) }, customerId: actor._id,
    facilityId: sku.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3,
    status: ReservationStatus.ACTIVE, startDate: { $lte: new Date() }, endDate: { $gt: new Date() },
    handoverAt: { $exists: true, $ne: null }, handoverByStaffId: { $exists: true, $ne: null },
    $or: [{ activeClosureRequestId: null }, { activeClosureRequestId: { $exists: false } }] }).lean();
  if (session) query = query.session(session);
  const rows: Plain[] = await query.exec();
  if (rows.length !== ids.length) fail(409, 'RENTAL_NOT_ACTIVE', 'Cả hai Reservation phải thuộc Customer này, cùng Facility, còn hiệu lực và đã bàn giao.');
  for (const row of rows) {
    let contractQuery: any = Contract.findOne({ reservationId: row._id, customerId: actor._id, status: 'SIGNED' }).lean();
    if (session) contractQuery = contractQuery.session(session);
    if (!signedContract(await contractQuery.exec())) fail(409, 'CONTRACT_NOT_SIGNED', 'Cả hai Reservation phải có hợp đồng hiện hành đã ký.');
  }
  return rows;
}
async function allEligibleReservations(sku: Plain, actor: Actor): Promise<Plain[]> {
  const rows: Plain[] = await Reservation.find({ customerId: actor._id, facilityId: sku.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
    bookingFlowVersion: 3, status: ReservationStatus.ACTIVE, startDate: { $lte: new Date() }, endDate: { $gt: new Date() },
    handoverAt: { $exists: true, $ne: null }, handoverByStaffId: { $exists: true, $ne: null },
    $or: [{ activeClosureRequestId: null }, { activeClosureRequestId: { $exists: false } }] }).sort({ startDate: 1, _id: 1 }).limit(101).lean().exec();
  if (rows.length > 100) fail(503, 'RESERVATION_SCOPE_UNKNOWN', 'Có quá nhiều Reservation đang hoạt động để hiển thị phạm vi chuyển.');
  return rows.length ? eligibleReservations(sku, actor, rows.map(row => id(row._id))) : [];
}
async function stateFor(sku: Plain, reservation: Plain, session?: ClientSession, candidate?: RelocationCandidate, reservations: Plain[] = [reservation]): Promise<Plain> {
  const requestedIds = candidate
    ? [...new Set(candidate.lines.flatMap(line => line.itemInstanceId
      ? [...(line.destinationAllocations ?? []).map(row => row.cellId)]
      : [line.sourceCellId!, line.destinationCellId!]))]
    : reservations.flatMap(row => (row.allocatedCellIds ?? []).map(id));
  if (candidate) {
    const instanceIds = candidate.lines.filter(line => line.itemInstanceId).map(line => line.itemInstanceId!);
    if (instanceIds.length) {
      let query: any = ManagedItemInstance.find({ itemInstanceId: { $in: instanceIds }, skuId: sku._id, status: 'PLACED' }).select('allocations reservationId');
      if (session) query = query.session(session);
      const instances: any[] = await query.lean().exec();
      requestedIds.push(...instances.flatMap(instance => (instance.allocations ?? []).map((row: any) => id(row.cellId))));
    }
  }
  const cellIds = [...new Set(requestedIds.map(String))].map(value => new Types.ObjectId(String(value)));
  if (!cellIds.length || cellIds.length > 100) fail(409, 'CELL_ALLOCATION_INVALID', 'Reservation chưa có danh sách Cell hợp lệ để chuyển hàng.');
  try { const state: any = await readManagedFacilityStockState(sku.facilityId, session, { reservationId: reservation._id, reservationIds: reservations.map(row => row._id), cellIds, skuId: sku._id }); return { ...state, reservations }; }
  catch (error: any) { return fail(error?.status || 503, error?.code || 'STOCK_RECONCILIATION_UNKNOWN', error?.message || 'Tồn kho chưa thể đối soát an toàn.'); }
}
async function specificationsFor(sku: Plain, reservation: Plain, candidate: RelocationCandidate, session?: ClientSession) {
  const specIds = [...new Set(candidate.lines.map(line => line.itemSpecId))].map(value => new Types.ObjectId(value));
  let query: any = ItemSpecification.find({ _id: { $in: specIds }, skuId: sku._id, customerId: sku.customerId,
    facilityId: sku.facilityId, status: 'ACTIVE', ...live }).populate('quantityUnitId', 'name code');
  if (session) query = query.session(session);
  const rows: any[] = await query.lean().exec();
  if (rows.length !== specIds.length) fail(404, 'ITEM_SPECIFICATION_NOT_FOUND', 'Một hoặc nhiều loại hàng không thuộc SKU/Reservation này.');
  return rows.map(row => ({ ...row, quantityUnitName: row.quantityUnitId?.name ?? row.quantityUnitId?.code ?? 'đơn vị' }));
}
function planFor(sku: Plain, reservation: Plain, candidate: RelocationCandidate, state: Plain, specs: Plain[]) {
  return buildRelocationPlan({ sku, reservation, candidate, state, specifications: specs });
}
async function validateAllocations(plan: any, sku: Plain, reservation: Plain, reservations: Plain[] = [reservation], session?: ClientSession) {
  const cellIds = [...new Set([...plan.sourceCellIds, ...plan.destinationCellIds])].map(value => new Types.ObjectId(value));
  const reservationIds = reservations.map(row => row._id);
  const now = new Date();
  let query: any = CellAllocation.find({ reservationId: { $in: reservationIds }, customerId: sku.customerId, facilityId: sku.facilityId, cellId: { $in: cellIds },
    status: { $in: ['RESERVED', 'OCCUPIED'] }, startDate: { $lte: now }, endDate: { $gt: now } });
  if (session) query = query.session(session);
  const found: any[] = await query.lean().exec();
  const expectedPairs = new Set<string>(plan.source.map((row: any) => `${id(row.reservationId)}:${id(row.cellId)}`).concat(plan.destination.map((row: any) => `${id(row.reservationId)}:${id(row.cellId)}`)));
  const actualPairs = new Set<string>(found.map((row: any) => `${id(row.reservationId)}:${id(row.cellId)}`));
  if ([...expectedPairs].some(pair => !actualPairs.has(pair))) fail(409, 'CELL_NOT_ALLOCATED', 'Một ô nguồn hoặc đích không còn được cấp cho Reservation tương ứng.');
  return { cellIds, allocations: found };
}
async function readSession(candidate: RelocationCandidate, sku: Plain, reservation: Plain, reservations: Plain[], actor: Actor, cellIds: string[]) {
  const now = new Date();
  const access: any = await AccessSession.findOne({ _id: candidate.accessSessionId, customerId: actor._id, reservationId: reservation._id, facilityId: sku.facilityId,
    status: ManagedAccessSessionStatus.ACTIVE, allowedPurposes: ManagedAccessPurpose.RELOCATION, revision: candidate.sessionRevision,
    startedAt: { $lte: now }, expiresAt: { $gt: now } }).lean().exec();
  const allowed = new Set((access?.allowedCellIds ?? []).map(id));
  const sessionReservations = new Set((access?.scopedReservationIds ?? [access?.reservationId]).map(id));
  if (!access || reservations.some((row: any) => !sessionReservations.has(id(row._id))) || !cellIds.length || cellIds.some(value => !allowed.has(value))) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Cần phiên RELOCATION còn hiệu lực và bao phủ các Reservation cùng ô nguồn/đích.');
  const visit: any = await AccessVisit.findOne({ _id: access.visitId, reservationId: reservation._id, customerId: actor._id, facilityId: sku.facilityId,
    purpose: { $in: [ManagedAccessVisitPurpose.WAREHOUSE_VISIT, ManagedAccessPurpose.RELOCATION] }, status: 'CHECKED_IN' }).select('_id scopedReservationIds').lean().exec();
  const visitReservations = new Set((visit?.scopedReservationIds ?? [reservation._id]).map(id));
  if (!visit || reservations.some((row: any) => !visitReservations.has(id(row._id)))) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Lịch RELOCATION đã check-in không bao phủ đủ Reservation nguồn và đích.');
  return access;
}
function candidateReservationIds(candidate: RelocationCandidate, primaryId: string) {
  return [...new Set([primaryId, ...candidate.lines.flatMap((line: any) => [line.sourceReservationId, line.destinationReservationId,
    ...(line.destinationAllocations ?? []).map((row: any) => row.reservationId)].filter(Boolean))])];
}
export function validateRelocationDestinationRunway(candidate: RelocationCandidate, primaryId: string, reservations: Plain[], now = new Date()) {
  const byId = new Map(reservations.map(row => [id(row._id), row]));
  const destinations = [...new Set(candidate.lines.flatMap((line: any) => line.itemInstanceId
    ? (line.destinationAllocations ?? []).map((allocation: any) => id(allocation.reservationId ?? line.destinationReservationId ?? primaryId))
    : [id(line.destinationReservationId ?? primaryId)]))];
  for (const destinationId of destinations) {
    const destination = byId.get(destinationId);
    if (!destination || !relocationDestinationHasRunway(destination.endDate, now)) {
      fail(409, 'DESTINATION_RESERVATION_EXPIRING', `Reservation đích phải còn ít nhất ${RELOCATION_DESTINATION_MIN_REMAINING_DAYS} ngày thuê tại thời điểm chuyển.`);
    }
  }
}
async function lockedScope(skuId: unknown, candidate: RelocationCandidate, actor: Actor, session: ClientSession) {
  const { sku, reservation } = await ownedScope(skuId, actor, session);
  const reservations = await eligibleReservations(sku, actor, candidateReservationIds(candidate, id(reservation._id)), session);
  const state = await stateFor(sku, reservation, session, candidate, reservations), specifications = await specificationsFor(sku, reservation, candidate, session);
  const plan = planFor(sku, reservation, candidate, state, specifications);
  const allocationState = await validateAllocations(plan, sku, reservation, reservations, session);
  const rackIds = [...new Set([...plan.sourceCellIds, ...plan.destinationCellIds].map(cellId => id((state.cells as any[]).find(cell => id(cell._id) === cellId)?.rackId)))];
  const racks: any[] = await WarehouseRack.find({ _id: { $in: rackIds }, facilityId: sku.facilityId, deletedAt: { $exists: false } }).session(session).lean().exec();
  if (racks.length !== rackIds.length) fail(503, 'LEVEL_CAPACITY_UNKNOWN', 'Không thể xác minh Rack/Level của ô cần chuyển.');
  const levelCapacity = validateRelocationLevels(plan, state.cells, racks);
  return { sku, reservation, reservations, state, specifications, plan, racks, levelCapacity, allocations: allocationState.allocations };
}
function contextDto(scope: Plain) {
  const { sku, reservation, state, specifications, reservations = [reservation] } = scope, cellsById = new Map<string, any>(state.cells.map((cell: any) => [id(cell._id), cell]));
  const now = new Date(), destinationCutoff = now.getTime() + RELOCATION_DESTINATION_MIN_REMAINING_MS;
  const specs = specifications.map((spec: any) => {
    const lots = state.replay.lots.filter((row: any) => same(row.itemSpecId, spec._id));
    const instances = state.replay.instances.filter((row: any) => same(row.itemSpecId, spec._id) && row.status === 'PLACED');
    return { itemSpecId: spec._id, code: spec.code, name: spec.name, revision: spec.revision, quantityUnit: spec.quantityUnitName,
      availableQuantity: lots.reduce((sum: number, row: any) => sum + row.quantityAvailable, 0) + instances.length,
      receipts: lots.map((row: any) => ({ receiptId: row.receiptId, reservationId: row.reservationId, reservationCode: reservations.find((r: any) => same(r._id, row.reservationId))?.reservationCode ?? null, cellId: row.cellId, cellCode: cellsById.get(id(row.cellId))?.code ?? null,
        quantityOnHand: row.quantityOnHand, quantityHeld: row.quantityHeld, quantityAvailable: row.quantityAvailable,
        unitWeightKg: row.unitWeightKgSnapshot, unitVolumeM3: row.unitVolumeM3Snapshot })),
      instances: instances.map((row: any) => ({ itemInstanceId: row.itemInstanceId, reservationId: row.reservationId, reservationCode: reservations.find((r: any) => same(r._id, row.reservationId))?.reservationCode ?? null, receiptId: row.sourceReceiptId, quantity: 1,
        weightKg: row.unitWeightKgSnapshot, volumeM3: row.unitVolumeM3Snapshot,
        allocations: (row.allocations ?? []).map((allocation: any) => ({ cellId: allocation.cellId, cellCode: cellsById.get(id(allocation.cellId))?.code ?? null, weightKg: allocation.weightKg, volumeM3: allocation.volumeM3 })) })) };
  });
  const cells = reservations.flatMap((row: any) => (row.allocatedCellIds ?? []).map((cellId: any) => ({ reservation: row, cellId: id(cellId) })));
  return { sku: { id: sku._id, itemCode: sku.itemCode, name: sku.name, revision: sku.managedV3Revision ?? 0 },
    reservation: { id: reservation._id, reservationCode: reservation.reservationCode, facilityId: reservation.facilityId, status: reservation.status },
    minimumDestinationRemainingDays: RELOCATION_DESTINATION_MIN_REMAINING_DAYS,
    reservations: reservations.map((row: any) => ({ id: row._id, reservationCode: row.reservationCode, status: row.status, endDate: row.endDate,
      canReceiveRelocation: relocationDestinationHasRunway(row.endDate, now) })),
    cells: cells.map(({ reservation: owner, cellId }: any) => { const cell: any = cellsById.get(cellId); return cell && { id: cell._id, code: cell.code, reservationId: owner._id, reservationCode: owner.reservationCode,
      reservationEndDate: owner.endDate, canReceiveRelocation: relocationDestinationHasRunway(owner.endDate, now), destinationBlockedReason: owner.endDate && new Date(owner.endDate).getTime() < destinationCutoff ? 'RESERVATION_LESS_THAN_7_DAYS' : null, rackId: cell.rackId,
      levelNumber: cell.levelNumber, operationalStatus: cell.operationalStatus, maxWeightKg: cell.maxWeightKg, usedWeightKg: cell.usedWeightKg,
      maxVolumeM3: round(cell.dimensions.widthM * cell.dimensions.depthM * cell.dimensions.usableHeightM, 6), usedVolumeM3: cell.usedVolumeM3,
      managedInventoryRevision: cell.managedInventoryRevision }; }).filter(Boolean), itemSpecifications: specs,
    ledgerRevision: nextManagedStockLedgerRevision(state.movements, sku._id) - 1 };
}
function previewDto(scope: Plain, access: Plain) {
  const { sku, reservation, plan, state, candidate } = scope, cells = new Map<string, any>(state.cells.map((cell: any) => [id(cell._id), cell]));
  const affected = [...plan.cellDeltas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cellId, delta]: any) => {
    const cell: any = cells.get(cellId); return { cellId, cellCode: cell.code, weightDeltaKg: delta.weightKg, volumeDeltaM3: delta.volumeM3,
      usedWeightBeforeKg: cell.usedWeightKg, usedWeightAfterKg: delta.weightAfterKg, maxWeightKg: cell.maxWeightKg,
      usedVolumeBeforeM3: cell.usedVolumeM3, usedVolumeAfterM3: delta.volumeAfterM3, maxVolumeM3: delta.maxVolumeM3 };
  });
  return { status: 'READY', canConfirm: true, skuId: sku._id, reservationId: reservation._id,
    accessSession: { sessionId: access._id, purpose: ManagedAccessPurpose.RELOCATION, revision: access.revision, expiresAt: access.expiresAt },
    lines: plan.lines.map((line: Plain) => ({ ...line, source: plan.source.filter((row: any) => row.lineId === line.lineId).map((row: any) => ({ ...row, cellCode: cells.get(id(row.cellId))?.code ?? null })),
      destination: plan.destination.filter((row: any) => row.lineId === line.lineId).map((row: any) => ({ ...row, cellCode: cells.get(id(row.cellId))?.code ?? null })) })),
    totalQuantity: plan.quantity, totalWeightKg: plan.totalWeightKg, totalVolumeM3: plan.totalVolumeM3, capacity: affected,
    levelCapacity: scope.levelCapacity, skuRevision: sku.managedV3Revision ?? 0, ledgerRevision: nextManagedStockLedgerRevision(state.movements, sku._id) - 1,
    warnings: ['Bản xem trước chỉ đọc. Customer xác nhận hàng đã được chuyển thực tế trong phiên RELOCATION có Staff giám sát; hệ thống kiểm tra sức chứa số học, không thay thế kiểm tra bố trí và an toàn tại chỗ.'] };
}
async function findReplay(skuId: Types.ObjectId, actor: Actor, key: string, hash?: string) {
  const movement: any = await ItemMovement.findOne({ itemId: skuId, customerId: actor._id, idempotencyKey: key, schemaVersion: 4, 'stockEffect.action': 'MOVE' }).lean().exec();
  if (!movement) return null;
  if (hash && movement.stockEffect?.requestHash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã dùng cho nội dung khác.');
  return { status: 'COMMITTED', replayed: true, movement, movementId: movement._id, movementCode: movement.movementCode };
}
async function applyProjection(plan: any, scope: Plain, actor: Actor, session: ClientSession, movement: any) {
  const sourceLots = plan.source.filter((line: any) => !line.itemInstanceId), destinationLots = plan.destination.filter((line: any) => !line.itemInstanceId);
  const sourceGroups = groupEffects(sourceLots), destinationGroups = groupEffects(destinationLots);
  for (const [key, lines] of sourceGroups) {
    const line = lines[0], quantity = lines.reduce((sum: number, row: any) => sum + row.quantity, 0);
    const row: any = await ManagedCellStock.findOne({ skuId: scope.sku._id, itemSpecId: line.itemSpecId, reservationId: line.reservationId ?? scope.reservation._id,
      facilityId: scope.sku.facilityId, customerId: actor._id, cellId: line.cellId, receiptId: line.receiptId }).session(session).lean().exec();
    if (!row || row.quantityHeld !== 0 || row.quantityOnHand < quantity || lines.some((effect: any) => effect.unitWeightKgSnapshot !== row.unitWeightKgSnapshot || effect.unitVolumeM3Snapshot !== row.unitVolumeM3Snapshot)) fail(409, 'SOURCE_STOCK_CHANGED', 'Tồn nguồn hoặc lượng đang giữ đã thay đổi; hãy tải lại.');
    const after = row.quantityOnHand - quantity;
    if (after === 0) {
      const result = await ManagedCellStock.deleteOne({ _id: row._id, revision: row.revision, quantityOnHand: row.quantityOnHand, quantityHeld: 0 }).session(session).exec();
      if (result.deletedCount !== 1) fail(412, 'STALE_CELL_STOCK', 'Projection Cell Stock vừa thay đổi.');
    } else {
      const result = await ManagedCellStock.updateOne({ _id: row._id, revision: row.revision, quantityOnHand: row.quantityOnHand, quantityHeld: row.quantityHeld },
        { $set: { quantityOnHand: after, quantityAvailable: after, totalWeightKg: round(row.unitWeightKgSnapshot * after, 3), totalVolumeM3: round(row.unitVolumeM3Snapshot * after, 6), ledgerRevision: movement.stockEffect.ledgerRevision }, $inc: { revision: 1 } },
        { session, runValidators: true }).exec();
      if (result.matchedCount !== 1) fail(412, 'STALE_CELL_STOCK', 'Projection Cell Stock vừa thay đổi.');
    }
  }
  for (const [, lines] of destinationGroups) {
    const line = lines[0], quantity = lines.reduce((sum: number, row: any) => sum + row.quantity, 0);
    const destinationReservationId = line.reservationId ?? scope.reservation._id;
    const row: any = await ManagedCellStock.findOne({ skuId: scope.sku._id, itemSpecId: line.itemSpecId, reservationId: destinationReservationId,
      facilityId: scope.sku.facilityId, customerId: actor._id, cellId: line.cellId, receiptId: line.receiptId }).session(session).lean().exec();
    if (row && (row.unitWeightKgSnapshot !== line.unitWeightKgSnapshot || row.unitVolumeM3Snapshot !== line.unitVolumeM3Snapshot || row.quantityHeld !== 0)) fail(409, 'DESTINATION_RECEIPT_CONFLICT', 'Receipt tại ô đích có số đo khác hoặc đang được giữ.');
    if (row) {
      const next = row.quantityOnHand + quantity; if (!Number.isSafeInteger(next)) fail(422, 'RELOCATION_TOTAL_INVALID', 'Số lượng sau chuyển vượt giới hạn an toàn.');
      const result = await ManagedCellStock.updateOne({ _id: row._id, revision: row.revision, quantityOnHand: row.quantityOnHand },
        { $set: { quantityOnHand: next, quantityAvailable: next, totalWeightKg: round(row.unitWeightKgSnapshot * next, 3), totalVolumeM3: round(row.unitVolumeM3Snapshot * next, 6), ledgerRevision: movement.stockEffect.ledgerRevision }, $inc: { revision: 1 } },
        { session, runValidators: true }).exec();
      if (result.matchedCount !== 1) fail(412, 'STALE_CELL_STOCK', 'Projection Cell Stock đích vừa thay đổi.');
    } else {
      await ManagedCellStock.create([{ skuId: scope.sku._id, itemSpecId: line.itemSpecId, reservationId: destinationReservationId, facilityId: scope.sku.facilityId,
        customerId: actor._id, cellId: line.cellId, receiptId: line.receiptId, quantityUnitSnapshot: line.quantityUnitSnapshot, quantityOnHand: quantity, quantityHeld: 0,
        quantityAvailable: quantity, unitWeightKgSnapshot: line.unitWeightKgSnapshot, unitVolumeM3Snapshot: line.unitVolumeM3Snapshot,
        unitDimensionsSnapshot: line.unitDimensionsSnapshot, totalWeightKg: round(line.unitWeightKgSnapshot * quantity, 3), totalVolumeM3: round(line.unitVolumeM3Snapshot * quantity, 6),
        ledgerRevision: movement.stockEffect.ledgerRevision, revision: 0 }], { session });
    }
  }
  const instanceIds = [...new Set(plan.source.filter((row: any) => row.itemInstanceId).map((row: any) => row.itemInstanceId))].sort();
  for (const instanceId of instanceIds) {
    const instance: any = scope.state.instances.find((row: any) => row.itemInstanceId === instanceId && row.status === 'PLACED');
    const nextAllocations = plan.destination.filter((row: any) => row.itemInstanceId === instanceId).map((row: any) => ({ cellId: row.cellId, weightKg: row.allocatedWeightKg, volumeM3: row.allocatedVolumeM3 }));
    if (!instance || !nextAllocations.length) fail(409, 'ITEM_INSTANCE_SOURCE_MISMATCH', 'Không thể đối soát toàn bộ món nguyên vẹn.');
    const destinationReservationIds = [...new Set(plan.destination.filter((row: any) => row.itemInstanceId === instanceId).map((row: any) => id(row.reservationId ?? scope.reservation._id)))];
    if (destinationReservationIds.length !== 1) fail(409, 'INVALID_RESERVATION_SCOPE', 'Một món nguyên vẹn phải được gắn với đúng một Reservation đích.');
    const result = await ManagedItemInstance.updateOne({ itemInstanceId: instanceId, skuId: scope.sku._id, itemSpecId: instance.itemSpecId,
      reservationId: instance.reservationId, customerId: actor._id, facilityId: scope.sku.facilityId, status: 'PLACED', revision: instance.revision },
    { $set: { reservationId: new Types.ObjectId(String(destinationReservationIds[0]!)), allocations: nextAllocations }, $inc: { revision: 1 } }, { session, runValidators: true }).exec();
    if (result.matchedCount !== 1) fail(412, 'STALE_ITEM_INSTANCE', 'Món nguyên vẹn vừa thay đổi.');
  }
}
function groupEffects(rows: any[]) {
  const grouped = new Map<string, any[]>();
  for (const row of rows) { const key = `${id(row.reservationId)}:${id(row.itemSpecId)}:${row.receiptId}:${id(row.cellId)}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
  return grouped;
}

export class ManagedInventoryV3RelocationService {
  static async context(skuId: unknown, actor: Actor) {
    const { sku, reservation } = await ownedScope(skuId, actor), reservations = await allEligibleReservations(sku, actor);
    if (!reservations.some(row => same(row._id, reservation._id))) reservations.unshift(reservation);
    const state = await stateFor(sku, reservation, undefined, undefined, reservations);
    const specifications: any[] = await ItemSpecification.find({ skuId: sku._id, customerId: actor._id, facilityId: sku.facilityId, status: 'ACTIVE', ...live })
      .populate('quantityUnitId', 'name code').sort({ createdAt: 1, _id: 1 }).lean().exec();
    return contextDto({ sku, reservation, reservations, state, specifications: specifications.map(spec => ({ ...spec, quantityUnitName: spec.quantityUnitId?.name ?? spec.quantityUnitId?.code ?? 'đơn vị' })) });
  }
  static async preview(skuId: unknown, input: unknown, actor: Actor) {
    const candidate = normalizeRelocation(input), { sku, reservation } = await ownedScope(skuId, actor);
    const reservations = await eligibleReservations(sku, actor, candidateReservationIds(candidate, id(reservation._id)));
    validateRelocationDestinationRunway(candidate, id(reservation._id), reservations);
    const state = await stateFor(sku, reservation, undefined, candidate, reservations), specifications = await specificationsFor(sku, reservation, candidate);
    const plan = planFor(sku, reservation, candidate, state, specifications); await validateAllocations(plan, sku, reservation, reservations);
    const rackIds = [...new Set([...plan.sourceCellIds, ...plan.destinationCellIds].map(cellId => id(state.cells.find((cell: any) => id(cell._id) === cellId)?.rackId)))];
    const racks = await WarehouseRack.find({ _id: { $in: rackIds }, facilityId: sku.facilityId, deletedAt: { $exists: false } }).lean().exec();
    if (racks.length !== rackIds.length) fail(503, 'LEVEL_CAPACITY_UNKNOWN', 'Không thể xác minh Rack/Level của ô cần chuyển.');
    const levelCapacity = validateRelocationLevels(plan, state.cells, racks);
    const access = await readSession(candidate, sku, reservation, reservations, actor, [...new Set([...plan.sourceCellIds, ...plan.destinationCellIds])]);
    return previewDto({ sku, reservation, reservations, state, plan, candidate, levelCapacity }, access);
  }
  static async confirm(skuId: unknown, input: unknown, keyInput: unknown, etag: unknown, actor: Actor) {
    const candidate = normalizeRelocation(input), skuIdObject = oid(skuId, 'skuId'), key = requestKey(keyInput), payloadHash = relocationRequestHash(candidate);
    const ownerSku = await ownedSkuForHistory(skuIdObject, actor); const replay = await findReplay(ownerSku._id, actor, key, payloadHash); if (replay) return replay;
    if (ifMatch(etag) !== candidate.skuRevision) fail(412, 'STALE_SKU_REVISION', 'If-Match và tồn kho trong phiếu không cùng phiên bản.');
    if (candidate.customerAttestation !== 'CONFIRMED') fail(422, 'CUSTOMER_ATTESTATION_REQUIRED', 'Hãy xác nhận rằng bạn đã thực hiện thao tác chuyển hàng tại kho.');
    try {
      return await withTransaction(async session => {
        const scope = await lockedScope(skuIdObject, candidate, actor, session), allCellIds = [...new Set([...scope.plan.sourceCellIds, ...scope.plan.destinationCellIds])].map(value => new Types.ObjectId(value));
        validateRelocationDestinationRunway(candidate, id(scope.reservation._id), scope.reservations);
        try { await assertManagedAccessSessionScope({ sessionId: candidate.accessSessionId, customerId: actor._id, reservationId: scope.reservation._id,
          reservationIds: scope.reservations.map((row: any) => row._id), facilityId: scope.sku.facilityId, purpose: ManagedAccessPurpose.RELOCATION, cellIds: allCellIds, expectedRevision: candidate.sessionRevision, dbSession: session }); }
        catch (error: any) { if (error instanceof ManagedAccessError) fail(error.status, error.code, error.message); throw error; }
        const skuFence = await InventoryItem.updateOne({ _id: scope.sku._id, customerId: actor._id, inventorySchemaVersion: 3, skuStatus: 'ACTIVE',
          managedV3Revision: candidate.skuRevision, ...live }, { $inc: { managedV3Revision: 1 } }, { session }).exec();
        if (skuFence.matchedCount !== 1) fail(412, 'STALE_SKU_REVISION', 'SKU vừa thay đổi. Hãy tải lại.');
        for (const spec of [...scope.specifications].sort((a: any, b: any) => id(a._id).localeCompare(id(b._id)))) {
          const expected = candidate.lines.find(line => line.itemSpecId === id(spec._id))!.itemSpecRevision;
          const fenced = await ItemSpecification.updateOne({ _id: spec._id, skuId: scope.sku._id, customerId: actor._id, revision: expected, inboundRevision: spec.inboundRevision ?? 0, status: 'ACTIVE', ...live },
            { $inc: { inboundRevision: 1 } }, { session }).exec();
          if (fenced.matchedCount !== 1) fail(412, 'ITEM_SPECIFICATION_STALE', 'Item Specification vừa thay đổi.');
        }
        const cellById = new Map<string, any>(scope.state.cells.map((cell: any) => [id(cell._id), cell]));
        const cellsToWrite = [...scope.plan.cellDeltas.entries()].map(([cellId, delta]: any) => ({ cellId, delta, cell: cellById.get(cellId) })).sort((a, b) => a.cellId.localeCompare(b.cellId));
        const rackIds = [...new Set(cellsToWrite.map(row => id(row.cell?.rackId)))].sort();
        // Match the shared inbound/outbound lock order (Cell, then Rack) to reduce write conflicts.
        for (const row of cellsToWrite) {
          const cell: any = row.cell; if (!cell) fail(503, 'CELL_CAPACITY_UNKNOWN', 'Cell trong phiếu không còn tồn tại.');
          const rawNextWeight = round(cell.usedWeightKg + row.delta.weightKg, 3), rawNextVolume = round(cell.usedVolumeM3 + row.delta.volumeM3, 6);
          if (!Number.isFinite(rawNextWeight) || !Number.isFinite(rawNextVolume) || rawNextWeight < -0.001 || rawNextVolume < -0.000001) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Counter Cell ${cell.code} không khớp.`);
          const nextWeight = Math.max(0, rawNextWeight), nextVolume = Math.max(0, rawNextVolume);
          const update = await WarehouseCell.updateOne({ _id: cell._id, facilityId: scope.sku.facilityId, operationalStatus: 'AVAILABLE', allocationVersion: cell.allocationVersion,
            managedInventoryRevision: cell.managedInventoryRevision, usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3, maxWeightKg: cell.maxWeightKg,
            'dimensions.widthM': cell.dimensions.widthM, 'dimensions.depthM': cell.dimensions.depthM, 'dimensions.usableHeightM': cell.dimensions.usableHeightM },
          { $set: { usedWeightKg: nextWeight, usedVolumeM3: nextVolume }, $inc: { managedInventoryRevision: 1 } }, { session }).exec();
          if (update.matchedCount !== 1) fail(412, 'STALE_CELL_CAPACITY', `Sức chứa Cell ${cell.code} vừa thay đổi.`);
        }
        for (const rackId of rackIds) {
          const rack = scope.racks.find((row: any) => id(row._id) === rackId);
          if (!rack) fail(503, 'LEVEL_CAPACITY_UNKNOWN', 'Rack/Level vừa thay đổi.');
          const lock = await WarehouseRack.updateOne({ _id: rack._id, facilityId: scope.sku.facilityId, operationalStatus: 'AVAILABLE', deletedAt: { $exists: false },
            managedInventoryRevision: rack.managedInventoryRevision, layoutVersion: rack.layoutVersion, maxWeightKgPerLevel: rack.maxWeightKgPerLevel },
          { $inc: { managedInventoryRevision: 1 } }, { session }).exec();
          if (lock.matchedCount !== 1) fail(412, 'STALE_RACK_CAPACITY', 'Sức chứa Rack vừa thay đổi.');
        }
        const reservationDeltas = relocationReservationVolumeDeltas(scope.plan.source, scope.plan.destination, scope.reservation._id);
        const reservationById = new Map(scope.reservations.map((row: any) => [id(row._id), row]));
        for (const [reservationId, delta] of [...reservationDeltas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const owner: any = reservationById.get(reservationId); if (!owner) fail(409, 'INVALID_RESERVATION_SCOPE', 'Reservation nguồn/đích chưa được xác minh.');
          const nextUsed = round(Number(owner.usedCapacityM3) + delta, 6);
          if (!Number.isFinite(nextUsed) || nextUsed < -0.000001 || nextUsed > Number(owner.allocatedCapacity) + 0.000001) fail(409, 'RESERVATION_CAPACITY_EXCEEDED', 'Dung lượng Reservation đích không đủ hoặc counter nguồn không khớp.');
          const reservationFence = await Reservation.updateOne({ _id: owner._id, customerId: actor._id, facilityId: scope.sku.facilityId, status: ReservationStatus.ACTIVE,
            startDate: { $lte: new Date() }, endDate: { $gt: new Date() }, handoverAt: { $exists: true, $ne: null }, handoverByStaffId: { $exists: true, $ne: null },
            inventoryVersion: owner.inventoryVersion ?? 0, usedCapacityM3: owner.usedCapacityM3 }, { $set: { usedCapacityM3: Math.max(0, nextUsed) }, $inc: { inventoryVersion: 1 } }, { session }).exec();
          if (reservationFence.matchedCount !== 1) fail(412, 'STALE_RESERVATION_CAPACITY', 'Reservation hoặc dung lượng vừa thay đổi.');
        }
        const revision = nextManagedStockLedgerRevision(scope.state.movements, scope.sku._id);
        const operationId = `MI-MOVE:${scope.sku._id}:${createHash('sha256').update(key).digest('hex')}`;
        const movementId = new Types.ObjectId(), first = scope.plan.source[0], unitTypes = new Set(scope.plan.source.map((row: any) => row.quantityUnitSnapshot));
        const movement = new ItemMovement({ _id: movementId, movementCode: `MI-${movementId.toString()}`, referenceCode: operationId, operationId,
          itemId: scope.sku._id, managedReservationId: new Types.ObjectId(id(scope.plan.source[0].reservationId ?? scope.reservation._id)), facilityId: scope.sku.facilityId, customerId: actor._id,
          type: ItemMovementType.RELOCATION, quantity: scope.plan.quantity, quantityUnit: unitTypes.size === 1 ? first.quantityUnitSnapshot : 'MIXED',
          actualUnitWeightKg: round(scope.plan.totalWeightKg / scope.plan.quantity, 3), actualTotalWeightKg: scope.plan.totalWeightKg,
          actualUnitDimensionsM: first.unitDimensionsSnapshot, actualTotalVolumeM3: scope.plan.totalVolumeM3, performedBy: actor._id, performedAt: new Date(),
          relocationNote: [candidate.reason, candidate.notes].filter(Boolean).join(' · ') || 'Customer chuyển vị trí trong Reservation', physicalPackingConfirmed: true,
          idempotencyKey: key, schemaVersion: 4, itemSpecId: first.itemSpecId, stockEffect: { action: 'MOVE', operationId, requestHash: payloadHash,
            ledgerRevision: revision, contractVersion: 2, accessSessionId: new Types.ObjectId(candidate.accessSessionId), reason: candidate.reason,
            notes: candidate.notes, customerAttestation: { customerId: actor._id, attestedAt: new Date(), statement: 'Customer xác nhận đã thực hiện chuyển hàng trong phiên RELOCATION có Staff giám sát.' },
            source: scope.plan.source, destination: scope.plan.destination } });
        await movement.save({ session });
        await applyProjection(scope.plan, scope, actor, session, movement);
        const destinationCellIds = new Set(scope.plan.destinationCellIds);
        const reservedDestinations = scope.allocations.filter((allocation: any) => scope.plan.destination.some((line: any) => id(line.reservationId ?? scope.reservation._id) === id(allocation.reservationId) && id(line.cellId) === id(allocation.cellId)) && allocation.status === 'RESERVED');
        for (const allocation of reservedDestinations) {
          const activated = await CellAllocation.updateOne({ _id: allocation._id, reservationId: allocation.reservationId, customerId: actor._id, facilityId: scope.sku.facilityId, status: 'RESERVED' },
            { $set: { status: 'OCCUPIED' } }, { session }).exec();
          if (activated.matchedCount !== 1) fail(412, 'CELL_ALLOCATION_CHANGED', 'Một ô đích vừa thay đổi trạng thái phân bổ.');
        }
        const verified = await stateFor(scope.sku, scope.reservation, session, candidate);
        if (!verified.movements.some((row: any) => same(row._id, movement._id)) || !verified.replay) fail(503, 'MOVE_RECONCILIATION_UNKNOWN', 'Không thể xác minh lại stock sau khi ghi Movement.');
        return { status: 'COMMITTED', replayed: false, movementId, movementCode: movement.movementCode, movement,
          quantity: scope.plan.quantity, totalWeightKg: scope.plan.totalWeightKg, totalVolumeM3: scope.plan.totalVolumeM3,
          lineCount: scope.plan.lines.length, reservationUsageChanged: [...reservationDeltas.values()].some(value => value !== 0), reservationDeltas: Object.fromEntries(reservationDeltas) };
      });
    } catch (error: any) {
      if (error instanceof ManagedV3RelocationError || error instanceof ManagedRelocationDomainError || error instanceof ManagedAccessError) throw error;
      if (error?.code === 11000) { const recovered = await findReplay(skuIdObject, actor, key, payloadHash).catch(() => null); if (recovered) return recovered; fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng. Hãy đối soát trước khi thử lại.'); }
      if (unknownCommit(error)) { const recovered = await findReplay(skuIdObject, actor, key, payloadHash).catch(() => null); if (recovered) return recovered; fail(503, 'OUTCOME_UNKNOWN', 'Chưa xác định được kết quả commit. Hãy đối soát bằng cùng Idempotency-Key, không tạo yêu cầu mới.'); }
      if (transactionUnavailable(error)) fail(503, 'TRANSACTIONS_UNAVAILABLE', 'MongoDB hiện tại không hỗ trợ transaction; phiếu chuyển chưa được ghi.');
      throw error;
    }
  }
  static async operation(skuId: unknown, keyInput: unknown, actor: Actor) {
    const sku = await ownedSkuForHistory(skuId, actor), key = requestKey(keyInput), result = await findReplay(sku._id, actor, key);
    if (!result) fail(404, 'RELOCATION_OPERATION_NOT_FOUND', 'Chưa tìm thấy phiếu chuyển đã xác nhận.'); return result;
  }
}
