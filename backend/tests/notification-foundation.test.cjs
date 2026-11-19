const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const NotificationModel = require('../dist/models/notifications/notification.model').default;
const UserModel = require('../dist/models/users/user.model').default;
const ReservationPaymentModel = require('../dist/models/payments/reservation-payment.model').default;
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const { NotificationService } = require('../dist/services/notifications/notification.service');
const { ManagedFullPaymentNotificationRecoveryService } = require('../dist/services/notifications/managed-full-payment-notification-recovery.service');
const { NotificationRecipientResolver } = require('../dist/services/notifications/notification-recipient-resolver.service');
const { NotificationMethod, NotificationType } = require('../dist/types/notification.type');
const controller = require('../dist/controllers/notifications/notification.controller');
const notificationRouter = require('../dist/routes/notification.routes').default;
const fs = require('node:fs');
const path = require('node:path');

const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));
function query(value) {
  return { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return this; },
    select() { return this; }, exec: async () => value };
}
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('notification schema declares partial unique idempotency index without auto-index migration', () => {
  const indexes = NotificationModel.schema.indexes();
  const eventIndex = indexes.find(([, options]) => options.name === 'uniq_notification_user_event_key');
  assert.ok(eventIndex);
  assert.deepEqual(eventIndex[0], { userId: 1, eventKey: 1 });
  assert.equal(eventIndex[1].unique, true);
  assert.ok(eventIndex[1].partialFilterExpression.eventKey);
  assert.equal(NotificationModel.schema.get('autoIndex'), false);
});

test('existing scheduler registers one daily Asia/Ho_Chi_Minh cron with in-process overlap prevention', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server.ts'), 'utf8');
  assert.equal((source.match(/cron\.schedule\(/g) ?? []).length, 1);
  assert.match(source, /'0 8 \* \* \*'/);
  assert.match(source, /timezone:\s*'Asia\/Ho_Chi_Minh'/);
  assert.match(source, /noOverlap:\s*true/);
});

test('recipient resolver verifies active Customer ownership and explicit same-Facility Staff/Manager assignment', async t => {
  const customer = oid(1), facility = oid(2), staff = oid(3), manager = oid(4);
  const filters = []; let missingCustomer = false;
  t.mock.method(UserModel, 'findOne', filter => {
    filters.push(filter);
    return query(missingCustomer || (filter.assignedFacilityId && String(filter.assignedFacilityId) !== String(facility))
      ? null : { _id: filter._id });
  });
  assert.equal(await NotificationRecipientResolver.resolveReservationCustomer({ customerId: customer }), String(customer));
  assert.equal(await NotificationRecipientResolver.resolveAssignedFacilityRecipient(staff, facility, 'FACILITY_STAFF'), String(staff));
  assert.equal(await NotificationRecipientResolver.resolveAssignedFacilityRecipient(manager, facility, 'FACILITY_MANAGER'), String(manager));
  assert.equal(await NotificationRecipientResolver.resolveAssignedFacilityRecipient(staff, oid(5), 'FACILITY_STAFF'), null);
  assert.deepEqual(filters[0], { _id: String(customer), role: 'CUSTOMER', isActive: true });
  assert.deepEqual(filters[1], { _id: String(staff), assignedFacilityId: String(facility), role: 'FACILITY_STAFF', isActive: true });
  assert.deepEqual(filters[2], { _id: String(manager), assignedFacilityId: String(facility), role: 'FACILITY_MANAGER', isActive: true });
  assert.equal(await NotificationRecipientResolver.resolveAssignedFacilityRecipient(staff, 'missing', 'FACILITY_STAFF'), null);
  missingCustomer = true;
  assert.equal(await NotificationRecipientResolver.resolveReservationCustomer({ customerId: customer }), null);
});

test('Managed V3 verified full-rent notification persists only for verified applied transition and uses stable event key', async t => {
  const customerId = oid(10), facilityId = oid(11), reservationId = oid(12), paymentId = oid(13);
  t.mock.method(UserModel, 'findOne', filter => query({ _id: filter._id }));
  t.mock.method(NotificationModel.collection, 'indexes', async () => [{ name: 'uniq_notification_user_event_key', unique: true,
    key: { userId: 1, eventKey: 1 }, partialFilterExpression: { eventKey: { $type: 'string' } } }]);
  const filters = [], docs = [];
  t.mock.method(NotificationService, 'isManagedV3DeliveryEnabled', () => true);
  t.mock.method(NotificationModel, 'updateOne', (filter, update, options) => {
    filters.push(filter); docs.push(update.$setOnInsert); assert.equal(options.upsert, true); return query({ acknowledged: true, upsertedCount: 1 });
  });
  const reservation = { _id: reservationId, customerId, facilityId, reservationCode: 'MI-001', serviceType: 'MANAGED_INVENTORY',
    bookingFlowVersion: 3, rentalPaymentFlow: 'FULL_UPFRONT_V1', status: 'PAID', fullPaymentId: paymentId,
    rentalPricingSnapshot: { totalDue: 150000 } };
  const payment = { _id: paymentId, reservationId, customerId, facilityId, serviceType: 'MANAGED_INVENTORY', provider: 'PAYOS',
    purpose: 'FULL_RENT', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED', amount: 150000,
    providerCaptures: [{ eventHash: 'a'.repeat(64) }] };
  assert.equal(await NotificationService.notifyManagedFullPaymentVerified(reservation, { ...payment, applicationStatus: 'MANUAL_REVIEW' }), false);
  assert.equal(await NotificationService.notifyManagedFullPaymentVerified(reservation, { ...payment, customerId: oid(99) }), false);
  assert.equal(await NotificationService.notifyManagedFullPaymentVerified(reservation, { ...payment, providerCaptures: [] }), false);
  assert.equal(filters.length, 0);
  const concurrentResults = await Promise.all([
    NotificationService.notifyManagedFullPaymentVerified(reservation, payment, 'corr-test'),
    NotificationService.notifyManagedFullPaymentVerified(reservation, payment, 'corr-replay'),
  ]);
  assert.deepEqual(concurrentResults, [true, true]);
  assert.equal(filters.length, 2);
  assert.equal(filters[0].eventKey, filters[1].eventKey);
  assert.equal(docs[0].userId.toString(), String(customerId));
  assert.equal(docs[0].serviceType, 'MANAGED_INVENTORY');
  assert.equal(docs[0].facilityId.toString(), String(facilityId));
  assert.equal(docs[0].relatedEntityId.toString(), String(paymentId));
  assert.equal(docs[0].type, NotificationType.MANAGED_FULL_PAYMENT_VERIFIED);
  assert.deepEqual(docs[0].sentVia, [NotificationMethod.IN_APP]);
  assert.equal(JSON.stringify(docs[0]).includes('PIN'), false);
});

test('idempotent producer fails closed when the unique index is not provisioned', async t => {
  let indexList = [];
  t.mock.method(NotificationModel.collection, 'indexes', async () => indexList);
  let writes = 0; t.mock.method(NotificationModel, 'updateOne', () => { writes++; return query({ acknowledged: true }); });
  let log;
  t.mock.method(console, 'error', value => { log = value; });
  const ok = await NotificationService.safeCreate({ userId: oid(20), type: NotificationType.MANAGED_FULL_PAYMENT_VERIFIED,
    title: 'Thanh toán đã xác minh', content: 'Thông tin thanh toán đã được xác minh.', sentVia: [NotificationMethod.IN_APP],
    serviceType: 'MANAGED_INVENTORY', eventIdentity: 'payment-event' });
  assert.equal(ok, false); assert.equal(writes, 0);
  assert.equal(JSON.parse(log).stage, 'dedupe_index_unavailable');
  indexList = [{ name: 'uniq_notification_user_event_key', unique: true, key: { userId: 1, eventKey: 1 },
    partialFilterExpression: { eventKey: { $exists: true } } }];
  assert.equal(await NotificationService.safeCreate({ userId: oid(20), type: NotificationType.MANAGED_FULL_PAYMENT_VERIFIED,
    title: 'Thanh toán đã xác minh', content: 'Thông tin thanh toán đã được xác minh.', sentVia: [NotificationMethod.IN_APP],
    serviceType: 'MANAGED_INVENTORY', eventIdentity: 'payment-event' }), false);
  assert.equal(writes, 0, 'an index with a different partial filter must not enable the producer');
});

test('bounded recovery scans only verified applied Managed Full Rent and can restart from the first cursor', async t => {
  const paymentA = { _id: oid(40), reservationId: oid(50), serviceType: 'MANAGED_INVENTORY', purpose: 'FULL_RENT',
    provider: 'PAYOS', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED',
    providerCaptures: [{ eventHash: 'b'.repeat(64) }] };
  const paymentB = { ...paymentA, _id: oid(41), reservationId: oid(51), providerCaptures: [{ eventHash: 'c'.repeat(64) }] };
  const reservationA = { _id: paymentA.reservationId }, reservationB = { _id: paymentB.reservationId };
  const filters = [], deliveries = [];
  t.mock.method(NotificationService, 'isManagedV3DeliveryEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(ReservationPaymentModel, 'find', filter => {
    filters.push(filter);
    const rows = [paymentA, paymentB].filter(row => !filter._id || String(row._id) > String(filter._id.$gt));
    return { sort() { return this; }, limit(value) { this.count = value; return this; }, select() { return this; },
      lean() { return this; }, exec: async function () { return rows.slice(0, this.count); } };
  });
  t.mock.method(ReservationModel, 'find', filter => {
    assert.deepEqual(filter._id.$in.map(String), [String(paymentA.reservationId)]);
    assert.equal(filter.bookingFlowVersion, 3);
    return query([reservationA]);
  });
  let persistenceAvailable = false;
  t.mock.method(NotificationService, 'notifyManagedFullPaymentVerified', async (reservation, payment, correlationId) => {
    deliveries.push({ reservation, payment, correlationId }); return persistenceAvailable;
  });

  const firstPass = await ManagedFullPaymentNotificationRecoveryService.recoverBatch({ limit: 1 });
  assert.deepEqual(firstPass, { state: 'READY', scanned: 1, attempted: 1, deferred: 1,
    skipped: 0, nextAfterId: String(paymentA._id), hasMore: true });
  assert.equal(filters[0].status, 'SUCCEEDED');
  assert.equal(filters[0].providerSettlementStatus, 'VERIFIED');
  assert.equal(filters[0].applicationStatus, 'APPLIED');
  assert.equal(filters[0].purpose, 'FULL_RENT');

  // Simulate restart: begin from the first page after index readiness; the deterministic producer upsert is idempotent.
  persistenceAvailable = true;
  const restarted = await ManagedFullPaymentNotificationRecoveryService.recoverBatch({ limit: 1 });
  assert.equal(restarted.deferred, 0);
  assert.equal(deliveries[0].payment, paymentA);
  assert.equal(deliveries[1].payment, paymentA);
  assert.equal(deliveries[0].payment.providerCaptures[0].eventHash, deliveries[1].payment.providerCaptures[0].eventHash);
  assert.equal(filters[1]._id, undefined);
});

test('recovery is disabled before scanning when the unique index is unavailable', async t => {
  let scans = 0;
  t.mock.method(NotificationService, 'isManagedV3DeliveryEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => false);
  t.mock.method(ReservationPaymentModel, 'find', () => { scans++; throw new Error('must not scan'); });
  const result = await ManagedFullPaymentNotificationRecoveryService.recoverBatch({ limit: 10 });
  assert.deepEqual(result, { state: 'BLOCKED_INDEX', scanned: 0, attempted: 0, deferred: 0,
    skipped: 0, nextAfterId: null, hasMore: false });
  assert.equal(scans, 0);
});

test('Managed V3 notification and recovery remain off until the explicit runtime flag is enabled', async t => {
  t.mock.method(NotificationService, 'isManagedV3DeliveryEnabled', () => false);
  let scans = 0;
  t.mock.method(ReservationPaymentModel, 'find', () => { scans++; throw new Error('must not scan'); });
  const result = await ManagedFullPaymentNotificationRecoveryService.recoverBatch();
  assert.equal(result.state, 'BLOCKED_DISABLED');
  assert.equal(scans, 0);
});

test('new Managed V3 customer event gate is separate and defaults disabled', async t => {
  const previous = process.env.MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED;
  delete process.env.MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED;
  assert.equal(NotificationService.isManagedCustomerEventsEnabled(), false);
  process.env.MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED = 'true';
  assert.equal(NotificationService.isManagedCustomerEventsEnabled(), true);
  if (previous === undefined) delete process.env.MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED;
  else process.env.MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED = previous;
  let stored;
  t.mock.method(NotificationService, 'safeCreate', async input => { stored = input; return true; });
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  assert.equal(await NotificationService.notifyManagedCustomerEvent({ userId: String(oid(80)),
    type: NotificationType.MANAGED_VISIT_CREATED, title: 'Đã tạo lịch đến kho', content: 'Cơ sở · thời gian. Tham chiếu: visit-id.',
    facilityId: String(oid(81)), relatedEntityId: String(oid(82)), eventIdentity: 'VISIT:visit-id:REV:0:CREATED' }), true);
  assert.equal(stored.serviceType, 'MANAGED_INVENTORY');
  assert.deepEqual(stored.sentVia, [NotificationMethod.IN_APP]);
  assert.equal(stored.eventIdentity, 'VISIT:visit-id:REV:0:CREATED');
  assert.doesNotMatch(stored.content, /PIN|token|credential|secret/i);
});

test('notification list is owner-scoped, paginated and supports unread filter; mark-read also checks owner', async t => {
  const owner = oid(30), other = oid(31), filters = [];
  t.mock.method(NotificationModel, 'find', filter => { filters.push(filter); return query([{ _id: oid(32), userId: owner }]); });
  t.mock.method(NotificationModel, 'countDocuments', filter => { filters.push(filter); return query(2); });
  t.mock.method(NotificationModel, 'findOneAndUpdate', async filter => { filters.push(filter); return null; });
  const res = response();
  await controller.getMyNotifications({ user: { _id: owner }, query: { page: '2', limit: '10', read: 'unread' } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.data.length, 1);
  assert.deepEqual(filters[0], { userId: owner, isRead: false });
  assert.deepEqual(filters[1], { userId: owner, isRead: false });
  assert.deepEqual(filters[2], { userId: owner, isRead: false });
  const denied = response();
  await controller.markAsRead({ user: { _id: owner }, params: { id: String(oid(33)) } }, denied);
  assert.equal(denied.statusCode, 404);
  assert.deepEqual(filters[3], { _id: String(oid(33)), userId: owner });
  const invalid = response();
  await controller.getMyNotifications({ user: { _id: other }, query: { limit: '1000' } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('notification API authentication rejects requests without a bearer token', async () => {
  const requireAuth = notificationRouter.stack[0].handle;
  const res = response();
  await requireAuth({ headers: {} }, res, () => assert.fail('unauthenticated request must not reach the controller'));
  assert.equal(res.statusCode, 401);
});

test('customer, Staff and Manager notification lists always bind queries to the authenticated user', async t => {
  const owners = [
    { _id: oid(60), role: 'CUSTOMER' },
    { _id: oid(61), role: 'FACILITY_STAFF' },
    { _id: oid(62), role: 'FACILITY_MANAGER' },
  ];
  const filters = [];
  t.mock.method(NotificationModel, 'find', filter => { filters.push(filter); return query([]); });
  t.mock.method(NotificationModel, 'countDocuments', filter => { filters.push(filter); return query(0); });
  for (const user of owners) {
    const res = response();
    await controller.getMyNotifications({ user, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(filters.at(-2).userId, user._id);
    assert.equal(filters.at(-1).userId, user._id);
  }
});
