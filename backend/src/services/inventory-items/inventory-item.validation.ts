import { Types } from 'mongoose';
import { isValidImageList } from '../../utils/image-url';
import { InventoryItemDimensionsM, InventoryItemStatus } from '../../types/inventory-item.type';

export class InventoryItemError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function invalid(message: string): never { throw new InventoryItemError(400, message); }
function record(value: unknown, allowed: string[], label = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid(`${label} contains an unsupported field`);
  return input;
}
export function parseId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value) || new Types.ObjectId(value).toString() !== value.toLowerCase()) invalid(`Invalid ${field}`);
  return value.toLowerCase();
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function optionalDescription(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > 2000) invalid('description must be a string of at most 2000 characters');
  return value.trim();
}
function positive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(`${field} must be a finite positive number`);
  return value;
}
function quantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid('quantity must be a positive safe integer');
  return value;
}
function dimensions(value: unknown): InventoryItemDimensionsM {
  const input = record(value, ['widthM', 'depthM', 'heightM'], 'unitDimensionsM');
  return {
    widthM: positive(input.widthM, 'unitDimensionsM.widthM'),
    depthM: positive(input.depthM, 'unitDimensionsM.depthM'),
    heightM: positive(input.heightM, 'unitDimensionsM.heightM'),
  };
}
function images(value: unknown): string[] {
  if (!isValidImageList(value)) invalid('images must contain at most 10 non-empty HTTP(S) URLs');
  return value;
}
function commonFields(input: Record<string, unknown>) {
  return {
    name: text(input.name, 'name', 160),
    category: text(input.category, 'category', 80),
    quantity: quantity(input.quantity),
    quantityUnit: text(input.quantityUnit, 'quantityUnit', 32),
    unitWeightKg: positive(input.unitWeightKg, 'unitWeightKg'),
    unitDimensionsM: dimensions(input.unitDimensionsM),
  };
}

export function parseCreate(value: unknown) {
  const input = record(value, [
    'managedReservationId', 'itemCode', 'name', 'category', 'description', 'quantity', 'quantityUnit',
    'unitWeightKg', 'unitDimensionsM', 'preferredCellId', 'images',
  ]);
  const result = {
    managedReservationId: parseId(input.managedReservationId, 'managedReservationId'),
    itemCode: text(input.itemCode, 'itemCode', 48).toUpperCase(),
    ...commonFields(input),
    ...(input.description === undefined ? {} : { description: optionalDescription(input.description) }),
    ...(input.preferredCellId === undefined ? {} : { preferredCellId: parseId(input.preferredCellId, 'preferredCellId') }),
    ...(input.images === undefined ? {} : { images: images(input.images) }),
  };
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(result.itemCode)) invalid('itemCode contains unsupported characters');
  return result;
}

export function parseUpdate(value: unknown) {
  const input = record(value, ['name', 'category', 'description', 'quantity', 'quantityUnit', 'unitWeightKg', 'unitDimensionsM', 'preferredCellId', 'images']);
  if (!Object.keys(input).length) invalid('At least one editable field is required');
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'category', 'quantity', 'quantityUnit', 'unitWeightKg', 'unitDimensionsM'] as const) {
    if (input[key] === undefined) continue;
    if (key === 'name') result.name = text(input[key], key, 160);
    else if (key === 'category') result.category = text(input[key], key, 80);
    else if (key === 'quantity') result.quantity = quantity(input[key]);
    else if (key === 'quantityUnit') result.quantityUnit = text(input[key], key, 32);
    else if (key === 'unitWeightKg') result.unitWeightKg = positive(input[key], key);
    else result.unitDimensionsM = dimensions(input[key]);
  }
  if (input.description !== undefined) result.description = optionalDescription(input.description);
  if (input.preferredCellId !== undefined) result.preferredCellId = input.preferredCellId === null ? null : parseId(input.preferredCellId, 'preferredCellId');
  if (input.images !== undefined) result.images = images(input.images);
  return result;
}

export interface InboundConfirmationInput {
  cellId: string;
  verifiedQuantity: number;
  actualUnitWeightKg: number;
  actualUnitDimensionsM: InventoryItemDimensionsM;
  physicalPackingConfirmed: boolean;
  inspectionNote: string;
  idempotencyKey: string;
}

export function parseInboundConfirmation(value: unknown): InboundConfirmationInput {
  const input = record(value, ['cellId', 'verifiedQuantity', 'actualUnitWeightKg', 'actualUnitDimensionsM', 'physicalPackingConfirmed', 'inspectionNote', 'idempotencyKey']);
  if (typeof input.physicalPackingConfirmed !== 'boolean') invalid('physicalPackingConfirmed must be a boolean');
  const key = text(input.idempotencyKey, 'idempotencyKey', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(key)) invalid('idempotencyKey contains unsupported characters');
  return {
    cellId: parseId(input.cellId, 'cellId'),
    verifiedQuantity: quantity(input.verifiedQuantity),
    actualUnitWeightKg: positive(input.actualUnitWeightKg, 'actualUnitWeightKg'),
    actualUnitDimensionsM: dimensions(input.actualUnitDimensionsM),
    physicalPackingConfirmed: input.physicalPackingConfirmed,
    inspectionNote: text(input.inspectionNote, 'inspectionNote', 1000),
    idempotencyKey: key,
  };
}

export function parseInboundRejection(value: unknown) {
  const input = record(value, ['reason']);
  return { reason: text(input.reason, 'reason', 1000) };
}

export function parseList(value: unknown) {
  const input = record(value, ['facilityId', 'customerId', 'category', 'status', 'search', 'page', 'limit'], 'query');
  const page = queryInteger(input.page, 'page', 1, 1_000_000, 1);
  const limit = queryInteger(input.limit, 'limit', 1, 100, 20);
  if (input.status !== undefined && !Object.values(InventoryItemStatus).includes(input.status as InventoryItemStatus)) invalid('Invalid status');
  const search = input.search === undefined ? undefined : text(input.search, 'search', 100);
  const category = input.category === undefined ? undefined : text(input.category, 'category', 80);
  return {
    page, limit,
    ...(input.facilityId === undefined ? {} : { facilityId: parseId(input.facilityId, 'facilityId') }),
    ...(input.customerId === undefined ? {} : { customerId: parseId(input.customerId, 'customerId') }),
    ...(category === undefined ? {} : { category }),
    ...(input.status === undefined ? {} : { status: input.status as InventoryItemStatus }),
    ...(search === undefined ? {} : { search }),
  };
}

function queryInteger(value: unknown, field: string, min: number, max: number, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid(`Invalid ${field}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) invalid(`Invalid ${field}`);
  return number;
}
