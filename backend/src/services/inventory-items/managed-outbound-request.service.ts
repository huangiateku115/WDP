import { createHash } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import InventoryStockBalanceModel from '../../models/inventory-items/inventory-stock-balance.model';
import UserModel from '../../models/users/user.model';
import ManagedOutboundRequestModel from '../../models/inventory-items/managed-outbound-request.model';
import ManagedOutboundRequestEventModel from '../../models/inventory-items/managed-outbound-request-event.model';
import InventoryInboundRequestModel, { inventoryInboundRequestUnresolvedStates } from '../../models/inventory-items/inventory-inbound-request.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { resolveMi06CanonicalOutboundConfirmationGate, resolveMi06CanonicalOutboundGate } from '../../config/mi06-canonical-outbound-gate';
import { ManagedStockErrorCode, ManagedStockSource } from '../../types/managed-stock.type';
import { InventoryItemStatus } from '../../types/inventory-item.type';
import { ItemMovementType } from '../../types/item-movement.type';
import { ManagedOutboundRequestOperation, ManagedOutboundRequestState } from '../../types/managed-outbound-request.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { IUser, UserRole } from '../../types/user.type';
import { reconcileManagedOutboundHolds, allocateManagedOutboundBatches, calculateManagedOutboundConfirmation, assertManagedOutboundRequestTransition } from './managed-outbound-allocation.service';
import { ManagedStockReconciliationError, reconcileManagedCounters, reconcileManagedItemStock } from './managed-stock-ledger.service';
import { precisionUnitsToNumber, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';
type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
type Scope = { itemId: Types.ObjectId;
 reservationId: Types.ObjectId;
 facilityId: Types.ObjectId;
 customerId: Types.ObjectId;
 cellId: Types.ObjectId;
 itemVersion: number | null };
type EventView = { _id: Types.ObjectId;
 payloadHash: string;
 resultSnapshot: Record<string, unknown> };
export class ManagedOutboundRequestError extends Error {  constructor(public readonly status: number, public readonly code: ManagedStockErrorCode, message: string) {    super(message);
 this.name = 'ManagedOutboundRequestError';
  }}
class ReplayAbort extends Error { constructor(public readonly snapshot: Record<string, unknown>) { super('Outbound request replay');
 } }
class ItemTokenConflict extends Error { constructor() { super('Inventory Item serialization token changed');
 } }const fail = (status: number, code: ManagedStockErrorCode, message: string): never => { throw new ManagedOutboundRequestError(status, code, message);
 };
const live = { deletedAt: { $exists: false } };
const gateEnabled = () => resolveMi06CanonicalOutboundGate(process.env.NODE_ENV ?? 'development', process.env.MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED);
const confirmationGateEnabled = () => resolveMi06CanonicalOutboundConfirmationGate(process.env.NODE_ENV ?? 'development', process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED);
const sameId = (a: any, b: any) => String(a?._id ?? a) === String(b?._id ?? b);
function parseId(value: unknown, label: string): Types.ObjectId {  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `Invalid ${label}`);
  return new Types.ObjectId(value);
}
function parseKey(value: unknown): string {  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(value)) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'A valid Idempotency-Key header is required');
  return value;
}
function parseVersion(value: unknown): number {  if (typeof value !== 'string') return fail(428, ManagedStockErrorCode.OUTBOUND_REQUEST_VERSION_CONFLICT, 'If-Match request version is required');
  const match = value.trim().match(/^(?:W\/)?"(0|[1-9]\d*)"$/);
  const version = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(version)) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'If-Match must be a quoted non-negative safe integer');
  return version;
}
function parseCreate(input: unknown): number {  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype ||      Reflect.ownKeys(input).length !== 1 || !Object.hasOwn(input, 'requestedQuantity')) {    return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Payload must contain only requestedQuantity');
  }  const quantity = (input as Record<string, unknown>).requestedQuantity;
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity <= 0) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'requestedQuantity must be a positive safe integer');
  return quantity;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex');
 }
function snapshot(request: any) {  return {    _id: String(request._id), itemId: String(request.itemId), reservationId: String(request.reservationId),    facilityId: String(request.facilityId), requestedQuantity: request.requestedQuantity, quantityUnit: request.quantityUnit,    batchAllocations: (request.batchAllocations ?? []).map((row: any) => ({      batchId: row.batchId, quantity: row.quantity, receiptMovementId: String(row.receiptMovementId),      ...(row.receiptRequestId ? { receiptRequestId: String(row.receiptRequestId) } : {}),      ...(row.receivingInspectionEvidenceId ? { receivingInspectionEvidenceId: String(row.receivingInspectionEvidenceId) } : {}),      receivedAt: new Date(row.receivedAt).toISOString(), arithmeticPolicy: row.arithmeticPolicy,    })),    state: request.state, heldQuantity: request.state === ManagedOutboundRequestState.PENDING ? request.requestedQuantity : 0,    version: request.version, createdAt: request.createdAt, updatedAt: request.updatedAt,    ...(request.cancelledAt ? { cancelledAt: request.cancelledAt } : {}),    ...(request.confirmedMovementId ? { confirmedMovementId: String(request.confirmedMovementId), confirmedQuantity: request.confirmedQuantity,      confirmedBy: String(request.confirmedBy), confirmedAt: request.confirmedAt } : {}),  };
}
function replayResult(event: EventView, payloadHash: string) {  if (event.payloadHash !== payloadHash) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Idempotency key was already used with a different payload');
  return event.resultSnapshot;
}
async function findEvent(itemId: Types.ObjectId, operation: ManagedOutboundRequestOperation, key: string, actorId: Types.ObjectId, session?: ClientSession) {  let query = ManagedOutboundRequestEventModel.findOne({ itemId, operation, idempotencyKey: key, customerId: actorId });
  if (session) query = query.session(session);
  return query.lean().exec() as Promise<EventView | null>;
}
async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {  const session = await mongoose.startSession();
  try {    let result!: T;
    await session.withTransaction(async () => { result = await work(session);
 }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 15_000 });
    return result;
  } finally { await session.endSession();
 }}
async function replayAfterFailure<T>(error: unknown, itemId: Types.ObjectId, operation: ManagedOutboundRequestOperation,  key: string, actorId: Types.ObjectId, payloadHash: string, unresolvedConflict = false): Promise<T> {  if (error instanceof ReplayAbort) return error.snapshot as T;
  if (error instanceof ManagedOutboundRequestError) throw error;
  const e = error as any;
  const unknownCommit = e?.hasErrorLabel?.('UnknownTransactionCommitResult') || e?.errorLabels?.includes?.('UnknownTransactionCommitResult');
  const transient = error instanceof ItemTokenConflict || e?.code === 112 || e?.codeName === 'WriteConflict' || e?.hasErrorLabel?.('TransientTransactionError') || e?.errorLabels?.includes?.('TransientTransactionError');
  const duplicate = e?.code === 11000;
  if (!unknownCommit && !transient && !duplicate) throw error;
  let lastReadError: unknown;
  for (let attempt = 0;
 attempt < 4;
 attempt += 1) {    try {      const event = await findEvent(itemId, operation, key, actorId);
      if (event) return replayResult(event, payloadHash) as T;
    } catch (readError) { lastReadError = readError;
 }    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, [25, 50, 100][attempt]));
  }  if (unknownCommit || lastReadError) return fail(503, ManagedStockErrorCode.OUTBOUND_REQUEST_OUTCOME_UNKNOWN, 'Outbound request outcome is uncertain; retry with the same Idempotency-Key');
  if (unresolvedConflict) {    const existing = await ManagedOutboundRequestModel.findOne({ itemId, state: ManagedOutboundRequestState.PENDING }).select('_id idempotencyKey payloadHash').lean().exec();
    if (existing) {      if (existing.idempotencyKey === key && existing.payloadHash === payloadHash) return fail(503, ManagedStockErrorCode.OUTBOUND_REQUEST_OUTCOME_UNKNOWN, 'Request exists but its committed event is not visible; retry with the same Idempotency-Key');
      if (existing.idempotencyKey === key) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Idempotency key was already used with a different payload');
      return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'An unresolved outbound request already exists for this Item');
    }  }  if (transient) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Inventory changed concurrently; reload and retry');
  return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Outbound request key or lifecycle uniqueness conflict');
}
function translateReconciliation(error: unknown): never {  if (error instanceof ManagedStockReconciliationError) return fail(409, error.code, `Item movement history cannot be reconciled: ${error.message}`);
  throw error;
}
async function readCanonicalState(item: any, session: ClientSession, expectedPendingRequestId?: Types.ObjectId) {  const movements = await ItemMovementModel.find({ itemId: item._id }).session(session).lean().exec();
  const balance = await InventoryStockBalanceModel.findOne({ itemId: item._id }).session(session).exec();
  const requests = await ManagedOutboundRequestModel.find({ itemId: item._id }).session(session).lean().exec();
  if (!balance) return fail(409, ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'A reconciled StockBalance is required before canonical outbound requests');
  let reconciled: ReturnType<typeof reconcileManagedOutboundHolds>;
  try { reconciled = reconcileManagedOutboundHolds({ item: item.toObject(), movements: movements as any[], stockBalance: balance.toObject(), requests: requests as any[] });
 }  catch (error) { return translateReconciliation(error);
 }  if (reconciled.onHandQuantity <= 0 || !item.currentCellId || !sameId(reconciled.ledger.currentCellId, item.currentCellId) ||      !sameId(balance.currentCellId, item.currentCellId) || balance.source !== ManagedStockSource.LEDGER_V2 && balance.source !== ManagedStockSource.LEGACY_RECONCILED) {    return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Canonical stock, Item placement and StockBalance do not agree');
  }  if (requests.some((request: any) => request.state === ManagedOutboundRequestState.PENDING && (!expectedPendingRequestId || !sameId(request._id, expectedPendingRequestId)))) {    return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'An unresolved outbound request already exists for this Item');
  }  return { balance, reconciled, requests };
}
async function lockReservationFence(scope: Pick<Scope, 'reservationId' | 'customerId' | 'facilityId'>,
  session: ClientSession, options: { now?: Date; requireActiveTerm?: boolean }) {
  const identity = { _id: scope.reservationId, customerId: scope.customerId,
    facilityId: scope.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY };
  const current = await ReservationModel.findOne(identity).session(session).exec();
  const now = options.now ?? new Date();
  if (current?.bookingFlowVersion === 3) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Managed V3 stock operations are unavailable until the V3 outbound workflow is enabled');
  if (!current || (options.requireActiveTerm && (current.status !== ReservationStatus.ACTIVE ||
      current.startDate > now || current.endDate <= now))) {
    return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'An in-term ACTIVE Managed Inventory reservation is required');
  }
  const version = Number(current.inventoryVersion ?? 0);
  const versionFilter = version === 0 ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
    : { inventoryVersion: version };
  const eligibility = options.requireActiveTerm ? { status: ReservationStatus.ACTIVE,
    startDate: { $lte: now }, endDate: { $gt: now } } : {};
  const locked = await ReservationModel.findOneAndUpdate({ ...identity, $and: [eligibility, versionFilter] },
    { $inc: { inventoryVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!locked) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT,
    'Reservation lifecycle changed; reload and retry the outbound operation');
  return locked;
}
async function lockActiveReservation(scope: Scope, session: ClientSession, now: Date) {
  // Outbound is intentionally allowed during closure while existing rental-term checks pass.
  return lockReservationFence(scope, session, { now, requireActiveTerm: true });
}
async function preflightOwnedItem(itemId: Types.ObjectId, actorId: Types.ObjectId): Promise<Scope> {  const item = await InventoryItemModel.findOne({ _id: itemId, customerId: actorId, ...live })    .select('_id customerId managedReservationId facilityId currentCellId __v').lean().exec();
  if (!item || !item.currentCellId) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Eligible inventory item not found');
  return { itemId, customerId: actorId, reservationId: item.managedReservationId, facilityId: item.facilityId,    cellId: item.currentCellId, itemVersion: Number.isSafeInteger(item.__v) && item.__v >= 0 ? item.__v : null };
}
function assertCustomer(actor: Actor) { if (actor.role !== UserRole.CUSTOMER) return fail(403, ManagedStockErrorCode.OUTBOUND_REQUEST_FORBIDDEN, 'Customer role required');
 }
function assertCreateGate() {  if (!gateEnabled() || process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() !== 'true') {    return fail(503, ManagedStockErrorCode.OUTBOUND_REQUEST_FEATURE_DISABLED, 'Canonical outbound request creation is disabled');
  }}
function parseConfirmation(input: unknown, idempotencyKeyInput: unknown, ifMatch: unknown) {  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype ||      Reflect.ownKeys(input).length !== 3 || !Object.hasOwn(input, 'actualDeliveredQty') ||      !Object.hasOwn(input, 'handoverConfirmed') || !Object.hasOwn(input, 'handoverNote')) {    return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Payload must contain only actualDeliveredQty, handoverConfirmed and handoverNote');
  }  const body = input as Record<string, unknown>;
  if (typeof body.actualDeliveredQty !== 'number' || !Number.isSafeInteger(body.actualDeliveredQty) || body.actualDeliveredQty <= 0 ||      body.handoverConfirmed !== true || typeof body.handoverNote !== 'string' || !body.handoverNote.trim() || body.handoverNote.length > 1000) {    return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Delivery quantity and staff handover confirmation are invalid');
  }  const key = parseKey(idempotencyKeyInput);
  const expectedVersion = parseVersion(ifMatch);
  return { actualDeliveredQty: body.actualDeliveredQty, handoverConfirmed: true as const,    handoverNote: body.handoverNote.trim(), key, expectedVersion };
}
function assertStaffFacility(actor: Actor, facilityId: unknown) {  if (actor.role !== UserRole.FACILITY_STAFF) return fail(403, ManagedStockErrorCode.OUTBOUND_REQUEST_FORBIDDEN, 'Facility Staff role required');
  if (!(actor as any).assignedFacilityId || String((actor as any).assignedFacilityId) !== String(facilityId)) {    return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
  }}
async function lockOutboundReservation(scope: Scope, session: ClientSession, now: Date) {
  return lockReservationFence(scope, session, { now, requireActiveTerm: true });
}
async function readConfirmationEvent(itemId: Types.ObjectId, key: string, session?: ClientSession) {  let query = ManagedOutboundRequestEventModel.findOne({ itemId, operation: ManagedOutboundRequestOperation.CONFIRM, idempotencyKey: key });
  if (session) query = query.session(session);
  return query.lean().exec() as Promise<any | null>;
}
function confirmationReplay(event: any, requestId: Types.ObjectId, facilityId: Types.ObjectId, payloadHash: string) {  if (!event || !sameId(event.requestId, requestId) || !sameId(event.facilityId, facilityId)) {    return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Idempotency key belongs to another outbound confirmation');
  }  return replayResult(event, payloadHash);
}
async function recoverConfirmation(error: unknown, itemId: Types.ObjectId, requestId: Types.ObjectId,  facilityId: Types.ObjectId, key: string, payloadHash: string) {  if (error instanceof ReplayAbort) return { data: error.snapshot, replayed: true };
  if (error instanceof ManagedOutboundRequestError) throw error;
  const e = error as any;
  const unknownCommit = e?.hasErrorLabel?.('UnknownTransactionCommitResult') || e?.errorLabels?.includes?.('UnknownTransactionCommitResult');
  const transient = error instanceof ItemTokenConflict || e?.code === 112 || e?.codeName === 'WriteConflict' || e?.hasErrorLabel?.('TransientTransactionError') || e?.errorLabels?.includes?.('TransientTransactionError');
  const duplicate = e?.code === 11000;
  if (!unknownCommit && !transient && !duplicate) throw error;
  let readFailed = false;
  for (let attempt = 0;
 attempt < 4;
 attempt += 1) {    try {      const event = await readConfirmationEvent(itemId, key);
      if (event) return { data: confirmationReplay(event, requestId, facilityId, payloadHash), replayed: true };
    } catch { readFailed = true;
 }    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, [25, 50, 100][attempt]));
  }  if (unknownCommit || readFailed) return fail(503, ManagedStockErrorCode.OUTBOUND_REQUEST_OUTCOME_UNKNOWN, 'Confirmation outcome is uncertain; retry with the same Idempotency-Key');
  if (transient) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Inventory changed concurrently; reload and retry');
  return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Confirmation key or request lifecycle uniqueness conflict');
}
async function reconcilePhysicalProjection(focusItemId: Types.ObjectId, reservationId: Types.ObjectId,  facilityId: Types.ObjectId, cellId: Types.ObjectId, session: ClientSession) {  const storedFilter = { currentCellId: { $ne: null }, status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.PENDING_OUTBOUND] }, ...live };
  const cellItems = await InventoryItemModel.find({ ...storedFilter, facilityId, currentCellId: cellId }).session(session).lean().exec();
  const reservationItems = await InventoryItemModel.find({ ...storedFilter, managedReservationId: reservationId, facilityId }).session(session).lean().exec();
  const allItems = new Map<string, any>();
  for (const item of [...cellItems, ...reservationItems]) allItems.set(String(item._id), item);
  if (!allItems.has(String(focusItemId))) return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Confirmed Item is missing from physical stock reconciliation');
  const ids = [...allItems.values()].map(item => item._id);
  const movements = await ItemMovementModel.find({ itemId: { $in: ids } }).session(session).lean().exec();
  const byItem = new Map<string, any[]>();
  for (const movement of movements) {    const key = String(movement.itemId);
 const rows = byItem.get(key) ?? [];
 rows.push(movement);
 byItem.set(key, rows);
  }  const projection = new Map<string, any>();
  for (const [id, item] of allItems) {    try { projection.set(id, reconcileManagedItemStock(item, byItem.get(id) ?? []));
 }    catch (error) { return translateReconciliation(error);
 }  }  const sum = (rows: any[], field: 'actualTotalWeightKg' | 'actualTotalVolumeM3', precision: 3 | 6) => {    const units = sumExactPrecisionUnits(rows.map(row => Number(row[field])), precision);
    const value = units === null ? null : precisionUnitsToNumber(units, precision);
    if (value === null) return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Physical stock totals exceed the safe arithmetic range');
    return value;
  };
  const cellProjection = cellItems.map((item: any) => projection.get(String(item._id))).filter(Boolean);
  const reservationProjection = reservationItems.map((item: any) => projection.get(String(item._id))).filter(Boolean);
  const focus = projection.get(String(focusItemId));
  return {    focus,    cell: { usedWeightKg: sum(cellProjection, 'actualTotalWeightKg', 3), usedVolumeM3: sum(cellProjection, 'actualTotalVolumeM3', 6) },    reservation: { usedWeightKg: sum(reservationProjection, 'actualTotalWeightKg', 3), usedVolumeM3: sum(reservationProjection, 'actualTotalVolumeM3', 6) },    cellItemIds: cellItems.map((item: any) => String(item._id)),  };
}
export class ManagedOutboundRequestService {  static async create(itemIdInput: unknown, input: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<{ data: Record<string, unknown>;
 replayed: boolean }> {    assertCustomer(actor);
    const itemId = parseId(itemIdInput, 'item ID');
 const quantity = parseCreate(input);
 const key = parseKey(idempotencyKeyInput);
    const payloadHash = hash({ operation: ManagedOutboundRequestOperation.CREATE, itemId: String(itemId), requestedQuantity: quantity });
    const prior = await findEvent(itemId, ManagedOutboundRequestOperation.CREATE, key, actor._id);
    if (prior) return { data: replayResult(prior, payloadHash), replayed: true };
    assertCreateGate();
    const scope = await preflightOwnedItem(itemId, actor._id);
    try {      const data = await withTransaction(async session => {        // First transactional DB write: Item serialization token, bound to the exact preflight identity and placement.
        const item = await InventoryItemModel.findOneAndUpdate({ _id: scope.itemId, customerId: scope.customerId,          managedReservationId: scope.reservationId, facilityId: scope.facilityId, currentCellId: scope.cellId,          status: 'IN_STORAGE', __v: scope.itemVersion === null ? { $exists: false } : scope.itemVersion, ...live } as any,        { $inc: { __v: 1 } }, { new: true, session }).exec();
        if (!item) throw new ItemTokenConflict();
        const reservation = await lockActiveReservation(scope, session, new Date());
        if (!(reservation.allocatedCellIds ?? []).some((id: Types.ObjectId) => id.equals(scope.cellId))) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell is not allocated to this reservation');
        const facility = await FacilityModel.findOne({ _id: scope.facilityId, status: FacilityStatus.ACTIVE,          serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).select('_id').lean().exec();
        if (!facility) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Managed Inventory Facility is unavailable');
        const allocation = await CellAllocationModel.findOne({ cellId: scope.cellId, reservationId: scope.reservationId,          facilityId: scope.facilityId, customerId: scope.customerId, status: CellAllocationStatus.OCCUPIED }).session(session).select('_id').lean().exec();
        if (!allocation) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell allocation is not owned by this reservation');
        const inbound = await InventoryInboundRequestModel.findOne({ itemId, reservationId: scope.reservationId,          state: { $in: inventoryInboundRequestUnresolvedStates } }).session(session).select('_id').lean().exec();
        if (inbound) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'An unresolved repeated-inbound request blocks outbound');
        const event = await findEvent(itemId, ManagedOutboundRequestOperation.CREATE, key, actor._id, session);
        if (event) throw new ReplayAbort(replayResult(event, payloadHash));
        const state = await readCanonicalState(item, session);
        if (state.reconciled.availableQuantity < quantity) return fail(409, ManagedStockErrorCode.NEGATIVE_STOCK, 'Requested quantity exceeds available stock');
        const allocations = allocateManagedOutboundBatches(state.balance.toObject(), quantity);
        for (const allocationRow of allocations) {          const batch = state.balance.batches.find((row: any) => row.batchId === allocationRow.batchId);
          if (!batch || batch.heldQuantity + allocationRow.quantity > batch.quantity) return fail(409, ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'Batch hold would exceed on-hand stock');
          batch.heldQuantity += allocationRow.quantity;
        }        state.balance.heldQuantity += quantity;
 state.balance.version += 1;
        await state.balance.save({ session });
        const request = new ManagedOutboundRequestModel({ itemId, reservationId: scope.reservationId,          facilityId: scope.facilityId, customerId: scope.customerId, createdBy: actor._id, createdAt: new Date(),          requestedQuantity: quantity, quantityUnit: (item as any).quantityUnit, batchAllocations: allocations,          state: ManagedOutboundRequestState.PENDING, idempotencyKey: key, payloadHash, version: 0 });
        await request.save({ session });
        const result = snapshot(request);
        await new ManagedOutboundRequestEventModel({ requestId: request._id, itemId, reservationId: scope.reservationId,          facilityId: scope.facilityId, customerId: scope.customerId, actorId: actor._id,          operation: ManagedOutboundRequestOperation.CREATE, idempotencyKey: key, payloadHash,          inputSnapshot: { requestedQuantity: quantity }, resultingState: request.state, resultingVersion: request.version,          resultSnapshot: result, occurredAt: new Date() }).save({ session });
        return result;
      });
      return { data, replayed: false };
    } catch (error) {      return replayAfterFailure<{ data: Record<string, unknown>;
 replayed: boolean }>(error, itemId, ManagedOutboundRequestOperation.CREATE,        key, actor._id, payloadHash, true).then(value => ({ data: value, replayed: true }));
    }  }  static async listForItem(itemIdInput: unknown, query: unknown, actor: Actor) {    assertCustomer(actor);
 const itemId = parseId(itemIdInput, 'item ID');
    const raw = query && typeof query === 'object' && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(raw).some(key => !['page', 'limit'].includes(key))) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Unsupported pagination field');
    const page = raw.page === undefined ? 1 : Number(raw.page);
 const limit = raw.limit === undefined ? 20 : Number(raw.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Invalid page or limit');
    const item = await InventoryItemModel.findOne({ _id: itemId, customerId: actor._id, ...live }).select('_id').lean().exec();
    if (!item) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Inventory item not found');
    const filter = { itemId, customerId: actor._id };
    const [rows, total] = await Promise.all([      ManagedOutboundRequestModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),      ManagedOutboundRequestModel.countDocuments(filter).exec(),    ]);
    return { data: rows.map(snapshot), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }  static async get(requestIdInput: unknown, actor: Actor) {    assertCustomer(actor);
 const requestId = parseId(requestIdInput, 'request ID');
    const request = await ManagedOutboundRequestModel.findOne({ _id: requestId, customerId: actor._id }).lean().exec();
    if (!request) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
    return snapshot(request);
  }  static async cancel(requestIdInput: unknown, ifMatch: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<{ data: Record<string, unknown>;
 replayed: boolean }> {    assertCustomer(actor);
 const requestId = parseId(requestIdInput, 'request ID');
 const expectedVersion = parseVersion(ifMatch);
 const key = parseKey(idempotencyKeyInput);
    const existingRequest = await ManagedOutboundRequestModel.findOne({ _id: requestId, customerId: actor._id }).select('itemId reservationId facilityId').lean().exec();
    if (!existingRequest) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
    const itemId = existingRequest.itemId as Types.ObjectId;
    const payloadHash = hash({ operation: ManagedOutboundRequestOperation.CANCEL, requestId: String(requestId), expectedVersion });
    const prior = await findEvent(itemId, ManagedOutboundRequestOperation.CANCEL, key, actor._id);
    if (prior) return { data: replayResult(prior, payloadHash), replayed: true };
    const scope: Omit<Scope, 'cellId' | 'itemVersion'> = { itemId, customerId: actor._id, reservationId: existingRequest.reservationId as Types.ObjectId,      facilityId: existingRequest.facilityId as Types.ObjectId };
    try {      const data = await withTransaction(async session => {        const preflightItem = await InventoryItemModel.findOne({ _id: scope.itemId, customerId: actor._id,          managedReservationId: scope.reservationId, facilityId: scope.facilityId, status: 'IN_STORAGE', ...live } as any)          .select('_id currentCellId __v').session(session).lean().exec();
        if (!preflightItem?.currentCellId) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Item is not in a cancellable stored state');
        const item = await InventoryItemModel.findOneAndUpdate({ _id: scope.itemId, customerId: actor._id,          managedReservationId: scope.reservationId, facilityId: scope.facilityId, currentCellId: preflightItem.currentCellId,          status: 'IN_STORAGE', __v: Number.isSafeInteger(preflightItem.__v) && preflightItem.__v >= 0 ? preflightItem.__v : { $exists: false },          ...live } as any, { $inc: { __v: 1 } }, { new: true, session }).exec();
        if (!item) throw new ItemTokenConflict();
        // Release of an existing hold is a valid resolution during closure.
        await lockReservationFence(scope, session, { requireActiveTerm: false });
        const event = await findEvent(itemId, ManagedOutboundRequestOperation.CANCEL, key, actor._id, session);
        if (event) throw new ReplayAbort(replayResult(event, payloadHash));
        const request = await ManagedOutboundRequestModel.findOne({ _id: requestId, itemId, customerId: actor._id }).session(session).exec();
        if (!request) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
        if (request.version !== expectedVersion) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_VERSION_CONFLICT, 'If-Match request version is stale');
        if (request.state !== ManagedOutboundRequestState.PENDING) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Only a pending outbound request can be cancelled');
        const balance = await InventoryStockBalanceModel.findOne({ itemId }).session(session).exec();
        if (!balance) return fail(409, ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'StockBalance is missing; holds cannot be safely released');
        const movements = await ItemMovementModel.find({ itemId }).session(session).lean().exec();
        const requests = await ManagedOutboundRequestModel.find({ itemId }).session(session).lean().exec();
        let reconciled;
        try { reconciled = reconcileManagedOutboundHolds({ item: item.toObject(), movements: movements as any[], stockBalance: balance.toObject(), requests: requests as any[] });
 }        catch (error) { return translateReconciliation(error);
 }        if (reconciled.onHandQuantity <= 0 || !sameId(reconciled.ledger.currentCellId, (item as any).currentCellId)) return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Stock placement cannot be reconciled');
        for (const row of request.batchAllocations) {          const batch = balance.batches.find((candidate: any) => candidate.batchId === row.batchId);
          if (!batch || batch.heldQuantity < row.quantity) return fail(409, ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'Request hold is missing or inconsistent');
          batch.heldQuantity -= row.quantity;
        }        if (balance.heldQuantity < request.requestedQuantity) return fail(409, ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'Aggregate held quantity is inconsistent');
        balance.heldQuantity -= request.requestedQuantity;
 balance.version += 1;
        await balance.save({ session });
        const now = new Date();
 request.state = ManagedOutboundRequestState.CANCELLED;
 request.cancelledBy = actor._id;
 request.cancelledAt = now;
        await request.save({ session });
        const result = snapshot(request);
        await new ManagedOutboundRequestEventModel({ requestId, itemId, reservationId: scope.reservationId, facilityId: scope.facilityId,          customerId: actor._id, actorId: actor._id, operation: ManagedOutboundRequestOperation.CANCEL, idempotencyKey: key,          payloadHash, inputSnapshot: { expectedVersion }, resultingState: request.state, resultingVersion: request.version,          resultSnapshot: result, occurredAt: now }).save({ session });
        return result;
      });
      return { data, replayed: false };
    } catch (error) {      return replayAfterFailure<{ data: Record<string, unknown>;
 replayed: boolean }>(error, itemId, ManagedOutboundRequestOperation.CANCEL,        key, actor._id, payloadHash).then(value => ({ data: value, replayed: true }));
    }  }  static async confirm(requestIdInput: unknown, input: unknown, idempotencyKeyInput: unknown, ifMatch: unknown, actor: Actor): Promise<{ data: Record<string, unknown>;
 replayed: boolean }> {    const requestId = parseId(requestIdInput, 'request ID');
    const data = parseConfirmation(input, idempotencyKeyInput, ifMatch);
    const preflight = await ManagedOutboundRequestModel.findOne({ _id: requestId }).lean().exec();
    if (!preflight) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
    assertStaffFacility(actor, preflight.facilityId);
    const itemId = preflight.itemId as Types.ObjectId;
    const facilityId = preflight.facilityId as Types.ObjectId;
    const payloadHash = hash({ operation: ManagedOutboundRequestOperation.CONFIRM, requestId: String(requestId),      expectedVersion: data.expectedVersion, actualDeliveredQty: data.actualDeliveredQty,      handoverConfirmed: data.handoverConfirmed, handoverNote: data.handoverNote });
    const prior = await readConfirmationEvent(itemId, data.key);
    if (prior) return { data: confirmationReplay(prior, requestId, facilityId, payloadHash), replayed: true };
    if (!confirmationGateEnabled() || process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() !== 'true') {      return fail(503, ManagedStockErrorCode.OUTBOUND_REQUEST_FEATURE_DISABLED, 'Canonical outbound confirmation is disabled');
    }    const itemPreflight = await InventoryItemModel.findOne({ _id: itemId, customerId: preflight.customerId,      managedReservationId: preflight.reservationId, facilityId, ...live }).select('_id customerId managedReservationId facilityId currentCellId status __v').lean().exec();
    if (!itemPreflight || !itemPreflight.currentCellId || itemPreflight.status !== InventoryItemStatus.IN_STORAGE) {      return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Outbound request Item is no longer eligible for confirmation');
    }    const itemVersion = Number.isSafeInteger(itemPreflight.__v) && itemPreflight.__v >= 0 ? itemPreflight.__v : null;
    const scope: Scope = { itemId, reservationId: preflight.reservationId as Types.ObjectId, facilityId,      customerId: preflight.customerId as Types.ObjectId, cellId: itemPreflight.currentCellId as Types.ObjectId, itemVersion };
    try {      const result = await withTransaction(async session => {        // First transactional operation/write: serialize the same Item used by legacy outbound and relocation.
        const item = await InventoryItemModel.findOneAndUpdate({ _id: scope.itemId, customerId: scope.customerId,          managedReservationId: scope.reservationId, facilityId: scope.facilityId, currentCellId: scope.cellId,          status: InventoryItemStatus.IN_STORAGE,          __v: scope.itemVersion === null ? { $exists: false } : scope.itemVersion, ...live } as any,        { $inc: { __v: 1 } }, { new: true, session }).exec();
        if (!item) throw new ItemTokenConflict();
        const request = await ManagedOutboundRequestModel.findOne({ _id: requestId, itemId: scope.itemId,          reservationId: scope.reservationId, facilityId: scope.facilityId, customerId: scope.customerId }).session(session).exec();
        if (!request) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
        const event = await readConfirmationEvent(itemId, data.key, session);
        if (event) throw new ReplayAbort(confirmationReplay(event, requestId, facilityId, payloadHash));
        assertManagedOutboundRequestTransition({ from: request.state, to: data.actualDeliveredQty < request.requestedQuantity          ? ManagedOutboundRequestState.PARTIALLY_FULFILLED : ManagedOutboundRequestState.CONFIRMED,          expectedVersion: data.expectedVersion, currentVersion: request.version });
        if (request.state !== ManagedOutboundRequestState.PENDING) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Only a pending canonical outbound request can be confirmed');
        if (data.actualDeliveredQty > request.requestedQuantity) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Delivered quantity exceeds the held request quantity');
        const cell = await WarehouseCellModel.findOne({ _id: scope.cellId, facilityId: scope.facilityId, ...live }).session(session).exec();
        if (!cell) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell is missing or outside the Item Facility');
        const zone = await WarehouseZoneModel.findOneAndUpdate({ _id: cell.zoneId, facilityId: scope.facilityId, ...live },          { $inc: { structureVersion: 1 } }, { new: true, session, runValidators: true }).exec();
        if (!zone) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell Zone is missing');
        const now = new Date();
        const reservation = await lockOutboundReservation(scope, session, now);
        if (!(reservation.allocatedCellIds ?? []).some((id: Types.ObjectId) => id.equals(scope.cellId))) {          return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell is not allocated to this reservation');
        }        const rack = await WarehouseRackModel.findOneAndUpdate({ _id: cell.rackId, facilityId: scope.facilityId,          zoneId: cell.zoneId, ...live }, { $inc: { layoutVersion: 1 } }, { new: true, session, runValidators: true }).exec();
        if (!rack) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell Rack is missing');
        const lockedCell = await WarehouseCellModel.findOneAndUpdate({ _id: cell._id, facilityId: scope.facilityId,          rackId: rack._id, zoneId: zone._id, ...live }, { $inc: { allocationVersion: 1 } },        { new: true, session, runValidators: true }).exec();
        if (!lockedCell) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Current Cell changed; reload and retry');
        const facility = await FacilityModel.findOne({ _id: scope.facilityId, status: FacilityStatus.ACTIVE,          serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).select('_id').lean().exec();
        if (!facility) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Managed Inventory Facility is unavailable');
        const allocation = await CellAllocationModel.findOne({ cellId: scope.cellId, reservationId: scope.reservationId,          facilityId: scope.facilityId, customerId: scope.customerId, status: CellAllocationStatus.OCCUPIED }).session(session).exec();
        if (!allocation) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Current Cell allocation is not owned by this reservation');
        const inbound = await InventoryInboundRequestModel.findOne({ itemId, reservationId: scope.reservationId,          state: { $in: inventoryInboundRequestUnresolvedStates } }).session(session).select('_id').lean().exec();
        if (inbound) return fail(409, ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'An unresolved repeated-inbound request blocks outbound confirmation');
        const canonical = await readCanonicalState(item, session, request._id);
        const physical = await reconcilePhysicalProjection(itemId, scope.reservationId, scope.facilityId, scope.cellId, session);
        if (!sameId(physical.focus.currentCellId, scope.cellId) || !physical.cellItemIds.includes(String(itemId))) {          return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Item stock and current Cell placement do not reconcile');
        }        try { reconcileManagedCounters(physical.cell, lockedCell.toObject(), reservation.toObject(), physical.reservation.usedVolumeM3);
 }        catch (error) { return translateReconciliation(error);
 }        const projection = calculateManagedOutboundConfirmation({ stockBalance: canonical.balance.toObject(), request: request.toObject(), deliveredQuantity: data.actualDeliveredQty });
        const weightDelta = projection.counterDeltas.weightKg;
        const volumeDelta = projection.counterDeltas.volumeM3;
        if (weightDelta === null || volumeDelta === null || !Number.isFinite(Number(reservation.usedCapacityM3))) {          return fail(409, ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Physical counter deltas or reservation usage are unavailable');
        }        const movement = new ItemMovementModel({ itemId, managedReservationId: scope.reservationId, facilityId: scope.facilityId,          customerId: scope.customerId, type: ItemMovementType.OUTBOUND, sourceCellId: scope.cellId, destinationCellId: null,          quantity: projection.movement.quantity, quantityUnit: projection.movement.quantityUnit,          actualUnitWeightKg: projection.movement.actualUnitWeightKg, actualUnitDimensionsM: projection.movement.actualUnitDimensionsM,          actualTotalWeightKg: projection.movement.actualTotalWeightKg, actualTotalVolumeM3: projection.movement.actualTotalVolumeM3,          performedBy: actor._id, performedAt: now, handoverNote: data.handoverNote, idempotencyKey: data.key,          schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', batchLines: projection.movement.batchLines });
        const nextCellWeight = Number((physical.cell.usedWeightKg - weightDelta).toFixed(3));
        const nextCellVolume = Number((physical.cell.usedVolumeM3 - volumeDelta).toFixed(6));
        const nextReservationVolume = Number((physical.reservation.usedVolumeM3 - volumeDelta).toFixed(6));
        if (![nextCellWeight, nextCellVolume, nextReservationVolume].every(Number.isFinite) ||            nextCellWeight < -0.001 || nextCellVolume < -0.000001 || nextReservationVolume < -0.000001) {          return fail(409, ManagedStockErrorCode.NEGATIVE_STOCK, 'Outbound would make physical counters negative');
        }        if (Math.abs(lockedCell.usedWeightKg - physical.cell.usedWeightKg) > 0.001 ||            Math.abs(lockedCell.usedVolumeM3 - physical.cell.usedVolumeM3) > 0.000001 ||            Math.abs(Number(reservation.usedCapacityM3) - physical.reservation.usedVolumeM3) > 0.000001) {          return fail(409, ManagedStockErrorCode.CELL_COUNTER_MISMATCH, 'Physical counters changed during reconciliation');
        }        // All following state changes share the transaction; immutable movement is saved with its request/event references.
        await movement.save({ session });
        canonical.balance.set({ currentCellId: projection.nextBalance.currentCellId, batches: projection.nextBalance.batches,          onHandQuantity: projection.nextBalance.onHandQuantity, heldQuantity: projection.nextBalance.heldQuantity,          actualTotalWeightKg: projection.nextBalance.actualTotalWeightKg, actualTotalVolumeM3: projection.nextBalance.actualTotalVolumeM3,          source: ManagedStockSource.LEDGER_V2, reconciledAt: now, reconciledThroughMovementId: movement._id,          version: canonical.balance.version + 1 });
        await canonical.balance.save({ session });
        const updatedCell = await WarehouseCellModel.findOneAndUpdate({ _id: lockedCell._id, facilityId: scope.facilityId,          allocationVersion: lockedCell.allocationVersion, usedWeightKg: lockedCell.usedWeightKg, usedVolumeM3: lockedCell.usedVolumeM3,          ...live, $expr: { $and: [{ $gte: ['$usedWeightKg', weightDelta] },            { $gte: ['$usedVolumeM3', volumeDelta] }] } },        { $set: { usedWeightKg: Math.max(0, nextCellWeight), usedVolumeM3: Math.max(0, nextCellVolume) } },        { new: true, session, runValidators: true }).exec();
        if (!updatedCell) return fail(409, ManagedStockErrorCode.CELL_COUNTER_MISMATCH, 'Cell counters changed or would become negative');
        reservation.usedCapacityM3 = Math.max(0, nextReservationVolume);
        await reservation.save({ session });
        item.status = projection.itemTransition.status as InventoryItemStatus;
        item.currentCellId = projection.itemTransition.currentCellId as any;
        if (projection.onHandQuantity === 0) {          item.outboundConfirmedAt = now;
 item.outboundConfirmedBy = actor._id;
 item.outboundMovementId = movement._id;
          item.currentPlacementMovementId = null;
        } else {
          const placementMovementId = physical.focus.currentPlacementMovementId;
          if (!placementMovementId || !Types.ObjectId.isValid(placementMovementId)) {
            return fail(409, ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'Positive stock has no reconciled placement movement');
          }
          item.currentPlacementMovementId = new Types.ObjectId(placementMovementId);
        }        await item.save({ session });
        if (projection.onHandQuantity === 0) {          const otherStored = await InventoryItemModel.findOne({ _id: { $ne: itemId }, currentCellId: scope.cellId,            facilityId: scope.facilityId, status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.PENDING_OUTBOUND] }, ...live })            .session(session).select('_id').lean().exec();
          allocation.status = otherStored ? CellAllocationStatus.OCCUPIED : CellAllocationStatus.RESERVED;
          await allocation.save({ session });
        }        request.state = projection.requestState;
 request.confirmedMovementId = movement._id;
        request.confirmedBy = actor._id;
 request.confirmedAt = now;
 request.confirmedQuantity = projection.fulfilledQuantity;
        await request.save({ session });
        const requestSnapshot = snapshot(request);
        const resultSnapshot = { ...requestSnapshot, movementId: String(movement._id), currentQuantity: projection.onHandQuantity,          heldQuantity: projection.heldQuantity, availableQuantity: projection.availableQuantity,          actualTotalWeightKg: projection.nextBalance.actualTotalWeightKg, actualTotalVolumeM3: projection.nextBalance.actualTotalVolumeM3 };
        await new ManagedOutboundRequestEventModel({ requestId, itemId, reservationId: scope.reservationId, facilityId: scope.facilityId,          customerId: scope.customerId, actorId: actor._id, operation: ManagedOutboundRequestOperation.CONFIRM,          idempotencyKey: data.key, payloadHash, inputSnapshot: { expectedVersion: data.expectedVersion,            actualDeliveredQty: data.actualDeliveredQty, handoverConfirmed: true, handoverNote: data.handoverNote },          resultingState: request.state, resultingVersion: request.version, resultSnapshot, occurredAt: now,          movementId: movement._id, confirmedQuantity: projection.fulfilledQuantity }).save({ session });
        return resultSnapshot;
      });
      return { data: result, replayed: false };
    } catch (error) {      return recoverConfirmation(error, itemId, requestId, facilityId, data.key, payloadHash);
    }  }
  static async staffQueue(queryInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF) return fail(403, ManagedStockErrorCode.OUTBOUND_REQUEST_FORBIDDEN, 'Facility Staff role required');
    if (!actor.assignedFacilityId) return fail(403, ManagedStockErrorCode.OUTBOUND_REQUEST_FORBIDDEN, 'Staff Facility assignment is required');
    const raw = queryInput && typeof queryInput === 'object' && !Array.isArray(queryInput) ? queryInput as Record<string, unknown> : {};
    if (Object.keys(raw).some(key => !['state', 'page', 'limit'].includes(key))) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Unsupported queue filter');
    const state = raw.state === undefined || raw.state === '' ? ManagedOutboundRequestState.PENDING : raw.state;
    if (!Object.values(ManagedOutboundRequestState).includes(state as ManagedOutboundRequestState)) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Invalid outbound request state');
    const page = raw.page === undefined ? 1 : Number(raw.page);
    const limit = raw.limit === undefined ? 20 : Number(raw.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return fail(400, ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Invalid page or limit');
    const filter = { facilityId: actor.assignedFacilityId, state };
    const [rows, total] = await Promise.all([
      ManagedOutboundRequestModel.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      ManagedOutboundRequestModel.countDocuments(filter).exec(),
    ]);
    const itemIds = rows.map((row: any) => row.itemId);
    const items = await InventoryItemModel.find({ _id: { $in: itemIds }, facilityId: actor.assignedFacilityId, ...live })
      .select('_id itemCode name category status currentCellId quantity quantityUnit managedReservationId facilityId').lean().exec();
    const byId = new Map(items.map((item: any) => [String(item._id), item]));
    const data = rows.filter((row: any) => byId.has(String(row.itemId))).map((row: any) => ({
      ...snapshot(row), item: byId.get(String(row.itemId)),
    }));
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  static async staffDetail(requestIdInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF) return fail(403, ManagedStockErrorCode.OUTBOUND_REQUEST_FORBIDDEN, 'Facility Staff role required');
    if (!actor.assignedFacilityId) return fail(403, ManagedStockErrorCode.OUTBOUND_REQUEST_FORBIDDEN, 'Staff Facility assignment is required');
    const requestId = parseId(requestIdInput, 'request ID');
    const request = await ManagedOutboundRequestModel.findOne({ _id: requestId, facilityId: actor.assignedFacilityId }).lean().exec();
    if (!request) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
    const [item, balance, customer] = await Promise.all([
      InventoryItemModel.findOne({ _id: request.itemId, facilityId: actor.assignedFacilityId, managedReservationId: request.reservationId, ...live })
        .select('_id itemCode name category status currentCellId quantity quantityUnit managedReservationId facilityId').lean().exec(),
      InventoryStockBalanceModel.findOne({ itemId: request.itemId, facilityId: actor.assignedFacilityId }).lean().exec(),
      UserModel.findOne({ _id: request.customerId }).select('_id displayName').lean().exec(),
    ]);
    if (!item || !customer) return fail(404, ManagedStockErrorCode.OUTBOUND_REQUEST_NOT_FOUND, 'Outbound request not found');
    return { request: snapshot(request), item, customer, stock: balance ? {
      currentQty: balance.onHandQuantity, heldQty: balance.heldQuantity,
      availableQty: balance.onHandQuantity - balance.heldQuantity, currentCellId: balance.currentCellId,
      source: balance.source, version: balance.version,
    } : null };
  }
}
