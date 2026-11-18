const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writePlan, staticSafetyChecks } = require('../scripts/managed-v3-phase2sa-preflight.cjs');
const { scenarioIds, selectedIntegrationCaseIds, shouldRunIntegrationCase } = require('./integration/helpers/managed-v3-case-selection.cjs');

const runId = 'MI3-R4-IT03-SCOPE-TEST-0001';

test('IT03 write envelope includes fixture, inbound, partial/full outbound, and zero-lot deletes', () => {
  const plan = writePlan(runId, 'IT03');
  assert.equal(plan.selectedCaseId, 'IT03');
  assert.equal(plan.scopedPlanStatus, 'VERIFIED');
  assert.deepEqual(plan.fixtures, {
    users: 3, facilities: 1, warehousezones: 1, warehouseracks: 1, warehousecells: 3,
    reservations: 2, reservationpayments: 2, contracts: 2, cellallocations: 3,
    managedinventorycategories: 1, managedinventoryquantityunits: 1, inventoryitems: 1,
    itemspecifications: 1, managedaccessvisits: 3, managedaccesssessions: 3,
  });
  assert.equal(Object.values(plan.fixtures).reduce((sum, count) => sum + count, 0), 28);
  const writes = new Map(plan.writeEnvelope.collectionWrites.map(row => [row.collection, row]));
  const counts = name => [writes.get(name).plannedInserts, writes.get(name).plannedUpdates, writes.get(name).plannedDeletes];
  assert.deepEqual(counts('itemmovements'), [3, 0, 0]);
  assert.deepEqual(counts('managedcellstocks'), [2, 1, 2]);
  assert.deepEqual(counts('managediteminstances'), [0, 0, 0]);
  assert.deepEqual(counts('managedaccessvisits'), [3, 0, 0]);
  assert.deepEqual(counts('managedaccesssessions'), [3, 5, 0]);
  assert.deepEqual(counts('warehousecells'), [3, 5, 0]);
  assert.deepEqual(counts('reservations'), [2, 6, 0]);
  assert.equal([...writes.values()].reduce((sum, row) => sum + Number(row.plannedInserts || 0), 0), 33);
  assert.equal([...writes.values()].reduce((sum, row) => sum + Number(row.plannedUpdates || 0), 0), 41);
  assert.equal([...writes.values()].reduce((sum, row) => sum + Number(row.plannedDeletes || 0), 0), 2);
  assert.match(writes.get('managedcellstocks').risk, /zero|zeroed|transactionally/i);
  assert.notEqual(plan.planHash, writePlan(runId, 'IT02').planHash);
  assert.notEqual(plan.planHash, writePlan(runId, null).planHash);
});

test('CaseId IT03 executes only IT03 fixture setup and all other cases skip', () => {
  assert.deepEqual(selectedIntegrationCaseIds('IT03'), ['IT03']);
  const invoked = scenarioIds.filter(caseId => shouldRunIntegrationCase(`${caseId} scoped test`, { enabled: true, selectedCase: 'IT03' }));
  assert.deepEqual(invoked, ['IT03']);
  const suite = fs.readFileSync(path.resolve(__dirname, 'integration/managed-inventory-v3-mongo-todo.test.cjs'), 'utf8');
  const start = suite.indexOf('IT03 partial and full Outbound');
  const end = suite.indexOf('IT04 same-Reservation', start);
  assert.ok(start >= 0 && end > start);
  assert.match(suite.slice(start, end), /fixture\('it03'\)/);
});

test('IT03 static preflight contract verifies REMOVE, FIFO, capacity fences and zero-lot deletion', () => {
  const check = staticSafetyChecks().find(row => row.name === 'it03-partial-full-remove-fifo-capacity-revision-contract');
  assert.equal(check?.pass, true);
});

test('IT04 and later remain unverified and cannot receive a scoped approval-ready envelope', () => {
  const plan = writePlan(runId, 'IT04');
  assert.equal(plan.scopedPlanStatus, 'UNVERIFIED');
  assert.ok(plan.sourceDerived.some(row => row.plannedUpdates === 'UNKNOWN'));
});

test('IT03 source preserves transactions, idempotency, access validation, and production inbound guard', () => {
  const root = path.resolve(__dirname, '..');
  const outbound = fs.readFileSync(path.join(root, 'src/services/inventory-items/managed-inventory-v3-outbound.service.ts'), 'utf8');
  const inbound = fs.readFileSync(path.join(root, 'src/services/inventory-items/managed-unified-inbound.service.ts'), 'utf8');
  assert.match(outbound, /withTransaction\(async session/);
  assert.match(outbound, /findDirectReplay/);
  assert.match(outbound, /assertManagedAccessSessionScope/);
  assert.match(inbound, /process\.env\.NODE_ENV\s*===\s*'production'\)\s*fail\(503,\s*'INBOUND_CONFIRM_ENVIRONMENT_BLOCKED'/);
});
