import { Types } from 'mongoose';
import { RelatedEntityType, SupportCategory, SupportPriority, SupportStatus } from '../../types/support-request.type';

export class SupportError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'SupportError'; }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupportError(400, 'Request body must be an object');
  return value as Record<string, unknown>;
};
const hasUnknown = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).some(k => !allowed.includes(k) || k.startsWith('$'));
const string = (value: unknown, field: string, min: number, max: number) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new SupportError(400, `Invalid ${field}`);
  return value.trim();
};
export function validateId(value: unknown, field = 'ID'): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || new Types.ObjectId(value).toString() !== value.toLowerCase()) throw new SupportError(400, `Invalid ${field}`);
  return value.toLowerCase();
}
export function parseCreate(input: unknown) {
  const data = object(input);
  if (hasUnknown(data, ['facilityId', 'category', 'subject', 'description', 'priority', 'relatedEntity', 'customerId'])) throw new SupportError(400, 'Unknown support request field');
  if (!Object.values(SupportCategory).includes(data.category as SupportCategory)) throw new SupportError(400, 'Invalid category');
  if (data.priority !== undefined && !Object.values(SupportPriority).includes(data.priority as SupportPriority)) throw new SupportError(400, 'Invalid priority');
  const facilityId = data.facilityId === undefined ? undefined : validateId(data.facilityId, 'facilityId');
  let relatedEntity: { type: RelatedEntityType; id: string } | undefined;
  if (data.relatedEntity !== undefined) {
    const related = object(data.relatedEntity);
    if (hasUnknown(related, ['type', 'id'])) throw new SupportError(400, 'Unknown relatedEntity field');
    const type = string(related.type, 'relatedEntity.type', 1, 50).toUpperCase();
    if (!Object.values(RelatedEntityType).includes(type as RelatedEntityType)) throw new SupportError(400, 'Invalid relatedEntity.type');
    relatedEntity = { type: type as RelatedEntityType, id: string(related.id, 'relatedEntity.id', 1, 100) };
  }
  const customerId = data.customerId === undefined ? undefined : validateId(data.customerId, 'customerId');
  return { ...(facilityId ? { facilityId } : {}), ...(customerId ? { customerId } : {}), category: data.category as SupportCategory,
    subject: string(data.subject, 'subject', 1, 200), description: string(data.description, 'description', 1, 5000),
    priority: (data.priority ?? SupportPriority.MEDIUM) as SupportPriority, ...(relatedEntity ? { relatedEntity } : {}) };
}
export function parseList(input: unknown) {
  const q = object(input); const allowed = ['page', 'limit', 'facilityId', 'customerId', 'category', 'priority', 'status', 'assignedTo', 'isEscalated', 'search'];
  if (hasUnknown(q, allowed)) throw new SupportError(400, 'Invalid list filter');
  const number = (v: unknown, fallback: number, max: number, field: string) => {
    if (v === undefined) return fallback;
    const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > max) throw new SupportError(400, `Invalid ${field}`); return n;
  };
  const enumVal = (v: unknown, values: string[], field: string) => { if (v !== undefined && (typeof v !== 'string' || !values.includes(v))) throw new SupportError(400, `Invalid ${field}`); return v as string | undefined; };
  if (q.isEscalated !== undefined && q.isEscalated !== 'true' && q.isEscalated !== 'false') throw new SupportError(400, 'Invalid isEscalated');
  const search = q.search === undefined ? undefined : string(q.search, 'search', 1, 100);
  return { page: number(q.page, 1, 1000000, 'page'), limit: number(q.limit, 20, 100, 'limit'),
    facilityId: q.facilityId === undefined ? undefined : validateId(q.facilityId, 'facilityId'),
    customerId: q.customerId === undefined ? undefined : validateId(q.customerId, 'customerId'),
    assignedTo: q.assignedTo === undefined ? undefined : validateId(q.assignedTo, 'assignedTo'),
    category: enumVal(q.category, Object.values(SupportCategory), 'category'), priority: enumVal(q.priority, Object.values(SupportPriority), 'priority'),
    status: enumVal(q.status, Object.values(SupportStatus), 'status'), isEscalated: q.isEscalated as string | undefined, search };
}
export function parseUpdate(input: unknown, manager: boolean) {
  const data = object(input); const allowed = manager ? ['subject', 'description', 'category', 'priority'] : ['subject', 'description'];
  if (hasUnknown(data, allowed) || Object.keys(data).length === 0) throw new SupportError(400, 'Invalid support request update');
  const out: Record<string, unknown> = {};
  if (data.subject !== undefined) out.subject = string(data.subject, 'subject', 1, 200);
  if (data.description !== undefined) out.description = string(data.description, 'description', 1, 5000);
  if (data.category !== undefined) { if (!Object.values(SupportCategory).includes(data.category as SupportCategory)) throw new SupportError(400, 'Invalid category'); out.category = data.category; }
  if (data.priority !== undefined) { if (!Object.values(SupportPriority).includes(data.priority as SupportPriority)) throw new SupportError(400, 'Invalid priority'); out.priority = data.priority; }
  return out;
}
export function parseStatus(input: unknown) {
  const data = object(input); if (hasUnknown(data, ['status', 'resolutionNote']) || !Object.values(SupportStatus).includes(data.status as SupportStatus)) throw new SupportError(400, 'Invalid status update');
  if (data.resolutionNote !== undefined && (typeof data.resolutionNote !== 'string' || data.resolutionNote.trim().length > 3000)) throw new SupportError(400, 'Invalid resolutionNote');
  return { status: data.status as SupportStatus, ...(data.resolutionNote !== undefined ? { resolutionNote: data.resolutionNote.trim() } : {}) };
}
export function parseAssignment(input: unknown) {
  const data = object(input); if (hasUnknown(data, ['staffId'])) throw new SupportError(400, 'Invalid assignment');
  return { staffId: validateId(data.staffId, 'staffId') };
}
export function parseMessage(input: unknown, customer: boolean) {
  const data = object(input); if (hasUnknown(data, ['message', 'isInternal'])) throw new SupportError(400, 'Unknown message field');
  if (customer && data.isInternal === true) throw new SupportError(403, 'Customers cannot create internal messages');
  if (data.isInternal !== undefined && typeof data.isInternal !== 'boolean') throw new SupportError(400, 'Invalid isInternal');
  return { message: string(data.message, 'message', 1, 5000), isInternal: customer ? false : Boolean(data.isInternal) };
}
