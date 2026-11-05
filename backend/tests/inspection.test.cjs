const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URL: 'mongodb://localhost:27017/wdp-test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});

const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const InspectionController = require('../dist/controllers/inspections/inspection.controller');
const ReservationController = require('../dist/controllers/reservations/reservation.controller');
const Inspection = require('../dist/models/inspections/inspection.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const StorageUnit = require('../dist/models/storage-units/storage-unit.model').default;

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

function ids() {
  return { inspectionId: new mongoose.Types.ObjectId(), reservationId: new mongoose.Types.ObjectId(),
    facilityId: new mongoose.Types.ObjectId(), unitId: new mongoose.Types.ObjectId(),
    staffId: new mongoose.Types.ObjectId() };
}

function checkInFixture() {
  const key = ids();
  return { key,
    inspection: { _id: key.inspectionId, reservationId: key.reservationId, facilityId: key.facilityId,
      storageUnitId: key.unitId, type: 'CHECK_IN', status: 'DRAFT' },
    reservation: { _id: key.reservationId, facilityId: key.facilityId, storageUnitId: key.unitId,
      serviceType: 'SELF_STORAGE', status: 'PAID' },
    actor: { _id: key.staffId, role: 'FACILITY_STAFF', assignedFacilityId: key.facilityId } };
}

test('CHECK_IN activation fails closed in production and unknown environments before writes', async t => {
  const oldEnv = process.env.NODE_ENV;
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, actor } = checkInFixture();
  let inspectionWrites = 0, reservationReads = 0, reservationWrites = 0, unitWrites = 0;
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Inspection, 'findOneAndUpdate', async () => { inspectionWrites++; return inspection; });
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => { reservationReads++; return null; } }));
  t.mock.method(Reservation, 'findByIdAndUpdate', async () => { reservationWrites++; return null; });
  t.mock.method(StorageUnit, 'findByIdAndUpdate', async () => { unitWrites++; return null; });

  for (const env of ['production', undefined]) {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    const res = response();
    await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /disabled in this environment/i);
  }
  assert.equal(inspectionWrites, 0);
  assert.equal(reservationReads, 0);
  assert.equal(reservationWrites, 0);
  assert.equal(unitWrites, 0);
});

test('CHECK_IN rejects mismatched Facility or unit linkage before any transition', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  inspection.facilityId = new mongoose.Types.ObjectId();
  let inspectionWrites = 0, reservationWrites = 0, unitReads = 0;
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(Inspection, 'findOneAndUpdate', async () => { inspectionWrites++; return inspection; });
  t.mock.method(Reservation, 'findOneAndUpdate', async () => { reservationWrites++; return reservation; });
  t.mock.method(StorageUnit, 'findOne', () => { unitReads++; return { exec: async () => null }; });
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 404, JSON.stringify(res.body));
  assert.equal(inspectionWrites, 0);
  assert.equal(reservationWrites, 0);
  assert.equal(unitReads, 0);
});

test('CHECK_IN rejects Staff assigned to another Facility before opening a transaction', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  actor.role = 'FACILITY_MANAGER';
  actor.assignedFacilityId = new mongoose.Types.ObjectId();
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  let sessions = 0;
  t.mock.method(mongoose, 'startSession', async () => { sessions++; throw new Error('must not start'); });
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(sessions, 0);
});

test('CHECK_IN denies unscoped Admin/BOM and Managed Inventory before transaction writes', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation } = checkInFixture();
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  let sessions = 0;
  t.mock.method(mongoose, 'startSession', async () => { sessions++; throw new Error('must not start'); });
  for (const role of ['ADMIN', 'BOM']) {
    const res = response();
    await InspectionController.completeInspection({ params: { id: String(key.inspectionId) },
      user: { _id: key.staffId, role } }, res);
    assert.equal(res.statusCode, 404);
  }
  reservation.serviceType = 'MANAGED_INVENTORY';
  const managed = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) },
    user: { _id: key.staffId, role: 'FACILITY_STAFF', assignedFacilityId: key.facilityId } }, managed);
  assert.equal(managed.statusCode, 409);
  assert.equal(sessions, 0);
});

test('repeated CHECK_IN cannot append a second activation or change completed inspection', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, actor } = checkInFixture();
  inspection.status = 'COMPLETED';
  let reads = 0, writes = 0;
  t.mock.method(Inspection, 'findById', async () => { reads++; return inspection; });
  t.mock.method(Inspection, 'findOneAndUpdate', () => { writes++; return { exec: async () => inspection }; });
  t.mock.method(Reservation, 'findById', () => { reads++; return { exec: async () => null }; });
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});

test('competing generic handover and CHECK_IN mock CAS permits only one activation history entry', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, actor } = checkInFixture();
  const state = { reservationStatus: 'PAID', reservationVersion: 0, unitStatus: 'RESERVED',
    unitVersion: 0, inspectionStatus: 'DRAFT', inspectionVersion: 0, history: [] };
  const reservationSnapshot = () => ({ _id: key.reservationId, facilityId: key.facilityId,
    storageUnitId: key.unitId, serviceType: 'SELF_STORAGE', status: state.reservationStatus,
    __v: state.reservationVersion, statusHistory: [...state.history] });
  const inspectionSnapshot = () => ({ _id: key.inspectionId, reservationId: key.reservationId,
    facilityId: key.facilityId, storageUnitId: key.unitId, type: 'CHECK_IN',
    status: state.inspectionStatus, __v: state.inspectionVersion });
  const versionMatches = (filter, field, version) => filter.$or?.some(entry =>
    entry[field] === version || (version === 0 && entry[field]?.$exists === false));
  let transactionTail = Promise.resolve();
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async callback => {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      const snapshot = { ...state, history: [...state.history] };
      try { return await callback(); }
      catch (error) { Object.assign(state, snapshot); throw error; }
      finally { release(); }
    }, endSession: async () => {},
  }));
  t.mock.method(Inspection, 'findById', async () => inspectionSnapshot());
  t.mock.method(Reservation, 'findById', () => {
    const result = reservationSnapshot();
    return { exec: async () => result,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  });
  t.mock.method(StorageUnit, 'findOne', () => ({ exec: async () => ({ _id: key.unitId,
    facilityId: key.facilityId, status: state.unitStatus, bookingVersion: state.unitVersion }) }));
  t.mock.method(StorageUnit, 'findOneAndUpdate', (filter, update) => ({ exec: async () => {
    if (update.$inc?.bookingVersion === 1) {
      if (state.unitVersion !== (filter.$or?.find(x => typeof x.bookingVersion === 'number')?.bookingVersion ?? -1) &&
          !(state.unitVersion === 0 && filter.$or?.some(x => x.bookingVersion?.$exists === false))) return null;
      state.unitVersion++;
    } else {
      if (filter.bookingVersion !== state.unitVersion) return null;
      state.unitStatus = update.$set.status;
    }
    return { _id: key.unitId, status: state.unitStatus };
  } }));
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update) => ({ exec: async () => {
    if (state.reservationStatus !== 'PAID' || !versionMatches(filter, '__v', state.reservationVersion)) return null;
    state.reservationStatus = update.$set.status;
    state.reservationVersion++;
    if (update.$push?.statusHistory) state.history.push(update.$push.statusHistory);
    return reservationSnapshot();
  } }));
  t.mock.method(Inspection, 'findOneAndUpdate', (filter, update) => ({ exec: async () => {
    if (state.inspectionStatus !== 'DRAFT' || !versionMatches(filter, '__v', state.inspectionVersion)) return null;
    state.inspectionStatus = update.$set.status;
    state.inspectionVersion++;
    return inspectionSnapshot();
  } }));

  const handoverResponse = response();
  const checkInResponse = response();
  await Promise.all([
    ReservationController.handoverReservation({ params: { id: String(key.reservationId) },
      user: { _id: key.staffId, role: 'FACILITY_STAFF', assignedFacilityId: key.facilityId } }, handoverResponse),
    InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, checkInResponse),
  ]);
  const statuses = [handoverResponse.statusCode, checkInResponse.statusCode];
  assert.equal(statuses.filter(status => status === 200).length, 1);
  assert.ok(statuses.every(status => status === 200 || status === 409 || status === 400));
  assert.equal(state.reservationStatus, 'ACTIVE');
  assert.equal(state.unitStatus, 'OCCUPIED');
  assert.equal(state.history.length, 1);
});

test('CHECK_OUT completion keeps its existing non-transactional route behavior', async t => {
  const key = ids();
  process.env.NODE_ENV = 'production';
  const checkout = { _id: key.inspectionId, reservationId: key.reservationId, facilityId: key.facilityId,
    storageUnitId: key.unitId, type: 'CHECK_OUT', status: 'DRAFT', condition: 'GOOD' };
  let sessions = 0, reservationStatus, unitStatus;
  t.mock.method(Inspection, 'findById', async () => checkout);
  t.mock.method(Reservation, 'findById', () => ({ select: () => ({ exec: async () => ({ serviceType: 'SELF_STORAGE' }) }) }));
  t.mock.method(Inspection, 'findOneAndUpdate', () => ({ status: 'COMPLETED', type: 'CHECK_OUT',
    reservationId: key.reservationId, storageUnitId: key.unitId }));
  t.mock.method(Reservation, 'findByIdAndUpdate', async (_id, update) => { reservationStatus = update.status; });
  t.mock.method(StorageUnit, 'findByIdAndUpdate', async (_id, update) => { unitStatus = update.status; });
  t.mock.method(mongoose, 'startSession', async () => { sessions++; throw new Error('CHECK_OUT must not open a transaction in this patch'); });
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) },
    user: { _id: key.staffId, role: 'FACILITY_STAFF' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(reservationStatus, 'CHECKED_OUT');
  assert.equal(unitStatus, 'AVAILABLE');
  assert.equal(sessions, 0);
});

test('CHECK_IN requires a scoped PAID Self-Storage Reservation and exact linked StorageUnit', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  const writes = [];
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(StorageUnit, 'findOne', filter => ({ exec: async () => {
    assert.equal(String(filter._id), String(key.unitId));
    assert.equal(String(filter.facilityId), String(key.facilityId));
    return { _id: key.unitId, facilityId: key.facilityId, bookingVersion: 0 };
  } }));
  t.mock.method(Inspection, 'findOneAndUpdate', (filter, update, options) => ({ exec: async () => {
    writes.push('inspection');
    assert.equal(options.session, session);
    assert.ok(filter.$or.some(entry => entry.__v === 0) &&
      filter.$or.some(entry => entry.__v?.$exists === false), 'legacy missing __v remains compatible');
    assert.equal(filter.status, 'DRAFT');
    assert.equal(filter.type, 'CHECK_IN');
    assert.deepEqual(update, { $set: { status: 'COMPLETED' }, $inc: { __v: 1 } });
    return { ...inspection, status: 'COMPLETED' };
  } }));
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update, options) => ({ exec: async () => {
    writes.push('reservation');
    assert.equal(options.session, session);
    assert.ok(filter.$or.some(entry => entry.__v === 0) &&
      filter.$or.some(entry => entry.__v?.$exists === false), 'legacy missing __v remains compatible');
    assert.equal(filter.serviceType, 'SELF_STORAGE');
    assert.equal(filter.status, 'PAID');
    assert.equal(String(filter.facilityId), String(key.facilityId));
    assert.equal(String(filter.storageUnitId), String(key.unitId));
    return { ...reservation, status: 'ACTIVE' };
  } }));
  let unitWrites = 0;
  t.mock.method(StorageUnit, 'findOneAndUpdate', (filter, update, options) => ({ exec: async () => {
    writes.push(unitWrites++ === 0 ? 'unit-token' : 'unit-status');
    assert.equal(options.session, session);
    assert.equal(String(filter._id), String(key.unitId));
    assert.equal(String(filter.facilityId), String(key.facilityId));
    if (unitWrites === 1) {
      assert.ok(filter.$or.some(entry => entry.bookingVersion === 0) &&
        filter.$or.some(entry => entry.bookingVersion?.$exists === false), 'missing bookingVersion remains compatible');
      assert.deepEqual(update.$inc, { bookingVersion: 1 });
    } else {
      assert.equal(filter.bookingVersion, 1);
      assert.deepEqual(update, { $set: { status: 'OCCUPIED' } });
    }
    return { _id: key.unitId, status: 'OCCUPIED' };
  } }));
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(writes, ['unit-token', 'reservation', 'inspection', 'unit-status']);
});

test('CHECK_IN rolls back StorageUnit when Reservation CAS conflicts and leaves Inspection DRAFT', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  const state = { unit: 'RESERVED', bookingVersion: 0, reservation: 'PAID', inspection: 'DRAFT' };
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(StorageUnit, 'findOne', () => ({ exec: async () => ({ _id: key.unitId, facilityId: key.facilityId }) }));
  const session = { withTransaction: async callback => {
    const before = { ...state };
    try { await callback(); } catch (error) { Object.assign(state, before); throw error; }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  let unitWrites = 0;
  t.mock.method(StorageUnit, 'findOneAndUpdate', () => ({ exec: async () => {
    unitWrites++;
    state.bookingVersion++;
    return { _id: key.unitId, bookingVersion: state.bookingVersion };
  } }));
  t.mock.method(Reservation, 'findOneAndUpdate', () => ({ exec: async () => null }));
  t.mock.method(Inspection, 'findOneAndUpdate', () => { throw new Error('inspection must not be written after lost Reservation CAS'); });
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(unitWrites, 1);
  assert.deepEqual(state, { unit: 'RESERVED', bookingVersion: 0, reservation: 'PAID', inspection: 'DRAFT' });
});

test('CHECK_IN rolls back Reservation and StorageUnit when Inspection CAS conflicts', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  const state = { unit: 'RESERVED', bookingVersion: 0, reservation: 'PAID', inspection: 'DRAFT' };
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(StorageUnit, 'findOne', () => ({ exec: async () => ({ _id: key.unitId,
    facilityId: key.facilityId, bookingVersion: 0 }) }));
  const session = { withTransaction: async callback => {
    const before = { ...state };
    try { await callback(); } catch (error) { Object.assign(state, before); throw error; }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(StorageUnit, 'findOneAndUpdate', () => ({ exec: async () => {
    state.bookingVersion++; return { _id: key.unitId, bookingVersion: state.bookingVersion };
  } }));
  t.mock.method(Reservation, 'findOneAndUpdate', () => ({ exec: async () => {
    state.reservation = 'ACTIVE'; return { ...reservation, status: 'ACTIVE' };
  } }));
  t.mock.method(Inspection, 'findOneAndUpdate', () => ({ exec: async () => null }));
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(state, { unit: 'RESERVED', bookingVersion: 0, reservation: 'PAID', inspection: 'DRAFT' });
});

test('CHECK_IN final StorageUnit write failure rolls back Reservation and Inspection transitions', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  const state = { unit: 'RESERVED', bookingVersion: 2, reservation: 'PAID', inspection: 'DRAFT' };
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(StorageUnit, 'findOne', () => ({ exec: async () => ({ _id: key.unitId,
    facilityId: key.facilityId, bookingVersion: 2 }) }));
  const session = { withTransaction: async callback => {
    const before = { ...state };
    try { await callback(); } catch (error) { Object.assign(state, before); throw error; }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  let unitWrites = 0;
  t.mock.method(StorageUnit, 'findOneAndUpdate', () => ({ exec: async () => {
    unitWrites++;
    if (unitWrites === 1) { state.bookingVersion++; return { _id: key.unitId }; }
    return null;
  } }));
  t.mock.method(Reservation, 'findOneAndUpdate', () => ({ exec: async () => {
    state.reservation = 'ACTIVE'; return { ...reservation, status: 'ACTIVE' };
  } }));
  t.mock.method(Inspection, 'findOneAndUpdate', () => ({ exec: async () => {
    state.inspection = 'COMPLETED'; return { ...inspection, status: 'COMPLETED' };
  } }));
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(unitWrites, 2);
  assert.deepEqual(state, { unit: 'RESERVED', bookingVersion: 2, reservation: 'PAID', inspection: 'DRAFT' });
});

test('CHECK_IN unknown commit outcome succeeds only when all durable writes are visible', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(StorageUnit, 'findOne', () => ({ exec: async () => ({ _id: key.unitId, facilityId: key.facilityId }) }));
  const commitError = Object.assign(new Error('commit result unknown'), { errorLabels: ['UnknownTransactionCommitResult'] });
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async () => { throw commitError; }, endSession: async () => {},
  }));
  t.mock.method(StorageUnit, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(Inspection, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(Reservation, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(Inspection, 'findOne', () => ({ exec: async () => ({ _id: key.inspectionId, type: 'CHECK_IN',
    status: 'COMPLETED', reservationId: key.reservationId, facilityId: key.facilityId, storageUnitId: key.unitId }) }));
  t.mock.method(Reservation, 'findOne', () => ({ exec: async () => ({ _id: key.reservationId,
    serviceType: 'SELF_STORAGE', status: 'ACTIVE', facilityId: key.facilityId, storageUnitId: key.unitId }) }));
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('CHECK_IN unknown commit with incomplete durable state returns outcome-unknown', async t => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const { key, inspection, reservation, actor } = checkInFixture();
  t.mock.method(Inspection, 'findById', async () => inspection);
  t.mock.method(Reservation, 'findById', () => ({ exec: async () => reservation }));
  t.mock.method(StorageUnit, 'findOne', () => ({ exec: async () => ({ _id: key.unitId, facilityId: key.facilityId }) }));
  const error = Object.assign(new Error('commit status unknown'), { errorLabels: ['UnknownTransactionCommitResult'] });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async () => { throw error; }, endSession: async () => {} }));
  t.mock.method(StorageUnit, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(Reservation, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(Inspection, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(Inspection, 'findOne', () => ({ exec: async () => null }));
  t.mock.method(Reservation, 'findOne', () => ({ exec: async () => ({ status: 'ACTIVE' }) }));
  const res = response();
  await InspectionController.completeInspection({ params: { id: String(key.inspectionId) }, user: actor }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /outcome is uncertain/i);
});
