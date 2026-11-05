import { Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { ReservationService } from '../reservations/reservation.service';
import { FacilityServiceType, FacilityStatus, IFacility } from '../../types/facility.type';
import { IUser, UserRole } from '../../types/user.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { managementStatuses, parseList, parseStatusBody, parseUnit, StorageUnitError, validateId } from './storage-unit.validation';

type Actor = Pick<IUser, 'role' | 'assignedFacilityId' | '_id'> | undefined;
function scope(actor: Actor, facilityId: string, write = false) {
  if (!actor) throw new StorageUnitError(401, 'Authentication required');
  if (!Object.values(UserRole).includes(actor.role)) throw new StorageUnitError(403, 'Bạn không có đủ quyền truy cập!');
  if (write && ![UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER].includes(actor.role)) {
    throw new StorageUnitError(403, 'Bạn không có đủ quyền truy cập!');
  }
  if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) &&
      actor.assignedFacilityId?.toString() !== facilityId.toLowerCase()) {
    throw new StorageUnitError(403, 'Bạn không có đủ quyền truy cập!');
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
  static async getUnitAvailability(id: unknown, input: unknown, actor: Actor) {
    validateId(id);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageUnitError(400, 'Invalid availability query');
    const query = input as Record<string, unknown>;
    const month = query.month;
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new StorageUnitError(400, 'month must use YYYY-MM');
    }
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    if (!Number.isFinite(monthStart.getTime()) || monthStart.toISOString().slice(0, 7) !== month) {
      throw new StorageUnitError(400, 'month is invalid');
    }
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const hasStart = query.startDate !== undefined;
    const hasEnd = query.endDate !== undefined;
    if (hasStart !== hasEnd) throw new StorageUnitError(400, 'startDate and endDate must be provided together');
    const parseUtcDate = (value: unknown, field: string) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StorageUnitError(400, `${field} must use YYYY-MM-DD`);
      const date = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new StorageUnitError(400, `${field} is invalid`);
      return date;
    };
    const rangeStart = hasStart ? parseUtcDate(query.startDate, 'startDate') : undefined;
    const rangeEnd = hasEnd ? parseUtcDate(query.endDate, 'endDate') : undefined;
    if (rangeStart && rangeEnd && rangeEnd <= rangeStart) throw new StorageUnitError(400, 'endDate must be after startDate');

    return execute(async () => {
      const unit = await unitById(id, actor);
      const facility = await facilityById(unit.facilityId.toString());
      const unitUnavailable = facility.status !== FacilityStatus.ACTIVE ||
        !facility.serviceTypes.includes(FacilityServiceType.SELF_STORAGE) ||
        [StorageUnitStatus.INACTIVE, StorageUnitStatus.MAINTENANCE].includes(unit.status);
      const stateFor = async (startDate: Date, endDate: Date) => {
        const reservations: any[] = await ReservationModel.find({
          storageUnitId: unit._id,
          facilityId: unit.facilityId,
          serviceType: FacilityServiceType.SELF_STORAGE,
          ...ReservationService.buildOverlapFilter(startDate, endDate),
        }).select('startDate endDate').sort({ startDate: 1, _id: 1 }).limit(501).lean().exec();
        if (reservations.length > 500) return { unknown: true, reservations: [] as any[] };
        return { unknown: false, reservations };
      };
      const monthResult = unitUnavailable ? { unknown: false, reservations: [] as any[] } : await stateFor(monthStart, monthEnd);
      const intervals = monthResult.unknown ? [] : monthResult.reservations.map(reservation => ({
        startDate: new Date(Math.max(new Date(reservation.startDate).getTime(), monthStart.getTime())).toISOString(),
        endDate: new Date(Math.min(new Date(reservation.endDate).getTime(), monthEnd.getTime())).toISOString(),
      }));
      let rangeAvailability: 'AVAILABLE' | 'CONFLICT' | 'UNIT_UNAVAILABLE' | 'UNKNOWN' | null = null;
      if (unitUnavailable) rangeAvailability = 'UNIT_UNAVAILABLE';
      else if (rangeStart && rangeEnd) {
        const rangeResult = await stateFor(rangeStart, rangeEnd);
        rangeAvailability = rangeResult.unknown ? 'UNKNOWN' : rangeResult.reservations.length ? 'CONFLICT' : 'AVAILABLE';
      }
      if (monthResult.unknown && !rangeAvailability) rangeAvailability = 'UNKNOWN';
      if (monthResult.unknown && rangeAvailability === 'AVAILABLE') rangeAvailability = 'UNKNOWN';
      return {
        storageUnitId: unit._id,
        month,
        intervals,
        availabilityState: unitUnavailable ? 'UNIT_UNAVAILABLE' : monthResult.unknown ? 'UNKNOWN' : 'VERIFIED',
        rangeAvailability,
        requestedRange: rangeStart && rangeEnd ? { startDate: rangeStart.toISOString(), endDate: rangeEnd.toISOString() } : null,
        evaluatedAt: new Date().toISOString(),
      };
    });
  }

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
    const parsed = parseList(input);
    const { page, limit, filter } = parsed;
    const dateRange = (parsed as any).dateRange as { startDate: Date; endDate: Date; availableOnly: boolean } | undefined;
    return execute(async () => {
      await facilityById(facilityId);
      const facilityObjectId = new Types.ObjectId(facilityId);
      const scopedFilter: Record<string, unknown> = { ...filter, deletedAt: { $exists: false }, facilityId: facilityObjectId };

      if (!dateRange) {
        const [data, total] = await Promise.all([
          StorageUnitModel.find(scopedFilter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
          StorageUnitModel.countDocuments(scopedFilter).exec(),
        ]);
        return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
      }

      const overlapFilter = {
        facilityId: facilityObjectId,
        serviceType: FacilityServiceType.SELF_STORAGE,
        ...ReservationService.buildOverlapFilter(dateRange.startDate, dateRange.endDate),
      };
      let resQuery: any = ReservationModel.find(overlapFilter);
      if (typeof resQuery?.select === 'function') resQuery = resQuery.select('storageUnitId');
      if (typeof resQuery?.lean === 'function') resQuery = resQuery.lean();
      const overlapping = typeof resQuery?.exec === 'function' ? await resQuery.exec() : await resQuery;

      const occupiedIds = new Set<string>(
        (Array.isArray(overlapping) ? overlapping : [])
          .filter((r: any) => r?.storageUnitId)
          .map((r: any) => r.storageUnitId.toString())
      );

      if (dateRange.availableOnly) {
        if (scopedFilter.status === undefined) {
          scopedFilter.status = StorageUnitStatus.AVAILABLE;
        }
        if (occupiedIds.size > 0) {
          scopedFilter._id = { $nin: Array.from(occupiedIds).map(id => new Types.ObjectId(id)) };
        }
      }

      const [rawUnits, total] = await Promise.all([
        StorageUnitModel.find(scopedFilter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        StorageUnitModel.countDocuments(scopedFilter).exec(),
      ]);

      const data = rawUnits.map((u: any) => ({
        ...u,
        isAvailableInRange: (!u.status || u.status === StorageUnitStatus.AVAILABLE) && !occupiedIds.has(String(u._id)),
      }));

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
