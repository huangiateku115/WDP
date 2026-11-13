import { createHash } from 'node:crypto';

type Row = Record<string, any>;
const id = (value: unknown) => value == null ? '' : String(value);
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const close = (a: number, b: number, tolerance: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const canonicalRound = (value: number, places: number) => Math.round((value + Number.EPSILON) * (10 ** places)) / (10 ** places);
const precisionUnits = (value: number, places: 3 | 6) => {
  const scale = 10 ** places, units = Math.round((value + Number.EPSILON) * scale);
  if (!Number.isSafeInteger(units) || units < 0 || Math.abs(value - units / scale) > 1e-9) invalid('ARITHMETIC_OVERFLOW', 'Placement amount is outside canonical precision');
  return units;
};
const allocatePrecisionUnits = (total: number, totalQuantity: number, requestedQuantity: number) => {
  if (requestedQuantity === totalQuantity) return total;
  const product = total * requestedQuantity;
  if (!Number.isSafeInteger(product)) invalid('ARITHMETIC_OVERFLOW', 'Partial removal exceeds safe arithmetic range');
  return Math.floor((product + Math.floor(totalQuantity / 2)) / totalQuantity);
};
export function canonicalA2RemovalAmounts(current: { quantity: number; weightKg: number; volumeM3: number }, quantity: number) {
  if (!Number.isSafeInteger(current.quantity) || current.quantity < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > current.quantity) {
    invalid('INVALID_REMOVE_QUANTITY', 'Partial REMOVE quantity must be positive and no greater than active placement quantity');
  }
  const weightUnits = precisionUnits(current.weightKg, 3), volumeUnits = precisionUnits(current.volumeM3, 6);
  const removedWeightUnits = allocatePrecisionUnits(weightUnits, current.quantity, quantity);
  const removedVolumeUnits = allocatePrecisionUnits(volumeUnits, current.quantity, quantity);
  return { removedWeightKg: removedWeightUnits / 1000, removedVolumeM3: removedVolumeUnits / 1_000_000,
    remainingQuantity: current.quantity - quantity, remainingWeightKg: (weightUnits - removedWeightUnits) / 1000,
    remainingVolumeM3: (volumeUnits - removedVolumeUnits) / 1_000_000 };
}
const keyFor = (line: Row, kind: string) => kind === 'A1_PHYSICAL_UNIT' ? `U:${id(line.physicalUnitId)}:${id(line.cellId)}` : `B:${line.batchId}:${id(line.cellId)}`;
const projectionLine = (line: Row) => {
  const result: Row = { ...line, cellId: id(line.cellId), topologyCertificationId: line.topologyCertificationId ? id(line.topologyCertificationId) : undefined,
    heldQuantity: line.heldQuantity ?? 0 };
  for (const key of ['physicalUnitId', 'receiptMovementId', 'sourceMovementId']) {
    if (line[key] != null) result[key] = id(line[key]); else delete result[key];
  }
  if (result.topologyCertificationId === undefined) delete result.topologyCertificationId;
  return result;
};

export class ManagedV3LedgerError extends Error { constructor(public code: string, message: string) { super(message); } }
function invalid(code: string, message: string): never { throw new ManagedV3LedgerError(code, message); }

/** Deterministically folds only schema-v3 effects. It never maps multi-Cell stock to currentCellId. */
export function replayManagedInventoryV3(item: Row, input: Row[]) {
  if (!item?._id || !Array.isArray(input)) invalid('INVALID_LEDGER', 'V3 SKU and movement history are required');
  const movements = [...input].sort((a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime() || id(a._id).localeCompare(id(b._id)));
  const placements = new Map<string, Row>();
  const unitCells = new Map<string, Set<string>>();
  const operations = new Set<string>(); let ledgerRevision = 0, lastMovementId: unknown = null;
  for (const movement of movements) {
    const effect = movement.v3Effect;
    if (movement.schemaVersion !== 3 || !effect || id(movement.itemId) !== id(item._id) ||
      id(movement.customerId) !== id(item.customerId) || id(movement.managedReservationId) !== id(item.managedReservationId) ||
      id(movement.facilityId) !== id(item.facilityId)) invalid('OWNERSHIP_MISMATCH', 'Movement scope differs from V3 SKU');
    if (!effect.operationId || operations.has(effect.operationId)) invalid('DUPLICATE_OPERATION', 'V3 ledger contains a duplicate operation');
    if (effect.ledgerRevision !== ledgerRevision + 1) invalid('REVISION_MISMATCH', 'V3 ledger revision is not contiguous');
    operations.add(effect.operationId);
    const source: Row[] = (effect.source ?? []).map(projectionLine), destination: Row[] = (effect.destination ?? []).map(projectionLine);
    const movementLines = effect.action === 'ADD' ? destination : source;
    if (!movementLines.length || [...source, ...destination].some(line => !line.cellId ||
      !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !line.quantityUnit || !finite(line.weightKg) || line.weightKg <= 0 || !finite(line.volumeM3) || line.volumeM3 <= 0)) {
      invalid('INVALID_PLACEMENT', 'V3 movement contains an invalid placement line');
    }
    const qty = effect.itemKind === 'A1_PHYSICAL_UNIT' ? new Set(movementLines.map(line => id(line.physicalUnitId))).size
      : movementLines.reduce((n, line) => n + line.quantity, 0);
    const weight = movementLines.reduce((n, line) => n + line.weightKg, 0), volume = movementLines.reduce((n, line) => n + line.volumeM3, 0);
    if (!Number.isSafeInteger(qty) || qty !== movement.quantity || !close(weight, movement.actualTotalWeightKg, 0.001) || !close(volume, movement.actualTotalVolumeM3, 0.000001)) {
      invalid('CONSERVATION_MISMATCH', 'Movement quantity, weight or volume does not reconcile to its placement effects');
    }
    const keys = movementLines.map(line => keyFor(line, effect.itemKind));
    if (new Set(keys).size !== keys.length) invalid('DUPLICATE_PLACEMENT', 'Movement has duplicate placement keys');
    if (effect.action === 'ADD') {
      if (effect.itemKind === 'A1_PHYSICAL_UNIT' && destination.some(line => (unitCells.get(id(line.physicalUnitId))?.size ?? 0) > 0)) {
        invalid('PHYSICAL_UNIT_ALREADY_PLACED', 'ADD cannot place an already active PhysicalUnit again');
      }
      for (let i = 0; i < destination.length; i++) {
        const line = destination[i]!, key = keys[i]!;
        if (placements.has(key)) invalid('PLACEMENT_ALREADY_ACTIVE', 'ADD would duplicate an active placement');
        placements.set(key, { ...line, itemKind: effect.itemKind,
          ...(effect.itemKind === 'A2_BATCH' ? { receiptMovementId: id(movement._id), receivedAt: movement.performedAt } :
            { sourceMovementId: id(movement._id), receivedAt: movement.performedAt }) });
        if (effect.itemKind === 'A1_PHYSICAL_UNIT') {
          const unitId = id(line.physicalUnitId), cells = unitCells.get(unitId) ?? new Set<string>(); cells.add(line.cellId); unitCells.set(unitId, cells);
        }
      }
    } else {
      const sourceLineage = new Map<string, Row>();
      if (effect.itemKind === 'A1_PHYSICAL_UNIT') {
        const sourceByUnit = new Map<string, Set<string>>();
        for (const line of source) { const cells = sourceByUnit.get(id(line.physicalUnitId)) ?? new Set<string>(); cells.add(line.cellId); sourceByUnit.set(id(line.physicalUnitId), cells); }
        for (const [unitId, sourceCells] of sourceByUnit) {
          const activeCells = unitCells.get(unitId) ?? new Set<string>();
          if (sourceCells.size !== activeCells.size || [...activeCells].some(cellId => !sourceCells.has(cellId))) invalid('INCOMPLETE_PHYSICAL_UNIT_FOOTPRINT', 'REMOVE/MOVE must include the complete active PhysicalUnit footprint');
        }
      }
      for (let i = 0; i < source.length; i++) {
        const line = source[i]!, current = placements.get(keys[i]!);
        const partialA2Remove = effect.action === 'REMOVE' && effect.itemKind === 'A2_BATCH';
        if (!current || (partialA2Remove ? line.quantity > current.quantity : current.quantity !== line.quantity) ||
            (effect.itemKind === 'A2_BATCH' && (!current.receiptMovementId ||
              (line.receiptMovementId != null && id(line.receiptMovementId) !== id(current.receiptMovementId)))) ||
            !Number.isSafeInteger(current.quantity)) {
          invalid('SOURCE_PLACEMENT_MISMATCH', 'REMOVE/MOVE source does not match active stock placement');
        }
        const weightUnits = precisionUnits(current.weightKg, 3), volumeUnits = precisionUnits(current.volumeM3, 6);
        const removedWeightUnits = partialA2Remove ? allocatePrecisionUnits(weightUnits, current.quantity, line.quantity) : weightUnits;
        const removedVolumeUnits = partialA2Remove ? allocatePrecisionUnits(volumeUnits, current.quantity, line.quantity) : volumeUnits;
        if (precisionUnits(line.weightKg, 3) !== removedWeightUnits || precisionUnits(line.volumeM3, 6) !== removedVolumeUnits) {
          invalid('CONSERVATION_MISMATCH', 'REMOVE physical amounts do not follow the canonical per-placement rounding rule');
        }
        if (partialA2Remove && line.quantity < current.quantity) {
          const remainingQuantity = current.quantity - line.quantity;
          const remainingWeightUnits = weightUnits - removedWeightUnits, remainingVolumeUnits = volumeUnits - removedVolumeUnits;
          if (remainingQuantity < 1 || remainingWeightUnits < 0 || remainingVolumeUnits < 0) invalid('NEGATIVE_STOCK', 'Partial REMOVE would create negative placement stock');
          placements.set(keys[i]!, { ...current, quantity: remainingQuantity, weightKg: remainingWeightUnits / 1000, volumeM3: remainingVolumeUnits / 1_000_000 });
        } else placements.delete(keys[i]!);
        if (effect.action === 'MOVE') sourceLineage.set(effect.itemKind === 'A1_PHYSICAL_UNIT' ? id(line.physicalUnitId) : String(line.batchId), current);
        if (effect.itemKind === 'A1_PHYSICAL_UNIT') unitCells.get(id(line.physicalUnitId))?.delete(line.cellId);
      }
      if (effect.action === 'MOVE') for (const line of destination) {
        const key = keyFor(line, effect.itemKind);
        if (placements.has(key)) invalid('PLACEMENT_ALREADY_ACTIVE', 'MOVE destination already has an active placement');
        const lineage = sourceLineage.get(effect.itemKind === 'A1_PHYSICAL_UNIT' ? id(line.physicalUnitId) : String(line.batchId));
        placements.set(key, { ...line, itemKind: effect.itemKind,
          ...(effect.itemKind === 'A2_BATCH' ? { receiptMovementId: lineage?.receiptMovementId, receivedAt: lineage?.receivedAt } :
            { sourceMovementId: lineage?.sourceMovementId, receivedAt: lineage?.receivedAt }) });
        if (effect.itemKind === 'A1_PHYSICAL_UNIT') { const unitId = id(line.physicalUnitId), cells = unitCells.get(unitId) ?? new Set<string>(); cells.add(line.cellId); unitCells.set(unitId, cells); }
      }
    }
    if (effect.action === 'MOVE') {
      const sourceIndex = (lines: Row[]) => {
        const grouped = new Map<string, { quantity: number; weightKg: number; volumeM3: number }>();
        for (const line of lines) { const key = effect.itemKind === 'A1_PHYSICAL_UNIT' ? id(line.physicalUnitId) : line.batchId;
          const value = grouped.get(key) ?? { quantity: 0, weightKg: 0, volumeM3: 0 };
          value.quantity += effect.itemKind === 'A1_PHYSICAL_UNIT' ? 0 : line.quantity; value.weightKg += line.weightKg; value.volumeM3 += line.volumeM3; grouped.set(key, value); }
        if (effect.itemKind === 'A1_PHYSICAL_UNIT') for (const value of grouped.values()) value.quantity = 1;
        return grouped;
      };
      const src = sourceIndex(source), dst = sourceIndex(destination);
      if (src.size !== dst.size || [...src].some(([key, value]) => { const other = dst.get(key); return !other || value.quantity !== other.quantity || !close(value.weightKg, other.weightKg, 0.001) || !close(value.volumeM3, other.volumeM3, 0.000001); })) {
        invalid('MOVE_NOT_CONSERVED', 'MOVE source and destination do not conserve each unit or batch');
      }
    }
    ledgerRevision += 1; lastMovementId = movement._id;
  }
  const byBatch = [...placements.values()].filter(line => line.itemKind === 'A2_BATCH').sort((a, b) => a.batchId.localeCompare(b.batchId) || a.cellId.localeCompare(b.cellId));
  const unitMap = new Map<string, Row>();
  const byCellMap = new Map<string, Row>();
  for (const line of placements.values()) {
    const cell = byCellMap.get(line.cellId) ?? { cellId: line.cellId, quantity: 0, physicalUnitCount: 0, weightKg: 0, volumeM3: 0 };
    cell.weightKg += line.weightKg; cell.volumeM3 += line.volumeM3;
    if (line.itemKind === 'A2_BATCH') cell.quantity += line.quantity; else cell.physicalUnitCount += 1;
    byCellMap.set(line.cellId, cell);
    if (line.itemKind === 'A1_PHYSICAL_UNIT') {
      const unitId = id(line.physicalUnitId), unit: Row = unitMap.get(unitId) ?? { itemKind: 'A1_PHYSICAL_UNIT', physicalUnitId: unitId, quantity: 1,
        sourceMovementId: line.sourceMovementId, receivedAt: line.receivedAt, quantityUnit: line.quantityUnit, pose: line.pose, weightKg: 0, volumeM3: 0, cellIds: [] };
      if (unit.quantityUnit !== line.quantityUnit || JSON.stringify(unit.pose) !== JSON.stringify(line.pose)) invalid('A1_FOOTPRINT_MISMATCH', 'PhysicalUnit footprint has inconsistent unit or pose data');
      unit.weightKg += line.weightKg; unit.volumeM3 += line.volumeM3; unit.cellIds.push(line.cellId); unitMap.set(unitId, unit);
    }
  }
  const byPhysicalUnit: Row[] = [...unitMap.values()].map((unit: Row) => ({ ...unit, cellIds: [...new Set<string>(unit.cellIds)].sort() }))
    .sort((a: Row, b: Row) => a.physicalUnitId.localeCompare(b.physicalUnitId));
  for (const row of byCellMap.values()) { row.weightKg = canonicalRound(row.weightKg, 3); row.volumeM3 = canonicalRound(row.volumeM3, 6); }
  for (const row of byPhysicalUnit) { row.weightKg = canonicalRound(row.weightKg, 3); row.volumeM3 = canonicalRound(row.volumeM3, 6); }
  const onHandQuantity = byBatch.reduce((n, row) => n + row.quantity, 0) + byPhysicalUnit.length;
  const totalWeightKg = canonicalRound(byBatch.reduce((n, row) => n + row.weightKg, 0) + byPhysicalUnit.reduce((n, row) => n + row.weightKg, 0), 3);
  const totalVolumeM3 = canonicalRound(byBatch.reduce((n, row) => n + row.volumeM3, 0) + byPhysicalUnit.reduce((n, row) => n + row.volumeM3, 0), 6);
  if (!Number.isSafeInteger(onHandQuantity) || !Number.isFinite(totalWeightKg) || !Number.isFinite(totalVolumeM3)) invalid('ARITHMETIC_OVERFLOW', 'V3 stock totals exceed safe numeric bounds');
  return { skuId: id(item._id), reservationId: id(item.managedReservationId), customerId: id(item.customerId), facilityId: id(item.facilityId),
    onHandQuantity, heldQuantity: 0, availableQuantity: onHandQuantity, totalWeightKg, totalVolumeM3, byBatch, byPhysicalUnit,
    byCell: [...byCellMap.values()].sort((a, b) => a.cellId.localeCompare(b.cellId)), lastMovementId, ledgerRevision, projectionRevision: ledgerRevision,
    reconciledAt: new Date() };
}

export function v3RequestHash(payload: unknown) { return createHash('sha256').update(JSON.stringify(payload)).digest('hex'); }
