import { ManagedV3OutboundAllocation, ManagedV3OutboundState } from '../../types/managed-inventory-v3-outbound.type';
import { canonicalA2RemovalAmounts } from './managed-inventory-v3-ledger.service';

type Row = Record<string, any>;
export class ManagedV3OutboundDomainError extends Error { constructor(public code: string, message: string) { super(message); } }
const invalid = (code: string, message: string): never => { throw new ManagedV3OutboundDomainError(code, message); };
const id = (value: any) => String(value?._id ?? value ?? '');
const normalized = (value: any): any => value?.toHexString ? value.toHexString() : value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).filter(key => !['_id', '__v', 'createdAt', 'updatedAt'].includes(key) && value[key] !== undefined).sort().map(key => [key, normalized(value[key])])) : value;
const equal = (left: any, right: any) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
const placementKey = (line: Row) => line.itemKind === 'A1_PHYSICAL_UNIT' ? `U:${id(line.physicalUnitId)}:${id(line.cellId)}` : `B:${line.batchId}:${id(line.cellId)}`;

/** Replays immutable request events; pending request documents are projections that must match the event fold exactly. */
export function reconcileManagedV3OutboundHolds(eventsInput: Row[], requestsInput: Row[]) {
  if (!Array.isArray(eventsInput) || !Array.isArray(requestsInput)) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Outbound request history is unavailable');
  const events = [...eventsInput].sort((a, b) => id(a.requestId).localeCompare(id(b.requestId)) || a.resultingVersion - b.resultingVersion);
  const folded = new Map<string, { state: string; version: number; allocations: Row[]; requestHash: string }>();
  for (const event of events) {
    const key = id(event.requestId), current = folded.get(key);
    if (event.operation === 'CREATE') {
      if (current || event.resultingState !== ManagedV3OutboundState.PENDING || event.resultingVersion !== 0 || !event.allocationSnapshot?.length) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Invalid outbound hold creation history');
      folded.set(key, { state: event.resultingState, version: 0, allocations: event.allocationSnapshot, requestHash: event.requestHash });
      continue;
    }
    if (!current) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Outbound hold event sequence is incomplete or inconsistent');
    const existing = current as { state: string; version: number; allocations: Row[]; requestHash: string };
    if (event.resultingVersion !== existing.version + 1 || !equal(event.allocationSnapshot, existing.allocations)) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Outbound hold event sequence is incomplete or inconsistent');
    if (existing.state !== ManagedV3OutboundState.PENDING || !['CANCEL', 'CONFIRM'].includes(event.operation) || ![ManagedV3OutboundState.CANCELLED, ManagedV3OutboundState.CONFIRMED].includes(event.resultingState)) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Invalid terminal outbound hold transition');
    existing.state = event.resultingState; existing.version = event.resultingVersion;
  }
  const byId = new Map(requestsInput.map(row => [id(row._id), row]));
  if (byId.size !== folded.size) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Request documents do not match immutable hold history');
  for (const [key, history] of folded) {
    const request = byId.get(key);
    if (!request || request.state !== history.state || request.version !== history.version || request.requestHash !== history.requestHash ||
        !equal(request.allocations, history.allocations)) invalid('OUTBOUND_HOLDS_UNKNOWN', 'Request projection differs from immutable hold history');
  }
  const pending = [...folded.entries()].filter(([, row]) => row.state === ManagedV3OutboundState.PENDING);
  if (pending.length > 1) invalid('OUTBOUND_HOLDS_UNKNOWN', 'More than one pending V3 outbound operation exists for this SKU');
  const allocations = pending.flatMap(([, row]) => row.allocations);
  const totals = new Map<string, number>();
  for (const line of allocations) { const key = placementKey(line); totals.set(key, (totals.get(key) ?? 0) + line.quantity); }
  return { pendingRequestIds: pending.map(([requestId]) => requestId), allocations, heldByPlacement: totals };
}

export function allocateManagedV3Fifo(projection: Row, requestedQuantity: number): ManagedV3OutboundAllocation[] {
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || !projection || !Array.isArray(projection.byBatch)) invalid('INVALID_OUTBOUND_QUANTITY', 'Outbound quantity must be a positive integer');
  const ordered = [...projection.byBatch].sort((a, b) => new Date(a.receivedAt ?? 0).getTime() - new Date(b.receivedAt ?? 0).getTime() ||
    id(a.receiptMovementId).localeCompare(id(b.receiptMovementId)) || String(a.batchId).localeCompare(String(b.batchId)) || id(a.cellId).localeCompare(id(b.cellId)));
  let remaining = requestedQuantity;
  const result: ManagedV3OutboundAllocation[] = [];
  for (const line of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, line.quantity);
    if (take < 1) continue;
    const metrics = canonicalA2RemovalAmounts(line, take);
    result.push({ itemKind: 'A2_BATCH', batchId: line.batchId, cellId: line.cellId, quantity: take, quantityUnit: line.quantityUnit,
      weightKg: metrics.removedWeightKg, volumeM3: metrics.removedVolumeM3, receiptMovementId: line.receiptMovementId,
      topologyCertificationId: line.topologyCertificationId, topologyRevision: line.topologyRevision });
    remaining -= take;
  }
  if (remaining !== 0) invalid('OUTBOUND_QUANTITY_UNAVAILABLE', 'Requested quantity exceeds FIFO-available V3 stock');
  return result;
}

/** Resolve the latest committed physical footprint after any prior A1 MOVE without falling back to legacy currentCellId. */
export function currentManagedV3A1Footprint(movementsInput: Row[], physicalUnitId: string): Row[] {
  if (!Array.isArray(movementsInput) || !physicalUnitId) invalid('A1_FOOTPRINT_UNKNOWN', 'A1 movement history and unit identity are required');
  const movements = [...movementsInput].sort((a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime() || id(a._id).localeCompare(id(b._id)));
  let latest: Row | null = null;
  for (const movement of movements) {
    const effect = movement.v3Effect;
    if (movement.schemaVersion !== 3 || !effect || !['ADD', 'MOVE', 'REMOVE'].includes(effect.action)) continue;
    const touches = [...(effect.source ?? []), ...(effect.destination ?? [])].some(line => id(line.physicalUnitId) === physicalUnitId);
    if (touches) latest = movement;
  }
  if (!latest || latest.v3Effect.action === 'REMOVE') invalid('A1_FOOTPRINT_UNKNOWN', 'PhysicalUnit has no active canonical footprint');
  const current = latest as Row;
  const footprint = (current.v3Effect.destination ?? []).filter((line: Row) => id(line.physicalUnitId) === physicalUnitId);
  if (!footprint.length || new Set(footprint.map((line: Row) => id(line.cellId))).size !== footprint.length) invalid('A1_FOOTPRINT_UNKNOWN', 'Latest A1 footprint is missing or duplicated');
  return footprint;
}
