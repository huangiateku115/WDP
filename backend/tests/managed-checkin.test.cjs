const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
Object.assign(process.env, { NODE_ENV: 'development', MI_MANAGED_DEPOSIT_FLOW_ENABLED: 'true' });

const Facility = require('../dist/models/facilities/facility.model').default;
const Capacity = require('../dist/models/reservations/managed-facility-capacity.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Profile = require('../dist/models/users/customer-profile.model').default;
const User = require('../dist/models/users/user.model').default;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const CellAllocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const Payment = require('../dist/models/payments/reservation-payment.model').default;
const Audit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const Evidence = require('../dist/models/inventory-items/receiving-inspection-evidence.model').default;
const { ManagedReceivingEvidenceService } = require('../dist/services/upload/managed-receiving-evidence.service');
const { ManagedCheckinService: service, ManagedCheckinError } = require('../dist/services/reservations/managed-checkin.service');

const oid = value => new mongoose.Types.ObjectId(value);
const facilityId = oid('507f1f77bcf86cd799439011');
const customerId = oid('507f1f77bcf86cd799439012');
const staffId = oid('507f1f77bcf86cd799439013');
const reservationId = oid('507f1f77bcf86cd799439014');
const itemId = oid('507f1f77bcf86cd799439015');
const cellId = oid('507f1f77bcf86cd799439016');
let evidenceRows = [], evidenceAttachCalls = 0, auditCalls = 0;
let sessionReadOverlaps = 0;
const activeSessionReads = new WeakMap();

class Query {
  constructor(value) { this.value = value; }
  session(session) { this.sessionRef = session; return this; } lean() { return this; } sort() { return this; } select() { return this; }
  async exec() {
    if (this.sessionRef) {
      if (activeSessionReads.get(this.sessionRef)) sessionReadOverlaps += 1;
      activeSessionReads.set(this.sessionRef, true);
      await new Promise(resolve => setImmediate(resolve));
      activeSessionReads.set(this.sessionRef, false);
    }
    return this.value;
  }
}
function transaction(t, { serialize = false } = {}) {
  evidenceRows = []; evidenceAttachCalls = 0; auditCalls = 0;
  let tail = Promise.resolve();
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => {
    if (!serialize) return fn();
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }, endSession: async () => {} }));
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ bookingVersion: 2 }));
  t.mock.method(Audit.prototype, 'save', async function () { auditCalls += 1; return this; });
  t.mock.method(Evidence, 'findOne', filter => new Query(evidenceRows.find(row => String(row.itemId) === String(filter.itemId) && row.idempotencyKey === filter.idempotencyKey) || null));
  t.mock.method(Evidence, 'countDocuments', filter => new Query(evidenceRows.filter(row => String(row.itemId) === String(filter.itemId)).length));
  t.mock.method(Evidence.prototype, 'save', async function () { if (this.isNew) { evidenceRows.push(this); this.isNew = false; } return this; });
  t.mock.method(ManagedReceivingEvidenceService, 'attach', async (ids, targetItemId, targetFacilityId, targetStaffId, snapshotId) => {
    evidenceAttachCalls += 1;
    return ids.map(uploadId => ({ uploadId, secureUrl: 'https://res.cloudinary.com/demo/evidence.jpg', publicId: 'wdp/evidence/test', sha256: 'hash', width: 100, height: 100, format: 'jpg' }));
  });
}
function fixtures(t, { withItem = true, contract = null, reservationStatus = 'DEPOSIT_PAID', depositAmount = 200 } = {}) {
  const reservation = new Reservation({ _id: reservationId, reservationCode: 'M-001', customerId, facilityId,
    serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 2, status: reservationStatus, allocatedCellIds: [cellId],
    startDate: new Date('2030-01-01Z'), endDate: new Date('2030-02-01Z'), estimatedRent: 1000, depositAmount,
    taxAmount: 0, discountAmount: 0, allocatedCapacity: .12, managedPricingSnapshot: { pricingRule: { currency: 'VND' }, allocatedCapacityM3: .12 }, statusHistory: [] });
  reservation.save = async function () { return this; };
  const item = new Item({ _id: itemId, facilityId, customerId, managedReservationId: reservationId, itemCode: 'BOX-1', name: 'Box', category: 'HOUSEHOLD',
    quantity: 1, quantityUnit: 'box', unitWeightKg: 20, unitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, unitVolumeM3: .008,
    totalWeightKg: 20, totalVolumeM3: .008, currentCellId: null, status: 'PENDING_INBOUND', createdBy: customerId, images: [] });
  item.save = async function () { return this; };
  const zoneId = oid('507f1f77bcf86cd799439018'), rackId = oid('507f1f77bcf86cd799439019');
  const cells = [{ _id: cellId, facilityId, zoneId, rackId, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0,
    dimensions: { widthM: .5, depthM: .5, usableHeightM: .5 }, operationalStatus: 'AVAILABLE' }];
  const allocation = { _id: oid('507f1f77bcf86cd799439020'), reservationId, customerId, cellId, status: 'RESERVED' };
  let liveContract = contract;
  const depositPayment = new Payment({ _id: oid('507f1f77bcf86cd799439017'), reservationId, customerId, facilityId, serviceType: 'MANAGED_INVENTORY',
    purpose: 'DEPOSIT', amount: depositAmount, currency: 'VND', idempotencyKey: 'deposit-1', provider: 'MOCK', status: 'SUCCEEDED' });
  let balancePayment = null;
  let balanceSuccessSaveCount = 0;
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findById', () => new Query(reservation));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: facilityId, name: 'Demo Facility', code: 'DEMO', status: 'ACTIVE' }));
  t.mock.method(Profile, 'findOne', () => new Query({ userId: customerId, address: '1 Example Street', verificationStatus: 'VERIFIED' }));
  t.mock.method(User, 'findById', () => new Query({ _id: customerId, displayName: 'Customer', email: 'customer@example.test', phone: '000' }));
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'find', () => new Query(withItem ? [item] : []));
  // Query methods are chainable; keep sort/lean calls observable without a database.
  t.mock.method(Contract, 'findOne', () => new Query(liveContract));
  t.mock.method(Contract, 'findById', () => new Query(liveContract));
  t.mock.method(Contract.prototype, 'save', async function () { liveContract = this; return this; });
  t.mock.method(Payment, 'findOne', filter => new Query(filter.purpose === 'DEPOSIT' ? depositPayment :
    (filter.idempotencyKey ? (balancePayment?.idempotencyKey === filter.idempotencyKey ? balancePayment : null) :
      (filter.status === 'SUCCEEDED' && balancePayment?.status === 'SUCCEEDED' ? balancePayment : null))));
  t.mock.method(Payment.prototype, 'save', async function () { if (this.purpose === 'BALANCE') { balancePayment = this; if (this.status === 'SUCCEEDED') balanceSuccessSaveCount += 1; } return this; });
  t.mock.method(Cell, 'find', () => new Query(cells));
  t.mock.method(Cell, 'findOneAndUpdate', filter => new Query(cells.find(cell => String(cell._id) === String(filter._id))));
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query({ isActive: true }));
  t.mock.method(Rack, 'findOneAndUpdate', () => new Query({ operationalStatus: 'AVAILABLE' }));
  t.mock.method(CellAllocation, 'countDocuments', () => new Query(1));
  return { reservation, item, cells, allocation, getContract: () => liveContract, setContract: value => { liveContract = value; }, getPayment: () => balancePayment, getBalanceSuccessSaveCount: () => balanceSuccessSaveCount };
}

test('Staff inspection records custody and measurements without placing inventory or changing physical counters', async t => {
  transaction(t);
  const state = fixtures(t);
  const inspected = await service.inspectItem(String(itemId), {
    decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true,
    note: 'Seal checked; dimensions verified', custodyTaken: true,
  }, { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId });
  assert.equal(inspected.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(inspected.receivingCustodyStatus, 'IN_CUSTODY');
  assert.equal(inspected.currentCellId, null);
  assert.equal(inspected.receivingInspection.observedUnitWeightKg, 20);
  assert.equal(state.cells[0].usedWeightKg, 0);
  assert.equal(state.cells[0].usedVolumeM3, 0);
});

test('inspection snapshot atomically retains attached evidence and idempotent replay does not attach or audit twice', async t => {
  transaction(t);
  const state = fixtures(t), uploadId = oid('507f1f77bcf86cd799439021');
  const body = { decision: 'DISCREPANCY', observedQuantity: 1, observedUnitWeightKg: 25,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)],
    packingLayoutVerified: true, note: 'Weight differs', custodyTaken: true,
    evidenceUploadIds: [String(uploadId)], idempotencyKey: 'inspection-replay-001' };
  await service.inspectItem(String(itemId), body, { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId });
  const firstAuditCount = auditCalls;
  const replay = await service.inspectItem(String(itemId), body, { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId });
  assert.equal(replay.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(evidenceRows.length, 1);
  assert.equal(evidenceRows[0].images[0].uploadId.toString(), uploadId.toString());
  assert.equal(evidenceAttachCalls, 1);
  assert.equal(auditCalls, firstAuditCount);
  assert.equal(state.item.receivingInspection.decision, 'DISCREPANCY');
});

test('same inspection idempotency key with a changed payload conflicts before trying to attach spent evidence', async t => {
  transaction(t);
  fixtures(t);
  const body = { decision: 'DISCREPANCY', observedQuantity: 1, observedUnitWeightKg: 25,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)],
    packingLayoutVerified: true, note: 'Weight differs', custodyTaken: true,
    evidenceUploadIds: [], idempotencyKey: 'inspection-payload-001' };
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), body, staff);
  await assert.rejects(service.inspectItem(String(itemId), { ...body, note: 'Changed note' }, staff), { status: 409, message: /different payload/ });
  assert.equal(evidenceRows.length, 1);
  assert.equal(evidenceAttachCalls, 1);
});

test('concurrent Staff submissions with the same key and payload produce one evidence snapshot and one audit', async t => {
  transaction(t, { serialize: true });
  fixtures(t);
  const body = { decision: 'DISCREPANCY', observedQuantity: 1, observedUnitWeightKg: 25,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)],
    packingLayoutVerified: true, note: 'Concurrent evidence review', custodyTaken: true,
    evidenceUploadIds: [], idempotencyKey: 'inspection-concurrent-001' };
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  const [first, replay] = await Promise.all([
    service.inspectItem(String(itemId), body, staff),
    service.inspectItem(String(itemId), body, staff),
  ]);
  assert.equal(first.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(replay.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(evidenceRows.length, 1);
  assert.equal(evidenceAttachCalls, 1);
  assert.equal(auditCalls, 1);
});

test('an accepted inspection cannot be overwritten by a later non-idempotent attempt', async t => {
  transaction(t);
  const state = fixtures(t), body = { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)],
    packingLayoutVerified: true, note: 'Accepted', custodyTaken: true };
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), body, staff);
  await assert.rejects(service.inspectItem(String(itemId), { ...body, note: 'Overwritten' }, staff), { status: 409, message: /cannot be overwritten/ });
  assert.equal(evidenceRows.length, 1);
  assert.equal(state.item.receivingInspection.note, 'Accepted');
});

test('an accepted PENDING_INBOUND inspection may only be followed by the same inspection taking custody', async t => {
  transaction(t);
  const state = fixtures(t), base = { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)],
    packingLayoutVerified: true, note: 'Accepted seal', custodyTaken: false };
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), base, staff);
  await service.inspectItem(String(itemId), { ...base, custodyTaken: true, evidenceUploadIds: [] }, staff);
  assert.equal(state.item.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(state.item.receivingCustodyStatus, 'IN_CUSTODY');
  assert.equal(evidenceRows.length, 2);
  assert.equal(evidenceRows[0].decision, 'ACCEPTED');
  assert.equal(evidenceRows[1].decision, 'ACCEPTED');
});

test('Inspection rejects other-Facility Staff and accepted goods that do not fit an allocated empty Cell', async t => {
  transaction(t);
  const state = fixtures(t);
  state.item.quantity = 2;
  state.item.unitWeightKg = 60;
  const request = { decision: 'ACCEPTED', observedQuantity: 2, observedUnitWeightKg: 60,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'checked', custodyTaken: false };
  await assert.rejects(service.inspectItem(String(itemId), request, { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: oid('507f1f77bcf86cd799439099') }), { status: 403 });
  await assert.rejects(service.inspectItem(String(itemId), request, { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId }), { status: 409, message: /fit every selected/ });
  assert.equal(state.item.status, 'PENDING_INBOUND');
});

test('discrepant goods can be held for review but cannot enter the contract or inventory accounting', async t => {
  transaction(t);
  const state = fixtures(t);
  const result = await service.inspectItem(String(itemId), { decision: 'DISCREPANCY', observedQuantity: 1, observedUnitWeightKg: 25,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true,
    note: 'Scale reads 25kg; registration says 20kg', custodyTaken: true }, { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId });
  assert.equal(result.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(result.receivingInspection.decision, 'DISCREPANCY');
  await assert.rejects(service.createOrRefreshContract(String(reservationId), { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId }), { status: 409, message: /Resolve all receiving discrepancies/ });
  assert.equal(state.cells[0].usedWeightKg, 0);
  assert.equal(state.cells[0].usedVolumeM3, 0);
  assert.equal(state.allocation.status, 'RESERVED');
});

test('returned rejected goods must be corrected and reinspected before contract creation', async t => {
  transaction(t);
  const state = fixtures(t);
  state.item.status = 'REGISTERED';
  state.item.receivingInspection = { decision: 'REJECTED', note: 'Returned to owner' };
  await assert.rejects(service.createOrRefreshContract(String(reservationId), { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId }), { status: 409, message: /rejected inspections/ });
  assert.equal(state.item.currentCellId, null);
  assert.equal(state.cells[0].usedWeightKg, 0);
  assert.equal(state.allocation.status, 'RESERVED');
});

test('Managed contract generation performs database reads sequentially on one transaction session', async t => {
  transaction(t);
  const state = fixtures(t);
  state.item.receivingInspection = { decision: 'ACCEPTED', observedQuantity: 1,
    inspectedAt: new Date('2026-01-01T00:00:00Z'), compatibleWithCellIds: [cellId] };
  sessionReadOverlaps = 0;
  await service.createOrRefreshContract(String(reservationId), {
    _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId,
  });
  assert.equal(sessionReadOverlaps, 0, 'no overlapping DB query may use this transaction session');
});

test('one signature remains DRAFT; owner and same-Facility representative signing one hash completes the contract', async t => {
  transaction(t);
  const state = fixtures(t);
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'inspected', custodyTaken: false }, staff);
  let contract = await service.createOrRefreshContract(String(reservationId), staff);
  state.setContract(contract);
  assert.equal(contract.currentContentVersion, 1);
  contract = await service.signContract(String(contract._id), { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null });
  state.setContract(contract);
  assert.equal(contract.status, 'DRAFT');
  contract = await service.signFacilityContract(String(contract._id), staff);
  assert.equal(contract.status, 'SIGNED');
  assert.equal(contract.signatures.filter(s => s.version === 1).length, 2);
  const wrongFacility = { _id: staffId, role: 'FACILITY_MANAGER', assignedFacilityId: oid('507f1f77bcf86cd799439099') };
  await assert.rejects(service.signFacilityContract(String(contract._id), wrongFacility), { status: 403 });
});

test('balance is rent less credited deposit; success reaches CHECKIN_READY but not ACTIVE or physical inbound', async t => {
  transaction(t);
  const state = fixtures(t);
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'inspected', custodyTaken: false }, staff);
  let contract = await service.createOrRefreshContract(String(reservationId), staff); state.setContract(contract);
  contract = await service.signContract(String(contract._id), { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null }); state.setContract(contract);
  contract = await service.signFacilityContract(String(contract._id), staff); state.setContract(contract);
  const initiated = await service.initiateBalance(String(reservationId), { idempotencyKey: 'balance-1' }, { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null });
  assert.equal(initiated.amount, 800);
  assert.equal(initiated.payment.purpose, 'BALANCE');
  const settled = await service.confirmMockBalance(String(reservationId), { idempotencyKey: 'balance-1' }, { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null });
  assert.equal(settled.reservation.status, 'CHECKIN_READY');
  assert.notEqual(settled.reservation.status, 'ACTIVE');
  assert.equal(state.item.status, 'PENDING_INBOUND');
  assert.equal(state.item.currentCellId, null);
  assert.equal(state.cells[0].usedWeightKg, 0);
  assert.equal(state.cells[0].usedVolumeM3, 0);
  assert.equal(state.allocation.status, 'RESERVED');
  assert.equal(state.getPayment().purpose, 'BALANCE');
  const replay = await service.confirmMockBalance(String(reservationId), { idempotencyKey: 'balance-1' }, { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null });
  assert.equal(replay.idempotent, true);
});

test('concurrent duplicate balance confirmations settle once and replay the same payment', async t => {
  transaction(t, { serialize: true });
  const state = fixtures(t);
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'inspected', custodyTaken: false }, staff);
  let contract = await service.createOrRefreshContract(String(reservationId), staff); state.setContract(contract);
  contract = await service.signContract(String(contract._id), { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null }); state.setContract(contract);
  await service.signFacilityContract(String(contract._id), staff);
  await service.initiateBalance(String(reservationId), { idempotencyKey: 'balance-concurrent' }, { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null });
  const actor = { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null };
  const [first, replay] = await Promise.all([
    service.confirmMockBalance(String(reservationId), { idempotencyKey: 'balance-concurrent' }, actor),
    service.confirmMockBalance(String(reservationId), { idempotencyKey: 'balance-concurrent' }, actor),
  ]);
  assert.equal(first.reservation.status, 'CHECKIN_READY');
  assert.equal(replay.reservation.status, 'CHECKIN_READY');
  assert.equal(first.payment._id.toString(), replay.payment._id.toString());
  assert.equal(state.getBalanceSuccessSaveCount(), 1);
  assert.equal(state.cells[0].usedWeightKg, 0);
  assert.equal(state.allocation.status, 'RESERVED');
});

test('new contract version excludes signatures from superseded content', async t => {
  transaction(t);
  const state = fixtures(t);
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'first inspection', custodyTaken: false }, staff);
  let contract = await service.createOrRefreshContract(String(reservationId), staff); state.setContract(contract);
  contract = await service.signContract(String(contract._id), { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null }); state.setContract(contract);
  state.item.receivingInspection.note = 'updated inspection details';
  let refreshed = await service.createOrRefreshContract(String(reservationId), staff); state.setContract(refreshed);
  assert.equal(refreshed.currentContentVersion, 2);
  assert.equal(refreshed.status, 'DRAFT');
  assert.equal(refreshed.signatures.filter(s => s.version === 2).length, 0);
  assert.equal(refreshed.signatures.filter(s => s.version === 1).length, 1);
});

test('contract creation is idempotent and does not create a second content version for identical handover data', async t => {
  transaction(t);
  const state = fixtures(t);
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'inspected', custodyTaken: false }, staff);
  const first = await service.createOrRefreshContract(String(reservationId), staff); state.setContract(first);
  const replay = await service.createOrRefreshContract(String(reservationId), staff);
  assert.equal(String(replay._id), String(first._id));
  assert.equal(replay.currentContentVersion, 1);
});

test('zero remaining balance is explicitly settled without a zero-value payment record', async t => {
  transaction(t);
  const state = fixtures(t, { depositAmount: 1000 });
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId };
  await service.inspectItem(String(itemId), { decision: 'ACCEPTED', observedQuantity: 1, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(cellId)], packingLayoutVerified: true, note: 'inspected', custodyTaken: false }, staff);
  let contract = await service.createOrRefreshContract(String(reservationId), staff); state.setContract(contract);
  contract = await service.signContract(String(contract._id), { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null }); state.setContract(contract);
  contract = await service.signFacilityContract(String(contract._id), staff); state.setContract(contract);
  const result = await service.initiateBalance(String(reservationId), { idempotencyKey: 'balance-zero' }, { _id: customerId, role: 'CUSTOMER', assignedFacilityId: null });
  assert.equal(result.amount, 0);
  assert.equal(result.payment, null);
  assert.equal(result.zeroBalance, true);
  assert.equal(result.reservation.status, 'CHECKIN_READY');
  assert.equal(state.item.status, 'PENDING_INBOUND');
  assert.equal(state.cells[0].usedWeightKg, 0);
});
