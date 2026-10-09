import { Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { FacilityServiceType, FacilityStatus, IFacility } from '../../types/facility.type';
import { IUser, UserRole } from '../../types/user.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { managementStatuses, parseList, parseStatusBody, parseUnit, StorageUnitError, validateId } from './storage-unit.validation';

type Actor = Pick<IUser, 'role' | 'assignedFacilityId' | '_id'> | undefined;
function scope(actor: Actor, facilityId: string, write = false) {
  if (!actor) throw new StorageUnitError(401, 'Authentication required');
  if (!Object.values(UserRole).includes(actor.role)) throw new StorageUnitError(403, 'Forbidden');
  if (write && ![UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER].includes(actor.role)) {
    throw new StorageUnitError(403, 'Management role required');
  }
  if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) &&
      actor.assignedFacilityId?.toString() !== facilityId.toLowerCase()) {
    throw new StorageUnitError(403, 'Facility is outside assigned scope');
  }
}
function activeSelfStorage(facility: IFacility) {
  if (facility.status !== FacilityStatus.ACTIVE) {
    throw new StorageUnitError(
      409,
      'Facility must be ACTIVE to manage storage units'
    );
  }

  if (!facility.serviceTypes.includes(FacilityServiceType.SELF_STORAGE)) {
    throw new StorageUnitError(
      409,
      'Facility does not support SELF_STORAGE'
    );
  }
}
async function facilityById(id: string) {
  const facility = await FacilityModel.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
  if (!facility) throw new StorageUnitError(404, 'Facility not found');
  return facility;
}
async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error: unknown) {
    if (error instanceof StorageUnitError) throw error;
    const e = error as { code?: number; name?: string };
    if (e?.code === 11000) throw new StorageUnitError(409, 'Unit code already exists in facility');
    if (e?.name === 'VersionError') throw new StorageUnitError(409, 'Storage unit changed; reload before updating');
    if (['ValidationError', 'CastError'].includes(e?.name || '')) throw new StorageUnitError(400, 'Invalid storage unit data');
    throw new StorageUnitError(500, 'Internal Server Error');
  }
}
async function unitById(id: string, actor: Actor, write = false) {
  const unit = await StorageUnitModel.findOne({ _id: id, deletedAt: { $exists: false } }).exec();
  if (!unit) throw new StorageUnitError(404, 'Storage unit not found');
  scope(actor, unit.facilityId.toString(), write);
  return unit;
}
export class StorageUnitService {
  static async createStorageUnit(facilityId: unknown, input: unknown, actor: Actor) {
    validateId(facilityId);
    scope(actor, facilityId, true);
    const data = parseUnit(input);
    return execute(async () => {
      activeSelfStorage(await facilityById(facilityId));
      // save/validate middleware derives volume; no client volume is accepted.
      return StorageUnitModel.create({ ...data, facilityId: new Types.ObjectId(facilityId) });
    });
  }
  static async getStorageUnits(facilityId: unknown, input: unknown, actor: Actor) {
    validateId(facilityId);
    scope(actor, facilityId);
    const { page, limit, filter } = parseList(input);
    return execute(async () => {
      await facilityById(facilityId);
      const scopedFilter = { ...filter, deletedAt: { $exists: false }, facilityId: new Types.ObjectId(facilityId) };
      const [data, total] = await Promise.all([
        StorageUnitModel.find(scopedFilter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        StorageUnitModel.countDocuments(scopedFilter).exec(),
      ]);
      return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  static async getStorageUnitById(id: unknown, actor: Actor) {
    validateId(id);
    return execute(() => unitById(id, actor));
  }
  static async updateStorageUnit(id: unknown, input: unknown, actor: Actor) {
    validateId(id);
    const data = parseUnit(input, true);
    return execute(async () => {
      const unit = await unitById(id, actor, true);
      if (!managementStatuses.includes(unit.status)) throw new StorageUnitError(409, 'Cannot edit a HELD or OCCUPIED unit');
      activeSelfStorage(await facilityById(unit.facilityId.toString()));
      unit.set(data);
      return unit.save();
    });
  }
  static async updateStorageUnitStatus(id: unknown, input: unknown, actor: Actor) {
    validateId(id);
    const status = parseStatusBody(input);
    return execute(async () => {
      const unit = await unitById(id, actor, true);
      if (!managementStatuses.includes(unit.status)) throw new StorageUnitError(409, 'Cannot change a HELD or OCCUPIED unit');
      const facility = await facilityById(unit.facilityId.toString());
      if (status === StorageUnitStatus.AVAILABLE) activeSelfStorage(facility);
      unit.status = status;
      return unit.save();
    });
  }
  static async deleteStorageUnit(id: unknown, actor: Actor) {
    validateId(id);
    return execute(async () => {
      const unit = await unitById(id, actor, true);
      if (!managementStatuses.includes(unit.status)) throw new StorageUnitError(409, 'HELD and OCCUPIED units cannot be deleted');
      unit.deletedAt = new Date();
      if (actor && '_id' in actor && actor._id) unit.deletedBy = new Types.ObjectId(actor._id);
      return unit.save();
    });
  }
  static async restoreStorageUnit(id: unknown, actor: Actor) {
    validateId(id);
    if (!actor) throw new StorageUnitError(401, 'Authentication required');
    return execute(async () => {
      const unit = await StorageUnitModel.findById(id).exec();
      if (!unit || !unit.deletedAt) throw new StorageUnitError(404, 'Deleted storage unit not found');
      scope(actor, unit.facilityId.toString(), true);
      const facility = await facilityById(unit.facilityId.toString());
      if (!facility.serviceTypes.includes(FacilityServiceType.SELF_STORAGE)) {
        throw new StorageUnitError(409, 'Facility does not support SELF_STORAGE');
      }
      const restored = await StorageUnitModel.findOneAndUpdate(
        { _id: id, deletedAt: { $exists: true } },
        { $unset: { deletedAt: 1, deletedBy: 1 } },
        { new: true, runValidators: true },
      ).exec();
      if (!restored) throw new StorageUnitError(404, 'Deleted storage unit not found');
      return restored;
    });
  }
}
