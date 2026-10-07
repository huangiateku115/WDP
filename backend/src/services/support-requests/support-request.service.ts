import { Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import UserModel from '../../models/users/user.model';
import SupportRequestModel from '../../models/support-requests/support-request.model';
import SupportMessageModel from '../../models/support-requests/support-message.model';
import { ActionType, IAuditLog } from '../../types/audit.type';
import { ISupportRequest, SupportStatus } from '../../types/support-request.type';
import { IUser, UserRole } from '../../types/user.type';
import { AuditService } from '../audit/audit.service';
import { parseAssignment, parseCreate, parseList, parseMessage, parseStatus, parseUpdate, SupportError, validateId } from './support-request.validation';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
const management = [UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER];
const staffRoles = [...management, UserRole.FACILITY_STAFF];
function audit(actor: Actor, request: ISupportRequest, action: ActionType, before?: unknown, after?: unknown) {
  const payload: IAuditLog = { actorId: actor._id.toString(), actorRole: actor.role, action,
    entityType: 'SupportRequest', entityId: request._id.toString(),
    ...(request.facilityId ? { facilityId: request.facilityId.toString() } : {}),
    ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) };
  AuditService.logAction(payload);
}
async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof SupportError) throw error;
    const e = error as { code?: number; name?: string };
    if (e?.code === 11000 || e?.name === 'VersionError') throw new SupportError(409, 'Support request changed; reload and retry');
    if (e?.name === 'CastError' || e?.name === 'ValidationError') throw new SupportError(400, 'Invalid support request data');
    throw new SupportError(500, 'Internal Server Error');
  }
}
function assertManagerScope(actor: Actor, facilityId?: string) {
  if (!management.includes(actor.role)) throw new SupportError(403, 'Management role required');
  if (actor.role === UserRole.FACILITY_MANAGER && (!facilityId || actor.assignedFacilityId?.toString() !== facilityId.toLowerCase())) throw new SupportError(403, 'Facility is outside assigned scope');
}
async function activeFacility(id: string) {
  const facility = await FacilityModel.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
  if (!facility) throw new SupportError(404, 'Facility not found');
  return facility;
}
async function activeRequest(id: string) {
  const request = await SupportRequestModel.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
  if (!request) throw new SupportError(404, 'Support request not found');
  return request;
}
function assertCanAccess(actor: Actor, request: ISupportRequest) {
  if (actor.role === UserRole.CUSTOMER) {
    if (request.customerId.toString() !== actor._id.toString()) throw new SupportError(404, 'Support request not found');
    return;
  }
  if (actor.role === UserRole.FACILITY_STAFF) {
    if (request.assignedTo?.toString() !== actor._id.toString()) throw new SupportError(403, 'Staff may only access assigned requests');
    if (request.facilityId && request.facilityId.toString() !== actor.assignedFacilityId?.toString()) throw new SupportError(403, 'Facility is outside assigned scope');
    return;
  }
  if (actor.role === UserRole.FACILITY_MANAGER) {
    assertManagerScope(actor, request.facilityId?.toString()); return;
  }
  if (!management.includes(actor.role)) throw new SupportError(403, 'Forbidden');
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export class SupportRequestService {
  static async create(input: unknown, actor: Actor) {
    const data = parseCreate(input);
    if (actor.role === UserRole.CUSTOMER && data.customerId) throw new SupportError(400, 'customerId is derived from the authenticated user');
    if (!staffRoles.includes(actor.role) && actor.role !== UserRole.CUSTOMER) throw new SupportError(403, 'Forbidden');
    if (actor.role === UserRole.FACILITY_STAFF) throw new SupportError(403, 'Staff cannot create customer requests');
    if (actor.role === UserRole.FACILITY_MANAGER && (!data.facilityId || actor.assignedFacilityId?.toString() !== data.facilityId)) throw new SupportError(403, 'Facility is outside assigned scope');
    return execute(async () => {
      const customerId = actor.role === UserRole.CUSTOMER ? actor._id : data.customerId;
      if (!customerId) throw new SupportError(400, 'customerId is required when creating a request for a customer');
      const customer = await UserModel.findOne({ _id: customerId, role: UserRole.CUSTOMER, isActive: true }).exec();
      if (!customer) throw new SupportError(404, 'Customer not found');
      if (data.facilityId) await activeFacility(data.facilityId);
      if (data.relatedEntity) {
        const { type, id } = data.relatedEntity;
        if (type === 'FACILITY') {
          validateId(id, 'relatedEntity.id'); await activeFacility(id);
          if (data.facilityId && data.facilityId !== id.toLowerCase()) throw new SupportError(409, 'Related Facility must match facilityId');
        } else if (type === 'STORAGE_UNIT') {
          validateId(id, 'relatedEntity.id');
          const unit = await StorageUnitModel.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
          if (!unit) throw new SupportError(404, 'Related Storage Unit not found');
          if (data.facilityId && unit.facilityId.toString() !== data.facilityId) throw new SupportError(409, 'Related Storage Unit must belong to facilityId');
        }
      }
      const request = await SupportRequestModel.create({ ...data, customerId: new Types.ObjectId(customerId), ...(data.facilityId ? { facilityId: new Types.ObjectId(data.facilityId) } : {}) });
      audit(actor, request, ActionType.SUPPORT_CREATE, undefined, { status: request.status, category: request.category, priority: request.priority });
      return request;
    });
  }

  static async list(input: unknown, actor: Actor) {
    if (!staffRoles.includes(actor.role) && actor.role !== UserRole.CUSTOMER) throw new SupportError(403, 'Forbidden');
    const q = parseList(input);
    const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
    for (const key of ['facilityId', 'customerId', 'assignedTo', 'category', 'priority', 'status'] as const) if (q[key] !== undefined) filter[key] = q[key];
    if (q.isEscalated !== undefined) filter.escalatedAt = q.isEscalated === 'true' ? { $exists: true } : { $exists: false };
    const clauses: Record<string, unknown>[] = [];
    if (q.search) { const regex = new RegExp(escapeRegex(q.search), 'i'); clauses.push({ $or: [{ subject: regex }, { description: regex }] }); }
    if (actor.role === UserRole.CUSTOMER) {
      if (q.customerId && q.customerId !== actor._id.toString()) throw new SupportError(403, 'Cannot query another customer');
      filter.customerId = actor._id;
    } else if (actor.role === UserRole.FACILITY_MANAGER) {
      const facilityId = actor.assignedFacilityId?.toString(); if (!facilityId) throw new SupportError(403, 'Manager has no assigned facility');
      if (q.facilityId && q.facilityId !== facilityId) throw new SupportError(403, 'Facility is outside assigned scope');
      filter.facilityId = facilityId;
    } else if (actor.role === UserRole.FACILITY_STAFF) {
      if (q.assignedTo && q.assignedTo !== actor._id.toString()) throw new SupportError(403, 'Cannot query another staff member');
      filter.assignedTo = actor._id;
      const facility = actor.assignedFacilityId?.toString();
      if (q.facilityId && q.facilityId !== facility) throw new SupportError(403, 'Facility is outside assigned scope');
      clauses.push({ $or: facility ? [{ facilityId: facility }, { facilityId: { $exists: false } }] : [{ facilityId: { $exists: false } }] });
    }
    if (clauses.length) filter.$and = clauses;
    return execute(async () => {
      const [items, total] = await Promise.all([
        SupportRequestModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean().exec(),
        SupportRequestModel.countDocuments(filter).exec(),
      ]);
      return { data: items, pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
    });
  }

  static async get(idInput: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID');
    return execute(async () => { const request = await activeRequest(id); assertCanAccess(actor, request); return request; });
  }

  static async update(idInput: unknown, input: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID');
    if (actor.role !== UserRole.CUSTOMER && !management.includes(actor.role)) throw new SupportError(403, 'Forbidden');
    const data = parseUpdate(input, management.includes(actor.role));
    return execute(async () => {
      const request = await activeRequest(id); assertCanAccess(actor, request);
      if (actor.role === UserRole.CUSTOMER && request.status !== SupportStatus.OPEN) throw new SupportError(409, 'Customers may edit only OPEN requests');
      if (request.status === SupportStatus.CLOSED) throw new SupportError(409, 'Closed requests cannot be edited');
      const before = { subject: request.subject, description: request.description, category: request.category, priority: request.priority };
      request.set(data); await request.save(); audit(actor, request, ActionType.SUPPORT_UPDATE, before, data); return request;
    });
  }

  static async assign(idInput: unknown, input: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); const { staffId } = parseAssignment(input);
    if (!management.includes(actor.role)) throw new SupportError(403, 'Management role required');
    return execute(async () => {
      const request = await activeRequest(id); assertManagerScope(actor, request.facilityId?.toString());
      if (request.status !== SupportStatus.OPEN && request.status !== SupportStatus.ASSIGNED) throw new SupportError(409, 'Only OPEN or ASSIGNED requests can be assigned');
      const criteria: Record<string, unknown> = { _id: staffId, role: UserRole.FACILITY_STAFF, isActive: true };
      if (request.facilityId) criteria.assignedFacilityId = request.facilityId;
      const assignee = await UserModel.findOne(criteria).exec();
      if (!assignee) throw new SupportError(409, 'Assignee must be active FACILITY_STAFF in the request facility');
      const before = { status: request.status, assignedTo: request.assignedTo?.toString() };
      request.assignedTo = new Types.ObjectId(staffId); request.assignedAt = new Date(); request.status = SupportStatus.ASSIGNED;
      await request.save(); audit(actor, request, ActionType.SUPPORT_ASSIGN, before, { status: request.status, assignedTo: staffId }); return request;
    });
  }

  static async unassign(idInput: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); if (!management.includes(actor.role)) throw new SupportError(403, 'Management role required');
    return execute(async () => {
      const request = await activeRequest(id); assertManagerScope(actor, request.facilityId?.toString());
      if (request.status !== SupportStatus.ASSIGNED) throw new SupportError(409, 'Only ASSIGNED requests can be unassigned');
      const before = { status: request.status, assignedTo: request.assignedTo?.toString() };
      request.status = SupportStatus.OPEN; request.set('assignedTo', undefined); request.set('assignedAt', undefined);
      await request.save(); audit(actor, request, ActionType.SUPPORT_UNASSIGN, before, { status: request.status }); return request;
    });
  }

  static async updateStatus(idInput: unknown, input: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); const change = parseStatus(input);
    if (!staffRoles.includes(actor.role)) throw new SupportError(403, 'Forbidden');
    return execute(async () => {
      const request = await activeRequest(id); assertCanAccess(actor, request);
      const transitions: Record<string, string[]> = { OPEN: ['ASSIGNED'], ASSIGNED: ['IN_PROGRESS'], IN_PROGRESS: ['RESOLVED'], RESOLVED: ['CLOSED'], CLOSED: [] };
      if (!(transitions[request.status] ?? []).includes(change.status)) throw new SupportError(409, `Cannot transition ${request.status} to ${change.status}`);
      if (change.status === SupportStatus.ASSIGNED && !request.assignedTo) throw new SupportError(409, 'Assign a staff member before moving to ASSIGNED');
      if (change.status === SupportStatus.RESOLVED && !change.resolutionNote?.trim()) throw new SupportError(400, 'resolutionNote is required to resolve');
      const before = { status: request.status }; request.status = change.status;
      if (change.status === SupportStatus.RESOLVED) { request.resolutionNote = change.resolutionNote!; request.resolvedAt = new Date(); }
      if (change.status === SupportStatus.CLOSED) request.closedAt = new Date();
      await request.save(); audit(actor, request, ActionType.SUPPORT_STATUS_CHANGE, before, { status: request.status }); return request;
    });
  }

  static async addMessage(idInput: unknown, input: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); const customer = actor.role === UserRole.CUSTOMER; const data = parseMessage(input, customer);
    if (!staffRoles.includes(actor.role) && !customer) throw new SupportError(403, 'Forbidden');
    return execute(async () => {
      const request = await activeRequest(id); assertCanAccess(actor, request);
      const message = await SupportMessageModel.create({ supportRequestId: request._id, authorId: actor._id, authorRole: actor.role, ...data });
      audit(actor, request, ActionType.SUPPORT_MESSAGE_ADD, undefined, { isInternal: data.isInternal }); return message;
    });
  }

  static async listMessages(idInput: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID');
    if (!staffRoles.includes(actor.role) && actor.role !== UserRole.CUSTOMER) throw new SupportError(403, 'Forbidden');
    return execute(async () => {
      const request = await activeRequest(id); assertCanAccess(actor, request);
      return SupportMessageModel.find({ supportRequestId: request._id, ...(actor.role === UserRole.CUSTOMER ? { isInternal: false } : {}) }).sort({ createdAt: 1, _id: 1 }).lean().exec();
    });
  }

  static async escalate(idInput: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); if (!management.includes(actor.role)) throw new SupportError(403, 'Management role required');
    return execute(async () => {
      const request = await activeRequest(id); assertManagerScope(actor, request.facilityId?.toString());
      if (!request.facilityId) throw new SupportError(409, 'Facility-less requests cannot be escalated automatically to a Facility Manager');
      if ([SupportStatus.RESOLVED, SupportStatus.CLOSED].includes(request.status)) throw new SupportError(409, 'Resolved or closed requests cannot be escalated');
      if (request.escalatedAt) throw new SupportError(409, 'Request is already escalated');
      const managersForFacility = await UserModel.find({ role: UserRole.FACILITY_MANAGER, isActive: true, assignedFacilityId: request.facilityId }).limit(2).exec();
      if (managersForFacility.length !== 1) throw new SupportError(409, 'Facility escalation requires exactly one active Facility Manager');
      const manager = managersForFacility[0];
      if (!manager) throw new SupportError(409, 'Facility escalation manager could not be resolved');
      request.escalatedAt = new Date(); request.escalatedTo = manager._id;
      await request.save(); audit(actor, request, ActionType.SUPPORT_ESCALATE, undefined, { escalatedTo: manager._id.toString() }); return request;
    });
  }

  static async softDelete(idInput: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); if (!management.includes(actor.role)) throw new SupportError(403, 'Management role required');
    return execute(async () => {
      const request = await activeRequest(id); assertManagerScope(actor, request.facilityId?.toString());
      if (request.status !== SupportStatus.OPEN) throw new SupportError(409, 'Only OPEN requests can be deleted');
      request.deletedAt = new Date(); request.deletedBy = actor._id; await request.save();
      audit(actor, request, ActionType.SUPPORT_SOFT_DELETE, { status: request.status }, { deletedAt: request.deletedAt }); return request;
    });
  }

  static async restore(idInput: unknown, actor: Actor) {
    const id = validateId(idInput, 'support request ID'); if (!management.includes(actor.role)) throw new SupportError(403, 'Management role required');
    return execute(async () => {
      const request = await SupportRequestModel.findOne({ _id: id, deletedAt: { $exists: true } }).exec();
      if (!request) throw new SupportError(404, 'Deleted support request not found');
      assertManagerScope(actor, request.facilityId?.toString());
      if (request.facilityId) await activeFacility(request.facilityId.toString());
      request.set('deletedAt', undefined); request.set('deletedBy', undefined); await request.save();
      audit(actor, request, ActionType.SUPPORT_RESTORE, { deletedAt: true }, { status: request.status }); return request;
    });
  }
}
