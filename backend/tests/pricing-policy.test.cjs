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
const { pricingRevisionsFor, pricingRevisionAt } = require('../dist/services/pricing-policy/pricing-revision');
const validation = require('../dist/services/pricing-policy/rule.validation');
const { ReservationService } = require('../dist/services/reservations/reservation.service');
const facilityId = '507f1f77bcf86cd799439011';
const admin = { role: 'ADMIN', _id: new mongoose.Types.ObjectId() };
const from = '2090-01-01T00:00:00Z', end = '2091-01-01T00:00:00Z';
const price = (extra = {}) => ({ facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL',
  term: { value: 2, unit: 'MONTH' }, price: 125, currency: 'vnd', effectiveFrom: from, ...extra });
const policy = (extra = {}) => ({ facilityId, type: 'DEPOSIT', config: { note: 'Unfinalized example only' }, effectiveFrom: from, ...extra });
const status = n => e => e.status === n;
function equal(a, b) { return String(a) === String(b); }
function pricingScopeId() { return JSON.stringify(['pricing', facilityId, 'SELF_STORAGE', undefined, 'SMALL', 2, 'MONTH']); }
test('legacy rules resolve from top-level fields while malformed revision history fails closed', () => {
  const legacy = { version: 4, price: 150000, currency: 'VND', effectiveFrom: new Date('2025-01-01T00:00:00.000Z') };
  assert.equal(pricingRevisionAt(legacy, new Date('2025-06-01T00:00:00.000Z')).price, 150000);
  assert.throws(() => pricingRevisionsFor({ ...legacy, priceRevisions: [] }), /revision history is malformed/);
  assert.throws(() => pricingRevisionsFor({ ...legacy, priceRevisions: {} }), /revision history is malformed/);
  assert.throws(() => pricingRevisionsFor({ ...legacy, priceRevisions: [
    { version: 3, price: 100000, currency: 'VND', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), effectiveTo: new Date('2025-03-01T00:00:00.000Z') },
    { version: 4, price: 150000, currency: 'VND', effectiveFrom: new Date('2025-04-01T00:00:00.000Z') },
  ] }), /not strictly ordered and contiguous/);
});
function match(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(f => match(doc, f));
    if (key === '$and') return expected.every(f => match(doc, f));
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
test('an already-effective Pricing Rule keeps its ID and resolves old and new prices from one document', async t => {
  const state = store(t);
  const now = Date.now(), day = 24 * 60 * 60 * 1000;
  const oldStart = new Date(now - day).toISOString();
  const newStart = new Date(now + 2 * day).toISOString();
  const beforeNewPrice = new Date(now + day).toISOString();
  const original = new Price({ ...price({ price: 500000, currency: 'VND', effectiveFrom: oldStart }), isActive: true, version: 1 });
  state.rows.get(Price).push(original);
  state.seq.set(pricingScopeId(), 1);
  const id = String(original._id);
  const updated = await pricingService.update(id, { price: 600000, currency: 'VND', effectiveFrom: newStart }, admin);
  assert.equal(String(updated._id), id);
  assert.equal(state.rows.get(Price).length, 1, 'edit must not create another PricingRule document');
  assert.equal(updated.priceRevisions.length, 2);
  assert.equal(updated.priceRevisions[0].effectiveTo.toISOString(), newStart);
  assert.equal((await pricingService.resolve({ facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', termValue: '2', termUnit: 'MONTH', at: beforeNewPrice }, admin)).price, 500000);
  assert.equal((await pricingService.resolve({ facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', termValue: '2', termUnit: 'MONTH', at: newStart }, admin)).price, 600000);
  assert.equal((await pricingService.currentPublicPricing(facilityId, new Date(beforeNewPrice)))[0].price, 500000);
  assert.equal((await pricingService.currentPublicPricing(facilityId, new Date(newStart)))[0].price, 600000);
  const beforeEstimate = await ReservationService.calculatePricing(id, new Date(beforeNewPrice), new Date(new Date(beforeNewPrice).getTime() + 2 * day));
  const afterEstimate = await ReservationService.calculatePricing(id, new Date(newStart), new Date(new Date(newStart).getTime() + 2 * day));
  assert.equal(beforeEstimate.basePrice, 500000);
  assert.equal(afterEstimate.basePrice, 600000);
  await assert.rejects(pricingService.create(price({ effectiveFrom: new Date(now + day).toISOString(), price: 400000 }), admin), status(409),
    'new rules must check every interval held inside an existing document');
  assert.equal(state.rows.get(Price).length, 1);
});
test('editing an active rule requires a future start and rejects stale concurrent edits', async t => {
  const state = store(t);
  const now = Date.now(), day = 24 * 60 * 60 * 1000;
  const original = new Price({ ...price({ currency: 'VND', effectiveFrom: new Date(now - day).toISOString() }), isActive: true, version: 1 });
  state.rows.get(Price).push(original);
  state.seq.set(pricingScopeId(), 1);
  const id = String(original._id);
  await assert.rejects(pricingService.update(id, { price: 600000, currency: 'VND' }, admin), status(400));
  await assert.rejects(pricingService.update(id, { price: 600000, effectiveFrom: 'not-a-date' }, admin), status(400));
  await assert.rejects(pricingService.update(id, { price: 600000, effectiveFrom: new Date(now - day).toISOString() }, admin), status(409));
  const edits = await Promise.allSettled([
    pricingService.update(id, { price: 600000, currency: 'VND', effectiveFrom: new Date(now + 3 * day).toISOString() }, admin),
    pricingService.update(id, { price: 700000, currency: 'VND', effectiveFrom: new Date(now + 4 * day).toISOString() }, admin),
  ]);
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(edits.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(state.rows.get(Price).length, 1);
});
test('sequential edits move the scheduled boundary without a gap or duplicate Pricing Rule', async t => {
  const state = store(t);
  const now = Date.now(), day = 24 * 60 * 60 * 1000;
  const original = new Price({ ...price({ price: 500000, currency: 'VND', effectiveFrom: new Date(now - day).toISOString() }), isActive: true, version: 1 });
  state.rows.get(Price).push(original);
  state.seq.set(pricingScopeId(), 1);
  const id = String(original._id);
  const firstStart = new Date(now + 2 * day).toISOString();
  const secondStart = new Date(now + 4 * day).toISOString();
  await pricingService.update(id, { price: 600000, currency: 'VND', effectiveFrom: firstStart }, admin);
  const revised = await pricingService.update(id, { price: 700000, currency: 'VND', effectiveFrom: secondStart }, admin);
  assert.equal(String(revised._id), id);
  assert.equal(state.rows.get(Price).length, 1);
  assert.equal(revised.priceRevisions.length, 2);
  assert.equal(revised.priceRevisions[0].effectiveTo.toISOString(), secondStart);
  assert.equal((await pricingService.resolve({ facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', termValue: '2', termUnit: 'MONTH', at: firstStart }, admin)).price, 500000);
  assert.equal((await pricingService.resolve({ facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', termValue: '2', termUnit: 'MONTH', at: secondStart }, admin)).price, 700000);
});
test('a future edit cannot reuse another revision start or extend into an overlapping rule', async t => {
  const state = store(t);
  const now = Date.now(), day = 24 * 60 * 60 * 1000;
  const firstStart = new Date(now + day), secondStart = new Date(now + 3 * day);
  const original = new Price({ ...price({ price: 500000, currency: 'VND', effectiveFrom: secondStart.toISOString() }), isActive: true, version: 2,
    priceRevisions: [
      { version: 1, price: 400000, currency: 'VND', effectiveFrom: firstStart, effectiveTo: secondStart },
      { version: 2, price: 500000, currency: 'VND', effectiveFrom: secondStart },
    ] });
  state.rows.get(Price).push(original);
  state.seq.set(pricingScopeId(), 2);
  await assert.rejects(pricingService.update(String(original._id), { price: 600000, effectiveFrom: firstStart.toISOString() }, admin), status(409));
  state.rows.get(Price).splice(0, 1);

  const currentStart = new Date(now - day), oldEnd = new Date(now + 10 * day), collisionEnd = new Date(now + 20 * day);
  const boundedCurrent = new Price({ ...price({ price: 300000, currency: 'VND', effectiveFrom: currentStart.toISOString(), effectiveTo: oldEnd.toISOString() }), isActive: true, version: 1 });
  const adjacentRule = new Price({ ...price({ price: 800000, currency: 'VND', effectiveFrom: oldEnd.toISOString(), effectiveTo: collisionEnd.toISOString() }), isActive: true, version: 3 });
  state.rows.get(Price).push(boundedCurrent, adjacentRule);
  const proposedStart = new Date(now + 3 * day);
  await assert.rejects(pricingService.update(String(boundedCurrent._id), {
    price: 700000, effectiveFrom: proposedStart.toISOString(), effectiveTo: collisionEnd.toISOString(),
  }, admin), status(409));
  const unchanged = state.rows.get(Price).find(row => equal(row._id, boundedCurrent._id));
  assert.equal(unchanged.priceRevisions, undefined, 'failed overlapping update must roll back without partial history');
});
test('a future Pricing Rule edits in place using only mutable fields', async t => {
  const state = store(t);
  const day = 24 * 60 * 60 * 1000;
  const oldStart = new Date(Date.now() + day).toISOString();
  const newStart = new Date(Date.now() + 3 * day).toISOString();
  const original = new Price({ ...price({ price: 500000, currency: 'VND', effectiveFrom: oldStart }), isActive: true, version: 1 });
  state.rows.get(Price).push(original);
  state.seq.set(pricingScopeId(), 1);
  const id = String(original._id);
  const updated = await pricingService.update(id, { price: 600000, currency: 'VND', effectiveFrom: newStart }, admin);
  assert.equal(String(updated._id), id);
  assert.equal(state.rows.get(Price).length, 1);
  assert.equal(updated.price, 600000);
  assert.equal(updated.effectiveFrom.toISOString(), newStart);
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
    assert.throws(() => validation.body('policy', policy({ serviceType: 'MANAGED_INVENTORY', config })), status(400));
  }
  const accepted = validation.body('policy', policy({ serviceType: 'MANAGED_INVENTORY', config: { calculation: 'PERCENT_OF_RENT', percentage: 20 } }));
  assert.equal(accepted.config.percentage, 20);
});
test('Pricing Rule writes require an existing ACTIVE supporting facility', async t => {
  const s = store(t);
  for (const service of [pricingService]) {
    const input = price();
    s.facility = null; await assert.rejects(service.create(input, admin), status(404));
    s.facility = { status: 'INACTIVE', serviceTypes: ['SELF_STORAGE'] }; await assert.rejects(service.create(input, admin), status(409));
    s.facility = { status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }; await assert.rejects(service.create(input, admin), status(409));
  }
});
for (const [name, service, model, make] of [['pricing', pricingService, Price, price]]) {
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
  test(name + ': future edits, immutable scope and active revisions require a future effectiveFrom', async t => {
    const s = store(t);
    const a = await service.create(make(), admin), id = String(a._id);
    const change = name === 'pricing' ? { price: 250 } : { config: { note: 'revised draft' } };
    const updated = await service.update(id, change, admin);
    assert.equal(updated.version, 2);
    for (const input of [{ facilityId }, { serviceType: 'SELF_STORAGE' }, { version: 3 }, { isActive: false }, {}, { __v: 1 }])
      await assert.rejects(service.update(id, input, admin), status(400));
    await assert.rejects(service.update(id, { effectiveFrom: '2000-01-01T00:00:00Z' }, admin), status(409));
    s.rows.get(model)[0].effectiveFrom = new Date('2000-01-01T00:00:00Z');
    await assert.rejects(service.update(id, change, admin), name === 'pricing' ? status(400) : status(409));
    await assert.rejects(service.update(id, { isActive: false }, admin, true), status(409));
    await assert.rejects(service.update(id, { effectiveTo: '2001-01-01T00:00:00Z' }, admin), status(400));
    await assert.rejects(service.update(id, { effectiveTo: end }, admin), status(400));
    await assert.rejects(service.update(id, { effectiveTo: end, effectiveFrom: '2000-01-01T00:00:00Z' }, admin), status(409));
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
    assert.equal(validation.body('policy', policy({ type, config: { nested: [{ note: 'Uninterpreted', enabled: true, value: null }] } })).type, type);
  validation.body('policy', policy({ serviceType: 'SELF_STORAGE' }));
  validation.body('policy', policy({ serviceType: 'MANAGED_INVENTORY', config: { calculation: 'PERCENT_OF_RENT', percentage: 0 } }));
  for (const config of [null, [], 'x', 3, { x: NaN }, { x: Infinity }, { x: () => {} }, { nested: { $where: 'x' } },
    JSON.parse('{"__proto__":{"polluted":true}}'), { nested: { constructor: {} } }, { 'a.b': 1 },
    { x: 'a'.repeat(17000) }, { x: Array(2001).fill(1) }, { x: new Date() }]) {
    assert.throws(() => validation.body('policy', policy({ config })), status(400));
  }
  let deep = {}; for (let i = 0; i < 10; i++) deep = { child: deep };
  assert.throws(() => validation.config(deep), status(400));
  const cycle = {}; cycle.x = cycle; assert.throws(() => validation.config(cycle), status(400));
  assert.throws(() => validation.body('policy', policy({ type: 'UNKNOWN' })), status(400));
  assert.equal({}.polluted, undefined);
});

test('Business Policy is read-only through direct service calls for Admin and BOM', async t => {
  store(t);
  for (const actor of [admin, { ...admin, role: 'BOM' }]) {
    await assert.rejects(policyService.create(policy(), actor), status(403));
    await assert.rejects(policyService.update(facilityId, { config: { note: 'changed' } }, actor), status(403));
    await assert.rejects(policyService.update(facilityId, { isActive: false }, actor, true), status(403));
  }
});
test('route table preserves Pricing Rule writes and exposes Policy read routes only', async t => {
  const state = store(t);
  const router = require('../dist/routes/pricing-policy.routes').default;
  const pricingLayer = router.stack.find(layer => /pricing-rules/.test(layer.regexp.toString()));
  const policyLayer = router.stack.find(layer => /policies/.test(layer.regexp.toString()));
  const routeMethods = layer => layer.handle.stack.filter(row => row.route).map(row => ({ path: row.route.path, methods: row.route.methods }));
  const pricingRoutes = routeMethods(pricingLayer);
  const policyRoutes = routeMethods(policyLayer);
  assert.ok(pricingRoutes.some(r => r.path === '/' && r.methods.post));
  assert.ok(pricingRoutes.some(r => r.path === '/:id' && r.methods.patch));
  assert.ok(pricingRoutes.some(r => r.path === '/:id/status' && r.methods.patch));
  assert.ok(policyRoutes.some(r => r.path === '/resolve' && r.methods.get));
  assert.ok(policyRoutes.some(r => r.path === '/' && r.methods.get));
  assert.ok(policyRoutes.some(r => r.path === '/:id' && r.methods.get));
  assert.equal(policyRoutes.some(r => r.methods.post || r.methods.patch), false);

  const historical = new Policy({ ...policy(), isActive: true, version: 1 });
  state.rows.get(Policy).push(historical);
  assert.equal(String((await policyService.get(String(historical._id), admin))._id), String(historical._id));
  assert.equal((await policyService.list({ facilityId, type: 'DEPOSIT' }, admin)).data.length, 1);
  assert.equal(String((await policyService.resolve({ facilityId, type: 'DEPOSIT', at: from }, admin))._id), String(historical._id));
});
test('CATEGORY policy readers keep the approved strict allow/block schema and Managed Inventory scope', async t => {
  store(t);
  for (const input of [
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: ['DOCUMENTS'] } },
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: [], blockedCategories: [] } },
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: ['DOCUMENTS', 'documents'], blockedCategories: [] } },
    { serviceType: 'MANAGED_INVENTORY', config: { allowedCategories: ['DOCUMENTS'], blockedCategories: ['HAZARDOUS'], extra: true } },
    { serviceType: 'SELF_STORAGE', config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } },
    { config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } },
  ]) assert.throws(() => validation.body('policy', policy({ type: 'CATEGORY', ...input })), status(400));
  const accepted = validation.body('policy', policy({ type: 'CATEGORY', serviceType: 'MANAGED_INVENTORY', config: {
    allowedCategories: [' documents ', 'FURNITURE'], blockedCategories: ['HAZARDOUS'],
  } }));
  assert.deepEqual(accepted.config, { allowedCategories: ['DOCUMENTS', 'FURNITURE'], blockedCategories: ['HAZARDOUS'] });
  const updated = validation.body('policy', { config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }, true);
  assert.deepEqual(validation.validateCategoryPolicyConfig(updated.config), { allowedCategories: ['DOCUMENTS'], blockedCategories: [] });
});
