import test from 'node:test';
import assert from 'node:assert/strict';
import { apiBaseURL, assertConfirmedRequest } from '../src/api/confirmedContract.js';
import { canOpenPayosCheckout, canShowPayosQr, createPayosPaymentApi, isSafePayosCheckoutUrl } from '../src/api/payosPaymentClient.js';
import {
  assessPayosEligibility,
  canStartNewPayosAttempt,
  eligiblePayosPurpose,
  newPayosIdempotencyKey,
  mergePayosPaymentHistory,
  paymentErrorMessage,
  paymentStatusView,
  normalizePayosReferenceId,
  payosContractMatchesIdentity,
  payosEligibilityMessage,
  formatPayosVnd,
  readPayosAttempts,
  trackingStorageKey,
  unresolvedPayosPayment,
  writePayosAttempts,
} from '../src/lib/selfStoragePayos.js';
import { canSign } from '../src/lib/customerReservationService.js';
import { createPayosQrDataUrl } from '../src/lib/selfStoragePayosQr.js';
import { isPayosPaymentPollable, pollPayosPaymentStatuses } from '../src/lib/selfStoragePayosPolling.js';
import { customerPaymentStatus, selectOwnedSelfStorageReservation } from '../src/lib/selfStoragePaymentHistory.js';
import { readOrCreateSelfStorageBookingAttempt, writeSelfStorageBookingAttempt } from '../src/lib/selfStorageReservation.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const reservationId = '507f1f77bcf86cd799439011';
const paymentId = '507f1f77bcf86cd799439012';
const customerId = '507f1f77bcf86cd799439013';
const contractId = '507f1f77bcf86cd799439014';
const paymentRecord = (overrides = {}) => ({
  id: paymentId,
  reservationId,
  purpose: 'DEPOSIT',
  amount: 250000,
  currency: 'VND',
  provider: 'PAYOS',
  status: 'PENDING',
  applicationStatus: 'NOT_APPLIED',
  providerSettlementStatus: 'NOT_VERIFIED',
  checkoutStatus: 'READY',
  checkoutUrl: 'https://pay.payos.vn/web/example',
  qrCode: '00020101021229370016A0000006770101110113006688123456785204581253037045802VN6304ABCD',
  succeededAt: null,
  reconciliationRequired: false,
  retryAllowed: false,
  cancelVerifiedAt: null,
  ...overrides,
});
const response = (status, data, outcome = 'CREATED') => ({
  status,
  data: { success: true, outcome, data },
});

test('PayOS allowlist permits only the exact Customer create and status paths', () => {
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'POST', url: `/reservations/${reservationId}/payments/payos` }));
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'GET', url: `/reservations/${reservationId}/payments/${paymentId}` }));
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'GET', url: `/reservations/${reservationId}/payments/payos?limit=10` }));
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'POST', url: `/reservations/${reservationId}/payments/${paymentId}/reconcile` }));
  for (const config of [
    { method: 'POST', url: `/reservations/${reservationId}/payments/${paymentId}` },
    { method: 'POST', url: `/reservations/${reservationId}/payments/payos/extra` },
    { method: 'GET', url: `/reservations/${reservationId}/payments/not-an-id` },
    { method: 'PUT', url: `/reservations/${reservationId}/payments/payos` },
  ]) assert.throws(() => assertConfirmedRequest(config));
});

test('Managed V3 PayOS paths and explicit handover are allowlisted with exact methods', () => {
  for (const config of [
    { method: 'POST', url: `/reservations/managed/${reservationId}/payments/payos` },
    { method: 'GET', url: `/reservations/managed/${reservationId}/payments/payos?limit=5` },
    { method: 'GET', url: `/reservations/managed/${reservationId}/payments/${paymentId}` },
    { method: 'POST', url: `/reservations/managed/${reservationId}/handover` },
  ]) assert.doesNotThrow(() => assertConfirmedRequest(config));
  assert.throws(() => assertConfirmedRequest({ method: 'PATCH', url: `/reservations/managed/${reservationId}/payments/payos` }));
});

test('Payment history API validates Reservation, bounded pagination and response identity', async () => {
  const calls = [];
  const api = createPayosPaymentApi({
    post: async () => undefined,
    get: async (...args) => {
      calls.push(args);
      return { status: 200, data: { success: true, data: { items: [paymentRecord({ createdAt: '2026-10-01T00:00:00.000Z' })], nextCursor: 'next_cursor' } } };
    },
  });
  const page = await api.listPayosPaymentsForReservation(reservationId, { limit: 5, cursor: 'cursor_1' });
  assert.deepEqual(calls[0], [`/reservations/${reservationId}/payments/payos?limit=5&cursor=cursor_1`]);
  assert.equal(page.items[0].id, paymentId);
  assert.equal(page.nextCursor, 'next_cursor');
  await assert.rejects(api.listPayosPaymentsForReservation('bad-id'));
  await assert.rejects(api.listPayosPaymentsForReservation(reservationId, { limit: 26 }));
  await assert.rejects(api.listPayosPaymentsForReservation(reservationId, { cursor: 'bad cursor' }));
});

test('local Frontend can target the Render API base without changing its versioned path', () => {
  assert.equal(apiBaseURL('https://wdp-m4ns.onrender.com/api/v1'), 'https://wdp-m4ns.onrender.com/api/v1');
  assert.equal(apiBaseURL('https://wdp-m4ns.onrender.com/'), 'https://wdp-m4ns.onrender.com/api/v1');
});

test('PayOS API client posts only purpose with the stable Idempotency-Key and parses 201/200 envelopes', async () => {
  const calls = [];
  const client = {
    post: async (...args) => { calls.push(args); return response(201, paymentRecord()); },
    get: async () => undefined,
  };
  const api = createPayosPaymentApi(client);
  const created = await api.createPayosCheckout(reservationId, 'DEPOSIT', 'wdp-stable-attempt');
  assert.equal(created.httpStatus, 201);
  assert.equal(created.outcome, 'CREATED');
  assert.deepEqual(calls[0], [
    `/reservations/${reservationId}/payments/payos`,
    { purpose: 'DEPOSIT' },
    { headers: { 'Idempotency-Key': 'wdp-stable-attempt' } },
  ]);

  client.post = async () => response(200, paymentRecord(), 'REPLAYED');
  const replay = await api.createPayosCheckout(reservationId, 'DEPOSIT', 'wdp-stable-attempt');
  assert.equal(replay.httpStatus, 200);
  assert.equal(replay.outcome, 'REPLAYED');
});

test('Managed V3 PayOS calls use the managed routes and zero balance requires a Backend PAID confirmation', async () => {
  const calls = [];
  const client = {
    post: async (...args) => { calls.push(args); return response(201, paymentRecord()); },
    get: async (...args) => { calls.push(args); return { status: 200, data: { success: true, data: { items: [], nextCursor: null } } }; },
  };
  const api = createPayosPaymentApi(client);
  await api.createPayosCheckout(reservationId, 'DEPOSIT', 'wdp-managed-key', 'MANAGED_INVENTORY');
  await api.listPayosPaymentsForReservation(reservationId, { limit: 10, serviceType: 'MANAGED_INVENTORY' });
  assert.equal(calls[0][0], `/reservations/managed/${reservationId}/payments/payos`);
  assert.equal(calls[0][2].headers['Idempotency-Key'], 'wdp-managed-key');
  assert.equal(calls[1][0], `/reservations/managed/${reservationId}/payments/payos?limit=10`);

  const zero = createPayosPaymentApi({ post: async () => response(200, { zeroBalance: true,
    reservation: { serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: 'PAID', balanceSettledAt: '2026-11-10T00:00:00.000Z' } }, 'SETTLED'), get: async () => undefined });
  assert.equal((await zero.createPayosCheckout(reservationId, 'BALANCE', 'wdp-managed-balance', 'MANAGED_INVENTORY')).zeroBalance, true);
  const malformed = createPayosPaymentApi({ post: async () => response(200, { zeroBalance: true, reservation: { serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: 'ACTIVE' } }, 'SETTLED'), get: async () => undefined });
  await assert.rejects(malformed.createPayosCheckout(reservationId, 'BALANCE', 'wdp-managed-balance', 'MANAGED_INVENTORY'));
});

test('PayOS API rejects invalid IDs, purpose, idempotency keys and malformed payment DTOs', async () => {
  let postCalls = 0;
  const api = createPayosPaymentApi({
    post: async () => { postCalls += 1; return response(201, paymentRecord()); },
    get: async () => undefined,
  });
  await assert.rejects(api.createPayosCheckout('bad-id', 'DEPOSIT', 'key'));
  await assert.rejects(api.createPayosCheckout(reservationId, 'MOCK', 'key'));
  await assert.rejects(api.createPayosCheckout(reservationId, 'DEPOSIT', 'bad\nkey'));
  assert.equal(postCalls, 0);

  const malformed = createPayosPaymentApi({
    post: async () => response(201, paymentRecord({ amount: 1.5 })),
    get: async () => undefined,
  });
  await assert.rejects(malformed.createPayosCheckout(reservationId, 'DEPOSIT', 'key'));
  const statusMismatch = createPayosPaymentApi({
    post: async () => response(200, paymentRecord()),
    get: async () => undefined,
  });
  await assert.rejects(statusMismatch.createPayosCheckout(reservationId, 'DEPOSIT', 'key'));
});

test('Only an eligible pending READY PayOS checkout can be opened; completed URLs stay hidden', () => {
  assert.equal(canOpenPayosCheckout(paymentRecord()), true);
  assert.equal(canOpenPayosCheckout(paymentRecord({ status: 'SUCCEEDED' })), false);
  assert.equal(canOpenPayosCheckout(paymentRecord({ status: 'FAILED' })), false);
  assert.equal(canOpenPayosCheckout(paymentRecord({ checkoutStatus: 'UNKNOWN' })), false);
  assert.equal(canOpenPayosCheckout(paymentRecord({ applicationStatus: 'MANUAL_REVIEW' })), false);
  assert.equal(canOpenPayosCheckout(paymentRecord({ providerSettlementStatus: 'VERIFIED' })), false);
  assert.equal(canOpenPayosCheckout(paymentRecord({ reconciliationRequired: true })), false);
  assert.equal(isSafePayosCheckoutUrl('http://pay.payos.vn/web/example'), false);
  assert.equal(isSafePayosCheckoutUrl('https://user:pass@pay.payos.vn/web/example'), false);
  assert.equal(isSafePayosCheckoutUrl('https://evil.example/web/example'), false);
  assert.equal(isSafePayosCheckoutUrl('https://pay.payos.vn.evil.example/web/example'), false);
  assert.equal(isSafePayosCheckoutUrl('https://pay.payos.vn/other/example'), false);
  assert.equal(isSafePayosCheckoutUrl('not a URL'), false);
});

test('Customer VND amounts use Vietnamese grouping and reject invalid instructions', () => {
  assert.equal(formatPayosVnd(1500000), '1.500.000');
  assert.equal(formatPayosVnd(-1), '—');
  assert.equal(formatPayosVnd(1.2), '—');
});

test('Self-Storage booking retries reuse a persisted idempotency key and reservation identity', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const payload = { facilityId: reservationId, storageUnitId: paymentId, pricingPolicyId: customerId,
    startDate: '2026-12-01T00:00:00.000Z', endDate: '2027-01-01T00:00:00.000Z' };
  const first = readOrCreateSelfStorageBookingAttempt(storage, contractId, payload);
  assert.match(first.idempotencyKey, /^wdp-booking-/);
  assert.equal(first.reservationId, null);
  const replay = readOrCreateSelfStorageBookingAttempt(storage, contractId, payload);
  assert.equal(replay.idempotencyKey, first.idempotencyKey);
  writeSelfStorageBookingAttempt(storage, { ...first, reservationId: paymentId });
  assert.equal(readOrCreateSelfStorageBookingAttempt(storage, contractId, payload).reservationId, paymentId);
  assert.notEqual(readOrCreateSelfStorageBookingAttempt(storage, contractId, { ...payload, endDate: '2027-02-01T00:00:00.000Z' }).idempotencyKey, first.idempotencyKey);
});

test('only a valid provider QR payload on an eligible pending checkout can be shown', () => {
  assert.equal(canShowPayosQr(paymentRecord()), true);
  assert.equal(canShowPayosQr(paymentRecord({ status: 'SUCCEEDED' })), false);
  assert.equal(canShowPayosQr(paymentRecord({ checkoutStatus: 'UNKNOWN' })), false);
  assert.equal(canShowPayosQr(paymentRecord({ applicationStatus: 'MANUAL_REVIEW' })), false);
  assert.equal(canShowPayosQr(paymentRecord({ providerSettlementStatus: 'VERIFIED' })), false);
  assert.equal(canShowPayosQr(paymentRecord({ qrCode: 'not-a-provider-payload' })), false);
  assert.equal(canShowPayosQr(paymentRecord({ qrCode: `000201${'A'.repeat(4096)}` })), false);
});

test('provider QR payload is rendered locally as a scannable PNG data URL', async () => {
  const image = await createPayosQrDataUrl(paymentRecord());
  assert.match(image, /^data:image\/png;base64,/);
  const balanceImage = await createPayosQrDataUrl(paymentRecord({ purpose: 'BALANCE', amount: 325000 }));
  assert.match(balanceImage, /^data:image\/png;base64,/);
  assert.equal(await createPayosQrDataUrl(paymentRecord({ qrCode: 'invalid' })), null);
  assert.equal(await createPayosQrDataUrl(paymentRecord({ applicationStatus: 'MANUAL_REVIEW' })), null);
});

test('automatic polling reads only eligible pending attempts and refreshes Reservation only for VERIFIED + APPLIED', async () => {
  const pending = paymentRecord();
  const manualReview = paymentRecord({ id: customerId, applicationStatus: 'MANUAL_REVIEW' });
  const unknown = paymentRecord({ id: contractId, checkoutStatus: 'UNKNOWN' });
  assert.equal(isPayosPaymentPollable(pending), true);
  assert.equal(isPayosPaymentPollable(manualReview), false);
  assert.equal(isPayosPaymentPollable(unknown), false);

  const calls = [];
  const updates = [];
  const applied = [];
  let token = 'session-one';
  await pollPayosPaymentStatuses({
    payments: [pending, manualReview, unknown],
    reservationId,
    paymentApi: { getPayosPaymentStatus: async (...args) => {
      calls.push(args);
      return paymentRecord({ providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED' });
    } },
    getAccessToken: () => token,
    isCurrent: () => true,
    onPayment: (payment) => updates.push(payment),
    onApplied: async (payment) => applied.push(payment),
  });
  assert.deepEqual(calls, [[reservationId, paymentId]]);
  assert.equal(updates.length, 1);
  assert.equal(applied.length, 1);
  assert.equal(token, 'session-one');
});

test('PayOS status uses the exact owner-scoped reservation route and rejects mismatched identity', async () => {
  const calls = [];
  const api = createPayosPaymentApi({
    post: async () => undefined,
    get: async (...args) => {
      calls.push(args);
      return { status: 200, data: { success: true, data: paymentRecord() } };
    },
  });
  const payment = await api.getPayosPaymentStatus(reservationId, paymentId);
  assert.equal(payment.id, paymentId);
  assert.ok(payment.qrCode.startsWith('000201'));
  assert.deepEqual(calls[0], [`/reservations/${reservationId}/payments/${paymentId}`]);
  const malformed = createPayosPaymentApi({
    post: async () => undefined,
    get: async () => ({ status: 200, data: { success: true, data: paymentRecord({ id: customerId }) } }),
  });
  await assert.rejects(malformed.getPayosPaymentStatus(reservationId, paymentId));

  const invalidQr = createPayosPaymentApi({
    post: async () => undefined,
    get: async () => ({ status: 200, data: { success: true, data: paymentRecord({ qrCode: 'https://qr-image-service.example/image' }) } }),
  });
  assert.equal((await invalidQr.getPayosPaymentStatus(reservationId, paymentId)).qrCode, null);
});

test('Deposit eligibility accepts an unexpired DRAFT contract without requiring SIGNED', () => {
  const reservation = {
    _id: reservationId, customerId, serviceType: 'SELF_STORAGE', status: 'CONTRACTED',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const contract = { _id: contractId, reservationId, customerId, status: 'DRAFT' };
  assert.equal(eligiblePayosPurpose(reservation, contract), 'DEPOSIT');
  assert.deepEqual(assessPayosEligibility(reservation, contract, Date.now(), customerId), {
    eligible: true, purpose: 'DEPOSIT', reason: 'ELIGIBLE',
  });
  assert.equal(eligiblePayosPurpose({ ...reservation, expiresAt: new Date(Date.now() - 1_000).toISOString() }, contract), null);
  assert.equal(eligiblePayosPurpose(reservation, { ...contract, status: 'SIGNED' }), null);
  assert.equal(eligiblePayosPurpose({ ...reservation, serviceType: 'MANAGED_INVENTORY' }, contract), null);
});

test('PayOS eligibility safely normalizes populated BSON references without stringifying documents', () => {
  const objectId = hex => ({ _bsontype: 'ObjectId', toHexString: () => hex });
  const reservation = {
    _id: objectId(reservationId), customerId: objectId(customerId),
    serviceType: 'SELF_STORAGE', status: 'CONTRACTED',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const contract = {
    _id: objectId(contractId), reservationId: { _id: objectId(reservationId) },
    customerId: { _id: objectId(customerId) }, status: 'DRAFT',
  };
  assert.equal(normalizePayosReferenceId(contract.reservationId), reservationId);
  assert.equal(payosContractMatchesIdentity(contract, reservationId, customerId), true);
  assert.equal(assessPayosEligibility(reservation, contract, Date.now(), customerId).purpose, 'DEPOSIT');

  const stringReferences = { ...contract, reservationId, customerId };
  assert.equal(payosContractMatchesIdentity(stringReferences, reservationId, customerId), true);
  assert.equal(assessPayosEligibility({ ...reservation, _id: reservationId, customerId }, stringReferences, Date.now(), customerId).purpose, 'DEPOSIT');
});

test('PayOS eligibility returns safe precise reasons and fails closed for invalid or mismatched records', () => {
  const reservation = {
    _id: reservationId, customerId, serviceType: 'SELF_STORAGE', status: 'CONTRACTED',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const contract = { _id: contractId, reservationId, customerId, status: 'DRAFT' };
  const reason = (r = reservation, c = contract, now, owner = customerId) =>
    assessPayosEligibility(r, c, now, owner).reason;
  assert.equal(reason({ ...reservation, _id: 'invalid' }), 'INVALID_RESERVATION_ID');
  assert.equal(reason(reservation, { ...contract, _id: 'invalid' }), 'INVALID_CONTRACT_ID');
  assert.equal(reason(reservation, { ...contract, reservationId: '507f1f77bcf86cd799439099' }), 'CONTRACT_RESERVATION_MISMATCH');
  assert.equal(reason(reservation, { ...contract, customerId: '507f1f77bcf86cd799439099' }), 'CONTRACT_CUSTOMER_MISMATCH');
  assert.equal(reason(reservation, null), 'CONTRACT_NOT_LOADED');
  assert.equal(reason({ ...reservation, serviceType: 'MANAGED_INVENTORY' }), 'UNSUPPORTED_SERVICE');
  assert.equal(reason({ ...reservation, status: 'PAID' }), 'INVALID_RESERVATION_STATUS');
  assert.equal(reason(reservation, { ...contract, status: 'SIGNED' }), 'CONTRACT_NOT_DRAFT');
  assert.equal(reason(reservation, contract, Date.now() + 120_000), 'RESERVATION_HOLD_EXPIRED');
  assert.equal(payosEligibilityMessage('CONTRACT_LOAD_FAILED'), 'The linked Contract could not be verified because it failed to load. Retry contract lookup; no payment was started.');
});

test('Self-Storage cannot sign before Deposit; signing remains available after DEPOSIT_PAID', () => {
  const reservation = { serviceType: 'SELF_STORAGE', status: 'CONTRACTED' };
  const draft = { status: 'DRAFT' };
  assert.equal(canSign(draft, reservation), false);
  assert.equal(canSign(draft, { ...reservation, status: 'DEPOSIT_PAID' }), true);
  assert.equal(canSign({ ...draft, status: 'SIGNED' }, { ...reservation, status: 'DEPOSIT_PAID' }), false);
});

test('Balance eligibility requires CHECKIN_READY and verified signed-paper proof', () => {
  const reservation = { _id: reservationId, serviceType: 'SELF_STORAGE', status: 'CHECKIN_READY' };
  const contract = {
    _id: contractId, reservationId, status: 'SIGNED', signedProofPublicId: 'proof',
    signedProofUrl: 'https://assets.example/proof.pdf', verifiedAt: new Date().toISOString(),
  };
  assert.equal(eligiblePayosPurpose(reservation, contract), 'BALANCE');
  assert.equal(eligiblePayosPurpose(reservation, { ...contract, verifiedAt: null }), null);
  assert.equal(eligiblePayosPurpose({ ...reservation, status: 'PAID' }, contract), null);
});

test('Managed V3 Deposit and Balance eligibility follow V3 hold, current hash signatures, and ownership', () => {
  const v3 = { _id: reservationId, customerId, facilityId: '507f1f77bcf86cd799439015', serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3,
    status: 'RESERVED', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(assessPayosEligibility(v3, null, Date.now(), customerId).purpose, 'DEPOSIT');
  assert.equal(assessPayosEligibility({ ...v3, customerId: '507f1f77bcf86cd799439099' }, null, Date.now(), customerId).purpose, null);
  const active = { version: 1, contentHash: 'a'.repeat(64) };
  const contract = { _id: contractId, reservationId, customerId, status: 'SIGNED', currentContentVersion: 1,
    contentVersions: [active], signatures: [
      { version: 1, contentHash: active.contentHash, signerRole: 'CUSTOMER' },
      { version: 1, contentHash: active.contentHash, signerRole: 'FACILITY_STAFF' },
    ] };
  assert.equal(assessPayosEligibility({ ...v3, status: 'DEPOSIT_PAID', expiresAt: undefined }, contract, Date.now(), customerId).purpose, 'BALANCE');
  assert.equal(assessPayosEligibility({ ...v3, status: 'DEPOSIT_PAID' }, { ...contract, signatures: [contract.signatures[0]] }, Date.now(), customerId).purpose, null);
});

test('Payment status never confuses provider success with applied Reservation payment', () => {
  assert.equal(paymentStatusView(paymentRecord({ providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED' })).key, 'APPLIED');
  assert.equal(paymentStatusView(paymentRecord({ providerSettlementStatus: 'VERIFIED', applicationStatus: 'MANUAL_REVIEW' })).key, 'MANUAL_REVIEW');
  assert.equal(paymentStatusView(paymentRecord({ status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'NOT_APPLIED' })).key, 'SUCCEEDED_UNAPPLIED');
  assert.equal(paymentStatusView(paymentRecord({ checkoutStatus: 'UNKNOWN' })).key, 'UNCERTAIN');
  const unknownAttempt = paymentRecord({ checkoutStatus: 'UNKNOWN' });
  assert.equal(unresolvedPayosPayment([unknownAttempt], 'DEPOSIT').id, paymentId);
  assert.equal(canStartNewPayosAttempt(unknownAttempt), false);
  assert.equal(paymentStatusView(paymentRecord({
    status: 'FAILED', checkoutStatus: 'RECONCILIATION_REQUIRED', reconciliationRequired: false,
  })).key, 'FAILED');
  assert.equal(paymentStatusView(paymentRecord({
    status: 'FAILED', checkoutStatus: 'RECONCILIATION_REQUIRED', reconciliationRequired: true,
  })).key, 'RECONCILIATION_REQUIRED');
});

test('Payment history uses friendly status labels and requires VERIFIED plus APPLIED for success', () => {
  assert.equal(customerPaymentStatus(paymentRecord({ providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED' })).label, 'Thanh toán thành công');
  assert.equal(customerPaymentStatus(paymentRecord({ providerSettlementStatus: 'VERIFIED', applicationStatus: 'MANUAL_REVIEW' })).label, 'Cần kiểm tra giao dịch');
  assert.equal(customerPaymentStatus(paymentRecord({ checkoutStatus: 'UNKNOWN' })).label, 'Đang xác nhận');
  assert.equal(customerPaymentStatus(paymentRecord()).label, 'Đang chờ thanh toán');
  assert.equal(customerPaymentStatus(paymentRecord({ status: 'FAILED', providerSettlementStatus: 'NOT_VERIFIED', applicationStatus: 'NOT_APPLIED' })).label, 'Thanh toán không thành công');
  assert.notEqual(customerPaymentStatus(paymentRecord({ status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'MANUAL_REVIEW' })).label, 'Thanh toán thành công');
});

test('Payment history honors only an owned Reservation target and otherwise selects the latest owned Reservation', () => {
  const older = { _id: reservationId, createdAt: '2026-01-01T00:00:00.000Z' };
  const newer = { _id: paymentId, createdAt: '2026-02-01T00:00:00.000Z' };
  assert.equal(selectOwnedSelfStorageReservation([older, newer], reservationId), reservationId);
  assert.equal(selectOwnedSelfStorageReservation([older, newer], '507f1f77bcf86cd799439099'), paymentId);
  assert.equal(selectOwnedSelfStorageReservation([], reservationId), '');
});

test('A new attempt is permitted only after Backend-authorized terminal outcome without verified funds', () => {
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'FAILED', checkoutStatus: 'FAILED', retryAllowed: true })), true);
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'CANCELLED', checkoutStatus: 'CANCELLED', cancelVerifiedAt: '2026-11-10T00:00:00Z', retryAllowed: true })), true);
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'PENDING' })), false);
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'CANCELLED', cancelVerifiedAt: null, retryAllowed: true })), false);
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'FAILED', retryAllowed: true, providerSettlementStatus: 'VERIFIED' })), false);
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'FAILED', retryAllowed: true, applicationStatus: 'MANUAL_REVIEW' })), false);
  assert.equal(canStartNewPayosAttempt(paymentRecord({ status: 'FAILED', retryAllowed: true, reconciliationRequired: true })), false);
});

test('cancel return URL never supplies status evidence and only a confirmed DTO is shown as cancelled', () => {
  assert.equal(paymentStatusView(paymentRecord({ status: 'PENDING', checkoutStatus: 'READY' })).key, 'PENDING');
  assert.equal(paymentStatusView(paymentRecord({ status: 'CANCELLED', cancelVerifiedAt: null })).key, 'UNKNOWN');
  assert.equal(paymentStatusView(paymentRecord({ status: 'CANCELLED', cancelVerifiedAt: '2026-11-10T00:00:00Z' })).label, 'Đã hủy thanh toán');
  assert.equal(customerPaymentStatus(paymentRecord({ status: 'CANCELLED', cancelVerifiedAt: '2026-11-10T00:00:00Z' })).label, 'Đã hủy thanh toán');
});

test('409 and uncertain 503/network outcomes never instruct the Customer to create a new payment', () => {
  assert.match(paymentErrorMessage({ response: { status: 409 } }), /eligibility changed/);
  assert.match(paymentErrorMessage({ response: { status: 404 } }), /unavailable/);
  assert.match(paymentErrorMessage({ response: { status: 503 } }), /không tạo thanh toán mới/);
  assert.match(paymentErrorMessage({ isAxiosError: true }), /không tạo thanh toán mới/);
  const unknownMessage = paymentErrorMessage({ response: { status: 503, data: { code: 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN' } } });
  assert.match(unknownMessage, /previous checkout was created/i);
  assert.match(unknownMessage, /keep this payment attempt/i);
  assert.match(unknownMessage, /Refresh payment history and the existing Payment status/i);
  assert.match(unknownMessage, /do not pay again or create a new attempt/i);
});

test('Payment attempt tracking is scoped to Customer, Reservation and purpose and survives reload', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const key = trackingStorageKey(customerId, reservationId, 'DEPOSIT');
  assert.notEqual(key, trackingStorageKey(customerId, reservationId, 'BALANCE'));
  assert.notEqual(key, trackingStorageKey(contractId, reservationId, 'DEPOSIT'));
  const attempts = [{ idempotencyKey: 'wdp-same-key', paymentId }];
  writePayosAttempts(storage, customerId, reservationId, 'DEPOSIT', attempts);
  assert.deepEqual(readPayosAttempts(storage, customerId, reservationId, 'DEPOSIT').attempts, attempts);
  assert.deepEqual(readPayosAttempts(storage, contractId, reservationId, 'DEPOSIT').attempts, []);
  assert.match(newPayosIdempotencyKey({ randomUUID: () => 'test-uuid' }), /^wdp-test-uuid$/);
});

test('Recovered payment history deduplicates only immutable identity matches and blocks unresolved attempts', () => {
  const newer = paymentRecord({ createdAt: '2026-10-02T00:00:00.000Z' });
  const older = paymentRecord({ id: customerId, createdAt: '2026-10-01T00:00:00.000Z', purpose: 'BALANCE' });
  const changedIdentity = paymentRecord({ id: paymentId, amount: 999999 });
  const merged = mergePayosPaymentHistory([older], [newer, changedIdentity], reservationId);
  assert.deepEqual(merged.map(payment => payment.id), [paymentId, customerId]);
  assert.equal(merged[0].qrCode, newer.qrCode, 'Backend history recovery retains the original Payment QR payload');
  assert.equal(unresolvedPayosPayment(merged, 'DEPOSIT').id, paymentId);
  assert.equal(unresolvedPayosPayment([paymentRecord({ status: 'FAILED', checkoutStatus: 'READY' })], 'DEPOSIT'), null);
  assert.equal(unresolvedPayosPayment([paymentRecord({ checkoutStatus: 'UNKNOWN' })], 'DEPOSIT').id, paymentId);
});

test('Self-Storage always uses PayOS and never has a Customer mock fallback', async () => {
  const integrationPath = fileURLToPath(new URL('../src/components/customer/RentalLifecycleIntegration.jsx', import.meta.url));
  const checkoutPath = fileURLToPath(new URL('../src/components/customer/SelfStoragePayosCheckout.jsx', import.meta.url));
  const reviewPath = fileURLToPath(new URL('../src/components/customer/SelfStorageReservationReview.jsx', import.meta.url));
  const qrPath = fileURLToPath(new URL('../src/lib/selfStoragePayosQr.js', import.meta.url));
  const pollingPath = fileURLToPath(new URL('../src/lib/selfStoragePayosPolling.js', import.meta.url));
  const paymentApiPath = fileURLToPath(new URL('../src/api/paymentApi.js', import.meta.url));
  const managedApiPath = fileURLToPath(new URL('../src/api/managedReservationApi.js', import.meta.url));
  const paymentPagePath = fileURLToPath(new URL('../src/pages/customer/PaymentPage.jsx', import.meta.url));
  const historyPath = fileURLToPath(new URL('../src/pages/customer/PaymentHistoryPage.jsx', import.meta.url));
  const financialPath = fileURLToPath(new URL('../src/pages/customer/FinancialDetailPage.jsx', import.meta.url));
  const navigationPath = fileURLToPath(new URL('../src/components/customer/CustomerPaymentNavigation.jsx', import.meta.url));
  const lifecyclePath = fileURLToPath(new URL('../src/lib/customerReservationService.js', import.meta.url));
  const envPath = fileURLToPath(new URL('../.env.example', import.meta.url));
  const depositPath = fileURLToPath(new URL('../src/components/customer/CustomerDepositPayment.jsx', import.meta.url));
  const balancePath = fileURLToPath(new URL('../src/components/customer/CustomerBalancePayment.jsx', import.meta.url));
  const [integration, checkout, review, qrRenderer, poller, paymentApi, managedApi, paymentPage, history, financial, navigation, lifecycle, envExample, deposit, balance] = await Promise.all([
    readFile(integrationPath, 'utf8'), readFile(checkoutPath, 'utf8'), readFile(reviewPath, 'utf8'), readFile(qrPath, 'utf8'), readFile(pollingPath, 'utf8'),
    readFile(paymentApiPath, 'utf8'),
    readFile(managedApiPath, 'utf8'), readFile(paymentPagePath, 'utf8'), readFile(historyPath, 'utf8'), readFile(financialPath, 'utf8'),
    readFile(navigationPath, 'utf8'), readFile(lifecyclePath, 'utf8'), readFile(envPath, 'utf8'),
    readFile(depositPath, 'utf8'), readFile(balancePath, 'utf8'),
  ]);
  assert.match(integration, /if \(serviceType\(resource\.data\) === SELF_STORAGE\) return <SelfStoragePayosCheckout/);
  assert.match(integration, /<SelfStoragePayosCheckout/);
  const selfStorageStart = integration.indexOf('if (serviceType(resource.data) === SELF_STORAGE) return <SelfStoragePayosCheckout');
  const managedBranchStart = integration.indexOf('if (managedDeposit)', selfStorageStart);
  assert.ok(selfStorageStart >= 0 && managedBranchStart > selfStorageStart, 'Self-Storage PayOS branch remains separate from Managed payment handling');
  assert.doesNotMatch(integration.slice(selfStorageStart, managedBranchStart), /SelfStorageMockPayment|mockPayForService|Simulate Payment \(Demo\)|mock-pay/);
  assert.doesNotMatch(paymentApi, /mockPay|mock-pay|simulateSuccess|sessionStorage|payments\/payos\/create/);
  assert.doesNotMatch(managedApi, /mockPay|mock-pay|mock-confirm|initiateDeposit/);
  assert.doesNotMatch(deposit, /Mock Confirm Deposit|mock-confirm|initiateDeposit|Pay Deposit/);
  // CustomerBalancePayment is a separate Managed Inventory component whose
  // existing development-only simulation is out of this Self-Storage scope.
  assert.doesNotMatch(checkout, /Pay Balance \(MOCK\)|mockPay|mock-pay|simulateSuccess/);
  assert.match(deposit, /Thanh toán trực tuyến cho Managed Inventory hiện chưa được hỗ trợ/);
  // CustomerBalancePayment belongs to Managed Inventory and intentionally
  // keeps its existing behavior; Self-Storage uses the PayOS checkout above.
  assert.match(paymentPage, /PaymentIntegration as default/);
  assert.doesNotMatch(navigation, /development mock|mock-pay|mock payment/i);
  assert.match(navigation, /eligiblePayosPurpose/);
  assert.match(lifecycle, /serviceType\(reservation\)===SELF_STORAGE\?reservation\.status==='DEPOSIT_PAID'/);
  assert.match(integration, /Complete the Backend-confirmed PayOS Deposit before signing/);
  assert.doesNotMatch(envExample, /VITE_ENABLE_PAYOS_CHECKOUT/);
  assert.match(history, /mineReal/);
  assert.match(history, /listPayosPaymentsForReservation/);
  assert.match(history, /const applied = relevantPayment\?\.providerSettlementStatus === "VERIFIED" && relevantPayment\?\.applicationStatus === "APPLIED"/);
  assert.doesNotMatch(history, /customerDemoStore|staffDemoStore|managerDemoStore|sessionStorage|receiptId|demoReceipt|refunds\.map|charges\.map/i);
  assert.doesNotMatch(financial, /customerDemoStore|useCustomerData|data\.refunds|data\.charges/i);
  assert.match(financial, /Demo records are not shown as account transactions/);
  const payHandler = checkout.slice(checkout.indexOf('async function pay()'), checkout.indexOf('function continueExistingCheckout'));
  assert.match(payHandler, /window\.location\.assign/);
  assert.match(payHandler, /canOpenPayosCheckout\(payment\)/);
  assert.doesNotMatch(checkout, /canShowPayosQr|createPayosQrDataUrl|Mã QR|<img/);
  assert.match(checkout, /setInterval\(tick, 5000\)/);
  assert.match(checkout, /document\.hidden/);
  assert.match(checkout, /clearInterval\(interval\)/);
  assert.match(poller, /applicationStatus === "APPLIED"/);
  assert.match(qrRenderer, /QRCode\.toDataURL/);
  assert.match(checkout, /if\s*\(busy\.current\)\s*return/);
  assert.doesNotMatch(checkout, /window\.location\.assign\([^)]*searchParams/);
  assert.match(checkout, /getPayosPaymentStatus/);
  assert.match(checkout, /listPayosPaymentsForReservation/);
  assert.match(checkout, /Tiếp tục thanh toán qua PayOS/);
  assert.match(review, /Idempotency-Key/);
  assert.match(review, /readOrCreateSelfStorageBookingAttempt/);
  assert.match(review, /window\.location\.assign\(result\.payment\.checkoutUrl\)/);
  assert.match(review, /Xác nhận đặt thuê/);
  assert.match(checkout, /unresolvedPayosPayment/);
  assert.match(checkout, /unmatchedReturn/);
  assert.match(checkout, /returnQueryPresent/);
  assert.doesNotMatch(checkout, /searchParams\.get\(['"](status|paymentId|orderCode)['"]\)/);
  assert.match(checkout, /No checkout was opened/);
  assert.match(checkout, /providerSettlementStatus === "VERIFIED" && fresh\.applicationStatus === "APPLIED"/);
  assert.doesNotMatch(checkout, /status\?\.get\(['"](success|status)['"]\)/i);
  assert.doesNotMatch(checkout, /RentalSummary|Reservation reference|Contract status|Payment reference|Provider settlement|Reservation application/);
  assert.match(checkout, /Thanh toán tiền thuê trả trước/);
  assert.match(checkout, /goToHistory\(fresh\.id, true\)/);
});
