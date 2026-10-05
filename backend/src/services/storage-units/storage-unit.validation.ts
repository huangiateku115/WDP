import { StorageUnitInput, StorageUnitSize, StorageUnitStatus, UnitDimensions } from '../../types/storage-unit.type';

export class StorageUnitError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function invalid(message: string): never { throw new StorageUnitError(400, message); }
export function validateId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) invalid('Invalid resource ID');
}
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !allowed.includes(key))) invalid('Unsupported field');
  return data;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid('Invalid string');
  return value.trim();
}
export const managementStatuses = [
  StorageUnitStatus.AVAILABLE, StorageUnitStatus.MAINTENANCE, StorageUnitStatus.INACTIVE,
];
export function managementStatus(value: unknown): StorageUnitStatus {
  if (!Object.values(StorageUnitStatus).includes(value as StorageUnitStatus)) invalid('Invalid status');
  if (!managementStatuses.includes(value as StorageUnitStatus)) {
    throw new StorageUnitError(409, 'HELD and OCCUPIED belong to reservation/rental lifecycle');
  }
  return value as StorageUnitStatus;
}
export function parseStatusBody(value: unknown): StorageUnitStatus {
  return managementStatus(object(value, ['status']).status);
}
export function volume(dimensions: UnitDimensions): number {
  const result = dimensions.lengthM * dimensions.widthM * dimensions.heightM;
  if (!Number.isFinite(result) || result <= 0) invalid('Dimensions produce an invalid volume');
  return result;
}
export function parseUnit(value: unknown, partial = false): Partial<StorageUnitInput> & { status?: StorageUnitStatus } {
  const input = object(value, partial
    ? ['unitCode', 'size', 'dimensions', 'description']
    : ['unitCode', 'size', 'dimensions', 'description', 'status']);
  if (!Object.keys(input).length) invalid('At least one field is required');
  if (!partial) {
    for (const key of ['unitCode', 'size', 'dimensions']) if (!(key in input)) invalid(`${key} is required`);
  }
  const output: Partial<StorageUnitInput> & { status?: StorageUnitStatus } = {};
  if ('unitCode' in input) output.unitCode = text(input.unitCode, 100).toUpperCase();
  if ('description' in input) output.description = text(input.description, 2000);
  if ('size' in input) {
    if (!Object.values(StorageUnitSize).includes(input.size as StorageUnitSize)) invalid('Invalid size');
    output.size = input.size as StorageUnitSize;
  }
  if ('status' in input) output.status = managementStatus(input.status);
  if ('dimensions' in input) {
    const d = object(input.dimensions, ['lengthM', 'widthM', 'heightM']);
    for (const key of ['lengthM', 'widthM', 'heightM']) {
      if (typeof d[key] !== 'number' || !Number.isFinite(d[key]) || (d[key] as number) <= 0) invalid('Dimensions must be finite positive numbers');
    }
    output.dimensions = { lengthM: d.lengthM as number, widthM: d.widthM as number, heightM: d.heightM as number };
    volume(output.dimensions);
  }
  return output;
}
export function parseList(value: unknown) {
  const input = object(value, ['page', 'limit', 'status', 'size', 'search']);
  function integer(key: string, fallback: number, max: number) {
    if (input[key] === undefined) return fallback;
    if (typeof input[key] !== 'string' || !/^[1-9]\d*$/.test(input[key] as string)) invalid(`Invalid ${key}`);
    const result = Number(input[key]);
    if (!Number.isSafeInteger(result) || result > max) invalid(`Invalid ${key}`);
    return result;
  }
  const page = integer('page', 1, 1000000);
  const limit = integer('limit', 20, 100);
  const filter: Record<string, unknown> = {};
  if (input.status !== undefined) {
    if (!Object.values(StorageUnitStatus).includes(input.status as StorageUnitStatus)) invalid('Invalid status');
    filter.status = input.status;
  }
  if (input.size !== undefined) {
    if (!Object.values(StorageUnitSize).includes(input.size as StorageUnitSize)) invalid('Invalid size');
    filter.size = input.size;
  }
  if (input.search !== undefined) {
    const search = text(input.search, 100);
    filter.unitCode = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  return { page, limit, filter };
}
