import { RackOrientation, WarehouseOperationalStatus } from '../../types/warehouse-map.type';

export const DEFAULT_RACK_DIMENSIONS = Object.freeze({ widthM: 2, depthM: 0.6, heightM: 2 });
export const DEFAULT_LEVEL_COUNT = 4;
export const DEFAULT_CELLS_PER_LEVEL = 4;
export const DEFAULT_LEVEL_CAPACITY_KG = 500;
export const DEFAULT_CELL_CAPACITY_KG = 125;

export class WarehouseMapError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function invalid(message: string): never { throw new WarehouseMapError(400, message); }

function record(value: unknown, allowed: string[], field = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object`);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid(`${field} contains an unsupported field`);
  return input;
}

export function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) invalid(`Invalid ${field}`);
  return value.toLowerCase();
}

function text(value: unknown, field: string, max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function code(value: unknown, field: string): string {
  const result = text(value, field, 40);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result)) invalid(`${field} contains unsupported characters`);
  return result.toUpperCase();
}

function positive(value: unknown, field: string, max = 10000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) invalid(`${field} must be a positive number no greater than ${max}`);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${field} must be an integer from ${min} to ${max}`);
  return value;
}

function coordinate(value: unknown, field: string): number {
  return integer(value, field, 0, 100000);
}

function status(value: unknown, field = 'operationalStatus'): WarehouseOperationalStatus {
  if (!Object.values(WarehouseOperationalStatus).includes(value as WarehouseOperationalStatus)) invalid(`Invalid ${field}`);
  return value as WarehouseOperationalStatus;
}

function orientation(value: unknown): RackOrientation {
  if (!Object.values(RackOrientation).filter(v => typeof v === 'number').includes(value as RackOrientation)) invalid('orientation must be 0, 90, 180 or 270');
  return value as RackOrientation;
}

function dimensions(value: unknown, field = 'dimensions') {
  const input = record(value, ['widthM', 'depthM', 'heightM'], field);
  return {
    widthM: positive(input.widthM, `${field}.widthM`),
    depthM: positive(input.depthM, `${field}.depthM`),
    heightM: positive(input.heightM, `${field}.heightM`),
  };
}

function description(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length > max) invalid(`${field} must be a string of at most ${max} characters`);
  return value.trim();
}

export function parseZoneCreate(value: unknown) {
  const input = record(value, ['facilityId', 'code', 'name', 'description', 'color', 'sortOrder', 'isActive']);
  const result: Record<string, unknown> = {
    facilityId: id(input.facilityId, 'facilityId'),
    code: code(input.code, 'code'),
    name: text(input.name, 'name', 120),
  };
  if (input.description !== undefined) result.description = description(input.description, 'description', 1000);
  if (input.color !== undefined) {
    const color = text(input.color, 'color', 32);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) invalid('color must be a six-digit hex color');
    result.color = color.toUpperCase();
  }
  if (input.sortOrder !== undefined) result.sortOrder = integer(input.sortOrder, 'sortOrder', 0, 100000);
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') invalid('isActive must be a boolean');
    result.isActive = input.isActive;
  }
  return result;
}

export function parseZoneUpdate(value: unknown) {
  const input = record(value, ['name', 'description', 'color', 'sortOrder', 'isActive']);
  if (!Object.keys(input).length) invalid('At least one field is required');
  const result: Record<string, unknown> = {};
  if (input.name !== undefined) result.name = text(input.name, 'name', 120);
  if (input.description !== undefined) result.description = description(input.description, 'description', 1000);
  if (input.color !== undefined) {
    const color = text(input.color, 'color', 32);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) invalid('color must be a six-digit hex color');
    result.color = color.toUpperCase();
  }
  if (input.sortOrder !== undefined) result.sortOrder = integer(input.sortOrder, 'sortOrder', 0, 100000);
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') invalid('isActive must be a boolean');
    result.isActive = input.isActive;
  }
  return result;
}

export function parseRackCreate(value: unknown) {
  const input = record(value, [
    'facilityId', 'zoneId', 'aisleCode', 'rackCode', 'dimensions', 'levelCount', 'cellsPerLevel',
    'maxWeightKgPerLevel', 'mapX', 'mapY', 'orientation', 'operationalStatus',
    'cellCapacitiesKg', 'usableHeightMByLevel',
  ]);
  if (input.mapX === undefined || input.mapY === undefined) invalid('mapX and mapY are required');
  const levelCount = input.levelCount === undefined ? DEFAULT_LEVEL_COUNT : integer(input.levelCount, 'levelCount', 1, 20);
  const cellsPerLevel = input.cellsPerLevel === undefined ? DEFAULT_CELLS_PER_LEVEL : integer(input.cellsPerLevel, 'cellsPerLevel', 1, 20);
  const maxWeightKgPerLevel = input.maxWeightKgPerLevel === undefined ? DEFAULT_LEVEL_CAPACITY_KG : positive(input.maxWeightKgPerLevel, 'maxWeightKgPerLevel', 1000000);
  const cellCapacitiesKg = input.cellCapacitiesKg === undefined
    ? Array.from({ length: levelCount }, () => Array(cellsPerLevel).fill(DEFAULT_CELL_CAPACITY_KG))
    : input.cellCapacitiesKg;
  if (!Array.isArray(cellCapacitiesKg) || cellCapacitiesKg.length !== levelCount ||
      cellCapacitiesKg.some((row: unknown) => !Array.isArray(row) || row.length !== cellsPerLevel)) {
    invalid('cellCapacitiesKg must have one row per level and one value per cell');
  }
  const parsedCapacities: number[][] = cellCapacitiesKg.map((row: unknown[], levelIndex: number) => {
    const values = row.map((kg: unknown, cellIndex: number) => positive(kg, `cellCapacitiesKg[${levelIndex}][${cellIndex}]`, 1000000));
    if (values.reduce((sum: number, weight: number) => sum + weight, 0) > maxWeightKgPerLevel) {
      invalid(`Cell capacities on level ${levelIndex + 1} exceed maxWeightKgPerLevel`);
    }
    return values;
  });
  let usableHeightMByLevel: number[] | undefined;
  if (input.usableHeightMByLevel !== undefined) {
    if (!Array.isArray(input.usableHeightMByLevel) || input.usableHeightMByLevel.length !== levelCount) invalid('usableHeightMByLevel must have one value per level');
    usableHeightMByLevel = input.usableHeightMByLevel.map((height: unknown, index: number) => positive(height, `usableHeightMByLevel[${index}]`, 100));
  }

  const result: Record<string, unknown> = {
    facilityId: id(input.facilityId, 'facilityId'),
    zoneId: id(input.zoneId, 'zoneId'),
    aisleCode: code(input.aisleCode, 'aisleCode'),
    rackCode: code(input.rackCode, 'rackCode'),
    dimensions: input.dimensions === undefined ? { ...DEFAULT_RACK_DIMENSIONS } : dimensions(input.dimensions),
    levelCount,
    cellsPerLevel,
    maxWeightKgPerLevel,
    mapX: coordinate(input.mapX, 'mapX'),
    mapY: coordinate(input.mapY, 'mapY'),
    orientation: input.orientation === undefined ? RackOrientation.DEG_0 : orientation(input.orientation),
    operationalStatus: input.operationalStatus === undefined ? WarehouseOperationalStatus.AVAILABLE : status(input.operationalStatus),
    cellCapacitiesKg: parsedCapacities,
    ...(usableHeightMByLevel ? { usableHeightMByLevel } : {}),
  };
  const rackDimensions = result.dimensions as { widthM: number; depthM: number; heightM: number };
  if (rackDimensions.widthM / cellsPerLevel <= 0 || rackDimensions.widthM / cellsPerLevel > rackDimensions.widthM) invalid('Rack width is too small for the cell layout');
  if (usableHeightMByLevel && usableHeightMByLevel.reduce((sum, height) => sum + height, 0) > rackDimensions.heightM) {
    invalid('Configured usable heights across all levels cannot exceed nominal rack height');
  }
  return result;
}

export function parseRackUpdate(value: unknown) {
  const input = record(value, ['aisleCode', 'dimensions', 'maxWeightKgPerLevel', 'mapX', 'mapY', 'orientation', 'operationalStatus']);
  if (!Object.keys(input).length) invalid('At least one field is required');
  const result: Record<string, unknown> = {};
  if (input.aisleCode !== undefined) result.aisleCode = code(input.aisleCode, 'aisleCode');
  if (input.dimensions !== undefined) result.dimensions = dimensions(input.dimensions);
  if (input.maxWeightKgPerLevel !== undefined) result.maxWeightKgPerLevel = positive(input.maxWeightKgPerLevel, 'maxWeightKgPerLevel', 1000000);
  if (input.mapX !== undefined) result.mapX = coordinate(input.mapX, 'mapX');
  if (input.mapY !== undefined) result.mapY = coordinate(input.mapY, 'mapY');
  if (input.orientation !== undefined) result.orientation = orientation(input.orientation);
  if (input.operationalStatus !== undefined) result.operationalStatus = status(input.operationalStatus);
  return result;
}

export function parseCellUpdate(value: unknown) {
  const input = record(value, ['maxWeightKg', 'dimensions', 'operationalStatus']);
  if (!Object.keys(input).length) invalid('At least one field is required');
  const result: Record<string, unknown> = {};
  if (input.maxWeightKg !== undefined) result.maxWeightKg = positive(input.maxWeightKg, 'maxWeightKg', 1000000);
  if (input.dimensions !== undefined) {
    const cell = record(input.dimensions, ['widthM', 'depthM', 'usableHeightM'], 'dimensions');
    if (!Object.keys(cell).length) invalid('dimensions cannot be empty');
    const parsed: Record<string, number> = {};
    for (const key of ['widthM', 'depthM', 'usableHeightM'] as const) if (cell[key] !== undefined) parsed[key] = positive(cell[key], `dimensions.${key}`, 100);
    result.dimensions = parsed;
  }
  if (input.operationalStatus !== undefined) result.operationalStatus = status(input.operationalStatus);
  return result;
}

export function parseList(value: unknown, kind: 'zone' | 'rack' | 'cell') {
  const allowedByKind = {
    zone: ['facilityId', 'isActive', 'page', 'limit'],
    rack: ['facilityId', 'zoneId', 'aisleCode', 'operationalStatus', 'page', 'limit'],
    cell: ['facilityId', 'zoneId', 'rackId', 'levelNumber', 'operationalStatus', 'page', 'limit'],
  }[kind];
  const input = record(value, allowedByKind, 'query');
  function queryInteger(key: string, fallback: number, min: number, max: number) {
    if (input[key] === undefined) return fallback;
    if (typeof input[key] !== 'string' || !/^[1-9]\d*$/.test(input[key] as string)) invalid(`Invalid ${key}`);
    return integer(Number(input[key]), key, min, max);
  }
  const page = queryInteger('page', 1, 1, 1000000);
  const limit = queryInteger('limit', 20, 1, 100);
  const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
  if (input.facilityId !== undefined) filter.facilityId = id(input.facilityId, 'facilityId');
  if (input.zoneId !== undefined) filter.zoneId = id(input.zoneId, 'zoneId');
  if (input.rackId !== undefined) filter.rackId = id(input.rackId, 'rackId');
  if (input.aisleCode !== undefined) filter.aisleCode = code(input.aisleCode, 'aisleCode');
  if (input.operationalStatus !== undefined) filter.operationalStatus = status(input.operationalStatus);
  if (input.isActive !== undefined) {
    if (input.isActive !== 'true' && input.isActive !== 'false') invalid('Invalid isActive');
    filter.isActive = input.isActive === 'true';
  }
  if (input.levelNumber !== undefined) filter.levelNumber = queryInteger('levelNumber', 1, 1, 20);
  return { page, limit, filter };
}
