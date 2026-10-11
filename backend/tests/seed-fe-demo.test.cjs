const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const backend = path.resolve(__dirname, '..');
const script = path.join(backend, 'dist', 'scripts', 'seed-fe-demo.js');
const { activeIntervalOverlapFilter, canSeedFacilityWorkflow, canSeedSupportWorkflow, connectedSeedDatabaseMatches,
  createIfMissing, effectiveAt, insertWithinScopeTransaction, intervalsOverlap,
  isAllowedSeedDatabase, isSeedDryRun, resolveOptionalSeedUser, resolveUniqueEffectiveRule,
  SeedIntervalConflict, selectOperationalFacility, stableSeedId } = require('../dist/scripts/seed-fe-demo-utils');
const safeEnv = {
  ...process.env,
  NODE_ENV: 'test',
  MONGO_URL: 'mongodb://127.0.0.1:1/wdp',
  KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_CLIENT_SECRET: 'test-only',
  SEED_CUSTOMER_EMAIL: 'customer@example.test',
  SEED_STAFF_EMAIL: 'staff@example.test',
  SEED_MANAGER_EMAIL: 'manager@example.test',
  FE_SEED_DATABASE: 'test',
};

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: backend,
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('seed refuses writes without explicit confirmation before loading database config', () => {
  const env = { ...safeEnv, MONGO_URL: '', FE_SEED_CONFIRM: '' };
  const result = run([], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No database changes made/);
  assert.doesNotMatch(result.stdout + result.stderr, /MongoDB connection failed|MONGO_URL is required/);
  assert.equal(result.status, 0);
});

test('seed refuses production even with explicit confirmation', () => {
  const result = run([], { ...safeEnv, NODE_ENV: 'production', FE_SEED_CONFIRM: 'YES' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refuses to run when NODE_ENV=production/);
  assert.doesNotMatch(result.stdout + result.stderr, /mongodb:\/\//i);
});

test('confirmed seed refuses unless the explicit development target and exact database are supplied', () => {
  const result = run([], { ...safeEnv, NODE_ENV: 'test', FE_SEED_CONFIRM: 'YES', FE_SEED_TARGET: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FE_SEED_TARGET=DEVELOPMENT/);
  assert.doesNotMatch(result.stdout + result.stderr, /mongodb:\/\//i);
});

test('environment and CLI dry-run flags are both recognized without creating data', async () => {
  assert.equal(isSeedDryRun([], 'YES'), true);
  assert.equal(isSeedDryRun(['--dry-run'], undefined), true);
  assert.equal(isSeedDryRun([], 'NO'), false);

  let creates = 0;
  const model = { findOne: () => ({ exec: async () => null }), async create() { creates++; throw new Error('write forbidden'); } };
  const planned = await createIfMissing(model, stableSeedId('dry-run', 'fixture'), {}, { name: 'fixture' }, isSeedDryRun([], 'YES'));
  assert.equal(planned.status, 'planned');
  assert.equal(creates, 0);

  const result = run([], { ...safeEnv, MONGO_URL: '', FE_SEED_DRY_RUN: 'YES' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MONGO_URL is required/);
  assert.match(result.stderr, /"mode": "dry-run"/);
  assert.doesNotMatch(result.stdout + result.stderr, /mongodb:\/\//i);
});

test('only explicitly selected test database is allowed and connected name must match exactly', () => {
  assert.equal(isAllowedSeedDatabase('test'), true);
  assert.equal(isAllowedSeedDatabase(undefined), false);
  assert.equal(isAllowedSeedDatabase('wdp'), false);
  assert.equal(connectedSeedDatabaseMatches('test', 'test'), true);
  assert.equal(connectedSeedDatabaseMatches('test', 'wdp'), false);
  assert.equal(connectedSeedDatabaseMatches('wdp', 'wdp'), false);

  const mismatch = run([], { ...safeEnv, FE_SEED_DATABASE: 'wdp', FE_SEED_CONFIRM: 'YES',
    NODE_ENV: 'development', FE_SEED_TARGET: 'DEVELOPMENT' });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /FE_SEED_DATABASE=test/);
  assert.doesNotMatch(mismatch.stdout + mismatch.stderr, /mongodb:\/\//i);
});

test('seed source has no destructive database or collection operations', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(backend, 'src', 'scripts', 'seed-fe-demo.ts'), 'utf8');
  assert.doesNotMatch(source, /dropDatabase\s*\(|dropCollection\s*\(|deleteMany\s*\(|deleteOne\s*\(/);
  assert.match(source, /FE_SEED_CONFIRM === 'YES'/);
  assert.match(source, /connectedSeedDatabaseMatches\(databaseName, mongoose\.connection\.name\)/);
  assert.match(source, /FE_SEED_DRY_RUN/);
});

test('seed IDs are deterministic and distinct across demo entities', () => {
  const first = stableSeedId('facility', 'FE-DEMO-HCM-01');
  assert.equal(first, stableSeedId('facility', 'FE-DEMO-HCM-01'));
  assert.match(first, /^[a-f0-9]{24}$/);
  assert.notEqual(first, stableSeedId('facility', 'FE-DEMO-HN-01'));
});

test('create-if-missing preserves demo data on reruns and never overwrites real natural-key conflicts', async () => {
  const rows = [];
  let creates = 0;
  const model = {
    findOne(filter) { return { exec: async () => rows.find(row => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))) ?? null }; },
    async create(input) { creates++; const row = input[0]; rows.push(row); return [row]; },
  };
  const id = stableSeedId('facility', 'FE-DEMO-HCM-01');
  const natural = { code: 'FE-DEMO-HCM-01' };
  const data = { code: natural.code, description: 'FE-DEMO sample facility' };
  const first = await createIfMissing(model, id, natural, data, false);
  assert.equal(first.status, 'created');
  const rerun = await createIfMissing(model, id, natural, { ...data, description: 'different seed description' }, false);
  assert.equal(rerun.status, 'existing');
  assert.equal(rerun.document.description, data.description);
  assert.equal(creates, 1);

  rows.push({ _id: 'real-id', code: 'FE-DEMO-CONFLICT', description: 'Ordinary customer facility' });
  const conflict = await createIfMissing(model, stableSeedId('facility', 'FE-DEMO-CONFLICT'),
    { code: 'FE-DEMO-CONFLICT' }, { code: 'FE-DEMO-CONFLICT' }, false);
  assert.equal(conflict.status, 'conflict');
  assert.equal(creates, 1);
});

test('no configured user accounts do not block planning the complete core catalog', async () => {
  const warnings = [];
  const lookup = async () => { throw new Error('lookup should not run without an email setting'); };
  const customer = await resolveOptionalSeedUser('SEED_CUSTOMER_EMAIL', 'CUSTOMER', '', lookup, warnings);
  const staff = await resolveOptionalSeedUser('SEED_STAFF_EMAIL', 'FACILITY_STAFF', undefined, lookup, warnings);
  const manager = await resolveOptionalSeedUser('SEED_MANAGER_EMAIL', 'FACILITY_MANAGER', '  ', lookup, warnings);
  assert.equal(customer, null); assert.equal(staff, null); assert.equal(manager, null);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(warning => !warning.includes('@')));

  const catalogRows = [...Array(2).fill('facility'), ...Array(9).fill('unit'),
    ...Array(12).fill('pricing'), ...Array(8).fill('policy')];
  let writes = 0;
  const model = { findOne: () => ({ exec: async () => null }), async create() { writes++; return [{}]; } };
  const results = await Promise.all(catalogRows.map((kind, index) => createIfMissing(model,
    stableSeedId(kind, String(index)), {}, { kind }, true)));
  assert.equal(results.filter(result => result.status === 'planned').length, 31);
  assert.equal(writes, 0);
});

test('invalid optional users skip only dependent operational workflows', async () => {
  const warnings = [];
  const wrongRole = await resolveOptionalSeedUser('SEED_STAFF_EMAIL', 'FACILITY_STAFF', 'private@example.test',
    async () => ({ isActive: true, role: 'CUSTOMER' }), warnings);
  assert.equal(wrongRole, null);
  assert.match(warnings[0], /SEED_STAFF_EMAIL.*incorrect role/);
  assert.equal(warnings[0].includes('private@example.test'), false);

  const missingWarnings = [];
  const notFound = await resolveOptionalSeedUser('SEED_MANAGER_EMAIL', 'FACILITY_MANAGER', 'unmatched@example.test',
    async () => null, missingWarnings);
  const inactive = await resolveOptionalSeedUser('SEED_CUSTOMER_EMAIL', 'CUSTOMER', 'inactive@example.test',
    async () => ({ isActive: false, role: 'CUSTOMER' }), missingWarnings);
  assert.equal(notFound, null); assert.equal(inactive, null);
  assert.match(missingWarnings[0], /no existing user matched/);
  assert.match(missingWarnings[1], /matching user is inactive/);
  assert.equal(missingWarnings.join(' ').includes('@example.test'), false);

  const facility = { _id: 'facility-1', status: 'ACTIVE' };
  const manager = { role: 'FACILITY_MANAGER', isActive: true, assignedFacilityId: 'facility-1' };
  const customer = { role: 'CUSTOMER', isActive: true };
  assert.equal(canSeedFacilityWorkflow(wrongRole, manager, facility), false);
  assert.equal(canSeedSupportWorkflow(customer, wrongRole, manager, facility), false);
  const staffMissing = null;
  assert.equal(canSeedSupportWorkflow(customer, staffMissing, manager, facility), false,
    'a valid customer alone cannot create a support request');
});

test('all valid active users assigned to the selected facility retain operational eligibility', () => {
  const facility = { _id: 'facility-1', status: 'ACTIVE' };
  const staff = { role: 'FACILITY_STAFF', isActive: true, assignedFacilityId: 'facility-1' };
  const manager = { role: 'FACILITY_MANAGER', isActive: true, assignedFacilityId: 'facility-1' };
  const customer = { role: 'CUSTOMER', isActive: true };
  assert.equal(canSeedFacilityWorkflow(staff, manager, facility), true);
  assert.equal(canSeedSupportWorkflow(customer, staff, manager, facility), true);
  assert.equal(selectOperationalFacility(undefined, null, facility, staff, manager), facility);
  assert.equal(selectOperationalFacility('invalid-explicit-selection', null, facility, staff, manager), null,
    'an invalid explicit operational selection must not fall back to the public demo facility');
  assert.equal(selectOperationalFacility('explicit-selection', facility, null, staff, manager), facility);
});

test('effective pricing and policy verification is read-only and requires no actor', async () => {
  const at = new Date('2026-10-10T00:00:00.000Z');
  const active = { _id: 'rule-1', isActive: true, effectiveFrom: new Date('2026-01-01T00:00:00Z') };
  let filter;
  const model = rows => ({
    find(value) { filter = value; return { select: () => ({ lean: () => ({ exec: async () => rows }) }) }; },
  });
  const result = await resolveUniqueEffectiveRule(model([active]), { facilityId: 'facility-1', type: 'DEPOSIT' }, at);
  assert.equal(result.status, 'resolved');
  assert.equal(result.rule._id, 'rule-1');
  assert.equal(filter.isActive, true);
  assert.deepEqual(filter.effectiveFrom, { $lte: at });
  assert.deepEqual(filter.$or, [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }]);
  assert.equal((await resolveUniqueEffectiveRule(model([]), {}, at)).status, 'missing');
  assert.equal((await resolveUniqueEffectiveRule(model([active, { ...active, _id: 'rule-2' }]), {}, at)).status, 'conflict');
});

test('dry-run never calls model.create', async () => {
  let creates = 0;
  const model = { findOne: () => ({ exec: async () => null }), async create() { creates++; throw new Error('write forbidden'); } };
  const planned = await createIfMissing(model, stableSeedId('unit', 'FE-DEMO-HCM-01'), {}, { unitCode: 'FE-DEMO-HCM-01' }, true);
  assert.equal(planned.status, 'planned');
  assert.equal(creates, 0);
});

test('maintenance/support examples require active same-facility staff and manager; rules use half-open date ranges', () => {
  const facility = { _id: 'facility-1', status: 'ACTIVE' };
  const staff = { _id: 'staff-1', role: 'FACILITY_STAFF', isActive: true, assignedFacilityId: 'facility-1' };
  const manager = { _id: 'manager-1', role: 'FACILITY_MANAGER', isActive: true, assignedFacilityId: 'facility-1' };
  assert.equal(canSeedFacilityWorkflow(staff, manager, facility), true);
  assert.equal(canSeedFacilityWorkflow(staff, { ...manager, assignedFacilityId: 'other' }, facility), false);
  assert.equal(canSeedFacilityWorkflow({ ...staff, isActive: false }, manager, facility), false);
  assert.equal(canSeedFacilityWorkflow(staff, manager, { ...facility, status: 'INACTIVE' }), false);
  assert.equal(canSeedFacilityWorkflow(staff, manager, { ...facility, deletedAt: new Date() }), false);
  const at = new Date('2026-10-10T00:00:00.000Z');
  assert.equal(effectiveAt({ effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), isActive: true }, at), true);
  assert.equal(effectiveAt({ effectiveFrom: new Date('2026-10-11T00:00:00.000Z'), isActive: true }, at), false);
  assert.equal(effectiveAt({ effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: at, isActive: true }, at), false);
  assert.equal(effectiveAt({ effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), isActive: false }, at), false);
});

const seedInterval = { effectiveFrom: new Date('2026-01-01T00:00:00.000Z') };
const interval = (from, to) => ({ effectiveFrom: new Date(from), ...(to ? { effectiveTo: new Date(to) } : {}) });

test('seed overlap includes existing current and future active intervals', () => {
  assert.equal(intervalsOverlap(seedInterval, interval('2026-06-01T00:00:00Z')), true);
  assert.equal(intervalsOverlap(seedInterval, interval('2027-01-01T00:00:00Z')), true);
  const filter = activeIntervalOverlapFilter({ facilityId: 'facility-1' }, seedInterval);
  assert.equal(filter.isActive, true);
  assert.equal(filter.effectiveFrom, undefined, 'open-ended seed has no upper start-date bound');
  assert.deepEqual(filter.$or, [
    { effectiveTo: { $exists: false } },
    { effectiveTo: { $gt: seedInterval.effectiveFrom } },
  ]);
});

test('historical and adjacent half-open intervals do not overlap', () => {
  assert.equal(intervalsOverlap(seedInterval, interval('2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z')), false);
  assert.equal(intervalsOverlap(interval('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'),
    interval('2027-01-01T00:00:00Z')), false);
  assert.equal(intervalsOverlap(interval('2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
    interval('2026-04-01T00:00:00Z', '2026-07-01T00:00:00Z')), false);
});

test('concurrent same-scope seed insert rechecks overlap and preserves a single winner', async () => {
  const existing = [];
  let transactionQueue = Promise.resolve();
  let nextVersion = 0;
  let insertCount = 0;
  const adapter = {
    withTransaction(work) {
      const result = transactionQueue.then(work);
      transactionQueue = result.then(() => undefined, () => undefined);
      return result;
    },
    async nextVersion() { return ++nextVersion; },
    async hasActiveOverlap() { return existing.some(item => intervalsOverlap(item.interval, seedInterval)); },
    async insert(version) { insertCount++; existing.push({ version, interval: seedInterval }); return version; },
  };
  const results = await Promise.allSettled([insertWithinScopeTransaction(adapter), insertWithinScopeTransaction(adapter)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof SeedIntervalConflict).length, 1);
  assert.equal(insertCount, 1);
});

test('an existing active overlap is preserved and prevents seed insertion', async () => {
  let insertCount = 0;
  await assert.rejects(insertWithinScopeTransaction({
    withTransaction: work => work(),
    async nextVersion() { return 99; },
    async hasActiveOverlap() { return true; },
    async insert() { insertCount++; return 'unexpected'; },
  }), SeedIntervalConflict);
  assert.equal(insertCount, 0);
});
