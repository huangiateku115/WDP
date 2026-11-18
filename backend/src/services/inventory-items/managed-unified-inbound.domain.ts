import { Types } from 'mongoose';

const domainStatusByCode: Record<string, number> = {
  INVALID_INPUT: 422, INVALID_PLACEMENT_TOTALS: 422, INVALID_INSTANCE_ALLOCATION: 422, INVALID_MEASUREMENTS: 422,
  ITEM_SPECIFICATION_STALE: 409, CAPACITY_EXCEEDED: 409, LEVEL_CAPACITY_EXCEEDED: 409, RESERVATION_CAPACITY_EXCEEDED: 409,
  CAPACITY_UNKNOWN: 503, CELL_CAPACITY_UNKNOWN: 503, LEVEL_CAPACITY_UNKNOWN: 503,
};
export class ManagedUnifiedInboundDomainError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); this.name = 'ManagedUnifiedInboundDomainError'; }
}
const fail = (code: string, message: string): never => { throw new ManagedUnifiedInboundDomainError(code, message, domainStatusByCode[code] ?? 422); };
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const round = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const object = (value: any, allowed: string[], label: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_INPUT', `${label} không hợp lệ.`);
  return value;
};
const id = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail('INVALID_INPUT', `${field} không hợp lệ.`);
  return new Types.ObjectId(value as string);
};

/** Validates a single-SKU, multi-spec inbound. It never accepts client totals as authoritative. */
export function normalizeUnifiedInbound(input: unknown) {
  const body = object(input, ['accessSessionId', 'sessionRevision', 'skuRevision', 'lines'], 'Yêu cầu nhập kho');
  const accessSessionId = id(body.accessSessionId, 'accessSessionId');
  if (!Number.isSafeInteger(body.sessionRevision) || body.sessionRevision < 0 || !Number.isSafeInteger(body.skuRevision) || body.skuRevision < 0) fail('INVALID_INPUT', 'Phiên hoặc phiên bản SKU không hợp lệ.');
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 50) fail('INVALID_INPUT', 'Cần từ 1 đến 50 dòng hàng hóa.');
  const seenLines = new Set<string>(), seenCells = new Set<string>();
  const lines = body.lines.map((raw: any, index: number) => {
    const line = object(raw, ['lineId', 'itemSpecId', 'itemSpecRevision', 'quantity', 'measurementMode', 'actualUnitWeightKg', 'dimensionsM', 'cellAllocations', 'instanceAllocations', 'notes'], `Dòng ${index + 1}`);
    if (typeof line.lineId !== 'string' || !/^[\w.-]{1,80}$/.test(line.lineId) || seenLines.has(line.lineId)) fail('INVALID_INPUT', `Mã dòng ${index + 1} không hợp lệ hoặc bị trùng.`);
    seenLines.add(line.lineId);
    const itemSpecId = id(line.itemSpecId, `lines.${index}.itemSpecId`);
    if (!Number.isSafeInteger(line.itemSpecRevision) || line.itemSpecRevision < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) fail('INVALID_INPUT', `Số lượng hoặc phiên bản dòng ${index + 1} không hợp lệ.`);
    if (!['SPECIFICATION', 'MEASURED'].includes(line.measurementMode)) fail('INVALID_INPUT', `Cách đo dòng ${index + 1} không hợp lệ.`);
    const dimensions = line.dimensionsM == null ? null : object(line.dimensionsM, ['widthM', 'depthM', 'heightM'], `Kích thước dòng ${index + 1}`);
    if (dimensions && ![dimensions.widthM, dimensions.depthM, dimensions.heightM].every(positive)) fail('INVALID_INPUT', `Kích thước dòng ${index + 1} phải là số dương hữu hạn.`);
    if (line.measurementMode === 'MEASURED' && (!positive(line.actualUnitWeightKg) || !dimensions)) fail('INVALID_INPUT', `Dòng ${index + 1} cần số đo thực tế hợp lệ.`);
    if (line.measurementMode === 'SPECIFICATION' && (line.actualUnitWeightKg !== undefined || dimensions !== null)) fail('INVALID_INPUT', `Dòng ${index + 1} không được gửi số đo ghi đè khi dùng Item Specification.`);
    if (!Array.isArray(line.cellAllocations) || line.cellAllocations.length < 1 || line.cellAllocations.length > 100) fail('INVALID_INPUT', `Dòng ${index + 1} cần phân bổ vào Cell.`);
    const cells = line.cellAllocations.map((rawAllocation: any, allocationIndex: number) => {
      const allocation = object(rawAllocation, ['cellId', 'quantity'], `Phân bổ ${index + 1}.${allocationIndex + 1}`);
      const cellId = id(allocation.cellId, `lines.${index}.cellAllocations.${allocationIndex}.cellId`);
      if (!Number.isSafeInteger(allocation.quantity) || allocation.quantity < 1 || seenCells.has(`${line.lineId}:${cellId}`)) fail('INVALID_INPUT', `Phân bổ Cell của dòng ${index + 1} không hợp lệ hoặc bị trùng.`);
      seenCells.add(`${line.lineId}:${cellId}`); return { cellId, quantity: allocation.quantity };
    });
    const indivisible = line.instanceAllocations !== undefined;
    if (indivisible) {
      if (line.quantity !== 1 || line.cellAllocations.length !== 1 || line.cellAllocations[0].quantity !== 1 || !Array.isArray(line.instanceAllocations) || line.instanceAllocations.length < 2 || line.instanceAllocations.length > 20) fail('INVALID_INSTANCE_ALLOCATION', `Món nguyên khối ở dòng ${index + 1} phải có quantity 1 và ít nhất hai phần tải Cell.`);
      const instanceAllocations = line.instanceAllocations.map((rawAllocation: any, allocationIndex: number) => {
        const allocation = object(rawAllocation, ['cellId', 'weightKg', 'volumeM3'], `Phần tải ${index + 1}.${allocationIndex + 1}`);
        const cellId = id(allocation.cellId, `lines.${index}.instanceAllocations.${allocationIndex}.cellId`);
        if (!positive(allocation.weightKg) || !positive(allocation.volumeM3) || instanceAllocationsDuplicate(line.instanceAllocations, String(cellId), allocationIndex)) fail('INVALID_INSTANCE_ALLOCATION', `Phần tải Cell của dòng ${index + 1} không hợp lệ hoặc trùng.`);
        return { cellId, weightKg: allocation.weightKg, volumeM3: allocation.volumeM3 };
      });
      const allocatedCellIds = new Set(instanceAllocations.map((row: { cellId: Types.ObjectId }) => String(row.cellId)));
      if (allocatedCellIds.size !== instanceAllocations.length) fail('INVALID_INSTANCE_ALLOCATION', `Cell của món nguyên khối dòng ${index + 1} bị trùng.`);
      return { lineId: line.lineId, itemSpecId, itemSpecRevision: line.itemSpecRevision, quantity: 1, measurementMode: line.measurementMode,
        ...(line.actualUnitWeightKg !== undefined ? { actualUnitWeightKg: line.actualUnitWeightKg } : {}), ...(dimensions ? { dimensionsM: dimensions } : {}), cellAllocations: cells, instanceAllocations };
    }
    if (line.cellAllocations.reduce((sum: number, row: any) => sum + row.quantity, 0) !== line.quantity) fail('INVALID_PLACEMENT_TOTALS', `Tổng phân bổ dòng ${index + 1} phải bằng số lượng nhập.`);
    return { lineId: line.lineId, itemSpecId, itemSpecRevision: line.itemSpecRevision, quantity: line.quantity, measurementMode: line.measurementMode,
      ...(line.actualUnitWeightKg !== undefined ? { actualUnitWeightKg: line.actualUnitWeightKg } : {}), ...(dimensions ? { dimensionsM: dimensions } : {}), cellAllocations: cells };
  });
  return { accessSessionId, sessionRevision: body.sessionRevision as number, skuRevision: body.skuRevision as number, lines };
}

function instanceAllocationsDuplicate(rows: any[], idText: string, index: number) { return rows.slice(0, index).some(row => String(row?.cellId) === idText); }

const refId = (value: any) => String(value?._id ?? value ?? '');

/**
 * Selects a complete revision history for every SKU touched by an operation.
 * A SKU ledger remains replayable even after all of its stock projections are
 * depleted, and Cell/Reservation scope must not truncate that SKU's history.
 */
export function selectManagedSkuReplayScope(input: {
  canonicalMovements: any[]; stockRows: any[]; instances: any[];
  reservationId: unknown; reservationIds?: unknown[]; cellIds: unknown[]; skuId?: unknown;
}) {
  const reservationIds = new Set([input.reservationId, ...(input.reservationIds ?? [])].map(refId));
  const cellIds = new Set((input.cellIds ?? []).map(refId));
  const relevantCanonicalMovements = input.canonicalMovements.filter((movement: any) =>
    reservationIds.has(refId(movement.managedReservationId ?? movement.reservationId)) ||
    [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? [])]
      .some((line: any) => cellIds.has(refId(line.cellId)) || reservationIds.has(refId(line.reservationId))));
  const relevantSkuIds = new Set([
    ...relevantCanonicalMovements.map((movement: any) => refId(movement.itemId)),
    ...(input.skuId ? [refId(input.skuId)] : []),
  ].filter(Boolean));
  const stocks = input.stockRows.filter((row: any) => reservationIds.has(refId(row.reservationId)) ||
    cellIds.has(refId(row.cellId)) || relevantSkuIds.has(refId(row.skuId)));
  const instances = input.instances.filter((row: any) => reservationIds.has(refId(row.reservationId)) ||
    (row.allocations ?? []).some((allocation: any) => cellIds.has(refId(allocation.cellId))) || relevantSkuIds.has(refId(row.skuId)));
  // Include relevant event SKUs and the explicitly operated SKU even when no
  // current projection exists (for example, after a full outbound).
  const replaySkuIds = new Set([
    ...relevantSkuIds,
    ...stocks.map((row: any) => refId(row.skuId)),
    ...instances.map((row: any) => refId(row.skuId)),
  ].filter(Boolean));
  const replayMovements = input.canonicalMovements.filter((movement: any) => replaySkuIds.has(refId(movement.itemId)));
  return { stocks, instances, replayMovements };
}

const legacyMovementCellIds = (movement: any) => [...new Set([
  movement.sourceCellId, movement.destinationCellId,
  ...(movement.batchLines ?? []).map((line: any) => line.cellId),
  ...(movement.v3Effect?.source ?? []).map((line: any) => line.cellId),
  ...(movement.v3Effect?.destination ?? []).map((line: any) => line.cellId),
  ...(movement.stockEffect?.source ?? []).map((line: any) => line.cellId),
  ...(movement.stockEffect?.destination ?? []).map((line: any) => line.cellId),
].filter(Boolean).map(refId))];

/**
 * Proves whether legacy stock can be isolated from one operation's Reservation
 * and physical capacity scope. Unknown provenance is never treated as empty.
 */
export function classifyLegacyStockImpact(input: {
  reservationId: unknown; capacityCells: any[]; allCells: any[]; movements?: any[]; items?: any[];
  stockBalances?: any[]; v3Projections?: any[]; v3BatchPlacements?: any[]; v3PhysicalUnits?: any[]; v3Footprints?: any[];
}) {
  const targetReservation = refId(input.reservationId), facilityCells = new Map((input.allCells ?? []).map(cell => [refId(cell._id), cell]));
  const scopedLevels = new Set((input.capacityCells ?? []).map(cell => `${refId(cell.rackId)}:${cell.levelNumber}`));
  const itemById = new Map((input.items ?? []).map(item => [refId(item._id), item]));
  const conflictSources = new Set<string>(), unknownSources = new Set<string>();
  const examine = (source: string, reservationId: any, cellIds: string[], hasPhysicalStock: boolean, missingCellMeansUnknown = false) => {
    if (!hasPhysicalStock) return;
    if (targetReservation && reservationId && refId(reservationId) === targetReservation) { conflictSources.add(source); return; }
    if (!cellIds.length) { if (missingCellMeansUnknown || !reservationId || refId(reservationId) !== targetReservation) unknownSources.add(source); return; }
    for (const cellId of cellIds) {
      const cell = facilityCells.get(cellId);
      if (!cell) { unknownSources.add(source); continue; }
      if (scopedLevels.has(`${refId(cell.rackId)}:${cell.levelNumber}`)) conflictSources.add(source);
    }
  };
  for (const movement of input.movements ?? []) {
    if (movement.schemaVersion === 4 && movement.stockEffect) continue;
    const item = itemById.get(refId(movement.itemId));
    const cells = legacyMovementCellIds(movement);
    const itemCell = item?.currentCellId ? [refId(item.currentCellId)] : [];
    const reservationId = movement.managedReservationId ?? movement.reservationId ?? item?.managedReservationId ?? item?.reservationId;
    examine('MOVEMENT', reservationId, [...new Set([...cells, ...itemCell])], true, true);
  }
  for (const item of input.items ?? []) {
    const physicallyPlaced = !!item.currentCellId || ['IN_STORAGE','PENDING_OUTBOUND'].includes(item.status);
    examine('LEGACY_ITEM', item.managedReservationId ?? item.reservationId, item.currentCellId ? [refId(item.currentCellId)] : [], physicallyPlaced, true);
  }
  for (const balance of input.stockBalances ?? []) {
    const hasStock = Number(balance.onHandQuantity ?? 0) > 0 || Number(balance.heldQuantity ?? 0) > 0 ||
      Number(balance.actualTotalWeightKg ?? 0) > 0 || Number(balance.actualTotalVolumeM3 ?? 0) > 0 ||
      !!balance.currentCellId ||
      (balance.batches ?? []).some((batch: any) => Number(batch.quantity ?? 0) > 0 || Number(batch.heldQuantity ?? 0) > 0 || Number(batch.actualTotalWeightKg ?? 0) > 0 || Number(batch.actualTotalVolumeM3 ?? 0) > 0);
    const cells = balance.currentCellId ? [refId(balance.currentCellId)] : [];
    examine('LEGACY_STOCK_BALANCE', balance.managedReservationId ?? balance.reservationId, cells, hasStock, hasStock);
  }
  for (const projection of input.v3Projections ?? []) {
    const hasStock = Number(projection.onHandQuantity ?? 0) > 0 || Number(projection.heldQuantity ?? 0) > 0 || Number(projection.totalWeightKg ?? 0) > 0 || Number(projection.totalVolumeM3 ?? 0) > 0 ||
      (projection.byCell ?? []).some((line: any) => Number(line.quantity ?? 0) > 0 || Number(line.physicalUnitCount ?? 0) > 0 || Number(line.weightKg ?? 0) > 0 || Number(line.volumeM3 ?? 0) > 0);
    const cells = (projection.byCell ?? []).filter((line: any) => Number(line.quantity ?? 0) > 0 || Number(line.weightKg ?? 0) > 0 || Number(line.volumeM3 ?? 0) > 0).map((line: any) => refId(line.cellId));
    examine('V3_STOCK_PROJECTION', projection.reservationId, cells, hasStock, hasStock);
  }
  for (const placement of input.v3BatchPlacements ?? []) {
    examine('V3_BATCH_PLACEMENT', placement.reservationId, placement.cellId ? [refId(placement.cellId)] : [], placement.state === 'ACTIVE' || Number(placement.quantity ?? 0) > 0, true);
  }
  const footprintCells = new Map((input.v3Footprints ?? []).filter(row => row.state === 'ACTIVE').map(row => [refId(row.physicalUnitId), (row.cells ?? []).map((cell: any) => refId(cell.cellId))]));
  for (const unit of input.v3PhysicalUnits ?? []) {
    if (unit.state !== 'PLACED') continue;
    const cells = footprintCells.get(refId(unit._id)) ?? [];
    examine('V3_PHYSICAL_UNIT', unit.reservationId, cells, true, true);
    if (!cells.length) unknownSources.add('V3_PHYSICAL_UNIT_WITHOUT_FOOTPRINT');
  }
  for (const footprint of input.v3Footprints ?? []) {
    if (footprint.state !== 'ACTIVE') continue;
    examine('V3_ACTIVE_FOOTPRINT', footprint.reservationId, (footprint.cells ?? []).map((cell: any) => refId(cell.cellId)), true, true);
  }
  return { status: conflictSources.size ? 'CONFLICT' : unknownSources.size ? 'UNKNOWN' : 'ISOLATED', conflictSources: [...conflictSources].sort(), unknownSources: [...unknownSources].sort() };
}

export function measurementSnapshot(specification: any, line: any) {
  if (!specification || specification.status !== 'ACTIVE' || specification.deletedAt || specification.revision !== line.itemSpecRevision) fail('ITEM_SPECIFICATION_STALE', 'Item Specification đã thay đổi hoặc không còn hoạt động. Hãy tải lại.');
  const dimensionsM = line.measurementMode === 'MEASURED' ? line.dimensionsM : specification.dimensionsM;
  const unitWeightKg = line.measurementMode === 'MEASURED' ? line.actualUnitWeightKg : specification.unitWeightKg;
  if (!positive(unitWeightKg) || ![dimensionsM?.widthM, dimensionsM?.depthM, dimensionsM?.heightM].every(positive)) fail('INVALID_MEASUREMENTS', 'Snapshot đo lường không hợp lệ.');
  const canonicalUnitWeightKg = round(unitWeightKg, 3);
  if (!positive(canonicalUnitWeightKg)) fail('INVALID_MEASUREMENTS', 'Khối lượng thấp hơn độ chính xác lưu trữ chuẩn.');
  const unitVolumeM3 = round(dimensionsM.widthM * dimensionsM.depthM * dimensionsM.heightM, 6);
  if (!positive(unitVolumeM3) || !Number.isFinite(canonicalUnitWeightKg * line.quantity)) fail('INVALID_MEASUREMENTS', 'Số đo vượt phạm vi tính toán an toàn.');
  return { unitWeightKg: canonicalUnitWeightKg, dimensionsM: { ...dimensionsM }, unitVolumeM3 };
}

export function validateUnifiedCellTotals(cellRows: any[], additions: Map<string, { weightKg: number; volumeM3: number }>, levelMaxByKey: Map<string, number>, reservationRemainingM3: number) {
  if (!Array.isArray(cellRows) || !Number.isFinite(reservationRemainingM3) || reservationRemainingM3 < 0) fail('CAPACITY_UNKNOWN', 'Không đủ bằng chứng dung lượng Reservation.');
  for (const cell of cellRows) {
    const idText = String(cell._id), add = additions.get(idText) ?? { weightKg: 0, volumeM3: 0 };
    const maxVolume = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
    if (![cell.maxWeightKg, cell.usedWeightKg, cell.usedVolumeM3, maxVolume].every(Number.isFinite) || cell.maxWeightKg <= 0 || cell.usedWeightKg < 0 || cell.usedVolumeM3 < 0 || maxVolume <= 0) fail('CAPACITY_UNKNOWN', `Capacity của Cell ${cell.code ?? idText} chưa được xác minh.`);
    if (cell.usedWeightKg + add.weightKg > cell.maxWeightKg + 0.001 || cell.usedVolumeM3 + add.volumeM3 > maxVolume + 0.000001) fail('CAPACITY_EXCEEDED', `Cell ${cell.code ?? idText} không đủ tải trọng hoặc thể tích.`);
    const levelKey = `${cell.rackId}:${cell.levelNumber}`, levelLimit = levelMaxByKey.get(levelKey);
    if (!Number.isFinite(levelLimit) || (cell._levelUsedWeightKg ?? 0) + (cell._levelAdditionWeightKg ?? 0) > levelLimit! + 0.001) fail('LEVEL_CAPACITY_EXCEEDED', `Level của Cell ${cell.code ?? idText} không đủ tải trọng.`);
    if (add.volumeM3 > reservationRemainingM3 + 0.000001) fail('RESERVATION_CAPACITY_EXCEEDED', 'Dung lượng Reservation không đủ.');
  }
}

/** Validates aggregate additions for every touched Cell and Rack level, not isolated DTO lines. */
export function assertUnifiedInboundCapacity(cellRows: any[], additions: Map<string, { weightKg: number; volumeM3: number }>, levelAdditions: Map<string, number>, racks: any[]) {
  if (!Array.isArray(cellRows) || !Array.isArray(racks)) fail('CELL_CAPACITY_UNKNOWN', 'Không thể xác minh tập Cell/Rack đầy đủ.');
  const cellById = new Map(cellRows.map((cell: any) => [String(cell._id), cell]));
  const rackById = new Map(racks.map((rack: any) => [String(rack._id), rack]));
  for (const [cellId, addition] of additions) {
    const cell: any = cellById.get(cellId);
    if (!cell || ![cell.maxWeightKg, cell.usedWeightKg, cell.usedVolumeM3, cell.dimensions?.widthM, cell.dimensions?.depthM, cell.dimensions?.usableHeightM, addition.weightKg, addition.volumeM3].every((value: any) => typeof value === 'number' && Number.isFinite(value)) ||
      cell.maxWeightKg <= 0 || cell.usedWeightKg < 0 || cell.usedVolumeM3 < 0 || cell.dimensions.widthM <= 0 || cell.dimensions.depthM <= 0 || cell.dimensions.usableHeightM <= 0 || addition.weightKg < 0 || addition.volumeM3 < 0) fail('CELL_CAPACITY_UNKNOWN', `Capacity Cell ${cell?.code ?? cellId} chưa thể xác minh.`);
    const maxVolume = cell.dimensions.widthM * cell.dimensions.depthM * cell.dimensions.usableHeightM;
    if (!Number.isFinite(maxVolume) || maxVolume <= 0) fail('CELL_CAPACITY_UNKNOWN', `Thể tích tối đa Cell ${cell.code ?? cellId} chưa thể xác minh.`);
    if (cell.usedWeightKg + addition.weightKg > cell.maxWeightKg + 0.001 || cell.usedVolumeM3 + addition.volumeM3 > maxVolume + 0.000001) fail('CAPACITY_EXCEEDED', `Cell ${cell.code ?? cellId} không đủ dung lượng.`);
  }
  const currentLevelWeight = new Map<string, number>();
  for (const cell of cellRows) {
    const levelKey = `${cell.rackId}:${cell.levelNumber}`;
    if (typeof cell.usedWeightKg !== 'number' || !Number.isFinite(cell.usedWeightKg) || cell.usedWeightKg < 0) fail('LEVEL_CAPACITY_UNKNOWN', `Tải trọng Level ${levelKey} chưa được xác minh.`);
    currentLevelWeight.set(levelKey, (currentLevelWeight.get(levelKey) ?? 0) + cell.usedWeightKg);
  }
  for (const [levelKey, addedWeight] of levelAdditions) {
    const rackId = levelKey.split(':')[0] ?? '', rack: any = rackById.get(rackId), maximum = Number(rack?.maxWeightKgPerLevel);
    if (!rack || !Number.isFinite(maximum) || maximum <= 0 || !Number.isFinite(addedWeight) || addedWeight < 0) fail('LEVEL_CAPACITY_UNKNOWN', `Giới hạn tải trọng Level ${levelKey} chưa được xác minh.`);
    if ((currentLevelWeight.get(levelKey) ?? 0) + addedWeight > maximum + 0.001) fail('LEVEL_CAPACITY_EXCEEDED', `Level ${levelKey} không đủ tải trọng.`);
  }
  return true;
}
