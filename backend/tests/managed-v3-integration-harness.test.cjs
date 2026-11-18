const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dist = path.resolve(__dirname, '../dist');
const integrationDir = path.resolve(__dirname, 'integration');

test('IT07-IT10 service imports resolve to the real compiled service from the integration directory', () => {
  const servicePath = path.resolve(integrationDir, '../../dist/services/inventory-items/managed-unified-inbound.service.js');
  assert.equal(require.resolve(servicePath), servicePath);
  const service = require(servicePath);
  assert.equal(typeof service.ManagedUnifiedInboundService.confirm, 'function');
  assert.equal(typeof service.ManagedUnifiedInboundService.operation, 'function');
  assert.ok(dist.endsWith(`${path.sep}dist`));
});

test('IT01 exact A1 fixture payload normalizes string ObjectIds and conserves multi-Cell instance load', async () => {
  const { createManagedV3Fixture } = require('./integration/helpers/managed-v3-fixture.cjs');
  const { normalizeUnifiedInbound } = require('../dist/services/inventory-items/managed-unified-inbound.domain');
  const world = await createManagedV3Fixture({ runId: 'MI3-OFFLINE-IT01', label: 'it01-payload', persist: false });
  const request = await world.inboundRequest({ quantity: 1, allocations: [{ cellId: world.cells[0]._id, quantity: 1 }],
    instanceAllocations: [{ cellId: world.cells[0]._id, weightKg: 4, volumeM3: 0.003 }, { cellId: world.cells[1]._id, weightKg: 6, volumeM3: 0.005 }] });
  const allocations = request.body.lines[0].instanceAllocations;
  assert.ok(allocations.every(row => typeof row.cellId === 'string' && /^[a-f\d]{24}$/i.test(row.cellId)));
  const normalized = normalizeUnifiedInbound(request.body);
  assert.equal(normalized.lines[0].quantity, 1);
  assert.equal(normalized.lines[0].cellAllocations[0].quantity, 1);
  assert.equal(normalized.lines[0].instanceAllocations.length, 2);
  assert.equal(normalized.lines[0].instanceAllocations.reduce((sum, row) => sum + row.weightKg, 0), 10);
  assert.equal(normalized.lines[0].instanceAllocations.reduce((sum, row) => sum + row.volumeM3, 0), 0.008);
});

test('single-case selection is included in the reviewed plan hash', () => {
  const { writePlan } = require('../scripts/managed-v3-phase2sa-preflight.cjs');
  const all = writePlan('MI3-PLAN-SELECT-01', null);
  const one = writePlan('MI3-PLAN-SELECT-01', 'IT07');
  assert.equal(all.selectedCase, null);
  assert.equal(one.selectedCase, 'IT07');
  assert.notEqual(all.planHash, one.planHash);
  assert.throws(() => writePlan('MI3-PLAN-SELECT-01', 'IT11'), /IT01 through IT10/);
});

test('previous RunId audit remains strictly read-only and redacts personal data', async () => {
  const fs = require('node:fs');
  const auditSource = fs.readFileSync(path.resolve(__dirname, '../scripts/managed-v3-phase2sd-run-audit.cjs'), 'utf8');
  assert.doesNotMatch(auditSource, /\.insert(?:One|Many)?\s*\(|\.update(?:One|Many)?\s*\(|\.delete(?:One|Many)?\s*\(|\.createIndex\s*\(|\.drop(?:Database|Collection|Index)?\s*\(/i);
  const { auditRun } = require('../scripts/managed-v3-phase2sd-run-audit.cjs');
  const collections = { facilities: [{ _id: 'fac1', managedAccessRevision: 2 }], reservations: [{ _id: 'res1', usedCapacityM3: 0.008, allocatedCapacity: 1, inventoryVersion: 2 }],
    inventoryitems: [{ _id: 'sku1', managedV3Revision: 1 }], users: [{ _id: 'user1' }], warehouseracks: [{ _id: 'rack1', managedInventoryRevision: 1 }],
    warehousecells: [{ _id: 'cell1', usedWeightKg: 10, usedVolumeM3: 0.008, managedInventoryRevision: 1 }] };
  const db = { databaseName: 'test', collection: name => ({
    find: () => ({ toArray: async () => collections[name] ?? [] }),
  }) };
  const result = await auditRun({ client: { db: () => db }, runId: 'MI3-AUDIT-TEST-01' });
  assert.equal(result.readOnly, true);
  assert.equal(result.userDataRedacted, true);
  assert.equal(result.personalDataReturned, false);
  assert.equal(result.auditCompleteness, 'INCOMPLETE');
  assert.equal(result.inventoryConsistency, 'NOT_VERIFIED');
  assert.equal(result.verifiedRootCounts.facilities, 1);
  assert.deepEqual(result.fixtureDocumentCounts.itemmovements, 0);
  assert.equal(JSON.stringify(result).includes('email'), false);
});

test('Mongoose ordered transactional bulk-create helper forwards ordered true and the transaction session', async () => {
  const { createInTransactionOrdered } = require('../dist/services/inventory-items/managed-unified-inbound.service');
  const session = { id: 'same-transaction' };
  const calls = [];
  const model = { create: async (docs, options) => { calls.push({ docs, options }); return docs; } };
  const documents = [{ _id: 'stock-a' }, { _id: 'stock-b' }];
  await createInTransactionOrdered(model, documents, session);
  assert.deepEqual(calls, [{ docs: documents, options: { session, ordered: true } }]);
});

test('ordered bulk-create failure propagates within the transaction callback for rollback', async () => {
  const { createInTransactionOrdered } = require('../dist/services/inventory-items/managed-unified-inbound.service');
  const persisted = [];
  const session = { id: 'rollback-transaction' };
  const model = { create: async (docs, options) => {
    assert.equal(options.session, session);
    assert.equal(options.ordered, true);
    if (docs[0]._id === 'late-failure') throw new Error('injected second projection failure');
    persisted.push(...docs);
    return docs;
  } };
  const transaction = { withTransaction: async work => {
    const snapshot = [...persisted];
    try { await work(); } catch (error) { persisted.splice(0, persisted.length, ...snapshot); throw error; }
  } };
  await assert.rejects(transaction.withTransaction(async () => {
    await createInTransactionOrdered(model, [{ _id: 'stock' }], session);
    await createInTransactionOrdered(model, [{ _id: 'late-failure' }], session);
  }), /injected second projection failure/);
  assert.deepEqual(persisted, []);
});
