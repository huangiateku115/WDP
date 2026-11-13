import { createHash, randomUUID } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import ReservationModel from '../../models/reservations/reservation.model';
import InventoryItemModelRaw from '../../models/inventory-items/inventory-item.model';
import ItemMovementModelRaw from '../../models/inventory-items/item-movement.model';
import ProjectionModelRaw from '../../models/inventory-items/managed-v3-stock-projection.model';
import PhysicalUnitModelRaw from '../../models/inventory-items/managed-v3-physical-unit.model';
import FootprintModelRaw from '../../models/inventory-items/managed-v3-footprint.model';
import BatchPlacementModelRaw from '../../models/inventory-items/managed-v3-batch-placement.model';
import RequestModelRaw from '../../models/inventory-items/managed-v3-outbound-request.model';
import EventModelRaw from '../../models/inventory-items/managed-v3-outbound-event.model';
import CellModelRaw from '../../models/warehouse-map/warehouse-cell.model';
import RackModelRaw from '../../models/warehouse-map/warehouse-rack.model';
import ZoneModelRaw from '../../models/warehouse-map/warehouse-zone.model';
import AllocationModelRaw from '../../models/warehouse-map/cell-allocation.model';
import TopologyModelRaw from '../../models/warehouse-map/managed-v3-topology-certification.model';
import ManagedAccessSessionModelRaw from '../../models/access/managed-access-session.model';
import ManagedAccessVisitModelRaw from '../../models/access/managed-access-visit.model';
import { assertManagedAccessSessionScope, ManagedAccessError } from '../access/managed-access.service';
import { replayManagedInventoryV3, canonicalA2RemovalAmounts } from './managed-inventory-v3-ledger.service';
import { allocateManagedV3Fifo, assertManagedV3A1OutboundFootprints, currentManagedV3A1Footprint, reconcileManagedV3A1PhysicalUnits, reconcileManagedV3OutboundHolds, staffCanReadManagedV3OutboundRequest, ManagedV3OutboundDomainError } from './managed-v3-outbound-domain';
import { reconcileManagedItemStock } from './managed-stock-ledger.service';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { ItemMovementType } from '../../types/item-movement.type';
import { ManagedV3OutboundAllocation, ManagedV3OutboundOperation, ManagedV3OutboundState } from '../../types/managed-inventory-v3-outbound.type';
import { UserRole } from '../../types/user.type';

const Item: any = InventoryItemModelRaw, Movement: any = ItemMovementModelRaw, Projection: any = ProjectionModelRaw;
const PhysicalUnit: any = PhysicalUnitModelRaw, Footprint: any = FootprintModelRaw, BatchPlacement: any = BatchPlacementModelRaw;
const Request: any = RequestModelRaw, Event: any = EventModelRaw, Cell: any = CellModelRaw, Rack: any = RackModelRaw;
const Zone: any = ZoneModelRaw, Allocation: any = AllocationModelRaw, Topology: any = TopologyModelRaw, AccessSession: any = ManagedAccessSessionModelRaw;
const Visit: any = ManagedAccessVisitModelRaw;
type Actor = { _id: Types.ObjectId; role: UserRole; assignedFacilityId?: Types.ObjectId | null };
type Plain = Record<string, any>;
export class ManagedV3OutboundError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const fail = (status: number, code: string, message: string): never => { throw new ManagedV3OutboundError(status, code, message); };
const same = (a: any, b: any) => String(a?._id ?? a) === String(b?._id ?? b);
const live = { deletedAt: { $exists: false } };
const oid = (value: unknown, name: string) => { if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, 'INVALID_INPUT', `${name} không hợp lệ.`); return new Types.ObjectId(value as string); };
const key = (value: unknown) => { if (typeof value !== 'string' || !/^[\w.:/-]{8,128}$/.test(value)) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cần Idempotency-Key hợp lệ.'); return value; };
const version = (value: unknown) => { const match = typeof value === 'string' ? value.trim().match(/^(?:W\/)?"(0|[1-9]\d*)"$/) : null; const n = match ? Number(match[1]) : NaN; if (!Number.isSafeInteger(n)) fail(typeof value === 'undefined' ? 428 : 400, 'IF_MATCH_REQUIRED', 'Cần If-Match là revision hiện tại.'); return n; };
const canonical = (value: any): any => value?.toHexString ? value.toHexString() : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(k => !['_id', '__v', 'createdAt', 'updatedAt'].includes(k) && value[k] !== undefined).sort().map(k => [k, canonical(value[k])])) : value;
const stable = (value: any) => JSON.stringify(canonical(value));
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const errorLabel = (error: any, label: string) => !!error?.hasErrorLabel?.(label) || error?.errorLabels?.includes?.(label);
const money = (v: number, places: 3 | 6) => Math.round((v + Number.EPSILON) * 10 ** places) / 10 ** places;

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try { let result!: T; await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15_000 }); return result; }
  finally { await session.endSession(); }
}
function requireCustomer(actor: Actor) { if (actor.role !== UserRole.CUSTOMER) fail(403, 'ROLE_DENIED', 'Chỉ Customer được tạo hoặc xác nhận yêu cầu xuất V3.'); }
function projectionComparable(value: Plain) {
  return { skuId: String(value.skuId), reservationId: String(value.reservationId), customerId: String(value.customerId), facilityId: String(value.facilityId),
    onHandQuantity: value.onHandQuantity, heldQuantity: value.heldQuantity, availableQuantity: value.availableQuantity, totalWeightKg: value.totalWeightKg, totalVolumeM3: value.totalVolumeM3,
    byBatch: (value.byBatch ?? []).map((x: Plain) => ({ itemKind: x.itemKind, batchId: x.batchId, cellId: String(x.cellId), quantity: x.quantity, quantityUnit: x.quantityUnit, weightKg: x.weightKg, volumeM3: x.volumeM3, heldQuantity: x.heldQuantity, topologyCertificationId: String(x.topologyCertificationId), topologyRevision: x.topologyRevision })).sort((a: Plain, b: Plain) => a.batchId.localeCompare(b.batchId) || a.cellId.localeCompare(b.cellId)),
    byPhysicalUnit: (value.byPhysicalUnit ?? []).map((x: Plain) => ({ itemKind: x.itemKind, physicalUnitId: String(x.physicalUnitId), quantity: x.quantity, quantityUnit: x.quantityUnit, pose: x.pose, weightKg: x.weightKg, volumeM3: x.volumeM3, cellIds: (x.cellIds ?? []).map(String).sort() })).sort((a: Plain, b: Plain) => a.physicalUnitId.localeCompare(b.physicalUnitId)),
    byCell: (value.byCell ?? []).map((x: Plain) => ({ ...x, cellId: String(x.cellId) })).sort((a: Plain, b: Plain) => a.cellId.localeCompare(b.cellId)), lastMovementId: value.lastMovementId ? String(value.lastMovementId) : null, ledgerRevision: value.ledgerRevision, projectionRevision: value.projectionRevision };
}
async function readState(item: Plain, session?: ClientSession) {
  const query = Movement.find({ itemId: item._id, schemaVersion: 3 }).sort({ performedAt: 1, _id: 1 }); if (session) query.session(session);
  const movements = await query.lean().exec();
  if (movements.length > 5000) fail(503, 'V3_LEDGER_SCAN_LIMIT', 'Lịch sử V3 vượt giới hạn đối soát an toàn.');
  let replay: Plain = {};
  try { replay = replayManagedInventoryV3(item, movements); } catch (error: any) { fail(409, error.code ?? 'V3_LEDGER_UNKNOWN', 'Stock ledger V3 không thể đối soát an toàn.'); }
  const projectionQuery = Projection.findOne({ skuId: item._id, reservationId: item.managedReservationId, customerId: item.customerId, facilityId: item.facilityId }); if (session) projectionQuery.session(session);
  const projection = await projectionQuery.lean().exec();
  const batchQuery = BatchPlacement.find({ skuId: item._id }); if (session) batchQuery.session(session);
  const unitQuery = PhysicalUnit.find({ skuId: item._id }); if (session) unitQuery.session(session);
  const [batchRows, unitRows] = await Promise.all([batchQuery.lean().exec(), unitQuery.lean().exec()]);
  const unitIds = (unitRows as Plain[]).map(row => row._id);
  const footprintQuery = Footprint.find({ physicalUnitId: { $in: unitIds } }); if (session) footprintQuery.session(session);
  const footprintRows = await footprintQuery.lean().exec();
  const requestQuery = Request.find({ skuId: item._id }).sort({ createdAt: 1, _id: 1 }); if (session) requestQuery.session(session);
  const eventQuery = Event.find({ skuId: item._id }).sort({ occurredAt: 1, _id: 1 }); if (session) eventQuery.session(session);
  const [requests, events] = await Promise.all([requestQuery.lean().exec(), eventQuery.lean().exec()]);
  const pristineEmptyRegistration = movements.length === 0 && !projection && item.status === 'REGISTERED' && item.currentCellId == null &&
    !item.currentPlacementMovementId && !item.inboundMovementId && (batchRows as Plain[]).length === 0 &&
    (unitRows as Plain[]).every(row => row.state === 'PREPARED') && (footprintRows as Plain[]).length === 0 && requests.length === 0 && events.length === 0;
  if (!projection && !pristineEmptyRegistration || projection && stable(projectionComparable(projection)) !== stable(projectionComparable(replay))) {
    fail(409, 'V3_PROJECTION_MISMATCH', 'Stock projection chưa khớp replay canonical V3.');
  }
  const activeBatchRows = (batchRows as Plain[]).filter(row => row.state === 'ACTIVE');
  const expectedBatchRows = replay.byBatch as Plain[];
  const batchComparable = (rows: Plain[]) => rows.map(row => ({ batchId: String(row.batchId), cellId: String(row.cellId), quantity: row.quantity,
    quantityUnit: row.quantityUnit, weightKg: row.weightKg, volumeM3: row.volumeM3, receiptMovementId: String(row.receiptMovementId),
    topologyCertificationId: String(row.topologyCertificationId), topologyRevision: row.topologyRevision })).sort((a, b) => a.batchId.localeCompare(b.batchId) || a.cellId.localeCompare(b.cellId));
  const batchScopesValid = (batchRows as Plain[]).every(row => String(row.skuId) === String(item._id) && String(row.reservationId) === String(item.managedReservationId) &&
    String(row.customerId) === String(item.customerId) && String(row.facilityId) === String(item.facilityId));
  if (!batchScopesValid || (batchRows as Plain[]).some(row => row.state === 'DEPLETED' && (row.quantity !== 0 || row.weightKg !== 0 || row.volumeM3 !== 0)) ||
      stable(batchComparable(activeBatchRows)) !== stable(batchComparable(expectedBatchRows))) fail(409, 'V3_PLACEMENT_RECONCILIATION_UNKNOWN', 'BatchPlacement không khớp canonical V3 ledger.');
  const activeUnitRows = (unitRows as Plain[]).filter(row => row.state === 'PLACED');
  const expectedUnitRows = replay.byPhysicalUnit as Plain[];
  try { reconcileManagedV3A1PhysicalUnits({ item, physicalUnits: unitRows as Plain[], movements, replay }); }
  catch (error: any) { fail(409, error.code ?? 'V3_PHYSICAL_UNIT_RECONCILIATION_UNKNOWN', 'PhysicalUnit identity hoặc physical facts không khớp canonical V3 ledger.'); }
  if ((unitRows as Plain[]).some(row => ['REMOVED', 'QUARANTINED'].includes(row.state) && expectedUnitRows.some(expected => String(expected.physicalUnitId) === String(row._id))) ||
      activeUnitRows.length !== expectedUnitRows.length || activeUnitRows.some(row => !row.currentPose)) fail(409, 'V3_PHYSICAL_UNIT_RECONCILIATION_UNKNOWN', 'PhysicalUnit không khớp canonical V3 ledger.');
  const activeFootprints = (footprintRows as Plain[]).filter(row => row.state === 'ACTIVE');
  const footprintComparable = (rows: Plain[]) => rows.map(row => ({ physicalUnitId: String(row.physicalUnitId), sourceMovementId: String(row.sourceMovementId), cells: (row.cells ?? []).map((cell: Plain) => ({ cellId: String(cell.cellId),
    topologyCertificationId: String(cell.topologyCertificationId), supportReactionKg: cell.supportReactionKg, occupiedVolumeM3: cell.occupiedVolumeM3, topologyRevision: cell.topologyRevision }))
      .sort((a: Plain, b: Plain) => a.cellId.localeCompare(b.cellId)), pose: row.pose, topologyCertificationId: String(row.topologyCertificationId), topologyRevision: row.topologyRevision }))
    .sort((a, b) => a.physicalUnitId.localeCompare(b.physicalUnitId));
  const expectedFootprints = expectedUnitRows.map((unit: Plain) => {
    let lines: Plain[] = []; try { lines = currentManagedV3A1Footprint(movements, String(unit.physicalUnitId)); }
    catch { fail(409, 'V3_FOOTPRINT_RECONCILIATION_UNKNOWN', 'A1 footprint hiện tại không thể dựng lại từ ledger history.'); }
    const latestMovement = [...movements].reverse().find((movement: Plain) => [...(movement.v3Effect?.source ?? []), ...(movement.v3Effect?.destination ?? [])]
      .some((line: Plain) => String(line.physicalUnitId) === String(unit.physicalUnitId)));
    if (!latestMovement || latestMovement.v3Effect?.action === 'REMOVE') fail(409, 'V3_FOOTPRINT_RECONCILIATION_UNKNOWN', 'Không xác định được Movement tạo footprint hiện tại.');
    return { physicalUnitId: unit.physicalUnitId, cells: lines.map((line: Plain) => ({ cellId: line.cellId, topologyCertificationId: line.topologyCertificationId,
      supportReactionKg: line.supportReactionKg, occupiedVolumeM3: line.occupiedVolumeM3, topologyRevision: line.topologyRevision })), pose: lines[0]!.pose, sourceMovementId: latestMovement._id,
      topologyCertificationId: lines[0]!.topologyCertificationId, topologyRevision: lines[0]!.topologyRevision };
  });
  const footprintScopesValid = activeFootprints.every(row => String(row.reservationId) === String(item.managedReservationId) &&
    String(row.customerId) === String(item.customerId) && String(row.facilityId) === String(item.facilityId));
  if (!footprintScopesValid || stable(footprintComparable(activeFootprints)) !== stable(footprintComparable(expectedFootprints))) fail(409, 'V3_FOOTPRINT_RECONCILIATION_UNKNOWN', 'Footprint identity, scope or cells do not match canonical V3 ledger.');
  let holds: Plain = { heldByPlacement: new Map(), pendingRequestIds: [], allocations: [] };
  try { holds = reconcileManagedV3OutboundHolds(events, requests); } catch (error: any) { fail(409, error.code ?? 'OUTBOUND_HOLDS_UNKNOWN', 'Outbound holds không thể tái dựng an toàn.'); }
  const batchByKey = new Map<string, Plain>((replay.byBatch ?? []).map((row: Plain) => [`B:${row.batchId}:${String(row.cellId)}`, row]));
  const unitsById = new Map<string, Plain>((replay.byPhysicalUnit ?? []).map((row: Plain) => [String(row.physicalUnitId), row]));
  let heldQuantity = 0; const countedUnits = new Set<string>();
  for (const [placementKey, held] of holds.heldByPlacement.entries()) {
    const line = placementKey.startsWith('B:') ? batchByKey.get(placementKey) : unitsById.get(placementKey.slice(2).split(':')[0]);
    if (!line || !Number.isSafeInteger(held) || held < 1 || held > (placementKey.startsWith('B:') ? line.quantity : 1)) fail(409, 'OUTBOUND_HOLDS_UNKNOWN', 'Hold vượt tồn hoặc không còn placement nguồn.');
    if (placementKey.startsWith('B:')) heldQuantity += held;
    else { const unitId = placementKey.slice(2).split(':')[0]!; if (!countedUnits.has(unitId)) { heldQuantity += 1; countedUnits.add(unitId); } }
  }
  if (!Number.isSafeInteger(heldQuantity) || heldQuantity > replay.onHandQuantity) fail(409, 'OUTBOUND_HOLDS_UNKNOWN', 'Tổng hold vượt on-hand stock.');
  const customerProjection = { ...replay, heldQuantity, availableQuantity: replay.onHandQuantity - heldQuantity,
    byBatch: replay.byBatch.map((line: Plain) => ({ ...line, heldQuantity: holds.heldByPlacement.get(`B:${line.batchId}:${String(line.cellId)}`) ?? 0 })),
    byPhysicalUnit: replay.byPhysicalUnit.map((unit: Plain) => ({ ...unit, held: holds.heldByPlacement.has(`U:${String(unit.physicalUnitId)}:${String(unit.cellIds?.[0] ?? '')}`) || holds.allocations.some((x: Plain) => String(x.physicalUnitId) === String(unit.physicalUnitId)) })) };
  return { replay, projection, requests, events, movements, holds, customerProjection };
}

async function reservationFor(item: Plain, actor: Actor, session?: ClientSession, requireActive = true) {
  const now = new Date(); const query = ReservationModel.findOne({ _id: item.managedReservationId, customerId: actor._id, facilityId: item.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, ...(requireActive ? { status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now }, handoverAt: { $exists: true, $ne: null } } : {}) });
  if (session) query.session(session);
  const reservation: any = await query.exec();
  if (!reservation) fail(409, 'RENTAL_NOT_ACTIVE', 'Reservation phải thuộc Customer và Facility này, ở trạng thái ACTIVE sau Handover và còn trong kỳ thuê.');
  return reservation;
}
async function facilityFor(item: Plain, session?: ClientSession) {
  const query = FacilityModel.findOne({ _id: item.facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).select('_id'); if (session) query.session(session);
  if (!await query.lean().exec()) fail(409, 'FACILITY_UNAVAILABLE', 'Facility Managed Inventory không khả dụng.');
}
async function assertFacilityCapacityReconciled(facilityId: Types.ObjectId, targetReservationId: Types.ObjectId, session: ClientSession) {
  const items = await Item.find({ facilityId }).session(session).select('_id customerId managedReservationId inventorySchemaVersion currentCellId status currentPlacementMovementId').limit(5001).lean().exec();
  if (items.length > 5000) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', 'Số SKU của Facility vượt giới hạn đối soát an toàn.');
  const itemIds = items.map((row: Plain) => row._id);
  const movementCount = await Movement.countDocuments({ facilityId, itemId: { $in: itemIds } }).session(session).exec();
  if (movementCount > 100_000) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', 'Lịch sử Movement của Facility vượt giới hạn đối soát an toàn.');
  const movements = await Movement.find({ facilityId, itemId: { $in: itemIds } }).sort({ performedAt: 1, _id: 1 }).session(session).lean().exec();
  const byItem = new Map<string, Plain[]>();
  for (const row of movements) { const list = byItem.get(String(row.itemId)) ?? []; list.push(row); byItem.set(String(row.itemId), list); }
  const usage = new Map<string, { weight: number; volume: number }>(), reservationVolumes = new Map<string, number>();
  const addCell = (cellId: unknown, weight: number, volume: number) => {
    const key = String(cellId), current = usage.get(key) ?? { weight: 0, volume: 0 }; current.weight += weight; current.volume += volume; usage.set(key, current);
  };
  for (const item of items as Plain[]) {
    const history = byItem.get(String(item._id)) ?? [];
    let stock: Plain = {};
    if (item.inventorySchemaVersion === 3) {
      let replay: Plain = {};
      try { replay = replayManagedInventoryV3(item, history.filter(row => row.schemaVersion === 3)); } catch { fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `V3 ledger của SKU ${item._id} không thể đối soát.`); }
      const stored = await Projection.findOne({ skuId: item._id, facilityId }).session(session).lean().exec();
      if (replay.ledgerRevision > 0 && (!stored || stable(projectionComparable(stored)) !== stable(projectionComparable(replay)))) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Projection của SKU ${item._id} không khớp ledger.`);
      if (replay.ledgerRevision === 0 && stored && stable(projectionComparable(stored)) !== stable(projectionComparable(replay))) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Projection rỗng của SKU ${item._id} không khớp ledger.`);
      for (const line of replay.byCell) addCell(line.cellId, line.weightKg, line.volumeM3);
      stock = replay;
    } else {
      try { stock = reconcileManagedItemStock(item, history); } catch { fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Legacy ledger của SKU ${item._id} không thể đối soát.`); }
      if (stock.onHandQuantity > 0) {
        if (!stock.currentCellId || stock.actualTotalWeightKg == null || stock.actualTotalVolumeM3 == null) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Legacy placement của SKU ${item._id} thiếu dữ liệu.`);
        addCell(stock.currentCellId, stock.actualTotalWeightKg, stock.actualTotalVolumeM3);
      }
    }
    const reservationKey = String(item.managedReservationId); reservationVolumes.set(reservationKey, (reservationVolumes.get(reservationKey) ?? 0) + Number(stock.actualTotalVolumeM3 ?? stock.totalVolumeM3 ?? 0));
  }
  const cells = await Cell.find({ facilityId, deletedAt: { $exists: false } }).session(session).select('_id rackId levelNumber maxWeightKg usedWeightKg usedVolumeM3 managedInventoryRevision').lean().exec();
  const cellMap = new Map<string, Plain>((cells as Plain[]).map((row: Plain) => [String(row._id), row]));
  for (const cell of cells as Plain[]) {
    const expected = usage.get(String(cell._id)) ?? { weight: 0, volume: 0 };
    if (![cell.usedWeightKg, cell.usedVolumeM3, cell.maxWeightKg].every(Number.isFinite) || cell.usedWeightKg < 0 || cell.usedVolumeM3 < 0 ||
        Math.abs(cell.usedWeightKg - money(expected.weight, 3)) > 0.001 || Math.abs(cell.usedVolumeM3 - money(expected.volume, 6)) > 0.000001) {
      fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Counter của Cell ${cell._id} không khớp tổng physical stock.`);
    }
  }
  for (const id of usage.keys()) if (!cellMap.has(id)) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Movement tham chiếu Cell không tồn tại: ${id}.`);
  const racks = await Rack.find({ facilityId, deletedAt: { $exists: false } }).session(session).select('_id maxWeightKgPerLevel').lean().exec();
  const rackById = new Map<string, Plain>((racks as Plain[]).map((row: Plain) => [String(row._id), row]));
  const levelTotals = new Map<string, number>();
  for (const cell of cells as Plain[]) { const key = `${cell.rackId}:${cell.levelNumber}`; levelTotals.set(key, (levelTotals.get(key) ?? 0) + Number(cell.usedWeightKg)); }
  for (const [key, weight] of levelTotals) { const rackId = key.split(':')[0]!, rack = rackById.get(rackId); if (!rack || !Number.isFinite(rack.maxWeightKgPerLevel) || weight > rack.maxWeightKgPerLevel + 0.001) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Rack/Level ${key} thiếu giới hạn hoặc vượt tải.`); }
  const reservation = await ReservationModel.findOne({ _id: targetReservationId, facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY }).session(session).select('_id usedCapacityM3').lean().exec();
  const expectedReservationVolume = money(reservationVolumes.get(String(targetReservationId)) ?? 0, 6);
  if (!reservation || !Number.isFinite(Number(reservation.usedCapacityM3)) || Math.abs(Number(reservation.usedCapacityM3) - expectedReservationVolume) > 0.000001) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', 'Reservation usedCapacityM3 không khớp toàn bộ legacy và V3 stock.');
  return { cells: cellMap, reservationVolumeM3: expectedReservationVolume };
}
async function ownedItem(itemId: unknown, actor: Actor, session?: ClientSession) {
  const id = itemId instanceof Types.ObjectId ? itemId : oid(itemId, 'skuId');
  const query = Item.findOne({ _id: id, customerId: actor._id, inventorySchemaVersion: 3, deletedAt: { $exists: false } }); if (session) query.session(session);
  const item = await query.exec(); if (!item) fail(404, 'INVENTORY_ITEM_NOT_FOUND', 'Không tìm thấy SKU.'); return item;
}
function requestSnapshot(request: Plain) { return { requestId: String(request._id), skuId: String(request.skuId), reservationId: String(request.reservationId), facilityId: String(request.facilityId),
  itemKind: request.itemKind, requestedQuantity: request.requestedQuantity, quantityUnit: request.quantityUnit, allocations: request.allocations, sourceCellIds: [...new Set((request.allocations ?? []).map((x: Plain) => String(x.cellId)))].sort(),
  state: request.state, version: request.version, createdAt: request.createdAt, ...(request.cancelledAt ? { cancelledAt: request.cancelledAt } : {}),
  ...(request.confirmedAt ? { confirmedAt: request.confirmedAt, confirmedMovementId: String(request.confirmedMovementId), confirmedBy: String(request.confirmedBy) } : {}) };
}
async function staffVisitScope(actor: Actor) {
  const now = new Date();
  const [currentVisits, sessions] = await Promise.all([
    Visit.find({ facilityId: actor.assignedFacilityId, assignedStaffId: actor._id, purpose: 'OUTBOUND', status: { $in: ['SCHEDULED', 'CHECKED_IN'] }, endsAt: { $gte: now } })
      .select('_id reservationId customerId facilityId purpose startsAt endsAt status assignedStaffId').limit(1001).lean().exec(),
    AccessSession.find({ facilityId: actor.assignedFacilityId, assignedStaffId: actor._id, allowedPurposes: 'OUTBOUND' })
      .select('_id visitId reservationId customerId facilityId assignedStaffId allowedCellIds allowedPurposes status').limit(1001).lean().exec(),
  ]);
  if (currentVisits.length > 1000 || sessions.length > 1000) fail(503, 'STAFF_OUTBOUND_SCOPE_TOO_LARGE', 'Phạm vi Visit/Session của Staff vượt giới hạn truy vấn an toàn.');
  const visitIds = [...new Set((sessions as Plain[]).map(row => String(row.visitId)))].map(value => new Types.ObjectId(value));
  const historicalVisits = visitIds.length ? await Visit.find({ _id: { $in: visitIds }, facilityId: actor.assignedFacilityId, purpose: 'OUTBOUND', status: { $in: ['CHECKED_IN', 'COMPLETED'] } })
    .select('_id reservationId customerId facilityId purpose startsAt endsAt status assignedStaffId').limit(1001).lean().exec() : [];
  if (historicalVisits.length > 1000) fail(503, 'STAFF_OUTBOUND_SCOPE_TOO_LARGE', 'Lịch sử Visit của Staff vượt giới hạn truy vấn an toàn.');
  const visitsById = new Map([...(currentVisits as Plain[]), ...(historicalVisits as Plain[])].map(row => [String(row._id), row]));
  const scopedSessions = (sessions as Plain[]).filter(row => visitsById.has(String(row.visitId)));
  return { visits: [...visitsById.values()], sessions: scopedSessions, now };
}
async function staffCanReadRequest(request: Plain, actor: Actor) {
  const scope = await staffVisitScope(actor), movement = request.confirmedMovementId ? await Movement.findOne({ _id: request.confirmedMovementId, facilityId: actor.assignedFacilityId,
    itemId: request.skuId, schemaVersion: 3, 'v3Effect.action': 'REMOVE' }).lean().exec() : null;
  return staffCanReadManagedV3OutboundRequest({ request, ...scope, movements: movement ? [movement] : [], actorId: String(actor._id), facilityId: String(actor.assignedFacilityId) });
}

export class ManagedInventoryV3OutboundService {
  static async stock(itemId: unknown, actor: Actor) {
    requireCustomer(actor); const item = await ownedItem(itemId, actor); await reservationFor(item, actor, undefined, false);
    return (await readState(item)).customerProjection;
  }
  static async context(itemId: unknown, actor: Actor) {
    requireCustomer(actor); const item = await ownedItem(itemId, actor); const reservation: any = await reservationFor(item, actor, undefined, false); await facilityFor(item);
    const state = await readState(item);
    return { sku: { id: String(item._id), itemCode: item.itemCode, name: item.name, category: item.category, images: item.images ?? [], quantityUnit: item.quantityUnit },
      reservation: { id: String(reservation._id), reservationCode: reservation.reservationCode, facilityId: String(reservation.facilityId), status: reservation.status },
      stock: state.customerProjection, pendingRequestIds: state.holds.pendingRequestIds, ledgerRevision: state.replay.ledgerRevision,
      inventoryRevision: item.managedV3Revision ?? 0, reconciliation: state.projection ? 'RECONCILED_TO_SKU_LEDGER_AND_PROJECTION' : 'NO_PHYSICAL_INBOUND' };
  }
  static async create(itemIdInput: unknown, body: unknown, idempotencyKeyInput: unknown, actor: Actor) {
    requireCustomer(actor); const itemId = oid(itemIdInput, 'skuId'), keyValue = key(idempotencyKeyInput);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Plain).some(k => k !== 'requestedQuantity' && k !== 'itemKind') ||
        !Object.hasOwn(body, 'requestedQuantity') || !Object.hasOwn(body, 'itemKind')) fail(422, 'INVALID_OUTBOUND_REQUEST', 'Payload chỉ gồm itemKind và requestedQuantity.');
    const input = body as Plain;
    if (!['A1_PHYSICAL_UNIT', 'A2_BATCH'].includes(input.itemKind) || !Number.isSafeInteger(input.requestedQuantity) || input.requestedQuantity < 1) fail(422, 'INVALID_OUTBOUND_REQUEST', 'Loại hàng hoặc số lượng không hợp lệ.');
    await ownedItem(itemId, actor);
    const requestHash = hash({ skuId: String(itemId), itemKind: input.itemKind, requestedQuantity: input.requestedQuantity });
    const prior = await Event.findOne({ skuId: itemId, operation: 'CREATE', idempotencyKey: keyValue }).lean().exec();
    if (prior) { if (prior.requestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được sử dụng với nội dung khác.'); const existing = await Request.findOne({ _id: prior.requestId, customerId: actor._id }).lean().exec(); if (!existing) fail(503, 'OUTBOUND_REQUEST_HISTORY_UNKNOWN', 'Event yêu cầu tồn tại nhưng Request chưa đọc được.'); return { data: requestSnapshot(existing), replayed: true }; }
    try {
      const data = await withTransaction(async session => {
        const current = await ownedItem(itemId, actor, session);
        const locked = await Item.findOneAndUpdate({ _id: itemId, customerId: actor._id, inventorySchemaVersion: 3,
          managedReservationId: current.managedReservationId, facilityId: current.facilityId, managedV3Revision: current.managedV3Revision ?? 0, deletedAt: { $exists: false } },
        { $inc: { managedV3Revision: 1 } }, { new: true, session }).exec();
        if (!locked) fail(409, 'STALE_INVENTORY_REVISION', 'SKU vừa thay đổi; tải lại tồn kho rồi thử lại.');
        await reservationFor(locked, actor, session); await facilityFor(locked, session);
        const state = await readState(locked, session);
        if (state.holds.pendingRequestIds.length) fail(409, 'OUTBOUND_REQUEST_PENDING', 'SKU đã có một yêu cầu xuất đang giữ hàng. Hãy hoàn tất hoặc hủy yêu cầu đó trước.');
        if (state.replay.onHandQuantity === 0 || state.customerProjection.availableQuantity === 0) fail(409, 'OUTBOUND_NO_PHYSICAL_STOCK', 'SKU chưa có tồn vật lý đã đối soát. Hãy hoàn tất Self-Inbound trước khi tạo yêu cầu xuất.');
        if (input.requestedQuantity > state.customerProjection.availableQuantity) fail(409, 'OUTBOUND_QUANTITY_UNAVAILABLE', 'Số lượng yêu cầu vượt tồn khả dụng thực tế.');
        await assertFacilityCapacityReconciled(locked.facilityId, locked.managedReservationId, session);
        let allocations: ManagedV3OutboundAllocation[];
        if (input.itemKind === 'A2_BATCH') allocations = allocateManagedV3Fifo(state.replay, input.requestedQuantity);
        else {
          if (input.requestedQuantity > state.replay.byPhysicalUnit.length) fail(409, 'OUTBOUND_QUANTITY_UNAVAILABLE', 'Không đủ PhysicalUnit nguyên vẹn để xuất.');
          const units = [...state.replay.byPhysicalUnit].sort((a: Plain, b: Plain) => new Date(a.receivedAt ?? 0).getTime() - new Date(b.receivedAt ?? 0).getTime() || String(a.sourceMovementId ?? a.physicalUnitId).localeCompare(String(b.sourceMovementId ?? b.physicalUnitId)) || String(a.physicalUnitId).localeCompare(String(b.physicalUnitId))).slice(0, input.requestedQuantity);
          allocations = [];
          for (const unit of units as Plain[]) {
            if (unit.cellIds.length !== 1) fail(409, 'A1_LOAD_SHARING_UNCERTIFIED', 'A1 nhiều Cell đang bị khóa vì mô hình topology hiện không lưu chứng nhận load-sharing có thể xác minh.');
            const receipt = await Movement.findOne({ _id: unit.sourceMovementId, itemId, schemaVersion: 3, 'v3Effect.action': 'ADD', 'v3Effect.itemKind': 'A1_PHYSICAL_UNIT' }).session(session).lean().exec();
            if (!receipt) fail(409, 'A1_FOOTPRINT_UNKNOWN', 'Không thể chứng minh receipt và footprint của PhysicalUnit.');
            const currentFootprint = currentManagedV3A1Footprint(state.movements, String(unit.physicalUnitId));
            for (const line of currentFootprint) allocations.push({ ...line, itemKind: 'A1_PHYSICAL_UNIT', receiptMovementId: receipt._id } as ManagedV3OutboundAllocation);
          }
          try { assertManagedV3A1OutboundFootprints(allocations as Plain[]); }
          catch (error: any) { fail(409, error.code ?? 'A1_FOOTPRINT_UNKNOWN', 'Footprint A1 chưa đủ bằng chứng để xuất an toàn.'); }
        }
        const reservation: any = await reservationFor(locked, actor, session);
        const cellIds = [...new Set(allocations.map(row => String(row.cellId)))].map(id => new Types.ObjectId(id));
        for (const cellId of cellIds) {
          if (!(reservation.allocatedCellIds ?? []).some((id: Types.ObjectId) => same(id, cellId))) fail(409, 'SOURCE_CELL_NOT_ALLOCATED', 'Nguồn hàng không nằm trong Cell được Reservation cấp.');
          const allocationRow = await Allocation.findOne({ cellId, reservationId: reservation._id, facilityId: locked.facilityId, customerId: actor._id, status: CellAllocationStatus.OCCUPIED }).session(session).lean().exec();
          if (!allocationRow) fail(409, 'SOURCE_CELL_NOT_OWNED', 'Cell nguồn không còn được Reservation này chiếm dụng.');
        }
        if (input.itemKind === 'A1_PHYSICAL_UNIT') for (const line of allocations) {
          const certificate = await Topology.findOne({ _id: line.topologyCertificationId, facilityId: locked.facilityId, certificationState: 'CERTIFIED', revision: line.topologyRevision,
            provenance: 'FACILITY_SURVEY', supportSurfaceId: { $exists: true, $ne: '' }, certifiedAt: { $lte: new Date() }, expiresAt: { $gt: new Date() },
            'cells.cellId': line.cellId }).session(session).lean().exec();
          if (!certificate) fail(409, 'A1_TOPOLOGY_UNCERTIFIED', 'A1 source Cell không có topology certification Facility còn hiệu lực.');
        }
        const request = new Request({ skuId: itemId, reservationId: locked.managedReservationId, customerId: actor._id, facilityId: locked.facilityId,
          itemKind: input.itemKind, requestedQuantity: input.requestedQuantity, quantityUnit: allocations[0]?.quantityUnit, allocations,
          state: ManagedV3OutboundState.PENDING, version: 0, idempotencyKey: keyValue, requestHash, createdAt: new Date() });
        await request.save({ session });
        await new Event({ requestId: request._id, skuId: itemId, reservationId: request.reservationId, customerId: actor._id, facilityId: locked.facilityId,
          actorId: actor._id, operation: ManagedV3OutboundOperation.CREATE, idempotencyKey: keyValue, requestHash, resultingState: request.state,
          resultingVersion: 0, allocationSnapshot: allocations, occurredAt: request.createdAt }).save({ session });
        return requestSnapshot(request.toObject());
      });
      return { data, replayed: false };
    } catch (error: any) {
      if (error?.code === 11000) {
        const event = await Event.findOne({ skuId: itemId, operation: 'CREATE', idempotencyKey: keyValue }).lean().exec().catch(() => null);
        if (event?.requestHash === requestHash) {
          const existing = await Request.findOne({ _id: event.requestId, customerId: actor._id }).lean().exec();
          if (!existing) fail(503, 'OUTBOUND_REQUEST_HISTORY_UNKNOWN', 'Event yêu cầu tồn tại nhưng Request chưa đọc được.');
          return { data: requestSnapshot(existing), replayed: true };
        }
        if (event) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key hoặc request đang hoạt động đã xung đột.');
        fail(409, 'OUTBOUND_REQUEST_PENDING', 'SKU đã có yêu cầu xuất PENDING hoặc khóa duy nhất đang tranh chấp. Tải lại lịch sử trước khi thử lại.');
      }
      if (error instanceof ManagedV3OutboundError) throw error;
      if (error instanceof ManagedV3OutboundDomainError) fail(409, error.code, error.message);
      if (error instanceof ManagedAccessError) fail(error.status, error.code, error.message);
      if (errorLabel(error, 'UnknownTransactionCommitResult')) fail(503, 'OUTBOUND_REQUEST_OUTCOME_UNKNOWN', 'Kết quả tạo yêu cầu chưa xác định; tra cứu lại bằng Idempotency-Key, không tạo key mới.');
      throw error;
    }
  }

  static async listForItem(itemIdInput: unknown, query: unknown, actor: Actor) {
    requireCustomer(actor); const itemId = oid(itemIdInput, 'skuId');
    const item = await ownedItem(itemId, actor); await reservationFor(item, actor, undefined, false);
    const raw = query && typeof query === 'object' && !Array.isArray(query) ? query as Plain : {};
    if (Object.keys(raw).some(k => !['page', 'limit', 'state'].includes(k))) fail(400, 'INVALID_PAGINATION', 'Bộ lọc yêu cầu không hợp lệ.');
    const page = raw.page === undefined ? 1 : Number(raw.page), limit = raw.limit === undefined ? 20 : Number(raw.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (raw.state && !Object.values(ManagedV3OutboundState).includes(raw.state))) fail(400, 'INVALID_PAGINATION', 'Trang, giới hạn hoặc trạng thái không hợp lệ.');
    const filter: Plain = { skuId: itemId, customerId: actor._id }; if (raw.state) filter.state = raw.state;
    const [rows, total] = await Promise.all([Request.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(), Request.countDocuments(filter).exec()]);
    return { data: rows.map(requestSnapshot), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  static async get(requestIdInput: unknown, actor: Actor) {
    requireCustomer(actor); const request = await Request.findOne({ _id: oid(requestIdInput, 'requestId'), customerId: actor._id }).lean().exec();
    if (!request) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu xuất.');
    const item = await ownedItem(String(request.skuId), actor); const state = await readState(item);
    return { ...requestSnapshot(request), stock: state.customerProjection };
  }
  static async cancel(requestIdInput: unknown, ifMatch: unknown, keyInput: unknown, actor: Actor) {
    requireCustomer(actor); const requestId = oid(requestIdInput, 'requestId'), expected = version(ifMatch), keyValue = key(keyInput);
    const current = await Request.findOne({ _id: requestId, customerId: actor._id }).lean().exec(); if (!current) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu xuất.');
    const requestHash = hash({ requestId: String(requestId), operation: 'CANCEL', expectedVersion: expected });
    const prior = await Event.findOne({ skuId: current.skuId, operation: 'CANCEL', idempotencyKey: keyValue }).lean().exec();
    if (prior) { if (prior.requestHash !== requestHash || !same(prior.requestId, requestId)) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với yêu cầu khác.'); return { data: requestSnapshot(await Request.findById(requestId).lean().exec()), replayed: true }; }
    try {
      const data = await withTransaction(async session => {
        const item = await ownedItem(String(current.skuId), actor, session);
        const locked = await Item.findOneAndUpdate({ _id: item._id, inventorySchemaVersion: 3, managedV3Revision: item.managedV3Revision ?? 0 }, { $inc: { managedV3Revision: 1 } }, { new: true, session }).exec();
        if (!locked) fail(409, 'STALE_INVENTORY_REVISION', 'Tồn kho vừa thay đổi; tải lại trước khi hủy.');
        const state = await readState(locked, session);
        if (!state.holds.pendingRequestIds.includes(String(requestId))) fail(409, 'OUTBOUND_HOLDS_UNKNOWN', 'Yêu cầu không còn được hold bởi event history authoritative.');
        const request = await Request.findOneAndUpdate({ _id: requestId, customerId: actor._id, state: ManagedV3OutboundState.PENDING, version: expected },
          { $set: { state: ManagedV3OutboundState.CANCELLED, cancelledAt: new Date() }, $inc: { version: 1 } }, { new: true, runValidators: true, session }).exec();
        if (!request) fail(412, 'STALE_OUTBOUND_REQUEST', 'Yêu cầu đã thay đổi hoặc không còn PENDING. Tải lại trước khi thử lại.');
        await new Event({ requestId, skuId: request.skuId, reservationId: request.reservationId, customerId: request.customerId, facilityId: request.facilityId,
          actorId: actor._id, operation: ManagedV3OutboundOperation.CANCEL, idempotencyKey: keyValue, requestHash,
          resultingState: request.state, resultingVersion: request.version, allocationSnapshot: request.allocations, occurredAt: request.cancelledAt }).save({ session });
        return requestSnapshot(request.toObject());
      });
      return { data, replayed: false };
    } catch (error: any) { if (error instanceof ManagedV3OutboundError) throw error; if (errorLabel(error, 'UnknownTransactionCommitResult')) fail(503, 'OUTBOUND_CANCEL_OUTCOME_UNKNOWN', 'Kết quả hủy chưa xác định; hãy đối soát cùng Idempotency-Key.'); throw error; }
  }

  static async preview(requestIdInput: unknown, body: unknown, actor: Actor) {
    requireCustomer(actor); const requestId = oid(requestIdInput, 'requestId');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Plain).some(k => !['accessSessionId', 'sessionRevision'].includes(k)) ||
        typeof (body as Plain).accessSessionId !== 'string' || !Number.isSafeInteger((body as Plain).sessionRevision)) fail(422, 'INVALID_OUTBOUND_PREVIEW', 'Preview cần Access Session ID và revision hợp lệ.');
    const input = body as Plain, request = await Request.findOne({ _id: requestId, customerId: actor._id }).lean().exec();
    if (!request) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu xuất.');
    const item = await ownedItem(String(request.skuId), actor); await reservationFor(item, actor, undefined, false);
    const state = await readState(item);
    if (request.state !== ManagedV3OutboundState.PENDING || !state.holds.pendingRequestIds.includes(String(requestId))) fail(409, 'OUTBOUND_REQUEST_NOT_PENDING', 'Yêu cầu không còn giữ hàng để xuất.');
    {
      const sessionId = oid(input.accessSessionId, 'accessSessionId'), session = await AccessSession.findOne({ _id: sessionId, customerId: actor._id,
        reservationId: request.reservationId, facilityId: request.facilityId }).lean().exec();
      const visit = session ? await Visit.findOne({ _id: session.visitId, customerId: actor._id, reservationId: request.reservationId,
        facilityId: request.facilityId, status: 'CHECKED_IN', purpose: 'OUTBOUND' }).select('_id').lean().exec() : null;
      if (!session || session.status !== 'ACTIVE' || new Date(session.startedAt) > new Date() || new Date(session.expiresAt) <= new Date() ||
          !visit || !(session.allowedPurposes ?? []).includes('OUTBOUND') || request.allocations.some((row: Plain) => !(session.allowedCellIds ?? []).some((id: any) => same(id, row.cellId)))) {
        fail(409, 'ACCESS_SESSION_SCOPE_INVALID', 'Access Session chưa ACTIVE, hết hạn hoặc sai Customer/Reservation/Facility/purpose/Cell.');
      }
      if (!Number.isSafeInteger(input.sessionRevision) || input.sessionRevision !== session.revision) fail(412, 'STALE_ACCESS_SESSION', 'Access Session vừa thay đổi; tải lại trước khi preview.');
    }
    const totalWeightKg = money(request.allocations.reduce((n: number, row: Plain) => n + row.weightKg, 0), 3);
    const totalVolumeM3 = money(request.allocations.reduce((n: number, row: Plain) => n + row.volumeM3, 0), 6);
    return { sku: { id: String(item._id), itemCode: item.itemCode, name: item.name, images: item.images ?? [] }, stock: state.customerProjection,
      request: requestSnapshot(request), outboundPlan: { quantity: request.requestedQuantity, quantityUnit: request.quantityUnit,
        allocations: request.allocations, sourceCellIds: requestSnapshot(request).sourceCellIds, totalWeightKg, totalVolumeM3 },
      accessSession: { id: String(input.accessSessionId), purpose: 'OUTBOUND', expiresAt: (await AccessSession.findById(input.accessSessionId).select('expiresAt').lean().exec())?.expiresAt },
      ledgerRevision: state.replay.ledgerRevision, inventoryRevision: item.managedV3Revision ?? 0, physicalConfirmationRequired: true,
      note: 'Preview không xác nhận xuất và không thay đổi tồn kho.' };
  }

  static async confirm(requestIdInput: unknown, body: unknown, idempotencyInput: unknown, ifMatch: unknown, actor: Actor) {
    requireCustomer(actor); const requestId = oid(requestIdInput, 'requestId'), expectedVersion = version(ifMatch), keyValue = key(idempotencyInput);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Plain).some(k => !['accessSessionId', 'sessionRevision', 'physicalRemovalConfirmed', 'attestation'].includes(k))) fail(422, 'INVALID_OUTBOUND_CONFIRMATION', 'Payload xác nhận xuất không hợp lệ.');
    const input = body as Plain;
    if (typeof input.accessSessionId !== 'string' || !Number.isSafeInteger(input.sessionRevision) || input.physicalRemovalConfirmed !== true ||
        typeof input.attestation !== 'string' || input.attestation.trim().length < 10 || input.attestation.length > 500) fail(422, 'CUSTOMER_ATTESTATION_REQUIRED', 'Cần Session OUTBOUND hợp lệ và xác nhận rõ rằng Customer đã thực tế lấy đúng hàng.');
    const sessionId = oid(input.accessSessionId, 'accessSessionId'), request = await Request.findOne({ _id: requestId, customerId: actor._id }).lean().exec();
    if (!request) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu xuất.');
    const operationHash = hash({ requestId: String(requestId), sessionId: String(sessionId), sessionRevision: input.sessionRevision,
      physicalRemovalConfirmed: true, attestation: input.attestation.trim(), expectedVersion });
    const prior = await Event.findOne({ skuId: request.skuId, operation: ManagedV3OutboundOperation.CONFIRM, idempotencyKey: keyValue, actorId: actor._id }).lean().exec();
    if (prior) {
      if (prior.requestHash !== operationHash || !same(prior.requestId, requestId)) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã được dùng với xác nhận khác.');
      return { data: { ...requestSnapshot(await Request.findById(requestId).lean().exec()), movementId: String(prior.movementId), outcome: 'COMMITTED' }, replayed: true };
    }
    try {
      const result = await withTransaction(async session => {
        const currentItem = await ownedItem(String(request.skuId), actor, session);
        const lockedItem = await Item.findOneAndUpdate({ _id: currentItem._id, customerId: actor._id, inventorySchemaVersion: 3,
          managedV3Revision: currentItem.managedV3Revision ?? 0, deletedAt: { $exists: false } }, { $inc: { managedV3Revision: 1 } }, { new: true, session }).exec();
        if (!lockedItem) fail(409, 'STALE_INVENTORY_REVISION', 'Tồn kho đã thay đổi sau Preview; tải lại và preview lại.');
        const reservation: any = await reservationFor(lockedItem, actor, session); await facilityFor(lockedItem, session);
        const currentRequest = await Request.findOne({ _id: requestId, customerId: actor._id, skuId: lockedItem._id }).session(session).exec();
        if (!currentRequest || currentRequest.state !== ManagedV3OutboundState.PENDING) fail(409, 'OUTBOUND_REQUEST_NOT_PENDING', 'Yêu cầu đã được xử lý hoặc hủy.');
        if (currentRequest.version !== expectedVersion) fail(412, 'STALE_OUTBOUND_REQUEST', 'Revision yêu cầu xuất đã thay đổi; tải lại và preview lại.');
        if (currentRequest.itemKind === 'A1_PHYSICAL_UNIT') {
          try { assertManagedV3A1OutboundFootprints(currentRequest.allocations as Plain[]); }
          catch (error: any) { fail(409, error.code ?? 'A1_FOOTPRINT_UNKNOWN', 'Footprint A1 chưa đủ bằng chứng để xác nhận xuất an toàn.'); }
        }
        const state = await readState(lockedItem, session);
        if (state.holds.pendingRequestIds.length !== 1 || state.holds.pendingRequestIds[0] !== String(requestId)) fail(409, 'OUTBOUND_HOLDS_UNKNOWN', 'Hold của yêu cầu không khớp nguồn authoritative.');
        const cellIds = [...new Set((currentRequest.allocations as Plain[]).map(row => String(row.cellId)))].map(value => new Types.ObjectId(value));
        try { await assertManagedAccessSessionScope({ sessionId, customerId: actor._id, reservationId: reservation._id, facilityId: reservation.facilityId,
          purpose: 'OUTBOUND' as any, cellIds, expectedRevision: input.sessionRevision, dbSession: session }); }
        catch (error: any) { if (error instanceof ManagedAccessError) fail(error.status, error.code, error.message); throw error; }
        const capacities = await assertFacilityCapacityReconciled(lockedItem.facilityId, reservation._id, session);
        const byCell = new Map<string, { weight: number; volume: number; id: Types.ObjectId }>();
        for (const line of currentRequest.allocations as Plain[]) {
          const key = String(line.cellId), value = byCell.get(key) ?? { weight: 0, volume: 0, id: line.cellId };
          value.weight += Number(line.weightKg); value.volume += Number(line.volumeM3); byCell.set(key, value);
          const owned = (reservation.allocatedCellIds ?? []).some((id: Types.ObjectId) => same(id, line.cellId));
          const allocation = await Allocation.findOne({ cellId: line.cellId, reservationId: reservation._id, customerId: actor._id, facilityId: reservation.facilityId, status: CellAllocationStatus.OCCUPIED }).session(session).lean().exec();
          if (!owned || !allocation) fail(409, 'SOURCE_CELL_NOT_OWNED', 'Cell nguồn không còn được Reservation này cấp và chiếm dụng.');
          const certificate = await Topology.findOne({ _id: line.topologyCertificationId, facilityId: reservation.facilityId, certificationState: 'CERTIFIED', revision: line.topologyRevision,
            certifiedAt: { $lte: new Date() }, expiresAt: { $gt: new Date() }, ...(line.itemKind === 'A1_PHYSICAL_UNIT' ? { provenance: 'FACILITY_SURVEY', supportSurfaceId: { $exists: true, $ne: '' }, 'cells.cellId': line.cellId } : {}) }).session(session).lean().exec();
          if (!certificate) fail(409, 'SOURCE_TOPOLOGY_UNCERTIFIED', 'Chứng nhận topology nguồn không còn hiệu lực; cần kiểm tra Facility.');
        }
        const now = new Date(), movementId = new Types.ObjectId();
        const source: Plain[] = (currentRequest.allocations as Plain[]).map(row => ({ ...(typeof row.toObject === 'function' ? row.toObject() : row), cellId: row.cellId, physicalUnitId: row.physicalUnitId ?? undefined,
          batchId: row.batchId ?? undefined, receiptMovementId: row.receiptMovementId ?? undefined }));
        if (!source.length) fail(409, 'OUTBOUND_ALLOCATION_UNKNOWN', 'Yêu cầu không có phân bổ nguồn hàng đã đối soát.');
        const totalWeightKg = money(source.reduce((n, row) => n + row.weightKg, 0), 3), totalVolumeM3 = money(source.reduce((n, row) => n + row.volumeM3, 0), 6);
        const quantity = Number(currentRequest.requestedQuantity), dimensions = lockedItem.unitDimensionsM;
        if (!dimensions || ![dimensions.widthM, dimensions.depthM, dimensions.heightM].every((x: number) => Number.isFinite(x) && x > 0)) fail(409, 'ITEM_DIMENSIONS_UNKNOWN', 'Kích thước SKU không đủ để ghi canonical REMOVE.');
        const operationId = `outbound:${String(requestId)}`;
        const movementRows = await Movement.create([{ _id: movementId, itemId: lockedItem._id, managedReservationId: reservation._id, facilityId: reservation.facilityId, customerId: actor._id,
          type: ItemMovementType.OUTBOUND, sourceCellId: null, destinationCellId: null, previousPlacementMovementId: state.replay.lastMovementId,
          quantity, quantityUnit: currentRequest.quantityUnit, actualUnitWeightKg: money(totalWeightKg / quantity, 3), actualTotalWeightKg: totalWeightKg,
          actualUnitDimensionsM: dimensions, actualTotalVolumeM3: totalVolumeM3, performedBy: actor._id, performedAt: now,
          handoverNote: 'Customer attestation in Staff-supervised OUTBOUND Access Session.', idempotencyKey: keyValue,
          schemaVersion: 3, operationId, v3Effect: { action: 'REMOVE', itemKind: currentRequest.itemKind, operationId, requestHash: operationHash,
            accessSessionId: sessionId, inventoryRevision: lockedItem.managedV3Revision, ledgerRevision: state.replay.ledgerRevision + 1,
            topologyCertificationId: source[0]!.topologyCertificationId, topologyRevision: source[0]!.topologyRevision, correlationId: randomUUID(), source,
            customerAttestation: { customerId: actor._id, attestedAt: now, statement: input.attestation.trim() } } }], { session });
        const movement = movementRows[0];
        for (const line of source) {
          if (line.itemKind === 'A2_BATCH') {
            const placement = await BatchPlacement.findOne({ skuId: lockedItem._id, reservationId: reservation._id, customerId: actor._id, facilityId: reservation.facilityId,
              batchId: line.batchId, cellId: line.cellId, receiptMovementId: line.receiptMovementId, state: 'ACTIVE' }).session(session).exec();
            if (!placement || placement.quantity < line.quantity) fail(409, 'SOURCE_PLACEMENT_MISMATCH', 'BatchPlacement đã thay đổi hoặc không còn đủ tồn.');
            const amounts = canonicalA2RemovalAmounts(placement, line.quantity);
            if (amounts.removedWeightKg !== line.weightKg || amounts.removedVolumeM3 !== line.volumeM3) fail(409, 'SOURCE_PLACEMENT_MISMATCH', 'Physical metrics của hold không còn khớp placement.');
            placement.quantity = amounts.remainingQuantity; placement.weightKg = amounts.remainingWeightKg; placement.volumeM3 = amounts.remainingVolumeM3;
            placement.sourceMovementId = movement._id; placement.state = amounts.remainingQuantity === 0 ? 'DEPLETED' : 'ACTIVE'; placement.revision += 1;
            await placement.save({ session });
          }
        }
        if (currentRequest.itemKind === 'A1_PHYSICAL_UNIT') {
          const unitIds = [...new Set(source.map(row => String(row.physicalUnitId)))].map(value => new Types.ObjectId(value));
          for (const unitId of unitIds) {
            const footprint = await Footprint.findOne({ physicalUnitId: unitId, reservationId: reservation._id, customerId: actor._id, facilityId: reservation.facilityId, state: 'ACTIVE' }).session(session).exec();
            const unit = await PhysicalUnit.findOne({ _id: unitId, skuId: lockedItem._id, reservationId: reservation._id, customerId: actor._id, facilityId: reservation.facilityId, state: 'PLACED' }).session(session).exec();
            if (!footprint || !unit || stable(footprint.cells.map((x: Plain) => String(x.cellId)).sort()) !== stable(source.filter(row => String(row.physicalUnitId) === String(unitId)).map(row => String(row.cellId)).sort())) fail(409, 'A1_FOOTPRINT_MISMATCH', 'PhysicalUnit phải được xuất nguyên vẹn cùng toàn bộ Footprint.');
            footprint.state = 'RELEASED'; footprint.revision += 1; await footprint.save({ session });
            unit.state = 'REMOVED'; unit.revision += 1; await unit.save({ session });
          }
        }
        for (const [cellId, delta] of byCell) {
          const currentCell = capacities.cells.get(cellId)!;
          if (!currentCell) fail(503, 'CAPACITY_RECONCILIATION_UNKNOWN', `Thiếu source Cell ${cellId}.`);
          const updated = await Cell.findOneAndUpdate({ _id: delta.id, facilityId: reservation.facilityId,
            managedInventoryRevision: currentCell.managedInventoryRevision ?? 0, usedWeightKg: { $gte: money(delta.weight, 3) }, usedVolumeM3: { $gte: money(delta.volume, 6) } },
          { $inc: { usedWeightKg: -money(delta.weight, 3), usedVolumeM3: -money(delta.volume, 6), managedInventoryRevision: 1 } }, { new: true, session }).exec();
          if (!updated) fail(409, 'STALE_CELL_CAPACITY', 'Counter Cell vừa thay đổi hoặc không đủ bằng chứng sử dụng.');
        }
        const reservationFence = await ReservationModel.findOneAndUpdate({ _id: reservation._id, facilityId: reservation.facilityId,
          status: ReservationStatus.ACTIVE, inventoryVersion: reservation.inventoryVersion ?? 0, usedCapacityM3: { $gte: totalVolumeM3 } },
        { $inc: { inventoryVersion: 1, usedCapacityM3: -totalVolumeM3 } }, { new: true, session }).exec();
        if (!reservationFence) fail(409, 'STALE_RESERVATION_CAPACITY', 'Reservation capacity vừa thay đổi hoặc không đủ.');
        const nextMovements = await Movement.find({ itemId: lockedItem._id, schemaVersion: 3 }).sort({ performedAt: 1, _id: 1 }).session(session).lean().exec();
        let nextProjection: Plain = {}; try { nextProjection = replayManagedInventoryV3(lockedItem, nextMovements); } catch (error: any) { fail(409, error.code ?? 'V3_LEDGER_INVALID', 'REMOVE tạo ledger không hợp lệ; transaction đã rollback.'); }
        const replaced = await Projection.updateOne({ skuId: lockedItem._id, reservationId: reservation._id, facilityId: reservation.facilityId,
          projectionRevision: state.replay.projectionRevision }, { $set: nextProjection }, { runValidators: true, session }).exec();
        if (replaced.matchedCount !== 1) fail(412, 'STALE_V3_PROJECTION', 'Projection vừa thay đổi; transaction đã rollback.');
        const completed = await Request.findOneAndUpdate({ _id: requestId, customerId: actor._id, state: ManagedV3OutboundState.PENDING, version: expectedVersion },
          { $set: { state: ManagedV3OutboundState.CONFIRMED, confirmedAt: now, confirmedBy: actor._id, confirmedMovementId: movement._id,
            customerAttestation: { confirmedAt: now, customerId: actor._id, text: input.attestation.trim() } }, $inc: { version: 1 } }, { new: true, runValidators: true, session }).exec();
        if (!completed) fail(412, 'STALE_OUTBOUND_REQUEST', 'Request vừa được thay đổi; transaction đã rollback.');
        await new Event({ requestId, skuId: request.skuId, reservationId: request.reservationId, customerId: request.customerId, facilityId: request.facilityId,
          actorId: actor._id, operation: ManagedV3OutboundOperation.CONFIRM, idempotencyKey: keyValue, requestHash: operationHash,
          resultingState: completed.state, resultingVersion: completed.version, allocationSnapshot: completed.allocations, occurredAt: now, movementId: movement._id }).save({ session });
        return { ...requestSnapshot(completed.toObject()), movementId: String(movement._id), currentQuantity: nextProjection.onHandQuantity,
          heldQuantity: 0, availableQuantity: nextProjection.onHandQuantity, totalWeightKg: nextProjection.totalWeightKg, totalVolumeM3: nextProjection.totalVolumeM3, outcome: 'COMMITTED' };
      });
      return { data: result, replayed: false };
    } catch (error: any) {
      if (error instanceof ManagedV3OutboundError || error instanceof ManagedV3OutboundDomainError) throw error;
      if (error instanceof ManagedAccessError) fail(error.status, error.code, error.message);
      if (error?.code === 11000) {
        const committed = await Event.findOne({ skuId: request.skuId, operation: ManagedV3OutboundOperation.CONFIRM, idempotencyKey: keyValue, actorId: actor._id }).lean().exec().catch(() => null);
        if (committed?.requestHash === operationHash && same(committed.requestId, requestId)) return { data: { ...requestSnapshot(await Request.findById(requestId).lean().exec()), movementId: String(committed.movementId), outcome: 'COMMITTED' }, replayed: true };
        fail(409, 'IDEMPOTENCY_CONFLICT', 'Xung đột key hoặc movement; hãy đối soát lịch sử trước khi thử lại.');
      }
      if (errorLabel(error, 'UnknownTransactionCommitResult')) {
        const committed = await Event.findOne({ skuId: request.skuId, operation: ManagedV3OutboundOperation.CONFIRM, idempotencyKey: keyValue, actorId: actor._id }).lean().exec().catch(() => null);
        if (committed?.requestHash === operationHash && same(committed.requestId, requestId)) return { data: { ...requestSnapshot(await Request.findById(requestId).lean().exec()), movementId: String(committed.movementId), outcome: 'COMMITTED' }, replayed: true };
        fail(503, 'OUTBOUND_CONFIRM_OUTCOME_UNKNOWN', 'Kết quả xác nhận chưa xác định; đối soát cùng Idempotency-Key, không tạo yêu cầu hoặc key mới.');
      }
      throw error;
    }
  }

  static async operation(itemIdInput: unknown, rawKey: unknown, actor: Actor) {
    const itemId = oid(itemIdInput, 'skuId'), keyValue = key(rawKey);
    const filter: Plain = { skuId: itemId, operation: ManagedV3OutboundOperation.CONFIRM, idempotencyKey: keyValue };
    if (actor.role === UserRole.CUSTOMER) filter.customerId = actor._id;
    else if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) { if (!actor.assignedFacilityId) fail(403, 'ROLE_DENIED', 'Facility assignment is required.'); filter.facilityId = actor.assignedFacilityId; }
    else fail(403, 'ROLE_DENIED', 'Role cannot read outbound operation.');
    const event = await Event.findOne(filter).lean().exec(); if (!event) fail(404, 'OUTBOUND_OPERATION_NOT_FOUND', 'Không tìm thấy thao tác đã xác nhận.');
    const movement = await Movement.findOne({ _id: event.movementId, itemId, schemaVersion: 3 }).lean().exec();
    if (!movement) fail(503, 'OUTBOUND_OPERATION_UNKNOWN', 'Event xác nhận không có Movement V3 tương ứng.');
    return { event, movement, request: requestSnapshot(await Request.findById(event.requestId).lean().exec()) };
  }

  static async facilityQueue(queryInput: unknown, actor: Actor) {
    if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role) || !actor.assignedFacilityId) fail(403, 'ROLE_DENIED', 'Staff/Manager cần Facility assignment.');
    const raw = queryInput && typeof queryInput === 'object' && !Array.isArray(queryInput) ? queryInput as Plain : {};
    if (Object.keys(raw).some(k => !['state', 'page', 'limit', 'dateFrom', 'dateTo'].includes(k))) fail(400, 'INVALID_FILTER', 'Bộ lọc không hợp lệ.');
    const page = raw.page === undefined ? 1 : Number(raw.page), limit = raw.limit === undefined ? 20 : Number(raw.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_PAGINATION', 'Phân trang không hợp lệ.');
    const filter: Plain = { facilityId: actor.assignedFacilityId }; if (raw.state) { if (!Object.values(ManagedV3OutboundState).includes(raw.state)) fail(400, 'INVALID_FILTER', 'Trạng thái không hợp lệ.'); filter.state = raw.state; }
    if (raw.dateFrom || raw.dateTo) { filter.createdAt = {}; if (raw.dateFrom) filter.createdAt.$gte = new Date(String(raw.dateFrom)); if (raw.dateTo) filter.createdAt.$lte = new Date(String(raw.dateTo)); if ((Object.values(filter.createdAt) as Date[]).some((d: Date) => !Number.isFinite(d.getTime()))) fail(400, 'INVALID_FILTER', 'Ngày lọc không hợp lệ.'); }
    let rows: Plain[], total: number;
    if (actor.role === UserRole.FACILITY_MANAGER) {
      [rows, total] = await Promise.all([Request.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(), Request.countDocuments(filter).exec()]);
    } else {
      const scope = await staffVisitScope(actor);
      const reservationIds = [...new Set(scope.visits.map((row: Plain) => String(row.reservationId)))].map((value: string) => new Types.ObjectId(value));
      if (!reservationIds.length) return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      const states = raw.state ? [raw.state] : [ManagedV3OutboundState.PENDING, ManagedV3OutboundState.CONFIRMED];
      const candidates = await Request.find({ ...filter, reservationId: { $in: reservationIds }, state: { $in: states } }).sort({ createdAt: -1, _id: -1 }).limit(5001).lean().exec();
      if (candidates.length > 5000) fail(503, 'STAFF_OUTBOUND_SCOPE_TOO_LARGE', 'Danh sách Outbound vượt giới hạn đối soát quyền Staff.');
      const movementIds = candidates.map((row: Plain) => row.confirmedMovementId).filter(Boolean);
      const sessionIds = scope.sessions.map((row: Plain) => row._id);
      const scopedMovements = movementIds.length && sessionIds.length ? await Movement.find({ _id: { $in: movementIds }, facilityId: actor.assignedFacilityId,
        schemaVersion: 3, 'v3Effect.action': 'REMOVE', 'v3Effect.accessSessionId': { $in: sessionIds } }).lean().exec() : [];
      const visible = candidates.filter((request: Plain) => staffCanReadManagedV3OutboundRequest({ request, ...scope, movements: scopedMovements,
        actorId: String(actor._id), facilityId: String(actor.assignedFacilityId) }));
      rows = visible.slice((page - 1) * limit, page * limit); total = visible.length;
    }
    const itemIds = [...new Set((rows as Plain[]).map((r: Plain) => String(r.skuId)))].map((id: string) => new Types.ObjectId(id));
    const items = await Item.find({ _id: { $in: itemIds }, facilityId: actor.assignedFacilityId }).select('_id itemCode name images category').lean().exec();
    const itemMap = new Map(items.map((row: Plain) => [String(row._id), row]));
    const data = rows.filter((row: Plain) => itemMap.has(String(row.skuId))).map((row: Plain) => ({ ...requestSnapshot(row), sku: itemMap.get(String(row.skuId)) }));
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  static async facilityDetail(requestIdInput: unknown, actor: Actor) {
    if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role) || !actor.assignedFacilityId) fail(403, 'ROLE_DENIED', 'Staff/Manager cần Facility assignment.');
    const request = await Request.findOne({ _id: oid(requestIdInput, 'requestId'), facilityId: actor.assignedFacilityId }).lean().exec();
    if (!request) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu tại Facility.');
    if (actor.role === UserRole.FACILITY_STAFF && !await staffCanReadRequest(request, actor)) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu trong phạm vi Visit/Session OUTBOUND được phân công.');
    const [item, customer, movements, events] = await Promise.all([
      Item.findOne({ _id: request.skuId, facilityId: actor.assignedFacilityId }).select('_id itemCode name images category quantityUnit').lean().exec(),
      (await import('../../models/users/user.model')).default.findById(request.customerId).select('_id displayName').lean().exec(),
      Movement.find({ itemId: request.skuId, 'v3Effect.operationId': { $regex: `^outbound:${String(request._id)}$` } }).sort({ performedAt: 1 }).lean().exec(),
      Event.find({ requestId: request._id }).sort({ resultingVersion: 1 }).lean().exec(),
    ]);
    if (!item || !customer) fail(404, 'OUTBOUND_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu tại Facility.');
    return { request: requestSnapshot(request), sku: item, customer, movements, events, stock: await ManagedInventoryV3OutboundService.stock(String(request.skuId), { _id: request.customerId, role: UserRole.CUSTOMER } as Actor) };
  }
}

