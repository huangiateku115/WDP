import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';

export class FacilityError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function invalid(message: string): never { throw new FacilityError(400, message); }

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid('Unsupported field');
  return input;
}
function text(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    invalid(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}
export function parseStatus(value: unknown): FacilityStatus {
  if (!Object.values(FacilityStatus).includes(value as FacilityStatus)) invalid('Invalid facility status');
  return value as FacilityStatus;
}
export function parseStatusBody(value: unknown): FacilityStatus {
  return parseStatus(object(value, ['status']).status);
}
export function parseFacility(value: unknown, partial = false): Record<string, unknown> {
  const input = object(value, ['code', 'name', 'address', 'contact', 'serviceTypes', 'status', 'description', 'operatingHours']);
  if (!Object.keys(input).length) invalid('At least one field is required');
  if (!partial) {
    for (const key of ['code', 'name', 'address', 'serviceTypes']) {
      if (!(key in input)) invalid(`${key} is required`);
    }
  }
  const output: Record<string, unknown> = {};
  for (const key of ['code', 'name', 'description', 'operatingHours']) {
    if (key in input) output[key] = text(input[key], key, key === 'description' ? 2000 : 500);
  }
  if (typeof output.code === 'string') output.code = output.code.toUpperCase();
  if ('status' in input) output.status = parseStatus(input.status);
  if ('serviceTypes' in input) {
    const values = input.serviceTypes;
    if (!Array.isArray(values) || values.length < 1 || values.length > 2 ||
        new Set(values).size !== values.length ||
        values.some(v => !Object.values(FacilityServiceType).includes(v))) invalid('Invalid serviceTypes');
    output.serviceTypes = values;
  }
  for (const group of ['address', 'contact'] as const) {
    if (!(group in input)) continue;
    const allowed = group === 'address' ? ['line1', 'ward', 'district', 'city', 'country'] : ['phone', 'email'];
    const nested = object(input[group], allowed);
    if (partial && !Object.keys(nested).length) invalid(`${group} cannot be empty in an update`);
    if (group === 'address' && !partial) {
      for (const key of ['line1', 'city', 'country']) {
        if (!(key in nested)) invalid(`address.${key} is required`);
      }
    }
    const parsed: Record<string, string> = {};
    for (const key of Object.keys(nested)) {
      let result = text(nested[key], `${group}.${key}`);
      if (group === 'contact' && key === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) invalid('Invalid contact email');
        result = result.toLowerCase();
      }
      if (partial) output[`${group}.${key}`] = result;
      else parsed[key] = result;
    }
    if (!partial) output[group] = parsed;
  }
  return output;
}
export function parseList(value: unknown) {
  const input = object(value, ['page', 'limit', 'status', 'serviceType', 'search']);
  function integer(key: string, fallback: number, max: number): number {
    if (input[key] === undefined) return fallback;
    if (typeof input[key] !== 'string' || !/^[1-9]\d*$/.test(input[key] as string)) invalid(`Invalid ${key}`);
    const number = Number(input[key]);
    if (!Number.isSafeInteger(number) || number > max) invalid(`Invalid ${key}`);
    return number;
  }
  const page = integer('page', 1, 1000000);
  const limit = integer('limit', 20, 100);
  const filter: Record<string, unknown> = {};
  if (input.status !== undefined) filter.status = parseStatus(input.status);
  if (input.serviceType !== undefined) {
    if (!Object.values(FacilityServiceType).includes(input.serviceType as FacilityServiceType)) invalid('Invalid serviceType');
    filter.serviceTypes = input.serviceType;
  }
  if (input.search !== undefined) {
    const search = text(input.search, 'search', 100);
    // Escape user input so search is literal, not a user-supplied regex.
    const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['code', 'name', 'address.city'].map(field => ({
      [field]: { $regex: pattern, $options: 'i' },
    }));
  }
  return { page, limit, filter };
}
