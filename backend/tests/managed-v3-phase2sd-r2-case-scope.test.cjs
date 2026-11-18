const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writePlan, evaluateReadiness } = require('../scripts/managed-v3-phase2sa-preflight.cjs');
const { scenarioIds, selectedIntegrationCaseIds, shouldRunIntegrationCase } = require('./integration/helpers/managed-v3-case-selection.cjs');

const runId = 'MI3-99f2f6907fdc4f34b4afcd806a2e5d8c';

test('IT01 plan contains only one scenario fixture insert envelope and reports selectedCaseId', () => {
  const plan = writePlan(runId, 'IT01');
  assert.equal(plan.selectedCaseId, 'IT01');
  assert.equal(plan.scopedPlanStatus, 'VERIFIED');
  assert.deepEqual(plan.fixtures, {
    users: 3, facilities: 1, warehousezones: 1, warehouseracks: 1, warehousecells: 3,
    reservations: 2, reservationpayments: 2, contracts: 2, cellallocations: 3,
    managedinventorycategories: 1, managedinventoryquantityunits: 1, inventoryitems: 1,
    itemspecifications: 1, managedaccessvisits: 1, managedaccesssessions: 1,
  });
  const row = name => plan.sourceDerived.find(item => item.collection === name);
  assert.deepEqual([row('itemmovements').plannedInserts, row('itemmovements').plannedUpdates, row('itemmovements').plannedDeletes], [1, 0, 0]);
  assert.deepEqual([row('managediteminstances').plannedInserts, row('managediteminstances').plannedUpdates, row('managediteminstances').plannedDeletes], [1, 0, 0]);
  assert.deepEqual([row('warehousecells').plannedInserts, row('warehousecells').plannedUpdates, row('warehousecells').plannedDeletes], [3, 2, 0]);
  assert.deepEqual([row('reservations').plannedInserts, row('reservations').plannedUpdates, row('reservations').plannedDeletes], [2, 2, 0]);
  assert.equal(Object.values(plan.fixtures).reduce((sum, count) => sum + count, 0), 24);
  assert.equal(plan.sourceDerived.reduce((sum, item) => sum + Number(item.plannedInserts || 0), 0), 26);
  assert.equal(plan.sourceDerived.reduce((sum, item) => sum + Number(item.plannedDeletes || 0), 0), 0);
  assert.notEqual(writePlan(runId, null).planHash, plan.planHash);
});

test('IT01 case selection invokes only the selected test callback where fixture setup lives', () => {
  assert.deepEqual(selectedIntegrationCaseIds('IT01'), ['IT01']);
  assert.equal(scenarioIds.length, 10);
  const fixtureSetups = [];
  for (const caseId of scenarioIds) {
    const callback = () => fixtureSetups.push(caseId);
    if (shouldRunIntegrationCase(`${caseId} scenario`, { enabled: true, selectedCase: 'IT01' })) callback();
  }
  assert.deepEqual(fixtureSetups, ['IT01']);
  assert.equal(shouldRunIntegrationCase('IT02 another scenario', { enabled: false, selectedCase: null }), false);
  assert.throws(() => selectedIntegrationCaseIds('IT11'), /IT01 through IT10/);
});

test('runner, preflight, and integration gate require the same selected CaseId and refuse unverified scoped plans', () => {
  const root = path.resolve(__dirname, '..');
  const runner = fs.readFileSync(path.join(root, 'scripts/run-managed-v3-phase2sa-integration.ps1'), 'utf8');
  const suite = fs.readFileSync(path.join(root, 'tests/integration/managed-inventory-v3-mongo-todo.test.cjs'), 'utf8');
  assert.match(runner, /MI_V3_TEST_CASE\s*=\s*\$CaseId/);
  assert.match(runner, /\$plan\.selectedCaseId\s*-ne\s*\$expectedCaseId/);
  assert.match(runner, /scopedPlanStatus\s*-ne\s*'VERIFIED'/);
  assert.match(suite, /currentPlan\.selectedCaseId !== \(process\.env\.MI_V3_TEST_CASE \|\| null\)/);
  assert.match(suite, /currentPlan\.scopedPlanStatus === 'UNVERIFIED'/);
  assert.match(suite, /\{ skip: !caseEnabled\(name\) \}, async \(\) => \{/);
});

test('selected cases without a reviewed operation envelope fail closed', () => {
  const plan = writePlan(runId, 'IT04');
  assert.equal(plan.selectedCaseId, 'IT04');
  assert.equal(plan.scopedPlanStatus, 'UNVERIFIED');
  assert.ok(plan.sourceDerived.some(row => row.plannedUpdates === 'UNKNOWN'));
  const readiness = evaluateReadiness({ selectedDatabase: 'test', topology: 'replicaSet', fixtureSchemaValidation: { validated: true },
    safetyChecks: [{ name: 'safe', pass: true }], unknownImpacts: [{ collection: 'case' }], missingModels: [], it05Passed: true });
  assert.equal(readiness.writeApprovalReady, false);
  assert.equal(readiness.approvalState, 'BLOCKED');
});

test('seven expired ACTIVE Sessions alone do not overlap IT01 fresh fixture Reservation IDs', () => {
  const { readFileSync } = fs;
  const sessionSchema = readFileSync(path.resolve(__dirname, '../src/models/access/managed-access-session.model.ts'), 'utf8');
  const fixtureSource = readFileSync(path.resolve(__dirname, 'integration/helpers/managed-v3-fixture.cjs'), 'utf8');
  assert.match(sessionSchema, /partialFilterExpression:\s*\{\s*status:\s*ManagedAccessSessionStatus\.ACTIVE\s*\}/);
  assert.match(fixtureSource, /new Reservation\(/);
  assert.match(fixtureSource, /const reservations = \[\]/);
  const readiness = evaluateReadiness({ selectedDatabase: 'test', topology: 'replicaSet', fixtureSchemaValidation: { validated: true },
    safetyChecks: [{ name: 'safe', pass: true }], missingModels: [], it05Passed: true,
    sessionInvariant: { expiredStillActiveCount: 7, duplicateReservationGroups: 0, duplicateCompleteScopeGroups: 0 } });
  assert.equal(readiness.writeApprovalReady, true);
});
