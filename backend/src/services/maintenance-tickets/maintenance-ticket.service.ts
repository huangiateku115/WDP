import { Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import UserModel from '../../models/users/user.model';
import MaintenanceTicketModel from '../../models/maintenance-tickets/maintenance-ticket.model';
import { ActionType, IAuditLog } from '../../types/audit.type';
import { IMaintenanceTicket, MaintenanceStatus } from '../../types/maintenance-ticket.type';
import { IUser, UserRole } from '../../types/user.type';
import { AuditService } from '../audit/audit.service';
import { MaintenanceTicketError, parseAssignment, parseCreate, parseList, parseStatus, parseUpdate, validateId } from './maintenance-ticket.validation';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
const admins = [UserRole.ADMIN, UserRole.BOM];
const managers = [...admins, UserRole.FACILITY_MANAGER];
const readers = [...managers, UserRole.FACILITY_STAFF];
function audit(actor: Actor, ticket: IMaintenanceTicket, action: ActionType, before?: unknown, after?: unknown) {
  const payload: IAuditLog = {
    actorId: actor._id.toString(), actorRole: actor.role, action,
    entityType: 'MaintenanceTicket', entityId: ticket._id.toString(), facilityId: ticket.facilityId.toString(),
    ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}),
  };
  AuditService.logAction(payload);
}
async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof MaintenanceTicketError) throw error;
    const e = error as { code?: number; name?: string };
    if (e?.code === 11000 || e?.name === 'VersionError') throw new MaintenanceTicketError(409, 'Maintenance ticket changed; reload and retry');
    if (e?.name === 'CastError' || e?.name === 'ValidationError') throw new MaintenanceTicketError(400, 'Invalid maintenance ticket data');
    throw new MaintenanceTicketError(500, 'Internal Server Error');
  }
}
function assertFacilityScope(actor: Actor, facilityId: string) {
  if (!readers.includes(actor.role)) throw new MaintenanceTicketError(403, 'Forbidden');
  if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) &&
      actor.assignedFacilityId?.toString() !== facilityId.toLowerCase()) {
    throw new MaintenanceTicketError(403, 'Facility is outside assigned scope');
  }
}
function assertManager(actor: Actor, facilityId: string) {
  if (!managers.includes(actor.role)) throw new MaintenanceTicketError(403, 'Management role required');
  assertFacilityScope(actor, facilityId);
}
async function activeFacility(facilityId: string) {
  const facility = await FacilityModel.findOne({ _id: facilityId, deletedAt: { $exists: false } }).exec();
  if (!facility) throw new MaintenanceTicketError(404, 'Facility not found');
  return facility;
}
async function ticketById(id: string) {
  const ticket = await MaintenanceTicketModel.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
  if (!ticket) throw new MaintenanceTicketError(404, 'Maintenance ticket not found');
  return ticket;
}
function assertRead(actor: Actor, ticket: IMaintenanceTicket) {
  if (!readers.includes(actor.role)) throw new MaintenanceTicketError(403, 'Forbidden');
  assertFacilityScope(actor, ticket.facilityId.toString());
  if (actor.role === UserRole.FACILITY_STAFF && ticket.assignedTo?.toString() !== actor._id.toString()) {
    throw new MaintenanceTicketError(403, 'Staff may only access assigned tickets');
  }
}
async function assignableStaff(userId: string, facilityId: string) {
  const user = await UserModel.findOne({
    _id: userId, role: UserRole.FACILITY_STAFF, isActive: true, assignedFacilityId: new Types.ObjectId(facilityId),
  }).exec();
  if (!user) throw new MaintenanceTicketError(409, 'Assignee must be active FACILITY_STAFF assigned to this facility');
}

export class MaintenanceTicketService {
  static async create(input: unknown, actor: Actor) {
    const data = parseCreate(input);
    assertFacilityScope(actor, data.facilityId);
    return execute(async () => {
      await activeFacility(data.facilityId);
      if (data.storageUnitId) {
        const unit = await StorageUnitModel.findOne({ _id: data.storageUnitId, deletedAt: { $exists: false } }).exec();
        if (!unit) throw new MaintenanceTicketError(404, 'Storage Unit not found');
        if (unit.facilityId.toString() !== data.facilityId.toLowerCase()) throw new MaintenanceTicketError(409, 'Storage Unit must belong to the ticket Facility');
      }
      const ticket = await MaintenanceTicketModel.create({
        ...data, facilityId: new Types.ObjectId(data.facilityId),
        ...(data.storageUnitId ? { storageUnitId: new Types.ObjectId(data.storageUnitId) } : {}),
        reportedBy: actor._id,
      });
      audit(actor, ticket, ActionType.MAINTENANCE_CREATE, undefined, { status: ticket.status, category: ticket.category, priority: ticket.priority });
      return ticket;
    });
  }
  static async list(query: unknown, actor: Actor) {
    if (!readers.includes(actor.role)) throw new MaintenanceTicketError(403, 'Forbidden');
    const { page, limit, filter } = parseList(query);
    const requestedFacility = filter.facilityId as string | undefined;
    if (requestedFacility) assertFacilityScope(actor, requestedFacility);
    if (actor.role === UserRole.FACILITY_MANAGER || actor.role === UserRole.FACILITY_STAFF) {
      if (!actor.assignedFacilityId) throw new MaintenanceTicketError(403, 'Facility assignment is required');
      filter.facilityId = actor.assignedFacilityId;
    }
    if (actor.role === UserRole.FACILITY_STAFF) {
      if (filter.assignedTo && String(filter.assignedTo) !== actor._id.toString()) throw new MaintenanceTicketError(403, 'Staff may only list assigned tickets');
      filter.assignedTo = actor._id;
    }
    filter.deletedAt = { $exists: false };
    return execute(async () => {
      const [data, total] = await Promise.all([
        MaintenanceTicketModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        MaintenanceTicketModel.countDocuments(filter).exec(),
      ]);
      return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  static async get(id: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    return execute(async () => {
      const ticket = await ticketById(id);
      assertRead(actor, ticket);
      return ticket;
    });
  }
  static async update(id: unknown, input: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    const changes = parseUpdate(input);
    return execute(async () => {
      const ticket = await ticketById(id);
      assertManager(actor, ticket.facilityId.toString());
      ticket.set(changes);
      await ticket.save();
      return ticket;
    });
  }
  static async assign(id: unknown, input: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    const assignedTo = parseAssignment(input);
    return execute(async () => {
      const ticket = await ticketById(id);
      assertManager(actor, ticket.facilityId.toString());
      if (![MaintenanceStatus.OPEN, MaintenanceStatus.ASSIGNED].includes(ticket.status)) throw new MaintenanceTicketError(409, 'Only OPEN or ASSIGNED tickets can be assigned');
      await assignableStaff(assignedTo, ticket.facilityId.toString());
      const before = { assignedTo: ticket.assignedTo, status: ticket.status };
      ticket.assignedTo = new Types.ObjectId(assignedTo);
      ticket.assignedAt = new Date();
      ticket.status = MaintenanceStatus.ASSIGNED;
      await ticket.save();
      audit(actor, ticket, ActionType.MAINTENANCE_ASSIGN, before, { assignedTo: ticket.assignedTo, status: ticket.status });
      return ticket;
    });
  }
  static async unassign(id: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    return execute(async () => {
      const ticket = await ticketById(id);
      assertManager(actor, ticket.facilityId.toString());
      if (ticket.status !== MaintenanceStatus.ASSIGNED) throw new MaintenanceTicketError(409, 'Only ASSIGNED tickets can be unassigned');
      const before = { assignedTo: ticket.assignedTo, status: ticket.status };
      ticket.set('assignedTo', undefined);
      ticket.set('assignedAt', undefined);
      ticket.status = MaintenanceStatus.OPEN;
      await ticket.save();
      audit(actor, ticket, ActionType.MAINTENANCE_UNASSIGN, before, { status: ticket.status });
      return ticket;
    });
  }
  static async updateStatus(id: unknown, input: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    const change = parseStatus(input);
    return execute(async () => {
      const ticket = await ticketById(id);
      assertFacilityScope(actor, ticket.facilityId.toString());
      if (actor.role === UserRole.FACILITY_STAFF && ticket.assignedTo?.toString() !== actor._id.toString()) {
        throw new MaintenanceTicketError(403, 'Staff may only progress assigned tickets');
      }
      const allowed: Partial<Record<MaintenanceStatus, MaintenanceStatus>> = {
        [MaintenanceStatus.OPEN]: MaintenanceStatus.ASSIGNED,
        [MaintenanceStatus.ASSIGNED]: MaintenanceStatus.IN_PROGRESS,
        [MaintenanceStatus.IN_PROGRESS]: MaintenanceStatus.RESOLVED,
        [MaintenanceStatus.RESOLVED]: MaintenanceStatus.CLOSED,
      };
      if (allowed[ticket.status] !== change.status) throw new MaintenanceTicketError(409, 'Invalid maintenance status transition');
      if (change.status === MaintenanceStatus.ASSIGNED && !ticket.assignedTo) throw new MaintenanceTicketError(409, 'Assign a staff member before entering ASSIGNED');
      if (change.status === MaintenanceStatus.RESOLVED && !change.resolutionNote) throw new MaintenanceTicketError(400, 'resolutionNote is required');
      const before = { status: ticket.status, resolutionNote: ticket.resolutionNote };
      ticket.status = change.status;
      if (change.status === MaintenanceStatus.RESOLVED) {
        ticket.resolutionNote = change.resolutionNote!;
        ticket.resolvedAt = new Date();
      }
      if (change.status === MaintenanceStatus.CLOSED) ticket.closedAt = new Date();
      await ticket.save();
      audit(actor, ticket, ActionType.MAINTENANCE_STATUS_CHANGE, before, { status: ticket.status, resolutionNote: ticket.resolutionNote });
      return ticket;
    });
  }
  static async softDelete(id: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    return execute(async () => {
      const ticket = await ticketById(id);
      assertManager(actor, ticket.facilityId.toString());
      if (ticket.status !== MaintenanceStatus.OPEN) throw new MaintenanceTicketError(409, 'Only OPEN tickets can be deleted');
      const before = { status: ticket.status };
      ticket.deletedAt = new Date(); ticket.deletedBy = actor._id;
      await ticket.save();
      audit(actor, ticket, ActionType.MAINTENANCE_SOFT_DELETE, before, { deletedAt: ticket.deletedAt });
      return ticket;
    });
  }
  static async restore(id: unknown, actor: Actor) {
    validateId(id, 'ticket ID');
    return execute(async () => {
      const ticket = await MaintenanceTicketModel.findOne({ _id: id, deletedAt: { $exists: true } }).exec();
      if (!ticket) throw new MaintenanceTicketError(404, 'Deleted maintenance ticket not found');
      assertManager(actor, ticket.facilityId.toString());
      await activeFacility(ticket.facilityId.toString());
      ticket.set('deletedAt', undefined); ticket.set('deletedBy', undefined);
      await ticket.save();
      audit(actor, ticket, ActionType.MAINTENANCE_RESTORE, { deletedAt: true }, { status: ticket.status });
      return ticket;
    });
  }
}
