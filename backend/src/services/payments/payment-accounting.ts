import { PaymentPurpose, PaymentStatus } from '../../types/payment.type';

export interface RentalPaymentBreakdown {
  rentAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalDue: number;
  depositCredit: number;
  balanceDue: number;
}

export interface PaymentIdentity {
  reservationId: string;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export class PaymentAccountingError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PaymentAccountingError';
  }
}

function amount(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new PaymentAccountingError(400, `${name} must be a finite non-negative amount`);
  }
  return value;
}

/** Deposit is credited against rent; it is never added on top of the rent total. */
export function calculateRentalPaymentBreakdown(input: {
  rentAmount: unknown;
  depositAmount: unknown;
  taxAmount?: unknown;
  discountAmount?: unknown;
}): RentalPaymentBreakdown {
  const rentAmount = amount(input.rentAmount, 'rentAmount');
  const depositCredit = amount(input.depositAmount, 'depositAmount');
  const taxAmount = amount(input.taxAmount ?? 0, 'taxAmount');
  const discountAmount = amount(input.discountAmount ?? 0, 'discountAmount');
  const gross = rentAmount + taxAmount;
  if (!Number.isFinite(gross) || gross > Number.MAX_SAFE_INTEGER || discountAmount > gross) {
    throw new PaymentAccountingError(400, 'Invalid rental total');
  }
  const totalDue = gross - discountAmount;
  if (depositCredit > totalDue) {
    throw new PaymentAccountingError(409, 'Deposit exceeds the final rental amount');
  }
  return { rentAmount, taxAmount, discountAmount, totalDue, depositCredit, balanceDue: totalDue - depositCredit };
}

export function paymentAmountForPurpose(breakdown: RentalPaymentBreakdown, purpose: PaymentPurpose): number {
  if (purpose === PaymentPurpose.DEPOSIT) return breakdown.depositCredit;
  if (purpose === PaymentPurpose.BALANCE) return breakdown.balanceDue;
  throw new PaymentAccountingError(400, 'Unsupported payment purpose');
}

/** Reuse an idempotent request only when all economic identity fields match. */
export function assertIdempotentPaymentMatch(existing: PaymentIdentity, retry: PaymentIdentity): void {
  if (existing.idempotencyKey !== retry.idempotencyKey || existing.reservationId !== retry.reservationId ||
      existing.purpose !== retry.purpose || existing.amount !== retry.amount || existing.currency !== retry.currency) {
    throw new PaymentAccountingError(409, 'Idempotency key was already used for a different payment');
  }
}

/** Duplicate terminal callbacks are safe; contradictory terminal outcomes require reconciliation. */
export function transitionPaymentStatus(current: PaymentStatus, next: PaymentStatus): { status: PaymentStatus; idempotent: boolean } {
  if (current === next) return { status: current, idempotent: true };
  if (current !== PaymentStatus.PENDING || ![PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.RECONCILIATION_REQUIRED].includes(next)) {
    throw new PaymentAccountingError(409, 'Conflicting or invalid payment status transition');
  }
  return { status: next, idempotent: false };
}

/** Round VND to whole đồng using non-negative half-up rounding. */
export function roundVndAmount(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new PaymentAccountingError(400, 'VND amount must be finite and non-negative');
  }
  return Math.floor(value + 0.5);
}
