import { ManagedOutboundRequestState } from '../../types/managed-outbound-request.type';
import { ManagedStockErrorCode, InventoryStockBalanceFields, StockBatchBalance } from '../../types/managed-stock.type';
import { ItemMovementType, MovementBatchAction } from '../../types/item-movement.type';
import { canonicalProductNumber, exactPrecisionUnits, precisionUnitsToNumber, roundedProductUnits, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';
import { reconcileManagedItemStock } from './managed-stock-ledger.service';

type RecordValue = Record<string, any>;
export interface ManagedOutboundAllocation extends RecordValue {
  batchId: string;
  quantity: number;
  receiptMovementId: unknown;
  receivedAt: string;
  arithmeticPolicy: 'COMPATIBILITY' | 'CANONICAL_V1';
}

export class ManagedOutboundAllocationError extends Error {
  constructor(public readonly code: ManagedStockErrorCode, message: string) {
    super(message);
    this.name = 'ManagedOutboundAllocationError';
  }
}

const fail = (code: ManagedStockErrorCode, message: string): never => { throw new ManagedOutboundAllocationError(code, message); };
const identity = (value: any): string | null => value == null ? null : String(value._id ?? value);
const round = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const near = (left: number, right: number, tolerance: number) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const policies = new Set(['COMPATIBILITY', 'CANONICAL_V1']);

function validateBatch(batch: RecordValue, index: number): void {
  const prefix = `Receipt batch ${index + 1}`;
  if (typeof batch.batchId !== 'string' || !batch.batchId.trim() || batch.batchId.length > 128 ||
      !identity(batch.receiptMovementId)) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} is missing an unambiguous batch or receipt movement identity`);
  if (!Number.isSafeInteger(batch.quantity) || batch.quantity <= 0 || !Number.isSafeInteger(batch.heldQuantity) ||
      batch.heldQuantity < 0 || batch.heldQuantity > batch.quantity) {
    fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, `${prefix} has invalid on-hand or held quantity`);
  }
  if (typeof batch.quantityUnit !== 'string' || !batch.quantityUnit.trim() || !policies.has(batch.arithmeticPolicy)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} has an unsupported unit or arithmetic policy`);
  }
  const dimensions = batch.actualUnitDimensionsM;
  const numbers = [batch.actualUnitWeightKg, dimensions?.widthM, dimensions?.depthM, dimensions?.heightM,
    batch.actualTotalWeightKg, batch.actualTotalVolumeM3];
  if (!dimensions || numbers.some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} has invalid physical measurements`);
  }
  const receivedAt = new Date(batch.receivedAt).getTime();
  if (!Number.isFinite(receivedAt)) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} has no valid receipt time for deterministic FIFO ordering`);
  const canonicalWeight = canonicalProductNumber([batch.actualUnitWeightKg], batch.quantity, 3);
  const canonicalVolume = canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], batch.quantity, 6);
  if (canonicalWeight === null || canonicalVolume === null) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} physical totals exceed the safe arithmetic range`);
  if (batch.arithmeticPolicy === 'CANONICAL_V1') {
    if (exactPrecisionUnits(batch.actualTotalWeightKg, 3) !== exactPrecisionUnits(canonicalWeight!, 3) ||
        exactPrecisionUnits(batch.actualTotalVolumeM3, 6) !== exactPrecisionUnits(canonicalVolume!, 6)) {
      fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} canonical totals do not match its immutable receipt measurements`);
    }
  } else if (Math.abs(round(batch.actualTotalWeightKg, 3) - round(canonicalWeight!, 3)) > 0.001 ||
      Math.abs(round(batch.actualTotalVolumeM3, 6) - round(canonicalVolume!, 6)) > 0.000001) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `${prefix} compatibility totals exceed the existing reconciliation tolerance`);
  }
}

function validateBalance(balance: RecordValue): StockBatchBalance[] {
  if (balance?.schemaVersion !== 1) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Unsupported StockBalance schema version');
  if (!identity(balance.itemId) || !identity(balance.facilityId) || !identity(balance.customerId) || !identity(balance.managedReservationId) ||
      !['LEDGER_V2', 'LEGACY_RECONCILED'].includes(balance.source) || !Array.isArray(balance.batches)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'StockBalance source or receipt batches are invalid');
  }
  const batchIds = balance.batches.map((batch: RecordValue) => batch.batchId);
  if (batchIds.some((id: unknown) => typeof id !== 'string' || !id.trim()) || new Set(batchIds).size !== batchIds.length) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'StockBalance contains missing or duplicate batch IDs');
  }
  balance.batches.forEach(validateBatch);
  const onHand = balance.batches.reduce((sum: number, batch: RecordValue) => sum + batch.quantity, 0);
  const held = balance.batches.reduce((sum: number, batch: RecordValue) => sum + batch.heldQuantity, 0);
  if (!Number.isSafeInteger(balance.onHandQuantity) || !Number.isSafeInteger(balance.heldQuantity) ||
      balance.onHandQuantity < 0 || balance.heldQuantity < 0 || balance.heldQuantity > balance.onHandQuantity ||
      onHand !== balance.onHandQuantity || held !== balance.heldQuantity) {
    fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'StockBalance aggregate quantities do not match its receipt batches');
  }
  const weightUnits = sumExactPrecisionUnits(balance.batches.map((batch: RecordValue) => batch.actualTotalWeightKg), 3);
  const volumeUnits = sumExactPrecisionUnits(balance.batches.map((batch: RecordValue) => batch.actualTotalVolumeM3), 6);
  if (weightUnits === null || volumeUnits === null ||
      exactPrecisionUnits(balance.actualTotalWeightKg, 3) !== weightUnits ||
      exactPrecisionUnits(balance.actualTotalVolumeM3, 6) !== volumeUnits ||
      (balance.onHandQuantity === 0) !== (balance.currentCellId == null) ||
      (balance.onHandQuantity === 0 && balance.batches.length !== 0)) {
    fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'StockBalance physical totals or placement do not reconcile to its batches');
  }
  return balance.batches as StockBatchBalance[];
}

function allocationSnapshot(batch: StockBatchBalance, quantity: number): ManagedOutboundAllocation {
  return Object.freeze({
    batchId: batch.batchId,
    quantity,
    receiptMovementId: batch.receiptMovementId,
    ...(batch.receiptRequestId ? { receiptRequestId: batch.receiptRequestId } : {}),
    ...(batch.receivingInspectionEvidenceId ? { receivingInspectionEvidenceId: batch.receivingInspectionEvidenceId } : {}),
    receivedAt: new Date(batch.receivedAt).toISOString(),
    arithmeticPolicy: batch.arithmeticPolicy,
  });
}

/** Validates a v1 StockBalance projection and returns immutable FIFO allocations from unheld units. */
export function allocateManagedOutboundBatches(balanceInput: InventoryStockBalanceFields | RecordValue, requestedQuantity: number): readonly ManagedOutboundAllocation[] {
  const balance = balanceInput as RecordValue;
  const batches = validateBalance(balance);
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Requested outbound quantity must be a positive safe integer');
  }
  let remaining = requestedQuantity;
  const ordered = [...batches].sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime() || a.batchId.localeCompare(b.batchId));
  const result: ManagedOutboundAllocation[] = [];
  for (const batch of ordered) {
    const available = batch.quantity - batch.heldQuantity;
    if (!Number.isSafeInteger(available) || available < 0) fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'Receipt batch available quantity is invalid');
    const allocated = Math.min(remaining, available);
    if (allocated > 0) {
      result.push(allocationSnapshot(batch, allocated));
      remaining -= allocated;
    }
    if (remaining === 0) break;
  }
  if (remaining > 0) fail(ManagedStockErrorCode.NEGATIVE_STOCK, 'Outbound exceeds available receipt batch stock');
  return Object.freeze(result);
}

function samePolicyMeasure(actual: number, expected: number, precision: number, policy: string): boolean {
  if (policy === 'CANONICAL_V1') return exactPrecisionUnits(actual, precision) === exactPrecisionUnits(expected, precision);
  const tolerance = precision === 3 ? 0.001 : 0.000001;
  return near(round(actual, precision), round(expected, precision), tolerance);
}

function assertSameBatchProjection(ledger: RecordValue, persisted: RecordValue): void {
  const persistedBatches = validateBalance(persisted);
  if (ledger.onHandQuantity !== persisted.onHandQuantity || identity(ledger.currentCellId) !== identity(persisted.currentCellId) ||
      ledger.batches.length !== persistedBatches.length) {
    fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'StockBalance on-hand quantity, placement, or batch count differs from movement history');
  }
  for (const expected of ledger.batches as RecordValue[]) {
    const actual = persistedBatches.find(batch => batch.batchId === expected.batchId) as RecordValue | undefined;
    if (!actual || actual.quantity !== expected.quantity || actual.quantityUnit !== expected.quantityUnit ||
        identity(actual.receiptMovementId) !== identity(expected.receiptMovementId) ||
        identity(actual.receiptRequestId) !== identity(expected.receiptRequestId) ||
        identity(actual.receivingInspectionEvidenceId) !== identity(expected.receivingInspectionEvidenceId) ||
        actual.arithmeticPolicy !== expected.arithmeticPolicy || new Date(actual.receivedAt).getTime() !== new Date(expected.receivedAt).getTime() ||
        !samePolicyMeasure(actual.actualUnitWeightKg, expected.actualUnitWeightKg, 3, expected.arithmeticPolicy) ||
        !samePolicyMeasure(actual.actualUnitDimensionsM.widthM, expected.actualUnitDimensionsM.widthM, 6, expected.arithmeticPolicy) ||
        !samePolicyMeasure(actual.actualUnitDimensionsM.depthM, expected.actualUnitDimensionsM.depthM, 6, expected.arithmeticPolicy) ||
        !samePolicyMeasure(actual.actualUnitDimensionsM.heightM, expected.actualUnitDimensionsM.heightM, 6, expected.arithmeticPolicy) ||
        !samePolicyMeasure(actual.actualTotalWeightKg, expected.actualTotalWeightKg, 3, expected.arithmeticPolicy) ||
        !samePolicyMeasure(actual.actualTotalVolumeM3, expected.actualTotalVolumeM3, 6, expected.arithmeticPolicy)) {
      fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, `StockBalance batch ${expected.batchId} differs from immutable movement history`);
    }
  }
}

function assertRequestUsesFIFO(balance: RecordValue, allocations: RecordValue[], requestedQuantity: number): void {
  const unheldView = { ...balance, heldQuantity: 0,
    batches: balance.batches.map((batch: RecordValue) => ({ ...batch, heldQuantity: 0 })) };
  const expected = allocateManagedOutboundBatches(unheldView, requestedQuantity);
  if (expected.length !== allocations.length || expected.some((row, index) =>
    row.batchId !== allocations[index]?.batchId || row.quantity !== allocations[index]?.quantity)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Stored outbound allocations do not follow deterministic receipt-batch FIFO');
  }
}

/** Reconciles movement-derived stock, pending request allocations, and persisted held quantities without mutating inputs. */
export function reconcileManagedOutboundHolds(input: {
  item: RecordValue;
  movements: RecordValue[];
  stockBalance: InventoryStockBalanceFields | RecordValue;
  requests: RecordValue[];
}) {
  let ledger: RecordValue;
  try { ledger = reconcileManagedItemStock(input.item, input.movements); }
  catch (error) { throw error; }
  const balance = input.stockBalance as RecordValue;
  const persistedBatches = validateBalance(balance);
  assertSameBatchProjection(ledger, balance);
  const pending = input.requests.filter(request => request?.state === ManagedOutboundRequestState.PENDING);
  if (identity(balance.itemId) !== identity(input.item._id) ||
      identity(balance.customerId) !== identity(input.item.customerId) ||
      identity(balance.managedReservationId) !== identity(input.item.managedReservationId) ||
      identity(balance.facilityId) !== identity(input.item.facilityId) ||
      input.requests.some(request => identity(request?.itemId) !== identity(input.item._id))) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Outbound request history contains a request for another Item');
  }
  if (input.requests.some(request => !Object.values(ManagedOutboundRequestState).includes(request?.state))) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'An outbound request has an unsupported lifecycle state');
  }
  if (pending.length > 1) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'More than one unresolved outbound request exists for the Item');
  const byBatch = new Map<string, number>();
  if (pending.length) {
    const request = pending[0]!;
    if (identity(request.itemId) !== identity(input.item._id) || request.quantityUnit !== input.item.quantityUnit ||
        !Number.isSafeInteger(request.requestedQuantity) || request.requestedQuantity <= 0 || !Array.isArray(request.batchAllocations)) {
      fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Pending outbound request scope or quantity is invalid');
    }
    const seen = new Set<string>();
    let allocated = 0;
    for (const row of request.batchAllocations) {
      if (!row || typeof row.batchId !== 'string' || seen.has(row.batchId) || !Number.isSafeInteger(row.quantity) || row.quantity <= 0 ||
          !identity(row.receiptMovementId) || !Number.isFinite(new Date(row.receivedAt).getTime()) || !policies.has(row.arithmeticPolicy)) {
        fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Pending request contains malformed or ambiguous batch lineage');
      }
      seen.add(row.batchId);
      const batch = (ledger.batches as RecordValue[]).find(candidate => candidate.batchId === row.batchId);
      if (!batch || identity(row.receiptMovementId) !== identity(batch.receiptMovementId) ||
          identity(row.receiptRequestId) !== identity(batch.receiptRequestId) ||
          identity(row.receivingInspectionEvidenceId) !== identity(batch.receivingInspectionEvidenceId) ||
          row.arithmeticPolicy !== batch.arithmeticPolicy || new Date(row.receivedAt).getTime() !== new Date(batch.receivedAt).getTime()) {
        fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `Pending allocation ${row.batchId} has stale receipt provenance`);
      }
      allocated += row.quantity;
      byBatch.set(row.batchId, row.quantity);
    }
    if (allocated !== request.requestedQuantity) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Pending allocations do not sum to requested quantity');
    assertRequestUsesFIFO(balance, request.batchAllocations, request.requestedQuantity);
  }
  for (const batch of persistedBatches as RecordValue[]) {
    const expectedHeld = byBatch.get(batch.batchId) ?? 0;
    if (batch.heldQuantity !== expectedHeld) {
      fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, expectedHeld === 0
        ? `StockBalance contains an orphan hold for batch ${batch.batchId}`
        : `Pending request hold differs from StockBalance for batch ${batch.batchId}`);
    }
  }
  const pendingQuantity = pending[0]?.requestedQuantity ?? 0;
  if (pendingQuantity !== balance.heldQuantity) fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'Aggregate held quantity differs from the pending request');
  const batches = Object.freeze((persistedBatches as RecordValue[]).map(batch => Object.freeze({ ...batch,
    actualUnitDimensionsM: Object.freeze({ ...batch.actualUnitDimensionsM }),
  })));
  return Object.freeze({
    ledger,
    onHandQuantity: balance.onHandQuantity,
    heldQuantity: balance.heldQuantity,
    availableQuantity: balance.onHandQuantity - balance.heldQuantity,
    batches,
  });
}

function receiptLine(batch: RecordValue, quantity: number) {
  const totalWeight = canonicalProductNumber([batch.actualUnitWeightKg], quantity, 3);
  const dimensions = batch.actualUnitDimensionsM;
  const totalVolume = canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], quantity, 6);
  if (totalWeight === null || totalVolume === null || totalWeight <= 0 || totalVolume <= 0) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, `Batch ${batch.batchId} removal line cannot be represented at canonical precision`);
  }
  return Object.freeze({
    batchId: batch.batchId,
    receiptMovementId: batch.receiptMovementId,
    ...(batch.receiptRequestId ? { receiptRequestId: batch.receiptRequestId } : {}),
    ...(batch.receivingInspectionEvidenceId ? { receivingInspectionEvidenceId: batch.receivingInspectionEvidenceId } : {}),
    action: MovementBatchAction.REMOVE,
    quantity,
    quantityUnit: batch.quantityUnit,
    actualUnitWeightKg: batch.actualUnitWeightKg,
    actualUnitDimensionsM: Object.freeze({ ...dimensions }),
    actualTotalWeightKg: totalWeight,
    actualTotalVolumeM3: totalVolume,
  });
}

/** Pure confirmation projection: consume only reserved batches, release unused holds, and derive counter deltas from before/after stock. */
export function calculateManagedOutboundConfirmation(input: {
  stockBalance: InventoryStockBalanceFields | RecordValue;
  request: RecordValue;
  deliveredQuantity: number;
}) {
  const balance = input.stockBalance as RecordValue;
  const batches = validateBalance(balance) as RecordValue[];
  const request = input.request;
  if (request?.state !== ManagedOutboundRequestState.PENDING || identity(request.itemId) !== identity(balance.itemId) ||
      identity(request.reservationId) !== identity(balance.managedReservationId) || identity(request.customerId) !== identity(balance.customerId) ||
      identity(request.facilityId) !== identity(balance.facilityId) || !Number.isSafeInteger(request.requestedQuantity) ||
      request.requestedQuantity <= 0 || !Number.isSafeInteger(input.deliveredQuantity) || input.deliveredQuantity <= 0 ||
      input.deliveredQuantity > request.requestedQuantity || !Array.isArray(request.batchAllocations)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Confirmation requires a pending request and positive delivery no greater than its reservation');
  }
  const unique = new Set<string>();
  let allocated = 0;
  const rows = request.batchAllocations.map((row: RecordValue) => {
    const batch = batches.find(candidate => candidate.batchId === row.batchId);
    if (!batch || unique.has(row.batchId) || !Number.isSafeInteger(row.quantity) || row.quantity <= 0 ||
        !identity(row.receiptMovementId) || identity(row.receiptMovementId) !== identity(batch.receiptMovementId) ||
        identity(row.receiptRequestId) !== identity(batch.receiptRequestId) ||
        identity(row.receivingInspectionEvidenceId) !== identity(batch.receivingInspectionEvidenceId) ||
        row.arithmeticPolicy !== batch.arithmeticPolicy || new Date(row.receivedAt).getTime() !== new Date(batch.receivedAt).getTime() ||
        row.quantity > batch.heldQuantity) {
      fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Stored request allocations have missing, stale, or unheld batch provenance');
    }
    unique.add(row.batchId);
    allocated += row.quantity;
    return { row, batch };
  }).sort((a: any, b: any) => new Date(a.batch.receivedAt).getTime() - new Date(b.batch.receivedAt).getTime() || a.batch.batchId.localeCompare(b.batch.batchId));
  if (allocated !== request.requestedQuantity || batches.some(batch => batch.heldQuantity !== (request.batchAllocations.find((row: RecordValue) => row.batchId === batch.batchId)?.quantity ?? 0))) {
    fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'StockBalance holds are not exactly represented by this single pending request');
  }
  if (request.quantityUnit !== batches[0]?.quantityUnit || batches.some(batch => batch.quantityUnit !== request.quantityUnit)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Request quantity unit differs from the Item receipt batches');
  }
  assertRequestUsesFIFO(balance, request.batchAllocations, request.requestedQuantity);

  let remainingToDeliver = input.deliveredQuantity;
  const consumed: RecordValue[] = [];
  const nextBatches = new Map<string, RecordValue>();
  for (const batch of batches) nextBatches.set(batch.batchId, { ...batch, actualUnitDimensionsM: { ...batch.actualUnitDimensionsM } });
  for (const { row, batch } of rows as Array<{ row: RecordValue; batch: RecordValue }>) {
    const consume = Math.min(remainingToDeliver, row.quantity);
    if (consume > 0) {
      consumed.push(receiptLine(batch, consume));
      remainingToDeliver -= consume;
    }
    const next = nextBatches.get(batch.batchId)!;
    next.heldQuantity -= row.quantity;
    next.quantity -= consume;
    if (next.quantity > 0) {
      next.actualTotalWeightKg = canonicalProductNumber([next.actualUnitWeightKg], next.quantity, 3);
      next.actualTotalVolumeM3 = canonicalProductNumber([next.actualUnitDimensionsM.widthM, next.actualUnitDimensionsM.depthM,
        next.actualUnitDimensionsM.heightM], next.quantity, 6);
      if (next.actualTotalWeightKg === null || next.actualTotalVolumeM3 === null) fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Remaining batch totals exceed canonical arithmetic range');
    } else nextBatches.delete(batch.batchId);
  }
  if (remainingToDeliver !== 0 || !consumed.length) fail(ManagedStockErrorCode.NEGATIVE_STOCK, 'Delivered quantity exceeds the request batch allocations');
  const remainingBatches = [...nextBatches.values()];
  const onHandQuantity = remainingBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  const heldQuantity = remainingBatches.reduce((sum, batch) => sum + batch.heldQuantity, 0);
  const beforeWeightUnits = sumExactPrecisionUnits(batches.map(batch => batch.actualTotalWeightKg), 3);
  const beforeVolumeUnits = sumExactPrecisionUnits(batches.map(batch => batch.actualTotalVolumeM3), 6);
  const afterWeightUnits = sumExactPrecisionUnits(remainingBatches.map(batch => batch.actualTotalWeightKg), 3);
  const afterVolumeUnits = sumExactPrecisionUnits(remainingBatches.map(batch => batch.actualTotalVolumeM3), 6);
  if (beforeWeightUnits === null || beforeVolumeUnits === null || afterWeightUnits === null || afterVolumeUnits === null ||
      beforeWeightUnits < afterWeightUnits || beforeVolumeUnits < afterVolumeUnits) {
    fail(ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH, 'Before/after stock physical totals cannot be reconciled');
  }
  const weightDelta = precisionUnitsToNumber(beforeWeightUnits! - afterWeightUnits!, 3);
  const volumeDelta = precisionUnitsToNumber(beforeVolumeUnits! - afterVolumeUnits!, 6);
  const lineWeightUnits = sumExactPrecisionUnits(consumed.map(line => line.actualTotalWeightKg), 3);
  const lineVolumeUnits = sumExactPrecisionUnits(consumed.map(line => line.actualTotalVolumeM3), 6);
  if (weightDelta === null || volumeDelta === null || lineWeightUnits === null || lineVolumeUnits === null) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, 'Outbound physical totals exceed the safe numeric range');
  }
  const first = consumed[0]!;
  const fulfilledState = input.deliveredQuantity < request.requestedQuantity
    ? ManagedOutboundRequestState.PARTIALLY_FULFILLED : ManagedOutboundRequestState.CONFIRMED;
  const nextBalance = Object.freeze({ ...balance,
    currentCellId: onHandQuantity === 0 ? null : balance.currentCellId,
    batches: Object.freeze(remainingBatches.map(batch => Object.freeze({ ...batch,
      actualUnitDimensionsM: Object.freeze({ ...batch.actualUnitDimensionsM }),
    }))),
    onHandQuantity,
    heldQuantity,
    actualTotalWeightKg: precisionUnitsToNumber(afterWeightUnits!, 3)!,
    actualTotalVolumeM3: precisionUnitsToNumber(afterVolumeUnits!, 6)!,
  });
  const movement = Object.freeze({
    type: ItemMovementType.OUTBOUND,
    quantity: input.deliveredQuantity,
    quantityUnit: request.quantityUnit,
    batchLines: Object.freeze(consumed),
    actualUnitWeightKg: first.actualUnitWeightKg,
    actualUnitDimensionsM: first.actualUnitDimensionsM,
    actualTotalWeightKg: precisionUnitsToNumber(lineWeightUnits!, 3)!,
    actualTotalVolumeM3: precisionUnitsToNumber(lineVolumeUnits!, 6)!,
    arithmeticPolicy: 'CANONICAL_V1' as const,
  });
  return Object.freeze({
    requestState: fulfilledState,
    requestedQuantity: request.requestedQuantity,
    fulfilledQuantity: input.deliveredQuantity,
    releasedHoldQuantity: request.requestedQuantity - input.deliveredQuantity,
    nextBalance,
    movement,
    itemTransition: Object.freeze({ status: onHandQuantity === 0 ? 'CHECKED_OUT' : 'IN_STORAGE', currentCellId: onHandQuantity === 0 ? null : balance.currentCellId }),
    counterDeltas: Object.freeze({ weightKg: weightDelta, volumeM3: volumeDelta }),
    onHandQuantity,
    heldQuantity,
    availableQuantity: onHandQuantity - heldQuantity,
  });
}

export function canTransitionManagedOutboundRequest(from: ManagedOutboundRequestState, to: ManagedOutboundRequestState): boolean {
  return from === ManagedOutboundRequestState.PENDING &&
    [ManagedOutboundRequestState.CONFIRMED, ManagedOutboundRequestState.PARTIALLY_FULFILLED, ManagedOutboundRequestState.CANCELLED].includes(to);
}

export function assertManagedOutboundRequestTransition(input: {
  from: ManagedOutboundRequestState;
  to: ManagedOutboundRequestState;
  expectedVersion: number;
  currentVersion: number;
}): void {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion !== input.currentVersion) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Outbound request version is stale');
  }
  if (!canTransitionManagedOutboundRequest(input.from, input.to)) {
    fail(ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT, 'Outbound request lifecycle transition is not allowed');
  }
}
