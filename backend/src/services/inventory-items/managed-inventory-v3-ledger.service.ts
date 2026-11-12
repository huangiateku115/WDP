import { createHash } from 'node:crypto';

type Row = Record<string, any>;
const id = (value: unknown) => value == null ? '' : String(value);
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const close = (a: number, b: number, tolerance: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const canonicalRound = (value: number, places: number) => Math.round((value + Number.EPSILON) * (10 ** places)) / (10 ** places);
const keyFor = (line: Row, kind: string) => kind === 'A1_PHYSICAL_UNIT' ? `U:${id(line.physicalUnitId)}:${id(line.cellId)}` : `B:${line.batchId}:${id(line.cellId)}`;
const projectionLine = (line: Row) => ({ ...line, cellId: id(line.cellId), physicalUnitId: line.physicalUnitId ? id(line.physicalUnitId) : undefined,
  topologyCertificationId: line.topologyCertificationId ? id(line.topologyCertificationId) : undefined, heldQuantity: line.heldQuantity ?? 0 });

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
        placements.set(key, { ...line, itemKind: effect.itemKind });
        if (effect.itemKind === 'A1_PHYSICAL_UNIT') {
          const unitId = id(line.physicalUnitId), cells = unitCells.get(unitId) ?? new Set<string>(); cells.add(line.cellId); unitCells.set(unitId, cells);
        }
      }
    } else {
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
        if (!current || current.quantity !== line.quantity || !close(current.weightKg, line.weightKg, 0.001) || !close(current.volumeM3, line.volumeM3, 0.000001)) {
          invalid('SOURCE_PLACEMENT_MISMATCH', 'REMOVE/MOVE source does not match active stock placement');
        }
        placements.delete(keys[i]!);
        if (effect.itemKind === 'A1_PHYSICAL_UNIT') unitCells.get(id(line.physicalUnitId))?.delete(line.cellId);
      }
      if (effect.action === 'MOVE') for (const line of destination) {
        const key = keyFor(line, effect.itemKind);
        if (placements.has(key)) invalid('PLACEMENT_ALREADY_ACTIVE', 'MOVE destination already has an active placement');
        placements.set(key, { ...line, itemKind: effect.itemKind });
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
        quantityUnit: line.quantityUnit, weightKg: 0, volumeM3: 0, cellIds: [] };
      if (unit.quantityUnit !== line.quantityUnit) invalid('QUANTITY_UNIT_MISMATCH', 'PhysicalUnit footprint has inconsistent quantity units');
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
