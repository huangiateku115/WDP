import { Types } from 'mongoose';
import { ActionType } from '../../types/audit.type';
import { UserRole } from '../../types/user.type';

export class AuditReadError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

const objectIdPattern = /^[a-f\d]{24}$/i;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const record = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);

function scalar(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new AuditReadError(400, 'INVALID_QUERY', `${key} must be a single string value`);
  return value;
}

function onlyKeys(input: Record<string, unknown>, allowed: string[]) {
  const unsupported = Object.keys(input).find(key => !allowed.includes(key));
  if (unsupported === 'eventType' || unsupported === 'subjectId') {
    throw new AuditReadError(400, 'AUDIT_FILTER_UNAVAILABLE', `${unsupported} is not stored on AuditLog records`);
  }
  if (unsupported) throw new AuditReadError(400, 'INVALID_QUERY', `Unsupported query parameter: ${unsupported}`);
}

function integer(value: string | undefined, fallback: number, name: string, max: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new AuditReadError(400, 'INVALID_PAGINATION', `${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AuditReadError(400, 'INVALID_PAGINATION', `${name} must be from 1 to ${max}`);
  }
  return parsed;
}

function objectId(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  if (!objectIdPattern.test(value)) throw new AuditReadError(400, 'INVALID_FILTER', `${field} must be a 24-character ObjectId`);
  return new Types.ObjectId(value);
}

function localDateStart(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AuditReadError(400, 'INVALID_DATE', `${field} must use YYYY-MM-DD`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const utcCalendar = Date.UTC(year, month - 1, day);
  const calendar = new Date(utcCalendar);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    throw new AuditReadError(400, 'INVALID_DATE', `${field} is not a valid calendar date`);
  }
  return new Date(utcCalendar - VN_OFFSET_MS);
}

export function parseAuditLogQuery(value: unknown) {
  if (!record(value)) throw new AuditReadError(400, 'INVALID_QUERY', 'Query parameters must be a flat object');
  const input = value as Record<string, unknown>;
  onlyKeys(input, ['action', 'entityType', 'actorId', 'facilityId', 'from', 'to', 'page', 'limit', 'sortOrder']);
  const action = scalar(input, 'action');
  if (action !== undefined && !action.trim()) throw new AuditReadError(400, 'INVALID_FILTER', 'action cannot be empty');
  if (action && !Object.values(ActionType).includes(action as ActionType)) throw new AuditReadError(400, 'INVALID_FILTER', 'action is not a supported AuditLog action');
  const entityType = scalar(input, 'entityType');
  if (entityType !== undefined && (!entityType.trim() || entityType.length > 100 || !/^[a-z\d._-]+$/i.test(entityType))) {
    throw new AuditReadError(400, 'INVALID_FILTER', 'entityType must be 1 to 100 letters, numbers, dot, underscore, or hyphen');
  }
  const fromRaw = scalar(input, 'from'), toRaw = scalar(input, 'to');
  const from = localDateStart(fromRaw, 'from');
  const toDate = localDateStart(toRaw, 'to');
  const toExclusive = toDate ? new Date(toDate.getTime() + DAY_MS) : undefined;
  if (from && toExclusive && from >= toExclusive) throw new AuditReadError(400, 'INVALID_DATE_RANGE', 'from must be on or before to');
  if (from && toExclusive && toExclusive.getTime() - from.getTime() > 366 * DAY_MS) {
    throw new AuditReadError(400, 'DATE_RANGE_TOO_LARGE', 'Date range cannot exceed 366 days');
  }
  const sortOrder = scalar(input, 'sortOrder') ?? 'desc';
  if (!['asc', 'desc'].includes(sortOrder)) throw new AuditReadError(400, 'INVALID_SORT_ORDER', 'sortOrder must be asc or desc');
  return {
    filter: {
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(objectId(scalar(input, 'actorId'), 'actorId') ? { actorId: objectId(scalar(input, 'actorId'), 'actorId') } : {}),
      ...(objectId(scalar(input, 'facilityId'), 'facilityId') ? { facilityId: objectId(scalar(input, 'facilityId'), 'facilityId') } : {}),
      ...(from || toExclusive ? { createdAt: { ...(from ? { $gte: from } : {}), ...(toExclusive ? { $lt: toExclusive } : {}) } } : {}),
    },
    page: integer(scalar(input, 'page'), 1, 'page', 1_000_000),
    limit: integer(scalar(input, 'limit'), 20, 'limit', 100),
    sortOrder: sortOrder as 'asc' | 'desc',
  };
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseAuditSubjectQuery(value: unknown, callerRole: UserRole) {
  if (!record(value)) throw new AuditReadError(400, 'INVALID_QUERY', 'Query parameters must be a flat object');
  const input = value as Record<string, unknown>;
  onlyKeys(input, ['role', 'facilityId', 'search', 'status', 'page', 'limit']);
  const role = scalar(input, 'role');
  if (role && !Object.values(UserRole).includes(role as UserRole)) throw new AuditReadError(400, 'INVALID_FILTER', 'role is not supported');
  if (callerRole === UserRole.BOM && role && [UserRole.ADMIN, UserRole.BOM].includes(role as UserRole)) {
    throw new AuditReadError(403, 'AUDIT_SUBJECT_FORBIDDEN', 'BOM cannot query ADMIN or BOM subjects');
  }
  const facilityId = objectId(scalar(input, 'facilityId'), 'facilityId');
  const search = scalar(input, 'search');
  if (search !== undefined && (!search.trim() || search.length > 100)) throw new AuditReadError(400, 'INVALID_SEARCH', 'search must be 1 to 100 characters');
  const status = scalar(input, 'status');
  if (status !== undefined && !['ACTIVE', 'DISABLED'].includes(status)) throw new AuditReadError(400, 'INVALID_FILTER', 'status must be ACTIVE or DISABLED');
  const pattern = search ? new RegExp(escapeRegex(search.trim()), 'i') : undefined;
  const filter: Record<string, unknown> = {
    ...(callerRole === UserRole.BOM ? { role: { $nin: [UserRole.ADMIN, UserRole.BOM] } } : {}),
    ...(role ? { role } : {}),
    ...(facilityId ? { assignedFacilityId: facilityId } : {}),
    ...(status ? { isActive: status === 'ACTIVE' } : {}),
    ...(pattern ? { $or: [{ displayName: pattern }, { email: pattern }] } : {}),
  };
  return { filter, page: integer(scalar(input, 'page'), 1, 'page', 1_000_000), limit: integer(scalar(input, 'limit'), 20, 'limit', 100) };
}
