import { ManagedCapacityStatus, ManagedStockErrorCode, StockBatchBalance } from '../../types/managed-stock.type';
import { ItemMovementType, MovementBatchAction } from '../../types/item-movement.type';
import { exactUnitsEqual, precisionUnitsToNumber, roundedProductUnits, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';

export class ManagedStockReconciliationError extends Error {
  public readonly status: number;
  constructor(public readonly code: ManagedStockErrorCode, message: string) {
    super(message);
    this.name = 'ManagedStockReconciliationError';
    this.status = code === ManagedStockErrorCode.FEATURE_DISABLED ? 503 : 409;
  }
}

type AnyRecord = Record<string, any>;
type ArithmeticPolicy = 'COMPATIBILITY' | 'CANONICAL_V1';
export interface ReceiptBatchQuantityAllocation { batchId: string; quantity: number }
const fail = (code: ManagedStockErrorCode, message: string): never => { throw new ManagedStockReconciliationError(code, message); };
const identity = (value: any) => value == null ? null : String(value._id ?? value);
const near = (left: number, right: number, tolerance: number) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const round = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;

function validatePhysical(quantity: number, weight: number, dimensions: AnyRecord, volume: number) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(weight) || weight <= 0 ||
      !dimensions || ![dimensions.widthM, dimensions.depthM, dimensions.heightM].every((value: number) => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(volume) || volume <= 0) fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement batch physical measurements are invalid');
}

function movementSchemaVersion(movement: AnyRecord): 1 | 2 {
  const version = movement.schemaVersion;
  if (version == null || version === 1) {
    if (movement.batchLines !== undefined && movement.batchLines !== null) {
      fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Legacy schema v1 movement cannot contain batch lines');
    }
    return 1;
  }
  if (version === 2) return 2;
  return fail(ManagedStockErrorCode.INVALID_MOVEMENT, `Unsupported movement schema version: ${String(version)}`);
}

function movementArithmeticPolicy(movement: AnyRecord, version: 1 | 2): ArithmeticPolicy {
  const marker = movement.arithmeticPolicy;
  if (marker == null) return 'COMPATIBILITY';
  if (marker === 'CANONICAL_V1' && version === 2) return 'CANONICAL_V1';
  return fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Unsupported arithmetic policy for movement schema version');
}

function assertMovementQuantityUnit(item: AnyRecord, movement: AnyRecord) {
  if (typeof item.quantityUnit !== 'string' || !item.quantityUnit.trim() ||
      typeof movement.quantityUnit !== 'string' || movement.quantityUnit !== item.quantityUnit) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement quantity unit differs from its InventoryItem');
  }
}

function assertV2ParentUnitSummary(movement: AnyRecord, firstLine: AnyRecord) {
  // v2 parent unit fields are a compatibility summary copied from the first line;
  // per-line fields are authoritative when batches are physically heterogeneous.
  const parent = movement.actualUnitDimensionsM;
  const line = firstLine.actualUnitDimensionsM;
  if (!near(Number(movement.actualUnitWeightKg), Number(firstLine.actualUnitWeightKg), 0.001) ||
      !parent || !line || !near(Number(parent.widthM), Number(line.widthM), 0.000001) ||
      !near(Number(parent.depthM), Number(line.depthM), 0.000001) ||
      !near(Number(parent.heightM), Number(line.heightM), 0.000001)) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Schema v2 parent unit summary must match its first batch line');
  }
}

function lineToBatch(line: AnyRecord, receiptMovementId: any, receivedAt: Date, arithmeticPolicy: ArithmeticPolicy): StockBatchBalance {
  validatePhysical(line.quantity, line.actualTotalWeightKg, line.actualUnitDimensionsM, line.actualTotalVolumeM3);
  if (typeof line.batchId !== 'string' || !line.batchId.trim() || typeof line.quantityUnit !== 'string' || !line.quantityUnit.trim() ||
      !Number.isFinite(line.actualUnitWeightKg) || line.actualUnitWeightKg <= 0 ||
      (arithmeticPolicy === 'CANONICAL_V1'
        ? !isCanonicalLineArithmeticValid(line)
        : !near(round(line.actualUnitWeightKg * line.quantity, 3), round(line.actualTotalWeightKg, 3), 0.001))) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement batch line is malformed or has inconsistent weight');
  }
  const unit = line.actualUnitDimensionsM;
  const computedTotalVolume = round(Number(unit.widthM) * Number(unit.depthM) * Number(unit.heightM) * line.quantity, 6);
  if (arithmeticPolicy === 'COMPATIBILITY' && !near(computedTotalVolume, round(line.actualTotalVolumeM3, 6), 0.000001)) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement batch line volume does not reconcile to its dimensions');
  }
  return {
    batchId: line.batchId,
    receiptMovementId,
    ...(line.receiptRequestId ? { receiptRequestId: line.receiptRequestId } : {}),
    ...(line.receivingInspectionEvidenceId ? { receivingInspectionEvidenceId: line.receivingInspectionEvidenceId } : {}),
    quantity: line.quantity,
    heldQuantity: 0,
    quantityUnit: line.quantityUnit,
    actualUnitWeightKg: line.actualUnitWeightKg,
    actualUnitDimensionsM: { widthM: Number(unit.widthM), depthM: Number(unit.depthM), heightM: Number(unit.heightM) },
    actualTotalWeightKg: arithmeticPolicy === 'CANONICAL_V1'
      ? canonicalNumber([line.actualUnitWeightKg], line.quantity, 3) : round(line.actualTotalWeightKg, 3),
    actualTotalVolumeM3: arithmeticPolicy === 'CANONICAL_V1'
      ? canonicalNumber([Number(unit.widthM), Number(unit.depthM), Number(unit.heightM)], line.quantity, 6)
      : round(line.actualTotalVolumeM3, 6),
    receivedAt,
    arithmeticPolicy,
  };
}

function canonicalNumber(values: number[], quantity: number, precision: number): number {
  const units = roundedProductUnits(values, quantity, precision);
  const value = units === null ? null : precisionUnitsToNumber(units, precision);
  if (value === null) return fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Canonical physical total exceeds the safe numeric range');
  return value;
}

function isCanonicalLineArithmeticValid(line: AnyRecord): boolean {
  const dimensions = line.actualUnitDimensionsM;
  const weightUnits = roundedProductUnits([Number(line.actualUnitWeightKg)], Number(line.quantity), 3);
  const volumeUnits = roundedProductUnits([Number(dimensions?.widthM), Number(dimensions?.depthM), Number(dimensions?.heightM)],
    Number(line.quantity), 6);
  return weightUnits !== null && volumeUnits !== null &&
    exactUnitsEqual(Number(line.actualTotalWeightKg), weightUnits, 3) &&
    exactUnitsEqual(Number(line.actualTotalVolumeM3), volumeUnits, 6);
}

function legacyInboundBatch(movement: AnyRecord): StockBatchBalance {
  const quantity = Number(movement.quantity), totalWeight = Number(movement.actualTotalWeightKg), totalVolume = Number(movement.actualTotalVolumeM3);
  const unit = movement.actualUnitDimensionsM;
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || typeof movement.quantityUnit !== 'string' || !movement.quantityUnit.trim() ||
      !Number.isFinite(totalWeight) || totalWeight <= 0 || !Number.isFinite(totalVolume) || totalVolume <= 0 ||
      !unit || ![unit.widthM, unit.depthM, unit.heightM].every((value: number) => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(Number(movement.actualUnitWeightKg)) || Number(movement.actualUnitWeightKg) <= 0 ||
      !near(round(Number(movement.actualUnitWeightKg) * quantity, 3), round(totalWeight, 3), 0.001) ||
      !near(round(Number(unit.widthM) * Number(unit.depthM) * Number(unit.heightM) * quantity, 6), round(totalVolume, 6), 0.000001)) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Legacy INBOUND movement measurements cannot be reconciled');
  }
  return {
    batchId: `legacy:${identity(movement)}`,
    receiptMovementId: movement._id,
    quantity,
    heldQuantity: 0,
    quantityUnit: movement.quantityUnit,
    actualUnitWeightKg: Number(movement.actualUnitWeightKg),
    actualUnitDimensionsM: { widthM: Number(unit.widthM), depthM: Number(unit.depthM), heightM: Number(unit.heightM) },
    actualTotalWeightKg: round(totalWeight, 3), actualTotalVolumeM3: round(totalVolume, 6),
    receivedAt: new Date(movement.performedAt),
    arithmeticPolicy: 'COMPATIBILITY',
  };
}

function movementLines(movement: AnyRecord, expectedAction: MovementBatchAction, arithmeticPolicy: ArithmeticPolicy) {
  const lines = movement.batchLines;
  if (!Array.isArray(lines) || !lines.length || lines.some((line: AnyRecord) => line.action !== expectedAction) ||
      lines.reduce((sum: number, line: AnyRecord) => sum + Number(line.quantity), 0) !== Number(movement.quantity)) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Schema v2 movement batch lines do not match movement type or quantity');
  }
  if (arithmeticPolicy === 'CANONICAL_V1' && lines.reduce((sum: number, line: AnyRecord) => sum + line.quantity, 0) !== Number(movement.quantity)) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Canonical movement quantities must sum exactly to the parent quantity');
  }
  for (const line of lines) {
    validatePhysical(Number(line.quantity), Number(line.actualTotalWeightKg), line.actualUnitDimensionsM, Number(line.actualTotalVolumeM3));
    if (typeof line.batchId !== 'string' || !line.batchId.trim() || typeof line.quantityUnit !== 'string' || !line.quantityUnit.trim() ||
        !Number.isFinite(Number(line.actualUnitWeightKg)) || Number(line.actualUnitWeightKg) <= 0 ||
        (arithmeticPolicy === 'CANONICAL_V1'
          ? !isCanonicalLineArithmeticValid(line)
          : !near(round(Number(line.actualUnitWeightKg) * Number(line.quantity), 3), round(Number(line.actualTotalWeightKg), 3), 0.001) ||
            !near(round(Number(line.actualUnitDimensionsM.widthM) * Number(line.actualUnitDimensionsM.depthM) *
              Number(line.actualUnitDimensionsM.heightM) * Number(line.quantity), 6), round(Number(line.actualTotalVolumeM3), 6), 0.000001))) {
      fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement batch line physical values do not reconcile');
    }
  }
  if (lines.some((line: AnyRecord) => line.quantityUnit !== movement.quantityUnit)) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement batch quantity unit differs from its parent movement');
  }
  assertV2ParentUnitSummary(movement, lines[0]);
  const lineWeight = lines.reduce((sum: number, line: AnyRecord) => sum + Number(line.actualTotalWeightKg), 0);
  const lineVolume = lines.reduce((sum: number, line: AnyRecord) => sum + Number(line.actualTotalVolumeM3), 0);
  const canonicalWeightUnits = arithmeticPolicy === 'CANONICAL_V1'
    ? sumExactPrecisionUnits(lines.map((line: AnyRecord) => Number(line.actualTotalWeightKg)), 3) : null;
  const canonicalVolumeUnits = arithmeticPolicy === 'CANONICAL_V1'
    ? sumExactPrecisionUnits(lines.map((line: AnyRecord) => Number(line.actualTotalVolumeM3)), 6) : null;
  const canonicalParentMismatch = arithmeticPolicy === 'CANONICAL_V1' &&
    (canonicalWeightUnits === null || canonicalVolumeUnits === null ||
      !exactUnitsEqual(Number(movement.actualTotalWeightKg), canonicalWeightUnits, 3) ||
      !exactUnitsEqual(Number(movement.actualTotalVolumeM3), canonicalVolumeUnits, 6));
  if (canonicalParentMismatch || (arithmeticPolicy === 'COMPATIBILITY' &&
      (!near(round(lineWeight, 3), round(Number(movement.actualTotalWeightKg), 3), 0.001) ||
       !near(round(lineVolume, 6), round(Number(movement.actualTotalVolumeM3), 6), 0.000001)))) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Schema v2 movement totals differ from its batch lines');
  }
  const ids = lines.map((line: AnyRecord) => line.batchId);
  if (new Set(ids).size !== ids.length) fail(ManagedStockErrorCode.BATCH_MISMATCH, 'Movement contains duplicate receipt batch lines');
  return lines as AnyRecord[];
}

/** Stable FIFO ordering shared by historical v1 removal reconciliation and canonical outbound holds. */
export function allocateReceiptBatchesFIFO(batches: readonly StockBatchBalance[], quantity: number,
  availableQuantity: (batch: StockBatchBalance) => number = batch => batch.quantity) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Removal quantity must be a positive safe integer');
  let remaining = quantity;
  const allocations: ReceiptBatchQuantityAllocation[] = [];
  const ordered = [...batches].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.batchId.localeCompare(b.batchId));
  for (const batch of ordered) {
    if (remaining === 0) break;
    const available = availableQuantity(batch);
    if (!Number.isSafeInteger(available) || available < 0 || available > batch.quantity) {
      fail(ManagedStockErrorCode.NEGATIVE_STOCK, 'Receipt batch available quantity is invalid');
    }
    const remove = Math.min(remaining, available);
    if (remove > 0) allocations.push({ batchId: batch.batchId, quantity: remove });
    remaining -= remove;
  }
  if (remaining > 0) fail(ManagedStockErrorCode.NEGATIVE_STOCK, 'Outbound exceeds available receipt batch stock');
  return allocations;
}

function allocateLegacyRemoval(batches: Map<string, StockBatchBalance>, quantity: number) {
  let remaining = quantity;
  let removedWeightKg = 0;
  let removedVolumeM3 = 0;
  const allocations = allocateReceiptBatchesFIFO([...batches.values()], quantity);
  for (const allocation of allocations) {
    const batch = batches.get(allocation.batchId)!;
    const remove = allocation.quantity;
    removedWeightKg += batch.actualUnitWeightKg * remove;
    removedVolumeM3 += batch.actualUnitDimensionsM.widthM * batch.actualUnitDimensionsM.depthM * batch.actualUnitDimensionsM.heightM * remove;
    batch.quantity -= remove;
    batch.actualTotalWeightKg = round(batch.actualUnitWeightKg * batch.quantity, 3);
    const unit = batch.actualUnitDimensionsM;
    batch.actualTotalVolumeM3 = round(unit.widthM * unit.depthM * unit.heightM * batch.quantity, 6);
    remaining -= remove;
  }
  if (remaining > 0) fail(ManagedStockErrorCode.NEGATIVE_STOCK, 'Legacy OUTBOUND exceeds the reconciled stock balance');
  return { removedWeightKg: round(removedWeightKg, 3), removedVolumeM3: round(removedVolumeM3, 6) };
}

function assertBatchLinesMatchBalance(batches: Map<string, StockBatchBalance>, lines: AnyRecord[], mutate: boolean,
  arithmeticPolicy: ArithmeticPolicy) {
  for (const line of lines) {
    const current = batches.get(line.batchId);
    if (current && (current.quantity < line.quantity || (mutate && current.quantity - line.quantity < current.heldQuantity))) {
      fail(ManagedStockErrorCode.NEGATIVE_STOCK, 'Movement would reduce a receipt batch below on-hand or held stock');
    }
    const unitMismatch = current && (arithmeticPolicy === 'CANONICAL_V1'
      ? current.actualUnitWeightKg !== Number(line.actualUnitWeightKg) ||
        current.actualUnitDimensionsM.widthM !== Number(line.actualUnitDimensionsM?.widthM) ||
        current.actualUnitDimensionsM.depthM !== Number(line.actualUnitDimensionsM?.depthM) ||
        current.actualUnitDimensionsM.heightM !== Number(line.actualUnitDimensionsM?.heightM)
      : !near(current.actualUnitWeightKg, Number(line.actualUnitWeightKg), 0.001) ||
        !near(current.actualUnitDimensionsM.widthM, Number(line.actualUnitDimensionsM?.widthM), 0.000001) ||
        !near(current.actualUnitDimensionsM.depthM, Number(line.actualUnitDimensionsM?.depthM), 0.000001) ||
        !near(current.actualUnitDimensionsM.heightM, Number(line.actualUnitDimensionsM?.heightM), 0.000001));
    if (!current || (line.receiptMovementId != null && identity(line.receiptMovementId) !== identity(current.receiptMovementId)) ||
        current.quantityUnit !== line.quantityUnit ||
        unitMismatch) {
      fail(ManagedStockErrorCode.BATCH_MISMATCH, 'Movement references a missing, depleted, or physically different receipt batch');
    }
    if (mutate) {
      const batch = current as StockBatchBalance;
      batch.quantity -= line.quantity;
      batch.actualTotalWeightKg = canonicalNumber([batch.actualUnitWeightKg], batch.quantity, 3);
      batch.actualTotalVolumeM3 = canonicalNumber([batch.actualUnitDimensionsM.widthM, batch.actualUnitDimensionsM.depthM,
        batch.actualUnitDimensionsM.heightM], batch.quantity, 6);
    }
  }
}

/** Read-only fold of both the MI-03B/04/05 movement format and version 2 batch-line events. */
export function reconcileManagedItemStock(item: AnyRecord, inputMovements: AnyRecord[]) {
  const movements = [...inputMovements].sort((a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime() || (identity(a) ?? '').localeCompare(identity(b) ?? ''));
  const batches = new Map<string, StockBatchBalance>();
  let currentCellId: string | null = null;
  let latestPlacementMovementId: string | null = null;
  let source: 'LEDGER_V2' | 'LEGACY_RECONCILED' = 'LEGACY_RECONCILED';
  let lastMovement: AnyRecord | null = null;
  for (const movement of movements) {
    if (!identity(movement) || !Number.isFinite(new Date(movement.performedAt).getTime()) ||
        identity(movement.itemId) !== identity(item._id) || identity(movement.customerId) !== identity(item.customerId) ||
        identity(movement.managedReservationId) !== identity(item.managedReservationId) || identity(movement.facilityId) !== identity(item.facilityId)) {
      fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement ownership scope differs from the Item');
    }
    const version = movementSchemaVersion(movement);
    const arithmeticPolicy = movementArithmeticPolicy(movement, version);
    assertMovementQuantityUnit(item, movement);
    if (!Number.isSafeInteger(Number(movement.quantity)) || Number(movement.quantity) <= 0) fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Movement quantity must be a positive safe integer');
    const eventType = movement.type;
    if (eventType === ItemMovementType.INBOUND) {
      if (movement.sourceCellId != null || !movement.destinationCellId) fail(ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'INBOUND must establish a destination Cell');
      if (currentCellId != null && currentCellId !== identity(movement.destinationCellId)) fail(ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'An Item with on-hand stock cannot occupy more than one Cell');
      if (version === 2) {
        source = 'LEDGER_V2';
        for (const line of movementLines(movement, MovementBatchAction.ADD, arithmeticPolicy)) {
          const batch = lineToBatch(line, movement._id, new Date(movement.performedAt), arithmeticPolicy);
          if (batches.has(batch.batchId)) fail(ManagedStockErrorCode.BATCH_MISMATCH, 'Receipt batch identity is reused');
          batches.set(batch.batchId, batch);
        }
      } else {
        const batch = legacyInboundBatch(movement);
        if (batches.has(batch.batchId)) fail(ManagedStockErrorCode.BATCH_MISMATCH, 'Legacy receipt movement is duplicated');
        batches.set(batch.batchId, batch);
      }
      currentCellId = identity(movement.destinationCellId);
      latestPlacementMovementId = identity(movement);
    } else if (eventType === ItemMovementType.OUTBOUND) {
      if (!movement.sourceCellId || movement.destinationCellId != null || identity(movement.sourceCellId) !== currentCellId) {
        fail(ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'OUTBOUND source does not match current stock placement');
      }
      if (version === 2) {
        source = 'LEDGER_V2';
        const lines = movementLines(movement, MovementBatchAction.REMOVE, arithmeticPolicy);
        assertBatchLinesMatchBalance(batches, lines, true, arithmeticPolicy);
      } else {
        const removed = allocateLegacyRemoval(batches, Number(movement.quantity));
        if (!near(removed.removedWeightKg, Number(movement.actualTotalWeightKg), 0.001) ||
            !near(removed.removedVolumeM3, Number(movement.actualTotalVolumeM3), 0.000001)) {
          fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Legacy OUTBOUND measurements do not match its deterministically allocated batches');
        }
      }
      if (![...batches.values()].some(batch => batch.quantity > 0)) { currentCellId = null; latestPlacementMovementId = null; }
    } else if (eventType === ItemMovementType.RELOCATION) {
      if (!movement.sourceCellId || !movement.destinationCellId || identity(movement.sourceCellId) !== currentCellId ||
          identity(movement.sourceCellId) === identity(movement.destinationCellId)) {
        fail(ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'RELOCATION source or destination breaks current placement lineage');
      }
      if ((version === 2 && identity(movement.previousPlacementMovementId) !== latestPlacementMovementId) ||
          (movement.previousPlacementMovementId && identity(movement.previousPlacementMovementId) !== latestPlacementMovementId)) {
        fail(ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, 'RELOCATION previous placement pointer does not match the committed lineage');
      }
      const onHand = [...batches.values()].reduce((sum, batch) => sum + batch.quantity, 0);
      const onHandWeightKg = [...batches.values()].reduce((sum, batch) => sum + batch.actualTotalWeightKg, 0);
      const onHandVolumeM3 = [...batches.values()].reduce((sum, batch) => sum + batch.actualTotalVolumeM3, 0);
      if (version === 2) {
        source = 'LEDGER_V2';
        const lines = movementLines(movement, MovementBatchAction.MOVE, arithmeticPolicy);
        if (Number(movement.quantity) !== onHand || lines.reduce((sum, line) => sum + line.quantity, 0) !== onHand) {
          fail(ManagedStockErrorCode.BATCH_MISMATCH, 'RELOCATION must represent the complete current stock');
        }
        assertBatchLinesMatchBalance(batches, lines, false, arithmeticPolicy);
      } else if (Number(movement.quantity) !== onHand) {
        fail(ManagedStockErrorCode.BATCH_MISMATCH, 'Legacy RELOCATION quantity differs from current stock');
      } else if (!near(round(onHandWeightKg, 3), Number(movement.actualTotalWeightKg), 0.001) ||
          !near(round(onHandVolumeM3, 6), Number(movement.actualTotalVolumeM3), 0.000001)) {
        fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Legacy RELOCATION measurements differ from current batch stock');
      }
      currentCellId = identity(movement.destinationCellId);
      latestPlacementMovementId = identity(movement);
    } else fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Unknown movement type');
    lastMovement = movement;
  }

  const nonEmpty = [...batches.values()].filter(batch => batch.quantity > 0);
  const onHandQuantity = nonEmpty.reduce((sum, batch) => sum + batch.quantity, 0);
  const weightUnits = sumExactPrecisionUnits(nonEmpty.map(batch => batch.actualTotalWeightKg), 3);
  const volumeUnits = sumExactPrecisionUnits(nonEmpty.map(batch => batch.actualTotalVolumeM3), 6);
  const actualTotalWeightKg = weightUnits === null ? null : precisionUnitsToNumber(weightUnits, 3);
  const actualTotalVolumeM3 = volumeUnits === null ? null : precisionUnitsToNumber(volumeUnits, 6);
  if (actualTotalWeightKg === null || actualTotalVolumeM3 === null) {
    fail(ManagedStockErrorCode.INVALID_MOVEMENT, 'Aggregate stock totals exceed the safe numeric range');
  }
  if (identity(item.currentCellId) !== currentCellId) fail(ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'InventoryItem.currentCellId differs from movement-derived placement');
  if ((source === 'LEDGER_V2' && currentCellId !== null && identity(item.currentPlacementMovementId) !== latestPlacementMovementId) ||
      (item.currentPlacementMovementId != null && identity(item.currentPlacementMovementId) !== latestPlacementMovementId)) {
    fail(ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'InventoryItem current placement pointer differs from movement lineage');
  }
  const physicallyStored = ['IN_STORAGE', 'PENDING_OUTBOUND'].includes(String(item.status));
  if (physicallyStored !== (onHandQuantity > 0)) fail(ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, 'InventoryItem status differs from movement-derived on-hand stock');
  return {
    itemId: identity(item._id), currentCellId, currentPlacementMovementId: latestPlacementMovementId, batches: nonEmpty,
    onHandQuantity, heldQuantity: 0, actualTotalWeightKg, actualTotalVolumeM3,
    source, reconciledThroughMovementId: lastMovement?._id ?? null,
  };
}

export function reconcileManagedCounters(ledgerUsage: { usedWeightKg: number; usedVolumeM3: number }, cell: AnyRecord,
  reservation: AnyRecord, reservationUsedVolumeM3: number) {
  const values = [ledgerUsage?.usedWeightKg, ledgerUsage?.usedVolumeM3, cell?.usedWeightKg, cell?.usedVolumeM3,
    reservation?.usedCapacityM3, reservationUsedVolumeM3];
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    fail(ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Capacity counters are missing or invalid');
  }
  if (!near(Number(cell.usedWeightKg), ledgerUsage.usedWeightKg, 0.001) || !near(Number(cell.usedVolumeM3), ledgerUsage.usedVolumeM3, 0.000001)) {
    fail(ManagedStockErrorCode.CELL_COUNTER_MISMATCH, 'Cell counters differ from movement-derived physical stock');
  }
  if (!near(Number(reservation.usedCapacityM3), reservationUsedVolumeM3, 0.000001)) {
    fail(ManagedStockErrorCode.RESERVATION_COUNTER_MISMATCH, 'Reservation used capacity differs from movement-derived physical stock');
  }
  return true;
}

export function deriveManagedCapacityStatus(usage: { usedWeightKg: number; usedVolumeM3: number }, capacity: {
  maxWeightKg: number; maxVolumeM3: number;
}) {
  const values = [usage?.usedWeightKg, usage?.usedVolumeM3, capacity?.maxWeightKg, capacity?.maxVolumeM3];
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0) || capacity.maxWeightKg <= 0 || capacity.maxVolumeM3 <= 0 ||
      usage.usedWeightKg > capacity.maxWeightKg + 0.001 || usage.usedVolumeM3 > capacity.maxVolumeM3 + 0.000001) {
    return { capacityStatus: 'UNKNOWN' as ManagedCapacityStatus, remainingWeightKg: null, remainingVolumeM3: null };
  }
  const remainingWeightKg = round(Math.max(0, capacity.maxWeightKg - usage.usedWeightKg), 3);
  const remainingVolumeM3 = round(Math.max(0, capacity.maxVolumeM3 - usage.usedVolumeM3), 6);
  const empty = usage.usedWeightKg <= 0.001 && usage.usedVolumeM3 <= 0.000001;
  const full = remainingWeightKg <= 0.001 || remainingVolumeM3 <= 0.000001;
  return { capacityStatus: (empty ? 'EMPTY' : full ? 'FULL' : 'PARTIAL') as ManagedCapacityStatus, remainingWeightKg, remainingVolumeM3 };
}

export function assertManagedCapacityFits(usage: { usedWeightKg: number; usedVolumeM3: number }, addition: {
  weightKg: number; volumeM3: number;
}, capacity: { maxWeightKg: number; maxVolumeM3: number }) {
  const values = [usage?.usedWeightKg, usage?.usedVolumeM3, addition?.weightKg, addition?.volumeM3,
    capacity?.maxWeightKg, capacity?.maxVolumeM3];
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0) ||
      capacity.maxWeightKg <= 0 || capacity.maxVolumeM3 <= 0) {
    fail(ManagedStockErrorCode.CAPACITY_UNKNOWN, 'Capacity or physical usage is missing or invalid');
  }
  if (usage.usedWeightKg + addition.weightKg > capacity.maxWeightKg + 0.001 ||
      usage.usedVolumeM3 + addition.volumeM3 > capacity.maxVolumeM3 + 0.000001) {
    fail(ManagedStockErrorCode.CAPACITY_EXCEEDED, 'Addition exceeds Cell physical capacity');
  }
  return true;
}

export function managedStockLedgerWritesEnabled(nodeEnv: string, configured: string | undefined) {
  return nodeEnv !== 'production' && configured?.trim().toLowerCase() === 'true';
}

export function assertManagedStockLedgerWritesEnabled(nodeEnv: string, configured: string | undefined) {
  if (!managedStockLedgerWritesEnabled(nodeEnv, configured)) {
    fail(ManagedStockErrorCode.FEATURE_DISABLED, 'MI-06 stock ledger writes are disabled');
  }
}
