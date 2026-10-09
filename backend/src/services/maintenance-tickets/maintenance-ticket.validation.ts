import { MaintenanceCategory, MaintenancePriority, MaintenanceStatus } from '../../types/maintenance-ticket.type';

export class MaintenanceTicketError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function invalid(message: string): never { throw new MaintenanceTicketError(400, message); }
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid('Unsupported field');
  return input;
}
function text(value: unknown, max: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid('Invalid string');
  return value.trim();
}
export function validateId(value: unknown, label = 'ID'): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) invalid(`Invalid ${label}`);
}
export function parseCreate(value: unknown) {
  const input = object(value, ['facilityId', 'storageUnitId', 'title', 'description', 'category', 'priority', 'reportedBy']);
  validateId(input.facilityId, 'facilityId');
  if ('storageUnitId' in input && input.storageUnitId !== undefined) validateId(input.storageUnitId, 'storageUnitId');
  if ('reportedBy' in input) invalid('reportedBy is derived from the authenticated user');
  if (!Object.values(MaintenanceCategory).includes(input.category as MaintenanceCategory)) invalid('Invalid category');
  if (input.priority !== undefined && !Object.values(MaintenancePriority).includes(input.priority as MaintenancePriority)) invalid('Invalid priority');
  return {
    facilityId: input.facilityId as string,
    ...(input.storageUnitId ? { storageUnitId: input.storageUnitId as string } : {}),
    title: text(input.title, 200)!, description: text(input.description, 5000)!,
    category: input.category as MaintenanceCategory,
    priority: (input.priority ?? MaintenancePriority.MEDIUM) as MaintenancePriority,
  };
}
export function parseUpdate(value: unknown) {
  const input = object(value, ['title', 'description', 'category', 'priority']);
  if (!Object.keys(input).length) invalid('At least one field is required');
  const result: Record<string, unknown> = {};
  if ('title' in input) result.title = text(input.title, 200);
  if ('description' in input) result.description = text(input.description, 5000);
  if ('category' in input) {
    if (!Object.values(MaintenanceCategory).includes(input.category as MaintenanceCategory)) invalid('Invalid category');
    result.category = input.category;
  }
  if ('priority' in input) {
    if (!Object.values(MaintenancePriority).includes(input.priority as MaintenancePriority)) invalid('Invalid priority');
    result.priority = input.priority;
  }
  return result;
}
export function parseAssignment(value: unknown) {
  const input = object(value, ['assignedTo']);
  validateId(input.assignedTo, 'assignedTo');
  return input.assignedTo as string;
}
export function parseStatus(value: unknown) {
  const input = object(value, ['status', 'resolutionNote']);
  if (!Object.values(MaintenanceStatus).includes(input.status as MaintenanceStatus)) invalid('Invalid status');
  if (input.resolutionNote !== undefined && input.status !== MaintenanceStatus.RESOLVED) invalid('resolutionNote is only accepted when resolving');
  return {
    status: input.status as MaintenanceStatus,
    ...(input.resolutionNote !== undefined ? { resolutionNote: text(input.resolutionNote, 3000) } : {}),
  };
}
export function parseList(value: unknown) {
  const input = object(value, ['page', 'limit', 'facilityId', 'storageUnitId', 'status', 'priority', 'category', 'assignedTo', 'search']);
  const integer = (key: string, fallback: number, max: number) => {
    if (input[key] === undefined) return fallback;
    if (typeof input[key] !== 'string' || !/^[1-9]\d*$/.test(input[key] as string)) invalid(`Invalid ${key}`);
    const result = Number(input[key]);
    if (!Number.isSafeInteger(result) || result > max) invalid(`Invalid ${key}`);
    return result;
  };
  const page = integer('page', 1, 1000000), limit = integer('limit', 20, 100);
  const filter: Record<string, unknown> = {};
  for (const key of ['facilityId', 'storageUnitId', 'assignedTo']) if (input[key] !== undefined) {
    validateId(input[key], key); filter[key] = input[key];
  }
  if (input.status !== undefined) {
    if (!Object.values(MaintenanceStatus).includes(input.status as MaintenanceStatus)) invalid('Invalid status');
    filter.status = input.status;
  }
  if (input.priority !== undefined) {
    if (!Object.values(MaintenancePriority).includes(input.priority as MaintenancePriority)) invalid('Invalid priority');
    filter.priority = input.priority;
  }
  if (input.category !== undefined) {
    if (!Object.values(MaintenanceCategory).includes(input.category as MaintenanceCategory)) invalid('Invalid category');
    filter.category = input.category;
  }
  if (input.search !== undefined) {
    const search = text(input.search, 100)!;
    const literal = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['title', 'description'].map(field => ({ [field]: { $regex: literal, $options: 'i' } }));
  }
  return { page, limit, filter };
}
