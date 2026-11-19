const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Visit = require('../dist/models/access/managed-access-visit.model').default;
const Session = require('../dist/models/access/managed-access-session.model').default;
const Audit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const InventoryItem = require('../dist/models/inventory-items/inventory-item.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const { NotificationService } = require('../dist/services/notifications/notification.service');
const { NotificationRecipientResolver } = require('../dist/services/notifications/notification-recipient-resolver.service');
const { ManagedCustomerNotificationRecoveryService: Recovery } = require('../dist/services/notifications/managed-customer-notification-recovery.service');
const { notifyManagedContractAudit, notifyManagedInboundMovement, notifyManagedOutboundMovement,
  notifyManagedRelocationMovement } = require('../dist/services/notifications/managed-event-notification.producer');
const access = require('../dist/services/access/managed-access.service');
const ledger = require('../dist/services/inventory-items/managed-cell-stock.domain');
const producer = require('../dist/services/notifications/managed-event-notification.producer');
const { NotificationType } = require('../dist/types/notification.type');

const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));
function query(value) {
  return { sort() { return this; }, skip() { return this; }, limit() { return this; }, select() { return this; }, lean() { return this; },
    session() { return this; }, exec: async () => value };
}

test('Managed customer recovery fails closed before scanning when gate or dedupe index is unavailable', async t => {
  let scans = 0, enabled = false, indexReady = true;
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => enabled);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => indexReady);
  t.mock.method(Visit, 'find', () => { scans++; throw new Error('must not scan'); });
  assert.equal((await Recovery.recoverVisitBatch()).state, 'BLOCKED_DISABLED');
  enabled = true; indexReady = false;
  assert.equal((await Recovery.recoverSessionBatch()).state, 'BLOCKED_INDEX');
  assert.equal(scans, 0);
});

test('Visit recovery preserves each reschedule occurrence and defers legacy history without snapshots', async t => {
  const visit = { _id: oid(101), customerId: oid(102), facilityId: oid(103), reservationId: oid(104), revision: 4,
    audit: [
      { action: 'VISIT_CREATED', details: { eventRevision: 0, startsAt: '2026-11-20T01:00:00.000Z', endsAt: '2026-11-20T02:00:00.000Z' } },
      { action: 'VISIT_AMENDED', details: { scheduleChanged: true, eventRevision: 2, startsAt: '2026-11-21T01:00:00.000Z', endsAt: '2026-11-21T02:00:00.000Z' } },
      { action: 'VISIT_AMENDED', details: { scheduleChanged: true, eventRevision: 3, startsAt: '2026-11-22T01:00:00.000Z', endsAt: '2026-11-22T02:00:00.000Z' } },
      { action: 'VISIT_CANCELLED', details: { eventRevision: 4 } },
      { action: 'VISIT_AMENDED', details: { scheduleChanged: true } },
    ] };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(Visit, 'find', () => query([visit]));
  const deliveries = [];
  t.mock.method(access, 'notifyVisitTransition', async (...args) => { deliveries.push(args); return true; });
  const result = await Recovery.recoverVisitBatch({ limit: 5 });
  assert.equal(result.attempted, 4);
  assert.equal(result.deferred, 1);
  assert.deepEqual(deliveries.map(row => row[2]), [
    `VISIT:${visit._id}:REV:0:CREATED`, `VISIT:${visit._id}:REV:2:RESCHEDULED`,
    `VISIT:${visit._id}:REV:3:RESCHEDULED`, `VISIT:${visit._id}:REV:4:CANCELLED`,
  ]);
  assert.equal(deliveries[1][4].startsAt, '2026-11-21T01:00:00.000Z');
});

test('Visit no-show recovery uses the persisted MISSED transition and revision', async t => {
  const visit = { _id: oid(105), customerId: oid(106), facilityId: oid(107), reservationId: oid(108), status: 'MISSED', revision: 2,
    audit: [{ action: 'VISIT_MARKED_MISSED', details: { eventRevision: 2 } }] };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(Visit, 'find', () => query([visit]));
  let identity;
  t.mock.method(access, 'notifyVisitTransition', async (_row, type, key) => { identity = [type, key]; return true; });
  const result = await Recovery.recoverVisitBatch({ limit: 1 });
  assert.equal(result.attempted, 1);
  assert.equal(identity[0], NotificationType.MANAGED_VISIT_NO_SHOW);
  assert.equal(identity[1], `VISIT:${visit._id}:REV:2:NO_SHOW`);
});

test('Session recovery maps activation, revoke and persisted expiry to stable session identities', async t => {
  const session = { _id: oid(110), customerId: oid(111), facilityId: oid(112), reservationId: oid(113), visitId: oid(114),
    expiresAt: new Date('2026-11-20T03:00:00.000Z'), revision: 2,
    audit: [{ action: 'SESSION_ACTIVATED' }, { action: 'SESSION_REVOKED' }, { action: 'SESSION_EXPIRED' }] };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(Session, 'find', () => query([session]));
  const deliveries = [];
  t.mock.method(access, 'notifySessionTransition', async (...args) => { deliveries.push(args); return true; });
  const result = await Recovery.recoverSessionBatch({ limit: 5 });
  assert.equal(result.attempted, 3);
  assert.deepEqual(deliveries.map(row => row[2]), [
    `SESSION:${session._id}:ISSUED`, `SESSION:${session._id}:REV:2:REVOKED`, `SESSION:${session._id}:EXPIRED`,
  ]);
  assert.equal(deliveries[1][1], NotificationType.MANAGED_ACCESS_SESSION_REVOKED);
});

test('Contract recovery validates Managed V3 ownership and signed version before creating safe content', async t => {
  const customerId = oid(120), reservation = { _id: oid(121), customerId, facilityId: oid(122), reservationCode: 'MI-TEST',
    serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, statusHistory: [] };
  const audit = { _id: oid(123), reservationId: reservation._id, facilityId: reservation.facilityId,
    action: 'CONTRACT_SIGNED', details: { contractId: oid(124), version: 2, contentHash: 'a'.repeat(64), signerRole: 'FACILITY_STAFF' } };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(Audit, 'find', () => query([audit]));
  t.mock.method(Reservation, 'findOne', () => query(reservation));
  t.mock.method(Contract, 'findOne', () => query({ _id: audit.details.contractId, contentVersions: [{ version: 2, contentHash: audit.details.contentHash }],
    signatures: [{ version: 2, contentHash: audit.details.contentHash, signerRole: 'CUSTOMER' },
      { version: 2, contentHash: audit.details.contentHash, signerRole: 'FACILITY_STAFF' }] }));
  t.mock.method(NotificationRecipientResolver, 'resolveReservationCustomer', async value => String(value.customerId));
  t.mock.method(Facility, 'findById', () => query({ name: 'Kho Quận 1' }));
  const saved = [];
  t.mock.method(NotificationService, 'notifyManagedCustomerEvent', async value => { saved.push(value); return true; });
  const result = await Recovery.recoverContractBatch({ limit: 1 });
  assert.equal(result.attempted, 1);
  assert.equal(result.deferred, 0);
  assert.equal(saved[0].type, NotificationType.MANAGED_CONTRACT_SIGNED);
  assert.equal(saved[0].userId, String(customerId));
  assert.match(saved[0].content, /MI-TEST/);
  assert.doesNotMatch(saved[0].content, /signature|hash|proof|https?:/i);
});

test('Outbound recovery replays the ledger prefix at each movement revision for partial versus full', async t => {
  const reservationId = oid(130), skuId = oid(131), customerId = oid(132), facilityId = oid(133);
  const movements = [1, 2].map((revision, index) => ({ _id: oid(140 + index), itemId: skuId, managedReservationId: reservationId,
    customerId, facilityId, type: 'OUTBOUND', schemaVersion: 4, quantity: 2, quantityUnit: 'thùng', stockEffect: { action: 'REMOVE', ledgerRevision: revision } }));
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(Movement, 'find', filter => filter['stockEffect.ledgerRevision']
    ? query(movements.filter(row => row.stockEffect.ledgerRevision <= filter['stockEffect.ledgerRevision'].$lte)) : query(movements));
  t.mock.method(ledger, 'replayManagedStockMovements', rows => rows.at(-1).stockEffect.ledgerRevision === 1
    ? { lots: [{ reservationId, quantityOnHand: 3 }], instances: [] }
    : { lots: [], instances: [] });
  t.mock.method(Reservation, 'findOne', () => query({ _id: reservationId }));
  t.mock.method(InventoryItem, 'findOne', () => query({ _id: skuId }));
  t.mock.method(NotificationRecipientResolver, 'resolveReservationCustomer', async () => String(customerId));
  t.mock.method(Facility, 'findById', () => query({ name: 'Kho' }));
  const classifications = [];
  t.mock.method(producer, 'notifyManagedOutboundMovement', async (movement, remaining) => { classifications.push([movement._id, remaining]); return true; });
  const result = await Recovery.recoverOutboundBatch({ limit: 5 });
  assert.equal(result.attempted, 2);
  assert.deepEqual(classifications.map(row => row[1]), [3, 0]);
});

test('Outbound event producer rejects invalid scope and derives type only from supplied replay quantity', async t => {
  const movement = { _id: oid(150), itemId: oid(151), managedReservationId: oid(152), customerId: oid(153), facilityId: oid(154),
    schemaVersion: 4, type: 'OUTBOUND', stockEffect: { action: 'REMOVE' }, quantity: 1, quantityUnit: 'thùng' };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(Reservation, 'findOne', () => query({ _id: movement.managedReservationId, customerId: movement.customerId,
    facilityId: movement.facilityId, reservationCode: 'MI-OUT' }));
  t.mock.method(InventoryItem, 'findOne', () => query({ _id: movement.itemId }));
  t.mock.method(NotificationRecipientResolver, 'resolveReservationCustomer', async () => String(movement.customerId));
  t.mock.method(Facility, 'findById', () => query({ name: 'Kho' }));
  const saved = [];
  t.mock.method(NotificationService, 'notifyManagedCustomerEvent', async value => { saved.push(value); return true; });
  assert.equal(await notifyManagedOutboundMovement({ ...movement, type: 'INBOUND' }, 0), false);
  assert.equal(await notifyManagedOutboundMovement(movement, 2), true);
  assert.equal(saved[0].type, NotificationType.MANAGED_OUTBOUND_PARTIAL_CONFIRMED);
  assert.equal(saved[0].eventIdentity, `MOVEMENT:${movement._id}:OUTBOUND`);
  assert.equal(await notifyManagedOutboundMovement(movement, 0), true);
  assert.equal(saved[1].type, NotificationType.MANAGED_OUTBOUND_FULL_CONFIRMED);
  assert.doesNotMatch(saved[0].content, /PIN|token|credential|Cell|receiptId/i);
});

test('Contract producer does not notify until both customer and Facility signatures match the audited version', async t => {
  const reservation = { _id: oid(160), customerId: oid(161), facilityId: oid(162), reservationCode: 'MI-SIGN',
    serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, statusHistory: [] };
  const audit = { _id: oid(163), reservationId: reservation._id, facilityId: reservation.facilityId, action: 'CONTRACT_SIGNED',
    details: { contractId: oid(164), version: 1, contentHash: 'b'.repeat(64), signerRole: 'FACILITY_MANAGER' } };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(Reservation, 'findOne', () => query(reservation));
  t.mock.method(Contract, 'findOne', () => query({ _id: audit.details.contractId,
    contentVersions: [{ version: 1, contentHash: audit.details.contentHash }], signatures: [{ version: 1, contentHash: audit.details.contentHash, signerRole: 'CUSTOMER' }] }));
  assert.equal(await notifyManagedContractAudit(audit), false);
});

test('Inbound and relocation recovery scans only durable V4 Movement transitions', async t => {
  const inbound = { _id: oid(170), schemaVersion: 4, type: 'INBOUND', stockEffect: { action: 'ADD' } };
  const relocation = { _id: oid(171), schemaVersion: 4, type: 'RELOCATION', stockEffect: { action: 'MOVE' } };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(NotificationService, 'isIdempotencyReady', async () => true);
  t.mock.method(Movement, 'find', filter => query(filter.type === 'INBOUND' ? [inbound] : [relocation]));
  const attempted = [];
  t.mock.method(producer, 'notifyManagedInboundMovement', async row => { attempted.push(row); return true; });
  t.mock.method(producer, 'notifyManagedRelocationMovement', async row => { attempted.push(row); return true; });
  assert.equal((await Recovery.recoverInboundBatch({ limit: 1 })).attempted, 1);
  assert.equal((await Recovery.recoverRelocationBatch({ limit: 1 })).attempted, 1);
  assert.deepEqual(attempted, [inbound, relocation]);
});

test('Inbound and relocation producers retain only owner-scoped safe summaries', async t => {
  const common = { _id: oid(180), itemId: oid(181), managedReservationId: oid(182), customerId: oid(183), facilityId: oid(184),
    schemaVersion: 4, quantity: 2, quantityUnit: 'thùng' };
  t.mock.method(NotificationService, 'isManagedCustomerEventsEnabled', () => true);
  t.mock.method(Reservation, 'findOne', () => query({ _id: common.managedReservationId, customerId: common.customerId,
    facilityId: common.facilityId, reservationCode: 'MI-SAFE' }));
  t.mock.method(InventoryItem, 'findOne', () => query({ _id: common.itemId }));
  t.mock.method(NotificationRecipientResolver, 'resolveReservationCustomer', async () => String(common.customerId));
  t.mock.method(Facility, 'findById', () => query({ name: 'Kho A' }));
  const saved = [];
  t.mock.method(NotificationService, 'notifyManagedCustomerEvent', async value => { saved.push(value); return true; });
  assert.equal(await notifyManagedInboundMovement({ ...common, type: 'INBOUND', stockEffect: { action: 'ADD' } }), true);
  assert.equal(await notifyManagedRelocationMovement({ ...common, type: 'RELOCATION', stockEffect: { action: 'MOVE' } }), true);
  assert.deepEqual(saved.map(row => row.type), [NotificationType.MANAGED_INBOUND_CONFIRMED, NotificationType.MANAGED_RELOCATION_CONFIRMED]);
  assert.match(saved[0].content, /2 thùng/);
  assert.doesNotMatch(saved[1].content, /Cell|receiptId|PIN|token|credential/i);
});
