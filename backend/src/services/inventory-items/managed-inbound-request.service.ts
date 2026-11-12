import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import InventoryInboundRequestModel, { inventoryInboundRequestUnresolvedStates } from '../../models/inventory-items/inventory-inbound-request.model';
import InventoryInboundRequestEventModel from '../../models/inventory-items/inventory-inbound-request-event.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { resolveMi06BRepeatedInboundGate } from '../../config/mi06b-feature-gate';
import { IInventoryInboundRequest, InventoryInboundCustodyState, InventoryInboundRequestState } from '../../types/inventory-inbound-request.type';
import { InventoryInboundRequestEventFields, InventoryInboundRequestEventOperation as Operation, InventoryInboundRequestEventScopeType as ScopeType } from '../../types/inventory-inbound-request-event.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { IUser, UserRole } from '../../types/user.type';
import { ManagedStockErrorCode } from '../../types/managed-stock.type';
import { ManagedStockReconciliationError, reconcileManagedItemStock } from './managed-stock-ledger.service';
import { canonicalReceiptPayloadHash, canAmendReceiptRequest, validateReceiptPhysicalPayload } from './inventory-inbound-request.lifecycle';

type Actor = Pick<IUser, '_id' | 'role'>;
type Scope = { itemId: Types.ObjectId; reservationId: Types.ObjectId; facilityId: Types.ObjectId; customerId: Types.ObjectId };
type ReceiptPayload = { requestedQuantity: number; quantityUnit: string; declaredUnitWeightKg: number; declaredUnitDimensionsM: { widthM: number; depthM: number; heightM: number } };
type ReceiptPayloadPatch = Partial<ReceiptPayload>;
export type ReceiptCreateResult = { data: Record<string, unknown>; replayed: boolean };

export class InventoryInboundRequestError extends Error {
  constructor(public readonly status: number, public readonly code: ManagedStockErrorCode, message: string) {
    super(message);
    this.name = 'InventoryInboundRequestError';
  }
}

class ReplayAbort extends Error {
  constructor(public readonly snapshot: Record<string, unknown>) { super('Idempotent replay'); }
}

const fail = (status: number, code: ManagedStockErrorCode, message: string): never => { throw new InventoryInboundRequestError(status, code, message); };
const live = { deletedAt: { $exists: false } };
const enabled = () => resolveMi06BRepeatedInboundGate(process.env.NODE_ENV ?? 'development', process.env.MI06_REPEATED_INBOUND_ENABLED);

function assertEnabled() {
  if (!enabled()) fail(404, ManagedStockErrorCode.INBOUND_REQUEST_FEATURE_DISABLED, 'Repeated inbound requests are not available');
}

function assertCustomer(actor: Actor): void {
  if (actor.role !== UserRole.CUSTOMER) fail(403, ManagedStockErrorCode.INBOUND_REQUEST_FORBIDDEN, 'Customer role required');
}

function parseId(value: unknown, label: string): Types.ObjectId {
  if (typeof value !== 'string') return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
  if (!/^[a-f\d]{24}$/i.test(value)) return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
  return new Types.ObjectId(value);
}

function plainObject(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !allowed.includes(key) || key.startsWith('$'))) {
    return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function parseDimensions(value: unknown, label: string): ReceiptPayload['declaredUnitDimensionsM'] {
  const expected = ['widthM', 'depthM', 'heightM'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key)) ||
      Object.keys(value).length !== expected.length || Object.keys(value).some(key => !Object.hasOwn(value, key))) {
    return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
    }
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, `Invalid ${label}`);
  }
  const record = value as Record<string, unknown>;
  return { widthM: record.widthM as number, depthM: record.depthM as number, heightM: record.heightM as number };
}

function parseKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(value)) {
    return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'A valid Idempotency-Key header is required');
  }
  return value;
}

function parseIfMatch(value: unknown): number {
  if (typeof value !== 'string') return fail(428, ManagedStockErrorCode.INBOUND_REQUEST_VERSION_CONFLICT, 'If-Match request version is required');
  const match = value.trim().match(/^(?:W\/)?"(0|[1-9]\d*)"$/);
  if (!match) return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'If-Match must contain a quoted non-negative request version');
  const version = Number(match[1]!);
  if (!Number.isSafeInteger(version)) return fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'If-Match request version is invalid');
  return version;
}

function parsePayload(input: unknown, allowed = ['requestedQuantity', 'quantityUnit', 'declaredUnitWeightKg', 'declaredUnitDimensionsM']): ReceiptPayload {
  const value = plainObject(input, allowed, 'receipt request payload');
  const payload = {
    requestedQuantity: value.requestedQuantity as number,
    quantityUnit: typeof value.quantityUnit === 'string' ? value.quantityUnit.trim() : value.quantityUnit as string,
    declaredUnitWeightKg: value.declaredUnitWeightKg as number,
    declaredUnitDimensionsM: parseDimensions(value.declaredUnitDimensionsM, 'declaredUnitDimensionsM'),
  };
  try { validateReceiptPhysicalPayload(payload); }
  catch (error) { fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, (error as Error).message); }
  const volume = payload.declaredUnitDimensionsM.widthM * payload.declaredUnitDimensionsM.depthM * payload.declaredUnitDimensionsM.heightM;
  if (!Number.isFinite(volume) || !Number.isFinite(volume * payload.requestedQuantity) ||
      !Number.isFinite(payload.declaredUnitWeightKg * payload.requestedQuantity)) {
    fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'Declared physical totals must remain finite');
  }
  return payload;
}

function parsePayloadPatch(input: unknown): ReceiptPayloadPatch {
  const value = plainObject(input, ['requestedQuantity', 'quantityUnit', 'declaredUnitWeightKg', 'declaredUnitDimensionsM'], 'receipt request amendment');
  if (!Object.keys(value).length) fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'At least one receipt field must be amended');
  const patch: ReceiptPayloadPatch = {};
  if (Object.hasOwn(value, 'requestedQuantity')) patch.requestedQuantity = value.requestedQuantity as number;
  if (Object.hasOwn(value, 'quantityUnit')) patch.quantityUnit = typeof value.quantityUnit === 'string' ? value.quantityUnit.trim() : value.quantityUnit as string;
  if (Object.hasOwn(value, 'declaredUnitWeightKg')) patch.declaredUnitWeightKg = value.declaredUnitWeightKg as number;
  if (Object.hasOwn(value, 'declaredUnitDimensionsM')) patch.declaredUnitDimensionsM = parseDimensions(value.declaredUnitDimensionsM, 'declaredUnitDimensionsM');
  return patch;
}

function validateMergedPayload(payload: ReceiptPayload): void {
  try { validateReceiptPhysicalPayload(payload); }
  catch (error) { fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, (error as Error).message); }
  const volume = payload.declaredUnitDimensionsM.widthM * payload.declaredUnitDimensionsM.depthM * payload.declaredUnitDimensionsM.heightM;
  if (!Number.isFinite(volume) || !Number.isFinite(volume * payload.requestedQuantity) ||
      !Number.isFinite(payload.declaredUnitWeightKg * payload.requestedQuantity)) {
    fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'Declared physical totals must remain finite');
  }
}

function requestDto(request: IInventoryInboundRequest | Record<string, any>): Record<string, unknown> {
  const value: any = request;
  return {
    _id: String(value._id), itemId: String(value.itemId), reservationId: String(value.reservationId),
    facilityId: String(value.facilityId), requestedQuantity: value.requestedQuantity, quantityUnit: value.quantityUnit,
    declaredUnitWeightKg: value.declaredUnitWeightKg, declaredUnitDimensionsM: value.declaredUnitDimensionsM,
    state: value.state, custodyState: value.custodyState,
    ...(value.currentInspectionAttemptId ? { currentInspectionAttemptId: String(value.currentInspectionAttemptId) } : {}),
    ...(value.acceptedEvidenceSnapshotId ? { acceptedEvidenceSnapshotId: String(value.acceptedEvidenceSnapshotId) } : {}),
    ...(value.confirmedMovementId ? { confirmedMovementId: String(value.confirmedMovementId) } : {}),
    version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

type RequestEventView = InventoryInboundRequestEventFields & { _id: Types.ObjectId };

function eventDto(event: RequestEventView): Record<string, unknown> {
  return (event as any).resultSnapshot as Record<string, unknown>;
}

function sameHash(event: RequestEventView, payloadHash: string) {
  if (event.payloadHash !== payloadHash) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with a different payload');
  return eventDto(event);
}

async function findReplay(scopeType: ScopeType, scopeId: Types.ObjectId, operation: Operation, key: string,
  actorId: Types.ObjectId, session?: ClientSession) {
  let query = InventoryInboundRequestEventModel.findOne({ scopeType, scopeId, operation, idempotencyKey: key, customerId: actorId });
  if (session) query = query.session(session);
  return query.lean().exec();
}

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: 15_000 });
    return result;
  } finally { await session.endSession(); }
}

async function replayAfterFailure<T>(error: unknown, scopeType: ScopeType, scopeId: Types.ObjectId, operation: Operation,
  key: string, actorId: Types.ObjectId, payloadHash: string,
  onReplay: (snapshot: Record<string, unknown>) => T = snapshot => snapshot as T,
  unresolvedItemId?: Types.ObjectId,
  createPayloadHash?: string): Promise<T> {
  if (error instanceof ReplayAbort) return onReplay(error.snapshot);
  if (error instanceof InventoryInboundRequestError) throw error;
  const e = error as any;
  const unknownCommit = e?.hasErrorLabel?.('UnknownTransactionCommitResult') || e?.errorLabels?.includes?.('UnknownTransactionCommitResult');
  const transient = e?.name === 'VersionError' || e?.code === 112 || e?.codeName === 'WriteConflict' ||
    e?.hasErrorLabel?.('TransientTransactionError') || e?.errorLabels?.includes?.('TransientTransactionError');
  const duplicate = e?.code === 11000;
  if (unknownCommit || transient || duplicate) {
    let event: RequestEventView | null = null;
    let recoveryError: unknown;
    // Bounded visibility recovery: initial read plus at most three short-delay retries.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        event = await findReplay(scopeType, scopeId, operation, key, actorId);
        if (event) return onReplay(sameHash(event, payloadHash) as Record<string, unknown>);
      } catch (readError) { recoveryError = readError; }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, [25, 50, 100][attempt]));
    }
    if (unknownCommit || recoveryError) {
      fail(503, ManagedStockErrorCode.INBOUND_REQUEST_OUTCOME_UNKNOWN, 'Receipt request outcome is not yet confirmed; retry with the same Idempotency-Key');
    }
    if (unresolvedItemId) {
      if (duplicate) {
        let sameKeyRequest;
        try {
          sameKeyRequest = await InventoryInboundRequestModel.findOne({ itemId: unresolvedItemId, requestIdempotencyKey: key })
            .select('creationPayloadHash').lean().exec();
        } catch {
          fail(503, ManagedStockErrorCode.INBOUND_REQUEST_OUTCOME_UNKNOWN, 'Receipt request outcome is not yet confirmed; retry with the same Idempotency-Key');
        }
        if (sameKeyRequest) {
          if (createPayloadHash && sameKeyRequest.creationPayloadHash !== createPayloadHash) {
            fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with a different payload');
          }
          // Request exists without its atomic event visible; never claim success or mislabel this as another-key conflict.
          fail(503, ManagedStockErrorCode.INBOUND_REQUEST_OUTCOME_UNKNOWN, 'Receipt request outcome is not yet confirmed; retry with the same Idempotency-Key');
        }
      }
      const unresolved = await InventoryInboundRequestModel.findOne({ itemId: unresolvedItemId,
        state: { $in: inventoryInboundRequestUnresolvedStates } }).lean().exec();
      if (unresolved) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_UNRESOLVED_EXISTS, 'An unresolved receipt request already exists for this Item');
    }
  }
  if (transient) {
    fail(409, ManagedStockErrorCode.INBOUND_REQUEST_VERSION_CONFLICT, 'Receipt request changed concurrently; reload and retry');
  }
  if (duplicate) {
    if (String(e?.message ?? '').includes('inventory_inbound_request_one_unresolved_per_item')) {
      fail(409, ManagedStockErrorCode.INBOUND_REQUEST_UNRESOLVED_EXISTS, 'An unresolved receipt request already exists for this Item');
    }
    fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Receipt request key or version already exists');
  }
  if (e?.name === 'ValidationError' || e?.name === 'CastError') fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'Invalid receipt request data');
  throw error;
}

async function preflightItem(itemId: Types.ObjectId, customerId: Types.ObjectId): Promise<Scope> {
  const item = await InventoryItemModel.findOne({ _id: itemId, customerId, ...live }).select('_id managedReservationId facilityId customerId').lean().exec();
  if (!item) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Inventory item not found');
  return { itemId, reservationId: item.managedReservationId, facilityId: item.facilityId, customerId };
}

async function lockItemForRequest(scope: Scope, session: ClientSession) {
  const item = await InventoryItemModel.findOne({ _id: scope.itemId, customerId: scope.customerId,
    managedReservationId: scope.reservationId, facilityId: scope.facilityId,
    status: { $in: ['IN_STORAGE', 'CHECKED_OUT'] }, ...live } as any).select('_id __v').session(session).lean().exec() as any;
  if (!item) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Item changed or is not eligible for a repeated receipt request');
  const versionFilter = Number.isSafeInteger(item.__v) ? { __v: item.__v } : { __v: { $exists: false } };
  const locked = await InventoryItemModel.findOneAndUpdate({ _id: scope.itemId, customerId: scope.customerId,
    managedReservationId: scope.reservationId, facilityId: scope.facilityId,
    status: { $in: ['IN_STORAGE', 'CHECKED_OUT'] }, ...versionFilter, ...live } as any,
  { $inc: { __v: 1 } }, { new: true, session }).exec();
  if (!locked) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_VERSION_CONFLICT, 'Item changed concurrently; reload and retry');
  return locked;
}

async function lockReservationFence(scope: Scope, session: ClientSession, options: { now?: Date; rejectClosure: boolean }) {
  const identity = { _id: scope.reservationId, customerId: scope.customerId, facilityId: scope.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY };
  const current = await ReservationModel.findOne(identity as any).session(session).exec() as any;
  if (!current) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Managed reservation is missing or outside Item scope');
  if (current.bookingFlowVersion === 3) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Managed V3 stock operations are unavailable until the V3 inbound workflow is enabled');
  if (options.rejectClosure && current.activeClosureRequestId) {
    return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Inbound changes are blocked while reservation closure is pending');
  }
  if (options.now && (current.status !== ReservationStatus.ACTIVE || current.startDate > options.now || current.endDate <= options.now)) {
    return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'An in-term ACTIVE Managed Inventory reservation is required');
  }
  const observedVersion = Number(current.inventoryVersion ?? 0);
  const versionFilter = observedVersion === 0
    ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
    : { inventoryVersion: observedVersion };
  const locked = await ReservationModel.findOneAndUpdate({ ...identity, ...versionFilter,
    ...(options.now ? { status: ReservationStatus.ACTIVE, startDate: { $lte: options.now }, endDate: { $gt: options.now } } : {}),
    ...(options.rejectClosure ? { activeClosureRequestId: null } : {}) } as any,
  { $inc: { inventoryVersion: 1 } }, { new: true, session, runValidators: true }).exec() as any;
  if (!locked) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_VERSION_CONFLICT, 'Reservation lifecycle changed concurrently; reload and retry');
  return locked;
}

async function lockActiveReservation(scope: Scope, session: ClientSession, now: Date) {
  return lockReservationFence(scope, session, { now, rejectClosure: true });
}

async function assertCurrentItemAndStock(scope: Scope, session: ClientSession) {
  const item = await InventoryItemModel.findOne({ _id: scope.itemId, customerId: scope.customerId,
    managedReservationId: scope.reservationId, facilityId: scope.facilityId, ...live }).session(session).exec();
  if (!item) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Inventory item not found');
  const facility = await FacilityModel.findOne({ _id: scope.facilityId, status: FacilityStatus.ACTIVE,
    serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).exec();
  if (!facility) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'An active Managed Inventory Facility is required');
  const movements = await ItemMovementModel.find({ itemId: item._id }).session(session).lean().exec();
  let stock;
  try { stock = reconcileManagedItemStock(item as any, movements as any[]); }
  catch (error) {
    if (error instanceof ManagedStockReconciliationError) {
      return fail(409, error.code, `Item movement history cannot be reconciled: ${error.message}`);
    }
    throw error;
  }
  if (item.quantityUnit !== item.quantityUnit.trim()) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Item quantity unit is invalid');
  if (item.status === 'IN_STORAGE') {
    if (!Number.isSafeInteger(stock.onHandQuantity) || stock.onHandQuantity <= 0 || !item.currentCellId ||
        String(stock.currentCellId) !== String(item.currentCellId)) {
      return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Stored Item has no reconciled positive stock and current Cell');
    }
    const cell = await WarehouseCellModel.findOne({ _id: item.currentCellId, facilityId: item.facilityId, ...live }).session(session).exec();
    if (!cell) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Current Cell is missing or outside the Item Facility');
    const allocation = await CellAllocationModel.findOne({ cellId: item.currentCellId, reservationId: scope.reservationId,
      facilityId: scope.facilityId, customerId: scope.customerId, status: CellAllocationStatus.OCCUPIED }).session(session).exec();
    if (!allocation) return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Current Cell must be OCCUPIED by the Item reservation');
    return { item, stock };
  }
  if (item.status === 'CHECKED_OUT') {
    const terminalMovementId = stock.reconciledThroughMovementId == null ? null : String(stock.reconciledThroughMovementId);
    const lastMovement = terminalMovementId ? movements.find(movement => String((movement as any)._id) === terminalMovementId) as any : null;
    if (stock.onHandQuantity !== 0 || stock.currentCellId !== null || item.currentCellId !== null ||
        !item.outboundMovementId || !lastMovement || lastMovement.type !== 'OUTBOUND' ||
        String(lastMovement._id) !== String(item.outboundMovementId)) {
      return fail(409, ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'Checked-out Item must have zero reconciled stock, no Cell and a matching terminal OUTBOUND movement');
    }
    return { item, stock };
  }
  return fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Only reconciled IN_STORAGE or CHECKED_OUT Items can request a repeated receipt');
}

function makeEvent(request: IInventoryInboundRequest, actorId: Types.ObjectId, operation: Operation, scopeType: ScopeType,
  scopeId: Types.ObjectId, key: string, payloadHash: string, inputSnapshot: Record<string, unknown>, snapshot: Record<string, unknown>) {
  return new InventoryInboundRequestEventModel({ requestId: request._id, itemId: request.itemId, reservationId: request.reservationId,
    facilityId: request.facilityId, customerId: request.customerId, actorId, operation, scopeType, scopeId,
    idempotencyKey: key, payloadHash, inputSnapshot, resultingState: request.state, resultingVersion: request.version,
    resultSnapshot: snapshot, occurredAt: new Date() });
}

export class ManagedInboundRequestService {
  static async create(itemIdInput: unknown, input: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<ReceiptCreateResult> {
    assertEnabled(); assertCustomer(actor);
    const itemId = parseId(itemIdInput, 'item ID');
    const key = parseKey(idempotencyKeyInput);
    const replayScope = { scopeType: ScopeType.ITEM, scopeId: itemId };
    const existing = await findReplay(replayScope.scopeType, replayScope.scopeId, Operation.CREATE, key, actor._id);
    let payload: ReceiptPayload;
    try { payload = parsePayload(input); }
    catch (error) {
      if (existing) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with a different payload');
      throw error;
    }
    const payloadHash = canonicalReceiptPayloadHash({ operation: Operation.CREATE, itemId, payload });
    if (existing) return { data: sameHash(existing, payloadHash) as Record<string, unknown>, replayed: true };
    const scope = await preflightItem(itemId, actor._id);
    const unresolved = await InventoryInboundRequestModel.findOne({ itemId, state: { $in: inventoryInboundRequestUnresolvedStates } }).lean().exec();
    if (unresolved) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_UNRESOLVED_EXISTS, 'An unresolved receipt request already exists for this Item');
    try {
      return await withTransaction(async session => {
        await lockItemForRequest(scope, session);
        const reservation = await lockActiveReservation(scope, session, new Date());
        const scopeInTxn: Scope = { ...scope, reservationId: reservation._id };
        const { item } = await assertCurrentItemAndStock(scopeInTxn, session);
        if (payload.quantityUnit !== item.quantityUnit) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Receipt quantity unit must match the Item registration unit');
        const eventFound = await findReplay(replayScope.scopeType, replayScope.scopeId, Operation.CREATE, key, actor._id, session);
        if (eventFound) throw new ReplayAbort(sameHash(eventFound, payloadHash) as Record<string, unknown>);
        const unresolvedNow = await InventoryInboundRequestModel.findOne({ itemId, state: { $in: inventoryInboundRequestUnresolvedStates } }).session(session).lean().exec();
        if (unresolvedNow) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_UNRESOLVED_EXISTS, 'An unresolved receipt request already exists for this Item');
        const now = new Date();
        const request = new InventoryInboundRequestModel({ ...scopeInTxn, createdBy: actor._id, createdAt: now, ...payload,
          state: InventoryInboundRequestState.PENDING_INSPECTION, custodyState: InventoryInboundCustodyState.NOT_TAKEN,
          requestIdempotencyKey: key, creationPayloadHash: canonicalReceiptPayloadHash(payload), currentPayloadHash: canonicalReceiptPayloadHash(payload), version: 0 });
        await request.save({ session });
        const snapshot = requestDto(request);
        const event = makeEvent(request, actor._id, Operation.CREATE, replayScope.scopeType, replayScope.scopeId, key, payloadHash, payload, snapshot);
        await event.save({ session });
        return { data: snapshot, replayed: false };
      });
    } catch (error) {
      return replayAfterFailure<ReceiptCreateResult>(error, replayScope.scopeType, replayScope.scopeId, Operation.CREATE, key, actor._id,
        payloadHash, snapshot => ({ data: snapshot, replayed: true }), itemId, canonicalReceiptPayloadHash(payload));
    }
  }

  static async listForItem(itemIdInput: unknown, query: unknown, actor: Actor): Promise<{ data: Record<string, unknown>[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    assertCustomer(actor);
    const itemId = parseId(itemIdInput, 'item ID');
    const params = plainObject(query ?? {}, ['page', 'limit'], 'pagination');
    const page = params.page === undefined ? 1 : Number(params.page);
    const limit = params.limit === undefined ? 20 : Number(params.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'page must be positive and limit must be between 1 and 100');
    }
    const item = await InventoryItemModel.findOne({ _id: itemId, customerId: actor._id, ...live }).select('_id').lean().exec();
    if (!item) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Inventory item not found');
    const filter = { itemId, customerId: actor._id };
    const [rows, total] = await Promise.all([
      InventoryInboundRequestModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      InventoryInboundRequestModel.countDocuments(filter).exec(),
    ]);
    return { data: rows.map(requestDto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  static async get(requestIdInput: unknown, actor: Actor): Promise<Record<string, unknown>> {
    assertCustomer(actor);
    const requestId = parseId(requestIdInput, 'request ID');
    const request = await InventoryInboundRequestModel.findOne({ _id: requestId, customerId: actor._id }).lean().exec();
    if (!request) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Receipt request not found');
    return requestDto(request as any);
  }

  static async amend(requestIdInput: unknown, input: unknown, ifMatch: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<Record<string, unknown>> {
    assertEnabled(); assertCustomer(actor);
    const requestId = parseId(requestIdInput, 'request ID');
    const key = parseKey(idempotencyKeyInput);
    const expectedVersion = parseIfMatch(ifMatch);
    const replayScope = { scopeType: ScopeType.REQUEST, scopeId: requestId };
    const existing = await findReplay(replayScope.scopeType, requestId, Operation.AMEND, key, actor._id);
    let patch: ReceiptPayloadPatch;
    try { patch = parsePayloadPatch(input); }
    catch (error) {
      if (existing) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with a different payload');
      throw error;
    }
    const payloadHash = canonicalReceiptPayloadHash({ operation: Operation.AMEND, requestId, expectedVersion, patch });
    if (existing) return sameHash(existing, payloadHash);
    const current = await InventoryInboundRequestModel.findOne({ _id: requestId, customerId: actor._id }).select('itemId reservationId facilityId').lean().exec();
    if (!current) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Receipt request not found');
    const scope: Scope = { itemId: current.itemId, reservationId: current.reservationId, facilityId: current.facilityId, customerId: actor._id };
    try {
      return await withTransaction(async session => {
        await lockItemForRequest(scope, session);
        await lockActiveReservation(scope, session, new Date());
        const item = await InventoryItemModel.findOne({ _id: scope.itemId, customerId: actor._id,
          managedReservationId: scope.reservationId, facilityId: scope.facilityId, ...live }).session(session).exec();
        if (!item) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Inventory item not found');
        const eventFound = await findReplay(ScopeType.REQUEST, requestId, Operation.AMEND, key, actor._id, session);
        if (eventFound) throw new ReplayAbort(sameHash(eventFound, payloadHash));
        const request = await InventoryInboundRequestModel.findOne({ _id: requestId, customerId: actor._id }).session(session).exec();
        if (!request) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Receipt request not found');
        if (request.version !== expectedVersion) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_VERSION_CONFLICT, 'If-Match request version is stale');
        // Only an explicit null means inspection history is known to be empty. Undefined legacy data fails closed.
        if (!canAmendReceiptRequest(request.state, request.custodyState, request.currentInspectionAttemptId !== null)) {
          fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Only an uninspected request without Facility custody can be amended');
        }
        const mergedPayload: ReceiptPayload = {
          requestedQuantity: patch.requestedQuantity ?? request.requestedQuantity,
          quantityUnit: patch.quantityUnit ?? request.quantityUnit,
          declaredUnitWeightKg: patch.declaredUnitWeightKg ?? request.declaredUnitWeightKg,
          declaredUnitDimensionsM: patch.declaredUnitDimensionsM ?? {
            widthM: request.declaredUnitDimensionsM.widthM,
            depthM: request.declaredUnitDimensionsM.depthM,
            heightM: request.declaredUnitDimensionsM.heightM,
          },
        };
        validateMergedPayload(mergedPayload);
        if (mergedPayload.quantityUnit !== item.quantityUnit) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Receipt quantity unit must match the Item registration unit');
        Object.assign(request, patch);
        request.currentPayloadHash = canonicalReceiptPayloadHash(mergedPayload);
        await request.save({ session });
        const snapshot = requestDto(request);
        await makeEvent(request, actor._id, Operation.AMEND, ScopeType.REQUEST, requestId, key, payloadHash,
          { expectedVersion, patch }, snapshot).save({ session });
        return snapshot;
      });
    } catch (error) {
      return replayAfterFailure<Record<string, unknown>>(error, replayScope.scopeType, requestId, Operation.AMEND, key, actor._id, payloadHash);
    }
  }

  static async cancel(requestIdInput: unknown, ifMatch: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<Record<string, unknown>> {
    assertCustomer(actor);
    const requestId = parseId(requestIdInput, 'request ID');
    const key = parseKey(idempotencyKeyInput);
    const expectedVersion = parseIfMatch(ifMatch);
    const payloadHash = canonicalReceiptPayloadHash({ operation: Operation.CANCEL, requestId, expectedVersion });
    const replayScope = { scopeType: ScopeType.REQUEST, scopeId: requestId };
    const existing = await findReplay(replayScope.scopeType, requestId, Operation.CANCEL, key, actor._id);
    if (existing) return sameHash(existing, payloadHash);
    const current = await InventoryInboundRequestModel.findOne({ _id: requestId, customerId: actor._id })
      .select('itemId reservationId facilityId').lean().exec();
    if (!current) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Receipt request not found');
    const scope: Scope = { itemId: current.itemId, reservationId: current.reservationId, facilityId: current.facilityId, customerId: actor._id };
    try {
      return await withTransaction(async session => {
        await lockItemForRequest(scope, session);
        // Cancellation is a safe resolution path even after expiry or while a
        // closure marker exists, but it still serializes on the same Reservation fence.
        await lockReservationFence(scope, session, { rejectClosure: false });
        const eventFound = await findReplay(ScopeType.REQUEST, requestId, Operation.CANCEL, key, actor._id, session);
        if (eventFound) throw new ReplayAbort(sameHash(eventFound, payloadHash));
        const request = await InventoryInboundRequestModel.findOne({ _id: requestId, customerId: actor._id }).session(session).exec();
        if (!request) return fail(404, ManagedStockErrorCode.INBOUND_REQUEST_NOT_FOUND, 'Receipt request not found');
        if (request.version !== expectedVersion) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_VERSION_CONFLICT, 'If-Match request version is stale');
        // Only an explicit null means inspection history is known to be empty. Undefined legacy data fails closed.
        if (!canAmendReceiptRequest(request.state, request.custodyState, request.currentInspectionAttemptId !== null)) {
          fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Only an uninspected request without Facility custody can be cancelled');
        }
        request.state = InventoryInboundRequestState.CANCELLED;
        await request.save({ session });
        const snapshot = requestDto(request);
        await makeEvent(request, actor._id, Operation.CANCEL, ScopeType.REQUEST, requestId, key, payloadHash,
          { requestId: String(requestId), expectedVersion }, snapshot).save({ session });
        return snapshot;
      });
    } catch (error) {
      return replayAfterFailure<Record<string, unknown>>(error, replayScope.scopeType, requestId, Operation.CANCEL, key, actor._id, payloadHash);
    }
  }
}
