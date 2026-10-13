import { Types } from 'mongoose';
import { FacilityServiceType } from '../../types/facility.type';
import { StorageUnitSize } from '../../types/storage-unit.type';
import { JsonValue, PolicyType, PricingBasis, TermUnit } from '../../types/pricing-policy.type';

export type Kind = 'pricing' | 'policy';
export class RuleError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function invalid(message: string): never { throw new RuleError(400, message); }
export function object(value: unknown, allowed?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Expected a plain object');
  if (allowed && Object.keys(value).some(k => !allowed.includes(k))) invalid('Unsupported field');
  return value as Record<string, unknown>;
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) invalid('Invalid resource ID');
  return value.toLowerCase();
}
function enumeration<T extends string>(value: unknown, values: T[]): T {
  if (!values.includes(value as T)) invalid('Invalid enum value');
  return value as T;
}
export function date(value: unknown): Date {
  // Explicit UTC timestamps only; roundtrip rejects normalized dates such as February 30.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) invalid('Use an ISO UTC timestamp');
  const result = new Date(value);
  if (!Number.isFinite(result.getTime()) || result.toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) invalid('Invalid date');
  return result;
}
export function config(value: unknown): { [key: string]: JsonValue } {
  object(value);
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (++nodes > 2000 || depth > 8) invalid('Config exceeds structural limits');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v === 'string' && v.length <= 16384) return;
    if (typeof v !== 'object' || !v) invalid('Config must contain JSON values');
    if (ancestors.has(v)) invalid('Cyclic config');
    ancestors.add(v);
    if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); }
    else {
      for (const [key, item] of Object.entries(object(v))) {
        if (key.startsWith('$') || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key) || key.length > 100) invalid('Unsafe config key');
        visit(item, depth + 1);
      }
    }
    ancestors.delete(v);
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 16384) invalid('Config exceeds 16 KiB');
  return JSON.parse(json);
}
export function validateManagedDepositConfig(value: unknown) {
  const input = object(value, ['calculation', 'percentage']);
  if (input.calculation !== 'PERCENT_OF_RENT' || typeof input.percentage !== 'number' || !Number.isFinite(input.percentage) || input.percentage < 0) {
    invalid('Managed DEPOSIT config requires PERCENT_OF_RENT and a non-negative percentage');
  }
}
export function validateCategoryPolicyConfig(value: unknown) {
  const input = object(value, ['allowedCategories', 'blockedCategories']);
  const normalize = (candidate: unknown, field: string, required: boolean) => {
    if (!Array.isArray(candidate) || (required && candidate.length === 0) || candidate.length > 100) {
      invalid(`${field} must be ${required ? 'a non-empty' : 'an'} array of at most 100 categories`);
    }
    const result = candidate.map((entry, index) => {
      if (typeof entry !== 'string' || !entry.trim() || entry.trim().length > 80) invalid(`${field}[${index}] must be a non-empty category of at most 80 characters`);
      return entry.trim().toUpperCase();
    });
    if (new Set(result).size !== result.length) invalid(`${field} must not contain duplicate categories`);
    return result;
  };
  return {
    allowedCategories: normalize(input.allowedCategories, 'allowedCategories', true),
    blockedCategories: normalize(input.blockedCategories, 'blockedCategories', false),
  };
}
export function scope(kind: Kind, input: Record<string, unknown>, query = false) {
  const result: Record<string, unknown> = { facilityId: new Types.ObjectId(id(input.facilityId)) };
  if (kind === 'pricing' || input.serviceType !== undefined) result.serviceType = enumeration(input.serviceType, Object.values(FacilityServiceType));
  if (kind === 'policy') {
    result.type = enumeration(input.type, Object.values(PolicyType));
  } else {
    if (result.serviceType === FacilityServiceType.SELF_STORAGE) result.unitSize = enumeration(input.unitSize, Object.values(StorageUnitSize));
    else if (input.unitSize !== undefined) invalid('MANAGED_INVENTORY cannot contain unitSize');
    if (result.serviceType === FacilityServiceType.MANAGED_INVENTORY) {
      if (input.billingBasis !== undefined || !query) result.billingBasis = enumeration(input.billingBasis, [PricingBasis.PER_M3]);
    } else if (input.billingBasis !== undefined) {
      result.billingBasis = enumeration(input.billingBasis, [PricingBasis.PER_STORAGE_UNIT]);
    }
    const term = query ? { value: input.termValue, unit: input.termUnit } : object(input.term, ['value', 'unit']);
    const value = query && typeof term.value === 'string' && /^[1-9]\d*$/.test(term.value) ? Number(term.value) : term.value;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid('Term value must be a positive integer');
    result.term = { value, unit: enumeration(term.unit, Object.values(TermUnit)) };
  }
  return result;
}
export const scopeKeys = (kind: Kind) => kind === 'pricing'
  ? ['facilityId', 'serviceType', 'billingBasis', 'unitSize', 'termValue', 'termUnit'] : ['facilityId', 'serviceType', 'type'];
export function body(kind: Kind, value: unknown, partial = false) {
  const mutable = ['effectiveFrom', 'effectiveTo', ...(kind === 'pricing' ? ['price', 'currency'] : ['config'])];
  const input = object(value, partial ? mutable : [...mutable, 'isActive', 'facilityId', 'serviceType', ...(kind === 'pricing' ? ['billingBasis', 'unitSize', 'term'] : ['type'])]);
  if (!Object.keys(input).length) invalid('At least one field is required');
  const output: Record<string, unknown> = partial ? {} : scope(kind, input);
  for (const field of ['effectiveFrom', 'effectiveTo']) if (field in input) output[field] = date(input[field]);
  if (!partial && !output.effectiveFrom) invalid('effectiveFrom is required');
  if (!partial) output.isActive = 'isActive' in input ? boolean(input.isActive) : true;
  if (kind === 'pricing') {
    if (!partial || 'price' in input) {
      if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0) invalid('Price must be finite and positive');
      output.price = input.price;
    }
    if (!partial || 'currency' in input) {
      if (typeof input.currency !== 'string' || !/^[A-Za-z]{3}$/.test(input.currency)) invalid('Currency must be three letters');
      output.currency = input.currency.toUpperCase();
    }
  } else if (!partial || 'config' in input) {
    output.config = config(input.config);
    if (!partial && input.type === PolicyType.DEPOSIT && input.serviceType === FacilityServiceType.MANAGED_INVENTORY) validateManagedDepositConfig(output.config);
    if (!partial && input.type === PolicyType.CATEGORY) {
      if (input.serviceType !== FacilityServiceType.MANAGED_INVENTORY) invalid('CATEGORY policies require MANAGED_INVENTORY serviceType');
      output.config = validateCategoryPolicyConfig(output.config);
    }
  }
  if (output.effectiveFrom && output.effectiveTo) range(output as unknown as Period);
  return output;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid('Expected boolean');
  return value;
}
export interface Period { effectiveFrom: Date; effectiveTo?: Date; }
export function range(value: Period) {
  if (value.effectiveTo && value.effectiveTo <= value.effectiveFrom) invalid('effectiveTo must be later than effectiveFrom');
}
export function resolver(kind: Kind, value: unknown) {
  const input = object(value, [...scopeKeys(kind), 'at']);
  return { key: scope(kind, input, true), at: date(input.at) };
}
export function list(kind: Kind, value: unknown) {
  const input = object(value, [...scopeKeys(kind), 'page', 'limit', 'isActive']);
  function integer(key: string, fallback: number, max: number) {
    const v = input[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > max) invalid(`Invalid ${key}`);
    return Number(v);
  }
  const filter: Record<string, unknown> = {};
  if (input.facilityId !== undefined) filter.facilityId = new Types.ObjectId(id(input.facilityId));
  if (input.serviceType !== undefined) filter.serviceType = enumeration(input.serviceType, Object.values(FacilityServiceType));
  if (input.billingBasis !== undefined) filter.billingBasis = enumeration(input.billingBasis, Object.values(PricingBasis));
  if (input.unitSize !== undefined) filter.unitSize = enumeration(input.unitSize, Object.values(StorageUnitSize));
  if (input.type !== undefined) filter.type = enumeration(input.type, Object.values(PolicyType));
  if (input.termValue !== undefined) filter['term.value'] = integer('termValue', 1, Number.MAX_SAFE_INTEGER);
  if (input.termUnit !== undefined) filter['term.unit'] = enumeration(input.termUnit, Object.values(TermUnit));
  if (input.isActive !== undefined) {
    if (!['true', 'false'].includes(input.isActive as string)) invalid('Invalid isActive');
    filter.isActive = input.isActive === 'true';
  }
  return { filter, page: integer('page', 1, 1000000), limit: integer('limit', 20, 100) };
}
