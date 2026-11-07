const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');

let PayosPaymentService, payosPaymentService, PayosPaymentError, ReservationPaymentModel,
  ReservationModel, ContractModel, PaymentApplicationStatus, PaymentProvider, PaymentPurpose,
  PaymentStatus, ReservationStatus, ContractStatus, Controller;
try {
  ({ PayosPaymentService, payosPaymentService, PayosPaymentError } = require('../dist/services/payments/payos-payment.service'));
  ReservationPaymentModel = require('../dist/models/payments/reservation-payment.model').default;
  ReservationModel = require('../dist/models/reservations/reservation.model').default;
  ContractModel = require('../dist/models/contracts/contract.model').default;
  ({ PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus } = require('../dist/types/payment.type'));
  ({ ReservationStatus } = require('../dist/types/reservation.type'));
  ({ ContractStatus } = require('../dist/types/contract.type'));
  Controller = require('../dist/controllers/payments/payos-payment.controller');
} catch {
  ({ PayosPaymentService, payosPaymentService, PayosPaymentError } = require('../src/services/payments/payos-payment.service'));
  ReservationPaymentModel = require('../src/models/payments/reservation-payment.model').default;
  ReservationModel = require('../src/models/reservations/reservation.model').default;
  ContractModel = require('../src/models/contracts/contract.model').default;
  ({ PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus } = require('../src/types/payment.type'));
  ({ ReservationStatus } = require('../src/types/reservation.type'));
  ({ ContractStatus } = require('../src/types/contract.type'));
  Controller = require('../src/controllers/payments/payos-payment.controller');
}

const oid = () => new mongoose.Types.ObjectId();
const DEPOSIT_QR = '00020101021229370016A0000006770101110113006688123456785204581253037045802VN6304ABCD';
const BALANCE_QR = '00020101021229370016A0000006770101110113006688123456795204581253037045802VN6304ABCE';
function query(value) { return { session() { return this; }, exec: async () => value }; }
function session() { return { withTransaction: async work => work(), endSession: async () => {} }; }
function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function baseReservation(status = ReservationStatus.CONTRACTED) {
  return { _id: oid(), customerId: oid(), facilityId: oid(), serviceType: 'SELF_STORAGE', status,
    inventoryVersion: 4, expiresAt: new Date(Date.now() + 60_000), estimatedRent: 300_000,
    depositAmount: 100_000, taxAmount: 0, discountAmount: 0, statusHistory: [] };
}

test('PayOS checkout controller returns 201 for creation and 200 for idempotent replay', async t => {
  t.mock.method(payosPaymentService, 'createCheckout', async (_id, _purpose, _key, _owner) => ({
    id: 'payment-1', outcome: 'CREATED', httpStatus: 201, checkoutUrl: 'https://pay.example/checkout',
  }));
  const created = response();
  await Controller.createSelfStorageCheckout({ params: { id: 'reservation-1' }, body: { purpose: 'DEPOSIT' },
    get: name => name === 'Idempotency-Key' ? 'deposit-key' : undefined, user: { _id: 'customer-1' } }, created);
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.outcome, 'CREATED');

  t.mock.method(payosPaymentService, 'createCheckout', async () => ({
    id: 'payment-1', outcome: 'REPLAYED', httpStatus: 200, checkoutUrl: 'https://pay.example/checkout',
  }));
  const replay = response();
  await Controller.createSelfStorageCheckout({ params: { id: 'reservation-1' }, body: { purpose: 'DEPOSIT' },
    get: () => 'deposit-key', user: { _id: 'customer-1' } }, replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.outcome, 'REPLAYED');
});

test('Customer payment history controller uses the owner-scoped service and response envelope', async t => {
  const expected = { items: [], nextCursor: null };
  t.mock.method(payosPaymentService, 'listCustomerPayments', async (...args) => {
    assert.deepEqual(args, ['reservation-id', 'customer-id', { limit: '5', cursor: 'cursor-token' }]);
    return expected;
  });
  const res = response();
  await Controller.listSelfStoragePayments({ params: { id: 'reservation-id' }, user: { _id: 'customer-id' },
    query: { limit: '5', cursor: 'cursor-token' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, data: expected });
});

test('Customer payment history route is declared before the generic paymentId route', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/reservation.routes.ts'), 'utf8');
  assert.ok(routes.indexOf("router.get('/:id/payments/payos'") < routes.indexOf("router.get('/:id/payments/:paymentId'"));
});

test('payment history is owner and Self-Storage scoped, bounded, cursor ordered and hides unsafe checkout URLs', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation();
  const first = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: reservation.facilityId, serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT,
    provider: PaymentProvider.PAYOS, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING,
    applicationStatus: PaymentApplicationStatus.NOT_APPLIED, providerSettlementStatus: 'NOT_VERIFIED',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/live', qrCode: DEPOSIT_QR,
    createdAt: new Date('2026-10-01T00:00:00.000Z') };
  const second = { ...first, _id: oid(), purpose: PaymentPurpose.BALANCE, status: PaymentStatus.SUCCEEDED,
    applicationStatus: PaymentApplicationStatus.MANUAL_REVIEW, checkoutUrl: 'https://pay.example/old',
    createdAt: new Date('2026-09-01T00:00:00.000Z') };
  const third = { ...second, _id: oid(), status: PaymentStatus.FAILED, applicationStatus: PaymentApplicationStatus.NOT_APPLIED,
    createdAt: new Date('2026-08-01T00:00:00.000Z') };
  let capturedFilter; let capturedLimit; let capturedMaxTime;
  const rows = [first, second, third];
  t.mock.method(ReservationModel, 'findOne', filter => {
    assert.equal(filter.customerId, reservation.customerId);
    assert.equal(filter.serviceType, 'SELF_STORAGE');
    return query(reservation);
  });
  t.mock.method(ReservationPaymentModel, 'find', filter => {
    capturedFilter = filter;
    return {
      sort(value) { assert.deepEqual(value, { createdAt: -1, _id: -1 }); return this; },
      limit(value) { capturedLimit = value; return this; },
      maxTimeMS(value) { capturedMaxTime = value; return this; },
      lean() { return this; },
      exec: async () => rows,
    };
  });
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  const service = new PayosPaymentService({ enabled: false });
  const page = await service.listCustomerPayments(String(reservation._id), reservation.customerId, { limit: 2 });
  assert.equal(capturedFilter.reservationId, String(reservation._id));
  assert.equal(capturedFilter.customerId, reservation.customerId);
  assert.equal(capturedFilter.serviceType, 'SELF_STORAGE');
  assert.equal(capturedFilter.provider, PaymentProvider.PAYOS);
  assert.equal(capturedLimit, 3);
  assert.equal(capturedMaxTime, 2000);
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0].checkoutUrl, 'https://pay.example/live');
  assert.equal(page.items[0].qrCode, DEPOSIT_QR);
  assert.equal(page.items[1].checkoutUrl, null);
  assert.equal(page.items[1].qrCode, null);
  assert.equal(typeof page.nextCursor, 'string');
  const cursorDecoded = Buffer.from(page.nextCursor, 'base64url').toString('utf8');
  assert.equal(cursorDecoded, `${second.createdAt.toISOString()}|${second._id}`);
  assert.equal(JSON.stringify(page).includes('idempotencyKey'), false);
  assert.equal(JSON.stringify(page).includes('providerReference'), false);

  await service.listCustomerPayments(String(reservation._id), reservation.customerId, { limit: 2, cursor: page.nextCursor });
  assert.equal(capturedFilter.$or[0].createdAt.$lt.toISOString(), second.createdAt.toISOString());
  assert.equal(capturedFilter.$or[1].createdAt.toISOString(), second.createdAt.toISOString());
  assert.equal(String(capturedFilter.$or[1]._id.$lt), String(second._id));
});

test('payment history rejects foreign and Managed Reservations without querying payment history', async t => {
  const reservation = baseReservation();
  t.mock.method(ReservationModel, 'findOne', filter => {
    assert.equal(filter.serviceType, 'SELF_STORAGE');
    return query(null);
  });
  t.mock.method(ReservationPaymentModel, 'find', () => { throw Error('payment history must not be queried for an unavailable Reservation'); });
  const service = new PayosPaymentService({ enabled: false });
  await assert.rejects(service.listCustomerPayments(String(reservation._id), 'foreign'), error => error.code === 'RESERVATION_NOT_FOUND');
  await assert.rejects(service.listCustomerPayments(String(reservation._id), reservation.customerId), error => error.code === 'RESERVATION_NOT_FOUND');
});

test('owned Self-Storage Reservation with no PayOS records returns an empty read-only page', async t => {
  const reservation = baseReservation();
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationPaymentModel, 'find', filter => {
    assert.equal(filter.reservationId, String(reservation._id));
    assert.equal(filter.provider, PaymentProvider.PAYOS);
    return { sort() { return this; }, limit() { return this; }, maxTimeMS() { return this; }, lean() { return this; }, exec: async () => [] };
  });
  const service = new PayosPaymentService({ enabled: false, gateway: { create: async () => { throw Error('read must not call PayOS'); } } });
  assert.deepEqual(await service.listCustomerPayments(String(reservation._id), reservation.customerId), { items: [], nextCursor: null });
});

test('historical payment remains readable after Facility metadata changes but its checkout URL is hidden', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: oid(), serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT,
    provider: PaymentProvider.PAYOS, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING,
    applicationStatus: PaymentApplicationStatus.NOT_APPLIED, providerSettlementStatus: 'NOT_VERIFIED',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/old', createdAt: new Date() };
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationPaymentModel, 'find', () => ({ sort() { return this; }, limit() { return this; },
    maxTimeMS() { return this; }, lean() { return this; }, exec: async () => [payment] }));
  let contractReads = 0;
  t.mock.method(ContractModel, 'findOne', () => { contractReads += 1; return query({ status: ContractStatus.DRAFT }); });
  const service = new PayosPaymentService({ enabled: false });
  const page = await service.listCustomerPayments(String(reservation._id), reservation.customerId);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, String(payment._id));
  assert.equal(page.items[0].checkoutUrl, null);
  assert.equal(contractReads, 0);
});

test('webhook registration acknowledgement returns HTTP 200 and explicitly does not apply a payment', async t => {
  t.mock.method(payosPaymentService, 'handleWebhook', async () => ({ registrationProbe: true, applied: false }));
  const res = response();
  await Controller.payosWebhook({ body: { data: {}, signature: 'verified-sample' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.registrationProbe, true);
  assert.equal(res.body.data.applied, false);
});

test('checkout rejects client supplied amount/provider fields before service invocation', async t => {
  t.mock.method(payosPaymentService, 'createCheckout', async () => { throw new Error('must reject before payment service'); });
  const res = response();
  await Controller.createSelfStorageCheckout({ params: { id: 'reservation-1' },
    body: { purpose: 'DEPOSIT', amount: 1, returnUrl: 'https://attacker.example', cancelUrl: 'https://attacker.example' },
    get: () => 'key', user: { _id: 'customer-1' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_PAYMENT_REQUEST');
});

test('checkout creates a server-priced intent after Reservation CAS and reuses existing DRAFT Contract', async t => {
  process.env.PAYOS_ENABLED = 'true';
  process.env.PAYOS_CUSTOMER_ORIGIN = 'https://customer.example';
  process.env.PAYOS_WEBHOOK_URL = 'https://api.example/api/v1/payments/payos/webhook';
  const reservation = baseReservation();
  const contract = { _id: oid(), customerId: reservation.customerId, reservationId: reservation._id, status: ContractStatus.DRAFT };
  const operations = [];
  let providerRequest;
  const fakeSession = session();
  const fakeGateway = {
    create: async body => { operations.push('provider-create'); providerRequest = body; assert.equal(body.amount, 100000); assert.equal(body.currency, undefined); return {
      orderCode: body.orderCode, amount: body.amount, currency: 'VND', paymentLinkId: 'link-1',
      checkoutUrl: 'https://pay.example/link-1', qrCode: DEPOSIT_QR, status: 'PENDING',
    }; },
    get: async () => { throw Error('unexpected provider lookup'); }, verify: async () => { throw Error('unexpected webhook'); },
  };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    if (filter.idempotencyKey) return query(null);
    if (filter.status?.$in) return query(null);
    if (filter.status === PaymentStatus.SUCCEEDED) return query(null);
    return query(null);
  });
  t.mock.method(ReservationModel, 'findOne', filter => {
    operations.push('reservation-read');
    return query(filter.status ? reservation : reservation);
  });
  t.mock.method(ContractModel, 'findOne', () => { operations.push('contract-read'); return query(contract); });
  t.mock.method(ReservationModel, 'findOneAndUpdate', (filter, update, options) => {
    operations.push('reservation-cas');
    assert.equal(filter._id, reservation._id);
    assert.equal(options.session, fakeSession);
    assert.equal(update.$inc.inventoryVersion, 1);
    reservation.inventoryVersion += 1;
    return query(reservation);
  });
  let saved;
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) {
    operations.push('payment-save'); assert.equal(options.session, fakeSession); saved = this; return this;
  });
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
    operations.push('checkout-claim'); Object.assign(saved, update.$set); return query(saved);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    operations.push('checkout-link-save'); Object.assign(saved, update.$set); return { exec: async () => ({ matchedCount: 1 }) };
  });
  t.mock.method(ReservationPaymentModel, 'findById', () => query(saved));
  const service = new PayosPaymentService({ enabled: true, gateway: fakeGateway, createSession: async () => fakeSession });
  const result = await service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'client-key', reservation.customerId);
  assert.equal(result.httpStatus, 201);
  assert.equal(result.amount, 100000);
  assert.equal(result.checkoutUrl, 'https://pay.example/link-1');
  assert.equal(result.qrCode, DEPOSIT_QR);
  assert.equal(saved.qrCode, DEPOSIT_QR);
  assert.equal(saved.provider, PaymentProvider.PAYOS);
  assert.equal(saved.providerReference, String(Number(saved.providerReference)));
  const expectedCustomerRoute = `https://customer.example/portal/payments/${reservation._id}`;
  assert.equal(providerRequest.returnUrl, expectedCustomerRoute);
  assert.equal(providerRequest.cancelUrl, expectedCustomerRoute);
  assert.ok(operations.indexOf('reservation-cas') < operations.indexOf('payment-save'));
  assert.ok(operations.indexOf('payment-save') < operations.indexOf('provider-create'));
  assert.ok(operations.includes('checkout-link-save'));
});

test('Balance intent requires an applied PayOS Deposit and calculates only the remaining VND amount', async t => {
  process.env.PAYOS_ENABLED = 'true';
  process.env.PAYOS_CUSTOMER_ORIGIN = 'https://customer.example';
  process.env.PAYOS_WEBHOOK_URL = 'https://api.example/api/v1/payments/payos/webhook';
  const reservation = baseReservation(ReservationStatus.CHECKIN_READY);
  reservation.depositPaymentId = oid();
  const contract = { _id: oid(), customerId: reservation.customerId, reservationId: reservation._id,
    status: ContractStatus.SIGNED, signedProofPublicId: 'proof-1', signedProofUrl: 'https://proof.example/1', verifiedAt: new Date() };
  const deposit = { _id: reservation.depositPaymentId, amount: 100000 };
  const fakeSession = session(); let saved;
  let providerRequest;
  const gateway = {
    create: async data => {
      providerRequest = data;
      return { orderCode: data.orderCode, amount: data.amount, currency: 'VND',
        paymentLinkId: 'balance-link', checkoutUrl: 'https://pay.example/balance', qrCode: BALANCE_QR, status: 'PENDING' };
    },
    get: async () => null,
    verify: async () => null,
  };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    if (filter.purpose === PaymentPurpose.DEPOSIT) return query(deposit);
    return query(null);
  });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query(contract));
  t.mock.method(ReservationModel, 'findOneAndUpdate', (_filter, update) => { reservation.inventoryVersion += update.$inc.inventoryVersion; return query(reservation); });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.equal(options.session, fakeSession); saved = this; return this; });
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => { Object.assign(saved, update.$set); return query(saved); });
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => { Object.assign(saved, update.$set); return query({ matchedCount: 1 }); });
  t.mock.method(ReservationPaymentModel, 'findById', () => query(saved));
  const service = new PayosPaymentService({ enabled: true, gateway, createSession: async () => fakeSession });
  const result = await service.createCheckout(String(reservation._id), PaymentPurpose.BALANCE, 'balance-key', reservation.customerId);
  assert.equal(result.amount, 200000);
  assert.equal(result.qrCode, BALANCE_QR);
  assert.equal(saved.purpose, PaymentPurpose.BALANCE);
  assert.equal(saved.currency, 'VND');
  const expectedCustomerRoute = `https://customer.example/portal/payments/${reservation._id}`;
  assert.equal(providerRequest.returnUrl, expectedCustomerRoute);
  assert.equal(providerRequest.cancelUrl, expectedCustomerRoute);
  assert.notEqual(providerRequest.returnUrl, 'https://customer.example/portal/payments/507f1f77bcf86cd799439011');
});

test('missing or malformed provider QR is omitted while the verified original Hosted Checkout remains usable', async t => {
  setPayosCheckoutTestConfig();
  const entries = [undefined, 'not-a-provider-qr'].map((qrCode, index) => {
    const reservation = baseReservation();
    const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
      facilityId: reservation.facilityId, serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT,
      amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS, providerReference: String(1234567890 + index),
      status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
    return { reservation, payment, contract: { status: ContractStatus.DRAFT }, qrCode };
  });
  const byPaymentId = new Map(entries.map(entry => [String(entry.payment._id), entry.payment]));
  const byReservationId = new Map(entries.map(entry => [String(entry.reservation._id), entry]));
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (filter, update) => {
    const payment = byPaymentId.get(String(filter._id));
    Object.assign(payment, update.$set);
    return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (filter, update) => {
    const payment = byPaymentId.get(String(filter._id));
    Object.assign(payment, update.$set);
    return query({ matchedCount: 1 });
  });
  t.mock.method(ReservationPaymentModel, 'findById', idInput => query(byPaymentId.get(String(idInput))));
  t.mock.method(ReservationModel, 'findOne', filter => query(byReservationId.get(String(filter._id))?.reservation ?? null));
  t.mock.method(ContractModel, 'findOne', filter => query(byReservationId.get(String(filter.reservationId))?.contract ?? null));
  const service = new PayosPaymentService({ gateway: { create: async data => ({ orderCode: data.orderCode,
    amount: data.amount, currency: 'VND', paymentLinkId: `qr-link-${data.orderCode}`,
    checkoutUrl: 'https://pay.example/checkout', qrCode: entries.find(entry => entry.payment.providerReference === String(data.orderCode))?.qrCode,
    status: 'PENDING' }) } });

  for (const entry of entries) {
    const result = await service.createProviderLink(entry.payment);
    assert.equal(result.checkoutUrl, 'https://pay.example/checkout');
    assert.equal(result.qrCode, null);
    assert.equal(entry.payment.qrCode, undefined);
  }
});

test('same economic identity replays original checkout; cross-owner identity does not leak it', async t => {
  setPayosCheckoutTestConfig();
  const reservationId = oid();
  const reservation = baseReservation(); reservation._id = reservationId; reservation.customerId = 'customer-1';
  const payment = { _id: oid(), reservationId, customerId: 'customer-1', facilityId: reservation.facilityId,
    idempotencyKey: 'PAYOS-SS-key', serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/original', qrCode: DEPOSIT_QR, status: PaymentStatus.PENDING };
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('replay must not create another link'); } } });
  const replay = await service.createCheckout(String(reservationId), PaymentPurpose.DEPOSIT, 'key', 'customer-1');
  assert.equal(replay.httpStatus, 200);
  assert.equal(replay.checkoutUrl, 'https://pay.example/original');
  assert.equal(replay.qrCode, DEPOSIT_QR);
  await assert.rejects(service.createCheckout(String(reservationId), PaymentPurpose.DEPOSIT, 'key', 'customer-2'), error => {
    assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT'); return true;
  });
});

test('return and cancel URLs are generated per immutable Payment Reservation identity', async t => {
  setPayosCheckoutTestConfig();
  const firstReservation = baseReservation();
  const firstContract = { _id: oid(), customerId: firstReservation.customerId, reservationId: firstReservation._id,
    status: ContractStatus.DRAFT };
  const secondReservation = baseReservation(ReservationStatus.CHECKIN_READY);
  secondReservation.depositPaymentId = oid();
  const secondContract = { _id: oid(), customerId: secondReservation.customerId, reservationId: secondReservation._id,
    status: ContractStatus.SIGNED, signedProofPublicId: 'proof', signedProofUrl: 'https://proof.example/1', verifiedAt: new Date() };
  const first = { _id: oid(), reservationId: firstReservation._id, customerId: firstReservation.customerId,
    facilityId: firstReservation.facilityId, serviceType: 'SELF_STORAGE', currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', purpose: PaymentPurpose.DEPOSIT, amount: 100000,
    status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED',
    returnUrl: 'https://attacker.example', cancelUrl: 'https://attacker.example', origin: 'https://attacker.example' };
  const second = { _id: oid(), reservationId: secondReservation._id, customerId: secondReservation.customerId,
    facilityId: secondReservation.facilityId, serviceType: 'SELF_STORAGE', currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567891', purpose: PaymentPurpose.BALANCE, amount: 200000,
    status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  const byId = new Map([[String(first._id), first], [String(second._id), second]]);
  const providerRequests = [];
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', filter => {
    const payment = byId.get(String(filter._id));
    payment.checkoutState = 'CREATING';
    return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (filter, update) => {
    const payment = byId.get(String(filter._id));
    Object.assign(payment, update.$set);
    return query({ matchedCount: 1 });
  });
  t.mock.method(ReservationPaymentModel, 'findById', idInput => query(byId.get(String(idInput))));
  t.mock.method(ReservationModel, 'findOne', filter => query(String(filter._id) === String(firstReservation._id)
    ? firstReservation : secondReservation));
  t.mock.method(ContractModel, 'findOne', filter => query(String(filter.reservationId) === String(firstReservation._id)
    ? firstContract : secondContract));
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter.purpose === PaymentPurpose.DEPOSIT
    ? { _id: secondReservation.depositPaymentId, amount: 100000 } : null));
  const service = new PayosPaymentService({ enabled: true, gateway: {
    create: async data => {
      providerRequests.push(data);
      return { orderCode: data.orderCode, amount: data.amount, currency: 'VND',
        paymentLinkId: `link-${data.orderCode}`, checkoutUrl: 'https://pay.example/checkout', qrCode: DEPOSIT_QR, status: 'PENDING' };
    },
  } });

  await service.createProviderLink(first);
  await service.createProviderLink(second);
  const firstUrl = `https://customer.example/portal/payments/${first.reservationId}`;
  const secondUrl = `https://customer.example/portal/payments/${second.reservationId}`;
  assert.equal(providerRequests[0].returnUrl, firstUrl);
  assert.equal(providerRequests[0].cancelUrl, firstUrl);
  assert.equal(providerRequests[1].returnUrl, secondUrl);
  assert.equal(providerRequests[1].cancelUrl, secondUrl);
  assert.notEqual(firstUrl, secondUrl);
  for (const request of providerRequests) {
    assert.equal(new URL(request.returnUrl).search, '');
    assert.equal(new URL(request.returnUrl).hash, '');
    assert.doesNotMatch(request.returnUrl, /access.?token|api.?key|checksum|client-key|orderCode/i);
  }
});

test('missing, malformed, credentialed, path-bearing, queried and fragmented Customer origins fail closed', async t => {
  const previous = {
    gate: process.env.PAYOS_ENABLED,
    origin: process.env.PAYOS_CUSTOMER_ORIGIN,
    webhook: process.env.PAYOS_WEBHOOK_URL,
    nodeEnv: process.env.NODE_ENV,
  };
  t.after(() => {
    for (const [key, value] of Object.entries({
      PAYOS_ENABLED: previous.gate,
      PAYOS_CUSTOMER_ORIGIN: previous.origin,
      PAYOS_WEBHOOK_URL: previous.webhook,
      NODE_ENV: previous.nodeEnv,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.PAYOS_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.PAYOS_WEBHOOK_URL = 'https://api.example/api/v1/payments/payos/webhook';
  t.mock.method(ReservationPaymentModel, 'findOne', () => { throw Error('invalid origin must fail before DB access'); });
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not call provider'); } } });
  for (const origin of [undefined, '', 'not-a-url', 'javascript:alert(1)',
    'https://user:pass@customer.example', 'https://customer.example/path',
    'https://customer.example?next=https://attacker.example', 'https://customer.example#fragment']) {
    if (origin === undefined) delete process.env.PAYOS_CUSTOMER_ORIGIN;
    else process.env.PAYOS_CUSTOMER_ORIGIN = origin;
    await assert.rejects(service.createCheckout('507f1f77bcf86cd799439011', PaymentPurpose.DEPOSIT, 'invalid-origin', 'customer'), error => {
      assert.equal(error.code, 'PAYOS_CONFIGURATION_MISSING');
      assert.equal(error.status, 503);
      return true;
    });
  }
});

test('production rejects insecure Customer origins and malformed Payment Reservation IDs before writes', async t => {
  const previous = { nodeEnv: process.env.NODE_ENV, origin: process.env.PAYOS_CUSTOMER_ORIGIN };
  t.after(() => {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.origin === undefined) delete process.env.PAYOS_CUSTOMER_ORIGIN;
    else process.env.PAYOS_CUSTOMER_ORIGIN = previous.origin;
  });
  process.env.NODE_ENV = 'production';
  process.env.PAYOS_CUSTOMER_ORIGIN = 'http://customer.example';
  process.env.PAYOS_WEBHOOK_URL = 'https://api.example/api/v1/payments/payos/webhook';
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not call provider'); } } });
  await assert.rejects(service.createCheckout('507f1f77bcf86cd799439011', PaymentPurpose.DEPOSIT, 'http-origin', 'customer'), error => {
    assert.equal(error.code, 'PAYOS_CONFIGURATION_MISSING'); return true;
  });

  process.env.PAYOS_CUSTOMER_ORIGIN = 'https://customer.example';
  let writes = 0;
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', () => { writes += 1; return query(null); });
  await assert.rejects(service.createProviderLink({ _id: oid(), reservationId: 'not-an-object-id',
    providerReference: '1234567890', amount: 100000, status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' }), error => {
    assert.equal(error.code, 'PAYMENT_RESERVATION_ID_INVALID'); return true;
  });
  assert.equal(writes, 0);
});

function setPayosCheckoutTestConfig() {
  process.env.PAYOS_CUSTOMER_ORIGIN = 'https://customer.example';
  process.env.PAYOS_WEBHOOK_URL = 'https://api.example/api/v1/payments/payos/webhook';
}

function mockTransactionDiscoveredReplay(t, reservation, payment) {
  let idempotencyLookups = 0;
  const fakeSession = session();
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    if (filter.idempotencyKey) {
      idempotencyLookups += 1;
      return query(idempotencyLookups === 1 ? null : payment);
    }
    return query(null);
  });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  return () => idempotencyLookups;
}

test('transaction-discovered same-key replay uses replay eligibility checks and never creates another link', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(); reservation.customerId = 'customer-race';
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: reservation.facilityId, idempotencyKey: 'PAYOS-SS-race-key', serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/original-race-link', status: PaymentStatus.PENDING };
  const lookupCount = mockTransactionDiscoveredReplay(t, reservation, payment);
  let providerCreates = 0;
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { providerCreates += 1; throw Error('must not create a second link'); } } });
  const replay = await service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'race-key', reservation.customerId);
  assert.equal(lookupCount(), 2, 'intent lookup first misses, then discovers the concurrently committed winner');
  assert.equal(replay.httpStatus, 200);
  assert.equal(replay.outcome, 'REPLAYED');
  assert.equal(replay.checkoutUrl, 'https://pay.example/original-race-link');
  assert.equal(providerCreates, 0);
});

test('transaction-discovered replay conflicts when current price differs from immutable intent', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(); reservation.customerId = 'customer-race'; reservation.depositAmount = 125000;
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: reservation.facilityId, idempotencyKey: 'PAYOS-SS-race-price', serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/original-race-link', status: PaymentStatus.PENDING };
  mockTransactionDiscoveredReplay(t, reservation, payment);
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not create another link'); } } });
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'race-price', reservation.customerId), error => {
    assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT'); return true;
  });
});

test('transaction-discovered replay conflicts when current Facility differs from immutable intent', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(); reservation.customerId = 'customer-race';
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: oid(), idempotencyKey: 'PAYOS-SS-race-facility', serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/original-race-link', status: PaymentStatus.PENDING };
  mockTransactionDiscoveredReplay(t, reservation, payment);
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not create another link'); } } });
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'race-facility', reservation.customerId), error => {
    assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT'); return true;
  });
});

test('same key conflicts when current pricing or Facility differs from the immutable intent', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(); reservation.customerId = 'customer-1';
  const payment = { _id: oid(), reservationId: reservation._id, customerId: 'customer-1', facilityId: reservation.facilityId,
    idempotencyKey: 'PAYOS-SS-key', serviceType: 'SELF_STORAGE', provider: PaymentProvider.PAYOS,
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', checkoutState: 'READY',
    checkoutUrl: 'https://pay.example/original', status: PaymentStatus.PENDING };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not create a second order'); } } });

  reservation.depositAmount = 125000;
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'key', 'customer-1'), error => {
    assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT'); return true;
  });

  reservation.depositAmount = 100000;
  reservation.facilityId = oid();
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'key', 'customer-1'), error => {
    assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT'); return true;
  });

  reservation.facilityId = payment.facilityId;
  payment.currency = 'USD';
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'key', 'customer-1'), error => {
    assert.equal(error.code, 'IDEMPOTENCY_KEY_CONFLICT'); return true;
  });
});

test('pending intent replay does not present a link after Reservation eligibility expires', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(ReservationStatus.CANCELLED); reservation.customerId = 'customer-1';
  const payment = { _id: oid(), reservationId: reservation._id, customerId: 'customer-1', facilityId: reservation.facilityId,
    idempotencyKey: 'PAYOS-SS-key', serviceType: 'SELF_STORAGE', provider: PaymentProvider.PAYOS,
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', checkoutState: 'READY',
    checkoutUrl: 'https://pay.example/original', status: PaymentStatus.PENDING };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not create another order'); } } });
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'key', 'customer-1'), error => {
    assert.equal(error.code, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE'); return true;
  });
});

test('replaying an unresolved unknown checkout returns 503 and never creates a second provider link', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(); reservation.customerId = 'customer-unknown';
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: reservation.facilityId, idempotencyKey: 'PAYOS-SS-unknown', serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, providerReference: '1234567897', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    checkoutState: 'UNKNOWN', checkoutUrl: null, status: PaymentStatus.PENDING };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  let providerCreates = 0;
  let providerLookupOrderCode;
  const service = new PayosPaymentService({ enabled: true, gateway: {
    create: async () => { providerCreates += 1; throw Error('must not create another provider order'); },
    get: async orderCode => { providerLookupOrderCode = orderCode; throw Error('provider outcome remains unknown'); },
  } });
  await assert.rejects(service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT,
    'unknown', reservation.customerId), error => {
    assert.equal(error.code, 'PAYMENT_OUTCOME_UNKNOWN');
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(payment.checkoutState, 'UNKNOWN');
  assert.equal(providerCreates, 0);
  assert.equal(providerLookupOrderCode, 1234567897);
  assert.equal(payment.providerReference, '1234567897');
});

test('completed intent replay preserves status but does not re-present its checkout link', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation(ReservationStatus.DEPOSIT_PAID); reservation.customerId = 'customer-1';
  const payment = { _id: oid(), reservationId: reservation._id, customerId: 'customer-1', facilityId: reservation.facilityId,
    idempotencyKey: 'PAYOS-SS-key', serviceType: 'SELF_STORAGE', provider: PaymentProvider.PAYOS,
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', checkoutState: 'READY',
    checkoutUrl: 'https://pay.example/original', status: PaymentStatus.SUCCEEDED };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async () => { throw Error('must not create another order'); } } });
  const replay = await service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'key', 'customer-1');
  assert.equal(replay.status, PaymentStatus.SUCCEEDED);
  assert.equal(replay.checkoutUrl, null);
  assert.equal(replay.httpStatus, 200);
});

test('feature gate defaults closed and rejects checkout before database access', async t => {
  const previousGate = process.env.PAYOS_ENABLED;
  delete process.env.PAYOS_ENABLED;
  t.after(() => { if (previousGate === undefined) delete process.env.PAYOS_ENABLED; else process.env.PAYOS_ENABLED = previousGate; });
  t.mock.method(ReservationPaymentModel, 'findOne', () => { throw Error('gate must reject before DB access'); });
  const service = new PayosPaymentService({ gateway: { create: async () => null } });
  await assert.rejects(service.createCheckout('507f1f77bcf86cd799439011', PaymentPurpose.DEPOSIT, 'key', 'customer'), error => {
    assert.equal(error.code, 'PAYOS_CHECKOUT_DISABLED'); return true;
  });
});

test('checkout URL is not reported as created unless persistence is confirmed', async t => {
  const payment = { _id: oid(), reservationId: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567890',
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', () => query({ ...payment, checkoutState: 'CREATING' }));
  t.mock.method(ReservationPaymentModel, 'updateOne', () => query({ matchedCount: 0 }));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  const service = new PayosPaymentService({ gateway: { create: async data => ({ orderCode: data.orderCode, amount: data.amount,
    currency: 'VND', paymentLinkId: 'link-1', checkoutUrl: 'https://pay.example/link-1', qrCode: DEPOSIT_QR, status: 'PENDING' }) } });
  await assert.rejects(service.createProviderLink(payment), error => {
    assert.equal(error.code, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN');
    assert.equal(error.status, 503);
    return true;
  });
});

test('provider create timeout yields 503 and leaves the intent unknown for same-order reconciliation', async t => {
  const payment = { _id: oid(), reservationId: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567890',
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
    Object.assign(payment, update.$set); return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  const service = new PayosPaymentService({ gateway: { create: async () => { throw Error('simulated network timeout'); } } });
  await assert.rejects(service.createProviderLink(payment), error => {
    assert.equal(error.code, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN');
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(payment.checkoutState, 'UNKNOWN');
});

test('provider response persistence failure preserves the original intent and emits only sanitized diagnostics', async t => {
  const payment = { _id: oid(), reservationId: oid(), customerId: oid(), facilityId: oid(), serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, providerReference: '1234567891', purpose: PaymentPurpose.DEPOSIT,
    amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  let updateCalls = 0; let providerCreates = 0; const diagnostics = [];
  t.mock.method(console, 'warn', (...args) => diagnostics.push(args));
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
    Object.assign(payment, update.$set); return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    updateCalls += 1;
    if (updateCalls === 1) throw Error('private URL and sensitive SDK body must never be logged');
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  const service = new PayosPaymentService({ gateway: { create: async data => {
    providerCreates += 1;
    return { orderCode: data.orderCode, amount: data.amount, currency: 'VND', paymentLinkId: 'link-private',
      checkoutUrl: 'https://pay.example/private-link', qrCode: DEPOSIT_QR, status: 'PENDING' };
  } } });
  await assert.rejects(service.createProviderLink(payment), error => {
    assert.equal(error.code, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN'); return true;
  });
  assert.equal(providerCreates, 1);
  assert.equal(payment.providerReference, '1234567891');
  assert.equal(payment.checkoutState, 'UNKNOWN');
  assert.equal(diagnostics.length, 1);
  const diagnosticText = JSON.stringify(diagnostics);
  assert.match(diagnosticText, /CHECKOUT_PERSISTENCE_FAILED/);
  assert.match(diagnosticText, /providerCreateInvoked/);
  assert.match(diagnosticText, /providerResponseReceived/);
  assert.match(diagnosticText, /persistenceConfirmed/);
  assert.doesNotMatch(diagnosticText, /pay\.example|private-link|000201|sensitive SDK body/);
});

test('null or malformed PayOS create response fails closed for reconciliation', async t => {
  const payment = { _id: oid(), reservationId: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567892',
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  let diagnostics = [];
  t.mock.method(console, 'warn', (...args) => diagnostics.push(args));
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
    Object.assign(payment, update.$set); return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  const service = new PayosPaymentService({ gateway: { create: async () => null } });
  await assert.rejects(service.createProviderLink(payment), error => {
    assert.equal(error.code, 'PAYOS_RESPONSE_MISMATCH'); return true;
  });
  assert.equal(payment.checkoutState, 'RECONCILIATION_REQUIRED');
  assert.match(JSON.stringify(diagnostics), /PROVIDER_RESPONSE_MISMATCH/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /null|orderCode|pay\.example/);
});

test('concurrent provider-link requests for one intent invoke PayOS create only once', async t => {
  setPayosCheckoutTestConfig();
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', provider: PaymentProvider.PAYOS, providerReference: '1234567893',
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING,
    checkoutState: 'NOT_CREATED', applicationStatus: PaymentApplicationStatus.NOT_APPLIED,
    providerSettlementStatus: 'NOT_VERIFIED' };
  let providerCreates = 0; let releaseCreate; let markStarted;
  const createStarted = new Promise(resolve => { markStarted = resolve; });
  const providerResponse = new Promise(resolve => { releaseCreate = resolve; });
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
    if (payment.checkoutState !== 'NOT_CREATED') return query(null);
    Object.assign(payment, update.$set); return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  const service = new PayosPaymentService({ enabled: true, gateway: { create: async data => {
    providerCreates += 1; markStarted(); return providerResponse;
  } } });
  const first = service.createProviderLink(payment);
  await createStarted;
  await assert.rejects(service.createProviderLink(payment), error => {
    assert.equal(error.code, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN'); return true;
  });
  releaseCreate({ orderCode: 1234567893, amount: 100000, currency: 'VND', paymentLinkId: 'link-concurrent',
    checkoutUrl: 'https://pay.example/concurrent', qrCode: DEPOSIT_QR, status: 'PENDING' });
  const result = await first;
  assert.equal(providerCreates, 1);
  assert.equal(payment.providerReference, '1234567893');
  assert.equal(result.checkoutUrl, 'https://pay.example/concurrent');
});

test('unknown checkout lookup uses original orderCode and quarantines a lost or mismatched provider link', async t => {
  const payment = { _id: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567894', amount: 100000,
    providerPaymentLinkId: 'expected-link', status: PaymentStatus.PENDING, checkoutState: 'UNKNOWN', checkoutUrl: null };
  let lookupOrderCode; let createCalls = 0;
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  const service = new PayosPaymentService({ gateway: {
    create: async () => { createCalls += 1; throw Error('replacement order forbidden'); },
    get: async orderCode => { lookupOrderCode = orderCode; return { id: 'different-link', orderCode,
      amount: 100000, amountPaid: 0, status: 'PENDING' }; },
  } });
  await service.reconcileCheckoutState(payment);
  assert.equal(lookupOrderCode, 1234567894);
  assert.equal(payment.checkoutState, 'RECONCILIATION_REQUIRED');
  assert.equal(payment.providerPaymentLinkId, 'expected-link');
  assert.equal(payment.checkoutUrl, null);
  assert.equal(createCalls, 0);
});

test('PayOS lookup of the original order can verify the link identity but never manufactures a lost checkout URL', async t => {
  const payment = { _id: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567895', amount: 100000,
    providerPaymentLinkId: null, status: PaymentStatus.PENDING, checkoutState: 'UNKNOWN', checkoutUrl: null };
  let lookupOrderCode; let createCalls = 0;
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  const service = new PayosPaymentService({ gateway: {
    create: async () => { createCalls += 1; throw Error('replacement order forbidden'); },
    get: async orderCode => { lookupOrderCode = orderCode; return { id: 'original-link', orderCode,
      amount: 100000, amountPaid: 0, status: 'PENDING' }; },
  } });
  await service.reconcileCheckoutState(payment);
  assert.equal(lookupOrderCode, 1234567895);
  assert.equal(payment.checkoutState, 'RECONCILIATION_REQUIRED');
  assert.match(payment.reconciliationReason, /original checkout URL was not persisted/);
  assert.equal(payment.checkoutUrl, null);
  assert.equal(createCalls, 0);
});

test('payment status lookup uses Customer, Reservation, provider and service scope', async t => {
  const paymentId = String(oid()); const reservationId = String(oid()); const customerId = oid();
  const reservation = baseReservation(); reservation._id = reservationId; reservation.customerId = customerId;
  const facilityId = reservation.facilityId;
  const payment = { _id: paymentId, reservationId, customerId, facilityId, provider: PaymentProvider.PAYOS,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    status: PaymentStatus.PENDING, checkoutState: 'READY', checkoutUrl: 'https://pay.example/link', qrCode: DEPOSIT_QR };
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    assert.equal(String(filter._id), paymentId);
    assert.equal(String(filter.reservationId), reservationId);
    assert.equal(filter.customerId, customerId);
    assert.equal(filter.serviceType, 'SELF_STORAGE');
    assert.equal(filter.provider, PaymentProvider.PAYOS);
    return query(payment);
  });
  t.mock.method(ReservationModel, 'findOne', filter => {
    assert.equal(String(filter._id), reservationId);
    assert.equal(filter.customerId, customerId);
    assert.equal(filter.serviceType, 'SELF_STORAGE');
    return query(reservation);
  });
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  const service = new PayosPaymentService();
  const result = await service.getCustomerStatus(paymentId, reservationId, customerId);
  assert.equal(result.id, paymentId);
  assert.equal(result.checkoutUrl, 'https://pay.example/link');
  assert.equal(result.qrCode, DEPOSIT_QR);
  delete payment.qrCode;
  const legacyReady = await service.getCustomerStatus(paymentId, reservationId, customerId);
  assert.equal(legacyReady.checkoutUrl, 'https://pay.example/link');
  assert.equal(legacyReady.qrCode, null);
});

test('completed, reconciliation and MANUAL_REVIEW status never expose persisted checkout URLs', async t => {
  const paymentId = String(oid()); const reservationId = String(oid()); const customerId = oid();
  const payment = { _id: paymentId, reservationId, customerId, facilityId: oid(), provider: PaymentProvider.PAYOS,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    checkoutState: 'READY', checkoutUrl: 'https://pay.example/historical-link', qrCode: DEPOSIT_QR };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  t.mock.method(ReservationModel, 'findOne', () => query({ _id: reservationId, customerId,
    facilityId: payment.facilityId, serviceType: 'SELF_STORAGE' }));
  const service = new PayosPaymentService();
  for (const [status, applicationStatus] of [
    [PaymentStatus.SUCCEEDED, PaymentApplicationStatus.APPLIED],
    [PaymentStatus.RECONCILIATION_REQUIRED, PaymentApplicationStatus.MANUAL_REVIEW],
    [PaymentStatus.PENDING, PaymentApplicationStatus.MANUAL_REVIEW],
  ]) {
    payment.status = status;
    payment.applicationStatus = applicationStatus;
    const result = await service.getCustomerStatus(paymentId, reservationId, customerId);
    assert.equal(result.status, status);
    assert.equal(result.checkoutUrl, null);
    assert.equal(result.qrCode, null);
    assert.equal(result.reconciliationRequired, status === PaymentStatus.RECONCILIATION_REQUIRED ||
      applicationStatus === PaymentApplicationStatus.MANUAL_REVIEW);
  }
});

test('owner can still read original payment status after Reservation Facility metadata changes', async t => {
  const paymentId = String(oid()); const reservationId = String(oid()); const customerId = oid();
  const payment = { _id: paymentId, reservationId, customerId, facilityId: oid(), serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationModel, 'findOne', () => query({ _id: reservationId, customerId, facilityId: oid(), serviceType: 'SELF_STORAGE' }));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  const service = new PayosPaymentService();
  const result = await service.getCustomerStatus(paymentId, reservationId, customerId);
  assert.equal(result.id, paymentId);
  assert.equal(result.status, PaymentStatus.PENDING);
});

test('owner can read a pending intent after eligibility changes but stale checkout URL is withheld', async t => {
  const paymentId = String(oid()); const reservationId = String(oid()); const customerId = oid();
  const payment = { _id: paymentId, reservationId, customerId, facilityId: oid(), serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
    status: PaymentStatus.PENDING, checkoutState: 'READY', checkoutUrl: 'https://pay.example/stale-link', qrCode: DEPOSIT_QR };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  const reservation = { _id: reservationId, customerId, facilityId: payment.facilityId,
    serviceType: 'SELF_STORAGE', status: ReservationStatus.CANCELLED, expiresAt: new Date(Date.now() + 60_000) };
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query(null));
  const service = new PayosPaymentService();
  const cancelled = await service.getCustomerStatus(paymentId, reservationId, customerId);
  assert.equal(cancelled.status, PaymentStatus.PENDING);
  assert.equal(cancelled.checkoutUrl, null);
  assert.equal(cancelled.qrCode, null);
  reservation.status = ReservationStatus.CONTRACTED;
  reservation.expiresAt = new Date(Date.now() - 1_000);
  const expired = await service.getCustomerStatus(paymentId, reservationId, customerId);
  assert.equal(expired.status, PaymentStatus.PENDING);
  assert.equal(expired.checkoutUrl, null);
  assert.equal(expired.qrCode, null);
});

test('valid verified Deposit webhook applies once; duplicate callback does not append history twice', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
    save: async function (options) { assert.ok(options.session); return this; } };
  const contract = { status: ContractStatus.DRAFT };
  const fakeSession = session(); let reservationWrites = 0;
  const gateway = { create: async () => { throw Error('unexpected'); }, get: async () => { throw Error('unexpected'); },
    verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
      reference: 'bank-ref-1', transactionDateTime: '2026-10-29 10:00:00', code: '00', desc: 'success' }) };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query(contract));
  t.mock.method(ReservationModel, 'findOneAndUpdate', (filter, update, options) => {
    reservationWrites += 1; assert.equal(filter.status, ReservationStatus.CONTRACTED); assert.equal(options.session, fakeSession);
    reservation.status = update.$set.status; reservation.depositPaymentId = update.$set.depositPaymentId;
    reservation.statusHistory.push(update.$push.statusHistory); return query(reservation);
  });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.equal(options.session, fakeSession); return this; });
  const service = new PayosPaymentService({ enabled: false, gateway, createSession: async () => fakeSession });
  const body = { code: '00', desc: 'success', success: true, data: {}, signature: 'mock-signature' };
  const first = await service.handleWebhook(body);
  const second = await service.handleWebhook(body);
  assert.equal(first.success, true);
  assert.equal(first.reconciled, false);
  assert.equal(second.duplicate, true);
  assert.equal(reservation.status, ReservationStatus.DEPOSIT_PAID);
  assert.equal(reservationWrites, 1);
  assert.equal(reservation.statusHistory.length, 1);
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.APPLIED);
  assert.equal(payment.providerPaymentLinkId, 'link-1', 'signed webhook may arrive before create-link response persistence');
});

test('documented signed PayOS registration sample is acknowledged without creating or mutating a payment', async t => {
  let paymentWrites = 0;
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(null));
  t.mock.method(ReservationPaymentModel.prototype, 'save', async () => { paymentWrites += 1; });
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', () => { paymentWrites += 1; return query(null); });
  const sample = { orderCode: 123, amount: 3000, currency: 'VND', paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
    reference: 'TF230204212323', description: 'VQRIO123', transactionDateTime: '2023-02-04 18:25:00', code: '00', desc: 'Thành công' };
  const service = new PayosPaymentService({ gateway: { verify: async () => sample } });
  const result = await service.handleWebhook({ data: {}, signature: 'verified-with-test-double' });
  assert.deepEqual(result, { registrationProbe: true, applied: false });
  assert.equal(paymentWrites, 0);
});

test('unknown order with only sample orderCode and amount, or altered sample identity, remains unacknowledged', async t => {
  let lookups = 0;
  t.mock.method(ReservationPaymentModel, 'findOne', () => { lookups += 1; return query(null); });
  const sample = { orderCode: 123, amount: 3000, currency: 'VND', paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
    reference: 'TF230204212323', description: 'VQRIO123', transactionDateTime: '2023-02-04 18:25:00', code: '00', desc: 'Thành công' };
  for (const altered of [{ ...sample, amount: 3001 }, { ...sample, reference: 'unknown-real-reference' },
    { ...sample, paymentLinkId: 'unknown-link' }, { ...sample, description: 'unrelated transaction' }]) {
    const service = new PayosPaymentService({ gateway: { verify: async () => altered } });
    await assert.rejects(service.handleWebhook({ data: {}, signature: 'verified-with-test-double' }), error => {
      assert.equal(error.code, 'PAYMENT_NOT_FOUND'); return true;
    });
  }
  assert.equal(lookups, 4, 'each unknown order may be looked up, but none is accepted as a registration probe');
});

test('verified Deposit with stale amount retains funds evidence but requires reconciliation', async t => {
  const reservation = baseReservation();
  reservation.depositAmount = 125000;
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
    save: async function (options) { assert.ok(options.session); return this; } };
  const contract = { status: ContractStatus.DRAFT };
  let reservationWrites = 0;
  const gateway = { verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
    reference: 'bank-ref-stale-price', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  t.mock.method(mongoose, 'startSession', async () => session());
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query(contract));
  t.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(reservation); });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.ok(options.session); return this; });
  const service = new PayosPaymentService({ gateway, createSession: async () => session() });
  const result = await service.handleWebhook({ data: {}, signature: 'valid' });
  assert.equal(result.reconciled, true);
  assert.equal(payment.providerSettlementStatus, 'VERIFIED');
  assert.equal(payment.status, PaymentStatus.SUCCEEDED);
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
  assert.equal(reservation.status, ReservationStatus.CONTRACTED);
  assert.equal(reservationWrites, 0);
});

test('verified PayOS capture after Facility identity changes is retained for manual reconciliation', async t => {
  const reservation = baseReservation();
  const originalFacilityId = reservation.facilityId;
  reservation.facilityId = oid();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: originalFacilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
    save: async function (options) { assert.ok(options.session); return this; } };
  const gateway = { verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
    reference: 'bank-ref-facility-change', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  const fakeSession = session(); let reservationWrites = 0;
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(reservation); });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.equal(options.session, fakeSession); return this; });
  const service = new PayosPaymentService({ gateway, createSession: async () => fakeSession });
  const result = await service.handleWebhook({ data: {}, signature: 'valid' });
  assert.equal(result.reconciled, true);
  assert.equal(payment.providerSettlementStatus, 'VERIFIED');
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
  assert.equal(reservation.status, ReservationStatus.CONTRACTED);
  assert.equal(reservationWrites, 0);
});

test('concurrent duplicate webhook callbacks serialize to one settlement and one history entry (mock)', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
    save: async function (options) { assert.ok(options.session); return this; } };
  const contract = { status: ContractStatus.DRAFT };
  let transactionTail = Promise.resolve(); let reservationWrites = 0;
  const gateway = { create: async () => null, get: async () => null,
    verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
      reference: 'bank-ref-concurrent', transactionDateTime: '2026-10-29 10:00:00', code: '00', desc: 'success' }) };
  const createSession = async () => ({
    withTransaction: async work => {
      const before = transactionTail; let release;
      transactionTail = new Promise(resolve => { release = resolve; });
      await before;
      try { return await work(); } finally { release(); }
    }, endSession: async () => {},
  });
  t.mock.method(mongoose, 'startSession', createSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query(contract));
  t.mock.method(ReservationModel, 'findOneAndUpdate', (_filter, update) => {
    reservationWrites += 1; reservation.status = update.$set.status;
    reservation.statusHistory.push(update.$push.statusHistory); return query(reservation);
  });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.ok(options.session); return this; });
  const service = new PayosPaymentService({ gateway, createSession });
  const payload = { data: {}, signature: 'verified-by-mock' };
  const results = await Promise.all([service.handleWebhook(payload), service.handleWebhook(payload)]);
  assert.equal(reservationWrites, 1);
  assert.equal(reservation.statusHistory.length, 1);
  assert.equal(payment.providerCaptures.length, 1);
  assert.equal(results.filter(result => result.duplicate).length, 1);
});

test('verified amount mismatch records received funds but never mutates Reservation status', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
    save: async function () { return this; } };
  const fakeSession = session(); let reservationWrites = 0;
  const gateway = { create: async () => null, get: async () => null, verify: async () => ({ orderCode: 1234567890,
    amount: 99000, currency: 'VND', paymentLinkId: 'link-1', reference: 'bank-ref', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(reservation); });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function () { return this; });
  const service = new PayosPaymentService({ enabled: false, gateway, createSession: async () => fakeSession });
  const result = await service.handleWebhook({ data: {}, signature: 'valid' });
  assert.equal(result.reconciled, true);
  assert.equal(payment.status, PaymentStatus.SUCCEEDED);
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
  assert.equal(reservation.status, ReservationStatus.CONTRACTED);
  assert.equal(reservationWrites, 0);
});

test('signed contradictory provider outcome is not applied and requires reconciliation', async t => {
  const payment = { _id: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567890', status: PaymentStatus.PENDING,
    providerOutcomeEvents: [], save: async function () { return this; } };
  let reservationReads = 0;
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(mongoose, 'startSession', async () => session());
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function () { return this; });
  t.mock.method(ReservationModel, 'findOne', () => { reservationReads += 1; return query(null); });
  const service = new PayosPaymentService({ gateway: { verify: async () => ({ orderCode: 1234567890, amount: 100000,
    currency: 'VND', paymentLinkId: 'link-1', reference: 'bank-failed', transactionDateTime: '2026-10-29', code: '05', desc: 'failed' }) } });
  const body = { data: {}, signature: 'valid-signature' };
  const result = await service.handleWebhook(body);
  const replay = await service.handleWebhook(body);
  assert.equal(result.reconciled, true);
  assert.equal(replay.duplicate, true);
  assert.equal(payment.status, PaymentStatus.RECONCILIATION_REQUIRED);
  assert.equal(payment.providerOutcomeEvents.length, 1);
  assert.equal(reservationReads, 0);
});

test('success after a signed failure is preserved as verified funds but requires manual reconciliation', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], providerOutcomeEvents: [], status: PaymentStatus.PENDING,
    save: async function (options) { assert.ok(options.session); return this; } };
  let reservationWrites = 0;
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.ok(options.session); return this; });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(reservation); });
  const gateway = { verify: async payload => payload.data };
  const service = new PayosPaymentService({ gateway, createSession: async () => session() });
  const common = { orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
    transactionDateTime: '2026-10-29', reference: 'bank-ref' };
  await service.handleWebhook({ data: { ...common, code: '05', desc: 'failed' }, signature: 'signed' });
  const result = await service.handleWebhook({ data: { ...common, code: '00', desc: 'success' }, signature: 'signed' });
  assert.equal(result.reconciled, true);
  assert.equal(payment.providerOutcomeEvents.length, 1);
  assert.equal(payment.providerSettlementStatus, 'VERIFIED');
  assert.equal(payment.status, PaymentStatus.SUCCEEDED);
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
  assert.equal(reservation.status, ReservationStatus.CONTRACTED);
  assert.equal(reservationWrites, 0);
});

test('verified Deposit after expiry or cancellation is recorded but does not revive Reservation', async t => {
  for (const state of ['EXPIRED', 'CANCELLED']) {
    await t.test(state, async st => {
      const reservation = baseReservation(state === 'CANCELLED' ? ReservationStatus.CANCELLED : ReservationStatus.CONTRACTED);
      if (state === 'EXPIRED') reservation.expiresAt = new Date(Date.now() - 1_000);
      const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
        serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
        providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
        save: async function (options) { assert.ok(options.session); return this; } };
      let reservationWrites = 0;
      const gateway = { verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
        reference: `late-${state}`, transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
      st.mock.method(mongoose, 'startSession', async () => session());
      st.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
      st.mock.method(ReservationModel, 'findOne', () => query(reservation));
      st.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(reservation); });
      st.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.ok(options.session); return this; });
      const service = new PayosPaymentService({ gateway, createSession: async () => session() });
      const result = await service.handleWebhook({ data: {}, signature: 'verified-by-mock' });
      assert.equal(result.reconciled, true);
      assert.equal(payment.providerSettlementStatus, 'VERIFIED');
      assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
      assert.equal(reservationWrites, 0);
      assert.equal(reservation.status, state === 'CANCELLED' ? ReservationStatus.CANCELLED : ReservationStatus.CONTRACTED);
    });
  }
});

test('late verified capture is retained for reconciliation when another attempt already succeeded', async t => {
  const reservation = baseReservation(ReservationStatus.DEPOSIT_PAID);
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.FAILED,
    save: async function (options) { assert.ok(options.session); return this; } };
  const otherSuccess = { _id: oid() };
  const fakeSession = session(); let reservationWrites = 0;
  const gateway = { create: async () => null, get: async () => null, verify: async () => ({ orderCode: 1234567890,
    amount: 100000, currency: 'VND', paymentLinkId: 'link-1', reference: 'late-bank-ref', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    if (filter.status === PaymentStatus.SUCCEEDED && filter._id?.$ne) return query(otherSuccess);
    return query(payment);
  });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(reservation); });
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function (options) { assert.equal(options.session, fakeSession); return this; });
  const service = new PayosPaymentService({ enabled: false, gateway, createSession: async () => fakeSession });
  const result = await service.handleWebhook({ data: {}, signature: 'valid' });
  assert.equal(result.reconciled, true);
  assert.equal(payment.status, PaymentStatus.RECONCILIATION_REQUIRED);
  assert.equal(payment.providerSettlementStatus, 'VERIFIED');
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
  assert.equal(payment.providerCaptures.length, 1);
  assert.equal(reservationWrites, 0);
});

test('invalid webhook signature is rejected before any payment lookup or write', async t => {
  t.mock.method(ReservationPaymentModel, 'findOne', () => { throw Error('must not query invalid callback'); });
  const sampleShapedProbe = { code: '00', desc: 'success', success: true,
    data: { orderCode: 123, amount: 3000, currency: 'VND', paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
      reference: 'TF230204212323', description: 'VQRIO123', transactionDateTime: '2023-02-04 18:25:00', code: '00', desc: 'Thành công' },
    signature: 'invalid' };
  let verified = false;
  const service = new PayosPaymentService({ gateway: { verify: async () => { verified = true; throw Error('bad signature'); } } });
  await assert.rejects(service.handleWebhook(sampleShapedProbe), error => {
    assert.ok(error instanceof PayosPaymentError);
    assert.equal(error.code, 'PAYOS_WEBHOOK_SIGNATURE_INVALID');
    return true;
  });
  assert.equal(verified, true, 'even a registration-shaped payload must pass SDK signature verification first');
});

test('unknown webhook commit without durable event proof returns 503, never false success', async t => {
  const uncertainSession = {
    withTransaction: async () => { const error = new Error('unknown commit'); error.hasErrorLabel = label => label === 'UnknownTransactionCommitResult'; throw error; },
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => uncertainSession);
  const gateway = { verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
    reference: 'bank-ref', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  const payment = { _id: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567890' };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(null));
  const service = new PayosPaymentService({ gateway, createSession: async () => uncertainSession });
  await assert.rejects(service.handleWebhook({ data: {}, signature: 'valid' }), error => {
    assert.equal(error.code, 'WEBHOOK_OUTCOME_UNKNOWN');
    assert.equal(error.status, 503);
    return true;
  });
});

test('Payment persistence failure aborts the mocked webhook transaction without partial Reservation or capture state', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.PENDING,
    save: async () => { throw Error('simulated Payment persistence failure'); } };
  const contract = { status: ContractStatus.DRAFT };
  const fakeSession = {
    withTransaction: async work => {
      const reservationBefore = { status: reservation.status, depositPaymentId: reservation.depositPaymentId,
        statusHistory: reservation.statusHistory.slice(), inventoryVersion: reservation.inventoryVersion };
      const paymentBefore = { status: payment.status, applicationStatus: payment.applicationStatus,
        providerSettlementStatus: payment.providerSettlementStatus, providerCaptures: payment.providerCaptures.slice() };
      try { return await work(); } catch (error) {
        Object.assign(reservation, reservationBefore); Object.assign(payment, paymentBefore); throw error;
      }
    },
    endSession: async () => {},
  };
  const gateway = { verify: async () => ({ orderCode: 1234567890, amount: 100000, currency: 'VND', paymentLinkId: 'link-1',
    reference: 'bank-ref-rollback', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query(contract));
  t.mock.method(ReservationModel, 'findOneAndUpdate', (_filter, update) => {
    reservation.status = update.$set.status; reservation.depositPaymentId = update.$set.depositPaymentId;
    reservation.statusHistory.push(update.$push.statusHistory); return query(reservation);
  });
  const service = new PayosPaymentService({ gateway, createSession: async () => fakeSession });
  await assert.rejects(service.handleWebhook({ data: {}, signature: 'valid' }), /simulated Payment persistence failure/);
  assert.equal(reservation.status, ReservationStatus.CONTRACTED);
  assert.equal(reservation.depositPaymentId, undefined);
  assert.equal(reservation.statusHistory.length, 0);
  assert.equal(payment.status, PaymentStatus.PENDING);
  assert.equal(payment.providerCaptures.length, 0);
});

test('verified webhook for unknown order code is rejected without a Reservation mutation', async t => {
  let reservationWrites = 0;
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(null));
  t.mock.method(ReservationModel, 'findOneAndUpdate', () => { reservationWrites += 1; return query(null); });
  const gateway = { verify: async () => ({ orderCode: 9876543210, amount: 100000, currency: 'VND', paymentLinkId: 'unknown',
    reference: 'unknown-order', transactionDateTime: '2026-10-29', code: '00', desc: 'success' }) };
  const service = new PayosPaymentService({ gateway });
  await assert.rejects(service.handleWebhook({ data: {}, signature: 'valid' }), error => {
    assert.equal(error.code, 'PAYMENT_NOT_FOUND'); return true;
  });
  assert.equal(reservationWrites, 0);
});
