import { createHash } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import Item from '../../models/inventory-items/inventory-item.model';
import ItemSpec from '../../models/inventory-items/item-specification.model';
import QuantityUnit from '../../models/inventory-items/managed-inventory-quantity-unit.model';
import CellStock from '../../models/inventory-items/managed-cell-stock.model';
import ItemInstance from '../../models/inventory-items/managed-item-instance.model';
import InventoryStockBalance from '../../models/inventory-items/inventory-stock-balance.model';
import ManagedV3StockProjection from '../../models/inventory-items/managed-v3-stock-projection.model';
import ManagedV3BatchPlacement from '../../models/inventory-items/managed-v3-batch-placement.model';
import ManagedV3PhysicalUnit from '../../models/inventory-items/managed-v3-physical-unit.model';
import ManagedV3Footprint from '../../models/inventory-items/managed-v3-footprint.model';
import Movement from '../../models/inventory-items/item-movement.model';
import Cell from '../../models/warehouse-map/warehouse-cell.model';
import Rack from '../../models/warehouse-map/warehouse-rack.model';
import Allocation from '../../models/warehouse-map/cell-allocation.model';
import Reservation from '../../models/reservations/reservation.model';
import Contract from '../../models/contracts/contract.model';
import AccessSession from '../../models/access/managed-access-session.model';
import { assertManagedAccessSessionScope, ManagedAccessError } from '../access/managed-access.service';
import { aggregateCellStock, placementsHaveCellAllocations, replayManagedStockMovementsBySku } from './managed-cell-stock.domain';
import { assertUnifiedInboundCapacity, classifyLegacyStockImpact, measurementSnapshot, normalizeUnifiedInbound } from './managed-unified-inbound.domain';
import { FacilityServiceType } from '../../types/facility.type';
import { ManagedAccessPurpose, ManagedAccessSessionStatus } from '../../types/managed-access.type';
import { ReservationStatus } from '../../types/reservation.type';
import { UserRole } from '../../types/user.type';

const r: any = { Item, ItemSpec, QuantityUnit, CellStock, ItemInstance, InventoryStockBalance, ManagedV3StockProjection, ManagedV3BatchPlacement, ManagedV3PhysicalUnit, ManagedV3Footprint, Movement, Cell, Rack, Allocation, Reservation, AccessSession, Contract };
export async function createInTransactionOrdered(model: any, documents: any[], session: mongoose.ClientSession) {
  return model.create(documents, { session, ordered: true });
}
type Actor = { _id: Types.ObjectId; role: UserRole };
export class ManagedUnifiedInboundError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
const fail = (status: number, code: string, message: string, details?: unknown): never => { throw new ManagedUnifiedInboundError(status, code, message, details); };
const round = (n: number, p: number) => Math.round((n + Number.EPSILON) * 10 ** p) / 10 ** p;
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Types.ObjectId)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const id = (value: unknown, field: string) => { if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(422, 'INVALID_INPUT', `${field} không hợp lệ.`); return new Types.ObjectId(value as string); };
const eq = (a: any, b: any) => String(a?._id ?? a) === String(b?._id ?? b);
const normalized = (value: any): any => value instanceof Types.ObjectId ? value.toHexString() : Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
const matchShape = (left: any[], right: any[], keys: string[]) => {
  const key = (row: any) => keys.map(k => String(k.split('.').reduce((v, p) => v?.[p], row) ?? '')).join('|');
  if (left.length !== right.length) return false;
  const rows = new Map(right.map(row => [key(row), row]));
  return left.every(row => { const other = rows.get(key(row)); return !!other && keys.every(field => {
    const a = field.split('.').reduce((v, p) => v?.[p], row), b = field.split('.').reduce((v, p) => v?.[p], other);
    return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
  }); });
};

async function ownedSku(skuId: unknown, actor: Actor, session?: mongoose.ClientSession) {
  if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được thực hiện nhập kho.');
  const skuObjectId = skuId instanceof Types.ObjectId ? skuId : id(skuId, 'skuId');
  const query = r.Item.findOne({ _id: skuObjectId, customerId: actor._id, inventorySchemaVersion: 3, skuStatus: 'ACTIVE', deletedAt: { $exists: false } });
  if (session) query.session(session);
  const sku = await query.exec(); if (!sku) fail(404, 'SKU_NOT_FOUND', 'Không tìm thấy SKU.'); return sku;
}
async function activeReservation(sku: any, actor: Actor, session?: mongoose.ClientSession) {
  const query = r.Reservation.findOne({ _id: sku.reservationId ?? sku.managedReservationId, customerId: actor._id, facilityId: sku.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.ACTIVE,
    startDate: { $lte: new Date() }, endDate: { $gt: new Date() }, handoverAt: { $exists: true }, handoverByStaffId: { $exists: true },
    $or: [{ activeClosureRequestId: null }, { activeClosureRequestId: { $exists: false } }] });
  if (session) query.session(session);
  const reservation = await query.exec();
  if (!reservation) fail(409, 'RENTAL_NOT_ACTIVE', 'Reservation phải đang thuê và đã hoàn tất bàn giao mới được nhập kho.');
  const contractQuery = r.Contract.findOne({ reservationId: reservation._id, customerId: actor._id, status: 'SIGNED', signedByCustomerAt: { $exists: true, $ne: null }, signedByFMAt: { $exists: true, $ne: null } });
  if (session) contractQuery.session(session);
  const contract = await contractQuery.lean().exec();
  const activeVersion = contract?.contentVersions?.find((version: any) => version.version === contract.currentContentVersion);
  const signatures = (contract?.signatures ?? []).filter((signature: any) => signature.version === contract.currentContentVersion && signature.contentHash === activeVersion?.contentHash);
  if (!activeVersion || !signatures.some((signature: any) => signature.signerRole === UserRole.CUSTOMER) || !signatures.some((signature: any) => signature.signerRole !== UserRole.CUSTOMER)) {
    fail(409, 'CONTRACT_NOT_SIGNED', 'Hợp đồng hiện hành chưa được Customer và đại diện cơ sở ký đầy đủ.');
  }
  return reservation;
}
function key(value: unknown): string { if (typeof value !== 'string' || !/^[\w.:/-]{8,128}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key hợp lệ.'); return value as string; }

/** Replays canonical stock and reconciles only the Reservation + physical Rack/Level scope used by this operation. */
export async function readManagedFacilityStockState(facilityId: Types.ObjectId, session?: mongoose.ClientSession, scope?: { reservationId: Types.ObjectId; reservationIds?: Types.ObjectId[]; cellIds?: Types.ObjectId[]; skuId?: Types.ObjectId }) {
  // Attach the transaction session before execution. Calling .exec() first
  // returns a Promise, which has no .session() and would throw a TypeError.
  const query = (q: any) => session ? q.session(session).exec() : q.exec();
  const [allCells, movements, allStocks, allInstances, allocations, reservations, legacyItems, legacyBalances, v3Projections, v3BatchPlacements, v3PhysicalUnits, v3Footprints] = await Promise.all([
    query(r.Cell.find({ facilityId, deletedAt: { $exists: false } }).sort({ _id: 1 }).limit(10001).lean()),
    query(r.Movement.find({ facilityId }).sort({ performedAt: 1, _id: 1 }).limit(10001).lean()),
    query(r.CellStock.find({ facilityId }).sort({ itemSpecId: 1, receiptId: 1, cellId: 1 }).limit(10001).lean()),
    query(r.ItemInstance.find({ facilityId }).sort({ itemInstanceId: 1 }).limit(10001).lean()),
    query(r.Allocation.find({ facilityId }).select('reservationId cellId customerId status').limit(20001).lean()),
    query(r.Reservation.find({ facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: { $ne: ReservationStatus.CANCELLED } }).select('_id allocatedCapacity usedCapacityM3').limit(2001).lean()),
    query(r.Item.find({ facilityId, $or: [{ currentCellId: { $exists: true, $ne: null } }, { status: { $in: ['IN_STORAGE','PENDING_OUTBOUND'] } }], deletedAt: { $exists: false } }).select('_id facilityId currentCellId status managedReservationId reservationId').limit(10001).lean()),
    query(r.InventoryStockBalance.find({ facilityId, $or: [{ currentCellId: { $exists: true, $ne: null } }, { onHandQuantity: { $gt: 0 } }, { heldQuantity: { $gt: 0 } }, { actualTotalWeightKg: { $gt: 0 } }, { actualTotalVolumeM3: { $gt: 0 } }, { 'batches.quantity': { $gt: 0 } }, { 'batches.heldQuantity': { $gt: 0 } }] }).select('facilityId managedReservationId currentCellId onHandQuantity heldQuantity actualTotalWeightKg actualTotalVolumeM3 batches').limit(10001).lean()),
    query(r.ManagedV3StockProjection.find({ facilityId, $or: [{ onHandQuantity: { $gt: 0 } }, { heldQuantity: { $gt: 0 } }, { totalWeightKg: { $gt: 0 } }, { totalVolumeM3: { $gt: 0 } }] }).select('facilityId reservationId onHandQuantity heldQuantity totalWeightKg totalVolumeM3 byCell').limit(10001).lean()),
    query(r.ManagedV3BatchPlacement.find({ facilityId, state: 'ACTIVE' }).select('facilityId reservationId cellId quantity state').limit(10001).lean()),
    query(r.ManagedV3PhysicalUnit.find({ facilityId, state: 'PLACED' }).select('_id facilityId reservationId').limit(10001).lean()),
    query(r.ManagedV3Footprint.find({ facilityId, state: 'ACTIVE' }).select('physicalUnitId facilityId reservationId cells state').limit(10001).lean()),
  ]);
  if (allCells.length > 10000 || movements.length > 10000 || allStocks.length > 10000 || allInstances.length > 10000 || allocations.length > 20000 || reservations.length > 2000 || [legacyItems, legacyBalances, v3Projections, v3BatchPlacements, v3PhysicalUnits, v3Footprints].some(rows => rows.length > 10000)) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', 'Tồn kho hoặc Cell của Facility vượt giới hạn đối soát an toàn.');
  if (!scope || !scope.reservationId || !Array.isArray(scope.cellIds) || scope.cellIds.length === 0) fail(503, 'LEGACY_STOCK_SCOPE_UNKNOWN', 'Không xác định được phạm vi Reservation và Cell cần đối soát.');
  const operationScope = scope as { reservationId: Types.ObjectId; reservationIds?: Types.ObjectId[]; cellIds: Types.ObjectId[]; skuId?: Types.ObjectId };
  const scopedReservationIds = [...new Set([operationScope.reservationId, ...(operationScope.reservationIds ?? [])].map(String))];
  const requestedScopeIds = new Set(operationScope.cellIds.map(String));
  const requestedScopeCells = allCells.filter((cell: any) => requestedScopeIds.has(String(cell._id)));
  if (requestedScopeCells.length !== requestedScopeIds.size || requestedScopeCells.some((cell: any) => !cell.rackId || !Number.isSafeInteger(cell.levelNumber) || cell.levelNumber < 1)) fail(503, 'LEGACY_STOCK_SCOPE_UNKNOWN', 'Một hoặc nhiều Cell không có Rack/Level xác định được.');
  const scopedLevelKeys = new Set(requestedScopeCells.map((cell: any) => `${String(cell.rackId)}:${cell.levelNumber}`));
  if ([...scopedLevelKeys].length === 0) fail(503, 'LEGACY_STOCK_SCOPE_UNKNOWN', 'Cell thuộc phạm vi đối soát không tồn tại trong Facility.');
  const capacityCells = allCells.filter((cell: any) => scopedLevelKeys.has(`${String(cell.rackId)}:${cell.levelNumber}`));
  const scopedCellIds = new Set(capacityCells.map((cell: any) => String(cell._id)));
  const legacyImpacts = scopedReservationIds.map(reservationId => classifyLegacyStockImpact({ reservationId, capacityCells, allCells,
    movements, items: legacyItems, stockBalances: legacyBalances, v3Projections, v3BatchPlacements, v3PhysicalUnits, v3Footprints }));
  const legacyImpact = legacyImpacts.find(result => result.status !== 'ISOLATED');
  if (legacyImpact) fail(503, legacyImpact.status === 'CONFLICT' ? 'LEGACY_STOCK_UNRECONCILED' : 'LEGACY_STOCK_SCOPE_UNKNOWN',
    legacyImpact.status === 'CONFLICT' ? 'Reservation hoặc Rack/Level đang dùng còn tồn kho lịch sử chưa đối soát.' : 'Không xác định được phạm vi của tồn kho lịch sử; cần đối soát Facility.', legacyImpact);
  const cells = capacityCells;
  const canonicalMovements = movements.filter((movement: any) => movement.schemaVersion === 4 && movement.stockEffect);
  const relevantCanonicalMovements = canonicalMovements.filter((movement: any) => scopedReservationIds.includes(String(movement.managedReservationId ?? movement.reservationId)) ||
    [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? [])].some((line: any) => scopedCellIds.has(String(line.cellId)) || scopedReservationIds.includes(String(line.reservationId))));
  const relevantSkuIds = new Set(relevantCanonicalMovements.map((movement: any) => String(movement.itemId)));
  const stocks = allStocks.filter((row: any) => eq(row.reservationId, operationScope.reservationId) || scopedCellIds.has(String(row.cellId)) || relevantSkuIds.has(String(row.skuId)));
  const instances = allInstances.filter((row: any) => eq(row.reservationId, operationScope.reservationId) || (row.allocations ?? []).some((allocation: any) => scopedCellIds.has(String(allocation.cellId))) || relevantSkuIds.has(String(row.skuId)));
  const relevantSkuForReplay = new Set([...stocks.map((row: any) => String(row.skuId)), ...instances.map((row: any) => String(row.skuId))]);
  const replayMovements = canonicalMovements.filter((movement: any) => relevantSkuForReplay.has(String(movement.itemId)));
  let replay: any = { lots: [], instances: [] };
  try { if (replayMovements.length) replay = replayManagedStockMovementsBySku(replayMovements); } catch { fail(503, 'LEDGER_REPLAY_UNKNOWN', 'Không thể phát lại sổ tồn kho hiện hành.'); }
  if (!matchShape(replay.lots, stocks, ['skuId','itemSpecId','reservationId','facilityId','customerId','cellId','receiptId','quantityOnHand','quantityHeld','quantityAvailable','unitWeightKgSnapshot','unitVolumeM3Snapshot','totalWeightKg','totalVolumeM3','ledgerRevision']) ||
      !matchShape(replay.instances.map((row: any) => ({ ...row, allocations: [...(row.allocations ?? [])].sort((a: any,b: any) => String(a.cellId).localeCompare(String(b.cellId))) })),
        instances.map((row: any) => ({ ...row, allocations: [...(row.allocations ?? [])].sort((a: any,b: any) => String(a.cellId).localeCompare(String(b.cellId))) })),
        ['itemInstanceId','skuId','itemSpecId','reservationId','facilityId','customerId','sourceReceiptId','quantity','unitWeightKgSnapshot','unitVolumeM3Snapshot','status','allocations'])) fail(503, 'CELL_STOCK_RECONCILIATION_UNKNOWN', 'Cell Stock chưa khớp ledger chuẩn.');
  const activeLots = replay.lots, activeInstances = replay.instances.filter((row: any) => row.status === 'PLACED');
  const placements = [...activeLots.map((row: any) => ({ reservationId: row.reservationId, cellId: row.cellId })), ...activeInstances.flatMap((row: any) => row.allocations.map((allocation: any) => ({ reservationId: row.reservationId, cellId: allocation.cellId })))];
  if (!placementsHaveCellAllocations(placements, allocations)) fail(503, 'CELL_ALLOCATION_RECONCILIATION_UNKNOWN', 'Tồn kho không còn khớp Cell Allocation đang được cấp.');
  let byCell = new Map<string, any>();
  try { byCell = aggregateCellStock(activeLots, replay.instances); }
  catch { fail(503, 'CELL_STOCK_RECONCILIATION_UNKNOWN', 'Cell Stock hoặc Item Instance không hợp lệ để đối soát.'); }
  for (const cell of cells) {
    const expected = byCell.get(String(cell._id)) ?? { weightKg: 0, volumeM3: 0 };
    if (![cell.usedWeightKg, cell.usedVolumeM3].every((n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ||
      Math.abs(cell.usedWeightKg - expected.weightKg) > 0.001 || Math.abs(cell.usedVolumeM3 - expected.volumeM3) > 0.000001) fail(503, 'CELL_COUNTER_RECONCILIATION_UNKNOWN', `Counter của Cell ${cell.code} chưa khớp với ledger.`);
  }
  const reservationVolume = new Map<string, number>();
  for (const row of activeLots) reservationVolume.set(String(row.reservationId), round((reservationVolume.get(String(row.reservationId)) ?? 0) + row.totalVolumeM3, 6));
  for (const row of activeInstances) reservationVolume.set(String(row.reservationId), round((reservationVolume.get(String(row.reservationId)) ?? 0) + row.unitVolumeM3Snapshot, 6));
  const scopedReservations = reservations.filter((reservation: any) => scopedReservationIds.includes(String(reservation._id)));
  if (scopedReservations.length !== scopedReservationIds.length) fail(503, 'RESERVATION_COUNTER_RECONCILIATION_UNKNOWN', 'Không thể xác minh đầy đủ các Reservation trong phạm vi đối soát.');
  for (const targetReservation of scopedReservations) {
    const used = reservationVolume.get(String(targetReservation._id)) ?? 0;
    if (!Number.isFinite(targetReservation.allocatedCapacity) || targetReservation.allocatedCapacity <= 0 || !Number.isFinite(targetReservation.usedCapacityM3) || Math.abs(used - targetReservation.usedCapacityM3) > 0.000001) fail(503, 'RESERVATION_COUNTER_RECONCILIATION_UNKNOWN', `Counter Reservation ${targetReservation._id} chưa khớp tồn thực tế.`);
  }
  return { cells, movements: replayMovements, stocks, instances, allocations, reservations: scopedReservations, replay, byCell };
}

async function prepareCandidate(sku: any, reservation: any, candidate: any, session?: mongoose.ClientSession) {
  const specIds = candidate.lines.map((line: any) => line.itemSpecId);
  const specs = await (session ? r.ItemSpec.find({ _id: { $in: specIds }, skuId: sku._id, customerId: sku.customerId, reservationId: reservation._id, facilityId: sku.facilityId, status: 'ACTIVE', deletedAt: { $exists: false } }).populate('quantityUnitId').session(session).lean().exec() : r.ItemSpec.find({ _id: { $in: specIds }, skuId: sku._id, customerId: sku.customerId, reservationId: reservation._id, facilityId: sku.facilityId, status: 'ACTIVE', deletedAt: { $exists: false } }).populate('quantityUnitId').lean().exec());
  if (specs.length !== new Set(specIds.map(String)).size) fail(404, 'ITEM_SPECIFICATION_NOT_FOUND', 'Một hoặc nhiều Item Specification không thuộc SKU này.');
  const specsById = new Map(specs.map((spec: any) => [String(spec._id), spec]));
  const allCellIds = [...new Set<string>(candidate.lines.flatMap((line: any) => [...line.cellAllocations.map((row: any) => String(row.cellId)), ...(line.instanceAllocations ?? []).map((row: any) => String(row.cellId))]))].map(value => new Types.ObjectId(value));
  if (allCellIds.some(cellId => !(reservation.allocatedCellIds ?? []).some((allocated: any) => eq(allocated, cellId)))) fail(409, 'CELL_NOT_ALLOCATED', 'Có Cell nằm ngoài Reservation được cấp.');
  const now = new Date();
  const cells: any[] = await (session ? r.Cell.find({ _id: { $in: allCellIds }, facilityId: sku.facilityId, operationalStatus: 'AVAILABLE', deletedAt: { $exists: false } }).session(session).lean().exec() : r.Cell.find({ _id: { $in: allCellIds }, facilityId: sku.facilityId, operationalStatus: 'AVAILABLE', deletedAt: { $exists: false } }).lean().exec());
  if (cells.length !== allCellIds.length || cells.some(cell => ![cell.maxWeightKg, cell.usedWeightKg, cell.usedVolumeM3, cell.dimensions?.widthM, cell.dimensions?.depthM, cell.dimensions?.usableHeightM].every((value: any) => typeof value === 'number' && Number.isFinite(value)) || cell.maxWeightKg <= 0 || cell.usedWeightKg < 0 || cell.usedVolumeM3 < 0 || cell.dimensions.widthM <= 0 || cell.dimensions.depthM <= 0 || cell.dimensions.usableHeightM <= 0)) fail(503, 'CELL_CAPACITY_UNKNOWN', 'Một hoặc nhiều Cell thiếu cấu hình tải trọng, thể tích hoặc chiều cao sử dụng.');
  const allocationRows: any[] = await (session ? r.Allocation.find({ reservationId: reservation._id, customerId: sku.customerId, facilityId: sku.facilityId, cellId: { $in: allCellIds }, status: { $in: ['RESERVED','OCCUPIED'] }, startDate: { $lte: now }, endDate: { $gt: now } }).session(session).lean().exec() : r.Allocation.find({ reservationId: reservation._id, customerId: sku.customerId, facilityId: sku.facilityId, cellId: { $in: allCellIds }, status: { $in: ['RESERVED','OCCUPIED'] }, startDate: { $lte: now }, endDate: { $gt: now } }).lean().exec());
  if (allocationRows.length !== allCellIds.length) fail(409, 'CELL_NOT_ALLOCATED', 'Một hoặc nhiều Cell Allocation không còn hiệu lực.');
  const state = await readManagedFacilityStockState(sku.facilityId, session, { reservationId: reservation._id, cellIds: allCellIds, skuId: sku._id });
  const byCellAdd = new Map<string, { weightKg: number; volumeM3: number }>(), lineCellAdd = new Map<string, Map<string, { weightKg: number; volumeM3: number }>>(), levelAdd = new Map<string, number>();
  const addCellLoad = (lineId: string, cellId: unknown, weightKg: number, volumeM3: number) => {
    const cellKey = String(cellId), aggregate = byCellAdd.get(cellKey) ?? { weightKg: 0, volumeM3: 0 };
    aggregate.weightKg = round(aggregate.weightKg + weightKg, 3); aggregate.volumeM3 = round(aggregate.volumeM3 + volumeM3, 6); byCellAdd.set(cellKey, aggregate);
    const perLine = lineCellAdd.get(lineId) ?? new Map<string, { weightKg: number; volumeM3: number }>(), lineLoad = perLine.get(cellKey) ?? { weightKg: 0, volumeM3: 0 };
    lineLoad.weightKg = round(lineLoad.weightKg + weightKg, 3); lineLoad.volumeM3 = round(lineLoad.volumeM3 + volumeM3, 6); perLine.set(cellKey, lineLoad); lineCellAdd.set(lineId, perLine);
  };
  const effectLines: any[] = [], instancesToCreate: any[] = [], stocksToCreate: any[] = [];
  let totalQuantity = 0, totalWeightKg = 0, totalVolumeM3 = 0;
  for (const line of candidate.lines) {
    const spec: any = specsById.get(String(line.itemSpecId)); const measurement = measurementSnapshot(spec, line);
    const unit = spec.quantityUnitId; const quantityUnit = unit?.name ?? unit?.code;
    if (typeof quantityUnit !== 'string' || !quantityUnit.trim()) fail(503, 'QUANTITY_UNIT_UNKNOWN', 'Đơn vị tính của Item Specification chưa được xác minh.');
    const dims = measurement.dimensionsM, receiptId = `IN:${String(sku._id)}:${line.lineId}:${new Types.ObjectId().toString()}`;
    if (line.instanceAllocations) {
      const allocations = [...line.instanceAllocations].sort((a,b) => String(a.cellId).localeCompare(String(b.cellId)));
      const weight = round(allocations.reduce((sum,row) => sum + row.weightKg, 0), 3), volume = round(allocations.reduce((sum,row) => sum + row.volumeM3, 0), 6);
      if (weight !== round(measurement.unitWeightKg,3) || volume !== measurement.unitVolumeM3) fail(422, 'INVALID_INSTANCE_ALLOCATION', `Phân bổ tải dòng ${line.lineId} không bảo toàn khối lượng/thể tích.`, { lineId: line.lineId });
      const instanceId = `MI:${String(sku._id)}:${line.lineId}:${new Types.ObjectId().toString()}`;
      const instanceAllocations = allocations.map(allocation => ({ cellId: allocation.cellId, weightKg: allocation.weightKg, volumeM3: allocation.volumeM3 }));
      instancesToCreate.push({ itemInstanceId: instanceId, skuId: sku._id, itemSpecId: spec._id, reservationId: reservation._id, facilityId: sku.facilityId, customerId: sku.customerId,
        sourceReceiptId: receiptId, quantity: 1, unitWeightKgSnapshot: measurement.unitWeightKg, unitVolumeM3Snapshot: measurement.unitVolumeM3, unitDimensionsSnapshot: dims, allocations: instanceAllocations, status: 'PLACED', revision: 0 });
      for (const allocation of allocations) effectLines.push({ lineId: line.lineId, itemSpecId: spec._id, receiptId, itemInstanceId: instanceId, cellId: allocation.cellId, quantity: 1, quantityUnitSnapshot: quantityUnit,
        unitWeightKgSnapshot: measurement.unitWeightKg, unitVolumeM3Snapshot: measurement.unitVolumeM3, unitDimensionsSnapshot: dims, allocatedWeightKg: allocation.weightKg, allocatedVolumeM3: allocation.volumeM3 });
      for (const allocation of allocations) { addCellLoad(line.lineId, allocation.cellId, allocation.weightKg, allocation.volumeM3);
        const cell: any = cells.find(row => eq(row._id, allocation.cellId)), levelKey = `${cell?.rackId}:${cell?.levelNumber}`; levelAdd.set(levelKey, round((levelAdd.get(levelKey) ?? 0) + allocation.weightKg, 3)); }
      totalQuantity += 1; totalWeightKg += measurement.unitWeightKg; totalVolumeM3 += measurement.unitVolumeM3;
    } else {
      const unitWeightUnits = Math.round(measurement.unitWeightKg * 1000), unitVolumeUnits = Math.round(measurement.unitVolumeM3 * 1_000_000);
      if (unitWeightUnits < 1 || unitVolumeUnits < 1) fail(422, 'INVALID_MEASUREMENTS', `Số đo dòng ${line.lineId} thấp hơn độ chính xác lưu trữ chuẩn.`);
      let weightUsed = 0, volumeUsed = 0;
      for (let index = 0; index < line.cellAllocations.length; index++) {
        const allocation = line.cellAllocations[index]!, last = index === line.cellAllocations.length - 1;
        const weightKg = (last ? Math.round(measurement.unitWeightKg * line.quantity * 1000) - weightUsed : unitWeightUnits * allocation.quantity) / 1000;
        const volumeM3 = (last ? Math.round(measurement.unitVolumeM3 * line.quantity * 1_000_000) - volumeUsed : unitVolumeUnits * allocation.quantity) / 1_000_000;
        weightUsed += Math.round(weightKg * 1000); volumeUsed += Math.round(volumeM3 * 1_000_000);
        const cellId = allocation.cellId, cell: any = cells.find(row => eq(row._id, cellId));
        if (dims.widthM > cell.dimensions.widthM || dims.depthM > cell.dimensions.depthM || dims.heightM > cell.dimensions.usableHeightM) fail(409, 'ITEM_DOES_NOT_FIT', `Kích thước dòng ${line.lineId} không vừa Cell ${cell.code}.`);
        addCellLoad(line.lineId, cellId, weightKg, volumeM3);
        const receiptLine = { lineId: line.lineId, itemSpecId: spec._id, receiptId, cellId, quantity: allocation.quantity, quantityUnitSnapshot: quantityUnit, unitWeightKgSnapshot: measurement.unitWeightKg,
          unitVolumeM3Snapshot: measurement.unitVolumeM3, unitDimensionsSnapshot: dims, allocatedWeightKg: weightKg, allocatedVolumeM3: volumeM3 };
        effectLines.push(receiptLine);
        stocksToCreate.push({ skuId: sku._id, itemSpecId: spec._id, reservationId: reservation._id, facilityId: sku.facilityId, customerId: sku.customerId, cellId, receiptId,
          quantityOnHand: allocation.quantity, quantityHeld: 0, quantityAvailable: allocation.quantity, unitWeightKgSnapshot: measurement.unitWeightKg, unitVolumeM3Snapshot: measurement.unitVolumeM3,
          unitDimensionsSnapshot: dims, quantityUnitSnapshot: quantityUnit, totalWeightKg: weightKg, totalVolumeM3: volumeM3, ledgerRevision: -1, revision: 0 });
        const levelKey = `${cell.rackId}:${cell.levelNumber}`; levelAdd.set(levelKey, round((levelAdd.get(levelKey) ?? 0) + weightKg, 3));
      }
      totalQuantity += line.quantity; totalWeightKg += round(measurement.unitWeightKg * line.quantity, 3); totalVolumeM3 += round(measurement.unitVolumeM3 * line.quantity, 6);
    }
  }
  totalWeightKg = round(totalWeightKg,3); totalVolumeM3 = round(totalVolumeM3,6);
  if (!Number.isSafeInteger(totalQuantity) || totalQuantity < 1 || effectLines.some(line => !Number.isFinite(line.allocatedWeightKg) || !Number.isFinite(line.allocatedVolumeM3))) fail(422, 'INVALID_MEASUREMENTS', 'Không thể tính an toàn tổng nhập.');
  const requestedCells = [...new Set([...byCellAdd.keys()])].map(value => new Types.ObjectId(value));
  const racks: any[] = await (session ? r.Rack.find({ _id: { $in: [...new Set(cells.filter(cell => requestedCells.some(id => eq(id, cell._id))).map(cell => cell.rackId))] }, facilityId: sku.facilityId, operationalStatus: 'AVAILABLE', deletedAt: { $exists: false } }).session(session).lean().exec() : r.Rack.find({ _id: { $in: [...new Set(cells.filter(cell => requestedCells.some(id => eq(id, cell._id))).map(cell => cell.rackId))] }, facilityId: sku.facilityId, operationalStatus: 'AVAILABLE', deletedAt: { $exists: false } }).lean().exec());
  try { assertUnifiedInboundCapacity(state.cells, byCellAdd, levelAdd, racks); }
  catch (error: any) { if (error?.code === 'CAPACITY_UNKNOWN' || error?.code === 'CELL_CAPACITY_UNKNOWN' || error?.code === 'LEVEL_CAPACITY_UNKNOWN') fail(503, error.code, error.message); fail(409, error?.code || 'CAPACITY_EXCEEDED', error?.message || 'Capacity không đủ.'); }
  const expectedReservationVolume = round(state.replay.lots.filter((row: any) => eq(row.reservationId, reservation._id)).reduce((sum: number,row: any) => sum + row.totalVolumeM3,0) + state.replay.instances.filter((row: any) => eq(row.reservationId,reservation._id) && row.status === 'PLACED').reduce((sum: number,row: any) => sum + row.unitVolumeM3Snapshot,0),6);
  if (Math.abs(expectedReservationVolume - Number(reservation.usedCapacityM3)) > 0.000001 || !Number.isFinite(reservation.allocatedCapacity) || expectedReservationVolume + totalVolumeM3 > reservation.allocatedCapacity + 0.000001) fail(409, 'RESERVATION_CAPACITY_EXCEEDED', 'Dung lượng Reservation không đủ hoặc counter chưa đối soát.');
  return { specs, effectLines, stocksToCreate, instancesToCreate, byCellAdd, lineCellAdd, totalQuantity, totalWeightKg, totalVolumeM3, requestedCells, scopedCellIds: allCellIds, levelAdd, allocationRows, state };
}

export class ManagedUnifiedInboundService {
  static async context(skuId: unknown, actor: Actor) {
    const sku = await ownedSku(skuId, actor), reservation = await activeReservation(sku, actor);
    const specifications = await r.ItemSpec.find({ skuId: sku._id, customerId: actor._id, reservationId: reservation._id, status: 'ACTIVE', deletedAt: { $exists: false } }).populate('quantityUnitId', 'code name').sort({ createdAt: 1, _id: 1 }).lean().exec();
    return { skuId: sku._id, reservationId: reservation._id, facilityId: reservation.facilityId, skuRevision: sku.managedV3Revision ?? 0,
      allocatedCellIds: reservation.allocatedCellIds ?? [], specifications, apiVersion: 3 };
  }

  static async preview(skuId: unknown, body: unknown, actor: Actor) {
    const candidate = normalizeUnifiedInbound(body), sku = await ownedSku(skuId, actor), reservation = await activeReservation(sku, actor);
    if (candidate.skuRevision !== Number(sku.managedV3Revision ?? 0)) fail(412, 'STALE_SKU_REVISION', 'SKU đã thay đổi; hãy tải lại trước khi xem trước.');
    const session: any = await r.AccessSession.findOne({ _id: candidate.accessSessionId, customerId: actor._id, reservationId: reservation._id, facilityId: sku.facilityId,
      status: ManagedAccessSessionStatus.ACTIVE, allowedPurposes: ManagedAccessPurpose.INBOUND, revision: candidate.sessionRevision, startedAt: { $lte: new Date() }, expiresAt: { $gt: new Date() } }).lean().exec();
    if (!session) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Cần Access Session INBOUND đang hoạt động và còn hạn.');
    if (!Array.isArray(session.allowedCellIds) || !session.allowedCellIds.length) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Phiên đến kho chưa có phạm vi ô kệ hợp lệ.');
    const prepared = await prepareCandidate(sku, reservation, candidate);
    const allowed = new Set(session.allowedCellIds.map(String));
    if (prepared.scopedCellIds.some((cellId: Types.ObjectId) => !allowed.has(String(cellId)))) fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Session không được phép vào một hoặc nhiều Cell đã chọn.');
    const current: any[] = await r.Cell.find({ _id: { $in: prepared.requestedCells } }).select('_id code usedWeightKg usedVolumeM3 maxWeightKg dimensions').lean().exec();
    return { status: 'READY', skuId: sku._id, reservationId: reservation._id, facilityId: sku.facilityId,
      accessSession: { sessionId: session._id, purpose: ManagedAccessPurpose.INBOUND, expiresAt: session.expiresAt, revision: session.revision },
      lines: candidate.lines.map((line: any) => { const spec: any = prepared.specs.find((row: any) => eq(row._id, line.itemSpecId)); const snapshot = measurementSnapshot(spec, line); return { lineId: line.lineId, itemSpecId: line.itemSpecId,
        itemName: spec.name, itemCode: spec.code, itemSpecRevision: spec.revision, quantity: line.quantity, quantityUnit: spec.quantityUnitId?.name ?? spec.quantityUnitId?.code,
        unitWeightKg: snapshot.unitWeightKg, dimensionsM: snapshot.dimensionsM, unitVolumeM3: snapshot.unitVolumeM3,
        totalWeightKg: round(snapshot.unitWeightKg * line.quantity,3), totalVolumeM3: round(snapshot.unitVolumeM3 * line.quantity,6),
        cellAllocations: [...(prepared.lineCellAdd.get(line.lineId)?.entries() ?? [])].map(([cellId, addition]) => {
          const cell = current.find(row => String(row._id) === cellId); return { cellId, cellCode: cell?.code, addedWeightKg: addition.weightKg, addedVolumeM3: addition.volumeM3, usedWeightKg: cell?.usedWeightKg, usedVolumeM3: cell?.usedVolumeM3,
            remainingWeightAfterKg: cell ? round(cell.maxWeightKg - cell.usedWeightKg - addition.weightKg,3) : null,
            remainingVolumeAfterM3: cell ? round(cell.dimensions.widthM * cell.dimensions.depthM * cell.dimensions.usableHeightM - cell.usedVolumeM3 - addition.volumeM3,6) : null };
        }) }; }), totalQuantity: prepared.totalQuantity, totalWeightKg: prepared.totalWeightKg, totalVolumeM3: prepared.totalVolumeM3,
      previewRevision: { skuRevision: sku.managedV3Revision ?? 0, sessionRevision: session.revision, inventoryRevision: reservation.inventoryVersion ?? 0 },
      warnings: candidate.lines.some((line: any) => line.instanceAllocations) ? ['Phân bổ tải nhiều Cell là khai báo Customer trong Access Session có Staff giám sát; không phải phép đo cảm biến độc lập.'] : [] };
  }

  static async confirm(skuId: unknown, body: unknown, actor: Actor, idempotencyHeader: unknown) {
    const candidate = normalizeUnifiedInbound(body), requestKey = key(idempotencyHeader), skuObjectId = id(skuId, 'skuId'), bodyHash = requestHash(candidate);
    const owned = await ownedSku(skuObjectId, actor);
    const prior = await r.Movement.findOne({ itemId: skuObjectId, idempotencyKey: requestKey, schemaVersion: 4 }).lean().exec();
    if (prior) { if (prior.stockEffect?.requestHash !== bodyHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã dùng với payload khác.'); return { status: 'COMMITTED', replayed: true, movement: prior }; }
    if (process.env.NODE_ENV === 'production') fail(503, 'INBOUND_CONFIRM_ENVIRONMENT_BLOCKED', 'Xác nhận nhập kho hiện chỉ được phép kiểm thử trên Backend development đã xác minh.');
    const dbSession = await mongoose.startSession(); let result: any;
    try {
      await dbSession.withTransaction(async () => {
        const sku: any = await ownedSku(skuObjectId, actor, dbSession), reservation: any = await activeReservation(sku, actor, dbSession);
        if (Number(sku.managedV3Revision ?? 0) !== candidate.skuRevision) fail(412, 'STALE_SKU_REVISION', 'SKU đã thay đổi kể từ lúc xem trước.');
        const prepared = await prepareCandidate(sku, reservation, candidate, dbSession);
        const unitIds = [...new Set(prepared.requestedCells.map(String))].map(value => new Types.ObjectId(value as string));
        const guard = await assertManagedAccessSessionScope({ sessionId: candidate.accessSessionId, customerId: actor._id, reservationId: reservation._id, facilityId: sku.facilityId,
          purpose: ManagedAccessPurpose.INBOUND, cellIds: prepared.scopedCellIds, expectedRevision: candidate.sessionRevision, dbSession });
        const sessionFence = guard.revision;
        const operationId = `MI-UNIFIED-IN:${String(sku._id)}:${createHash('sha256').update(requestKey).digest('hex')}`;
        const ledgerRevision = (prepared.state.movements.filter((movement: any) => eq(movement.itemId, sku._id)).reduce((max: number, movement: any) => movement.stockEffect?.ledgerRevision > max ? movement.stockEffect.ledgerRevision : max, 0) || 0) + 1;
        const cellById = new Map<string, any>(prepared.state.cells.map((cell: any) => [String(cell._id), cell]));
        for (const cellId of unitIds.sort((a,b) => a.toString().localeCompare(b.toString()))) {
          const cell: any = cellById.get(String(cellId)), addition = prepared.byCellAdd.get(String(cellId)); if (!cell || !addition) continue;
          const updated = await r.Cell.updateOne({ _id: cell._id, facilityId: sku.facilityId, operationalStatus: 'AVAILABLE', allocationVersion: cell.allocationVersion, managedInventoryRevision: cell.managedInventoryRevision,
            usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 }, { $inc: { usedWeightKg: addition.weightKg, usedVolumeM3: addition.volumeM3, managedInventoryRevision: 1 } }, { session: dbSession }).exec();
          if (updated.matchedCount !== 1) fail(412, 'STALE_CELL_CAPACITY', `Capacity Cell ${cell.code} đã thay đổi.`);
        }
        const rackIds = [...new Set(unitIds.map(cellId => String(cellById.get(String(cellId))?.rackId)).filter(Boolean))].sort();
        for (const rackId of rackIds) {
          const rack: any = await r.Rack.findOne({ _id: rackId, facilityId: sku.facilityId, operationalStatus: 'AVAILABLE', deletedAt: { $exists: false } }).session(dbSession).lean().exec();
          if (!rack) fail(409, 'RACK_UNAVAILABLE', 'Rack không khả dụng.');
          const result = await r.Rack.updateOne({ _id: rack._id, managedInventoryRevision: rack.managedInventoryRevision }, { $inc: { managedInventoryRevision: 1 } }, { session: dbSession }).exec();
          if (result.matchedCount !== 1) fail(412, 'STALE_RACK_CAPACITY', 'Capacity Rack vừa thay đổi.');
        }
        const totalSpecVolumes = prepared.totalVolumeM3;
        const reservationUpdated = await r.Reservation.updateOne({ _id: reservation._id, customerId: actor._id, facilityId: sku.facilityId, status: ReservationStatus.ACTIVE,
          inventoryVersion: reservation.inventoryVersion ?? 0, usedCapacityM3: reservation.usedCapacityM3, allocatedCapacity: { $gte: Number(reservation.usedCapacityM3) + totalSpecVolumes } },
          { $inc: { inventoryVersion: 1 }, $set: { usedCapacityM3: round(Number(reservation.usedCapacityM3) + totalSpecVolumes,6) } }, { session: dbSession }).exec();
        if (reservationUpdated.matchedCount !== 1) fail(412, 'STALE_RESERVATION_CAPACITY', 'Capacity Reservation vừa thay đổi hoặc không đủ.');
        for (const spec of prepared.specs) {
          const expectedRevision = candidate.lines.find((line: any) => eq(line.itemSpecId, spec._id))!.itemSpecRevision;
          const fenced = await r.ItemSpec.updateOne({ _id: spec._id, skuId: sku._id, revision: expectedRevision, status: 'ACTIVE' }, { $inc: { inboundRevision: 1 } }, { session: dbSession }).exec();
          if (fenced.matchedCount !== 1) fail(412, 'STALE_ITEM_SPECIFICATION', 'Item Specification vừa thay đổi.');
        }
        const skuFence = await r.Item.updateOne({ _id: sku._id, customerId: actor._id, managedV3Revision: candidate.skuRevision, inventorySchemaVersion: 3 }, { $inc: { managedV3Revision: 1 } }, { session: dbSession }).exec();
        if (skuFence.matchedCount !== 1) fail(412, 'STALE_SKU_REVISION', 'SKU vừa thay đổi.');
        const movementId = new Types.ObjectId(), occurredAt = new Date();
        for (const stock of prepared.stocksToCreate) stock.ledgerRevision = ledgerRevision;
        if (prepared.stocksToCreate.length) await createInTransactionOrdered(r.CellStock, prepared.stocksToCreate, dbSession);
        if (prepared.instancesToCreate.length) await createInTransactionOrdered(r.ItemInstance, prepared.instancesToCreate, dbSession);
        const unitSet = new Set(prepared.effectLines.filter((line: any) => line.itemInstanceId).map((line: any) => line.itemInstanceId));
        const quantityUnit = new Set(prepared.effectLines.map((line: any) => line.quantityUnitSnapshot)).size === 1 ? prepared.effectLines[0].quantityUnitSnapshot : 'MIXED';
        const first = prepared.effectLines[0], idempotencyKey = requestKey;
        const movementCode = `MI-${movementId.toString()}`;
        const movement = new r.Movement({ _id: movementId, movementCode, referenceCode: operationId, itemId: sku._id, managedReservationId: reservation._id, facilityId: sku.facilityId, customerId: actor._id,
          type: 'INBOUND', quantity: prepared.totalQuantity, quantityUnit, actualUnitWeightKg: first.unitWeightKgSnapshot, actualTotalWeightKg: prepared.totalWeightKg,
          actualUnitDimensionsM: first.unitDimensionsSnapshot, actualTotalVolumeM3: prepared.totalVolumeM3, performedBy: actor._id, performedAt: occurredAt,
          inspectionNote: 'Customer xác nhận đã thực hiện nhập hàng trong Access Session có Staff giám sát.', handoverNote: undefined,
          physicalPackingConfirmed: true, idempotencyKey, schemaVersion: 4, operationId,
          itemSpecId: first.itemSpecId, stockEffect: { action: 'ADD', operationId, requestHash: bodyHash, ledgerRevision, contractVersion: 2, accessSessionId: candidate.accessSessionId, source: [], destination: prepared.effectLines } });
        await movement.save({ session: dbSession });
        const reservedCellIds = prepared.allocationRows.filter((row: any) => row.status === 'RESERVED').map((row: any) => row.cellId);
        const allocationUpdate = reservedCellIds.length ? await r.Allocation.updateMany({ reservationId: reservation._id, customerId: actor._id, facilityId: sku.facilityId, cellId: { $in: reservedCellIds }, status: 'RESERVED' },
          { $set: { status: 'OCCUPIED' } }, { session: dbSession }).exec() : { matchedCount: 0 };
        if (allocationUpdate.matchedCount !== reservedCellIds.length) fail(412, 'CELL_ALLOCATION_CHANGED', 'Cell Allocation vừa thay đổi.');
        result = { status: 'COMMITTED', replayed: false, movementId, movementCode: `MI-${movementId.toString()}`, quantity: prepared.totalQuantity, totalWeightKg: prepared.totalWeightKg,
          totalVolumeM3: prepared.totalVolumeM3, lineCount: candidate.lines.length, sessionRevision: sessionFence };
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        const existing = await r.Movement.findOne({ itemId: skuObjectId, idempotencyKey: requestKey, schemaVersion: 4 }).lean().exec();
        if (existing?.stockEffect?.requestHash === bodyHash) return { status: 'COMMITTED', replayed: true, movement: existing };
        if (existing) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với yêu cầu khác.');
      }
      if (error instanceof ManagedAccessError) fail(409, error.code, error.message);
      if (error?.codeName === 'UnknownTransactionCommitResult' || error?.hasErrorLabel?.('UnknownTransactionCommitResult')) fail(503, 'OUTCOME_UNKNOWN', 'Chưa xác định được kết quả commit. Hãy đối soát bằng Idempotency-Key trước khi thử thao tác khác.');
      if (error?.code === 20 || error?.codeName === 'IllegalOperation' || /transactions? (?:are|is) not supported|transaction numbers are only allowed/i.test(String(error?.message ?? ''))) {
        fail(503, 'TRANSACTIONS_UNAVAILABLE', 'Cơ sở dữ liệu hiện tại không hỗ trợ transaction; phiếu nhập chưa được ghi. Hãy liên hệ quản trị viên.');
      }
      throw error;
    } finally { await dbSession.endSession(); }
    if (!result) fail(500, 'INBOUND_COMMIT_UNKNOWN', 'Chưa xác định được kết quả xác nhận nhập kho. Hãy đối soát theo Idempotency-Key.');
    return result;
  }

  static async operation(skuId: unknown, rawKey: unknown, actor: Actor) {
    const sku = await ownedSku(skuId, actor), requestKey = key(rawKey);
    const movement = await r.Movement.findOne({ itemId: sku._id, customerId: actor._id, idempotencyKey: requestKey, schemaVersion: 4, 'stockEffect.action': 'ADD' }).lean().exec();
    if (!movement) fail(404, 'OPERATION_NOT_FOUND', 'Chưa tìm thấy giao dịch nhập kho đã xác nhận.');
    return { status: 'COMMITTED', movement };
  }
}
