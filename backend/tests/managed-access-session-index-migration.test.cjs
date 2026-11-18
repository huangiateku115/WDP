const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requiredAccessSessionIndexes } = require('../scripts/managed-access-index-compatibility.cjs');
const { buildCreateIndexOptions, createPlan, applyMissingIndexes, runMigration } = require('../scripts/managed-access-session-index-migration.draft.cjs');

const cleanAudit = { active: 0, missingPrimary: 0, malformedPrimary: 0, malformedScope: 0, missingOrEmptyScope: 0,
  duplicateIdsWithinScope: 0, primaryOutsideScope: 0, duplicateCompleteScopeGroups: 0 };
function fakeCollection({ indexes = [], audit = cleanAudit, failName } = {}) {
  const created = [];
  const collection = {
    created,
    countDocuments: async filter => {
      if (filter.status === 'ACTIVE' && Object.keys(filter).length === 1) return audit.active;
      const expression = JSON.stringify(filter);
      if (expression.includes('scopedReservationIds') && expression.includes('$anyElementTrue')) return audit.malformedScope;
      if (expression.includes('$setUnion')) return audit.duplicateIdsWithinScope;
      if (expression.includes('$in')) return audit.primaryOutsideScope;
      if (expression.includes('$size')) return audit.missingOrEmptyScope;
      if (expression.includes('reservationId') && expression.includes('$type')) return audit.malformedPrimary;
      if (expression.includes('reservationId') && expression.includes('$exists')) return audit.missingPrimary;
      return 0;
    },
    aggregate: () => ({ toArray: async () => audit.duplicateCompleteScopeGroups ? [{ duplicateCompleteScopeGroups: audit.duplicateCompleteScopeGroups }] : [] }),
    listIndexes: () => ({ toArray: async () => indexes.map(index => ({ ...index })) }),
    createIndex: async (key, options) => {
      created.push({ key: { ...key }, options: { ...options } });
      if (failName === options.name) throw Object.assign(new Error('stub createIndex failure'), { code: 14 });
      indexes.push({ name: options.name, key: { ...key }, ...options });
      return options.name;
    },
  };
  return collection;
}
function fakeClient(collection, versionArray = [8, 0, 37]) {
  return { db: () => ({ databaseName: 'test', admin: () => ({ command: async command => command.hello ? { setName: 'test-rs' } : { version: versionArray.join('.'), versionArray } }),
    collection: () => collection }) };
}
const allMissing = requiredAccessSessionIndexes.map(index => ({ name: index.name, key: index.key, status: 'MISSING', reason: 'NO_INDEX_WITH_KEY_PATTERN', existingNames: [] }));

test('required index specs keep both ACTIVE partial filters as objects for createIndex', () => {
  const [primary, scope] = requiredAccessSessionIndexes;
  for (const index of [primary, scope]) {
    const options = buildCreateIndexOptions(index);
    assert.equal(options.unique, true);
    assert.deepEqual(options.partialFilterExpression, { status: 'ACTIVE' });
    assert.notEqual(options.partialFilterExpression, null);
    assert.notEqual(options.partialFilterExpression, undefined);
    assert.equal('partialFilterExpression' in options, true);
  }
  assert.deepEqual(primary.key, { reservationId: 1 });
  assert.deepEqual(scope.key, { scopedReservationIds: 1 });
});

test('apply sends the exact primary and complete-scope payload to MongoDB driver and verifies each index', async () => {
  const collection = fakeCollection();
  const result = await applyMissingIndexes(collection, allMissing, { error() {} });
  assert.equal(result.writeAttempted, true);
  assert.equal(result.writeSucceeded, true);
  assert.deepEqual(result.indexesCreated, requiredAccessSessionIndexes.map(index => index.name));
  assert.deepEqual(collection.created, requiredAccessSessionIndexes.map(index => ({
    key: index.key,
    options: { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: index.name },
  })));
  for (const call of collection.created) {
    assert.notEqual(call.options.partialFilterExpression, null);
    assert.notEqual(call.options.partialFilterExpression, undefined);
  }
});

test('dry-run lists precise index plan and does not call createIndex', async () => {
  const collection = fakeCollection({ indexes: [{ name: 'reservationId_1', key: { reservationId: 1 }, unique: false }] });
  const result = await runMigration({ client: fakeClient(collection), apply: false });
  assert.equal(result.status, 'READY_FOR_MIGRATION_APPROVAL');
  assert.equal(result.writeAttempted, false);
  assert.equal(result.writeSucceeded, false);
  assert.deepEqual(collection.created, []);
  assert.deepEqual(result.createPlan, requiredAccessSessionIndexes.map(index => ({ name: index.name, key: index.key, unique: true,
    partialFilterExpression: { status: 'ACTIVE' }, compatibilityStatus: index.name.includes('reservation_unique') ? 'MISSING_COEXISTING_INDEX' : 'MISSING' })));
});

test('equivalent required indexes are not recreated and incompatible indexes block writes', async () => {
  const [primary] = requiredAccessSessionIndexes;
  const matching = requiredAccessSessionIndexes.map(index => ({ ...index }));
  const satisfiedCollection = fakeCollection({ indexes: matching });
  const satisfiedPlan = requiredAccessSessionIndexes.map(index => ({ name: index.name, key: index.key, status: 'SATISFIED', existingNames: [index.name] }));
  const satisfied = await applyMissingIndexes(satisfiedCollection, satisfiedPlan, { error() {} });
  assert.equal(satisfied.writeAttempted, false);
  assert.equal(satisfied.writeSucceeded, true);
  assert.deepEqual(satisfiedCollection.created, []);
  const incompatibleCollection = fakeCollection({ indexes: [{ name: primary.name, key: primary.key, unique: false }] });
  const blocked = await runMigration({ client: fakeClient(incompatibleCollection), apply: true });
  assert.equal(blocked.status, 'MIGRATION_BLOCKED');
  assert.equal(blocked.writeAttempted, false);
  assert.deepEqual(incompatibleCollection.created, []);
});

test('duplicate or malformed ACTIVE scopes block apply before index creation', async () => {
  const collection = fakeCollection({ audit: { ...cleanAudit, malformedScope: 1 } });
  const result = await runMigration({ client: fakeClient(collection), apply: true });
  assert.equal(result.status, 'MIGRATION_BLOCKED');
  assert.equal(result.writeAttempted, false);
  assert.deepEqual(collection.created, []);
});

test('driver failure reports verified partial progress and never reports migration success', async () => {
  const collection = fakeCollection({ failName: requiredAccessSessionIndexes[1].name });
  const logs = [];
  const result = await applyMissingIndexes(collection, allMissing, { error: value => logs.push(JSON.parse(value)) });
  assert.equal(result.writeAttempted, true);
  assert.equal(result.writeSucceeded, false);
  assert.deepEqual(result.indexesCreated, [requiredAccessSessionIndexes[0].name]);
  assert.deepEqual(result.indexOutcomes.map(row => row.status), ['CREATED_AND_VERIFIED', 'NOT_CREATED']);
  assert.equal(logs[0].status, 'MIGRATION_APPLY_FAILED');
  assert.equal(logs[0].writeSucceeded, false);
});

test('createIndex options validator rejects null or missing partial filters before a driver call', () => {
  assert.throws(() => buildCreateIndexOptions({ name: 'bad', key: { x: 1 }, unique: true, partialFilterExpression: null }), /must have an object partialFilterExpression/);
  const malformed = { ...requiredAccessSessionIndexes[0] };
  delete malformed.partialFilterExpression;
  assert.throws(() => buildCreateIndexOptions(malformed), /must have an object partialFilterExpression/);
  assert.deepEqual(createPlan(allMissing).map(row => row.partialFilterExpression), [{ status: 'ACTIVE' }, { status: 'ACTIVE' }]);
});
