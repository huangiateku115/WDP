const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writePlan, staticSafetyChecks } = require('../scripts/managed-v3-phase2sa-preflight.cjs');
const { scenarioIds, selectedIntegrationCaseIds, shouldRunIntegrationCase } = require('./integration/helpers/managed-v3-case-selection.cjs');

const runId = 'MI3-R3-IT02-SCOPE-TEST-0001';

test('IT02 envelope contains only its fixture rows and exact A2 service write counts', () => {
  const plan = writePlan(runId, 'IT02');
  assert.equal(plan.selectedCaseId, 'IT02');
  assert.equal(plan.scopedPlanStatus, 'VERIFIED');
  assert.deepEqual(plan.fixtures, {
    users: 3, facilities: 1, warehousezones: 1, warehouseracks: 1, warehousecells: 3,
    reservations: 2, reservationpayments: 2, contracts: 2, cellallocations: 3,
    managedinventorycategories: 1, managedinventoryquantityunits: 1, inventoryitems: 1,
    itemspecifications: 1, managedaccessvisits: 1, managedaccesssessions: 1,
  });
  assert.equal(Object.values(plan.fixtures).reduce((sum, value) => sum + value, 0), 24);
  const writes = new Map(plan.writeEnvelope.collectionWrites.map(row => [row.collection, row]));
  const counts = name => [writes.get(name).plannedInserts, writes.get(name).plannedUpdates, writes.get(name).plannedDeletes];
  assert.deepEqual(counts('itemmovements'), [1, 0, 0]);
  assert.deepEqual(counts('managedcellstocks'), [2, 0, 0]);
  assert.deepEqual(counts('managediteminstances'), [0, 0, 0]);
  assert.deepEqual(counts('warehousecells'), [3, 2, 0]);
  assert.deepEqual(counts('reservations'), [2, 2, 0]);
  assert.deepEqual(counts('managedaccesssessions'), [1, 1, 0]);
  assert.equal([...writes.values()].reduce((sum, row) => sum + Number(row.plannedInserts || 0), 0), 27);
  assert.equal([...writes.values()].reduce((sum, row) => sum + Number(row.plannedUpdates || 0), 0), 13);
  assert.equal([...writes.values()].reduce((sum, row) => sum + Number(row.plannedDeletes || 0), 0), 0);
  assert.equal(plan.sourceDerived, plan.writeEnvelope.collectionWrites);
  assert.notEqual(writePlan(runId, 'IT02').planHash, writePlan(runId, 'IT01').planHash);
});

test('IT02 selection enables only IT02; IT01 and IT03-IT10 are skipped', () => {
  assert.deepEqual(selectedIntegrationCaseIds('IT02'), ['IT02']);
  const invoked = scenarioIds.filter(caseId => shouldRunIntegrationCase(`${caseId} scenario`, { enabled: true, selectedCase: 'IT02' }));
  assert.deepEqual(invoked, ['IT02']);
  assert.equal(invoked.includes('IT01'), false);
  assert.equal(invoked.some(caseId => /^IT(?:0[3-9]|10)$/.test(caseId)), false);
});

test('preflight verifies IT02 A2 receipt, capacity and revision assertions from its source test', () => {
  const check = staticSafetyChecks().find(row => row.name === 'it02-a2-add-stock-receipt-capacity-revision-contract');
  assert.equal(check?.pass, true);
});
