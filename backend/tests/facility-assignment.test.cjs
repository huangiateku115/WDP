const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:27017/wdp',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const User = require('../dist/models/users/user.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const { AuditLogModel } = require('../dist/models/audit/audit.model');
const { FacilityAssignmentService: service } = require('../dist/services/users/facility-assignment.service');
const { UserService } = require('../dist/services/users/user.service');
const routes = require('../dist/routes/user.routes').default;

const oid = value => new mongoose.Types.ObjectId(value);
const adminId = '507f1f77bcf86cd799439001';
const managerId = '507f1f77bcf86cd799439002';
const targetId = '507f1f77bcf86cd799439003';
const facilityA = '507f1f77bcf86cd799439011';
const facilityB = '507f1f77bcf86cd799439012';
const query = value => ({ session() { return this; }, exec: async () => typeof value === 'function' ? value() : value });

function setup(t, { actorRole = 'ADMIN', actorFacility = null, targetRole = 'FACILITY_STAFF', targetFacility = null,
  targetActive = true, facilityExists = true, beforeUpdate, updateResult } = {}) {
  const actor = { _id: oid(actorRole === 'ADMIN' ? adminId : managerId), role: actorRole, assignedFacilityId: actorFacility ? oid(actorFacility) : null, isActive: true };
  const target = { _id: oid(targetId), role: targetRole, assignedFacilityId: targetFacility ? oid(targetFacility) : null, isActive: targetActive };
  const audits = [];
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(User, 'findById', id => query(id.toString() === actor._id.toString() ? actor : target._id.toString() === id.toString() ? target : null));
  t.mock.method(Facility, 'findOne', filter => query(facilityExists && filter.deletedAt?.$exists === false ? { _id: filter._id } : null));
  t.mock.method(User, 'findOneAndUpdate', (filter, update, options) => query(async () => {
    assert.ok(options.session);
    if (beforeUpdate) return beforeUpdate({ filter, update, target, actor });
    if (updateResult === null) return null;
    if (filter.role !== target.role || !filter.isActive) return null;
    if (filter.assignedFacilityId && !target.assignedFacilityId?.equals(filter.assignedFacilityId)) return null;
    if (filter.$or && !filter.$or.some(entry => entry.assignedFacilityId === null || entry.assignedFacilityId?.equals(target.assignedFacilityId))) return null;
    target.assignedFacilityId = update.$set.assignedFacilityId;
    return target;
  }));
  t.mock.method(AuditLogModel.prototype, 'save', async function (options) { assert.ok(options.session); audits.push(this); return this; });
  return { actor, target, audits };
}

test('ADMIN assigns, reassigns, and unassigns Manager and Staff with safe DTO and audited before/after values', async t => {
  const state = setup(t, { targetRole: 'FACILITY_MANAGER' });
  const assigned = await service.assign(targetId, { facilityId: facilityA }, state.actor);
  assert.deepEqual(assigned, { _id: targetId, role: 'FACILITY_MANAGER', assignedFacilityId: facilityA });
  assert.equal(state.audits[0].action, 'FACILITY_ASSIGNED');
  assert.equal(state.audits[0].actorId.toString(), adminId);
  assert.equal(state.audits[0].entityId.toString(), targetId);
  assert.equal(state.audits[0].before.previousFacilityId, null);
  assert.equal(state.audits[0].after.newFacilityId.toString(), facilityA);
  const reassigned = await service.assign(targetId, { facilityId: facilityB }, state.actor);
  assert.equal(reassigned.assignedFacilityId, facilityB);
  assert.equal(state.audits[1].action, 'FACILITY_REASSIGNED');
  assert.equal(state.audits[1].before.previousFacilityId.toString(), facilityA);
  await service.unassign(targetId, state.actor);
  assert.equal(state.target.assignedFacilityId, null);
  assert.equal(state.audits[2].action, 'FACILITY_UNASSIGNED');

  state.target.role = 'FACILITY_STAFF';
  assert.equal((await service.assign(targetId, { facilityId: facilityA }, state.actor)).role, 'FACILITY_STAFF');
});

test('Manager assigns unassigned Staff only to own Facility; repeat assignment is idempotent', async t => {
  const state = setup(t, { actorRole: 'FACILITY_MANAGER', actorFacility: facilityA });
  await service.assign(targetId, { facilityId: facilityA }, state.actor);
  assert.equal(state.audits.length, 1);
  await service.assign(targetId, { facilityId: facilityA }, state.actor);
  assert.equal(state.audits.length, 1);
  assert.equal(state.target.assignedFacilityId.toString(), facilityA);
});

test('Manager cannot choose another Facility, transfer Staff from it, manage another Manager, or operate without own Facility', async t => {
  let state = setup(t, { actorRole: 'FACILITY_MANAGER', actorFacility: facilityA });
  await assert.rejects(service.assign(targetId, { facilityId: facilityB }, state.actor), { status: 403 });
  state = setup(t, { actorRole: 'FACILITY_MANAGER', actorFacility: facilityA, targetFacility: facilityB });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 403 });
  await assert.rejects(service.unassign(targetId, state.actor), { status: 403 });
  state = setup(t, { actorRole: 'FACILITY_MANAGER', actorFacility: facilityA, targetRole: 'FACILITY_MANAGER' });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 403 });
  await assert.rejects(service.unassign(targetId, state.actor), { status: 403 });
  state = setup(t, { actorRole: 'FACILITY_MANAGER' });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 403 });
});

test('Manager may unassign Staff in own Facility only', async t => {
  const state = setup(t, { actorRole: 'FACILITY_MANAGER', actorFacility: facilityA, targetFacility: facilityA });
  const result = await service.unassign(targetId, state.actor);
  assert.equal(result.assignedFacilityId, null);
  assert.equal(state.audits[0].action, 'FACILITY_UNASSIGNED');
});

test('Staff, BOM, Customer and missing actors cannot manage assignments', async t => {
  for (const role of ['FACILITY_STAFF', 'BOM', 'CUSTOMER']) {
    const state = setup(t, { actorRole: role });
    await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 403 });
    await assert.rejects(service.unassign(targetId, state.actor), { status: 403 });
  }
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, undefined), { status: 401 });
});

test('rejects invalid IDs and request fields before writing', async t => {
  const state = setup(t);
  await assert.rejects(service.assign('bad', { facilityId: facilityA }, state.actor), { status: 400 });
  await assert.rejects(service.assign(targetId, { facilityId: 'bad' }, state.actor), { status: 400 });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA, assignedFacilityId: facilityB }, state.actor), { status: 400 });
  assert.equal(state.audits.length, 0);
});

test('rejects missing or soft-deleted Facility and missing target', async t => {
  let state = setup(t, { facilityExists: false });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 404 });
  state = setup(t);
  await assert.rejects(service.assign('507f1f77bcf86cd799439099', { facilityId: facilityA }, state.actor), { status: 404 });
});

test('only active Manager/Staff users may be assigned', async t => {
  let state = setup(t, { targetRole: 'CUSTOMER' });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 403 });
  state = setup(t, { targetRole: 'BOM' });
  await assert.rejects(service.unassign(targetId, state.actor), { status: 403 });
  state = setup(t, { targetActive: false });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 409 });
  state.target.assignedFacilityId = oid(facilityA);
  assert.equal((await service.unassign(targetId, state.actor)).assignedFacilityId, null);
});

test('conditional atomic write blocks Manager overwriting a concurrent Admin transfer', async t => {
  const state = setup(t, {
    actorRole: 'FACILITY_MANAGER', actorFacility: facilityA,
    beforeUpdate: ({ filter, target }) => {
      assert.ok(filter.$or, 'Manager write includes assignment-scope condition');
      target.assignedFacilityId = oid(facilityB);
      return null;
    },
  });
  await assert.rejects(service.assign(targetId, { facilityId: facilityA }, state.actor), { status: 403 });
  assert.equal(state.target.assignedFacilityId.toString(), facilityB);
  assert.equal(state.audits.length, 0);
});

test('role changes clear Facility assignment for non-Manager/Staff roles', async t => {
  const existing = { _id: oid(targetId), role: 'FACILITY_STAFF', assignedFacilityId: oid(facilityA) };
  t.mock.method(User, 'findById', () => query(existing));
  t.mock.method(User, 'findByIdAndUpdate', (id, update, options) => {
    assert.equal(id, targetId);
    assert.equal(update.$set.role, 'CUSTOMER');
    assert.equal(update.$set.assignedFacilityId, null);
    assert.deepEqual(options, { new: true, runValidators: true });
    return query({ ...existing, role: 'CUSTOMER', assignedFacilityId: null });
  });
  const result = await UserService.adminUpdateRole(targetId, 'CUSTOMER');
  assert.equal(result.assignedFacilityId, null);
});

test('assignment endpoints are mounted before Admin-only user routes', () => {
  const patch = routes.stack.find(layer => layer.route?.path === '/:userId/facility-assignment' && layer.route.methods.patch);
  const remove = routes.stack.find(layer => layer.route?.path === '/:userId/facility-assignment' && layer.route.methods.delete);
  const adminCreate = routes.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post);
  assert.ok(patch);
  assert.ok(remove);
  assert.ok(adminCreate);
  assert.ok(routes.stack.indexOf(patch) < routes.stack.indexOf(adminCreate));
  assert.ok(routes.stack.indexOf(remove) < routes.stack.indexOf(adminCreate));
});
