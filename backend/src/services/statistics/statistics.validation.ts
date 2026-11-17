import { Types } from 'mongoose';
import { FacilityServiceType } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ContractStatus } from '../../types/contract.type';
import { StorageUnitSize, StorageUnitStatus } from '../../types/storage-unit.type';
import { MovementBatchAction } from '../../types/item-movement.type';
import { PaymentStatus } from '../../types/payment.type';
import { MaintenanceStatus } from '../../types/maintenance-ticket.type';

export type Granularity = 'day' | 'week' | 'month';
export type StatisticsQuery = {
  from: Date;
  toExclusive: Date;
  facilityId?: Types.ObjectId;
  serviceType?: FacilityServiceType;
  comparePrevious: boolean;
  sortBy?: string;
  sortOrder: 1 | -1;
  page: number;
  limit: number;
  granularity?: Granularity;
  unitSize?: StorageUnitSize;
  status?: ReservationStatus | ContractStatus | StorageUnitStatus;
  paymentStatus?: PaymentStatus;
  expiringWithinDays?: number;
  action?: MovementBatchAction;
  skuId?: Types.ObjectId;
  itemSpecId?: Types.ObjectId;
  reservationId?: Types.ObjectId;
};

export class StatisticsQueryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

function dateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => Number(parts.find(entry => entry.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function localMidnight(year: number, month: number, day: number): Date {
  // Vietnam has no DST and is UTC+07:00.
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
}

function strictDate(value: unknown, field: string): { year: number; month: number; day: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StatisticsQueryError(400, 'INVALID_DATE', `${field} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    throw new StatisticsQueryError(400, 'INVALID_DATE', `${field} is not a valid calendar date`);
  }
  return { year: year!, month: month!, day: day! };
}

function single(query: Record<string, unknown>, key: string): unknown {
  const value = query[key];
  if (Array.isArray(value)) throw new StatisticsQueryError(400, 'INVALID_QUERY', `${key} must be provided once`);
  return value;
}

export function parseStatisticsQuery(input: Record<string, unknown>, now = new Date()): StatisticsQuery {
  const allowed = new Set(['fromDate', 'toDate', 'facilityId', 'serviceType', 'granularity', 'comparePrevious', 'sortBy', 'sortOrder', 'page', 'limit', 'unitSize', 'status', 'paymentStatus', 'expiringWithinDays', 'action', 'skuId', 'itemSpecId', 'reservationId']);
  const unknown = Object.keys(input).find(key => !allowed.has(key));
  if (unknown) throw new StatisticsQueryError(400, 'INVALID_QUERY', `Unsupported query parameter: ${unknown}`);

  const fromRaw = single(input, 'fromDate');
  const toRaw = single(input, 'toDate');
  const today = dateParts(now);
  const defaultEnd = localMidnight(today.year, today.month, today.day + 1);
  const defaultStart = new Date(defaultEnd.getTime() - 30 * DAY_MS);
  const fromParts = fromRaw === undefined ? dateParts(defaultStart) : strictDate(fromRaw, 'fromDate');
  const toParts = toRaw === undefined ? today : strictDate(toRaw, 'toDate');
  const from = localMidnight(fromParts.year, fromParts.month, fromParts.day);
  const toExclusive = localMidnight(toParts.year, toParts.month, toParts.day + 1);
  if (from >= toExclusive) throw new StatisticsQueryError(400, 'INVALID_DATE_RANGE', 'fromDate must be on or before toDate');
  if ((toExclusive.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
    throw new StatisticsQueryError(400, 'DATE_RANGE_TOO_LARGE', `Date range cannot exceed ${MAX_RANGE_DAYS} calendar days`);
  }

  const facilityRaw = single(input, 'facilityId');
  let facilityId: Types.ObjectId | undefined;
  if (facilityRaw !== undefined) {
    if (typeof facilityRaw !== 'string' || !/^[a-f\d]{24}$/i.test(facilityRaw)) throw new StatisticsQueryError(400, 'INVALID_FACILITY_ID', 'facilityId must be a valid ObjectId');
    facilityId = new Types.ObjectId(facilityRaw);
  }
  const serviceRaw = single(input, 'serviceType');
  if (serviceRaw !== undefined && !Object.values(FacilityServiceType).includes(serviceRaw as FacilityServiceType)) {
    throw new StatisticsQueryError(400, 'INVALID_SERVICE_TYPE', 'serviceType is not supported');
  }
  const compareRaw = single(input, 'comparePrevious');
  if (compareRaw !== undefined && compareRaw !== 'true' && compareRaw !== 'false') throw new StatisticsQueryError(400, 'INVALID_BOOLEAN', 'comparePrevious must be true or false');
  const granularityRaw = single(input, 'granularity');
  if (granularityRaw !== undefined && !['day', 'week', 'month'].includes(String(granularityRaw))) throw new StatisticsQueryError(400, 'INVALID_GRANULARITY', 'granularity must be day, week, or month');
  const sortByRaw = single(input, 'sortBy');
  if (sortByRaw !== undefined && typeof sortByRaw !== 'string') throw new StatisticsQueryError(400, 'INVALID_SORT', 'sortBy must be a string');
  const sortOrderRaw = single(input, 'sortOrder');
  if (sortOrderRaw !== undefined && sortOrderRaw !== 'asc' && sortOrderRaw !== 'desc') throw new StatisticsQueryError(400, 'INVALID_SORT', 'sortOrder must be asc or desc');

  const parseIntParam = (key: string, fallback: number, max: number) => {
    const raw = single(input, key);
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new StatisticsQueryError(400, 'INVALID_PAGINATION', `${key} must be a positive integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new StatisticsQueryError(400, 'INVALID_PAGINATION', `${key} must be between 1 and ${max}`);
    return value;
  };

  const unitSizeRaw = single(input, 'unitSize');
  if (unitSizeRaw !== undefined && !Object.values(StorageUnitSize).includes(unitSizeRaw as StorageUnitSize)) {
    throw new StatisticsQueryError(400, 'INVALID_UNIT_SIZE', 'unitSize is not supported');
  }
  const statusRaw = single(input, 'status');
  const supportedStatuses = [...Object.values(ReservationStatus), ...Object.values(ContractStatus), ...Object.values(StorageUnitStatus)];
  const maintenanceStatuses = Object.values(MaintenanceStatus) as string[];
  if (statusRaw !== undefined && (typeof statusRaw !== 'string' || (!supportedStatuses.includes(statusRaw as never) && !maintenanceStatuses.includes(statusRaw)))) {
    throw new StatisticsQueryError(400, 'INVALID_STATUS', 'status is not supported');
  }
  const paymentStatusRaw = single(input, 'paymentStatus');
  if (paymentStatusRaw !== undefined && (typeof paymentStatusRaw !== 'string' || !(Object.values(PaymentStatus) as string[]).includes(paymentStatusRaw))) {
    throw new StatisticsQueryError(400, 'INVALID_PAYMENT_STATUS', 'paymentStatus is not supported');
  }
  const expiringWithinDays = parseIntParam('expiringWithinDays', 30, 365);

  const actionRaw = single(input, 'action');
  if (actionRaw !== undefined && !Object.values(MovementBatchAction).includes(actionRaw as MovementBatchAction)) {
    throw new StatisticsQueryError(400, 'INVALID_ACTION', 'action must be ADD, REMOVE, or MOVE');
  }
  const parseObjectId = (key: 'skuId' | 'itemSpecId' | 'reservationId') => {
    const raw = single(input, key);
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !/^[a-f\d]{24}$/i.test(raw)) throw new StatisticsQueryError(400, `INVALID_${key.replace('Id', '').toUpperCase()}_ID`, `${key} must be a valid ObjectId`);
    return new Types.ObjectId(raw);
  };
  const skuId = parseObjectId('skuId');
  const itemSpecId = parseObjectId('itemSpecId');
  const reservationId = parseObjectId('reservationId');

  return {
    from, toExclusive, ...(facilityId ? { facilityId } : {}),
    ...(serviceRaw ? { serviceType: serviceRaw as FacilityServiceType } : {}),
    comparePrevious: compareRaw === 'true', sortOrder: sortOrderRaw === 'asc' ? 1 : -1,
    ...(sortByRaw ? { sortBy: sortByRaw as string } : {}),
    page: parseIntParam('page', 1, 100_000), limit: parseIntParam('limit', 20, 100),
    ...(granularityRaw ? { granularity: granularityRaw as Granularity } : {}),
    ...(unitSizeRaw ? { unitSize: unitSizeRaw as StorageUnitSize } : {}),
    ...(statusRaw ? { status: statusRaw as NonNullable<StatisticsQuery['status']> } : {}),
    ...(paymentStatusRaw ? { paymentStatus: paymentStatusRaw as PaymentStatus } : {}),
    expiringWithinDays,
    ...(actionRaw ? { action: actionRaw as MovementBatchAction } : {}),
    ...(skuId ? { skuId } : {}), ...(itemSpecId ? { itemSpecId } : {}), ...(reservationId ? { reservationId } : {}),
  };
}

export function localDateKey(date: Date): string {
  const p = dateParts(date);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export const STATISTICS_TIME_ZONE = TIME_ZONE;
export const STATISTICS_MAX_RANGE_DAYS = MAX_RANGE_DAYS;
