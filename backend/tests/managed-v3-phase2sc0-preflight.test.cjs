const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Session = require('../dist/models/access/managed-access-session.model').default;
const { validateManagedV3FixtureSchemas } = require('./integration/helpers/managed-v3-fixture.cjs');
const { missingRequiredIndexes, sourceFingerprint, evaluateReadiness, staticSafetyChecks, writePlan } = require('../scripts/managed-v3-phase2sa-preflight.cjs');
const { classifyRequiredIndex } = require('../scripts/managed-access-index-compatibility.cjs');

const sessionIndexes = Session.schema.indexes();
const activeReservationIndex = sessionIndexes.find(([key, options]) => key.reservationId === 1 && options.unique && options.partialFilterExpression?.status === 'ACTIVE');
const activeScopeIndex = sessionIndexes.find(([key, options]) => key.scopedReservationIds === 1 && options.unique && options.partialFilterExpression?.status === 'ACTIVE');

test('ManagedAccessSession schema requires a unique partial Reservation index for ACTIVE sessions', () => {
  assert.ok(activeReservationIndex, 'schema must keep its unique partial active-session invariant');
  assert.ok(activeScopeIndex, 'schema must uniquely reserve every active Session scope member');
  const plainReservationIndex = { name: 'reservationId_1', key: { reservationId: 1 }, unique: false };
  const missing = missingRequiredIndexes([activeReservationIndex], [plainReservationIndex], [8, 0, 0]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].reason, 'MISSING_COEXISTING_INDEX');
  assert.equal(missingRequiredIndexes([activeReservationIndex], [], [8, 0, 0])[0].reason, 'MISSING');
  const exact = { name: activeReservationIndex[1].name, key: { reservationId: 1 }, unique: true, partialFilterExpression: { status: 'ACTIVE' } };
  assert.deepEqual(missingRequiredIndexes([activeReservationIndex], [plainReservationIndex, exact], [8, 0, 0]), []);
  const wrongName = { ...exact, name: 'reservationId_1_unique_active', partialFilterExpression: { status: 'REVOKED' } };
  assert.equal(missingRequiredIndexes([activeReservationIndex], [wrongName], [8, 0, 0])[0].reason, 'INCOMPATIBLE_OPTIONS');
  const wrongRequiredName = { ...exact, name: activeReservationIndex[1].name, key: { reservationId: 1 }, unique: false,
    partialFilterExpression: { status: 'REVOKED' } };
  assert.equal(missingRequiredIndexes([activeReservationIndex], [wrongRequiredName], [8, 0, 0])[0].reason, 'INCOMPATIBLE_OPTIONS');
  const requiredNameCollision = { name: activeReservationIndex[1].name, key: { unrelated: 1 }, unique: false };
  assert.equal(missingRequiredIndexes([activeReservationIndex], [requiredNameCollision], [8, 0, 0])[0].reason, 'INCOMPATIBLE_OPTIONS');
  assert.equal(missingRequiredIndexes([activeReservationIndex], [], [8, 0, 0])[0].reason, 'MISSING');
  const plainScope = { name: 'scopedReservationIds_1', key: { scopedReservationIds: 1 }, unique: false };
  const missingScope = missingRequiredIndexes([activeScopeIndex], [plainScope], [8, 0, 0]);
  assert.equal(missingScope.length, 1);
  assert.equal(missingScope[0].reason, 'MISSING_COEXISTING_INDEX');
  const exactScope = { name: activeScopeIndex[1].name, key: { scopedReservationIds: 1 }, unique: true, partialFilterExpression: { status: 'ACTIVE' } };
  assert.deepEqual(missingRequiredIndexes([activeScopeIndex], [exactScope], [8, 0, 0]), []);
  assert.equal(classifyRequiredIndex([plainReservationIndex], { name: activeReservationIndex[1].name, key: { reservationId: 1 }, unique: true,
    partialFilterExpression: { status: 'ACTIVE' } }, [4, 4, 0]).status, 'INCOMPATIBLE_OPTIONS');
});

test('write readiness is blocked by missing/incompatible indexes, active duplicates, unsafe source or IT05 mismatch', () => {
  const base = { selectedDatabase: 'test', topology: 'replicaSet', fixtureSchemaValidation: { validated: true },
    safetyChecks: [{ name: 'source', pass: true }], unknownImpacts: [], missingModels: [], it05Passed: true,
    sessionInvariant: { duplicateReservationGroups: 0, duplicateCompleteScopeGroups: 0, missingReservationIdCount: 0,
      missingOrEmptyScopeCount: 0, duplicateIdsWithinScopeCount: 0, primaryOutsideScopeCount: 0, malformedScopeElementCount: 0 } };
  const ready = evaluateReadiness(base);
  assert.equal(ready.status, 'READ_ONLY_PREFLIGHT_PASS');
  assert.equal(ready.writeApprovalReady, true);
  assert.equal(ready.approvalState, 'READY_FOR_HUMAN_APPROVAL');
  assert.equal(ready.humanApproval, 'NOT_GIVEN');
  for (const changed of [
    { indexIssues: [{ reason: 'MISSING' }] },
    { indexIssues: [{ reason: 'INCOMPATIBLE_OPTIONS' }] },
    { indexIssues: [{ reason: 'MISSING_COEXISTING_INDEX' }] },
    { sessionInvariant: { duplicateReservationGroups: 1, missingReservationIdCount: 0 } },
    { sessionInvariant: { duplicateReservationGroups: 0, duplicateCompleteScopeGroups: 1, missingReservationIdCount: 0 } },
    { sessionInvariant: { duplicateReservationGroups: 0, missingReservationIdCount: 0, missingOrEmptyScopeCount: 1 } },
    { sessionInvariant: { duplicateReservationGroups: 0, missingReservationIdCount: 0, duplicateIdsWithinScopeCount: 1 } },
    { sessionInvariant: { duplicateReservationGroups: 0, missingReservationIdCount: 0, primaryOutsideScopeCount: 1 } },
    { sessionInvariant: { duplicateReservationGroups: 0, missingReservationIdCount: 0, malformedScopeElementCount: 1 } },
    { safetyChecks: [{ name: 'source', pass: false }] },
    { it05Passed: false },
  ]) {
    const result = evaluateReadiness({ ...base, ...changed });
    assert.equal(result.status, 'READ_ONLY_PREFLIGHT_BLOCKED');
    assert.equal(result.writeApprovalReady, false);
    assert.equal(result.approvalState, 'BLOCKED');
  }
});

test('offline preflight source checks verify the current cross-Reservation IT05 and outbound API contract', () => {
  const checks = staticSafetyChecks();
  const it05 = checks.find(row => row.name === 'it05-cross-reservation-outbound-source-contract');
  assert.equal(it05?.pass, true);
  assert.equal(checks.filter(row => row.pass).length, checks.length);
  assert.match(sourceFingerprint(), /^[a-f\d]{64}$/);
  const plan1 = writePlan('MI3-PREFLIGHT-123'), plan2 = writePlan('MI3-PREFLIGHT-123');
  assert.equal(plan1.planVersion, 'WDP_MANAGED_V3_PHASE2SC2_HOTFIX_V1');
  assert.equal(plan1.planHash, plan2.planHash);
  assert.equal(plan1.sourceFingerprint, plan2.sourceFingerprint);
  const preflightSource = fs.readFileSync(path.resolve(__dirname, '../scripts/managed-v3-phase2sa-preflight.cjs'), 'utf8');
  const runnerSource = fs.readFileSync(path.resolve(__dirname, '../scripts/run-managed-v3-phase2sa-integration.ps1'), 'utf8');
  const diagnosticSource = fs.readFileSync(path.resolve(__dirname, '../scripts/managed-v3-phase2sc2-readonly-check.cjs'), 'utf8');
  assert.doesNotMatch(preflightSource + runnerSource + diagnosticSource, /\.createIndex\s*\(|syncIndexes\s*\(|\.dropIndex\s*\(/i);
  const migrationDraft = fs.readFileSync(path.resolve(__dirname, '../scripts/managed-access-session-index-migration.draft.cjs'), 'utf8');
  assert.match(migrationDraft, /process\.argv\.includes\('--apply'\)/);
  assert.match(migrationDraft, /duplicateCompleteScopeGroups/);
  assert.match(migrationDraft, /INCOMPATIBLE_OPTIONS/);
  assert.match(migrationDraft, /READY_FOR_MIGRATION_APPROVAL/);
  assert.match(migrationDraft, /\['MISSING', 'MISSING_COEXISTING_INDEX'\]/);
  assert.match(migrationDraft, /apply: process\.argv\.includes\('--apply'\)/);
  assert.doesNotMatch(migrationDraft, /syncIndexes\s*\(|\.dropIndex\s*\(/i);
});

test('fixture Mongoose schemas validate offline without database writes', async () => {
  const result = await validateManagedV3FixtureSchemas({ runId: 'MI3-PHASE2SC0-SCHEMA' });
  assert.equal(result.validated, true);
  assert.equal(result.noDatabaseWrites, true);
});
