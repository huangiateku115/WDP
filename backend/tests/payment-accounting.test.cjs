const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateRentalPaymentBreakdown, paymentAmountForPurpose, assertIdempotentPaymentMatch,
  transitionPaymentStatus, PaymentAccountingError } = require('../dist/services/payments/payment-accounting');
const { PaymentPurpose, PaymentStatus } = require('../dist/types/payment.type');
const Payment = require('../dist/models/payments/reservation-payment.model').default;

test('deposit is credited toward total rent and balance is only the remainder', () => {
  const breakdown = calculateRentalPaymentBreakdown({ rentAmount: 1_000, depositAmount: 250, taxAmount: 50, discountAmount: 100 });
  assert.deepEqual(breakdown, { rentAmount: 1_000, taxAmount: 50, discountAmount: 100, totalDue: 950, depositCredit: 250, balanceDue: 700 });
  assert.equal(paymentAmountForPurpose(breakdown, PaymentPurpose.DEPOSIT), 250);
  assert.equal(paymentAmountForPurpose(breakdown, PaymentPurpose.BALANCE), 700);
  assert.equal(breakdown.depositCredit + breakdown.balanceDue, breakdown.totalDue);
});

test('invalid amounts and deposit greater than final rent fail closed', () => {
  assert.throws(() => calculateRentalPaymentBreakdown({ rentAmount: 100, depositAmount: 101 }), PaymentAccountingError);
  assert.throws(() => calculateRentalPaymentBreakdown({ rentAmount: Number.NaN, depositAmount: 0 }), PaymentAccountingError);
  assert.throws(() => calculateRentalPaymentBreakdown({ rentAmount: 100, depositAmount: 0, discountAmount: 101 }), PaymentAccountingError);
});

test('payment purpose is limited to DEPOSIT and BALANCE and schema enforces idempotency indexes', () => {
  assert.deepEqual(Object.values(PaymentPurpose).sort(), ['BALANCE', 'DEPOSIT']);
  const indexes = Payment.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.idempotencyKey === 1 && options.unique));
  assert.ok(indexes.some(([keys, options]) => keys.reservationId === 1 && keys.purpose === 1 && options.unique && options.partialFilterExpression?.status === 'SUCCEEDED'));
});

test('same payment idempotency request can replay but key reuse with changed amount/purpose conflicts', () => {
  const original = { reservationId: 'r-1', purpose: PaymentPurpose.DEPOSIT, amount: 250, currency: 'VND', idempotencyKey: 'idem-1' };
  assert.doesNotThrow(() => assertIdempotentPaymentMatch(original, { ...original }));
  assert.throws(() => assertIdempotentPaymentMatch(original, { ...original, amount: 251 }), error => error instanceof PaymentAccountingError && error.status === 409);
  assert.throws(() => assertIdempotentPaymentMatch(original, { ...original, purpose: PaymentPurpose.BALANCE }), error => error instanceof PaymentAccountingError && error.status === 409);
});

test('payment transition accepts first result and identical callback, rejects conflicting terminal callback', () => {
  assert.deepEqual(transitionPaymentStatus(PaymentStatus.PENDING, PaymentStatus.SUCCEEDED), { status: PaymentStatus.SUCCEEDED, idempotent: false });
  assert.deepEqual(transitionPaymentStatus(PaymentStatus.SUCCEEDED, PaymentStatus.SUCCEEDED), { status: PaymentStatus.SUCCEEDED, idempotent: true });
  assert.throws(() => transitionPaymentStatus(PaymentStatus.SUCCEEDED, PaymentStatus.FAILED), error => error instanceof PaymentAccountingError && error.status === 409);
});
