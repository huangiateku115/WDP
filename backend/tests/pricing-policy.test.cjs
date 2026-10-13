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
const Price = require('../dist/models/pricing-policy/pricing-rule.model').default;
const Policy = require('../dist/models/pricing-policy/policy.model').default;
const Scope = require('../dist/models/pricing-policy/rule-scope.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const { pricingService, policyService } = require('../dist/services/pricing-policy/rule.service');
const validation = require('../dist/services/pricing-policy/rule.validation');
const facilityId = '507f1f77bcf86cd799439011';
const admin = { role: 'ADMIN', _id: new mongoose.Types.ObjectId() };
const from = '2090-01-01T00:00:00Z', end = '2091-01-01T00:00:00Z';
const price = (extra = {}) => ({ facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL',
  term: { value: 2, unit: 'MONTH' }, price: 125, currency: 'vnd', effectiveFrom: from, ...extra });
const policy = (extra = {}) => ({ facilityId, type: 'DEPOSIT', config: { note: 'Unfinalized example only' }, effectiveFrom: from, ...extra });
const status = n => e => e.status === n;
function equal(a, b) { return String(a) === String(b); }
function match(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(f => match(doc, f));
    const actual = key.split('.').reduce((o, k) => o?.[k], doc);
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof mongoose.Types.ObjectId)) {
      return Object.entries(expected).every(([op, v]) => {
        if (op === '$exists') return (actual !== undefined) === v;
        if (op === '$ne') return !equal(actual, v);
        if (op === '$lt') return actual < v;
        if (op === '$lte') return actual <= v;
        if (op === '$gt') return actual > v;
        throw new Error('Unimplemented test filter ' + op);
      });
    }
    return equal(actual, expected);
  });
}
// Persistence boundary only: real service, validators, Mongoose documents and role middleware.
// The transaction simulation asserts ordering and rollback, not live Atlas isolation.
function store(t) {
  const state = { rows: new Map([[Price, []], [Policy, []]]), facility: { status: 'ACTIVE', serviceTypes: ['SELF_STORAGE', 'MANAGED_INVENTORY'] }, events: [], seq: new Map() };
  let queue = Promise.resolve();
  function query(fn) {
    let skip = 0, limit = Infinity;
    const q = { session(s) { assert.equal(s.locked, true, 'lock precedes transactional reads'); return q; },
      sort() { return q; }, skip(v) { skip = v; return q; }, limit(v) { limit = v; return q; }, lean() { return q; },
      exec: async () => { const result = fn(); return Array.isArray(result) ? result.slice(skip, skip + limit) : result; } };
    return q;
  }
  t.mock.method(mongoose, 'startSession', async () => {
    const session = { locked: false, endSession: async () => state.events.push('end'),
      withTransaction: async (fn, options) => {
        assert.equal(options.readConcern.level, 'snapshot'); assert.equal(options.writeConcern.w, 'majority');
        const previous = queue; let release; queue = new Promise(r => { release = r; }); await previous;
        const rows = new Map([...state.rows].map(([m, r]) => [m, r.map(d => m.hydrate(d.toObject()))]));
        const seq = new Map(state.seq);
        try { return await fn(); } catch (e) { state.rows = rows; state.seq = seq; throw e; } finally { release(); }
      } };
    return session;
  });
  t.mock.method(Scope, 'updateOne', () => query(() => ({})));
  t.mock.method(Scope, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(options.session.locked, false);
    assert.deepEqual(update, { $inc: { sequence: 1 } });
    options.session.locked = true; state.events.push('lock');
    return query(() => { const sequence = (state.seq.get(filter._id) || 0) + 1; state.seq.set(filter._id, sequence); return { sequence }; });
  });
  t.mock.method(Facility, 'findById', () => query(() => state.facility));
  for (const model of [Price, Policy]) {
    t.mock.method(model, 'findById', id => query(() => {
      const d = state.rows.get(model).find(d => equal(d._id, id)); return d ? model.hydrate(d.toObject()) : null;
    }));
    t.mock.method(model, 'exists', f => query(() => state.rows.get(model).find(d => match(d, f)) || null));
    t.mock.method(model, 'find', f => query(() => state.rows.get(model).filter(d => match(d, f))));
    t.mock.method(model, 'countDocuments', f => query(() => state.rows.get(model).filter(d => match(d, f)).length));
    t.mock.method(model.prototype, 'save', async function (options) {
      assert.equal(options.session.locked, true); await this.validate();
      const rows = state.rows.get(model), index = rows.findIndex(d => equal(d._id, this._id));
      if (index < 0) rows.push(model.hydrate(this.toObject())); else rows[index] = model.hydrate(this.toObject());
      state.events.push('save'); return this;
    });
  }
  return state;
}

test('pricing creates typed SELF_STORAGE and per-m3 MANAGED_INVENTORY rules with server versions', async t => {
  const state = store(t);
  const a = await pricingService.create(price(), admin);
  const managed = price({ serviceType: 'MANAGED_INVENTORY', billingBasis: 'PER_M3' }); delete managed.unitSize;
  const b = await pricingService.create(managed, { ...admin, role: 'BOM' });
  assert.equal(a.currency, 'VND'); assert.equal(a.billingBasis, undefined); assert.equal(a.version, 1); assert.equal(b.unitSize, undefined); assert.equal(b.billingBasis, 'PER_M3');
  assert.equal(a.createdBy.toString(), admin._id.toString());
  assert.deepEqual(state.events, ['lock', 'save', 'end', 'lock', 'save', 'end']);
  assert.ok(Price.schema.indexes().some(([k]) => k.facilityId && k.effectiveFrom && k['term.value']));
  assert.ok(Policy.schema.indexes().some(([k]) => k.type && k.effectiveFrom));
  assert.equal(Scope.schema.path('_id').instance, 'String');
});
test('pricing rejects invalid scope, amounts, term, dates and immutable fields', async t => {
  store(t);
  for (const extra of [
    { facilityId: 'bad' }, { unitSize: undefined }, { unitSize: 'XL' }, { serviceType: 'MANAGED_INVENTORY' },
    ...[0, -1, NaN, Infinity, '10'].map(price => ({ price })),
    ...[0, -1, 1.5, Infinity, '1'].map(value => ({ term: { value, unit: 'MONTH' } })),
    { term: { value: 1, unit: 'WEEK' } }, { term: { value: 1, unit: 'MONTH', extra: true } },
    { effectiveFrom: '2090-02-30T00:00:00Z' }, { effectiveTo: from }, { effectiveTo: '2089-01-01T00:00:00Z' },
    { effectiveFrom: 'garbage' }, { effectiveTo: null }, { currency: 'dollars' }, { isActive: 'true' },
    { version: 2 }, { _id: facilityId }, { __v: 1 }, { createdAt: from }, { createdBy: facilityId }, { $set: {} },
  ]) await assert.rejects(pricingService.create(price(extra), admin), status(400));
  await assert.rejects(pricingService.create(price({ effectiveFrom: '2000-01-01T00:00:00Z' }), admin), status(409));
});
test('Managed DEPOSIT policy requires the explicit percentage-of-rent schema', async t => {
  store(t);
  for (const config of [{ amount: 500 }, { calculation: 'FIXED', amount: 500 }, { calculation: 'PERCENT_OF_RENT', percentage: -1 }, { calculation: 'PERCENT_OF_RENT', percentage: Infinity }]) {
    await assert.rejects(policyService.create(policy({ serviceType: 'MANAGED_INVENTORY', config }), admin), status(400));
  }
  const accepted = await policyService.create(policy({ serviceType: 'MANAGED_INVENTORY', config: { calculation: 'PERCENT_OF_RENT', percentage: 20 } }), admin);
  assert.equal(accepted.config.percentage, 20);
});
test('pricing and policies require existing ACTIVE supporting facilities', async t => {
  const s = store(t);
  for (const service of [pricingService, policyService]) {
    const input = service === pricingService ? price() : policy({ serviceType: 'SELF_STORAGE' });
    s.facility = null; await assert.rejects(service.create(input, admin), status(404));
    s.facility = { status: 'INACTIVE', serviceTypes: ['SELF_STORAGE'] }; await assert.rejects(service.create(input, admin), status(409));
    s.facility = { status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }; await assert.rejects(service.create(input, admin), status(409));
  }
});
for (const [name, service, model, make] of [['pricing', pricingService, Price, price], ['policy', policyService, Policy, policy]]) {
  test(name + ': interval overlap, adjacency, inactive versions and status activation', async t => {
    store(t);
    const first = await service.create(make({ effectiveTo: end }), admin);
    for (const interval of [
      {}, { effectiveFrom: '2089-01-01T00:00:00Z', effectiveTo: '2090-06-01T00:00:00Z' },
      { effectiveFrom: '2090-06-01T00:00:00Z', effectiveTo: '2092-01-01T00:00:00Z' },
      { effectiveFrom: '2089-01-01T00:00:00Z', effectiveTo: '2092-01-01T00:00:00Z' },
    ]) await assert.rejects(service.create(make(interval), admin), status(409));
    const second = await service.create(make({ effectiveFrom: end }), admin);
    assert.equal(second.version, 2);
    const draft = await service.create(make({ isActive: false }), admin);
    await assert.rejects(service.update(String(draft._id), { isActive: true }, admin, true), status(409));
    await service.update(String(first._id), { isActive: false }, admin, true);
    await service.update(String(draft._id), { effectiveTo: end }, admin);
    await service.update(String(draft._id), { isActive: true }, admin, true);
  });
  test(name + ': resolver half-open bounds, 404 and ambiguous-data failure', async t => {
    const s = store(t);
    const a = await service.create(make({ effectiveTo: end }), admin);
    const b = await service.create(make({ effectiveFrom: end }), admin);
    const query = name === 'pricing' ? { facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', termValue: '2', termUnit: 'MONTH' } : { facilityId, type: 'DEPOSIT' };
    assert.equal(String((await service.resolve({ ...query, at: from }, admin))._id), String(a._id));
    assert.equal(String((await service.resolve({ ...query, at: end }, admin))._id), String(b._id));
    await assert.rejects(service.resolve({ ...query, at: '2089-01-01T00:00:00Z' }, admin), status(404));
    await assert.rejects(service.resolve(query, admin), status(400));
    s.rows.get(model).push(model.hydrate({ ...b.toObject(), _id: new mongoose.Types.ObjectId() }));
    await assert.rejects(service.resolve({ ...query, at: end }, admin), status(409));
  });
  test(name + ': future edits, immutable scope, prospective closure and historical safety', async t => {
    const s = store(t);
    const a = await service.create(make(), admin), id = String(a._id);
    const change = name === 'pricing' ? { price: 250 } : { config: { note: 'revised draft' } };
    const updated = await service.update(id, change, admin);
    assert.equal(updated.version, 2);
    for (const input of [{ facilityId }, { serviceType: 'SELF_STORAGE' }, { version: 3 }, { isActive: false }, {}, { __v: 1 }])
      await assert.rejects(service.update(id, input, admin), status(400));
    await assert.rejects(service.update(id, { effectiveFrom: '2000-01-01T00:00:00Z' }, admin), status(409));
    s.rows.get(model)[0].effectiveFrom = new Date('2000-01-01T00:00:00Z');
    await assert.rejects(service.update(id, change, admin), status(409));
    await assert.rejects(service.update(id, { isActive: false }, admin, true), status(409));
    await assert.rejects(service.update(id, { effectiveTo: '2001-01-01T00:00:00Z' }, admin), status(409));
    const snapshot = JSON.stringify(s.rows.get(model)[0].toObject());
    await service.update(id, { effectiveTo: end }, admin);
    assert.equal(JSON.parse(snapshot).effectiveTo, undefined, 'a copied snapshot stays unchanged');
    await assert.rejects(service.update(id, { effectiveTo: '2092-01-01T00:00:00Z' }, admin), status(409));
    s.rows.get(model)[0].effectiveTo = new Date('2001-01-01T00:00:00Z');
    await assert.rejects(service.update(id, { effectiveTo: end }, admin), status(409));
  });
  test(name + ': concurrent overlapping creates serialize; failed writes roll back', async t => {
    const s = store(t);
    const results = await Promise.allSettled([service.create(make(), admin), service.create(make(), admin)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
    assert.equal(s.rows.get(model).length, 1); assert.equal([...s.seq.values()][0], 1);
  });
  test(name + ': get/list pagination/filter validation, safe errors and role guards', async t => {
    const s = store(t);
    const a = await service.create(make(), admin);
    assert.equal(String((await service.get(String(a._id), { role: 'CUSTOMER' }))._id), String(a._id));
    const result = await service.list({ facilityId, isActive: 'true', page: '1', limit: '1', ...(name === 'pricing' ? { unitSize: 'SMALL', termValue: '2', termUnit: 'MONTH' } : { type: 'DEPOSIT' }) }, admin);
    assert.equal(result.data.length, 1); assert.deepEqual(result.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    assert.equal((await service.list({ page: '2', limit: '1' }, admin)).data.length, 0);
    for (const input of [{ page: '0' }, { limit: '101' }, { isActive: 'yes' }, { facilityId: 'bad' }, { $where: 'x' }])
      await assert.rejects(service.list(input, admin), status(400));
    await assert.rejects(service.get('bad', admin), status(400));
    await assert.rejects(service.get(String(new mongoose.Types.ObjectId()), admin), status(404));
    await assert.rejects(service.get(String(a._id), undefined), status(401));
    for (const role of ['CUSTOMER', 'FACILITY_STAFF', 'FACILITY_MANAGER', 'unknown']) {
      await assert.rejects(service.create(make(), { role }), status(403));
      await assert.rejects(service.update(String(a._id), {}, { role }), status(403));
    }
    t.mock.method(model, 'findById', () => { throw new Error('mongodb://private-internals'); });
    await assert.rejects(service.get(String(a._id), admin), e => e.status === 500 && e.message === 'Internal Server Error');
  });
}
test('policy config defensive validation and isolated service scopes', async t => {
  store(t);
  for (const type of ['DEPOSIT', 'CANCELLATION', 'REFUND', 'OVERDUE', 'DISCOUNT', 'WAIVER', 'SHELF_CONSTRAINT'])
    await policyService.create(policy({ type, config: { nested: [{ note: 'Uninterpreted', enabled: true, value: null }] } }), admin);
  await policyService.create(policy({ serviceType: 'SELF_STORAGE' }), admin);
  await policyService.create(policy({ serviceType: 'MANAGED_INVENTORY', config: { calculation: 'PERCENT_OF_RENT', percentage: 0 } }), admin);
  for (const config of [null, [], 'x', 3, { x: NaN }, { x: Infinity }, { x: () => {} }, { nested: { $where: 'x' } },
    JSON.parse('{"__proto__":{"polluted":true}}'), { nested: { constructor: {} } }, { 'a.b': 1 },
    { x: 'a'.repeat(17000) }, { x: Array(2001).fill(1) }, { x: new Date() }]) {
    await assert.rejects(policyService.create(policy({ config }), admin), status(400));
  }
  let deep = {}; for (let i = 0; i < 10; i++) deep = { child: deep };
  assert.throws(() => validation.config(deep), status(400));
  const cycle = {}; cycle.x = cycle; assert.throws(() => validation.config(cycle), status(400));
  await assert.rejects(policyService.create(policy({ type: 'UNKNOWN' }), admin), status(400));
  assert.equal({}.polluted, undefined);
});
test('HTTP pricing/policy routes use real role middleware; resolve precedes ID; no DELETE', async t => {
  store(t);
  const auth = require('../dist/middlewares/auth/requireAuth');
  t.mock.method(auth, 'requireAuth', (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (!role) return res.status(401).json({ success: false, message: 'Unauthorized' });
    req.user = { ...admin, role }; next();
  });
  const server = require('../dist/app').default.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  const request = (method, path, role, body) => fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const [path, make, query] of [
    ['/pricing-rules', price, `facilityId=${facilityId}&serviceType=SELF_STORAGE&unitSize=SMALL&termValue=2&termUnit=MONTH`],
    ['/policies', policy, `facilityId=${facilityId}&type=DEPOSIT`],
  ]) {
    for (const [method, url] of [['GET',path],['GET',path+'/resolve'],['GET',path+'/'+facilityId],['POST',path],['PATCH',path+'/'+facilityId],['PATCH',path+'/'+facilityId+'/status']])
      assert.equal((await request(method,url)).status,401);
    for (const role of ['CUSTOMER','FACILITY_STAFF','FACILITY_MANAGER']) {
      for (const [method,url,body] of [['POST',path,make()],['PATCH',path+'/'+facilityId,{price:1}],['PATCH',path+'/'+facilityId+'/status',{isActive:false}]])
        assert.equal((await request(method,url,role,body)).status,403);
    }
    const created = await request('POST',path,'BOM',make()); assert.equal(created.status,201);
    const id = (await created.json()).data._id;
    assert.equal((await request('GET',path,'CUSTOMER')).status,200);
    assert.equal((await request('GET',path+'/'+id,'CUSTOMER')).status,200);
    assert.equal((await request('GET',path+'/resolve?'+query+'&at='+from,'CUSTOMER')).status,200);
    assert.equal((await request('GET',path+'/resolve?'+query+'&at=2089-01-01T00:00:00Z','CUSTOMER')).status,404);
    assert.equal((await request('PATCH',path+'/'+id,'ADMIN',{effectiveTo:end})).status,200);
    assert.equal((await request('PATCH',path+'/'+id+'/status','ADMIN',{isActive:false})).status,200);
    assert.equal((await request('DELETE',path+'/'+id,'ADMIN')).status,404);
  }
});
test('CATEGORY policy requires the approved strict allow/block schema and Managed Inventory scope', async t => {
  store(t);
  for (const input of [
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: ['DOCUMENTS'] } },
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: [], blockedCategories: [] } },
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: ['DOCUMENTS', 'documents'], blockedCategories: [] } },
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: ['DOCUMENTS'], blockedCategories: ['HAZARDOUS'], extra: true } },
    { serviceType: 'SELF_STORAGE', config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } },
    { config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } },
  ]) await assert.rejects(policyService.create(policy({ type: 'CATEGORY', ...input }), admin), status(400));
  const accepted = await policyService.create(policy({ type: 'CATEGORY', serviceType: 'MANAGED_INVENTORY', config: {
    allowedCategories: [' documents ', 'FURNITURE'], blockedCategories: ['HAZARDOUS'],
  } }), admin);
  assert.deepEqual(accepted.config, { allowedCategories: ['DOCUMENTS', 'FURNITURE'], blockedCategories: ['HAZARDOUS'] });
  await assert.rejects(policyService.update(String(accepted._id), { config: { allowedCategories: ['DOCUMENTS'] } }, admin), status(400));
  const updated = await policyService.update(String(accepted._id), { config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }, admin);
  assert.deepEqual(updated.config, { allowedCategories: ['DOCUMENTS'], blockedCategories: [] });
});
