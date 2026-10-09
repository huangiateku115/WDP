const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'production', MONGO_URL: 'mongodb+srv://cluster.example.invalid/wdp',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const Facility = require('../dist/models/facilities/facility.model').default;
const Unit = require('../dist/models/storage-units/storage-unit.model').default;
const User = require('../dist/models/users/user.model').default;
const Ticket = require('../dist/models/maintenance-tickets/maintenance-ticket.model').default;
const AuditService = require('../dist/services/audit/audit.service').AuditService;
const AuditLog = require('../dist/models/audit/audit.model').AuditLogModel;
const { MaintenanceTicketService: service } = require('../dist/services/maintenance-tickets/maintenance-ticket.service');
const { parseCreate, parseList, parseStatus } = require('../dist/services/maintenance-tickets/maintenance-ticket.validation');
const facilityId = '507f1f77bcf86cd799439011';
const otherFacilityId = '507f1f77bcf86cd799439012';
const unitId = '507f1f77bcf86cd799439013';
const ticketId = '507f1f77bcf86cd799439014';
const staffId = '507f1f77bcf86cd799439015';
const otherStaffId = '507f1f77bcf86cd799439016';
const admin = { _id: new mongoose.Types.ObjectId(facilityId), role: 'ADMIN' };
const manager = { _id: new mongoose.Types.ObjectId(otherFacilityId), role: 'FACILITY_MANAGER', assignedFacilityId: new mongoose.Types.ObjectId(facilityId) };
const staff = { _id: new mongoose.Types.ObjectId(staffId), role: 'FACILITY_STAFF', assignedFacilityId: new mongoose.Types.ObjectId(facilityId) };
const otherStaff = { _id: new mongoose.Types.ObjectId(otherStaffId), role: 'FACILITY_STAFF', assignedFacilityId: new mongoose.Types.ObjectId(facilityId) };
const customer = { _id: new mongoose.Types.ObjectId(otherFacilityId), role: 'CUSTOMER' };
AuditLog.create = async () => ({});
const query = value => ({ exec: async () => value });
const chained = value => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return this; }, exec: async () => value });
const body = (extra = {}) => ({ facilityId, title: 'Door issue', description: 'The entry door sticks', category: 'ACCESS', ...extra });
function ticket(extra = {}) {
  return Ticket.hydrate({
    _id: ticketId, facilityId, title: 'Door issue', description: 'The entry door sticks',
    category: 'ACCESS', priority: 'MEDIUM', status: 'OPEN', reportedBy: admin._id,
    ...extra,
  });
}
function mockSave(t, doc) { t.mock.method(doc, 'save', async () => doc); return doc; }
function mockAudit(t) { return t.mock.method(AuditService, 'logAction', () => {}); }

test('schema declares ticket lifecycle, references, indexes and no physical delete', async () => {
  const doc = new Ticket({ ...body(), reportedBy: admin._id });
  await doc.validate();
  assert.equal(doc.status, 'OPEN');
  assert.equal(doc.priority, 'MEDIUM');
  const indexes = Ticket.schema.indexes();
  assert.ok(indexes.some(([keys]) => keys.facilityId === 1 && keys.status === 1));
  assert.ok(indexes.some(([keys]) => keys.facilityId === 1 && keys.assignedTo === 1));
  for (const status of ['BAD', 'DELETED']) await assert.rejects(new Ticket({ ...doc.toObject(), status }).validate());
});

test('create facility-only or unit-linked ticket, derives reporter, validates parents and rejects unsafe fields', async t => {
  const audit = mockAudit(t);
  t.mock.method(Facility, 'findOne', () => query({ _id: facilityId }));
  let unitFilter;
  t.mock.method(Unit, 'findOne', filter => {
    unitFilter = filter;
    assert.deepEqual(filter.deletedAt, { $exists: false });
    return query(unitRecord);
  });
  const unitRecord = { facilityId: new mongoose.Types.ObjectId(facilityId), status: 'OCCUPIED' };
  t.mock.method(Ticket, 'create', async data => Ticket.hydrate({ _id: ticketId, ...data, status: 'OPEN' }));
  const created = await service.create(body(), manager);
  assert.equal(created.reportedBy.toString(), manager._id.toString());
  const linked = await service.create(body({ storageUnitId: unitId }), manager);
  assert.equal(linked.storageUnitId.toString(), unitId);
  assert.equal(unitRecord.status, 'OCCUPIED', 'maintenance does not mutate StorageUnit lifecycle');
  assert.equal(unitFilter.deletedAt.$exists, false);
  assert.equal(audit.mock.callCount(), 2);
  assert.equal(audit.mock.calls[0].arguments[0].entityType, 'MaintenanceTicket');
  for (const invalid of [body({ reportedBy: staffId }), body({ status: 'CLOSED' }), body({ $set: { title: 'x' } }), body({ category: 'WRONG' }), body({ priority: 'CRITICAL' })]) {
    await assert.rejects(service.create(invalid, manager), { status: 400 });
  }
  t.mock.method(Unit, 'findOne', () => query({ facilityId: new mongoose.Types.ObjectId(otherFacilityId) }));
  await assert.rejects(service.create(body({ storageUnitId: unitId }), admin), { status: 409 });
  t.mock.method(Unit, 'findOne', () => query(null));
  await assert.rejects(service.create(body({ storageUnitId: unitId }), admin), { status: 404 });
  t.mock.method(Facility, 'findOne', () => query(null));
  await assert.rejects(service.create(body(), admin), { status: 404 });
});

test('assignment requires active same-facility FACILITY_STAFF and supports unassign', async t => {
  const audit = mockAudit(t);
  const doc = mockSave(t, ticket());
  t.mock.method(Ticket, 'findOne', () => query(doc));
  let userFilter;
  t.mock.method(User, 'findOne', filter => { userFilter = filter; return query({ _id: staffId }); });
  const assigned = await service.assign(ticketId, { assignedTo: staffId }, manager);
  assert.equal(assigned.status, 'ASSIGNED');
  assert.equal(assigned.assignedTo.toString(), staffId);
  assert.ok(userFilter.isActive);
  assert.equal(userFilter.role, 'FACILITY_STAFF');
  assert.equal(userFilter.assignedFacilityId.toString(), facilityId);
  const reopened = await service.unassign(ticketId, manager);
  assert.equal(reopened.status, 'OPEN');
  assert.equal(reopened.assignedTo, undefined);
  assert.equal(audit.mock.callCount(), 2);
  for (const invalid of ['CUSTOMER', 'inactive', 'wrong-facility']) {
    t.mock.method(Ticket, 'findOne', () => query(ticket()));
    t.mock.method(User, 'findOne', () => query(invalid === 'inactive' ? null : null));
    await assert.rejects(service.assign(ticketId, { assignedTo: staffId }, admin), { status: 409 });
  }
  await assert.rejects(service.assign(ticketId, { assignedTo: staffId, status: 'ASSIGNED' }, admin), { status: 400 });
});

test('state machine requires assignment/resolution note and stamps lifecycle dates server-side', async t => {
  const audit = mockAudit(t);
  const doc = mockSave(t, ticket());
  t.mock.method(Ticket, 'findOne', () => query(doc));
  t.mock.method(User, 'findOne', () => query({ _id: staffId }));
  await service.assign(ticketId, { assignedTo: staffId }, manager);
  assert.equal((await service.updateStatus(ticketId, { status: 'IN_PROGRESS' }, staff)).status, 'IN_PROGRESS');
  await assert.rejects(service.updateStatus(ticketId, { status: 'RESOLVED' }, staff), { status: 400 });
  assert.equal(doc.status, 'IN_PROGRESS', 'invalid resolution must leave status unchanged');
  const resolved = await service.updateStatus(ticketId, { status: 'RESOLVED', resolutionNote: 'Door latch replaced' }, staff);
  assert.ok(resolved.resolvedAt instanceof Date);
  assert.equal(resolved.resolutionNote, 'Door latch replaced');
  const closed = await service.updateStatus(ticketId, { status: 'CLOSED' }, manager);
  assert.ok(closed.closedAt instanceof Date);
  await assert.rejects(service.updateStatus(ticketId, { status: 'IN_PROGRESS' }, manager), { status: 409 });
  assert.equal(audit.mock.callCount(), 4);

  const open = mockSave(t, ticket());
  t.mock.method(Ticket, 'findOne', () => query(open));
  await assert.rejects(service.updateStatus(ticketId, { status: 'CLOSED' }, admin), { status: 409 });
  await assert.rejects(service.updateStatus(ticketId, { status: 'OPEN', resolvedAt: new Date() }, admin), { status: 400 });
  assert.throws(() => parseStatus({ status: 'RESOLVED', resolvedAt: new Date() }), { status: 400 });
});

test('staff only progress their own ticket and managers are facility-scoped', async t => {
  const assigned = mockSave(t, ticket({ status: 'ASSIGNED', assignedTo: staff._id }));
  t.mock.method(Ticket, 'findOne', () => query(assigned));
  assert.equal((await service.updateStatus(ticketId, { status: 'IN_PROGRESS' }, staff)).status, 'IN_PROGRESS');
  const otherAssigned = ticket({ status: 'ASSIGNED', assignedTo: otherStaff._id });
  t.mock.method(Ticket, 'findOne', () => query(otherAssigned));
  await assert.rejects(service.updateStatus(ticketId, { status: 'IN_PROGRESS' }, staff), { status: 403 });
  const outOfScopeManager = { ...manager, assignedFacilityId: new mongoose.Types.ObjectId(otherFacilityId) };
  await assert.rejects(service.update(ticketId, { priority: 'HIGH' }, outOfScopeManager), { status: 403 });
  await assert.rejects(service.get(ticketId, customer), { status: 403 });
  await assert.rejects(service.updateStatus(ticketId, { status: 'IN_PROGRESS' }, customer), { status: 403 });
  await assert.rejects(service.update(ticketId, { priority: 'HIGH' }, customer), { status: 403 });
  await assert.rejects(service.assign(ticketId, { assignedTo: staffId }, customer), { status: 403 });
  await assert.rejects(service.softDelete(ticketId, customer), { status: 403 });
});

test('list pagination, filters, literal search and actor scope cannot be bypassed', async t => {
  let seen;
  t.mock.method(Ticket, 'find', filter => { seen = filter; return chained([]); });
  t.mock.method(Ticket, 'countDocuments', filter => { assert.deepEqual(filter, seen); return query(0); });
  await service.list({ page: '2', limit: '5', facilityId, status: 'OPEN', priority: 'HIGH', category: 'ACCESS', assignedTo: staffId, search: 'door.*' }, admin);
  assert.equal(seen.facilityId, facilityId);
  assert.equal(seen.status, 'OPEN'); assert.equal(seen.priority, 'HIGH'); assert.equal(seen.category, 'ACCESS');
  assert.equal(seen.assignedTo, staffId); assert.deepEqual(seen.deletedAt, { $exists: false });
  const regex = new RegExp(seen.$or[0].title.$regex, 'i');
  assert.equal(regex.test('door.*'), true); assert.equal(regex.test('door abc'), false);
  t.mock.method(Ticket, 'find', filter => { seen = filter; return chained([]); });
  t.mock.method(Ticket, 'countDocuments', () => query(0));
  await assert.rejects(service.list({ facilityId: otherFacilityId }, manager), { status: 403 });
  await assert.rejects(service.list({ facilityId: otherFacilityId }, staff), { status: 403 });
  await assert.rejects(service.list({ assignedTo: otherStaffId }, staff), { status: 403 });
  for (const invalid of [{ page: '0' }, { limit: '101' }, { status: 'BAD' }, { priority: 'CRITICAL' }, { category: 'BAD' }, { $where: 'true' }]) {
    assert.throws(() => parseList(invalid), { status: 400 });
  }
});

test('soft delete only OPEN, hides deleted tickets, restores under live Facility, and never physically deletes', async t => {
  const audit = mockAudit(t);
  const physicalDelete = t.mock.method(Ticket, 'deleteOne', async () => ({}));
  const physicalDeleteMany = t.mock.method(Ticket, 'deleteMany', async () => ({}));
  const doc = mockSave(t, ticket());
  t.mock.method(Ticket, 'findOne', () => query(doc));
  const removed = await service.softDelete(ticketId, manager);
  assert.ok(removed.deletedAt instanceof Date);
  t.mock.method(Ticket, 'findOne', filter => query(filter.deletedAt?.$exists === true ? doc : null));
  await assert.rejects(service.get(ticketId, admin), { status: 404 });
  for (const status of ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
    t.mock.method(Ticket, 'findOne', () => query(ticket({ status })));
    await assert.rejects(service.softDelete(ticketId, admin), { status: 409 });
  }
  const deleted = mockSave(t, ticket({ deletedAt: new Date(), deletedBy: admin._id }));
  t.mock.method(Ticket, 'findOne', () => query(deleted));
  t.mock.method(Facility, 'findOne', () => query({ _id: facilityId }));
  assert.equal((await service.restore(ticketId, manager)).deletedAt, undefined);
  const orphan = ticket({ deletedAt: new Date() });
  t.mock.method(Ticket, 'findOne', () => query(orphan));
  t.mock.method(Facility, 'findOne', () => query(null));
  await assert.rejects(service.restore(ticketId, manager), { status: 404 });
  assert.equal(audit.mock.callCount(), 2);
  assert.equal(physicalDelete.mock.callCount(), 0);
  assert.equal(physicalDeleteMany.mock.callCount(), 0);
});

test('all maintenance endpoints require authentication', async t => {
  const app = require('../dist/app').default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/maintenance-tickets`;
  for (const [method, path] of [['GET', ''], ['GET', `/${ticketId}`], ['POST', ''], ['PATCH', `/${ticketId}`], ['POST', `/${ticketId}/assign`], ['POST', `/${ticketId}/unassign`], ['PATCH', `/${ticketId}/status`], ['DELETE', `/${ticketId}`], ['POST', `/${ticketId}/restore`]]) {
    assert.equal((await fetch(base + path, { method })).status, 401);
  }
});
