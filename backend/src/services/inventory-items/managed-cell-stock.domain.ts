import { Types } from 'mongoose';

export type CapacityStatus = 'EMPTY' | 'PARTIAL' | 'FULL' | 'UNKNOWN';
export type ReconciliationStatus = 'NOT_REQUIRED' | 'RECONCILED' | 'UNKNOWN' | 'MISMATCH' | 'NOT_CONFIGURED';
const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const safeId = (value: unknown) => value instanceof Types.ObjectId ? value.toHexString() : typeof value === 'string' ? value : '';
const round = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;

export function physicalTotals(unitWeightKg: number, unitVolumeM3: number, quantity: number) {
  if (!finiteNonNegative(unitWeightKg) || !finiteNonNegative(unitVolumeM3) || !Number.isSafeInteger(quantity) || quantity < 0) throw Object.assign(new Error('Stock quantity and physical snapshots must be finite and non-negative'), { code: 'INVALID_STOCK_SNAPSHOT' });
  const totalWeightKg = round(unitWeightKg * quantity, 3), totalVolumeM3 = round(unitVolumeM3 * quantity, 6);
  if (!Number.isFinite(totalWeightKg) || !Number.isFinite(totalVolumeM3)) throw Object.assign(new Error('Stock physical totals exceed safe numeric range'), { code: 'INVALID_STOCK_SNAPSHOT' });
  return { totalWeightKg, totalVolumeM3 };
}

export function validateCellStock(row: any) {
  if (!row || !safeId(row.skuId) || !safeId(row.itemSpecId) || !safeId(row.reservationId) || !safeId(row.facilityId) || !safeId(row.customerId) || !safeId(row.cellId) || !String(row.receiptId || '').trim()) throw Object.assign(new Error('Stock ownership and receipt scope are required'), { code: 'INVALID_STOCK_SCOPE' });
  if (!Number.isSafeInteger(row.quantityOnHand) || row.quantityOnHand < 0 || !Number.isSafeInteger(row.quantityHeld) || row.quantityHeld < 0 || row.quantityHeld > row.quantityOnHand || row.quantityAvailable !== row.quantityOnHand - row.quantityHeld) throw Object.assign(new Error('Stock quantities violate on-hand/held/available invariants'), { code: 'INVALID_STOCK_QUANTITY' });
  const dimensions = row.unitDimensionsSnapshot;
  if (![dimensions?.widthM, dimensions?.depthM, dimensions?.heightM, row.unitWeightKgSnapshot, row.unitVolumeM3Snapshot, row.totalWeightKg, row.totalVolumeM3].every(Number.isFinite) || [dimensions?.widthM, dimensions?.depthM, dimensions?.heightM, row.unitWeightKgSnapshot, row.unitVolumeM3Snapshot].some(value => value <= 0)) throw Object.assign(new Error('Immutable physical measurement snapshot is invalid'), { code: 'INVALID_STOCK_SNAPSHOT' });
  const expected = physicalTotals(row.unitWeightKgSnapshot, row.unitVolumeM3Snapshot, row.quantityOnHand);
  if (Math.abs(expected.totalWeightKg - row.totalWeightKg) > 0.001 || Math.abs(expected.totalVolumeM3 - row.totalVolumeM3) > 0.000001) throw Object.assign(new Error('Stock totals do not match receipt snapshots'), { code: 'INVALID_STOCK_SNAPSHOT' });
  return row;
}

export function aggregateCellStock(rows: any[], instances: any[] = []) {
  const result = new Map<string, any>();
  for (const raw of rows) {
    const row = validateCellStock(raw), cellId = safeId(row.cellId), specId = safeId(row.itemSpecId);
    const cell = result.get(cellId) ?? { quantity: 0, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0, itemSpecifications: new Map() };
    const spec = cell.itemSpecifications.get(specId) ?? { quantity: 0, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0 };
    cell.quantity += row.quantityOnHand; cell.quantityOnHand += row.quantityOnHand; cell.quantityHeld += row.quantityHeld; cell.quantityAvailable += row.quantityAvailable;
    cell.weightKg = round(cell.weightKg + row.totalWeightKg, 3); cell.volumeM3 = round(cell.volumeM3 + row.totalVolumeM3, 6);
    spec.quantity += row.quantityOnHand; spec.quantityOnHand += row.quantityOnHand; spec.quantityHeld += row.quantityHeld; spec.quantityAvailable += row.quantityAvailable;
    spec.weightKg = round(spec.weightKg + row.totalWeightKg, 3); spec.volumeM3 = round(spec.volumeM3 + row.totalVolumeM3, 6);
    cell.itemSpecifications.set(specId, spec); result.set(cellId, cell);
  }
  const seenInstances = new Set<string>();
  for (const instance of instances) {
    if (instance?.status === 'REMOVED') continue;
    const instanceId = String(instance?.itemInstanceId || ''), allocations = instance?.allocations;
    if (!instanceId || seenInstances.has(instanceId) || instance.quantity !== 1 || !safeId(instance.skuId) || !safeId(instance.itemSpecId) || !Array.isArray(allocations) || !allocations.length || new Set(allocations.map((row: any) => safeId(row.cellId))).size !== allocations.length) throw Object.assign(new Error('Item Instance identity/footprint is invalid'), { code: 'INVALID_ITEM_INSTANCE' });
    seenInstances.add(instanceId);
    const orderedAllocations = [...allocations].sort((left, right) => safeId(left.cellId).localeCompare(safeId(right.cellId)));
    const sumWeight = round(orderedAllocations.reduce((sum, row) => sum + Number(row.weightKg), 0), 3), sumVolume = round(orderedAllocations.reduce((sum, row) => sum + Number(row.volumeM3), 0), 6);
    if (!finiteNonNegative(instance.unitWeightKgSnapshot) || !finiteNonNegative(instance.unitVolumeM3Snapshot) || Math.abs(sumWeight - instance.unitWeightKgSnapshot) > 0.001 || Math.abs(sumVolume - instance.unitVolumeM3Snapshot) > 0.000001) throw Object.assign(new Error('Item Instance allocation does not conserve physical measurements'), { code: 'INVALID_ITEM_INSTANCE' });
    for (const allocation of orderedAllocations) {
      if (!safeId(allocation.cellId) || !finiteNonNegative(allocation.weightKg) || !finiteNonNegative(allocation.volumeM3)) throw Object.assign(new Error('Item Instance Cell allocation is invalid'), { code: 'INVALID_ITEM_INSTANCE' });
      const cellId = safeId(allocation.cellId), specId = safeId(instance.itemSpecId), cell = result.get(cellId) ?? { quantity: 0, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0, itemSpecifications: new Map() };
      const spec = cell.itemSpecifications.get(specId) ?? { quantity: 0, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0 };
      // The indivisible instance counts once overall, at a stable primary Cell; physical loads are apportioned per Cell.
      if (allocation === orderedAllocations[0]) { cell.quantity += 1; cell.quantityOnHand += 1; cell.quantityAvailable += 1; spec.quantity += 1; spec.quantityOnHand += 1; spec.quantityAvailable += 1; }
      cell.weightKg = round(cell.weightKg + allocation.weightKg, 3); cell.volumeM3 = round(cell.volumeM3 + allocation.volumeM3, 6);
      spec.weightKg = round(spec.weightKg + allocation.weightKg, 3); spec.volumeM3 = round(spec.volumeM3 + allocation.volumeM3, 6);
      cell.itemSpecifications.set(specId, spec); result.set(cellId, cell);
    }
  }
  return result;
}

export function calculateCapacity(input: { maxWeightKg: unknown; maxVolumeM3: unknown; usedWeightKg: unknown; usedVolumeM3: unknown }) {
  const { maxWeightKg, maxVolumeM3, usedWeightKg, usedVolumeM3 } = input;
  if (![maxWeightKg, maxVolumeM3].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) || ![usedWeightKg, usedVolumeM3].every(finiteNonNegative)) throw Object.assign(new Error('Capacity or usage evidence is missing or invalid'), { code: 'CAPACITY_NOT_CONFIGURED' });
  const remainingWeightKg = round((maxWeightKg as number) - (usedWeightKg as number), 3), remainingVolumeM3 = round((maxVolumeM3 as number) - (usedVolumeM3 as number), 6);
  if (remainingWeightKg < -0.001 || remainingVolumeM3 < -0.000001) throw Object.assign(new Error('Recorded usage exceeds configured capacity'), { code: 'CAPACITY_MISMATCH' });
  const weightUsagePercent = (usedWeightKg as number) / (maxWeightKg as number) * 100, volumeUsagePercent = (usedVolumeM3 as number) / (maxVolumeM3 as number) * 100;
  if (![weightUsagePercent, volumeUsagePercent].every(Number.isFinite)) throw Object.assign(new Error('Capacity utilization is not finite'), { code: 'CAPACITY_MISMATCH' });
  return { maxWeightKg, maxVolumeM3, usedWeightKg, usedVolumeM3, remainingWeightKg: Math.max(0, remainingWeightKg), remainingVolumeM3: Math.max(0, remainingVolumeM3), weightUsagePercent, volumeUsagePercent,
    status: (usedWeightKg === 0 && usedVolumeM3 === 0 ? 'EMPTY' : remainingWeightKg <= 0.001 || remainingVolumeM3 <= 0.000001 ? 'FULL' : 'PARTIAL') as 'EMPTY' | 'FULL' | 'PARTIAL' };
}

export function assertCapacityFits(input: { cell: { maxWeightKg: unknown; maxVolumeM3: unknown; usedWeightKg: unknown; usedVolumeM3: unknown };
  level: { maxWeightKg: unknown; maxVolumeM3?: unknown; usedWeightKg: unknown; usedVolumeM3?: unknown };
  reservation: { maxVolumeM3: unknown; usedVolumeM3: unknown };
  addition: { weightKg: unknown; volumeM3: unknown };
  expectedRevision: unknown; currentRevision: unknown }) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== input.currentRevision) throw Object.assign(new Error('Capacity changed; refresh before retrying'), { status: 409, code: 'CAPACITY_REVISION_CONFLICT' });
  const addition = input.addition;
  if (!finiteNonNegative(addition?.weightKg) || !finiteNonNegative(addition?.volumeM3)) throw Object.assign(new Error('Stock addition measurements are invalid'), { code: 'INVALID_STOCK_SNAPSHOT' });
  const cell = calculateCapacity(input.cell), levelWeight = input.level, reservation = input.reservation;
  if (![levelWeight.maxWeightKg, levelWeight.usedWeightKg, reservation.maxVolumeM3, reservation.usedVolumeM3].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) ||
    Number(levelWeight.maxWeightKg) <= 0 || Number(reservation.maxVolumeM3) <= 0) throw Object.assign(new Error('Level or Reservation capacity is not configured'), { code: 'CAPACITY_NOT_CONFIGURED' });
  const levelUsedWeightKg = round(Number(levelWeight.usedWeightKg) + addition.weightKg, 3);
  const reservationUsedVolumeM3 = round(Number(reservation.usedVolumeM3) + addition.volumeM3, 6);
  if (Number(input.cell.usedWeightKg) + addition.weightKg > Number(input.cell.maxWeightKg) + 0.001 || Number(input.cell.usedVolumeM3) + addition.volumeM3 > Number(input.cell.maxVolumeM3) + 0.000001) throw Object.assign(new Error('Addition exceeds Cell capacity'), { code: 'CELL_CAPACITY_EXCEEDED' });
  if (levelUsedWeightKg > Number(levelWeight.maxWeightKg) + 0.001 || (levelWeight.maxVolumeM3 !== undefined && (!finiteNonNegative(levelWeight.maxVolumeM3) || Number(levelWeight.usedVolumeM3) + addition.volumeM3 > Number(levelWeight.maxVolumeM3) + 0.000001))) throw Object.assign(new Error('Addition exceeds Level capacity'), { code: 'LEVEL_CAPACITY_EXCEEDED' });
  if (reservationUsedVolumeM3 > Number(reservation.maxVolumeM3) + 0.000001) throw Object.assign(new Error('Addition exceeds Reservation allocated capacity'), { code: 'RESERVATION_CAPACITY_EXCEEDED' });
  return { cell: { usedWeightKg: round(Number(input.cell.usedWeightKg) + addition.weightKg, 3), usedVolumeM3: round(Number(input.cell.usedVolumeM3) + addition.volumeM3, 6) },
    level: { usedWeightKg: levelUsedWeightKg, ...(levelWeight.usedVolumeM3 !== undefined ? { usedVolumeM3: round(Number(levelWeight.usedVolumeM3) + addition.volumeM3, 6) } : {}) },
    reservation: { usedVolumeM3: reservationUsedVolumeM3 }, nextRevision: Number(input.currentRevision) + 1 };
}

export function reconcileCell(input: { hasMovementHistory: boolean; stockQuantity: number; projectedWeightKg: number; projectedVolumeM3: number; counterWeightKg: unknown; counterVolumeM3: unknown; sourceComplete: boolean }): { status: ReconciliationStatus; reasonCode: string | null } {
  if (!finiteNonNegative(input.counterWeightKg) || !finiteNonNegative(input.counterVolumeM3)) return { status: 'NOT_CONFIGURED', reasonCode: 'PHYSICAL_COUNTERS_MISSING' };
  if (!Number.isSafeInteger(input.stockQuantity) || input.stockQuantity < 0 || !finiteNonNegative(input.projectedWeightKg) || !finiteNonNegative(input.projectedVolumeM3)) return { status: 'UNKNOWN', reasonCode: 'STOCK_PROJECTION_INVALID' };
  if (!input.hasMovementHistory && input.stockQuantity === 0 && input.counterWeightKg === 0 && input.counterVolumeM3 === 0) return { status: 'NOT_REQUIRED', reasonCode: 'NO_STOCK_HISTORY' };
  if (!input.sourceComplete) return { status: 'UNKNOWN', reasonCode: 'AUTHORITATIVE_SOURCES_INCOMPLETE' };
  if (Math.abs(input.projectedWeightKg - input.counterWeightKg) > 0.001 || Math.abs(input.projectedVolumeM3 - input.counterVolumeM3) > 0.000001) return { status: 'MISMATCH', reasonCode: 'LEDGER_PROJECTION_COUNTER_MISMATCH' };
  return { status: 'RECONCILED', reasonCode: null };
}

/** Every physical placement must be backed by an allocation for that exact Reservation and Cell. */
export function placementsHaveCellAllocations(placements: any[], allocations: any[]) {
  return placements.every(placement => allocations.some(allocation =>
    safeId(allocation.reservationId) === safeId(placement.reservationId) &&
    safeId(allocation.cellId) === safeId(placement.cellId) &&
    allocation.status === 'OCCUPIED'));
}

const movementFail = (code: string, message: string, details?: Record<string, unknown>): never => { throw Object.assign(new Error(message), { code, details }); };
const movementLineKey = (line: any, movement?: any) => `${safeId(line.reservationId ?? movement?.managedReservationId)}:${safeId(line.itemSpecId)}:${line.receiptId}:${safeId(line.cellId)}`;
function sameSnapshot(left: any, right: any) {
  return left.unitWeightKgSnapshot === right.unitWeightKgSnapshot && left.unitVolumeM3Snapshot === right.unitVolumeM3Snapshot &&
    left.unitDimensionsSnapshot?.widthM === right.unitDimensionsSnapshot?.widthM && left.unitDimensionsSnapshot?.depthM === right.unitDimensionsSnapshot?.depthM && left.unitDimensionsSnapshot?.heightM === right.unitDimensionsSnapshot?.heightM &&
    (left.quantityUnitSnapshot == null || right.quantityUnitSnapshot == null || left.quantityUnitSnapshot === right.quantityUnitSnapshot);
}
function linePhysical(line: any, qty: number) { return physicalTotals(line.unitWeightKgSnapshot, line.unitVolumeM3Snapshot, qty); }
function checkEffectLine(line: any, movement: any) {
  if (!safeId(line.itemSpecId) || !safeId(line.cellId) || !String(line.receiptId || '').trim() ||
    !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !finiteNonNegative(line.unitWeightKgSnapshot) || line.unitWeightKgSnapshot <= 0 ||
    !finiteNonNegative(line.unitVolumeM3Snapshot) || line.unitVolumeM3Snapshot <= 0 || !finiteNonNegative(line.allocatedWeightKg) || !finiteNonNegative(line.allocatedVolumeM3)) movementFail('INVALID_STOCK_MOVEMENT', 'Movement line identity, quantity, or snapshot is invalid');
  const dims = line.unitDimensionsSnapshot, volume = dims && dims.widthM * dims.depthM * dims.heightM;
  if (![dims?.widthM, dims?.depthM, dims?.heightM, volume].every(value => Number.isFinite(value) && value > 0) || Math.abs(round(volume, 6) - line.unitVolumeM3Snapshot) > 0.000001) movementFail('INVALID_STOCK_MOVEMENT', 'Movement dimensions differ from immutable receipt volume snapshot');
  if (line.itemInstanceId) {
    if (line.quantity !== 1 || line.allocatedWeightKg > line.unitWeightKgSnapshot + 0.001 || line.allocatedVolumeM3 > line.unitVolumeM3Snapshot + 0.000001) movementFail('INVALID_ITEM_INSTANCE_MOVEMENT', 'An indivisible item allocation must remain a quantity-one load share');
  } else {
    const expected = linePhysical(line, line.quantity);
    if (Math.abs(expected.totalWeightKg - line.allocatedWeightKg) > 0.001 || Math.abs(expected.totalVolumeM3 - line.allocatedVolumeM3) > 0.000001) movementFail('INVALID_STOCK_MOVEMENT', 'Batch physical totals do not match its receipt snapshot');
  }
}
function sameAllocationSet(current: any[], requested: any[]) {
  if (current.length !== requested.length) return false;
  const rows = new Map(current.map(row => [safeId(row.cellId), row]));
  return requested.every(row => { const old = rows.get(safeId(row.cellId)); return old && old.allocatedWeightKg === row.allocatedWeightKg && old.allocatedVolumeM3 === row.allocatedVolumeM3; });
}

/** Deterministic, read-only replay for additive ItemMovement schema v4 events. */
export function replayManagedStockMovements(movements: any[]) {
  if (!Array.isArray(movements)) movementFail('STOCK_LEDGER_UNKNOWN', 'Movement history is not an array');
  // ledgerRevision is the authoritative per-SKU commit order. performedAt is
  // audit metadata and can tie or drift across processes/retries, so it must
  // not decide whether an otherwise valid immutable ledger can be replayed.
  const events = [...movements].sort((a, b) => Number(a?.stockEffect?.ledgerRevision) - Number(b?.stockEffect?.ledgerRevision) ||
    safeId(a?._id).localeCompare(safeId(b?._id)));
  const lots = new Map<string, any>(), instances = new Map<string, any>(), usedOperations = new Set<string>();
  let ledgerRevision = 0;
  for (const movement of events) {
    const effect = movement?.stockEffect;
    if (movement?.schemaVersion !== 4) movementFail('STOCK_LEDGER_VERSION_INVALID', 'Movement schema version is unsupported');
    if (!effect) movementFail('STOCK_LEDGER_EFFECT_MISSING', 'Movement stock effect is missing');
    if (!Number.isSafeInteger(effect.ledgerRevision)) movementFail('STOCK_LEDGER_REVISION_INVALID', 'Movement ledger revision is missing or invalid');
    if (effect.ledgerRevision !== ledgerRevision + 1) movementFail('STOCK_LEDGER_REVISION_GAP', 'Movement ledger revisions are not sequential',
      { expectedRevision: ledgerRevision + 1, actualRevision: effect.ledgerRevision });
    if (typeof effect.operationId !== 'string' || !effect.operationId.trim()) movementFail('STOCK_LEDGER_OPERATION_ID_MISSING', 'Movement operation identity is missing');
    if (usedOperations.has(effect.operationId)) movementFail('STOCK_LEDGER_OPERATION_ID_DUPLICATE', 'Movement operation identity is duplicated');
    usedOperations.add(effect.operationId);
    const action = effect.action, source = effect.source ?? [], destination = effect.destination ?? [];
    const eventLines = action === 'ADD' ? destination : source;
    if ((action === 'ADD' && (source.length || !destination.length)) || (action === 'REMOVE' && (!source.length || destination.length)) || (action === 'MOVE' && (!source.length || !destination.length)) || !['ADD', 'REMOVE', 'MOVE'].includes(action)) movementFail('INVALID_STOCK_MOVEMENT', 'Movement source/destination shape is invalid');
    for (const line of [...source, ...destination]) checkEffectLine(line, movement);
    const quantity = eventLines.filter((line: any) => !line.itemInstanceId).reduce((sum: number, line: any) => sum + line.quantity, 0) + new Set(eventLines.filter((line: any) => line.itemInstanceId).map((line: any) => line.itemInstanceId)).size;
    if (!Number.isSafeInteger(quantity) || quantity !== movement.quantity) movementFail('INVALID_STOCK_MOVEMENT', 'Movement quantity does not match its stock effect lines');
    const totalWeight = round(eventLines.reduce((sum: number, line: any) => sum + line.allocatedWeightKg, 0), 3), totalVolume = round(eventLines.reduce((sum: number, line: any) => sum + line.allocatedVolumeM3, 0), 6);
    if (Math.abs(totalWeight - movement.actualTotalWeightKg) > 0.001 || Math.abs(totalVolume - movement.actualTotalVolumeM3) > 0.000001) movementFail('INVALID_STOCK_MOVEMENT', 'Movement totals do not conserve the physical stock effect');

    const instanceGroups = (lines: any[]) => { const groups = new Map<string, any[]>(); for (const line of lines) if (line.itemInstanceId) groups.set(line.itemInstanceId, [...(groups.get(line.itemInstanceId) ?? []), line]); return groups; };
    const sourceInstances = instanceGroups(source), destInstances = instanceGroups(destination);
    const validateInstance = (group: any[]) => {
      const first = group[0], weight = round(group.reduce((sum, line) => sum + line.allocatedWeightKg, 0), 3), volume = round(group.reduce((sum, line) => sum + line.allocatedVolumeM3, 0), 6);
      if (new Set(group.map(line => safeId(line.cellId))).size !== group.length || group.some(line => !sameSnapshot(first, line)) || Math.abs(weight - first.unitWeightKgSnapshot) > 0.001 || Math.abs(volume - first.unitVolumeM3Snapshot) > 0.000001) movementFail('INVALID_ITEM_INSTANCE_MOVEMENT', 'Item Instance Cell loads do not conserve one physical unit');
    };
    for (const group of [...sourceInstances.values(), ...destInstances.values()]) validateInstance(group);
    if (action === 'MOVE') {
      const sourceReservationIds = new Set(source.map((line: any) => safeId(line.reservationId ?? movement.managedReservationId)));
      const destinationReservationIds = new Set(destination.map((line: any) => safeId(line.reservationId ?? movement.managedReservationId)));
      if (sourceReservationIds.size !== 1 || destinationReservationIds.size !== 1) movementFail('INVALID_STOCK_MOVEMENT', 'MOVE must use one source and one destination Reservation scope');
      const stockQuantity = (rows: any[]) => rows.filter(row => !row.itemInstanceId).reduce((sum, row) => sum + row.quantity, 0) + new Set(rows.filter(row => row.itemInstanceId).map(row => row.itemInstanceId)).size;
      if (stockQuantity(source) !== stockQuantity(destination) || [...sourceInstances.keys()].sort().join('|') !== [...destInstances.keys()].sort().join('|')) movementFail('NON_CONSERVING_MOVE', 'Move must preserve receipt quantities and complete Item Instance identity');
      const batchRefs = (rows: any[]) => { const totals = new Map<string, number>(); for (const row of rows) if (!row.itemInstanceId) { const key = `${safeId(row.itemSpecId)}|${row.receiptId}`; totals.set(key, (totals.get(key) ?? 0) + row.quantity); } return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, qty]) => `${key}:${qty}`).join('|'); };
      const sourceBatchRefs = batchRefs(source), destinationBatchRefs = batchRefs(destination);
      if (sourceBatchRefs !== destinationBatchRefs) movementFail('NON_CONSERVING_MOVE', 'Move must preserve source receipt lineage');
    }

    if (action === 'ADD') {
      for (const [instanceId, group] of destInstances) {
        if (instances.has(instanceId)) movementFail('DUPLICATE_ITEM_INSTANCE', 'Item Instance already exists in canonical history');
        const first = group[0]; instances.set(instanceId, { itemInstanceId: instanceId, skuId: movement.itemId, itemSpecId: first.itemSpecId, reservationId: first.reservationId ?? movement.managedReservationId, facilityId: movement.facilityId, customerId: movement.customerId, sourceReceiptId: first.receiptId, quantity: 1, unitWeightKgSnapshot: first.unitWeightKgSnapshot, unitVolumeM3Snapshot: first.unitVolumeM3Snapshot, unitDimensionsSnapshot: first.unitDimensionsSnapshot, allocations: group.map(line => ({ cellId: line.cellId, weightKg: line.allocatedWeightKg, volumeM3: line.allocatedVolumeM3 })), status: 'PLACED' });
      }
      for (const line of destination.filter((row: any) => !row.itemInstanceId)) {
        const key = movementLineKey(line, movement); if (lots.has(key)) movementFail('DUPLICATE_RECEIPT_ALLOCATION', 'Receipt already has stock in this Cell');
        lots.set(key, { skuId: movement.itemId, itemSpecId: line.itemSpecId, reservationId: line.reservationId ?? movement.managedReservationId, facilityId: movement.facilityId, customerId: movement.customerId, cellId: line.cellId, receiptId: line.receiptId, quantityUnitSnapshot: line.quantityUnitSnapshot, quantityOnHand: line.quantity, quantityHeld: 0, quantityAvailable: line.quantity, unitWeightKgSnapshot: line.unitWeightKgSnapshot, unitVolumeM3Snapshot: line.unitVolumeM3Snapshot, unitDimensionsSnapshot: line.unitDimensionsSnapshot, ...linePhysical(line, line.quantity), ledgerRevision: effect.ledgerRevision, revision: 0 });
      }
    } else if (action === 'REMOVE' || action === 'MOVE') {
      for (const [instanceId, group] of sourceInstances) {
        const current = instances.get(instanceId); if (!current || current.status !== 'PLACED') movementFail('ITEM_INSTANCE_NOT_AVAILABLE', 'Whole Item Instance does not exist or is not placed');
        if (group.some((line: any) => safeId(line.reservationId ?? movement.managedReservationId) !== safeId(current.reservationId))) movementFail('ITEM_INSTANCE_SOURCE_MISMATCH', 'Whole Item Instance Reservation scope changed');
        if (!sameAllocationSet(current.allocations, group)) movementFail('ITEM_INSTANCE_SOURCE_MISMATCH', 'Whole Item Instance source allocation changed');
        if (action === 'REMOVE') instances.set(instanceId, { ...current, status: 'REMOVED', allocations: [] });
        else {
          const destinationGroup = destInstances.get(instanceId); if (!destinationGroup) movementFail('ITEM_INSTANCE_DESTINATION_MISSING', 'Whole Item Instance destination allocation is missing');
          const destinationReservationIds = new Set(destinationGroup!.map(line => safeId(line.reservationId ?? movement.managedReservationId)));
          if (destinationReservationIds.size !== 1) movementFail('INVALID_ITEM_INSTANCE_MOVEMENT', 'One Physical Instance cannot belong to multiple Reservations after a MOVE');
          instances.set(instanceId, { ...current, reservationId: destinationGroup![0].reservationId ?? movement.managedReservationId,
            allocations: destinationGroup!.map(line => ({ cellId: line.cellId, weightKg: line.allocatedWeightKg, volumeM3: line.allocatedVolumeM3 })) });
        }
      }
      for (const line of source.filter((row: any) => !row.itemInstanceId)) {
        const key = movementLineKey(line, movement), current = lots.get(key); if (!current || line.quantity > current.quantityAvailable || !sameSnapshot(current, line)) movementFail('INSUFFICIENT_CELL_STOCK', 'Removal source does not match available receipt stock');
        const remaining = current.quantityOnHand - line.quantity;
        if (!remaining) lots.delete(key); else lots.set(key, { ...current, quantityOnHand: remaining, quantityAvailable: remaining - current.quantityHeld, ...linePhysical(line, remaining), ledgerRevision: effect.ledgerRevision, revision: current.revision + 1 });
      }
      if (action === 'MOVE') {
        for (const line of destination.filter((row: any) => !row.itemInstanceId)) {
          const key = movementLineKey(line, movement), existing = lots.get(key);
          if (existing && !sameSnapshot(existing, line)) movementFail('RECEIPT_SNAPSHOT_CONFLICT', 'A receipt cannot merge incompatible physical snapshots');
          const quantityOnHand = (existing?.quantityOnHand ?? 0) + line.quantity, totals = linePhysical(line, quantityOnHand);
          lots.set(key, { skuId: movement.itemId, itemSpecId: line.itemSpecId, reservationId: line.reservationId ?? movement.managedReservationId, facilityId: movement.facilityId, customerId: movement.customerId, cellId: line.cellId, receiptId: line.receiptId, quantityUnitSnapshot: line.quantityUnitSnapshot ?? existing?.quantityUnitSnapshot, quantityOnHand, quantityHeld: existing?.quantityHeld ?? 0, quantityAvailable: quantityOnHand - (existing?.quantityHeld ?? 0), unitWeightKgSnapshot: line.unitWeightKgSnapshot, unitVolumeM3Snapshot: line.unitVolumeM3Snapshot, unitDimensionsSnapshot: line.unitDimensionsSnapshot, ...totals, ledgerRevision: effect.ledgerRevision, revision: (existing?.revision ?? -1) + 1 });
        }
      }
    }
    if (action === 'MOVE') {
      const sourceWeight = round(source.reduce((sum: number, row: any) => sum + row.allocatedWeightKg, 0), 3), destWeight = round(destination.reduce((sum: number, row: any) => sum + row.allocatedWeightKg, 0), 3);
      const sourceVolume = round(source.reduce((sum: number, row: any) => sum + row.allocatedVolumeM3, 0), 6), destVolume = round(destination.reduce((sum: number, row: any) => sum + row.allocatedVolumeM3, 0), 6);
      if (Math.abs(sourceWeight - destWeight) > 0.001 || Math.abs(sourceVolume - destVolume) > 0.000001) movementFail('NON_CONSERVING_MOVE', 'Move source and destination totals differ');
    }
    ledgerRevision = effect.ledgerRevision;
  }
  return { ledgerRevision, lots: [...lots.values()].sort((a, b) => safeId(a.itemSpecId).localeCompare(safeId(b.itemSpecId)) || String(a.receiptId).localeCompare(String(b.receiptId)) || safeId(a.cellId).localeCompare(safeId(b.cellId))),
    instances: [...instances.values()].sort((a, b) => String(a.itemInstanceId).localeCompare(String(b.itemInstanceId))) };
}

/** Facility diagnostics must replay each SKU independently because revisions are SKU-scoped. */
export function replayManagedStockMovementsBySku(movements: any[]) {
  if (!Array.isArray(movements)) movementFail('STOCK_LEDGER_UNKNOWN', 'Movement history is not an array');
  const bySku = new Map<string, any[]>();
  for (const movement of movements) {
    const skuId = safeId(movement?.itemId);
    if (!skuId) movementFail('STOCK_LEDGER_SKU_SCOPE_MISSING', 'Movement SKU scope is missing');
    bySku.set(skuId, [...(bySku.get(skuId) ?? []), movement]);
  }
  const replays = [...bySku.values()].map(replayManagedStockMovements);
  return { lots: replays.flatMap(row => row.lots), instances: replays.flatMap(row => row.instances) };
}

/** Returns the next contiguous revision for one SKU; never silently restarts after a gap. */
export function nextManagedStockLedgerRevision(movements: any[], skuId: unknown) {
  if (!Array.isArray(movements)) movementFail('STOCK_LEDGER_UNKNOWN', 'Movement history is not an array');
  const targetSkuId = safeId(skuId);
  if (!targetSkuId) movementFail('STOCK_LEDGER_SKU_SCOPE_MISSING', 'Movement SKU scope is missing');
  const skuMovements = movements.filter(movement => safeId(movement?.itemId) === targetSkuId)
    .sort((left, right) => Number(left?.stockEffect?.ledgerRevision) - Number(right?.stockEffect?.ledgerRevision) ||
      safeId(left?._id).localeCompare(safeId(right?._id)));
  let expectedRevision = 1;
  for (const movement of skuMovements) {
    const effect = movement?.stockEffect;
    if (movement?.schemaVersion !== 4 || !effect) movementFail('STOCK_LEDGER_VERSION_INVALID', 'Movement is not a canonical schema-v4 event');
    if (!Number.isSafeInteger(effect.ledgerRevision)) movementFail('STOCK_LEDGER_REVISION_INVALID', 'Movement ledger revision is missing or invalid');
    if (effect.ledgerRevision !== expectedRevision) movementFail('STOCK_LEDGER_REVISION_GAP', 'Movement ledger revisions are not sequential',
      { expectedRevision, actualRevision: effect.ledgerRevision });
    expectedRevision += 1;
  }
  return expectedRevision;
}
