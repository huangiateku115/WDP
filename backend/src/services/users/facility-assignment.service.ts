import mongoose, { Types } from 'mongoose';
import UserModel from '../../models/users/user.model';
import FacilityModel from '../../models/facilities/facility.model';
import { AuditLogModel } from '../../models/audit/audit.model';
import { ActionType } from '../../types/audit.type';
import { IUser, UserRole } from '../../types/user.type';

export class FacilityAssignmentError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type Actor = Pick<IUser, '_id' | 'role'> & Partial<Pick<IUser, 'assignedFacilityId'>>;
type AssignmentDto = { _id: string; role: UserRole; assignedFacilityId: string | null };
const assignableRoles = [UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF];
const objectIdPattern = /^[a-fA-F0-9]{24}$/;

function fail(status: number, message: string): never { throw new FacilityAssignmentError(status, message); }
function parseObjectId(value: unknown, field: string): Types.ObjectId {
  if (typeof value !== 'string' || !objectIdPattern.test(value)) fail(400, `Invalid ${field}`);
  return new Types.ObjectId(value);
}
function dto(user: { _id: Types.ObjectId; role: UserRole; assignedFacilityId?: Types.ObjectId | null }): AssignmentDto {
  return { _id: user._id.toString(), role: user.role, assignedFacilityId: user.assignedFacilityId?.toString() ?? null };
}
function validateActor(actor?: Actor): asserts actor is Actor {
  if (!actor) fail(401, 'Authentication required');
  if (![UserRole.ADMIN, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Role cannot manage Facility assignments');
}
function validateBody(body: unknown): Types.ObjectId {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request body');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'facilityId')) fail(400, 'Only facilityId is allowed');
  return parseObjectId(input.facilityId, 'facilityId');
}
function assertAssignableRole(role: UserRole): void {
  if (!assignableRoles.includes(role)) fail(403, 'Only Facility Managers and Facility Staff can be assigned');
}

export class FacilityAssignmentService {
  static async assign(userIdValue: unknown, body: unknown, actorValue?: Actor) {
    const userId = parseObjectId(userIdValue, 'userId');
    const facilityId = validateBody(body);
    validateActor(actorValue);

    const session = await mongoose.startSession();
    let result: AssignmentDto | undefined;
    try {
      await session.withTransaction(async () => {
        const actor = await UserModel.findById(actorValue._id).session(session).exec();
        if (!actor || !actor.isActive) fail(403, 'Active actor account required');

        let scopeFacilityId: Types.ObjectId | null = null;
        if (actor.role === UserRole.FACILITY_MANAGER) {
          if (!actor.assignedFacilityId) fail(403, 'Manager must have an assigned Facility');
          scopeFacilityId = new Types.ObjectId(actor.assignedFacilityId.toString());
          if (!scopeFacilityId.equals(facilityId)) fail(403, 'Manager can assign Staff only to their Facility');
        } else if (actor.role !== UserRole.ADMIN) {
          fail(403, 'Role cannot manage Facility assignments');
        }

        const facility = await FacilityModel.findOne({ _id: facilityId, deletedAt: { $exists: false } }).session(session).exec();
        if (!facility) fail(404, 'Facility not found');

        const target = await UserModel.findById(userId).session(session).exec();
        if (!target) fail(404, 'User not found');
        assertAssignableRole(target.role);
        if (actor.role === UserRole.FACILITY_MANAGER && target.role !== UserRole.FACILITY_STAFF) {
          fail(403, 'Facility Manager can manage Facility Staff only');
        }
        if (!target.isActive) fail(409, 'Inactive users cannot be assigned');

        const previousFacilityId = target.assignedFacilityId ?? null;
        if (actor.role === UserRole.FACILITY_MANAGER && previousFacilityId && !previousFacilityId.equals(scopeFacilityId!)) {
          fail(403, 'Staff assigned to another Facility cannot be transferred by a Manager');
        }
        if (previousFacilityId?.equals(facilityId)) {
          result = dto(target);
          return;
        }

        // The prior assignment is part of the filter so a stale read cannot overwrite a concurrent reassignment.
        const filter: Record<string, unknown> = { _id: userId, role: target.role, isActive: true };
        filter.assignedFacilityId = previousFacilityId;
        if (scopeFacilityId) {
          filter.$or = [{ assignedFacilityId: null }, { assignedFacilityId: scopeFacilityId }];
        }
        const updated = await UserModel.findOneAndUpdate(
          filter,
          { $set: { assignedFacilityId: facilityId } },
          { new: true, runValidators: true, session },
        ).exec();
        if (!updated) {
          const current = await UserModel.findById(userId).session(session).exec();
          if (!current) fail(404, 'User not found');
          if (actor.role === UserRole.FACILITY_MANAGER && current.assignedFacilityId && !current.assignedFacilityId.equals(scopeFacilityId!)) {
            fail(403, 'Staff assignment changed outside the Manager Facility scope');
          }
          fail(409, 'Facility assignment changed concurrently; retry the request');
        }

        const action = previousFacilityId ? ActionType.FACILITY_REASSIGNED : ActionType.FACILITY_ASSIGNED;
        await new AuditLogModel({
          actorId: actor._id,
          actorRole: actor.role,
          action,
          entityType: 'FacilityAssignment',
          entityId: updated._id,
          facilityId,
          before: { targetUserId: updated._id, targetRole: updated.role, previousFacilityId },
          after: { targetUserId: updated._id, targetRole: updated.role, newFacilityId: facilityId },
        }).save({ session });
        result = dto(updated);
      });
      if (!result) fail(500, 'Facility assignment did not complete');
      return result;
    } finally {
      await session.endSession();
    }
  }

  static async unassign(userIdValue: unknown, actorValue?: Actor) {
    const userId = parseObjectId(userIdValue, 'userId');
    validateActor(actorValue);

    const session = await mongoose.startSession();
    let result: AssignmentDto | undefined;
    try {
      await session.withTransaction(async () => {
        const actor = await UserModel.findById(actorValue._id).session(session).exec();
        if (!actor || !actor.isActive) fail(403, 'Active actor account required');
        let managerFacilityId: Types.ObjectId | null = null;
        if (actor.role === UserRole.FACILITY_MANAGER) {
          if (!actor.assignedFacilityId) fail(403, 'Manager must have an assigned Facility');
          managerFacilityId = new Types.ObjectId(actor.assignedFacilityId.toString());
          const facility = await FacilityModel.findOne({ _id: managerFacilityId, deletedAt: { $exists: false } }).session(session).exec();
          if (!facility) fail(403, 'Manager Facility is unavailable');
        } else if (actor.role !== UserRole.ADMIN) {
          fail(403, 'Role cannot manage Facility assignments');
        }

        const target = await UserModel.findById(userId).session(session).exec();
        if (!target) fail(404, 'User not found');
        assertAssignableRole(target.role);
        if (actor.role === UserRole.FACILITY_MANAGER && target.role !== UserRole.FACILITY_STAFF) {
          fail(403, 'Facility Manager can manage Facility Staff only');
        }
        const previousFacilityId = target.assignedFacilityId ?? null;
        if (!previousFacilityId) {
          if (actor.role === UserRole.FACILITY_MANAGER) fail(403, 'Staff is not assigned to the Manager Facility');
          result = dto(target);
          return;
        }
        if (managerFacilityId && !previousFacilityId.equals(managerFacilityId)) {
          fail(403, 'Staff assigned to another Facility cannot be unassigned by this Manager');
        }

        const filter: Record<string, unknown> = { _id: userId, role: target.role, isActive: true, assignedFacilityId: previousFacilityId };
        if (managerFacilityId) filter.assignedFacilityId = managerFacilityId;
        const updated = await UserModel.findOneAndUpdate(
          filter,
          { $set: { assignedFacilityId: null } },
          { new: true, runValidators: true, session },
        ).exec();
        if (!updated) {
          const current = await UserModel.findById(userId).session(session).exec();
          if (!current) fail(404, 'User not found');
          if (managerFacilityId && !current.assignedFacilityId?.equals(managerFacilityId)) {
            fail(403, 'Staff assignment changed outside the Manager Facility scope');
          }
          fail(409, 'Facility assignment changed concurrently; retry the request');
        }

        await new AuditLogModel({
          actorId: actor._id,
          actorRole: actor.role,
          action: ActionType.FACILITY_UNASSIGNED,
          entityType: 'FacilityAssignment',
          entityId: updated._id,
          facilityId: previousFacilityId,
          before: { targetUserId: updated._id, targetRole: updated.role, previousFacilityId },
          after: { targetUserId: updated._id, targetRole: updated.role, newFacilityId: null },
        }).save({ session });
        result = dto(updated);
      });
      if (!result) fail(500, 'Facility unassignment did not complete');
      return result;
    } finally {
      await session.endSession();
    }
  }
}
