import { createHash } from 'crypto';
import {
  InventoryInboundCustodyState as Custody,
  InventoryInboundDimensionsM,
  InventoryInboundRequestState as State,
} from '../../types/inventory-inbound-request.type';

export interface ReceiptPhysicalPayload {
  requestedQuantity: number;
  quantityUnit: string;
  declaredUnitWeightKg: number;
  declaredUnitDimensionsM: InventoryInboundDimensionsM;
}

export type ReceiptInspectionDecision = 'ACCEPTED' | 'DISCREPANCY' | 'REJECTED';
export type ReceiptRequestEvent = 'INSPECT_ACCEPTED' | 'INSPECT_DISCREPANCY' | 'INSPECT_REJECTED' | 'RETURN_COMPLETED' | 'CONFIRM' | 'CANCEL';

export class ReceiptRequestLifecycleError extends Error {
  constructor(message: string) { super(message); this.name = 'ReceiptRequestLifecycleError'; }
}

export function validateReceiptPhysicalPayload(value: ReceiptPhysicalPayload): void {
  if (!Number.isSafeInteger(value?.requestedQuantity) || value.requestedQuantity <= 0) {
    throw new ReceiptRequestLifecycleError('requestedQuantity must be a positive safe integer');
  }
  if (typeof value.quantityUnit !== 'string' || !value.quantityUnit.trim() || value.quantityUnit.trim().length > 32) {
    throw new ReceiptRequestLifecycleError('quantityUnit must be a non-empty string of at most 32 characters');
  }
  if (typeof value.declaredUnitWeightKg !== 'number' || !Number.isFinite(value.declaredUnitWeightKg) || value.declaredUnitWeightKg <= 0) {
    throw new ReceiptRequestLifecycleError('declaredUnitWeightKg must be finite and positive');
  }
  const dimensions = value.declaredUnitDimensionsM;
  if (!dimensions || ![dimensions.widthM, dimensions.depthM, dimensions.heightM].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) {
    throw new ReceiptRequestLifecycleError('declaredUnitDimensionsM values must be finite and positive');
  }
}

export function assertAcceptedReceiptQuantityMatches(requestedQuantity: number, acceptedQuantity: number): void {
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0 ||
      !Number.isSafeInteger(acceptedQuantity) || acceptedQuantity !== requestedQuantity) {
    throw new ReceiptRequestLifecycleError('Accepted physical quantity must exactly match the requested quantity');
  }
}

export function canAmendReceiptRequest(state: State, custody: Custody, hasInspectionAttempt: boolean): boolean {
  // Require an explicit `false`: missing/unknown inspection history must fail closed.
  return state === State.PENDING_INSPECTION && custody === Custody.NOT_TAKEN && hasInspectionAttempt === false;
}

export function transitionReceiptRequest(state: State, custody: Custody, event: ReceiptRequestEvent,
  options: { custodyTaken?: boolean; hasInspectionAttempt?: boolean } = {}): { state: State; custodyState: Custody } {
  if (event === 'INSPECT_ACCEPTED') {
    if (![State.PENDING_INSPECTION, State.DISCREPANCY].includes(state) || options.custodyTaken !== true) {
      throw new ReceiptRequestLifecycleError('Acceptance requires an inspectable request and Facility custody');
    }
    return { state: State.ACCEPTED_PENDING_CONFIRMATION, custodyState: Custody.IN_CUSTODY };
  }
  if (event === 'INSPECT_DISCREPANCY') {
    if (![State.PENDING_INSPECTION, State.DISCREPANCY].includes(state)) throw new ReceiptRequestLifecycleError('Request cannot be reinspected in its current state');
    const custodyState = custody === Custody.IN_CUSTODY || options.custodyTaken === true
      ? Custody.IN_CUSTODY
      : custody;
    return { state: State.DISCREPANCY, custodyState };
  }
  if (event === 'INSPECT_REJECTED') {
    if (![State.PENDING_INSPECTION, State.DISCREPANCY].includes(state)) throw new ReceiptRequestLifecycleError('Request cannot be rejected in its current state');
    const facilityRetainsCustody = custody === Custody.IN_CUSTODY || options.custodyTaken === true;
    return facilityRetainsCustody
      ? { state: State.RETURN_PENDING, custodyState: Custody.IN_CUSTODY }
      : { state: State.REJECTED, custodyState: custody };
  }
  if (event === 'RETURN_COMPLETED') {
    if (state !== State.RETURN_PENDING || custody !== Custody.IN_CUSTODY) throw new ReceiptRequestLifecycleError('Return completion requires a request with goods in custody');
    return { state: State.REJECTED, custodyState: Custody.RETURNED };
  }
  if (event === 'CONFIRM') {
    if (state !== State.ACCEPTED_PENDING_CONFIRMATION || custody !== Custody.IN_CUSTODY) throw new ReceiptRequestLifecycleError('Only accepted goods held by the Facility can be confirmed');
    return { state: State.CONFIRMED, custodyState: Custody.IN_CUSTODY };
  }
  if (event === 'CANCEL') {
    if (state !== State.PENDING_INSPECTION || custody !== Custody.NOT_TAKEN || options.hasInspectionAttempt !== false) {
      throw new ReceiptRequestLifecycleError('Only a request with explicitly confirmed no inspection attempt and no custody can be cancelled');
    }
    return { state: State.CANCELLED, custodyState: Custody.NOT_TAKEN };
  }
  throw new ReceiptRequestLifecycleError('Unsupported receipt request event');
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    return (value as { toHexString(): string }).toHexString().toLowerCase();
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalize(record[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ReceiptRequestLifecycleError('Idempotency payload cannot contain non-finite numbers');
  if (value === undefined) throw new ReceiptRequestLifecycleError('Idempotency payload cannot contain undefined values');
  return value;
}

export function canonicalReceiptPayloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

export function assertSameReceiptPayload(expectedHash: string, actualPayload: unknown): void {
  if (expectedHash !== canonicalReceiptPayloadHash(actualPayload)) throw new ReceiptRequestLifecycleError('Idempotency key was already used with a different payload');
}
