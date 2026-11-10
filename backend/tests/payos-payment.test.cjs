const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');

let PayosPaymentService, payosPaymentService, PayosPaymentError, ReservationPaymentModel,
  ReservationModel, ContractModel, ManagedReservationAuditModel, PaymentApplicationStatus, PaymentProvider, PaymentPurpose,
  PaymentStatus, ReservationStatus, ContractStatus, Controller;
try {
  ({ PayosPaymentService, payosPaymentService, PayosPaymentError } = require('../dist/services/payments/payos-payment.service'));
  ReservationPaymentModel = require('../dist/models/payments/reservation-payment.model').default;
  ReservationModel = require('../dist/models/reservations/reservation.model').default;
  ContractModel = require('../dist/models/contracts/contract.model').default;
  ManagedReservationAuditModel = require('../dist/models/reservations/managed-reservation-audit.model').default;
  ({ PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus } = require('../dist/types/payment.type'));
  ({ ReservationStatus } = require('../dist/types/reservation.type'));
  ({ ContractStatus } = require('../dist/types/contract.type'));
  Controller = require('../dist/controllers/payments/payos-payment.controller');
} catch {
  ({ PayosPaymentService, payosPaymentService, PayosPaymentError } = require('../src/services/payments/payos-payment.service'));
  ReservationPaymentModel = require('../src/models/payments/reservation-payment.model').default;
  ReservationModel = require('../src/models/reservations/reservation.model').default;
  ContractModel = require('../src/models/contracts/contract.model').default;
  ManagedReservationAuditModel = require('../src/models/reservations/managed-reservation-audit.model').default;
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
    assert.deepEqual(filter.$or, [{ serviceType: 'SELF_STORAGE' }, { serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3 }]);
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
    assert.deepEqual(filter.$or, [{ serviceType: 'SELF_STORAGE' }, { serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3 }]);
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
  const expectedCustomerRoute = `https://customer.example/portal/payments/return?reservationId=${reservation._id}&paymentId=${saved._id}&serviceType=SELF_STORAGE`;
  assert.equal(providerRequest.returnUrl, expectedCustomerRoute);
  assert.equal(providerRequest.cancelUrl, `${expectedCustomerRoute}&cancel=true`);
  assert.match(providerRequest.description, /^WDPD[a-f\d]{5}$/i);
  assert.ok(providerRequest.description.length <= 9);
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
  t.mock.method(ReservationModel, 'findOne', filter => query(filter.serviceType === 'MANAGED_INVENTORY' ? null : reservation));
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
  const expectedCustomerRoute = `https://customer.example/portal/payments/return?reservationId=${reservation._id}&paymentId=${saved._id}&serviceType=SELF_STORAGE`;
  assert.equal(providerRequest.returnUrl, expectedCustomerRoute);
  assert.equal(providerRequest.cancelUrl, `${expectedCustomerRoute}&cancel=true`);
  assert.match(providerRequest.description, /^WDPB[a-f\d]{5}$/i);
  assert.ok(providerRequest.description.length <= 9);
  assert.notEqual(providerRequest.returnUrl, 'https://customer.example/portal/payments/507f1f77bcf86cd799439011');
});

test('Managed V3 creates a server-priced PayOS Deposit intent and same key replays the same intent', async t => {
  setPayosCheckoutTestConfig();
  const reservation = { ...baseReservation(ReservationStatus.RESERVED), serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3,
    expiresAt: new Date(Date.now() + 60_000), allocatedCellIds: [oid()], allocatedCapacity: 0.5 };
  const fakeSession = session(); let saved; let providerCalls = 0;
  const gateway = { create: async data => { providerCalls++; assert.equal(data.amount, 100000); return { orderCode: data.orderCode,
    amount: data.amount, currency: 'VND', paymentLinkId: 'managed-link', checkoutUrl: 'https://pay.example/managed', qrCode: DEPOSIT_QR, status: 'PENDING' }; },
    get: async () => null, verify: async () => null };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    if (filter.idempotencyKey) return query(saved || null);
    if (filter.status?.$in || filter.status === PaymentStatus.SUCCEEDED) return query(null);
    return query(null);
  });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ReservationModel, 'findOneAndUpdate', (_filter, update) => { reservation.inventoryVersion += update.$inc.inventoryVersion; return query(reservation); });
  t.mock.method(ContractModel, 'findOne', () => query(null));
  t.mock.method(ReservationPaymentModel.prototype, 'save', async function () { saved = this; return this; });
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => { Object.assign(saved, update.$set); return query(saved); });
  t.mock.method(ReservationPaymentModel, 'updateOne', (filter, update) => {
    if (filter.serviceType !== undefined && filter.serviceType !== saved.serviceType) return query({ matchedCount: 0 });
    if (update.$set.checkoutState === 'READY') {
      assert.equal(filter.serviceType, saved.serviceType);
      for (const key of ['_id', 'reservationId', 'customerId', 'facilityId', 'purpose', 'provider', 'providerReference', 'amount', 'currency', 'status', 'checkoutState']) {
        assert.equal(filter[key], saved[key]);
      }
    }
    Object.assign(saved, update.$set);
    return query({ matchedCount: 1 });
  });
  t.mock.method(ReservationPaymentModel, 'findById', () => query(saved));
  const service = new PayosPaymentService({ enabled: true, gateway, createSession: async () => fakeSession });
  const created = await service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'stable-managed-key', reservation.customerId);
  assert.equal(created.httpStatus, 201); assert.equal(saved.serviceType, 'MANAGED_INVENTORY'); assert.equal(saved.amount, reservation.depositAmount);
  const replay = await service.createCheckout(String(reservation._id), PaymentPurpose.DEPOSIT, 'stable-managed-key', reservation.customerId);
  assert.equal(replay.httpStatus, 200); assert.equal(replay.id, String(saved._id)); assert.equal(providerCalls, 1);
});

for (const serviceType of ['SELF_STORAGE', 'MANAGED_INVENTORY']) {
  for (const purpose of [PaymentPurpose.DEPOSIT, PaymentPurpose.BALANCE]) {
    test(serviceType + ' ' + purpose + ' persists READY with the exact Payment intent identity', async t => {
      setPayosCheckoutTestConfig();
      const payment = { _id: oid(), reservationId: oid(), customerId: oid(), facilityId: oid(), serviceType,
        provider: PaymentProvider.PAYOS, providerReference: '1234567890', purpose, amount: 100000, currency: 'VND',
        status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
      t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (filter, update) => {
        assert.equal(filter.checkoutState, 'NOT_CREATED');
        Object.assign(payment, update.$set);
        return query(payment);
      });
      t.mock.method(ReservationPaymentModel, 'updateOne', (filter, update) => {
        if (filter.serviceType !== payment.serviceType) return query({ matchedCount: 0 });
        for (const key of ['_id', 'reservationId', 'customerId', 'facilityId', 'provider', 'providerReference', 'purpose', 'amount', 'currency', 'status', 'checkoutState']) {
          assert.equal(filter[key], payment[key]);
        }
        assert.equal(filter.$and.length, 2, 'link identity and QR CAS are retained');
        Object.assign(payment, update.$set);
        return query({ matchedCount: 1 });
      });
      t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
      const service = new PayosPaymentService({ gateway: { create: async request => ({
        orderCode: request.orderCode, amount: request.amount, currency: 'VND', status: 'PENDING',
        paymentLinkId: 'link-1', checkoutUrl: 'https://pay.example/checkout',
      }) } });
      // The public-create tests check eligibility and DTO exposure. Here isolate the storage CAS.
      t.mock.method(service, 'customerStatusDto', async row => ({ checkoutStatus: row.checkoutState, checkoutUrl: row.checkoutUrl }));
      const result = await service.createProviderLink(payment);
      assert.equal(result.httpStatus, 201);
      assert.equal(result.checkoutStatus, 'READY');
      assert.equal(result.checkoutUrl, 'https://pay.example/checkout');
    });
  }
}

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
  const firstUrl = `https://customer.example/portal/payments/return?reservationId=${first.reservationId}&paymentId=${first._id}&serviceType=SELF_STORAGE`;
  const secondUrl = `https://customer.example/portal/payments/return?reservationId=${second.reservationId}&paymentId=${second._id}&serviceType=SELF_STORAGE`;
  assert.equal(providerRequests[0].returnUrl, firstUrl);
  assert.equal(providerRequests[0].cancelUrl, `${firstUrl}&cancel=true`);
  assert.equal(providerRequests[1].returnUrl, secondUrl);
  assert.equal(providerRequests[1].cancelUrl, `${secondUrl}&cancel=true`);
  assert.notEqual(firstUrl, secondUrl);
  for (const request of providerRequests) assert.doesNotMatch(request.returnUrl, /access.?token|api.?key|checksum|client-key|orderCode/i);
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
    providerReference: '1234567890', amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' }), error => {
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
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
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
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
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

test('provider create failures are categorized using allowlisted fields and never log sensitive error content', async t => {
  const cases = [
    { label: 'HTTP 200 business 214', error: Object.assign(new Error('PRIVATE response'), { name: 'APIError', status: 200, code: '214', desc: 'PRIVATE provider text' }), category: 'PAYOS_PROVIDER_BUSINESS_NON_SUCCESS', status: 200, code: '214', response: true, description: 'REDACTED' },
    { label: 'HTTP 200 other business rejection', error: Object.assign(new Error('PRIVATE response'), { name: 'APIError', status: 200, code: 'FIXTURE', desc: 'Invalid amount' }), category: 'PAYOS_PROVIDER_BUSINESS_NON_SUCCESS', status: 200, code: 'FIXTURE', response: true, description: 'INVALID_AMOUNT' },
    { label: 'HTTP 400 validation', error: Object.assign(new Error('PRIVATE response detail'), { name: 'BadRequestError', status: 400, code: '231', desc: 'PRIVATE provider text' }), category: 'PAYOS_PROVIDER_VALIDATION_ERROR', status: 400, code: '231', response: true },
    { label: 'HTTP 401 authentication', error: Object.assign(new Error('PRIVATE auth text'), { name: 'UnauthorizedError', status: 401, code: 'AUTH_DENIED' }), category: 'PAYOS_PROVIDER_AUTH_ERROR', status: 401, code: 'AUTH_DENIED', response: true },
    { label: 'HTTP 429 rate limit', error: Object.assign(new Error('PRIVATE rate data'), { name: 'TooManyRequestError', status: 429, code: 'RATE_LIMITED' }), category: 'PAYOS_PROVIDER_RATE_LIMITED', status: 429, code: 'RATE_LIMITED', response: true },
    { label: 'SDK timeout', error: Object.assign(new Error('PRIVATE timeout message'), { name: 'ConnectionTimeoutError' }), category: 'PAYOS_PROVIDER_TIMEOUT', status: 'UNKNOWN', network: 'UNKNOWN', response: false },
    { label: 'network reset', error: Object.assign(new Error('PRIVATE network message'), { code: 'ECONNRESET' }), category: 'PAYOS_PROVIDER_NETWORK_ERROR', status: 'UNKNOWN', network: 'ECONNRESET', response: false },
    { label: 'SDK response parse failure', error: Object.assign(new Error('PRIVATE response body'), { name: 'SyntaxError' }), category: 'PAYOS_PROVIDER_MALFORMED_RESPONSE', status: 'UNKNOWN', network: 'UNKNOWN', response: true },
    { label: 'unknown SDK error', error: Object.assign(new Error('PRIVATE SDK payload'), { name: 'APIError', code: 'secret with spaces' }), category: 'PAYOS_PROVIDER_SDK_ERROR', status: 'UNKNOWN', network: 'UNKNOWN', response: false },
    { label: 'unclassified error', error: Object.assign(new Error('PRIVATE token and checkout URL'), { name: 'SensitiveError', code: 'PRIVATE=VALUE' }), category: 'PAYOS_PROVIDER_UNKNOWN_ERROR', status: 'UNKNOWN', network: 'UNKNOWN', response: false },
  ];

  for (const fixture of cases) await t.test(fixture.label, async subtest => {
    const payment = { _id: oid(), reservationId: oid(), customerId: oid(), facilityId: oid(), serviceType: 'SELF_STORAGE',
      provider: PaymentProvider.PAYOS, providerReference: '1234567898', purpose: PaymentPurpose.DEPOSIT,
      amount: 100000, currency: 'VND', idempotencyKey: 'PAYOS-SS-original-key', status: PaymentStatus.PENDING,
      checkoutState: 'NOT_CREATED', applicationStatus: PaymentApplicationStatus.NOT_APPLIED };
    const diagnostics = [];
    let providerCreates = 0;
    subtest.mock.method(console, 'warn', (...args) => diagnostics.push(args));
    subtest.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
      Object.assign(payment, update.$set); return query(payment);
    });
    subtest.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
      Object.assign(payment, update.$set); return query({ matchedCount: 1 });
    });
    const service = new PayosPaymentService({ gateway: { create: async () => { providerCreates += 1; throw fixture.error; } } });
    await assert.rejects(service.createProviderLink(payment), error => {
      assert.equal(error.code, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN');
      assert.equal(error.status, 503);
      return true;
    });
    assert.equal(providerCreates, 1);
    assert.equal(payment.providerReference, '1234567898', 'UNKNOWN keeps the original provider orderCode');
    assert.equal(payment.idempotencyKey, 'PAYOS-SS-original-key');
    assert.equal(payment.checkoutState, 'UNKNOWN');
    assert.equal(payment.status, PaymentStatus.PENDING, 'a provider create error is not evidence of payment failure');
    const record = diagnostics[0]?.[1];
    assert.equal(record.category, fixture.category);
    assert.equal(record.providerCreateInvoked, true);
    assert.equal(record.providerResponseReceived, fixture.response);
    assert.equal(record.persistenceConfirmed, false);
    assert.equal(record.providerHttpStatus, fixture.status);
    if (fixture.code !== undefined) assert.equal(record.providerErrorCode, fixture.code);
    if (fixture.network !== undefined) assert.equal(record.networkErrorCode, fixture.network);
    if (fixture.description) assert.equal(record.providerDescription, fixture.description);
    const logged = JSON.stringify(diagnostics);
    assert.doesNotMatch(logged, /PRIVATE|secret with spaces|SECRET=VALUE|Bearer|000201|pay\.example/);
    assert.deepEqual(Object.keys(record).sort(), [
      'category', 'correlationId', 'networkErrorCode', 'persistenceConfirmed', 'providerCreateInvoked',
      'providerDescription', 'providerErrorCode', 'providerHttpStatus', 'providerResponseReceived', 'sdkErrorName', 'stage',
    ].sort());
  });
});

for (const [httpStatus, businessCode, category] of [
  [503, '91', 'PAYOS_PROVIDER_UNKNOWN_ERROR'],
  [200, '214', 'PAYOS_PROVIDER_BUSINESS_NON_SUCCESS'],
  [200, '998', 'PAYOS_PROVIDER_BUSINESS_NON_SUCCESS'],
  [200, '00', 'PAYOS_PROVIDER_MALFORMED_RESPONSE'],
]) test('installed SDK uses one create attempt for HTTP ' + httpStatus + ' / ' + businessCode, async t => {
  const envNames = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY', 'PAYOS_CUSTOMER_ORIGIN', 'PAYOS_WEBHOOK_URL', 'PAYOS_LOG'];
  const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const payment = { _id: oid(), reservationId: oid(), customerId: oid(), facilityId: oid(), serviceType: 'SELF_STORAGE',
    provider: PaymentProvider.PAYOS, providerReference: '1234567897', purpose: PaymentPurpose.DEPOSIT,
    amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  let fetchCalls = 0;
  const diagnostics = [];
  const sdkLogs = [];
  process.env.PAYOS_CLIENT_ID = 'synthetic-test-client';
  process.env.PAYOS_API_KEY = 'synthetic-test-api-key';
  process.env.PAYOS_CHECKSUM_KEY = 'synthetic-test-checksum-key';
  process.env.PAYOS_CUSTOMER_ORIGIN = 'https://customer.example';
  process.env.PAYOS_WEBHOOK_URL = 'https://api.example/api/v1/payments/payos/webhook';
  process.env.PAYOS_LOG = 'debug';
  globalThis.fetch = async (url, options) => {
    fetchCalls += 1;
    assert.equal(new URL(url).pathname, '/v2/payment-requests');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    const signedFields = ['amount', 'cancelUrl', 'description', 'orderCode', 'returnUrl'];
    const canonical = signedFields.map(field => field + '=' + body[field]).join('&');
    const signature = require('node:crypto').createHmac('sha256', 'synthetic-test-checksum-key').update(canonical).digest('hex');
    assert.equal(body.signature, signature);
    return new Response(JSON.stringify({ code: businessCode, desc: 'synthetic unavailable', data: null }), {
      status: httpStatus, headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  });
  t.mock.method(console, 'warn', (...args) => diagnostics.push(args));
  for (const method of ['error', 'info', 'debug']) t.mock.method(console, method, (...args) => sdkLogs.push([method, ...args]));
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
    Object.assign(payment, update.$set); return query(payment);
  });
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
    Object.assign(payment, update.$set); return query({ matchedCount: 1 });
  });
  const service = new PayosPaymentService();
  await assert.rejects(service.createProviderLink(payment), error => error.code === 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN');
  assert.equal(fetchCalls, 1, 'maxRetries: 0 prevents an automatic second POST to PayOS');
  assert.equal(payment.checkoutState, 'UNKNOWN');
  assert.equal(payment.providerReference, '1234567897');
  assert.equal(diagnostics.length, 1, 'only WDP safe diagnostics are emitted while PAYOS_LOG=debug');
  assert.equal(diagnostics[0][1].providerHttpStatus, httpStatus);
  assert.equal(diagnostics[0][1].providerErrorCode, businessCode);
  assert.equal(diagnostics[0][1].category, category);
  assert.equal(diagnostics[0][1].providerDescription, 'REDACTED');
  assert.deepEqual(sdkLogs, [], 'SDK logging stays off even when PAYOS_LOG requests debug output');
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
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
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
  assert.match(JSON.stringify(diagnostics), /PAYOS_PROVIDER_MALFORMED_RESPONSE/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /null|orderCode|pay\.example/);
});

test('PayOS create response must be PENDING before WDP persists a READY checkout', async t => {
  for (const providerStatus of ['PAID', 'CANCELLED', 'EXPIRED', 'PROCESSING', undefined]) {
    await t.test(`provider status ${providerStatus ?? 'missing'}`, async subtest => {
      setPayosCheckoutTestConfig();
      const payment = { _id: oid(), reservationId: oid(), provider: PaymentProvider.PAYOS,
        providerReference: '1234567892', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND',
        status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
      const diagnostics = [];
      subtest.mock.method(console, 'warn', (...args) => diagnostics.push(args));
      subtest.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (_filter, update) => {
        Object.assign(payment, update.$set); return query(payment);
      });
      let checkoutWriteCount = 0;
      const service = new PayosPaymentService({ gateway: { create: async data => ({
        orderCode: data.orderCode, amount: data.amount, currency: 'VND', paymentLinkId: 'provider-link',
        checkoutUrl: 'https://pay.payos.vn/web/provider-link', status: providerStatus,
      }) } });
      subtest.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => {
        checkoutWriteCount += 1;
        Object.assign(payment, update.$set);
        return query({ matchedCount: 1 });
      });
      await assert.rejects(service.createProviderLink(payment), error => error.code === 'PAYOS_RESPONSE_MISMATCH');
      assert.equal(payment.checkoutState, 'RECONCILIATION_REQUIRED');
      assert.equal(payment.checkoutUrl, undefined);
      assert.equal(checkoutWriteCount, 1, 'only the fail-closed reconciliation state is persisted');
      assert.equal(diagnostics[0][1].category,
        providerStatus === undefined ? 'PAYOS_PROVIDER_MALFORMED_RESPONSE' : 'PROVIDER_RESPONSE_MISMATCH');
    });
  }
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

test('authenticated cancellation reconciliation marks only provider-confirmed zero-capture CANCELLED and is idempotent', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    facilityId: reservation.facilityId, serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT,
    amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS, providerReference: '1234567896',
    status: PaymentStatus.PENDING, checkoutState: 'READY', applicationStatus: PaymentApplicationStatus.NOT_APPLIED,
    providerSettlementStatus: 'NOT_VERIFIED', providerCaptures: [], providerOutcomeEvents: [], checkoutUrl: 'https://pay.example/link' };
  let providerCalls = 0, auditCalls = 0, reservationWrites = 0;
  const gateway = { get: async orderCode => { providerCalls++; assert.equal(orderCode, 1234567896); return {
    id: 'cancelled-link', orderCode, amount: 100000, amountPaid: 0, status: 'CANCELLED', transactions: [],
  }; } };
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (filter, update) => {
    assert.equal(filter.status.$in.includes(PaymentStatus.PENDING), true);
    Object.assign(payment, update.$set); return query(payment);
  });
  t.mock.method(ReservationModel, 'findOne', () => query(reservation));
  t.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
  t.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => { Object.assign(payment, update.$set); return query({ matchedCount: 1 }); });
  t.mock.method(ManagedReservationAuditModel.prototype, 'save', async function (options) { assert.ok(options.session); auditCalls++; return this; });
  const serviceSession = session();
  t.mock.method(mongoose, 'startSession', async () => serviceSession);
  const service = new PayosPaymentService({ enabled: true, gateway, createSession: async () => serviceSession });
  const first = await service.reconcileCustomerPayment(String(payment._id), String(reservation._id), reservation.customerId);
  assert.equal(first.status, PaymentStatus.CANCELLED);
  assert.equal(first.retryAllowed, true);
  assert.equal(reservation.status, ReservationStatus.CONTRACTED);
  assert.equal(reservationWrites, 0);
  assert.equal(auditCalls, 1);
  const replay = await service.reconcileCustomerPayment(String(payment._id), String(reservation._id), reservation.customerId);
  assert.equal(replay.status, PaymentStatus.CANCELLED);
  assert.equal(providerCalls, 1);
  assert.equal(auditCalls, 1);
});

test('provider PENDING or PAID outcomes never become locally cancelled regardless of return URL parameters', async t => {
  for (const providerStatus of ['PENDING', 'PAID']) {
    await t.test(providerStatus, async st => {
    const reservation = baseReservation();
    const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
      facilityId: reservation.facilityId, serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT,
      amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS, providerReference: '1234567897',
      status: PaymentStatus.PENDING, checkoutState: 'READY', applicationStatus: PaymentApplicationStatus.NOT_APPLIED,
      providerSettlementStatus: 'NOT_VERIFIED', providerCaptures: [], providerOutcomeEvents: [], checkoutUrl: 'https://pay.example/link' };
    st.mock.method(ReservationPaymentModel, 'findOne', () => query(payment));
    st.mock.method(ReservationPaymentModel, 'findById', () => query(payment));
    st.mock.method(ReservationModel, 'findOne', () => query(reservation));
    st.mock.method(ReservationPaymentModel, 'updateOne', (_filter, update) => { Object.assign(payment, update.$set); return query({ matchedCount: 1 }); });
    st.mock.method(ContractModel, 'findOne', () => query({ status: ContractStatus.DRAFT }));
    const service = new PayosPaymentService({ gateway: { get: async orderCode => ({ id: 'provider-link', orderCode,
      amount: 100000, amountPaid: providerStatus === 'PAID' ? 100000 : 0, status: providerStatus, transactions: providerStatus === 'PAID' ? [{ reference: 'captured', amount: 100000 }] : [] }) } });
    const status = await service.reconcileCustomerPayment(String(payment._id), String(reservation._id), reservation.customerId);
    assert.equal(status.status, PaymentStatus.PENDING);
    assert.equal(payment.status, PaymentStatus.PENDING);
    await service.reconcileCheckoutState(payment);
    assert.notEqual(payment.status, PaymentStatus.CANCELLED);
    assert.equal(reservation.status, ReservationStatus.CONTRACTED);
    });
  }
});

test('a different Customer cannot reconcile another owner payment', async t => {
  let providerCalls = 0;
  t.mock.method(ReservationPaymentModel, 'findOne', () => query(null));
  const service = new PayosPaymentService({ gateway: { get: async () => { providerCalls++; throw Error('must not call provider'); } } });
  await assert.rejects(service.reconcileCustomerPayment(String(oid()), String(oid()), oid()), { status: 404 });
  assert.equal(providerCalls, 0);
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
    assert.deepEqual(filter.serviceType.$in, ['SELF_STORAGE', 'MANAGED_INVENTORY']);
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

function managedDepositFixture(t, issue) {
  const now = new Date();
  const reservation = { ...baseReservation(ReservationStatus.RESERVED), serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3,
    startDate: new Date(+now - 60_000), endDate: new Date(+now + 86_400_000),
    expiresAt: new Date(+now + (issue === 'expired reservation' ? -1 : 60_000)), allocatedCellIds: [oid(), oid()], allocatedCapacity: 0.5 };
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'MANAGED_INVENTORY', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567891', providerCaptures: [], status: PaymentStatus.PENDING,
    async save(options) { assert.equal(options.session, transaction); return this; } };
  const rows = reservation.allocatedCellIds.map(cellId => ({
    _id: oid(), cellId, reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    startDate: reservation.startDate, endDate: reservation.endDate, status: 'HOLD', holdExpiresAt: reservation.expiresAt,
  }));
  if (issue === 'missing allocation') rows.pop();
  if (issue === 'extra allocation') rows.push({ ...rows[0], _id: oid(), cellId: oid() });
  if (issue === 'wrong Cell') rows[0].cellId = oid();
  if (issue === 'wrong owner') rows[0].customerId = oid();
  if (issue === 'wrong Facility') rows[0].facilityId = oid();
  if (issue === 'wrong interval') rows[0].endDate = new Date(+reservation.endDate - 1000);
  if (issue === 'expired hold') rows[0].holdExpiresAt = new Date(+now - 1);
  const cell = { zoneId: oid(), rackId: oid() };
  const allocation = mongoose.model('CellAllocation');
  const capacity = mongoose.model('ManagedFacilityCapacity');
  const cells = mongoose.model('WarehouseCell');
  const zone = mongoose.model('WarehouseZone');
  const rack = mongoose.model('WarehouseRack');
  const writes = { reservation: 0, allocation: 0 };
  const transaction = { ...session(), async withTransaction(work) {
    const previousPayment = { ...payment };
    const previousReservation = { ...reservation };
    const previousRows = rows.map(row => ({ ...row }));
    try { return await work(); }
    catch (error) {
      Object.keys(payment).forEach(key => delete payment[key]);
      Object.assign(payment, previousPayment);
      Object.keys(reservation).forEach(key => delete reservation[key]);
      Object.assign(reservation, previousReservation);
      rows.splice(0, rows.length, ...previousRows);
      throw error;
    }
  } };
  const gateway = { verify: async () => ({ orderCode: 1234567891, amount: 100000, currency: 'VND', paymentLinkId: 'managed-link',
    reference: 'managed-bank-ref', transactionDateTime: '2026-11-10 10:00:00', code: '00', desc: 'success' }) };
  t.mock.method(ReservationPaymentModel, 'findOne', filter => query(filter._id?.$ne ? null : payment));
  t.mock.method(ReservationModel, 'findOne', filter => {
    assert.equal(filter.bookingFlowVersion, 3);
    assert.equal(filter.customerId, reservation.customerId);
    return query(reservation);
  });
  t.mock.method(capacity, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(options.session, transaction);
    assert.deepEqual(filter, { facilityId: reservation.facilityId, isActive: true });
    assert.equal(update.$inc.bookingVersion, 1);
    return query({});
  });
  t.mock.method(cells, 'findOne', filter => query({ ...cell, _id: filter._id }));
  t.mock.method(zone, 'findOneAndUpdate', () => query({}));
  t.mock.method(rack, 'findOneAndUpdate', () => query({}));
  t.mock.method(cells, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(options.session, transaction);
    assert.equal(filter.facilityId, reservation.facilityId);
    assert.equal(filter.operationalStatus, 'AVAILABLE');
    assert.equal(update.$inc.allocationVersion, 1);
    return query(issue === 'locked Cell' ? null : { _id: filter._id });
  });
  t.mock.method(allocation, 'find', filter => {
    assert.deepEqual(filter, { reservationId: reservation._id });
    return query(rows);
  });
  t.mock.method(allocation, 'findOne', filter => {
    assert.deepEqual(filter.reservationId, { $ne: reservation._id });
    assert.deepEqual(filter.$or.map(row => row.status), ['OCCUPIED', 'RESERVED', 'HOLD']);
    assert.deepEqual(filter.$or[1].startDate, { $lt: reservation.endDate });
    assert.deepEqual(filter.$or[2].holdExpiresAt, { $gt: now });
    return query(issue === 'conflicting booking' ? { _id: oid(), status: 'HOLD' } : null);
  });
  t.mock.method(ReservationModel, 'findOneAndUpdate', (filter, update, options) => {
    writes.reservation++;
    assert.equal(options.session, transaction);
    assert.equal(filter.status, ReservationStatus.RESERVED);
    assert.equal(filter.bookingFlowVersion, 3);
    assert.deepEqual(filter.$and, [{ inventoryVersion: 4 }]);
    assert.deepEqual(filter.expiresAt, { $gt: now });
    if (issue === 'stale revision') return query(null);
    if (issue === 'write conflict' && writes.reservation === 1) {
      throw Object.assign(new Error('fixture write conflict'), { code: 112 });
    }
    Object.assign(reservation, update.$set);
    return query(reservation);
  });
  t.mock.method(allocation, 'updateMany', (filter, update, options) => {
    writes.allocation++;
    assert.equal(options.session, transaction);
    assert.deepEqual(filter, {
      _id: { $in: rows.map(row => row._id) }, reservationId: reservation._id, facilityId: reservation.facilityId,
      customerId: reservation.customerId, cellId: { $in: reservation.allocatedCellIds }, status: 'HOLD',
      startDate: reservation.startDate, endDate: reservation.endDate, holdExpiresAt: { $eq: reservation.expiresAt, $gt: now },
    });
    const matched = issue === 'partial update' ? rows.slice(0, 1) : rows;
    for (const row of matched) {
      row.status = update.$set.status;
      if (update.$unset.holdExpiresAt === 1) delete row.holdExpiresAt;
    }
    return query({ matchedCount: matched.length });
  });
  const service = new PayosPaymentService({ now: () => now, gateway, createSession: async () => transaction });
  return { payment, reservation, rows, writes, apply: () => service.handleWebhook({ data: {}, signature: 'fixture-signature' }) };
}

test('verified Managed V3 Deposit promotes every HOLD and records DEPOSIT_PAID once', async t => {
  const { reservation, payment, rows, writes, apply } = managedDepositFixture(t);
  assert.deepEqual(await apply(), { success: true, duplicate: false, reconciled: false });
  assert.equal(reservation.status, ReservationStatus.DEPOSIT_PAID);
  assert.equal(reservation.depositPaymentId, payment._id);
  assert.equal(payment.applicationStatus, PaymentApplicationStatus.APPLIED);
  assert.ok(rows.every(row => row.status === 'RESERVED' && row.holdExpiresAt === undefined));
  assert.equal((await apply()).duplicate, true);
  assert.deepEqual(writes, { reservation: 1, allocation: 1 });
  assert.equal(payment.providerCaptures.length, 1);
});

for (const issue of ['expired reservation', 'missing allocation', 'extra allocation', 'wrong Cell', 'wrong owner', 'wrong Facility',
  'wrong interval', 'expired hold', 'locked Cell', 'conflicting booking', 'stale revision']) {
  test('verified Managed V3 Deposit goes to review without promoting holds: ' + issue, async t => {
    const { reservation, payment, rows, writes, apply } = managedDepositFixture(t, issue);
    assert.equal((await apply()).reconciled, true);
    assert.equal(reservation.status, ReservationStatus.RESERVED);
    assert.equal(payment.providerSettlementStatus, 'VERIFIED');
    assert.equal(payment.applicationStatus, PaymentApplicationStatus.MANUAL_REVIEW);
    assert.equal(payment.providerCaptures.length, 1);
    assert.ok(rows.every(row => row.status === 'HOLD'));
    assert.equal(writes.allocation, 0);
  });
}

test('partial Managed V3 allocation write aborts payment and reservation and requests signed webhook retry', async t => {
  const { reservation, payment, rows, writes, apply } = managedDepositFixture(t, 'partial update');
  await assert.rejects(apply, { status: 503, code: 'WEBHOOK_CONCURRENT_RETRY' });
  assert.deepEqual(writes, { reservation: 1, allocation: 1 });
  assert.equal(reservation.status, ReservationStatus.RESERVED);
  assert.equal(payment.status, PaymentStatus.PENDING);
  assert.equal(payment.providerCaptures.length, 0);
  assert.ok(rows.every(row => row.status === 'HOLD'));
});

test('concurrent Managed V3 reservation write aborts cleanly and signed redelivery applies once', async t => {
  const { reservation, payment, rows, writes, apply } = managedDepositFixture(t, 'write conflict');
  await assert.rejects(apply, { status: 503, code: 'WEBHOOK_CONCURRENT_RETRY' });
  assert.equal(reservation.status, ReservationStatus.RESERVED);
  assert.equal(payment.providerCaptures.length, 0);
  assert.ok(rows.every(row => row.status === 'HOLD'));
  assert.equal((await apply()).reconciled, false);
  assert.equal((await apply()).duplicate, true);
  assert.deepEqual(writes, { reservation: 2, allocation: 1 });
  assert.equal(payment.providerCaptures.length, 1);
  assert.ok(rows.every(row => row.status === 'RESERVED'));
});

for (const zeroBalance of [false, true]) {
  test('Managed V3 ' + (zeroBalance ? 'zero Balance' : 'Balance checkout and webhook') + ' permits handover with promoted Cells', async t => {
    setPayosCheckoutTestConfig();
    const { ManagedReservationService } = require('../dist/services/reservations/managed-reservation.service');
    const { payment: deposit, reservation, rows, apply } = managedDepositFixture(t);
    if (zeroBalance) reservation.estimatedRent = deposit.amount;
    assert.equal((await apply()).reconciled, false);
    const hash = 'a'.repeat(64);
    const signed = { status: 'SIGNED', currentContentVersion: 1, contentVersions: [{ version: 1, contentHash: hash }],
      signatures: ['CUSTOMER', 'FACILITY_STAFF'].map(signerRole => ({ signerRole, version: 1, contentHash: hash })) };
    const fakeSession = session();
    t.mock.method(mongoose, 'startSession', async () => fakeSession);
    let balance;
    let providerCalls = 0;
    let event;
    t.mock.method(ContractModel, 'findOne', () => query(signed));
    t.mock.method(ReservationModel, 'findOne', filter => query(
      typeof filter.status === 'string' && filter.status !== reservation.status ? null : reservation,
    ));
    t.mock.method(ReservationModel, 'findOneAndUpdate', (filter, update) => {
      assert.equal(filter.bookingFlowVersion, 3);
      assert.equal(filter.status, reservation.status);
      assert.deepEqual(filter.$and, [{ inventoryVersion: reservation.inventoryVersion }]);
      reservation.inventoryVersion += update.$inc.inventoryVersion;
      Object.assign(reservation, update.$set);
      return query(reservation);
    });
    t.mock.method(ReservationPaymentModel, 'findOne', filter => {
      if (filter._id?.$ne) return query(null);
      if (filter.purpose === PaymentPurpose.DEPOSIT && filter._id === deposit._id) return query(deposit);
      if (balance && (filter._id === balance._id || filter.providerReference === balance.providerReference)) return query(balance);
      return query(null);
    });
    t.mock.method(ReservationPaymentModel.prototype, 'save', async function () { balance = this; return this; });
    t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', (filter, update) => {
      assert.equal(filter._id, balance._id);
      Object.assign(balance, update.$set);
      return query(balance);
    });
    t.mock.method(ReservationPaymentModel, 'updateOne', (filter, update) => {
      if (filter.serviceType !== balance.serviceType) return query({ matchedCount: 0 });
      Object.assign(balance, update.$set);
      return query({ matchedCount: 1 });
    });
    t.mock.method(ReservationPaymentModel, 'findById', () => query(balance));
    const gateway = { async create({ orderCode, amount }) {
      providerCalls++;
      assert.equal(amount, 200000);
      event = { orderCode, amount, currency: 'VND', paymentLinkId: 'balance-v3-link',
        reference: 'balance-v3-bank-ref', transactionDateTime: '2026-11-10 10:00:00', code: '00', desc: 'success' };
      return { ...event, status: 'PENDING', checkoutUrl: 'https://pay.example/managed-balance' };
    }, verify: async () => event };
    const service = new PayosPaymentService({ enabled: true, gateway, createSession: async () => fakeSession });
    const result = await service.createCheckout(String(reservation._id), PaymentPurpose.BALANCE, 'balance-v3-key', reservation.customerId);
    if (zeroBalance) {
      assert.equal(result.httpStatus, 200);
      assert.equal(result.outcome, 'SETTLED');
      assert.equal(result.zeroBalance, true);
      assert.equal(balance, undefined);
      assert.equal((await service.createCheckout(String(reservation._id), PaymentPurpose.BALANCE, 'balance-v3-key', reservation.customerId)).outcome, 'SETTLED');
    } else {
      assert.equal(result.httpStatus, 201);
      assert.equal(result.checkoutStatus, 'READY');
      assert.equal(result.amount, 200000);
      assert.equal(reservation.status, ReservationStatus.DEPOSIT_PAID);
      assert.equal((await service.handleWebhook({})).reconciled, false);
      assert.equal(balance.applicationStatus, PaymentApplicationStatus.APPLIED);
    }
    assert.equal(providerCalls, zeroBalance ? 0 : 1);
    assert.equal(reservation.status, ReservationStatus.PAID);
    t.mock.method(mongoose.model('CellAllocation'), 'countDocuments', filter => {
      assert.equal(filter.status, 'RESERVED');
      assert.deepEqual(filter.cellId.$in, reservation.allocatedCellIds);
      return query(rows.filter(row => row.status === filter.status).length);
    });
    t.mock.method(mongoose.model('Facility'), 'findOne', () => query({}));
    t.mock.method(ManagedReservationAuditModel.prototype, 'save', async function () { return this; });
    reservation.save = async ({ session }) => { assert.equal(session, fakeSession); return reservation; };
    const handedOver = await ManagedReservationService.confirmHandover(String(reservation._id),
      { storageCondition: 'GOOD', accessNotes: 'Fixture access handover' },
      { _id: oid(), role: 'FACILITY_STAFF', assignedFacilityId: reservation.facilityId });
    assert.equal(handedOver.status, ReservationStatus.ACTIVE);
    assert.ok(rows.every(row => row.status === 'RESERVED'));
  });
}

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

test('late verified capture after confirmed cancellation is retained for manual reconciliation', async t => {
  const reservation = baseReservation(ReservationStatus.DEPOSIT_PAID);
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
    serviceType: 'SELF_STORAGE', purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', provider: PaymentProvider.PAYOS,
    providerReference: '1234567890', providerCaptures: [], status: PaymentStatus.CANCELLED,
    checkoutState: 'CANCELLED', cancelVerifiedAt: new Date(), applicationStatus: PaymentApplicationStatus.NOT_APPLIED,
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

test('owner-scoped order lookup is read-only even when PayOS reports PAID', async t => {
  const reservation = baseReservation();
  const payment = { _id: oid(), reservationId: reservation._id, customerId: reservation.customerId,
    provider: PaymentProvider.PAYOS, amount: 100000, currency: 'VND', providerReference: '3000000000',
    providerPaymentLinkId: 'fixture-link', status: PaymentStatus.PENDING, checkoutState: 'UNKNOWN' };
  t.mock.method(ReservationModel, 'findOne', filter => {
    assert.deepEqual(filter, {_id: String(reservation._id), customerId: reservation.customerId, serviceType: 'SELF_STORAGE'});
    return query(reservation);
  });
  t.mock.method(ReservationPaymentModel, 'findOne', filter => {
    assert.deepEqual(filter, {reservationId: String(reservation._id), customerId: reservation.customerId,
      serviceType: 'SELF_STORAGE', provider: 'PAYOS', providerReference: '3000000000'});
    return query(payment);
  });
  for (const method of ['updateOne', 'findOneAndUpdate']) {
    t.mock.method(ReservationPaymentModel, method, () => assert.fail('lookup wrote to DB'));
  }
  const service = new PayosPaymentService({enabled: true, gateway: {
    create: async () => assert.fail('lookup created a link'),
    get: async orderCode => {
      assert.equal(orderCode, 3000000000);
      return {id: 'fixture-link', orderCode, amount: 100000, amountPaid: 100000, status: 'PAID', transactions: [{private: true}]};
    },
  }});
  t.mock.method(payosPaymentService, 'lookupCustomerPayosOrder', service.lookupCustomerPayosOrder.bind(service));
  const res = response();
  await Controller.lookupSelfStoragePayosOrder({params: {id: String(reservation._id), orderCode: '3000000000'},
    user: {_id: reservation.customerId}}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data, {id: String(payment._id), orderCode: 3000000000, paymentLinkId: 'fixture-link',
    amount: 100000, currency: 'VND', amountPaid: 100000, provider: 'PAYOS', providerStatus: 'PAID',
    status: 'PENDING', checkoutStatus: 'UNKNOWN', providerSettlementStatus: 'NOT_VERIFIED', applicationStatus: 'NOT_APPLIED'});
});

test('lookup rejects foreign and malformed order requests before accessing PayOS', async t => {
  const reservationId = oid(), owner = oid();
  let paymentReads = 0;
  t.mock.method(ReservationModel, 'findOne', filter => query(filter.customerId === owner ? {} : null));
  t.mock.method(ReservationPaymentModel, 'findOne', () => { paymentReads++; return query(null); });
  const service = new PayosPaymentService({enabled: true, gateway: {get: async () => assert.fail('unowned provider lookup')}});
  for (const malformed of ['1e3', '001', '0', '0x123', '10000000000', '-12', '1.5', ' 1']) {
    await assert.rejects(service.lookupCustomerPayosOrder(reservationId, malformed, owner), {code: 'INVALID_ORDER_CODE'});
  }
  await assert.rejects(service.lookupCustomerPayosOrder(reservationId, '1', oid()), {code: 'PAYMENT_NOT_FOUND'});
  assert.equal(paymentReads, 0);
  await assert.rejects(service.lookupCustomerPayosOrder(reservationId, '1', owner), {code: 'PAYMENT_NOT_FOUND'});
  assert.equal(paymentReads, 1);
});

test('lookup distinguishes provider missing, auth, transport, business rejection and identity mismatch', async t => {
  const reservationId = oid(), owner = oid();
  t.mock.method(ReservationModel, 'findOne', () => query({}));
  t.mock.method(ReservationPaymentModel, 'findOne', () => query({_id: oid(), amount: 1000, currency: 'VND'}));
  t.mock.method(ReservationPaymentModel, 'updateOne', () => assert.fail('lookup wrote to DB'));
  t.mock.method(console, 'warn', () => {});
  const cases = [
    [Object.assign(Error(), {status: 404}), 404, 'PAYOS_LINK_NOT_FOUND'],
    [Object.assign(Error(), {status: 401}), 502, 'PAYOS_LOOKUP_AUTH_FAILED'],
    [Object.assign(Error(), {name: 'ConnectionTimeoutError'}), 503, 'PAYOS_LOOKUP_UNAVAILABLE'],
    [Object.assign(Error(), {name: 'APIError', status: 200, code: '214'}), 502, 'PAYOS_LOOKUP_REJECTED'],
    [null, 502, 'PAYOS_LOOKUP_MISMATCH'],
  ];
  for (const [error, status, code] of cases) {
    const service = new PayosPaymentService({enabled: true, gateway: {get: async () => {
      if (error) throw error;
      return {id: 'wrong-link', orderCode: 2, amount: 1000, amountPaid: 0, status: 'PENDING'};
    }}});
    await assert.rejects(service.lookupCustomerPayosOrder(reservationId, '1', owner), {status, code});
  }
});

test('corrupt stored checkout payload is rejected before provider invocation', async t => {
  const valid = {reservationId: oid(), purpose: PaymentPurpose.DEPOSIT, providerReference: '3000000000', amount: 1000, currency: 'VND'};
  const service = new PayosPaymentService({gateway: {create: async () => assert.fail('invalid payload reached provider')}});
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', () => assert.fail('invalid payload claimed'));
  await assert.rejects(service.createProviderLink({...valid, providerReference: '1e3'}), {code: 'PAYOS_ORDER_CODE_INVALID'});
  for (const amount of [0, -1, 2.25, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.createProviderLink({...valid, amount}), {code: 'INVALID_PAYMENT_AMOUNT'});
  }
  await assert.rejects(service.createProviderLink({...valid, reservationId: 'bad description'}), {code: 'PAYMENT_RESERVATION_ID_INVALID'});
});

test('read-only order lookup rejects unsigned and invalidly signed SDK responses', async t => {
  const reservationId = oid(), owner = oid();
  const keys = { PAYOS_CLIENT_ID: 'fixture-client', PAYOS_API_KEY: 'fixture-key', PAYOS_CHECKSUM_KEY: 'fixture-checksum' };
  for (const [name, value] of Object.entries(keys)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  t.mock.method(ReservationModel, 'findOne', () => query({}));
  t.mock.method(ReservationPaymentModel, 'findOne', () => query({
    _id: oid(), amount: 1000, currency: 'VND', provider: PaymentProvider.PAYOS,
    status: PaymentStatus.PENDING, checkoutState: 'UNKNOWN',
  }));
  t.mock.method(ReservationPaymentModel, 'updateOne', () => assert.fail('lookup wrote to DB'));
  t.mock.method(console, 'warn', () => {});
  const data = { id: 'signed-link', orderCode: 1000000000, amount: 1000, amountPaid: 0, status: 'PENDING' };
  const crypto = new (require('@payos/node').PayOS)({
    clientId: keys.PAYOS_CLIENT_ID, apiKey: keys.PAYOS_API_KEY, checksumKey: keys.PAYOS_CHECKSUM_KEY,
  }).crypto;
  let signature;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    reads++;
    assert.equal(new URL(url).pathname, '/v2/payment-requests/1000000000');
    assert.equal(options.method, 'GET');
    return Response.json({ code: '00', data, signature });
  });
  const service = new PayosPaymentService({ enabled: true });
  const lookup = () => service.lookupCustomerPayosOrder(reservationId, data.orderCode, owner);
  await assert.rejects(lookup(), { status: 502, code: 'PAYOS_LOOKUP_REJECTED' });
  signature = '0'.repeat(64);
  await assert.rejects(lookup(), { status: 502, code: 'PAYOS_LOOKUP_REJECTED' });
  signature = await crypto.createSignatureFromObj(data, keys.PAYOS_CHECKSUM_KEY);
  assert.equal((await lookup()).providerStatus, 'PENDING');
  assert.equal(reads, 3);
});

test('checkout does not return 201 when the persisted link is not READY on readback', async t => {
  setPayosCheckoutTestConfig();
  const payment = { _id: oid(), reservationId: oid(), provider: PaymentProvider.PAYOS, providerReference: '1234567890',
    purpose: PaymentPurpose.DEPOSIT, amount: 100000, currency: 'VND', status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' };
  const checkoutUrl = 'https://pay.example/link-1';
  t.mock.method(ReservationPaymentModel, 'findOneAndUpdate', () => query({ ...payment, checkoutState: 'CREATING' }));
  t.mock.method(ReservationPaymentModel, 'updateOne', () => query({ matchedCount: 1 }));
  t.mock.method(ReservationPaymentModel, 'findById', () => query({
    ...payment, checkoutState: 'CREATING', checkoutUrl, providerPaymentLinkId: 'link-1',
  }));
  t.mock.method(console, 'warn', (_event, record) => assert.equal(record.category, 'CHECKOUT_READBACK_FAILED'));
  const service = new PayosPaymentService({ gateway: { create: async data => ({
    orderCode: data.orderCode, amount: data.amount, currency: 'VND',
    paymentLinkId: 'link-1', checkoutUrl, status: 'PENDING',
  }) } });
  await assert.rejects(service.createProviderLink(payment), { status: 503, code: 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN' });
});
