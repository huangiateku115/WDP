import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import InventoryStockBalanceModel from '../../models/inventory-items/inventory-stock-balance.model';
import ManagedOutboundRequestModel from '../../models/inventory-items/managed-outbound-request.model';
import InventoryInboundRequestModel, { inventoryInboundRequestUnresolvedStates } from '../../models/inventory-items/inventory-inbound-request.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ManagedFacilityCapacityModel from '../../models/reservations/managed-facility-capacity.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import { resolveMi06CanonicalRelocationGate } from '../../config/mi06-canonical-relocation-gate';
import { ManagedStockErrorCode, ManagedStockSource } from '../../types/managed-stock.type';
import { IInventoryItem, InventoryItemStatus } from '../../types/inventory-item.type';
import { ItemMovementType, MovementBatchAction } from '../../types/item-movement.type';
import { ManagedOutboundRequestState } from '../../types/managed-outbound-request.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { CellAllocationStatus, WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { IUser, UserRole } from '../../types/user.type';
import { exactPrecisionUnits, precisionUnitsToNumber, roundedProductUnits, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';
import { ManagedOutboundAllocationError, reconcileManagedOutboundHolds } from './managed-outbound-allocation.service';
import { ManagedStockReconciliationError, reconcileManagedItemStock } from './managed-stock-ledger.service';
import { CanonicalRelocationInput, InventoryItemError, parseCanonicalRelocation, parseId } from './inventory-item.validation';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
type RecordValue = Record<string, any>;
const live = { deletedAt: { $exists: false } };
const unresolvedOutbound = ManagedOutboundRequestState.PENDING;
const fail = (status: number, code: ManagedStockErrorCode, message: string): never => { throw new CanonicalRelocationError(status, code, message); };
const sameId = (a: any, b: any) => String(a?._id ?? a) === String(b?._id ?? b);
const round = (value: number, places: 3 | 6) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;

export class CanonicalRelocationError extends InventoryItemError {
  constructor(status: number, public readonly code: ManagedStockErrorCode, message: string) { super(status, message); }
}

class ItemTokenConflict extends Error { constructor() { super('Canonical relocation Item token changed'); } }
class UnknownRelocationCommit extends Error { constructor() { super('Canonical relocation commit outcome is unknown'); } }

function gateEnabled() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  return resolveMi06CanonicalRelocationGate(nodeEnv, process.env.MI06_CANONICAL_RELOCATIONS_ENABLED) &&
    nodeEnv !== 'production' && process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() === 'true';
}

function isUnknownCommit(error: any) {
  return error?.hasErrorLabel?.('UnknownTransactionCommitResult') || error?.errorLabels?.includes?.('UnknownTransactionCommitResult');
}

function isTransient(error: any) {
  return error instanceof ItemTokenConflict || error?.code === 112 || error?.codeName === 'WriteConflict' ||
    error?.hasErrorLabel?.('TransientTransactionError') || error?.errorLabels?.includes?.('TransientTransactionError');
}

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); }, {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15_000,
    });
    return result;
  } finally { await session.endSession(); }
}

function replayMatches(movement: any, input: CanonicalRelocationInput, item: any) {
  return movement?.type === ItemMovementType.RELOCATION && movement.schemaVersion === 2 && movement.arithmeticPolicy === 'CANONICAL_V1' &&
    sameId(movement.itemId, item._id) && sameId(movement.managedReservationId, item.managedReservationId) &&
    sameId(movement.facilityId, item.facilityId) && sameId(movement.customerId, item.customerId) &&
    sameId(movement.sourceCellId, input.sourceCellId) && sameId(movement.destinationCellId, input.destinationCellId) &&
    movement.relocationNote === input.relocationNote && movement.physicalPackingConfirmed === input.physicalPackingConfirmed;
}

function movementDto(movement: any) {
  return {
    _id: movement._id, itemId: movement.itemId, managedReservationId: movement.managedReservationId,
    facilityId: movement.facilityId, customerId: movement.customerId, type: movement.type,
    sourceCellId: movement.sourceCellId, destinationCellId: movement.destinationCellId,
    previousPlacementMovementId: movement.previousPlacementMovementId,
    quantity: movement.quantity, quantityUnit: movement.quantityUnit,
    actualUnitWeightKg: movement.actualUnitWeightKg, actualTotalWeightKg: movement.actualTotalWeightKg,
    actualUnitDimensionsM: movement.actualUnitDimensionsM, actualTotalVolumeM3: movement.actualTotalVolumeM3,
    performedBy: movement.performedBy, performedAt: movement.performedAt,
    relocationNote: movement.relocationNote, physicalPackingConfirmed: movement.physicalPackingConfirmed,
    schemaVersion: movement.schemaVersion, arithmeticPolicy: movement.arithmeticPolicy,
    batchLines: (movement.batchLines ?? []).map((line: any) => ({ ...line.toObject?.() ?? line })),
  };
}

function resultSnapshot(item: any, movement: any, replayed: boolean) {
  const itemSnapshot = {
    _id: item._id, facilityId: item.facilityId, managedReservationId: item.managedReservationId,
    itemCode: item.itemCode, name: item.name, category: item.category, quantity: item.quantity,
    quantityUnit: item.quantityUnit, status: InventoryItemStatus.IN_STORAGE,
    currentCellId: movement.destinationCellId, currentPlacementMovementId: movement._id,
  };
  return { item: itemSnapshot, movement: movementDto(movement), currentQuantity: movement.quantity,
    idempotentReplay: replayed };
}

async function findMovement(itemId: Types.ObjectId, key: string, session?: ClientSession) {
  let query = ItemMovementModel.findOne({ itemId, idempotencyKey: key });
  if (session) query = query.session(session);
  return query.exec();
}

async function recover(error: unknown, item: any, input: CanonicalRelocationInput, key: string) {
  const unknownCommit = isUnknownCommit(error) || error instanceof UnknownRelocationCommit;
  const transient = isTransient(error);
  const duplicate = (error as any)?.code === 11000;
  if (!unknownCommit && !transient && !duplicate) throw error;
  let readFailed = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const movement = await findMovement(item._id, key);
      if (movement) {
        if (!replayMatches(movement, input, item)) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT,
          'Idempotency-Key was already used for a different relocation');
        return resultSnapshot(item, movement, true);
      }
    } catch (readError) { readFailed = true; }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, [25, 50, 100][attempt]));
  }
  if (unknownCommit || readFailed) return fail(503, ManagedStockErrorCode.CANONICAL_RELOCATION_OUTCOME_UNKNOWN,
    'Relocation outcome is uncertain; retry with the same Idempotency-Key');
  if (transient) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT,
    'Inventory changed concurrently; reload and retry relocation');
  return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT, 'Relocation key conflicts with an existing movement');
}

async function lockZone(zoneId: Types.ObjectId, facilityId: Types.ObjectId, requireActive: boolean, session: ClientSession) {
  const zone = await WarehouseZoneModel.findOneAndUpdate({ _id: zoneId, facilityId,
    ...(requireActive ? { isActive: true } : {}), ...live }, { $inc: { structureVersion: 1 } },
  { new: true, session, runValidators: true }).exec();
  if (!zone) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
    requireActive ? 'Destination Zone must be active' : 'Source Zone is missing');
  return zone;
}

async function lockRack(rackId: Types.ObjectId, facilityId: Types.ObjectId, zoneId: Types.ObjectId,
  requireAvailable: boolean, session: ClientSession) {
  const rack = await WarehouseRackModel.findOneAndUpdate({ _id: rackId, facilityId, zoneId,
    ...(requireAvailable ? { operationalStatus: WarehouseOperationalStatus.AVAILABLE } : {}), ...live },
  { $inc: { layoutVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!rack) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
    requireAvailable ? 'Destination Rack must be AVAILABLE' : 'Source Rack is missing');
  return rack;
}

async function lockCell(cellId: Types.ObjectId, facilityId: Types.ObjectId, available: boolean, session: ClientSession) {
  const cell = await WarehouseCellModel.findOneAndUpdate({ _id: cellId, facilityId,
    ...(available ? { operationalStatus: WarehouseOperationalStatus.AVAILABLE } : {}), ...live },
  { $inc: { allocationVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!cell) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
    available ? 'Destination Cell must be AVAILABLE' : 'Source Cell is missing');
  return cell;
}

async function lockReservation(item: IInventoryItem, session: ClientSession, now: Date) {
  const identity = { _id: item.managedReservationId, customerId: item.customerId,
    facilityId: item.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY };
  const current = await ReservationModel.findOne(identity).session(session).exec();
  if (!current || current.status !== ReservationStatus.ACTIVE || current.startDate > now || current.endDate <= now) {
    return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
      'Canonical relocation requires an in-term ACTIVE Managed Inventory reservation');
  }
  const version = Number(current.inventoryVersion ?? 0);
  const versionFilter = version === 0 ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
    : { inventoryVersion: version };
  const reservation = await ReservationModel.findOneAndUpdate({ ...identity, status: ReservationStatus.ACTIVE,
    startDate: { $lte: now }, endDate: { $gt: now }, activeClosureRequestId: null, $and: [versionFilter] },
  { $inc: { inventoryVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!reservation) return fail(409, current.activeClosureRequestId
    ? ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT : ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
  current.activeClosureRequestId ? 'Relocation is blocked while reservation closure is pending'
    : 'Reservation lifecycle changed; retry canonical relocation');
  return reservation;
}

function translateReconciliation(error: unknown): never {
  if (error instanceof ManagedStockReconciliationError) return fail(409, error.code,
    `Canonical stock history cannot be reconciled: ${error.message}`);
  if (error instanceof ManagedOutboundAllocationError) return fail(409, error.code as ManagedStockErrorCode,
    `Canonical outbound holds cannot be reconciled: ${error.message}`);
  throw error;
}

function total(rows: RecordValue[], field: 'actualTotalWeightKg' | 'actualTotalVolumeM3', precision: 3 | 6) {
  const units = sumExactPrecisionUnits(rows.map(row => Number(row[field])), precision);
  const result = units === null ? null : precisionUnitsToNumber(units, precision);
  if (result === null) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Physical stock total exceeds the safe arithmetic range');
  return result;
}

async function reconcilePhysicalScope(item: IInventoryItem, reservation: any, sourceCell: any, destinationCell: any,
  sourceRack: any, destinationRack: any, session: ClientSession) {
  const rackIds = [...new Map([sourceRack, destinationRack].map(row => [String(row._id), row._id])).values()];
  const rackCells = await WarehouseCellModel.find({ facilityId: item.facilityId, rackId: { $in: rackIds }, ...live }).session(session).lean().exec();
  if (!rackCells.length || rackCells.some((row: any) => !row._id || !row.rackId || !row.zoneId || !row.facilityId ||
      !row.facilityId.equals(item.facilityId) || !Number.isFinite(Number(row.usedWeightKg)) || Number(row.usedWeightKg) < 0 ||
      !Number.isFinite(Number(row.usedVolumeM3)) || Number(row.usedVolumeM3) < 0)) {
    return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Rack Cell hierarchy or physical counters are incomplete');
  }
  const rackCellIds = rackCells.map((row: any) => row._id);
  const items = await InventoryItemModel.find({ $or: [
    { facilityId: item.facilityId, currentCellId: { $in: rackCellIds } },
    { managedReservationId: reservation._id, facilityId: item.facilityId, status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.PENDING_OUTBOUND] } },
  ], ...live }).session(session).lean().exec();
  const uniqueItems = new Map<string, any>();
  for (const placed of items) uniqueItems.set(String(placed._id), placed);
  if (!uniqueItems.has(String(item._id))) return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH,
    'Relocation Item is absent from physical stock reconciliation');
  const itemIds = [...uniqueItems.values()].map(row => row._id);
  const movements = await ItemMovementModel.find({ itemId: { $in: itemIds } }).session(session).lean().exec();
  const movementGroups = new Map<string, any[]>();
  for (const movement of movements) {
    const key = String(movement.itemId), group = movementGroups.get(key) ?? [];
    group.push(movement); movementGroups.set(key, group);
  }
  const projections = new Map<string, any>();
  for (const [id, placed] of uniqueItems) {
    try { projections.set(id, reconcileManagedItemStock(placed, movementGroups.get(id) ?? [])); }
    catch (error) { return translateReconciliation(error); }
  }
  const cellUsage = new Map<string, { weightKg: number; volumeM3: number; itemIds: Set<string> }>();
  const reservationItems: any[] = [];
  for (const [id, placed] of uniqueItems) {
    const projection = projections.get(id);
    if (String(placed.managedReservationId) === String(reservation._id) && projection.onHandQuantity > 0) reservationItems.push(projection);
    if (projection.onHandQuantity <= 0) continue;
    const currentCellKey = String(projection.currentCellId);
    if (!rackCellIds.some((cellId: any) => String(cellId) === currentCellKey)) continue;
    if ([String(sourceCell._id), String(destinationCell._id)].includes(currentCellKey) &&
        (String(placed.managedReservationId) !== String(reservation._id) || String(placed.customerId) !== String(item.customerId))) {
      return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'A source or destination Cell contains stock outside this Reservation allocation');
    }
    const usage = cellUsage.get(currentCellKey) ?? { weightKg: 0, volumeM3: 0, itemIds: new Set<string>() };
    usage.weightKg += projection.actualTotalWeightKg; usage.volumeM3 += projection.actualTotalVolumeM3; usage.itemIds.add(id);
    cellUsage.set(currentCellKey, usage);
  }
  const precise = (value: number, precision: 3 | 6) => {
    const units = sumExactPrecisionUnits([value], precision);
    const converted = units === null ? null : precisionUnitsToNumber(units, precision);
    if (converted === null) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Physical stock total exceeds the safe arithmetic range');
    return converted;
  };
  for (const usage of cellUsage.values()) {
    usage.weightKg = precise(usage.weightKg, 3); usage.volumeM3 = precise(usage.volumeM3, 6);
  }
  const byCell = new Map(rackCells.map((row: any) => [String(row._id), cellUsage.get(String(row._id)) ?? { weightKg: 0, volumeM3: 0, itemIds: new Set<string>() }]));
  for (const row of rackCells) {
    const usage = byCell.get(String(row._id))!;
    if (Math.abs(Number(row.usedWeightKg) - usage.weightKg) > 0.001 || Math.abs(Number(row.usedVolumeM3) - usage.volumeM3) > 0.000001) {
      return fail(409, ManagedStockErrorCode.CELL_COUNTER_MISMATCH, `Cell ${row.code ?? row._id} counters differ from movement-derived usage`);
    }
  }
  const reservationWeightKg = total(reservationItems, 'actualTotalWeightKg', 3);
  const reservationVolumeM3 = total(reservationItems, 'actualTotalVolumeM3', 6);
  if (!Number.isFinite(Number(reservation.usedCapacityM3)) || Number(reservation.usedCapacityM3) < 0 ||
      Math.abs(Number(reservation.usedCapacityM3) - reservationVolumeM3) > 0.000001) {
    return fail(409, ManagedStockErrorCode.RESERVATION_COUNTER_MISMATCH, 'Reservation usage differs from movement-derived physical stock');
  }
  if (!Number.isFinite(Number(reservation.allocatedCapacity)) || Number(reservation.allocatedCapacity) <= 0 ||
      reservationVolumeM3 > Number(reservation.allocatedCapacity) + 0.000001) {
    return fail(409, ManagedStockErrorCode.CAPACITY_EXCEEDED, 'Reservation physical stock exceeds its allocated capacity');
  }
  const sourceUsage = byCell.get(String(sourceCell._id));
  const destinationUsage = byCell.get(String(destinationCell._id));
  if (!sourceUsage?.itemIds.has(String(item._id))) return fail(409, ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID,
    'Item is not present in its reconciled source Cell');
  return { projections, cellUsage: byCell, sourceUsage, destinationUsage, reservationWeightKg, reservationVolumeM3,
    rackCells };
}

function canonicalTotal(values: number[], quantity: number, precision: 3 | 6) {
  const units = roundedProductUnits(values, quantity, precision);
  const value = units === null ? null : precisionUnitsToNumber(units, precision);
  if (value === null || value <= 0) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN,
    'A receipt batch cannot be represented at canonical physical precision');
  return value;
}

function canonicalSum(values: number[], precision: 3 | 6) {
  const units = sumExactPrecisionUnits(values, precision);
  const value = units === null ? null : precisionUnitsToNumber(units, precision);
  if (value === null || value <= 0) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN,
    'Relocation movement total cannot be represented at canonical precision');
  return value;
}

function checkGeometry(batches: any[], destination: any, quantity: number, packingConfirmed: boolean) {
  const dimensions = destination.dimensions;
  const width = Number(dimensions?.widthM), depth = Number(dimensions?.depthM), height = Number(dimensions?.usableHeightM);
  if (![width, depth, height].every(value => Number.isFinite(value) && value > 0)) {
    return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Destination Cell dimensions and usable height must be verified');
  }
  if ((quantity > 1 || batches.length > 1) && !packingConfirmed) {
    return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID, 'Physical packing confirmation is required for multiple handling units or receipt batches');
  }
  for (const batch of batches) {
    const unit = batch.actualUnitDimensionsM;
    const fits = (unit.widthM <= width && unit.depthM <= depth) || (unit.depthM <= width && unit.widthM <= depth);
    if (!fits || unit.heightM > height) return fail(409, ManagedStockErrorCode.CAPACITY_EXCEEDED,
      `Receipt batch ${batch.batchId} geometry does not fit the destination Cell`);
  }
}

export class ManagedCanonicalRelocationService {
  static async context(itemIdInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF) return fail(403, ManagedStockErrorCode.CANONICAL_RELOCATION_FORBIDDEN, 'Facility Staff role required');
    let itemId: Types.ObjectId;
    try { itemId = new Types.ObjectId(parseId(itemIdInput, 'item ID')); }
    catch (error) { if (error instanceof InventoryItemError) return fail(400, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID, error.message); throw error; }
    const item = await InventoryItemModel.findOne({ _id: itemId, ...live }).lean().exec();
    if (!item || !actor.assignedFacilityId || !actor.assignedFacilityId.equals(item.facilityId)) return fail(404, ManagedStockErrorCode.CANONICAL_RELOCATION_NOT_FOUND, 'Inventory Item not found');
    const now = new Date();
    const reservation = await ReservationModel.findOne({ _id: item.managedReservationId, customerId: item.customerId,
      facilityId: item.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, status: ReservationStatus.ACTIVE,
      startDate: { $lte: now }, endDate: { $gt: now } }).select('_id').lean().exec();
    if (!reservation || item.status !== InventoryItemStatus.IN_STORAGE || !item.currentCellId) return fail(409,
      ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID, 'Relocation requires an in-term ACTIVE Managed Inventory Item in storage');
    const [movements, balance, inbound, requests] = await Promise.all([
      ItemMovementModel.find({ itemId }).sort({ performedAt: 1, _id: 1 }).lean().exec(),
      InventoryStockBalanceModel.findOne({ itemId, facilityId: item.facilityId }).lean().exec(),
      InventoryInboundRequestModel.findOne({ itemId, state: { $in: inventoryInboundRequestUnresolvedStates } }).select('_id').lean().exec(),
      ManagedOutboundRequestModel.find({ itemId }).lean().exec(),
    ]);
    if (inbound || requests.some((row: any) => row.state === unresolvedOutbound)) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID, 'Unresolved receipt or outbound requests block relocation');
    if (!balance) return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'A reconciled StockBalance is required before relocation');
    let reconciled: ReturnType<typeof reconcileManagedOutboundHolds>;
    try { reconciled = reconcileManagedOutboundHolds({ item: item as any, movements: movements as any[], stockBalance: balance as any, requests: requests as any[] }); }
    catch (error) { return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, error instanceof Error ? error.message : 'Item ledger cannot be reconciled'); }
    if (reconciled.onHandQuantity <= 0 || reconciled.heldQuantity !== 0 || !sameId(reconciled.ledger.currentCellId, item.currentCellId) ||
        !sameId(balance.currentCellId, item.currentCellId) || balance.heldQuantity !== 0) return fail(409,
      ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Positive stock, placement and holds do not reconcile for relocation');
    const allocations = await CellAllocationModel.find({ reservationId: item.managedReservationId, customerId: item.customerId,
      facilityId: item.facilityId, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] },
      startDate: { $lte: now }, endDate: { $gt: now } }).select('cellId status').lean().exec();
    const cellIds = [...new Set(allocations.map(row => String(row.cellId)))];
    const cells = await WarehouseCellModel.find({ _id: { $in: cellIds }, facilityId: item.facilityId, ...live })
      .select('_id code rackId zoneId dimensions maxWeightKg usedWeightKg usedVolumeM3 operationalStatus').sort({ code: 1 }).lean().exec();
    return { item: { _id: String(item._id), itemCode: item.itemCode, name: item.name, status: item.status,
      currentCellId: String(item.currentCellId), managedReservationId: String(item.managedReservationId), facilityId: String(item.facilityId) },
      stock: { currentQty: reconciled.onHandQuantity, heldQty: reconciled.heldQuantity, availableQty: reconciled.availableQuantity },
      currentCellId: String(item.currentCellId), cells: cells.filter(cell => String(cell._id) === String(item.currentCellId) ||
        cell.operationalStatus === WarehouseOperationalStatus.AVAILABLE).map(cell => ({ ...cell,
        allocationStatus: allocations.find(row => String(row.cellId) === String(cell._id))?.status,
        isCurrent: String(cell._id) === String(item.currentCellId) })), };
  }
  static async relocate(itemIdInput: unknown, body: unknown, idempotencyKeyInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF) return fail(403, ManagedStockErrorCode.CANONICAL_RELOCATION_FORBIDDEN,
      'Facility Staff role required');
    let itemId: Types.ObjectId, input: CanonicalRelocationInput;
    try { itemId = new Types.ObjectId(parseId(itemIdInput, 'item ID')); input = parseCanonicalRelocation(body, idempotencyKeyInput); }
    catch (error) {
      if (error instanceof InventoryItemError) return fail(error.status, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID, error.message);
      throw error;
    }
    const preflight = await InventoryItemModel.findOne({ _id: itemId, ...live }).exec();
    if (!preflight) return fail(404, ManagedStockErrorCode.CANONICAL_RELOCATION_NOT_FOUND, 'Inventory Item not found');
    if (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(preflight.facilityId)) {
      return fail(404, ManagedStockErrorCode.CANONICAL_RELOCATION_NOT_FOUND, 'Inventory Item not found');
    }
    const existing = await findMovement(itemId, input.idempotencyKey);
    if (existing) {
      if (!replayMatches(existing, input, preflight)) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT,
        'Idempotency-Key was already used for a different operation or payload');
      return resultSnapshot(preflight, existing, true);
    }
    if (!gateEnabled()) return fail(503, ManagedStockErrorCode.CANONICAL_RELOCATION_FEATURE_DISABLED,
      'Canonical relocation requires MI06_CANONICAL_RELOCATIONS_ENABLED and MI06_STOCK_LEDGER_WRITES_ENABLED outside production');
    if (preflight.status !== InventoryItemStatus.IN_STORAGE || !preflight.currentCellId ||
        String(preflight.currentCellId) !== input.sourceCellId || !preflight.managedReservationId) {
      return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
        'Canonical relocation requires positive, physically stored Managed Inventory at the supplied source Cell');
    }
    const preflightVersion = Number.isSafeInteger(preflight.__v) && preflight.__v >= 0 ? preflight.__v : null;
    try {
      return await withTransaction(async session => {
        // Global operation order: Item -> optional Facility capacity -> sorted Zones -> Reservation -> sorted Racks -> sorted Cells.
        const item = await InventoryItemModel.findOneAndUpdate({ _id: itemId, customerId: preflight.customerId,
          managedReservationId: preflight.managedReservationId, facilityId: preflight.facilityId,
          status: InventoryItemStatus.IN_STORAGE, currentCellId: new Types.ObjectId(input.sourceCellId),
          __v: preflightVersion === null ? { $exists: false } : preflightVersion, ...live },
        { $inc: { __v: 1 } }, { new: true, session }).exec();
        if (!item) throw new ItemTokenConflict();
        const inboundRequest = await InventoryInboundRequestModel.findOne({ itemId, reservationId: item.managedReservationId,
          state: { $in: inventoryInboundRequestUnresolvedStates } }).session(session).select('_id').lean().exec();
        if (inboundRequest) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT,
          'An unresolved repeated-inbound request blocks relocation');
        const pendingOutbound = await ManagedOutboundRequestModel.findOne({ itemId, state: unresolvedOutbound })
          .session(session).select('_id').lean().exec();
        if (pendingOutbound) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_CONFLICT,
          'A pending outbound hold blocks relocation');
        const sourcePreflight = await WarehouseCellModel.findOne({ _id: input.sourceCellId, facilityId: item.facilityId, ...live }).session(session).exec();
        const destinationPreflight = await WarehouseCellModel.findOne({ _id: input.destinationCellId, facilityId: item.facilityId, ...live }).session(session).exec();
        if (!sourcePreflight || !sourcePreflight._id.equals(item.currentCellId)) return fail(409,
          ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'Source Cell differs from the locked Item placement');
        if (!destinationPreflight) return fail(404, ManagedStockErrorCode.CANONICAL_RELOCATION_NOT_FOUND,
          'Destination Cell was not found in the Item Facility');
        if (sourcePreflight._id.equals(destinationPreflight._id)) return fail(400,
          ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID, 'Source and destination Cells must differ');
        const reservationPreflight = await ReservationModel.findOne({ _id: item.managedReservationId,
          customerId: item.customerId, facilityId: item.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY })
          .select('bookingFlowVersion').session(session).exec();
        if (!reservationPreflight) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
          'Item is not owned by this Managed Inventory reservation');
        if (reservationPreflight.bookingFlowVersion === 2) {
          const capacityToken = await ManagedFacilityCapacityModel.findOneAndUpdate({ facilityId: item.facilityId },
            { $inc: { bookingVersion: 1 } }, { new: true, session }).exec();
          if (!capacityToken) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN,
            'Managed Facility capacity token is unavailable');
        }
        const zoneRequirements = new Map<string, { id: Types.ObjectId; active: boolean }>();
        for (const row of [
          { id: sourcePreflight.zoneId as Types.ObjectId, active: false },
          { id: destinationPreflight.zoneId as Types.ObjectId, active: true },
        ]) {
          const key = String(row.id), previous = zoneRequirements.get(key);
          zoneRequirements.set(key, { id: row.id, active: row.active || Boolean(previous?.active) });
        }
        const zones = new Map<string, any>();
        for (const zone of [...zoneRequirements.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
          zones.set(String(zone.id), await lockZone(zone.id, item.facilityId, zone.active, session));
        }
        const now = new Date();
        const reservation = await lockReservation(item, session, now);
        const facility = await FacilityModel.findOne({ _id: item.facilityId, status: FacilityStatus.ACTIVE,
          serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).select('_id').lean().exec();
        if (!facility || !reservation.facilityId.equals(item.facilityId) || !reservation.customerId.equals(item.customerId)) {
          return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
            'An active Managed Inventory Facility and matching Reservation are required');
        }
        if (!(reservation.allocatedCellIds ?? []).some((id: Types.ObjectId) => id.equals(sourcePreflight._id)) ||
            !(reservation.allocatedCellIds ?? []).some((id: Types.ObjectId) => id.equals(destinationPreflight._id))) {
          return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
            'Both source and destination Cells must be allocated to this Reservation');
        }
        const rackRequirements = new Map<string, { id: Types.ObjectId; zoneId: Types.ObjectId; available: boolean }>();
        for (const row of [
          { id: sourcePreflight.rackId as Types.ObjectId, zoneId: sourcePreflight.zoneId as Types.ObjectId, available: false },
          { id: destinationPreflight.rackId as Types.ObjectId, zoneId: destinationPreflight.zoneId as Types.ObjectId, available: true },
        ]) {
          const key = String(row.id), previous = rackRequirements.get(key);
          if (previous && !previous.zoneId.equals(row.zoneId)) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN,
            'Rack hierarchy is inconsistent');
          rackRequirements.set(key, { id: row.id, zoneId: row.zoneId, available: row.available || Boolean(previous?.available) });
        }
        const racks = new Map<string, any>();
        for (const rack of [...rackRequirements.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
          racks.set(String(rack.id), await lockRack(rack.id, item.facilityId, rack.zoneId, rack.available, session));
        }
        const cellIds = [sourcePreflight._id as Types.ObjectId, destinationPreflight._id as Types.ObjectId]
          .sort((a, b) => String(a).localeCompare(String(b)));
        const cells = new Map<string, any>();
        for (const cellId of cellIds) {
          cells.set(String(cellId), await lockCell(cellId, item.facilityId, cellId.equals(destinationPreflight._id), session));
        }
        const source = cells.get(String(sourcePreflight._id)), destination = cells.get(String(destinationPreflight._id));
        const sourceRack = racks.get(String(source.rackId)), destinationRack = racks.get(String(destination.rackId));
        if (!zones.has(String(source.zoneId)) || !zones.has(String(destination.zoneId)) || !sourceRack || !destinationRack ||
            !source.zoneId.equals(sourcePreflight.zoneId) || !source.rackId.equals(sourcePreflight.rackId) ||
            !destination.zoneId.equals(destinationPreflight.zoneId) || !destination.rackId.equals(destinationPreflight.rackId)) {
          return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Cell Zone/Rack hierarchy changed during relocation');
        }
        const sourceAllocation = await CellAllocationModel.findOne({ cellId: source._id, reservationId: reservation._id,
          facilityId: item.facilityId, customerId: item.customerId, status: CellAllocationStatus.OCCUPIED,
          startDate: { $lte: now }, endDate: { $gt: now } }).session(session).exec();
        if (!sourceAllocation) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
          'Source Cell is not OCCUPIED by this Reservation');
        const destinationAllocation = await CellAllocationModel.findOne({ cellId: destination._id, reservationId: reservation._id,
          facilityId: item.facilityId, customerId: item.customerId,
          status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] },
          startDate: { $lte: now }, endDate: { $gt: now } }).session(session).exec();
        if (!destinationAllocation) return fail(409, ManagedStockErrorCode.CANONICAL_RELOCATION_INVALID,
          'Destination Cell is not allocated to this Reservation');

        const physical = await reconcilePhysicalScope(item, reservation, source, destination, sourceRack, destinationRack, session);
        const destinationHasStock = physical.destinationUsage!.itemIds.size > 0;
        if ((destinationHasStock && destinationAllocation.status !== CellAllocationStatus.OCCUPIED) ||
            (!destinationHasStock && destinationAllocation.status !== CellAllocationStatus.RESERVED)) {
          return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN,
            'Destination allocation occupancy does not match movement-derived Cell stock');
        }
        const movements = await ItemMovementModel.find({ itemId }).session(session).lean().exec();
        const balance = await InventoryStockBalanceModel.findOne({ itemId, managedReservationId: item.managedReservationId,
          facilityId: item.facilityId, customerId: item.customerId }).session(session).exec();
        if (!balance) return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH,
          'A reconciled StockBalance is required before canonical relocation');
        if (!Number.isSafeInteger(Number(balance.version)) || Number(balance.version) < 0) return fail(409,
          ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'StockBalance version is invalid');
        const requests = await ManagedOutboundRequestModel.find({ itemId }).session(session).lean().exec();
        let stock: any;
        try { stock = reconcileManagedOutboundHolds({ item: item.toObject(), movements: movements as any[],
          stockBalance: balance.toObject(), requests: requests as any[] }); }
        catch (error) { return translateReconciliation(error); }
        const currentPlacement = physical.projections.get(String(item._id));
        if (stock.onHandQuantity <= 0 || stock.heldQuantity !== 0 || !sameId(balance.currentCellId, source._id) ||
            !sameId(currentPlacement.currentCellId, source._id) || !currentPlacement.currentPlacementMovementId ||
            !sameId(item.currentPlacementMovementId, currentPlacement.currentPlacementMovementId) ||
            !sameId(balance.reconciledThroughMovementId, currentPlacement.reconciledThroughMovementId) ||
            !['LEDGER_V2', 'LEGACY_RECONCILED'].includes(String(balance.source))) {
          return fail(409, ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID,
            'Item, StockBalance and canonical-compatible placement lineage do not reconcile');
        }
        const batches = stock.batches.filter((batch: any) => batch.quantity > 0)
          .sort((a: any, b: any) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime() || a.batchId.localeCompare(b.batchId));
        const quantity = stock.onHandQuantity;
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || batches.reduce((sum: number, batch: any) => sum + batch.quantity, 0) !== quantity) {
          return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Current stock batch quantities are inconsistent');
        }
        checkGeometry(batches, destination, quantity, input.physicalPackingConfirmed);
        const destinationVolume = round(Number(destination.dimensions.widthM) * Number(destination.dimensions.depthM) *
          Number(destination.dimensions.usableHeightM), 6);
        const physicalWeight = Number(balance.actualTotalWeightKg), physicalVolume = Number(balance.actualTotalVolumeM3);
        if (![physicalWeight, physicalVolume, destinationVolume, Number(destination.maxWeightKg)].every(Number.isFinite) ||
            physicalWeight <= 0 || physicalVolume <= 0 || destinationVolume <= 0 ||
            Number(destination.usedWeightKg) + physicalWeight > Number(destination.maxWeightKg) ||
            Number(destination.usedVolumeM3) + physicalVolume > destinationVolume) {
          return fail(409, ManagedStockErrorCode.CAPACITY_EXCEEDED, 'Destination Cell capacity would be exceeded');
        }
        const sourceUsage = physical.sourceUsage!, destinationUsage = physical.destinationUsage!;
        if (sourceUsage.weightKg + 1e-9 < physicalWeight || sourceUsage.volumeM3 + 1e-12 < physicalVolume) {
          return fail(409, ManagedStockErrorCode.CELL_COUNTER_MISMATCH, 'Source Cell counters cannot account for this Item stock');
        }
        const rackNext = new Map<string, { totalKg: number; levelKg: Map<number, number>; rack: any }>();
        for (const rack of [sourceRack, destinationRack]) {
          const rackKey = String(rack._id);
          if (rackNext.has(rackKey)) continue;
          const rows = physical.rackCells.filter((row: any) => String(row.rackId) === rackKey);
          const levels = new Map<number, number>();
          let totalKg = 0;
          for (const row of rows) {
            if (!Number.isSafeInteger(Number(row.levelNumber)) || row.levelNumber < 1 || row.levelNumber > rack.levelCount) {
              return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Rack Cell level is invalid');
            }
            const used = Number(row.usedWeightKg); totalKg += used;
            levels.set(row.levelNumber, (levels.get(row.levelNumber) ?? 0) + used);
          }
          rackNext.set(rackKey, { totalKg, levelKg: levels, rack });
        }
        const sourceRackNext = rackNext.get(String(sourceRack._id))!;
        const destinationRackNext = rackNext.get(String(destinationRack._id))!;
        sourceRackNext.totalKg -= physicalWeight;
        sourceRackNext.levelKg.set(source.levelNumber, (sourceRackNext.levelKg.get(source.levelNumber) ?? 0) - physicalWeight);
        destinationRackNext.totalKg += physicalWeight;
        destinationRackNext.levelKg.set(destination.levelNumber, (destinationRackNext.levelKg.get(destination.levelNumber) ?? 0) + physicalWeight);
        for (const state of rackNext.values()) {
          const maximum = Number(state.rack.levelCount) * Number(state.rack.maxWeightKgPerLevel);
          if (![state.totalKg, maximum, Number(state.rack.maxWeightKgPerLevel)].every(Number.isFinite) ||
              state.totalKg < -0.001 || state.totalKg > maximum || [...state.levelKg.values()].some(value =>
                !Number.isFinite(value) || value < -0.001 || value > Number(state.rack.maxWeightKgPerLevel))) {
            return fail(409, ManagedStockErrorCode.CAPACITY_EXCEEDED, 'Source or destination Rack weight capacity would be exceeded');
          }
        }
        const lines: Array<Record<string, any>> = batches.map((batch: any) => ({ batchId: batch.batchId,
          receiptMovementId: batch.receiptMovementId, ...(batch.receiptRequestId ? { receiptRequestId: batch.receiptRequestId } : {}),
          ...(batch.receivingInspectionEvidenceId ? { receivingInspectionEvidenceId: batch.receivingInspectionEvidenceId } : {}),
          action: MovementBatchAction.MOVE, quantity: batch.quantity, quantityUnit: batch.quantityUnit,
          actualUnitWeightKg: batch.actualUnitWeightKg, actualUnitDimensionsM: { ...batch.actualUnitDimensionsM },
          actualTotalWeightKg: canonicalTotal([batch.actualUnitWeightKg], batch.quantity, 3),
          actualTotalVolumeM3: canonicalTotal([batch.actualUnitDimensionsM.widthM, batch.actualUnitDimensionsM.depthM,
            batch.actualUnitDimensionsM.heightM], batch.quantity, 6) }));
        const parentWeight = canonicalSum(lines.map(line => line.actualTotalWeightKg), 3);
        const parentVolume = canonicalSum(lines.map(line => line.actualTotalVolumeM3), 6);
        const firstLine = lines[0];
        if (!firstLine) return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH,
          'Relocation has no positive receipt batch lines');
        const movement = new ItemMovementModel({ itemId: item._id, managedReservationId: reservation._id,
          facilityId: item.facilityId, customerId: item.customerId, type: ItemMovementType.RELOCATION,
          sourceCellId: source._id, destinationCellId: destination._id,
          previousPlacementMovementId: currentPlacement.currentPlacementMovementId,
          quantity, quantityUnit: item.quantityUnit, actualUnitWeightKg: firstLine.actualUnitWeightKg,
          actualTotalWeightKg: parentWeight, actualUnitDimensionsM: firstLine.actualUnitDimensionsM,
          actualTotalVolumeM3: parentVolume, performedBy: actor._id, performedAt: now,
          relocationNote: input.relocationNote, physicalPackingConfirmed: input.physicalPackingConfirmed,
          idempotencyKey: input.idempotencyKey, schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', batchLines: lines });

        const nextSourceWeight = round(Number(source.usedWeightKg) - physicalWeight, 3);
        const nextSourceVolume = round(Number(source.usedVolumeM3) - physicalVolume, 6);
        const nextDestinationWeight = round(Number(destination.usedWeightKg) + physicalWeight, 3);
        const nextDestinationVolume = round(Number(destination.usedVolumeM3) + physicalVolume, 6);
        if (![nextSourceWeight, nextSourceVolume, nextDestinationWeight, nextDestinationVolume].every(Number.isFinite) ||
            nextSourceWeight < -0.001 || nextSourceVolume < -0.000001) return fail(409,
          ManagedStockErrorCode.NEGATIVE_STOCK, 'Relocation would make Cell counters negative');
        const sourceUpdated = await WarehouseCellModel.findOneAndUpdate({ _id: source._id, facilityId: item.facilityId,
          allocationVersion: source.allocationVersion, usedWeightKg: source.usedWeightKg, usedVolumeM3: source.usedVolumeM3,
          $expr: { $and: [{ $gte: ['$usedWeightKg', physicalWeight] }, { $gte: ['$usedVolumeM3', physicalVolume] }] }, ...live },
        { $set: { usedWeightKg: Math.max(0, nextSourceWeight), usedVolumeM3: Math.max(0, nextSourceVolume) } },
        { new: true, session, runValidators: true }).exec();
        if (!sourceUpdated) return fail(409, ManagedStockErrorCode.CELL_COUNTER_MISMATCH, 'Source Cell counters changed during relocation');
        const destinationUpdated = await WarehouseCellModel.findOneAndUpdate({ _id: destination._id, facilityId: item.facilityId,
          rackId: destinationRack._id, zoneId: destination.zoneId, operationalStatus: WarehouseOperationalStatus.AVAILABLE,
          allocationVersion: destination.allocationVersion, usedWeightKg: destination.usedWeightKg, usedVolumeM3: destination.usedVolumeM3,
          $expr: { $and: [{ $lte: [{ $add: ['$usedWeightKg', physicalWeight] }, '$maxWeightKg'] },
            { $lte: [{ $add: ['$usedVolumeM3', physicalVolume] }, destinationVolume] }] }, ...live },
        { $set: { usedWeightKg: nextDestinationWeight, usedVolumeM3: nextDestinationVolume } },
        { new: true, session, runValidators: true }).exec();
        if (!destinationUpdated) return fail(409, ManagedStockErrorCode.CAPACITY_EXCEEDED, 'Destination Cell capacity changed during relocation');

        await movement.save({ session });
        balance.currentCellId = destination._id;
        balance.source = ManagedStockSource.LEDGER_V2; balance.reconciledAt = now;
        balance.reconciledThroughMovementId = movement._id; balance.version += 1;
        await balance.save({ session });
        item.currentCellId = destination._id; item.currentPlacementMovementId = movement._id;
        await item.save({ session });
        const otherSourceItems = [...sourceUsage.itemIds].filter(id => id !== String(item._id));
        sourceAllocation.status = otherSourceItems.length ? CellAllocationStatus.OCCUPIED : CellAllocationStatus.RESERVED;
        await sourceAllocation.save({ session });
        destinationAllocation.status = CellAllocationStatus.OCCUPIED;
        await destinationAllocation.save({ session });
        await ManagedReservationAuditModel.create([{ facilityId: reservation.facilityId, reservationId: reservation._id,
          actorId: actor._id, action: ManagedReservationAction.RELOCATION_CONFIRMED, details: { canonical: true, itemId: item._id,
            movementId: movement._id, sourceCellId: source._id, destinationCellId: destination._id,
            quantity, actualTotalWeightKg: physicalWeight, actualTotalVolumeM3: physicalVolume } }], { session });
        return resultSnapshot(item, movement, false);
      });
    } catch (error) {
      return recover(error, preflight, input, input.idempotencyKey);
    }
  }
}
