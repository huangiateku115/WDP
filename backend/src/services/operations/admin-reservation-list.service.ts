import { Types } from 'mongoose';
import ReservationModel from '../../models/reservations/reservation.model';
import { FacilityServiceType } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { UserRole } from '../../types/user.type';

export class ReservationListError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const allowed = new Set(['facilityId', 'serviceType', 'status', 'customerId', 'reservationCode', 'fromDate', 'toDate', 'page', 'limit', 'sortOrder']);
const dateStart = (value: unknown, key: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReservationListError(400, 'INVALID_DATE', `${key} must use YYYY-MM-DD`);
  const [y,m,d] = value.split('-').map(Number); const utc = Date.UTC(y!,m!-1,d!); const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m! - 1 || check.getUTCDate() !== d) throw new ReservationListError(400, 'INVALID_DATE', `${key} is invalid`);
  return new Date(utc - 7 * 3600000);
};
const id = (value: unknown, key: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new ReservationListError(400, 'INVALID_FILTER', `${key} must be a valid ObjectId`);
  return new Types.ObjectId(value);
};

export function parseReservationListQuery(input: Record<string, unknown>, actor: { role: UserRole; assignedFacilityId?: unknown }) {
  const unknown = Object.keys(input).find(key => !allowed.has(key));
  if (unknown) throw new ReservationListError(400, 'INVALID_QUERY', `Unsupported query parameter: ${unknown}`);
  for (const [key, value] of Object.entries(input)) if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) throw new ReservationListError(400, 'INVALID_QUERY', `${key} must be a single string`);
  const page = input.page === undefined ? 1 : Number(input.page), limit = input.limit === undefined ? 20 : Number(input.limit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ReservationListError(400, 'INVALID_PAGINATION', 'page or limit is outside the supported range');
  if (input.serviceType !== undefined && !Object.values(FacilityServiceType).includes(input.serviceType as FacilityServiceType)) throw new ReservationListError(400, 'INVALID_FILTER', 'serviceType is not supported');
  if (input.status !== undefined && !Object.values(ReservationStatus).includes(input.status as ReservationStatus)) throw new ReservationListError(400, 'INVALID_FILTER', 'status is not supported');
  const from = dateStart(input.fromDate, 'fromDate'), to = dateStart(input.toDate, 'toDate');
  const toExclusive = to ? new Date(to.getTime() + 86400000) : undefined;
  if (from && toExclusive && (from >= toExclusive || toExclusive.getTime() - from.getTime() > 366 * 86400000)) throw new ReservationListError(400, 'INVALID_DATE_RANGE', 'Date range must be valid and no longer than 366 days');
  const requestedFacility = id(input.facilityId, 'facilityId');
  let facilityId = requestedFacility;
  if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role)) {
    const assigned = actor.assignedFacilityId;
    if (!assigned || !Types.ObjectId.isValid(String(assigned))) throw new ReservationListError(403, 'FACILITY_SCOPE_REQUIRED', 'User has no assigned Facility');
    const assignedId = new Types.ObjectId(String(assigned));
    if (requestedFacility && !requestedFacility.equals(assignedId)) throw new ReservationListError(403, 'FACILITY_SCOPE_FORBIDDEN', 'Facility is outside assigned scope');
    facilityId = assignedId;
  }
  const filter: Record<string, unknown> = {};
  if (facilityId) filter.facilityId = facilityId;
  if (input.serviceType) filter.serviceType = input.serviceType;
  if (input.status) filter.status = input.status;
  const customerId = id(input.customerId, 'customerId'); if (customerId) filter.customerId = customerId;
  if (typeof input.reservationCode === 'string') {
    const code = input.reservationCode.trim();
    if (!code || code.length > 100) throw new ReservationListError(400, 'INVALID_FILTER', 'reservationCode must be 1 to 100 characters');
    filter.reservationCode = new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  if (from || toExclusive) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(toExclusive ? { $lt: toExclusive } : {}) };
  if (input.sortOrder !== undefined && input.sortOrder !== 'asc' && input.sortOrder !== 'desc') throw new ReservationListError(400, 'INVALID_SORT', 'sortOrder must be asc or desc');
  return { filter, page, limit, direction: (input.sortOrder === 'asc' ? 1 : -1) as 1 | -1 };
}

export class AdminReservationListService {
  static async list(query: Record<string, unknown>, actor: { role: UserRole; assignedFacilityId?: unknown }) {
    const parsed = parseReservationListQuery(query, actor), skip = (parsed.page - 1) * parsed.limit;
    const [rows, total] = await Promise.all([
      ReservationModel.find(parsed.filter as any)
        .select('_id reservationCode serviceType status customerId facilityId storageUnitId startDate endDate createdAt allocatedCapacity')
        .populate('customerId', 'displayName')
        .populate('facilityId', 'name code')
        .populate('storageUnitId', 'unitCode')
        .sort({ createdAt: parsed.direction, _id: parsed.direction }).skip(skip).limit(parsed.limit).lean().exec(),
      ReservationModel.countDocuments(parsed.filter as any).exec(),
    ]);
    return { items: rows.map((row: any) => ({
      _id: row._id, reservationCode: row.reservationCode, serviceType: row.serviceType, status: row.status,
      customer: row.customerId && typeof row.customerId === 'object' ? { _id: row.customerId._id, displayName: row.customerId.displayName } : null,
      facility: row.facilityId && typeof row.facilityId === 'object' ? { _id: row.facilityId._id, name: row.facilityId.name, code: row.facilityId.code } : null,
      storageUnit: row.storageUnitId && typeof row.storageUnitId === 'object' ? { _id: row.storageUnitId._id, unitCode: row.storageUnitId.unitCode } : null,
      startDate: row.startDate, endDate: row.endDate, createdAt: row.createdAt, allocatedCapacity: row.allocatedCapacity ?? null,
    })), pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) } };
  }
}
