import { randomUUID } from 'crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import InventoryStockBalanceModel from '../../models/inventory-items/inventory-stock-balance.model';
import InventoryInboundRequestModel, { inventoryInboundRequestUnresolvedStates } from '../../models/inventory-items/inventory-inbound-request.model';
import InventoryInboundRequestEventModel from '../../models/inventory-items/inventory-inbound-request-event.model';
import RepeatedInboundInspectionModel from '../../models/inventory-items/repeated-inbound-inspection.model';
import ReceivingInspectionUploadModel from '../../models/inventory-items/receiving-inspection-upload.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { resolveMi06BRepeatedInboundGate } from '../../config/mi06b-feature-gate';
import { IInventoryInboundRequest, InventoryInboundCustodyState as Custody, InventoryInboundRequestState as State } from '../../types/inventory-inbound-request.type';
import { InventoryInboundRequestEventOperation as Operation, InventoryInboundRequestEventScopeType as ScopeType } from '../../types/inventory-inbound-request-event.type';
import { ItemMovementType, MovementBatchAction } from '../../types/item-movement.type';
import { CellAllocationStatus, WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { InventoryItemStatus } from '../../types/inventory-item.type';
import { UserRole, IUser } from '../../types/user.type';
import { ManagedStockErrorCode, ManagedStockSource } from '../../types/managed-stock.type';
import { ManagedStockReconciliationError, reconcileManagedItemStock } from './managed-stock-ledger.service';
import { canonicalReceiptPayloadHash, ReceiptInspectionDecision, ReceiptRequestEvent, transitionReceiptRequest } from './inventory-inbound-request.lifecycle';
import { validateInventoryImage, INVENTORY_IMAGE_MAX_BYTES } from '../upload/inventory-image-validation.service';
import { CloudinaryService } from '../upload/cloudinary.service';

type Actor = Pick<IUser, '_id' | 'role'> & { assignedFacilityId?: Types.ObjectId | null };
type Dimensions = { widthM: number; depthM: number; heightM: number };
const live = { deletedAt: { $exists: false } };
const gate = () => resolveMi06BRepeatedInboundGate(process.env.NODE_ENV ?? 'development', process.env.MI06_REPEATED_INBOUND_ENABLED);
function fail(status: number, code: string, message: string): never {
  throw new RepeatedInboundError(status, code, message);
}

export class RepeatedInboundError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'RepeatedInboundError'; }
}

function assertGate() { if (!gate()) fail(503, 'INBOUND_REQUEST_FEATURE_DISABLED', 'Repeated inbound operations are disabled'); }
function assertLedgerWrites() { if (process.env.NODE_ENV === 'production' || process.env.MI06_STOCK_LEDGER_WRITES_ENABLED?.trim().toLowerCase() !== 'true') fail(503, 'FEATURE_DISABLED', 'Canonical stock writes are disabled'); }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value); }
function id(value: unknown, label: string): Types.ObjectId { if (!validId(value)) return fail(400, 'INBOUND_REQUEST_INVALID', `Invalid ${label}`); return new Types.ObjectId(value); }
function key(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(value)) return fail(400, 'INBOUND_REQUEST_INVALID', 'A valid Idempotency-Key is required'); return value; }
function version(value: unknown): number {
  const m = typeof value === 'string' ? value.trim().match(/^(?:W\/)?"(0|[1-9]\d*)"$/) : null;
  const n = m ? Number(m[1]) : NaN;
  if (!Number.isSafeInteger(n)) return fail(400, 'INBOUND_REQUEST_INVALID', 'If-Match must contain a quoted request version');
  return n;
}
function object(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || !allowed.includes(k)) || Object.keys(value).length !== Reflect.ownKeys(value).length) {
    return fail(400, 'INBOUND_REQUEST_INVALID', 'Malformed request body');
  }
  return value as Record<string, any>;
}
function dimensions(value: unknown): Dimensions {
  const d = object(value, ['widthM', 'depthM', 'heightM']);
  if (Object.keys(d).length !== 3 || ![d.widthM, d.depthM, d.heightM].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)) {
    return fail(400, 'INBOUND_REQUEST_INVALID', 'Dimensions must contain positive finite widthM, depthM and heightM');
  }
  return { widthM: d.widthM, depthM: d.depthM, heightM: d.heightM };
}
function round(n: number, places: number) { const p = 10 ** places; return Math.round((n + Number.EPSILON) * p) / p; }
function dto(req: any) { return { _id: String(req._id), itemId: String(req.itemId), reservationId: String(req.reservationId), facilityId: String(req.facilityId), requestedQuantity: req.requestedQuantity, quantityUnit: req.quantityUnit, declaredUnitWeightKg: req.declaredUnitWeightKg, declaredUnitDimensionsM: req.declaredUnitDimensionsM, state: req.state, custodyState: req.custodyState, currentInspectionAttemptId: req.currentInspectionAttemptId ? String(req.currentInspectionAttemptId) : null, acceptedEvidenceSnapshotId: req.acceptedEvidenceSnapshotId ? String(req.acceptedEvidenceSnapshotId) : null, confirmedMovementId: req.confirmedMovementId ? String(req.confirmedMovementId) : null, version: req.version, updatedAt: req.updatedAt }; }

async function transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try { let value!: T; await session.withTransaction(async () => { value = await work(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, timeoutMS: 15_000 }); return value; }
  finally { await session.endSession(); }
}
async function recoverEvent<T>(requestId: Types.ObjectId, actorId: Types.ObjectId, operation: Operation, idem: string,
  payloadHash: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error: any) {
    if (error instanceof RepeatedInboundError) throw error;
    const unknown = error?.hasErrorLabel?.('UnknownTransactionCommitResult') || error?.errorLabels?.includes?.('UnknownTransactionCommitResult');
    const transient = error?.hasErrorLabel?.('TransientTransactionError') || error?.errorLabels?.includes?.('TransientTransactionError') || error?.code === 112 || error?.name === 'VersionError';
    const duplicate = error?.code === 11000;
    if (!unknown && !transient && !duplicate) throw error;
    let readFailed = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const event: any = await InventoryInboundRequestEventModel.findOne({ requestId, actorId, operation, idempotencyKey: idem }).lean().exec();
        if (event) {
          if (event.payloadHash !== payloadHash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Idempotency key was used with another payload');
          return event.resultSnapshot as T;
        }
      } catch (lookupError) { if (lookupError instanceof RepeatedInboundError) throw lookupError; readFailed = true; }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, [25, 50, 100][attempt]));
    }
    if (unknown || readFailed) fail(503, 'INBOUND_REQUEST_OUTCOME_UNKNOWN', 'Operation outcome is unknown; retry with the same Idempotency-Key');
    if (duplicate) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Operation key already exists or conflicts with committed state');
    fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Request changed concurrently; reload and retry');
  }
}
function facility(actor: Actor, facilityId: Types.ObjectId) {
  if (actor.role !== UserRole.FACILITY_STAFF || !actor.assignedFacilityId || !actor.assignedFacilityId.equals(facilityId)) fail(404, 'INBOUND_REQUEST_NOT_FOUND', 'Receipt request not found');
}
async function getScopedRequest(requestId: Types.ObjectId, actor: Actor, session?: ClientSession): Promise<IInventoryInboundRequest> {
  const facilityId = actor.assignedFacilityId;
  if (!facilityId || actor.role !== UserRole.FACILITY_STAFF) return fail(403, 'INBOUND_REQUEST_FORBIDDEN', 'Facility Staff role required');
  let q = InventoryInboundRequestModel.findOne({ _id: requestId, facilityId });
  if (session) q = q.session(session);
  const request = await q.exec();
  if (!request) return fail(404, 'INBOUND_REQUEST_NOT_FOUND', 'Receipt request not found');
  return request;
}
async function lockRequestItem(itemId: Types.ObjectId, reservationId: Types.ObjectId, facilityId: Types.ObjectId,
  customerId: Types.ObjectId, session: ClientSession) {
  const identity = { _id: itemId, managedReservationId: reservationId, facilityId, customerId, ...live };
  const item: any = await InventoryItemModel.findOne({ ...identity,
    status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.CHECKED_OUT] } })
    .select('_id __v status').session(session).lean().exec();
  if (!item) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Item changed or is no longer eligible; reload and retry');
  const version = Number.isSafeInteger(item.__v) ? { __v: item.__v } : { __v: { $exists: false } };
  const locked = await InventoryItemModel.findOneAndUpdate({ ...identity,
    status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.CHECKED_OUT] }, ...version },
  { $inc: { __v: 1 } }, { new: true, session }).exec();
  if (!locked) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Item changed concurrently; reload and retry');
  return locked;
}
async function lockRequestReservation(request: IInventoryInboundRequest, session: ClientSession,
  options: { rejectClosure?: boolean; requireActiveTerm?: boolean } = {}) {
  const identity = { _id: request.reservationId, customerId: request.customerId,
    facilityId: request.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY };
  const current = await ReservationModel.findOne(identity).session(session).exec();
  if (!current) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Managed reservation is missing or outside request scope');
  const now = new Date();
  if (options.requireActiveTerm && (current.status !== ReservationStatus.ACTIVE || current.startDate > now || current.endDate <= now)) {
    fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'An in-term ACTIVE Managed Inventory reservation is required');
  }
  const version = Number(current.inventoryVersion ?? 0);
  const versionFilter = version === 0
    ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
    : { inventoryVersion: version };
  const locked = await ReservationModel.findOneAndUpdate({ ...identity, ...versionFilter,
    ...(options.rejectClosure ? { activeClosureRequestId: null } : {}),
    ...(options.requireActiveTerm ? { status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } } : {}) },
  { $inc: { inventoryVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!locked) {
    if (options.rejectClosure && current.activeClosureRequestId) {
      fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Inbound acceptance is blocked while reservation closure is pending');
    }
    fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Reservation lifecycle changed concurrently; reload and retry');
  }
  return locked;
}
async function lockRequestReservationByIdentity(identity: { reservationId: Types.ObjectId; facilityId: Types.ObjectId; customerId: Types.ObjectId },
  session: ClientSession, now: Date) {
  const scope = { _id: identity.reservationId, facilityId: identity.facilityId, customerId: identity.customerId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY, status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } };
  const current = await ReservationModel.findOne(scope).session(session).exec();
  if (!current) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'An in-term ACTIVE Managed Inventory reservation is required');
  if (current.activeClosureRequestId) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Inbound stock confirmation is blocked while reservation closure is pending');
  const version = Number(current.inventoryVersion ?? 0);
  const versionFilter = version === 0
    ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
    : { inventoryVersion: version };
  const locked = await ReservationModel.findOneAndUpdate({ ...scope, ...versionFilter, activeClosureRequestId: null },
    { $inc: { inventoryVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!locked) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Reservation lifecycle changed concurrently; reload and retry');
  return locked;
}
function makeEvent(request: any, actor: Actor, operation: Operation, idemKey: string, payload: unknown, resultSnapshot: unknown) {
  return new InventoryInboundRequestEventModel({ requestId: request._id, itemId: request.itemId, reservationId: request.reservationId,
    facilityId: request.facilityId, customerId: request.customerId, actorId: actor._id, operation, scopeType: ScopeType.REQUEST,
    scopeId: request._id, idempotencyKey: idemKey, payloadHash: canonicalReceiptPayloadHash(payload), inputSnapshot: payload,
    resultingState: request.state, resultingVersion: request.version, resultSnapshot, occurredAt: new Date() });
}

export class RepeatedInboundOperationsService {
  static async queue(actor: Actor, filters: unknown) {
    if (actor.role !== UserRole.FACILITY_STAFF || !actor.assignedFacilityId) fail(403, 'INBOUND_REQUEST_FORBIDDEN', 'Assigned Facility Staff role required');
    const f = object(filters ?? {}, ['state', 'from', 'to', 'page', 'limit']);
    const states = [State.PENDING_INSPECTION, State.DISCREPANCY, State.ACCEPTED_PENDING_CONFIRMATION, State.RETURN_PENDING];
    if (f.state && !states.includes(f.state)) fail(400, 'INBOUND_REQUEST_INVALID', 'Unsupported queue state');
    const page = f.page === undefined ? 1 : Number(f.page), limit = f.limit === undefined ? 20 : Number(f.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'INBOUND_REQUEST_INVALID', 'Invalid pagination');
    const filter: any = { facilityId: actor.assignedFacilityId, state: f.state ?? { $in: states } };
    if (f.from || f.to) {
      const range: any = {};
      if (f.from) { const d = new Date(f.from); if (!Number.isFinite(d.getTime())) fail(400, 'INBOUND_REQUEST_INVALID', 'Invalid from date'); range.$gte = d; }
      if (f.to) { const d = new Date(f.to); if (!Number.isFinite(d.getTime())) fail(400, 'INBOUND_REQUEST_INVALID', 'Invalid to date'); range.$lte = d; }
      filter.createdAt = range;
    }
    const [rows, total] = await Promise.all([InventoryInboundRequestModel.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(), InventoryInboundRequestModel.countDocuments(filter).exec()]);
    return { data: rows.map(dto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  static async detail(requestIdInput: unknown, actor: Actor) {
    const requestId = id(requestIdInput, 'request ID');
    const request = await getScopedRequest(requestId, actor);
    const now = new Date();
    const [item, attempts, allocations] = await Promise.all([InventoryItemModel.findOne({ _id: request.itemId, facilityId: request.facilityId, ...live }).select('_id itemCode name category status currentCellId quantityUnit').lean().exec(), RepeatedInboundInspectionModel.find({ requestId, facilityId: request.facilityId }).sort({ attempt: 1 }).lean().exec(), CellAllocationModel.find({ reservationId: request.reservationId, facilityId: request.facilityId, customerId: request.customerId, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] }, startDate: { $lte: now }, endDate: { $gt: now } }).select('cellId status').lean().exec()]);
    if (!item) fail(404, 'INBOUND_REQUEST_NOT_FOUND', 'Receipt request not found');
    const cells = await WarehouseCellModel.find({ _id: { $in: allocations.map(a => a.cellId) }, facilityId: request.facilityId, ...live }).select('_id code dimensions maxWeightKg usedWeightKg usedVolumeM3 operationalStatus').sort({ code: 1 }).lean().exec();
    return { request: dto(request), item, inspections: attempts, cells };
  }

  static async stockBalance(itemIdInput: unknown, actor: Actor) {
    if (![UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.BOM, UserRole.ADMIN].includes(actor.role as any)) fail(403, 'INBOUND_REQUEST_FORBIDDEN', 'Inventory owner or authorized Staff role required');
    const itemId = id(itemIdInput, 'Item ID');
    const item: any = await InventoryItemModel.findOne({ _id: itemId,
      ...(actor.role === UserRole.CUSTOMER ? { customerId: actor._id } : {}),
      ...(actor.role === UserRole.FACILITY_STAFF ? { facilityId: actor.assignedFacilityId } : {}), ...live,
    }).select('_id facilityId customerId managedReservationId').lean().exec();
    if (!item || (actor.role === UserRole.FACILITY_STAFF && (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(item.facilityId)))) fail(404, 'INBOUND_REQUEST_NOT_FOUND', 'Inventory item not found');
    const balance = await InventoryStockBalanceModel.findOne({ itemId, facilityId: item.facilityId }).lean().exec();
    if (!balance) fail(404, 'ITEM_PROJECTION_MISMATCH', 'No transactional stock balance has been initialized for this Item');
    return balance;
  }

  static async uploadEvidence(requestIdInput: unknown, file: Express.Multer.File | undefined, keyInput: unknown, actor: Actor) {
    assertGate();
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') fail(503, 'EVIDENCE_DELIVERY_DISABLED', 'Public receiving evidence delivery is disabled outside development/test');
    const requestId = id(requestIdInput, 'request ID'), idem = key(keyInput);
    const request = await getScopedRequest(requestId, actor);
    if (![State.PENDING_INSPECTION, State.DISCREPANCY].includes(request.state)) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'This request is not open for inspection evidence');
    if (!file?.buffer || file.size > INVENTORY_IMAGE_MAX_BYTES) fail(400, 'INBOUND_REQUEST_INVALID', 'Provide a supported image up to 8 MiB');
    facility(actor, request.facilityId);
    const image = await validateInventoryImage(file.buffer, file.mimetype);
    const filter = { itemId: request.itemId, staffId: actor._id, idempotencyKey: `receipt:${request._id}:${idem}` };
    const prior: any = await ReceivingInspectionUploadModel.findOne(filter).exec();
    if (prior) {
      if (prior.sha256 !== image.sha256) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Evidence key was reused with different image bytes');
      if (prior.status === 'UNATTACHED' && prior.expiresAt > new Date()) return { uploadId: prior._id, secureUrl: prior.secureUrl, publicId: prior.publicId, width: prior.width, height: prior.height, format: prior.format, expiresAt: prior.expiresAt };
      fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Evidence upload is in progress or unavailable; retry with the same key');
    }
    const occupied = await ReceivingInspectionUploadModel.find({ itemId: request.itemId, status: 'UNATTACHED', quotaSlot: { $exists: true } }).select('quotaSlot').lean().exec();
    const used = new Set(occupied.map((u: any) => u.quotaSlot)); let slot = -1; for (let i = 0; i < 20; i++) if (!used.has(i)) { slot = i; break; }
    if (slot < 0) fail(429, 'INBOUND_REQUEST_INELIGIBLE', 'Too many unattached receiving evidence uploads');
    const generated = randomUUID(), folder = `wdp/managed-receiving/${request.facilityId}/${request.itemId}`;
    let upload: any;
    try {
      [upload] = await ReceivingInspectionUploadModel.create([{ ...filter, facilityId: request.facilityId, sha256: image.sha256,
        secureUrl: `pending://managed-receiving/${generated}`, publicId: `${folder}/${generated}`, generatedPublicId: generated, folder,
        width: image.width, height: image.height, format: image.format, status: 'UPLOADING', quotaSlot: slot,
        uploadLeaseToken: randomUUID(), uploadLeaseUntil: new Date(Date.now() + 2 * 60 * 60 * 1000), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), nextDeleteAt: new Date() }]);
      const asset = await CloudinaryService.uploadInventoryImage(file.buffer, folder, generated);
      if (!asset.secureUrl.startsWith('https://') || asset.width !== image.width || asset.height !== image.height || asset.format.toLowerCase() !== image.format) fail(502, 'EVIDENCE_UPLOAD_FAILED', 'Cloudinary metadata did not match the validated image');
      const saved = await ReceivingInspectionUploadModel.findOneAndUpdate({ _id: upload._id, status: 'UPLOADING' }, { $set: { status: 'UNATTACHED', secureUrl: asset.secureUrl, publicId: asset.publicId, nextDeleteAt: new Date() }, $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 } }, { new: true }).exec();
      if (!saved) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Evidence upload changed during completion');
      return { uploadId: saved._id, secureUrl: saved.secureUrl, publicId: saved.publicId, width: saved.width, height: saved.height, format: saved.format, expiresAt: saved.expiresAt };
    } catch (error) {
      if (error instanceof RepeatedInboundError) throw error;
      fail(502, 'EVIDENCE_UPLOAD_FAILED', 'Evidence upload failed; retry with the same key');
    }
  }

  static async inspect(requestIdInput: unknown, input: unknown, ifMatch: unknown, actor: Actor) {
    assertGate();
    if (actor.role !== UserRole.FACILITY_STAFF || !actor.assignedFacilityId) fail(403, 'INBOUND_REQUEST_FORBIDDEN', 'Assigned Facility Staff required');
    const requestId = id(requestIdInput, 'request ID'), expectedVersion = version(ifMatch);
    const body = object(input, ['decision', 'receivedQuantity', 'actualUnitWeightKg', 'actualUnitDimensionsM', 'compatibleCellIds', 'packingLayoutVerified', 'custodyTaken', 'note', 'evidenceUploadIds', 'inspectionKey', 'returnCompleted']);
    const idem = key(body.inspectionKey);
    const decision = body.decision;
    if (decision !== 'ACCEPTED' && decision !== 'DISCREPANCY' && decision !== 'REJECTED') fail(400, 'INBOUND_REQUEST_INVALID', 'decision must be ACCEPTED, DISCREPANCY or REJECTED');
    const inspectionDecision: ReceiptInspectionDecision = decision;
    const lifecycleEvent: Record<ReceiptInspectionDecision, ReceiptRequestEvent> = {
      ACCEPTED: 'INSPECT_ACCEPTED', DISCREPANCY: 'INSPECT_DISCREPANCY', REJECTED: 'INSPECT_REJECTED',
    };
    if (!Number.isSafeInteger(body.receivedQuantity) || body.receivedQuantity < 0 || typeof body.actualUnitWeightKg !== 'number' || !Number.isFinite(body.actualUnitWeightKg) || body.actualUnitWeightKg <= 0) fail(400, 'INBOUND_REQUEST_INVALID', 'Received quantity and actual unit weight are invalid');
    const dims = dimensions(body.actualUnitDimensionsM);
    if (typeof body.custodyTaken !== 'boolean' || typeof body.packingLayoutVerified !== 'boolean' || typeof body.note !== 'string' || body.note.length > 1000) fail(400, 'INBOUND_REQUEST_INVALID', 'Inspection custody, packing or note fields are invalid');
    const uploadIds = body.evidenceUploadIds ?? [];
    if (!Array.isArray(uploadIds) || uploadIds.length > 10 || new Set(uploadIds).size !== uploadIds.length || uploadIds.some((v: unknown) => !validId(v))) fail(400, 'INBOUND_REQUEST_INVALID', 'Provide up to 10 unique evidence upload IDs');
    const cellIds = body.compatibleCellIds ?? [];
    if (!Array.isArray(cellIds) || cellIds.some((v: unknown) => !validId(v)) || new Set(cellIds).size !== cellIds.length) fail(400, 'INBOUND_REQUEST_INVALID', 'compatibleCellIds must be unique Cell IDs');
    if (decision === 'ACCEPTED' && (body.receivedQuantity !== undefined && body.receivedQuantity < 1)) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Accepted receipt quantity must be positive');
    const hashInput = { decision, receivedQuantity: body.receivedQuantity, actualUnitWeightKg: body.actualUnitWeightKg, actualUnitDimensionsM: dims, compatibleCellIds: cellIds, packingLayoutVerified: body.packingLayoutVerified, custodyTaken: body.custodyTaken, note: body.note, evidenceUploadIds: uploadIds };
    const payloadHash = canonicalReceiptPayloadHash(hashInput);
    const preflight = await getScopedRequest(requestId, actor);
    const existing = await InventoryInboundRequestEventModel.findOne({ requestId, operation: Operation.INSPECT, idempotencyKey: idem, actorId: actor._id }).lean().exec();
    if (existing) { if (existing.payloadHash !== payloadHash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Inspection key was used with another payload'); return existing.resultSnapshot; }
    return recoverEvent(requestId, actor._id, Operation.INSPECT, idem, payloadHash, () => transaction(async session => {
      await lockRequestItem(preflight.itemId, preflight.reservationId, preflight.facilityId, preflight.customerId, session);
      const reservation = await lockRequestReservation(preflight, session, { rejectClosure: decision === 'ACCEPTED' });
      if (decision === 'ACCEPTED' && (reservation.status !== ReservationStatus.ACTIVE || !(reservation.startDate <= new Date() && reservation.endDate > new Date()))) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Acceptance requires an in-term ACTIVE Managed Inventory reservation');
      const request = await getScopedRequest(requestId, actor, session);
      const prior = await InventoryInboundRequestEventModel.findOne({ requestId, operation: Operation.INSPECT, idempotencyKey: idem, actorId: actor._id }).session(session).lean().exec();
      if (prior) { if (prior.payloadHash !== payloadHash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Inspection key was used with another payload'); return prior.resultSnapshot; }
      if (request.version !== expectedVersion) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Request version is stale');
      const replay = await InventoryInboundRequestEventModel.findOne({ requestId, operation: Operation.INSPECT, idempotencyKey: idem, actorId: actor._id }).session(session).lean().exec();
      if (replay) { if (replay.payloadHash !== payloadHash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Inspection key was used with another payload'); return replay.resultSnapshot; }
      if (![State.PENDING_INSPECTION, State.DISCREPANCY].includes(request.state)) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Request cannot be inspected in its current state');
      if (decision === 'ACCEPTED' && body.receivedQuantity !== request.requestedQuantity) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Accepted quantity must exactly match requested quantity');
      if (decision === 'ACCEPTED' && !body.custodyTaken && request.custodyState !== Custody.IN_CUSTODY) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Acceptance requires Facility custody');
      if (decision === 'ACCEPTED' && cellIds.length === 0) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Acceptance requires at least one compatible allocated Cell');
      if (cellIds.length) {
        const validAllocations = await CellAllocationModel.countDocuments({ cellId: { $in: cellIds.map((v: string) => new Types.ObjectId(v)) },
          reservationId: request.reservationId, facilityId: request.facilityId, customerId: request.customerId,
          status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] } }).session(session).exec();
        const validCells = await WarehouseCellModel.countDocuments({ _id: { $in: cellIds.map((v: string) => new Types.ObjectId(v)) }, facilityId: request.facilityId, ...live }).session(session).exec();
        if (validAllocations !== cellIds.length || validCells !== cellIds.length) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Compatible Cells must be allocated to this request reservation and Facility');
      }
      if (decision === 'ACCEPTED') {
        const currentItem: any = await InventoryItemModel.findOne({ _id: request.itemId, managedReservationId: request.reservationId,
          facilityId: request.facilityId, customerId: request.customerId, ...live }).session(session).lean().exec();
        if (currentItem?.status === InventoryItemStatus.IN_STORAGE && !cellIds.includes(String(currentItem.currentCellId))) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'An Item with positive stock must remain in its current Cell');
      }
      const outcome = transitionReceiptRequest(request.state, request.custodyState, lifecycleEvent[inspectionDecision], { custodyTaken: body.custodyTaken });
      const attempt = await RepeatedInboundInspectionModel.countDocuments({ requestId }).session(session).exec() + 1;
      const snapshotId = new Types.ObjectId();
      const images: any[] = [];
      for (const uploadId of uploadIds as string[]) {
        const upload: any = await ReceivingInspectionUploadModel.findOne({ _id: uploadId, itemId: request.itemId, facilityId: request.facilityId, staffId: actor._id, status: 'UNATTACHED', expiresAt: { $gt: new Date() } }).session(session).exec();
        if (!upload) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Evidence upload is unavailable or outside Staff/Item scope');
        const claimed = await ReceivingInspectionUploadModel.updateOne({ _id: upload._id, status: 'UNATTACHED', expiresAt: { $gt: new Date() } }, { $set: { status: 'ATTACHED', snapshotId }, $unset: { quotaSlot: 1, nextDeleteAt: 1 } }, { session }).exec();
        if (claimed.modifiedCount !== 1) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Evidence upload was claimed concurrently');
        images.push({ uploadId: upload._id, secureUrl: upload.secureUrl, publicId: upload.publicId, sha256: upload.sha256, width: upload.width, height: upload.height, format: upload.format });
      }
      const inspection = new RepeatedInboundInspectionModel({ _id: snapshotId, requestId, itemId: request.itemId, reservationId: request.reservationId, facilityId: request.facilityId,
        attempt, requestVersion: expectedVersion + 1, inspectionKey: idem, payloadHash, decision, receivedQuantity: body.receivedQuantity,
        actualUnitWeightKg: body.actualUnitWeightKg, actualUnitDimensionsM: dims, compatibleCellIds: cellIds, packingLayoutVerified: body.packingLayoutVerified,
        custodyTaken: body.custodyTaken, note: body.note, inspectedBy: actor._id, inspectedAt: new Date(), images });
      await inspection.save({ session });
      request.state = outcome.state; request.custodyState = outcome.custodyState; request.currentInspectionAttemptId = inspection._id;
      if (decision === 'ACCEPTED') request.acceptedEvidenceSnapshotId = inspection._id;
      await request.save({ session });
      const result = { request: dto(request), inspection };
      await makeEvent(request, actor, Operation.INSPECT, idem, hashInput, result).save({ session });
      return result;
    }));
  }

  static async completeReturn(requestIdInput: unknown, input: unknown, ifMatch: unknown, keyInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF || !actor.assignedFacilityId) fail(403, 'INBOUND_REQUEST_FORBIDDEN', 'Assigned Facility Staff required');
    const requestId = id(requestIdInput, 'request ID'), expected = version(ifMatch), idem = key(keyInput), body = object(input, ['returnNote']);
    if (typeof body.returnNote !== 'string' || !body.returnNote.trim() || body.returnNote.length > 1000) fail(400, 'INBOUND_REQUEST_INVALID', 'A return completion note is required');
    const payload = { requestId: String(requestId), expectedVersion: expected, event: 'RETURN_COMPLETED', returnNote: body.returnNote.trim() };
    const hash = canonicalReceiptPayloadHash(payload);
    const preflight = await getScopedRequest(requestId, actor);
    const existing = await InventoryInboundRequestEventModel.findOne({ requestId, operation: Operation.RETURN_COMPLETED, idempotencyKey: idem, actorId: actor._id }).lean().exec();
    if (existing) { if (existing.payloadHash !== hash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Return key was used with different input'); return existing.resultSnapshot; }
    return recoverEvent(requestId, actor._id, Operation.RETURN_COMPLETED, idem, hash, () => transaction(async session => {
      await lockRequestItem(preflight.itemId, preflight.reservationId, preflight.facilityId, preflight.customerId, session);
      await lockRequestReservation(preflight, session);
      const request = await getScopedRequest(requestId, actor, session);
      if (request.version !== expected) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Request version is stale');
      const result = transitionReceiptRequest(request.state, request.custodyState, 'RETURN_COMPLETED');
      request.state = result.state; request.custodyState = result.custodyState; await request.save({ session });
      const snapshot = dto(request);
      await makeEvent(request, actor, Operation.RETURN_COMPLETED, idem, payload, snapshot).save({ session });
      return snapshot;
    }));
  }

  static async confirm(requestIdInput: unknown, input: unknown, ifMatch: unknown, actor: Actor) {
    assertGate();
    assertLedgerWrites();
    if (actor.role !== UserRole.FACILITY_STAFF || !actor.assignedFacilityId) fail(403, 'INBOUND_REQUEST_FORBIDDEN', 'Assigned Facility Staff required');
    const requestId = id(requestIdInput, 'request ID'), expectedVersion = version(ifMatch);
    const body = object(input, ['destinationCellId', 'inspectionNote', 'idempotencyKey']);
    const idem = key(body.idempotencyKey), destinationCellId = id(body.destinationCellId, 'destination Cell');
    if (typeof body.inspectionNote !== 'string' || !body.inspectionNote.trim() || body.inspectionNote.length > 1000) fail(400, 'INBOUND_REQUEST_INVALID', 'inspectionNote is required');
    const payload = { destinationCellId: String(destinationCellId), inspectionNote: body.inspectionNote.trim(), expectedVersion };
    const payloadHash = canonicalReceiptPayloadHash(payload);
    const preflightRequest = await getScopedRequest(requestId, actor);
    const replay = await InventoryInboundRequestEventModel.findOne({ requestId, operation: Operation.CONFIRM, idempotencyKey: idem, actorId: actor._id }).lean().exec();
    if (replay) { if (replay.payloadHash !== payloadHash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Confirmation key was used with another payload'); return replay.resultSnapshot; }
    const itemProbe: any = await InventoryItemModel.findOne({ _id: preflightRequest.itemId, facilityId: preflightRequest.facilityId,
      customerId: preflightRequest.customerId, managedReservationId: preflightRequest.reservationId, ...live }).select('_id __v status').lean().exec();
    if (!itemProbe) fail(404, 'INBOUND_REQUEST_NOT_FOUND', 'Receipt request not found');
    return recoverEvent(requestId, actor._id, Operation.CONFIRM, idem, payloadHash, () => transaction(async session => {
      const item = await InventoryItemModel.findOneAndUpdate({ _id: itemProbe._id, __v: itemProbe.__v,
        customerId: preflightRequest.customerId, managedReservationId: preflightRequest.reservationId, facilityId: preflightRequest.facilityId,
        status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.CHECKED_OUT] }, ...live }, { $inc: { __v: 1 } }, { new: true, session }).exec();
      if (!item) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Item changed concurrently; reload and retry');
      const now = new Date();
      const structuralCellId = item.status === InventoryItemStatus.IN_STORAGE ? item.currentCellId : destinationCellId;
      if (!structuralCellId) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Item has no valid Cell for repeated receipt placement');
      const lockCell = await WarehouseCellModel.findOne({ _id: structuralCellId, facilityId: item.facilityId, ...live }).session(session).exec();
      if (!lockCell) fail(409, 'CAPACITY_UNKNOWN', 'Destination Cell is missing or outside the Item Facility');
      const zone = await WarehouseZoneModel.findOneAndUpdate({ _id: lockCell.zoneId, facilityId: lockCell.facilityId, isActive: true, ...live },
        { $inc: { structureVersion: 1 } }, { new: true, session }).exec();
      if (!zone) fail(409, 'CAPACITY_UNKNOWN', 'Destination Zone is unavailable');
      const reservation = await lockRequestReservationByIdentity({ reservationId: preflightRequest.reservationId,
        facilityId: preflightRequest.facilityId, customerId: preflightRequest.customerId }, session, now);
      const current = await getScopedRequest(requestId, actor, session);
      if (current.version !== expectedVersion) fail(409, 'INBOUND_REQUEST_VERSION_CONFLICT', 'Request version is stale');
      const eventInTxn = await InventoryInboundRequestEventModel.findOne({ requestId, operation: Operation.CONFIRM, idempotencyKey: idem, actorId: actor._id }).session(session).lean().exec();
      if (eventInTxn) { if (eventInTxn.payloadHash !== payloadHash) fail(409, 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT', 'Confirmation key was used with another payload'); return eventInTxn.resultSnapshot; }
      if (current.state === State.CONFIRMED && current.confirmedMovementId) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Receipt is already confirmed; use the original Idempotency-Key to replay');
      if (current.version !== expectedVersion || current.state !== State.ACCEPTED_PENDING_CONFIRMATION || current.custodyState !== Custody.IN_CUSTODY || !current.acceptedEvidenceSnapshotId) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Receipt requires the current accepted inspection version and Facility custody');
      const inspection = await RepeatedInboundInspectionModel.findOne({ _id: current.acceptedEvidenceSnapshotId, requestId, itemId: item._id, facilityId: current.facilityId, decision: 'ACCEPTED' }).session(session).exec();
      if (!inspection || inspection.receivedQuantity !== current.requestedQuantity || !inspection.compatibleCellIds.some((id: Types.ObjectId) => id.equals(destinationCellId))) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Accepted inspection evidence is missing, inconsistent or does not approve the destination Cell');
      const facilityRecord = await FacilityModel.findOne({ _id: current.facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live }).session(session).exec();
      if (!facilityRecord) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Managed Inventory Facility is unavailable');
      const movements = await ItemMovementModel.find({ itemId: item._id }).session(session).lean().exec();
      let stock: any;
      try { stock = reconcileManagedItemStock(item.toObject(), movements as any[]); }
      catch (error) { if (error instanceof ManagedStockReconciliationError) fail(409, error.code, `Item history cannot be reconciled: ${error.message}`); throw error; }
      if (stock.onHandQuantity === 0) {
        const terminal = movements.find((movement: any) => String(movement._id) === String(stock.reconciledThroughMovementId));
        if (item.status !== InventoryItemStatus.CHECKED_OUT || !item.outboundMovementId || !terminal || terminal.type !== ItemMovementType.OUTBOUND || String(terminal._id) !== String(item.outboundMovementId)) fail(409, 'ITEM_PROJECTION_MISMATCH', 'Zero-stock Item requires a matching terminal OUTBOUND movement before new placement');
      }
      const balance: any = await InventoryStockBalanceModel.findOne({ itemId: item._id }).session(session).exec();
      if (balance) {
        const projectionMatches = balance.onHandQuantity === stock.onHandQuantity && balance.heldQuantity === 0 &&
          String(balance.currentCellId ?? '') === String(stock.currentCellId ?? '') && balance.batches.length === stock.batches.length &&
          stock.batches.every((batch: any) => {
            const projected = balance.batches.find((candidate: any) => candidate.batchId === batch.batchId);
            return projected && projected.quantity === batch.quantity && projected.heldQuantity === 0 && projected.quantityUnit === batch.quantityUnit &&
              round(projected.actualTotalWeightKg, 3) === round(batch.actualTotalWeightKg, 3) && round(projected.actualTotalVolumeM3, 6) === round(batch.actualTotalVolumeM3, 6) &&
              projected.arithmeticPolicy === batch.arithmeticPolicy;
          });
        if (!projectionMatches) fail(409, 'ITEM_PROJECTION_MISMATCH', 'StockBalance differs from complete movement history or has unresolved stock holds');
      }
      if (stock.batches.some((batch: any) => batch.heldQuantity > 0)) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Cannot receive while stock is held by an unresolved outbound operation');
      const cellId = stock.onHandQuantity > 0 ? item.currentCellId : destinationCellId;
      if (!cellId || !cellId.equals(destinationCellId)) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Positive stock must remain in its current Cell');
      const allocation = await CellAllocationModel.findOne({ cellId, reservationId: reservation._id, facilityId: reservation.facilityId, customerId: reservation.customerId, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] }, startDate: { $lte: now }, endDate: { $gt: now } }).session(session).exec();
      if (!allocation || !(reservation.allocatedCellIds ?? []).some((allocatedId: Types.ObjectId) => allocatedId.equals(cellId))) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Destination Cell must remain allocated to this reservation');
      const cell = await WarehouseCellModel.findOne({ _id: cellId, facilityId: reservation.facilityId, ...live }).session(session).exec();
      if (!cell || cell.operationalStatus !== WarehouseOperationalStatus.AVAILABLE || cell.dimensions.usableHeightM === undefined) fail(409, 'CAPACITY_UNKNOWN', 'Destination Cell must be active, available and have measured usable height');
      const rack = await WarehouseRackModel.findOneAndUpdate({ _id: cell.rackId, zoneId: cell.zoneId, facilityId: cell.facilityId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live }, { $inc: { layoutVersion: 1 } }, { new: true, session }).exec();
      if (!rack) fail(409, 'CAPACITY_UNKNOWN', 'Destination Rack is unavailable');
      const unit: Dimensions = inspection.actualUnitDimensionsM, quantity = current.requestedQuantity;
      const weight = round(inspection.actualUnitWeightKg * quantity, 3), volume = round(unit.widthM * unit.depthM * unit.heightM * quantity, 6);
      const fits = ((unit.widthM <= cell.dimensions.widthM && unit.depthM <= cell.dimensions.depthM) || (unit.depthM <= cell.dimensions.widthM && unit.widthM <= cell.dimensions.depthM)) && unit.heightM <= cell.dimensions.usableHeightM;
      if (!fits || (quantity > 1 && !inspection.packingLayoutVerified)) fail(409, 'CAPACITY_EXCEEDED', 'Inspected goods do not fit the approved Cell geometry/packing');
      const fullCell = await WarehouseCellModel.findById(cellId).session(session).exec();
      if (!fullCell) fail(409, 'CAPACITY_UNKNOWN', 'Destination Cell is unavailable');
      if (fullCell.dimensions.usableHeightM === undefined) fail(409, 'CAPACITY_UNKNOWN', 'Destination Cell usable height is unavailable');
      const capacityVolume = round(fullCell.dimensions.widthM * fullCell.dimensions.depthM * fullCell.dimensions.usableHeightM, 6);
      // Reconcile complete movement histories before relying on materialized counters.
      const placedItems: any[] = await InventoryItemModel.find({ currentCellId: { $ne: null }, status: { $in: [InventoryItemStatus.IN_STORAGE, InventoryItemStatus.PENDING_OUTBOUND] }, ...live }).session(session).lean().exec();
      const cellUsage = new Map<string, { weight: number; volume: number }>(); let reservationUsage = 0;
      for (const placed of placedItems) {
        const history: any[] = await ItemMovementModel.find({ itemId: placed._id }).session(session).lean().exec();
        let folded: any;
        try { folded = reconcileManagedItemStock(placed, history); }
        catch (error) { if (error instanceof ManagedStockReconciliationError) fail(409, error.code, `Warehouse history cannot be reconciled: ${error.message}`); throw error; }
        if (folded.onHandQuantity <= 0 || String(folded.currentCellId) !== String(placed.currentCellId)) fail(409, 'CAPACITY_UNKNOWN', 'Placed Item stock or location is inconsistent');
        const placeKey = String(placed.currentCellId), usage = cellUsage.get(placeKey) ?? { weight: 0, volume: 0 };
        usage.weight = round(usage.weight + folded.actualTotalWeightKg, 3); usage.volume = round(usage.volume + folded.actualTotalVolumeM3, 6); cellUsage.set(placeKey, usage);
        if (String(placed.managedReservationId) === String(reservation._id)) reservationUsage = round(reservationUsage + folded.actualTotalVolumeM3, 6);
      }
      const currentCellUsage = cellUsage.get(String(cellId)) ?? { weight: 0, volume: 0 };
      if (round(currentCellUsage.weight, 3) !== round(Number(fullCell.usedWeightKg), 3) || round(currentCellUsage.volume, 6) !== round(Number(fullCell.usedVolumeM3), 6)) fail(409, 'CELL_COUNTER_MISMATCH', 'Cell counters differ from movement-derived occupancy');
      if (round(reservationUsage, 6) !== round(Number(reservation.usedCapacityM3), 6)) fail(409, 'RESERVATION_COUNTER_MISMATCH', 'Reservation counter differs from movement-derived stock');
      if (fullCell.usedWeightKg + weight > fullCell.maxWeightKg || fullCell.usedVolumeM3 + volume > capacityVolume) fail(409, 'CAPACITY_EXCEEDED', 'Cell capacity would be exceeded');
      const rackCells: any[] = await WarehouseCellModel.find({ rackId: rack._id, ...live }).session(session).lean().exec();
      if (rackCells.some(c => !Number.isFinite(c.usedWeightKg) || c.usedWeightKg < 0 || !Number.isFinite(c.usedVolumeM3) || c.usedVolumeM3 < 0)) fail(409, 'CAPACITY_UNKNOWN', 'Rack counters are invalid');
      for (const rackCell of rackCells) {
        const actual = cellUsage.get(String(rackCell._id)) ?? { weight: 0, volume: 0 };
        if (round(actual.weight, 3) !== round(Number(rackCell.usedWeightKg), 3) || round(actual.volume, 6) !== round(Number(rackCell.usedVolumeM3), 6)) fail(409, 'CELL_COUNTER_MISMATCH', 'A Rack Cell counter differs from movement-derived occupancy');
      }
      const rackLevelUsed = rackCells.filter(c => c.levelNumber === cell.levelNumber).reduce((n, c) => n + c.usedWeightKg, 0);
      const rackUsed = rackCells.reduce((n, c) => n + c.usedWeightKg, 0);
      if (rackLevelUsed + weight > rack.maxWeightKgPerLevel || rackUsed + weight > rack.levelCount * rack.maxWeightKgPerLevel) fail(409, 'CAPACITY_EXCEEDED', 'Rack capacity would be exceeded');
      const nextReservationVolume = round(Number(reservation.usedCapacityM3 ?? 0) + volume, 6);
      if (!Number.isFinite(Number(reservation.allocatedCapacity)) || nextReservationVolume > Number(reservation.allocatedCapacity)) fail(409, 'CAPACITY_EXCEEDED', 'Reservation allocated volume would be exceeded');
      const performedAt = new Date(), batchId = new Types.ObjectId().toString(), receiptTotalWeight = weight, receiptTotalVolume = volume;
      const line = { batchId, receiptRequestId: current._id, receivingInspectionEvidenceId: inspection._id, action: MovementBatchAction.ADD, quantity, quantityUnit: current.quantityUnit,
        actualUnitWeightKg: round(inspection.actualUnitWeightKg, 3), actualUnitDimensionsM: { widthM: round(unit.widthM, 6), depthM: round(unit.depthM, 6), heightM: round(unit.heightM, 6) }, actualTotalWeightKg: receiptTotalWeight, actualTotalVolumeM3: receiptTotalVolume };
      const movement = new ItemMovementModel({ itemId: item._id, managedReservationId: reservation._id, facilityId: reservation.facilityId, customerId: reservation.customerId,
        type: ItemMovementType.INBOUND, sourceCellId: null, destinationCellId: cellId, quantity, quantityUnit: current.quantityUnit, actualUnitWeightKg: line.actualUnitWeightKg,
        actualTotalWeightKg: receiptTotalWeight, actualUnitDimensionsM: line.actualUnitDimensionsM, actualTotalVolumeM3: receiptTotalVolume,
        performedBy: actor._id, performedAt, inspectionNote: body.inspectionNote.trim(), idempotencyKey: `receipt:${current._id}:${canonicalReceiptPayloadHash(idem).slice(0, 32)}`,
        schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', batchLines: [line] });
      const nextBatches = stock.batches.map((b: any) => ({ ...b, receiptMovementId: b.receiptMovementId, receiptRequestId: b.receiptRequestId,
        receivingInspectionEvidenceId: b.receivingInspectionEvidenceId, arithmeticPolicy: b.arithmeticPolicy }));
      nextBatches.push({ batchId, receiptMovementId: movement._id, receiptRequestId: current._id, receivingInspectionEvidenceId: inspection._id, quantity,
        heldQuantity: 0, quantityUnit: current.quantityUnit, actualUnitWeightKg: line.actualUnitWeightKg, actualUnitDimensionsM: line.actualUnitDimensionsM,
        actualTotalWeightKg: receiptTotalWeight, actualTotalVolumeM3: receiptTotalVolume, arithmeticPolicy: 'CANONICAL_V1', receivedAt: performedAt });
      const nextQty = stock.onHandQuantity + quantity;
      const nextWeight = round(stock.actualTotalWeightKg + weight, 3), nextVolume = round(stock.actualTotalVolumeM3 + volume, 6);
      const cellUpdate = await WarehouseCellModel.findOneAndUpdate({ _id: cellId, usedWeightKg: fullCell.usedWeightKg, usedVolumeM3: fullCell.usedVolumeM3, operationalStatus: WarehouseOperationalStatus.AVAILABLE,
        $expr: { $and: [{ $lte: [{ $add: ['$usedWeightKg', weight] }, '$maxWeightKg'] }, { $lte: [{ $add: ['$usedVolumeM3', volume] }, capacityVolume] }] } },
      { $inc: { usedWeightKg: weight, usedVolumeM3: volume } }, { new: true, session }).exec();
      if (!cellUpdate) fail(409, 'CAPACITY_EXCEEDED', 'Cell usage changed concurrently; retry');
      reservation.usedCapacityM3 = nextReservationVolume; await reservation.save({ session });
      await movement.save({ session });
      const nextBalance: any = balance ?? new InventoryStockBalanceModel({ itemId: item._id, facilityId: item.facilityId, customerId: item.customerId, managedReservationId: item.managedReservationId, schemaVersion: 1, source: stock.source, version: 0 });
      nextBalance.currentCellId = cellId; nextBalance.batches = nextBatches; nextBalance.onHandQuantity = nextQty; nextBalance.heldQuantity = stock.heldQuantity;
      nextBalance.actualTotalWeightKg = nextWeight; nextBalance.actualTotalVolumeM3 = nextVolume; nextBalance.reconciledAt = performedAt; nextBalance.reconciledThroughMovementId = movement._id; nextBalance.version += 1;
      await nextBalance.save({ session });
      const allocationChanged = await CellAllocationModel.updateOne({ _id: allocation._id, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] } }, { $set: { status: CellAllocationStatus.OCCUPIED } }, { session }).exec();
      if (allocationChanged.matchedCount !== 1) fail(409, 'INBOUND_REQUEST_INELIGIBLE', 'Cell allocation changed during receipt');
      item.status = InventoryItemStatus.IN_STORAGE; item.currentCellId = cellId; item.currentPlacementMovementId = movement._id; item.inboundMovementId = movement._id;
      item.inboundConfirmedAt = performedAt; item.inboundConfirmedBy = actor._id; await item.save({ session });
      current.state = State.CONFIRMED; current.confirmedMovementId = movement._id; await current.save({ session });
      const result = { request: dto(current), movement: movement.toObject(), stockBalance: nextBalance.toObject(), idempotentReplay: false };
      await makeEvent(current, actor, Operation.CONFIRM, idem, payload, result).save({ session });
      return result;
    }));
  }
}
