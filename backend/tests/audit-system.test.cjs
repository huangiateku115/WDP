const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { AuditService } = require('../dist/services/audit/audit.service');
const { AuditReadError, parseAuditLogQuery, parseAuditSubjectQuery } = require('../dist/services/audit/audit-read.validation');
const { AuditLogModel } = require('../dist/models/audit/audit.model');
const { LoginHistoryModel } = require('../dist/models/audit/loginHistory.model');
const UserModel = require('../dist/models/users/user.model').default;
const AuditController = require('../dist/controllers/audit/audit.controller');
const auditRouter = require('../dist/routes/audit.routes').default;

const oid = n => new Types.ObjectId(String(n).padStart(24, '0'));
class Query {
  constructor(rows = []) { this.rows = rows; this.calls = {}; }
  select(value) { this.calls.select = value; return this; }
  populate(...args) { this.calls.populate = args; return this; }
  sort(value) { this.calls.sort = value; return this; }
  skip(value) { this.calls.skip = value; return this; }
  limit(value) { this.calls.limit = value; return this; }
  lean() { this.calls.lean = true; return this; }
  async exec() { return this.rows; }
}
function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test('AuditLog filters use actual source fields and inclusive Vietnam date-only end day', () => {
  const actorId = oid(1), facilityId = oid(2);
  const query = parseAuditLogQuery({ action: 'UPDATE_PROFILE', entityType: 'User', actorId: String(actorId), facilityId: String(facilityId),
    from: '2026-11-01', to: '2026-11-18', page: '2', limit: '10', sortOrder: 'asc' });
  assert.equal(query.filter.action, 'UPDATE_PROFILE');
  assert.equal(String(query.filter.actorId), String(actorId));
  assert.equal(String(query.filter.facilityId), String(facilityId));
  assert.equal(query.filter.createdAt.$gte.toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(query.filter.createdAt.$lt.toISOString(), '2026-11-18T17:00:00.000Z');
  assert.deepEqual({ page: query.page, limit: query.limit, sortOrder: query.sortOrder }, { page: 2, limit: 10, sortOrder: 'asc' });
});

test('unsupported or injected AuditLog query filters, arrays, invalid dates and oversized pagination fail closed', () => {
  for (const query of [
    { eventType: 'LOGIN' }, { subjectId: String(oid(3)) }, { action: 'NOT_REAL' }, { page: ['1', '2'] },
    { action: { $ne: 'DELETE' } }, { actorId: { $gt: '' } }, { from: '2026-02-30' },
    { from: '2025-01-01', to: '2026-12-31' }, { limit: '101' }, { sortOrder: 'sideways' }, { unexpected: 'x' },
  ]) assert.throws(() => parseAuditLogQuery(query), AuditReadError);
});

test('Admin global AuditLog search uses database filters, exact total, bounded stable pagination and summary DTO', async t => {
  const actorId = oid(4), facilityId = oid(5); let filter, query;
  const row = { _id: oid(6), actorId, actorRole: 'CUSTOMER', action: 'UPDATE_PROFILE', entityType: 'User', entityId: oid(7),
    facilityId, createdAt: new Date(), before: { password: 'must-not-return' } };
  t.mock.method(AuditLogModel, 'find', value => { filter = value; query = new Query([row]); return query; });
  t.mock.method(AuditLogModel, 'countDocuments', value => { assert.equal(value, filter); return { exec: async () => 23 }; });
  const result = await AuditService.listLogs({ action: 'UPDATE_PROFILE', actorId: String(actorId), facilityId: String(facilityId), page: '2', limit: '10' }, { role: 'ADMIN' });
  assert.equal(String(filter.actorId), String(actorId)); assert.equal(String(filter.facilityId), String(facilityId));
  assert.deepEqual(query.calls.sort, { createdAt: -1, _id: -1 }); assert.equal(query.calls.skip, 10); assert.equal(query.calls.limit, 10);
  assert.equal(result.pagination.total, 23); assert.equal(result.pagination.totalPages, 3);
  assert.equal(result.items[0].action, 'UPDATE_PROFILE'); assert.equal(Object.hasOwn(result.items[0], 'before'), false);
  assert.equal(Object.hasOwn(result.items[0], 'actor'), false);
});

test('BOM global search joins current actor role and excludes ADMIN/BOM even when old log actorRole differs', async t => {
  const aggregateResult = [{ items: [{ _id: oid(8), actorId: oid(9), actorRole: 'CUSTOMER', action: 'REGISTER', entityType: 'User', entityId: oid(10), createdAt: new Date() }], total: [{ value: 1 }] }];
  let pipeline;
  t.mock.method(AuditLogModel, 'aggregate', value => { pipeline = value; return { exec: async () => aggregateResult }; });
  const result = await AuditService.listLogs({ facilityId: String(oid(11)) }, { role: 'BOM' });
  assert.equal(pipeline[0].$match.facilityId.toString(), String(oid(11)));
  assert.equal(pipeline[1].$lookup.from, UserModel.collection.name);
  assert.deepEqual(pipeline[2].$match._currentActor.$elemMatch.role.$nin, ['ADMIN', 'BOM']);
  assert.deepEqual(pipeline[3].$facet.items[0].$sort, { createdAt: -1, _id: -1 });
  assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
});

test('BOM cannot target a current ADMIN/BOM actor through actorId filter', async t => {
  t.mock.method(UserModel, 'findById', () => ({ select() { return this; }, lean() { return this; }, exec: async () => ({ role: 'ADMIN' }) }));
  await assert.rejects(AuditService.listLogs({ actorId: String(oid(12)) }, { role: 'BOM' }), error => error.status === 403 && error.code === 'AUDIT_SUBJECT_FORBIDDEN');
});

test('Audit global service denies customer/staff and unauthenticated callers', async () => {
  await assert.rejects(AuditService.listLogs({}, undefined), error => error.status === 401);
  for (const role of ['CUSTOMER', 'FACILITY_STAFF', 'FACILITY_MANAGER']) {
    await assert.rejects(AuditService.listLogs({}, { role }), error => error.status === 403);
  }
});

test('Subject directory enforces BOM role denylist, literal search, safe selection, Facility and pagination', async t => {
  const facility = { _id: oid(13), name: 'Facility A', code: 'FA' };
  const row = { _id: oid(14), displayName: 'Lan', email: 'lan@example.test', role: 'CUSTOMER', assignedFacilityId: facility, isActive: true,
    phone: 'must-not-return', keycloakSub: 'must-not-return' };
  let filter, query;
  t.mock.method(UserModel, 'find', value => { filter = value; query = new Query([row]); return query; });
  t.mock.method(UserModel, 'countDocuments', value => { assert.equal(value, filter); return { exec: async () => 1 }; });
  const result = await AuditService.listSubjects({ search: 'lan.*', facilityId: String(facility._id), status: 'ACTIVE', page: '1', limit: '5' }, { role: 'BOM' });
  assert.deepEqual(filter.role, { $nin: ['ADMIN', 'BOM'] });
  assert.equal(String(filter.assignedFacilityId), String(facility._id)); assert.equal(filter.isActive, true);
  assert.equal(filter.$or[0].displayName.source, 'lan\\.\\*');
  assert.deepEqual(query.calls.sort, { displayName: 1, _id: 1 }); assert.equal(query.calls.limit, 5);
  assert.deepEqual(result.items[0].assignedFacility, facility); assert.equal(Object.hasOwn(result.items[0], 'phone'), false);
  assert.equal(Object.hasOwn(result.items[0], 'keycloakSub'), false);
});

test('Admin subject directory may query all roles; BOM cannot request peer or Admin roles', async () => {
  const adminQuery = parseAuditSubjectQuery({ role: 'ADMIN' }, 'ADMIN');
  assert.equal(adminQuery.filter.role, 'ADMIN');
  for (const role of ['ADMIN', 'BOM']) assert.throws(() => parseAuditSubjectQuery({ role }, 'BOM'), error => error.status === 403);
});

test('subject search and query structures are bounded and reject Mongo operators/arrays', () => {
  for (const query of [{ search: { $regex: '.*' } }, { search: ['x', 'y'] }, { role: 'NO_ROLE' }, { facilityId: 'abc' },
    { status: 'DELETED' }, { limit: '1000' }, { extra: 'field' }]) {
    assert.throws(() => parseAuditSubjectQuery(query, 'ADMIN'), AuditReadError);
  }
});

test('legacy audit detail DTO allowlists approved fields and redacts sensitive or unknown data in objects, arrays and before/after values', () => {
  const dto = AuditService.auditDetailDto({ _id: oid(15), actorId: oid(16), action: 'UPDATE_PROFILE', entityType: 'User', entityId: oid(17),
    createdAt: new Date(), before: { displayName: 'A', email: 'a@example.test', accessToken: 'abc', nested: { passwordHash: 'x', status: 'ACTIVE', city: 'HCMC' },
      signedProofUrl: 'secret', arbitraryNewField: 'unexpected', related: [{ name: 'Unit A', phone: '0900' }] },
    after: { refresh_token: 'x', status: 'ACTIVE', otpCode: '123456' }, reason: 'free text omitted',
    actor: { email: 'private@example.test', displayName: 'not-a-whitelisted-top-level-field' } });
  assert.equal(dto.before.displayName, 'A'); assert.equal(dto.before.nested.status, 'ACTIVE');
  assert.equal(Object.hasOwn(dto.before.nested, 'city'), false);
  assert.deepEqual(dto.before.related, [{ name: 'Unit A' }]);
  assert.equal(Object.hasOwn(dto.before, 'email'), false);
  assert.equal(Object.hasOwn(dto.before, 'accessToken'), false); assert.equal(Object.hasOwn(dto.before, 'signedProofUrl'), false);
  assert.equal(Object.hasOwn(dto.before.nested, 'passwordHash'), false); assert.equal(Object.hasOwn(dto.before, 'arbitraryNewField'), false);
  assert.equal(Object.hasOwn(dto.after, 'refresh_token'), false); assert.equal(Object.hasOwn(dto.after, 'otpCode'), false);
  assert.equal(Object.hasOwn(dto, 'reason'), false); assert.equal(Object.hasOwn(dto, 'actor'), false);
  assert.equal(AuditService.auditDetailDto({ before: 'unreviewed scalar payload' }).before, '[REDACTED:UNREVIEWED_VALUE]');
  assert.equal(AuditService.auditDetailDto({}).before, null);
});

test('Audit Subjects preserve the policy-approved email field while limiting the DTO to approved identifiers', async t => {
  const row = { _id: oid(24), displayName: 'Lan', email: 'lan@example.test', role: 'CUSTOMER', assignedFacilityId: null, isActive: true,
    phone: 'private', keycloakSub: 'private', passwordHash: 'private' };
  t.mock.method(UserModel, 'find', () => new Query([row]));
  t.mock.method(UserModel, 'countDocuments', () => ({ exec: async () => 1 }));
  const result = await AuditService.listSubjects({}, { role: 'ADMIN' });
  assert.equal(result.items[0].email, row.email);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['_id', 'assignedFacility', 'displayName', 'email', 'isActive', 'role'].sort());
});

test('legacy Admin and BOM AuditLog reads preserve envelope and scope, sanitize details, and do not write', async t => {
  const row = { _id: oid(25), actorId: oid(26), actorRole: 'CUSTOMER', action: 'UPDATE_PROFILE', entityType: 'User', entityId: oid(27),
    createdAt: new Date(), before: { displayName: 'Lan', email: 'private@example.test' }, after: { status: 'ACTIVE' } };
  let query, createCalls = 0;
  t.mock.method(AuditLogModel, 'find', filter => { query = filter; return { sort: () => Promise.resolve([row]) }; });
  t.mock.method(AuditLogModel, 'create', () => { createCalls++; });
  t.mock.method(UserModel, 'findById', () => Promise.resolve({ role: 'CUSTOMER' }));
  const adminResponse = response();
  await AuditController.adminGetAuditLogs({ params: { userId: String(row.actorId) } }, adminResponse);
  assert.deepEqual(query, { actorId: String(row.actorId) });
  assert.equal(adminResponse.body.success, true); assert.equal(adminResponse.body.data[0].before.displayName, 'Lan');
  assert.equal(Object.hasOwn(adminResponse.body.data[0].before, 'email'), false);
  assert.equal(Object.hasOwn(adminResponse.body.data[0], 'reason'), false);
  const bomResponse = response();
  await AuditController.bomGetAuditLogs({ params: { userId: String(row.actorId) } }, bomResponse);
  assert.equal(bomResponse.statusCode, 200); assert.equal(bomResponse.body.success, true);
  assert.equal(createCalls, 0);
});

test('legacy LoginHistory endpoints remain direct reads with their existing envelope and no write', async t => {
  const history = [{ eventType: 'LOGIN', attemptedEmail: 'lan@example.test', status: 'SUCCESS' }];
  let createCalls = 0;
  t.mock.method(LoginHistoryModel, 'find', () => ({ sort: () => Promise.resolve(history) }));
  t.mock.method(LoginHistoryModel, 'create', () => { createCalls++; });
  t.mock.method(UserModel, 'findById', () => Promise.resolve({ role: 'CUSTOMER' }));
  const adminResponse = response();
  await AuditController.adminGetLoginHistory({ params: { userId: String(oid(28)) } }, adminResponse);
  assert.deepEqual(adminResponse.body, { success: true, data: history });
  const bomResponse = response();
  await AuditController.bomGetLoginHistory({ params: { userId: String(oid(28)) } }, bomResponse);
  assert.deepEqual(bomResponse.body, { success: true, data: history });
  assert.equal(createCalls, 0);
});

test('route table keeps existing role gates and assigns only Admin/BOM to new read endpoints', () => {
  const layers = auditRouter.stack.filter(layer => layer.route);
  const allowedRoles = path => {
    const route = layers.find(layer => layer.route.path === path);
    assert.ok(route, `missing route ${path}`);
    return ['ADMIN', 'BOM', 'CUSTOMER', 'FACILITY_STAFF', 'FACILITY_MANAGER'].filter(role => {
      let allowed = false;
      route.route.stack[0].handle({ user: { role } }, response(), () => { allowed = true; });
      return allowed;
    });
  };
  assert.deepEqual(allowedRoles('/logs').sort(), ['ADMIN', 'BOM']);
  assert.deepEqual(allowedRoles('/admin/subjects'), ['ADMIN']);
  assert.deepEqual(allowedRoles('/bom/subjects'), ['BOM']);
  assert.deepEqual(allowedRoles('/admin/audit-logs/:userId'), ['ADMIN']);
  assert.deepEqual(allowedRoles('/bom/audit-logs/:userId'), ['BOM']);
  const logsRoute = layers.find(layer => layer.route.path === '/logs');
  const unauth = response();
  logsRoute.route.stack[0].handle({}, unauth, () => assert.fail('next must not run without an actor'));
  assert.equal(unauth.statusCode, 401);
});

test('new controller returns safe envelope and structured validation errors', async () => {
  const denied = response();
  await AuditController.getGlobalAuditLogs({ query: { eventType: 'LOGIN' }, user: { role: 'ADMIN' } }, denied);
  assert.equal(denied.statusCode, 400); assert.equal(denied.body.code, 'AUDIT_FILTER_UNAVAILABLE');
});
