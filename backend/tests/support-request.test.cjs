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
const Request = require('../dist/models/support-requests/support-request.model').default;
const Message = require('../dist/models/support-requests/support-message.model').default;
const { AuditService } = require('../dist/services/audit/audit.service');
const { SupportRequestService: service } = require('../dist/services/support-requests/support-request.service');
const { parseCreate, parseMessage, parseStatus, parseUpdate } = require('../dist/services/support-requests/support-request.validation');
const fid = '507f1f77bcf86cd799439011', otherFid = '507f1f77bcf86cd799439012';
const cid = '507f1f77bcf86cd799439013', sid = '507f1f77bcf86cd799439014', rid = '507f1f77bcf86cd799439015';
const customer = { _id: new mongoose.Types.ObjectId(cid), role: 'CUSTOMER' };
const admin = { _id: new mongoose.Types.ObjectId(otherFid), role: 'ADMIN' };
const manager = { _id: new mongoose.Types.ObjectId(otherFid), role: 'FACILITY_MANAGER', assignedFacilityId: new mongoose.Types.ObjectId(fid) };
const staff = { _id: new mongoose.Types.ObjectId(sid), role: 'FACILITY_STAFF', assignedFacilityId: new mongoose.Types.ObjectId(fid) };
const query = value => ({ exec: async () => value });
const chain = value => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return this; }, exec: async () => value });
const base = extra => ({ _id: rid, customerId: cid, facilityId: fid, category: 'ACCESS', subject: 'Gate access', description: 'Access does not work', priority: 'MEDIUM', status: 'OPEN', ...extra });
const doc = extra => Request.hydrate(base(extra));
const saveMock = (t, value) => { t.mock.method(value, 'save', async () => value); return value; };
const auditMock = t => t.mock.method(AuditService, 'logAction', () => {});

test('support schemas define enums, references, lifecycle fields and useful indexes', async () => {
  const request = new Request({ ...base(), customerId: cid }); await request.validate();
  assert.equal(request.status, 'OPEN'); assert.equal(request.priority, 'MEDIUM');
  assert.ok(Request.schema.indexes().some(([keys]) => keys.customerId === 1 && keys.status === 1));
  assert.ok(Request.schema.indexes().some(([keys]) => keys.assignedTo === 1 && keys.status === 1));
  for (const status of ['CANCELLED', 'BAD']) await assert.rejects(new Request({ ...base(), status }).validate());
  assert.ok(Message.schema.path('isInternal'));
  assert.equal(Message.schema.options.timestamps.updatedAt, false);
});

test('customer create derives owner, validates facility and generic stable entity references', async t => {
  const audit = auditMock(t);
  t.mock.method(User, 'findOne', () => query(customer));
  t.mock.method(Facility, 'findOne', () => query({ _id: fid }));
  t.mock.method(Unit, 'findOne', () => query({ _id: otherFid, facilityId: new mongoose.Types.ObjectId(fid) }));
  t.mock.method(Request, 'create', async data => Request.hydrate({ _id: rid, ...data, status: 'OPEN' }));
  const created = await service.create({ facilityId: fid, category: 'ACCESS', subject: 'Need help', description: 'Please help', relatedEntity: { type: 'FACILITY', id: fid } }, customer);
  assert.equal(created.customerId.toString(), cid); assert.equal(audit.mock.callCount(), 1);
  await assert.rejects(service.create({ customerId: otherFid, category: 'OTHER', subject: 'x', description: 'y' }, customer), { status: 400 });
  for (const invalid of [{ category: 'BAD' }, { priority: 'CRITICAL' }, { status: 'CLOSED' }, { $set: {} }]) {
    assert.throws(() => parseCreate({ category: 'OTHER', subject: 'x', description: 'y', ...invalid }), { status: 400 });
  }
  assert.throws(() => parseCreate({ category: 'OTHER', subject: 'x', description: 'y', relatedEntity: { type: 'UNKNOWN', id: 'abc' } }), { status: 400 });
  t.mock.method(Facility, 'findOne', () => query(null));
  await assert.rejects(service.create({ facilityId: fid, category: 'OTHER', subject: 'x', description: 'y' }, customer), { status: 404 });
});

test('customer ownership is enforced and customer list scope cannot be overridden', async t => {
  t.mock.method(Request, 'findOne', () => query(doc({ customerId: otherFid })));
  await assert.rejects(service.get(rid, customer), { status: 404 });
  await assert.rejects(service.list({ customerId: otherFid }, customer), { status: 403 });
  let filter;
  t.mock.method(Request, 'find', f => { filter = f; return chain([]); });
  t.mock.method(Request, 'countDocuments', () => query(0));
  await service.list({}, customer); assert.equal(filter.customerId.toString(), cid); assert.deepEqual(filter.deletedAt, { $exists: false });
});

test('manager and staff read scope cannot be bypassed', async t => {
  t.mock.method(Request, 'findOne', () => query(doc({ facilityId: otherFid })));
  await assert.rejects(service.get(rid, manager), { status: 403 });
  let filter;
  t.mock.method(Request, 'find', f => { filter = f; return chain([]); });
  t.mock.method(Request, 'countDocuments', () => query(0));
  await service.list({}, staff); assert.equal(filter.assignedTo.toString(), sid);
  assert.ok(filter.$and.some(c => c.$or));
  await assert.rejects(service.list({ facilityId: otherFid }, staff), { status: 403 });
});

test('customer PATCH is limited to own OPEN request subject and description', async t => {
  const audit = auditMock(t), ownOpen = saveMock(t, doc());
  t.mock.method(Request, 'findOne', () => query(ownOpen));
  const updated = await service.update(rid, { subject: 'Updated subject', description: 'More detail' }, customer);
  assert.equal(updated.subject, 'Updated subject'); assert.equal(updated.description, 'More detail');
  assert.equal(audit.mock.callCount(), 1);
  for (const body of [{ priority: 'HIGH' }, { category: 'PAYMENT' }, { assignedTo: sid }, { status: 'CLOSED' }, { customerId: otherFid }]) {
    assert.throws(() => parseUpdate(body, false), { status: 400 });
  }
  const assigned = doc({ status: 'ASSIGNED' });
  t.mock.method(Request, 'findOne', () => query(assigned));
  await assert.rejects(service.update(rid, { subject: 'Too late' }, customer), { status: 409 });
  const anotherCustomersRequest = doc({ customerId: otherFid });
  t.mock.method(Request, 'findOne', () => query(anotherCustomersRequest));
  await assert.rejects(service.update(rid, { subject: 'Not yours' }, customer), { status: 404 });
});

test('assignment only accepts active same-facility staff and unassigns ASSIGNED tickets', async t => {
  const audit = auditMock(t), request = saveMock(t, doc());
  t.mock.method(Request, 'findOne', () => query(request));
  let criteria;
  t.mock.method(User, 'findOne', filter => { criteria = filter; return query({ _id: sid }); });
  const assigned = await service.assign(rid, { staffId: sid }, manager);
  assert.equal(assigned.status, 'ASSIGNED'); assert.equal(criteria.role, 'FACILITY_STAFF'); assert.equal(criteria.isActive, true);
  assert.equal(criteria.assignedFacilityId.toString(), fid);
  // An ASSIGNED request may be reassigned after the same validation.
  t.mock.method(User, 'findOne', () => query({ _id: otherFid }));
  assert.equal((await service.assign(rid, { staffId: otherFid }, manager)).status, 'ASSIGNED');
  const unassigned = await service.unassign(rid, manager); assert.equal(unassigned.status, 'OPEN'); assert.equal(unassigned.assignedTo, undefined);
  assert.equal(audit.mock.callCount(), 3);
  t.mock.method(Request, 'findOne', () => query(doc())); t.mock.method(User, 'findOne', () => query(null));
  await assert.rejects(service.assign(rid, { staffId: cid }, admin), { status: 409 });
  await assert.rejects(service.assign(rid, { staffId: sid, status: 'ASSIGNED' }, admin), { status: 400 });
});

test('lifecycle enforces allowed transitions, server timestamps and resolution note', async t => {
  const audit = auditMock(t), request = saveMock(t, doc({ status: 'IN_PROGRESS', assignedTo: sid }));
  t.mock.method(Request, 'findOne', () => query(request));
  await assert.rejects(service.updateStatus(rid, { status: 'RESOLVED' }, staff), { status: 400 });
  const resolved = await service.updateStatus(rid, { status: 'RESOLVED', resolutionNote: 'Reader reset' }, staff);
  assert.equal(resolved.status, 'RESOLVED'); assert.ok(resolved.resolvedAt instanceof Date);
  const closed = await service.updateStatus(rid, { status: 'CLOSED' }, manager);
  assert.ok(closed.closedAt instanceof Date);
  await assert.rejects(service.updateStatus(rid, { status: 'OPEN' }, manager), { status: 409 });
  assert.throws(() => parseStatus({ status: 'RESOLVED', resolvedAt: new Date() }), { status: 400 });
  assert.equal(audit.mock.callCount(), 2);
});

test('internal messages are staff-only and customers receive public messages only', async t => {
  const audit = auditMock(t), request = doc({ assignedTo: sid });
  t.mock.method(Request, 'findOne', () => query(request));
  assert.throws(() => parseMessage({ message: 'secret', isInternal: true }, true), { status: 403 });
  let created;
  t.mock.method(Message, 'create', async data => { created = data; return data; });
  await service.addMessage(rid, { message: 'private', isInternal: true }, staff);
  assert.equal(created.isInternal, true); assert.throws(() => parseMessage({ message: 'x', extra: 1 }, false), { status: 400 });
  t.mock.method(Request, 'findOne', () => query(doc()));
  await service.addMessage(rid, { message: 'public response' }, customer);
  assert.equal(created.isInternal, false); assert.equal(created.authorRole, 'CUSTOMER');
  let filter;
  t.mock.method(Message, 'find', f => { filter = f; return chain([]); });
  t.mock.method(Request, 'findOne', () => query(doc()));
  await service.listMessages(rid, customer); assert.equal(filter.isInternal, false);
  assert.equal(audit.mock.callCount(), 2);
});

test('escalation is manual, scoped, and safely fails without a configured manager', async t => {
  auditMock(t);
  const request = saveMock(t, doc({ status: 'IN_PROGRESS' }));
  t.mock.method(Request, 'findOne', () => query(request));
  t.mock.method(User, 'find', () => ({ limit: () => query([{ _id: otherFid }]) }));
  const result = await service.escalate(rid, manager);
  assert.ok(result.escalatedAt instanceof Date); assert.equal(result.slaDueAt, undefined);
  const noManagerRequest = saveMock(t, doc({ status: 'OPEN' }));
  t.mock.method(Request, 'findOne', () => query(noManagerRequest)); t.mock.method(User, 'find', () => ({ limit: () => query([]) }));
  await assert.rejects(service.escalate(rid, manager), { status: 409 });
  await assert.rejects(service.escalate(rid, customer), { status: 403 });
});

test('only OPEN requests are soft deleted and restore validates facility without physical delete', async t => {
  const audit = auditMock(t), request = saveMock(t, doc());
  const physical = t.mock.method(Request, 'deleteOne', async () => ({}));
  t.mock.method(Request, 'findOne', () => query(request));
  assert.ok((await service.softDelete(rid, manager)).deletedAt instanceof Date);
  t.mock.method(Request, 'findOne', () => query(null));
  await assert.rejects(service.get(rid, admin), { status: 404 });
  t.mock.method(Request, 'findOne', () => query(request));
  const working = doc({ status: 'IN_PROGRESS' }); t.mock.method(Request, 'findOne', () => query(working));
  await assert.rejects(service.softDelete(rid, admin), { status: 409 });
  const deleted = saveMock(t, doc({ deletedAt: new Date() }));
  t.mock.method(Request, 'findOne', () => query(deleted)); t.mock.method(Facility, 'findOne', () => query({ _id: fid }));
  assert.equal((await service.restore(rid, manager)).deletedAt, undefined);
  assert.equal(physical.mock.callCount(), 0); assert.equal(audit.mock.callCount(), 2);
});

test('all support endpoints require authentication', async t => {
  const app = require('../dist/app').default, server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}/api/v1/support-requests`;
  for (const [method, path] of [['GET', ''], ['POST', ''], ['GET', `/${rid}`], ['PATCH', `/${rid}`], ['POST', `/${rid}/assign`], ['POST', `/${rid}/unassign`], ['PATCH', `/${rid}/status`], ['POST', `/${rid}/messages`], ['GET', `/${rid}/messages`], ['POST', `/${rid}/escalate`], ['DELETE', `/${rid}`], ['POST', `/${rid}/restore`]]) {
    assert.equal((await fetch(root + path, { method })).status, 401, `${method} ${path}`);
  }
});
