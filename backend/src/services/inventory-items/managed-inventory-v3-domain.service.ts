export type V3Scope = { skuId: string; reservationId: string; customerId: string; facilityId: string };
export type V3Dimensions = { widthM: number; depthM: number; heightM: number };
export type CertifiedCellGeometry = {
  cellId: string; facilityId: string; rackId: string; levelNumber: number; supportSurfaceId: string;
  xStartM: number; xEndM: number; yStartM: number; yEndM: number; usableHeightM: number;
  certified: boolean; certificationState: 'CERTIFIED' | 'REVOKED'; certificationRevision: number; certifiedAt: Date; expiresAt: Date;
  certifiedBy: string; provenance: 'FACILITY_SURVEY' | 'SYNTHETIC_TEST_FIXTURE'; transformRevision: number; worldTransform: { origin: number[]; axes: number[][] };
  obstacles: Array<{ xStartM: number; xEndM: number; yStartM: number; yEndM: number }>;
  maxWeightKg: number; usedWeightKg: number; maxVolumeM3: number; usedVolumeM3: number;
};
export type A1Support = { cellId: string; reactionKg: number; occupiedVolumeM3: number };
const finitePositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
function fail(message: string): never { throw new Error(message); }

export function validateV3Registration(input: { bookingFlowVersion?: number; status: string; startDate: Date; endDate: Date; hasAllocation: boolean }, now = new Date()) {
  if (input.bookingFlowVersion !== 3) fail('Managed V3 reservation required');
  if (!input.hasAllocation) fail('Reservation Cell allocation is missing');
  if (!(input.startDate instanceof Date) || !Number.isFinite(input.startDate.getTime()) || !(input.endDate instanceof Date) || !Number.isFinite(input.endDate.getTime()) ||
    !(now instanceof Date) || !Number.isFinite(now.getTime())) fail('Reservation term dates are invalid or unknown');
  if (input.status === 'CHECKIN_READY' && input.endDate > now) return { mayPrepareSku: true, mayRecordStock: false };
  if (input.status === 'ACTIVE' && input.startDate <= now && input.endDate > now) return { mayPrepareSku: true, mayRecordStock: true };
  fail('SKU preparation requires CHECKIN_READY or an in-term ACTIVE reservation');
}

export function validateA1Footprint(input: {
  scope: V3Scope; physicalUnit: V3Scope & { weightKg: number; dimensionsM: V3Dimensions; volumeM3: number; pose: { xStartM: number; yStartM: number; rotationDeg: 0 | 90 } };
  cells: CertifiedCellGeometry[]; supports: A1Support[]; level: { facilityId: string; rackId: string; levelNumber: number; maxWeightKg: number; usedWeightKg: number; certificationRevision: number };
  allocatedCellIds: string[]; now?: Date; toleranceM?: number; allowSyntheticFixtures?: boolean;
}) {
  const now = input.now ?? new Date(); const tolerance = input.toleranceM ?? 0.001;
  if (!input.scope || !input.physicalUnit || !Array.isArray(input.cells) || !Array.isArray(input.supports) || !input.level) fail('Certified topology and physical unit are required');
  if (!Array.isArray(input.allocatedCellIds) || !(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isFinite(tolerance) || tolerance < 0) fail('Certified allocation or topology tolerance is invalid');
  if ([input.scope.skuId, input.scope.reservationId, input.scope.customerId, input.scope.facilityId].some((v, i) =>
    v !== [input.physicalUnit.skuId, input.physicalUnit.reservationId, input.physicalUnit.customerId, input.physicalUnit.facilityId][i])) fail('PhysicalUnit ownership scope mismatch');
  const unit = input.physicalUnit;
  if (!finitePositive(unit.weightKg) || !finitePositive(unit.volumeM3) || !finitePositive(unit.dimensionsM.widthM) ||
      !finitePositive(unit.dimensionsM.depthM) || !finitePositive(unit.dimensionsM.heightM)) fail('PhysicalUnit measurements must be finite and positive');
  const derivedVolume = unit.dimensionsM.widthM * unit.dimensionsM.depthM * unit.dimensionsM.heightM;
  if (!Number.isFinite(derivedVolume) || !close(derivedVolume, unit.volumeM3)) fail('PhysicalUnit volume must match its certified dimensions');
  if (!unit.pose || !Number.isFinite(unit.pose.xStartM) || !Number.isFinite(unit.pose.yStartM) || ![0, 90].includes(unit.pose.rotationDeg)) fail('PhysicalUnit pose coordinates or supported rotation are invalid');
  if (input.cells.length < 1 || new Set(input.cells.map(c => c.cellId)).size !== input.cells.length) fail('Footprint Cell IDs must be unique and non-empty');
  if (input.cells.some(c => !input.allocatedCellIds.includes(c.cellId))) fail('Footprint includes a Cell outside the reservation allocation');
  const first = input.cells[0]!;
  for (const cell of input.cells) {
    if (!cell.certified || cell.certificationState !== 'CERTIFIED' || !cell.certifiedAt || cell.certifiedAt > now || !cell.expiresAt || cell.expiresAt <= now ||
        !Number.isSafeInteger(cell.certificationRevision) || cell.certificationRevision !== input.level.certificationRevision ||
        !Number.isSafeInteger(cell.transformRevision) || cell.transformRevision !== cell.certificationRevision ||
        typeof cell.certifiedBy !== 'string' || !cell.certifiedBy.trim() ||
        (cell.provenance !== 'FACILITY_SURVEY' && !(input.allowSyntheticFixtures === true && cell.provenance === 'SYNTHETIC_TEST_FIXTURE')) ||
        !Array.isArray(cell.worldTransform?.origin) || cell.worldTransform.origin.length !== 3 || !cell.worldTransform.origin.every(Number.isFinite) ||
        !Array.isArray(cell.worldTransform?.axes) || cell.worldTransform.axes.length !== 3 || cell.worldTransform.axes.some(axis => !Array.isArray(axis) || axis.length !== 3 || !axis.every(Number.isFinite))) fail('Cell topology certification is unknown, future-dated, stale or expired');
    if (cell.facilityId !== input.scope.facilityId || cell.rackId !== first.rackId || cell.levelNumber !== first.levelNumber ||
        cell.supportSurfaceId !== first.supportSurfaceId) fail('Footprint must share one Facility, Rack, level and continuous support surface');
    if (![cell.xStartM, cell.xEndM, cell.yStartM, cell.yEndM, cell.usableHeightM, cell.maxWeightKg, cell.usedWeightKg,
      cell.maxVolumeM3, cell.usedVolumeM3].every(Number.isFinite) || cell.xEndM <= cell.xStartM || cell.yEndM <= cell.yStartM ||
      cell.usableHeightM <= 0 || cell.maxWeightKg <= 0 || cell.maxVolumeM3 <= 0 || cell.usedWeightKg < 0 || cell.usedVolumeM3 < 0) fail('Cell usable boundaries or capacity are invalid or unknown');
    if (!Array.isArray(cell.obstacles)) fail('Obstacle geometry is unknown');
  }
  const ordered = [...input.cells].sort((a, b) => a.xStartM - b.xStartM || a.cellId.localeCompare(b.cellId));
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!; const next = ordered[i]!;
    if (Math.abs(prev.yStartM - next.yStartM) > tolerance || Math.abs(prev.yEndM - next.yEndM) > tolerance || Math.abs(prev.xEndM - next.xStartM) > tolerance) fail('Footprint Cells do not form a physically continuous usable surface');
  }
  const minX = Math.min(...ordered.map(c => c.xStartM)), maxX = Math.max(...ordered.map(c => c.xEndM));
  const usableDepth = Math.min(...ordered.map(c => c.yEndM - c.yStartM));
  const usableHeight = Math.min(...ordered.map(c => c.usableHeightM));
  const width = unit.pose.rotationDeg === 0 ? unit.dimensionsM.widthM : unit.dimensionsM.depthM;
  const depth = unit.pose.rotationDeg === 0 ? unit.dimensionsM.depthM : unit.dimensionsM.widthM;
  const unitXEnd = unit.pose.xStartM + width, unitYEnd = unit.pose.yStartM + depth;
  if (![unitXEnd, unitYEnd].every(Number.isFinite) || unit.pose.xStartM < minX - tolerance || unitXEnd > maxX + tolerance ||
      unit.pose.yStartM < Math.min(...ordered.map(c => c.yStartM)) - tolerance || unitYEnd > Math.max(...ordered.map(c => c.yEndM)) + tolerance ||
      depth > usableDepth + tolerance || unit.dimensionsM.heightM > usableHeight + tolerance) fail('PhysicalUnit dimensions or coordinates exceed the certified footprint boundaries');
  if (ordered.some(cell => cell.xStartM >= unitXEnd - tolerance || cell.xEndM <= unit.pose.xStartM + tolerance ||
    cell.yStartM >= unitYEnd - tolerance || cell.yEndM <= unit.pose.yStartM + tolerance)) fail('PhysicalUnit does not physically occupy every declared footprint Cell');
  for (const cell of ordered) for (const obstacle of cell.obstacles) {
    if (![obstacle.xStartM, obstacle.xEndM, obstacle.yStartM, obstacle.yEndM].every(Number.isFinite) || obstacle.xEndM <= obstacle.xStartM || obstacle.yEndM <= obstacle.yStartM ||
      obstacle.xStartM < cell.xStartM - tolerance || obstacle.xEndM > cell.xEndM + tolerance || obstacle.yStartM < cell.yStartM - tolerance || obstacle.yEndM > cell.yEndM + tolerance) fail('Obstacle geometry is invalid');
    if (obstacle.xStartM < unitXEnd && obstacle.xEndM > unit.pose.xStartM && obstacle.yStartM < unitYEnd && obstacle.yEndM > unit.pose.yStartM) fail('PhysicalUnit pose intersects a certified obstacle');
  }
  if (input.supports.length !== ordered.length || new Set(input.supports.map(s => s.cellId)).size !== ordered.length) fail('Every footprint Cell requires exactly one certified support reaction');
  const reactions = input.supports.reduce((sum, support) => sum + support.reactionKg, 0);
  const volume = input.supports.reduce((sum, support) => sum + support.occupiedVolumeM3, 0);
  if (![reactions, volume].every(Number.isFinite)) fail('A1 support reactions or occupied volume overflow');
  if (!close(reactions, unit.weightKg) || !close(volume, unit.volumeM3)) fail('A1 support reactions and occupied volume must conserve the single PhysicalUnit measurements');
  for (const support of input.supports) {
    const cell = ordered.find(c => c.cellId === support.cellId);
    if (!cell || !finitePositive(support.reactionKg) || !finitePositive(support.occupiedVolumeM3) ||
        cell.usedWeightKg + support.reactionKg > cell.maxWeightKg || cell.usedVolumeM3 + support.occupiedVolumeM3 > cell.maxVolumeM3) fail('A1 support load exceeds Cell capacity or is invalid');
  }
  if (input.level.facilityId !== input.scope.facilityId || input.level.rackId !== first.rackId || input.level.levelNumber !== first.levelNumber ||
      !finitePositive(input.level.maxWeightKg) || !Number.isFinite(input.level.usedWeightKg) || input.level.usedWeightKg < 0 ||
      input.level.usedWeightKg + unit.weightKg > input.level.maxWeightKg) fail('A1 load exceeds or lacks certified level capacity');
  return { quantity: 1 as const, cellIds: ordered.map(c => c.cellId), totalWeightKg: unit.weightKg, totalVolumeM3: unit.volumeM3 };
}

export function validateA2BatchPlacements(input: { scope: V3Scope; expectedBatches: Array<{ batchId: string; quantity: number; weightKg: number; volumeM3: number }>;
  placements: Array<V3Scope & { batchId: string; cellId: string; quantity: number; weightKg: number; volumeM3: number }>;
  allocatedCellIds: string[]; cellCapacity: Array<{ cellId: string; usedWeightKg: number; maxWeightKg: number; usedVolumeM3: number; maxVolumeM3: number }> }) {
  if (!input || !input.scope || !Array.isArray(input.expectedBatches) || !Array.isArray(input.placements) ||
    !Array.isArray(input.allocatedCellIds) || !Array.isArray(input.cellCapacity)) fail('A2 reconciliation evidence is incomplete');
  const expectedIds = input.expectedBatches.map(row => row.batchId);
  if (!expectedIds.length || expectedIds.some(id => !id) || new Set(expectedIds).size !== expectedIds.length) fail('Expected batch IDs must be non-empty and unique');
  const expected = new Map(input.expectedBatches.map(batch => [batch.batchId, batch]));
  const capacities = new Map(input.cellCapacity.map(cell => [cell.cellId, cell]));
  const keys = new Set<string>(); const totals = new Map<string, { quantity: number; weightKg: number; volumeM3: number }>();
  const cellAdds = new Map<string, { weightKg: number; volumeM3: number }>();
  for (const placement of input.placements) {
    if (placement.skuId !== input.scope.skuId || placement.reservationId !== input.scope.reservationId || placement.customerId !== input.scope.customerId || placement.facilityId !== input.scope.facilityId) fail('Batch placement ownership or reservation scope mismatch');
    const batch = expected.get(placement.batchId); if (!batch) fail('Placement references an unknown batch');
    if (!input.allocatedCellIds.includes(placement.cellId)) fail('Batch placement Cell is outside the reservation allocation');
    if (!capacities.has(placement.cellId)) fail('Batch placement Cell capacity evidence is missing');
    if (!Number.isSafeInteger(placement.quantity) || placement.quantity <= 0 || !finitePositive(placement.weightKg) || !finitePositive(placement.volumeM3)) fail('Batch placement measurements are invalid');
    const key = `${placement.batchId}:${placement.cellId}`; if (keys.has(key)) fail('Duplicate batch placement line'); keys.add(key);
    const total = totals.get(placement.batchId) ?? { quantity: 0, weightKg: 0, volumeM3: 0 };
    total.quantity += placement.quantity; total.weightKg += placement.weightKg; total.volumeM3 += placement.volumeM3;
    if (!Number.isSafeInteger(total.quantity) || !Number.isFinite(total.weightKg) || !Number.isFinite(total.volumeM3)) fail('Batch placement totals exceed safe arithmetic bounds');
    totals.set(placement.batchId, total);
    const cellTotal = cellAdds.get(placement.cellId) ?? { weightKg: 0, volumeM3: 0 };
    cellTotal.weightKg += placement.weightKg; cellTotal.volumeM3 += placement.volumeM3;
    if (![cellTotal.weightKg, cellTotal.volumeM3].every(Number.isFinite)) fail('Cell placement totals exceed safe arithmetic bounds');
    cellAdds.set(placement.cellId, cellTotal);
  }
  for (const batch of input.expectedBatches) {
    const total = totals.get(batch.batchId);
    if (!total || !Number.isSafeInteger(batch.quantity) || batch.quantity <= 0 || !finitePositive(batch.weightKg) || !finitePositive(batch.volumeM3) ||
      total.quantity !== batch.quantity || !close(total.weightKg, batch.weightKg) || !close(total.volumeM3, batch.volumeM3)) fail(`Batch ${batch.batchId} placement totals do not reconcile`);
  }
  for (const [cellId, added] of cellAdds) {
    const capacity = capacities.get(cellId)!;
    if (![capacity.usedWeightKg, capacity.maxWeightKg, capacity.usedVolumeM3, capacity.maxVolumeM3].every(Number.isFinite) ||
      capacity.usedWeightKg < 0 || capacity.usedVolumeM3 < 0 || capacity.maxWeightKg <= 0 || capacity.maxVolumeM3 <= 0 ||
      !Number.isFinite(capacity.usedWeightKg + added.weightKg) || !Number.isFinite(capacity.usedVolumeM3 + added.volumeM3) ||
      capacity.usedWeightKg + added.weightKg > capacity.maxWeightKg || capacity.usedVolumeM3 + added.volumeM3 > capacity.maxVolumeM3) fail(`Cell ${cellId} capacity is unknown or exceeded`);
  }
  const totalQuantity = input.expectedBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  if (!Number.isSafeInteger(totalQuantity)) fail('Total A2 quantity exceeds safe integer bounds');
  return { totalQuantity, batchCount: expectedIds.length };
}
