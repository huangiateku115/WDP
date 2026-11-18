/* Read-only preflight and source-derived MongoDB write plan for Phase 2S-A. */
require('dotenv').config({ quiet: true });
const { createHash } = require('node:crypto');
const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { validateManagedV3FixtureSchemas } = require('../tests/integration/helpers/managed-v3-fixture.cjs');
const { classifyRequiredIndex } = require('./managed-access-index-compatibility.cjs');

const modelPaths = [
  'models/users/user.model', 'models/facilities/facility.model', 'models/warehouse-map/warehouse-zone.model',
  'models/warehouse-map/warehouse-rack.model', 'models/warehouse-map/warehouse-cell.model', 'models/warehouse-map/cell-allocation.model',
  'models/reservations/reservation.model', 'models/inventory-items/inventory-item.model', 'models/inventory-items/item-specification.model',
  'models/inventory-items/managed-inventory-category.model', 'models/inventory-items/managed-inventory-quantity-unit.model',
  'models/payments/reservation-payment.model', 'models/contracts/contract.model', 'models/access/managed-access-visit.model',
  'models/access/managed-access-session.model', 'models/inventory-items/item-movement.model',
  'models/inventory-items/managed-cell-stock.model', 'models/inventory-items/managed-item-instance.model',
  'models/inventory-items/managed-v3-stock-projection.model', 'models/inventory-items/managed-v3-batch-placement.model',
  'models/inventory-items/managed-v3-physical-unit.model', 'models/inventory-items/managed-v3-footprint.model',
  'models/inventory-items/inventory-stock-balance.model', 'models/inventory-items/managed-outbound-request.model',
  'models/inventory-items/inventory-inbound-request.model',
];
const models = modelPaths.map(path => require(`../dist/${path}`).default);
const secretSafe = error => ({ name: error?.name || 'Error', code: error?.code || null,
  message: String(error?.message || 'Unknown error').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI REDACTED]') });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const orderedKeyJson = value => JSON.stringify(Object.entries(value ?? {}));

function missingRequiredIndexes(expectedIndexes, existingIndexes, serverVersionArray = []) {
  return expectedIndexes.flatMap(([key, options = {}]) => {
    const required = { name: options.name ?? null, key, unique: Boolean(options.unique), partialFilterExpression: options.partialFilterExpression ?? null,
      sparse: Boolean(options.sparse), expireAfterSeconds: options.expireAfterSeconds ?? null, collation: options.collation ?? null };
    const classification = classifyRequiredIndex(existingIndexes, required, serverVersionArray);
    if (classification.status === 'SATISFIED') return [];
    const samePattern = existingIndexes.filter(index => orderedKeyJson(index.key) === orderedKeyJson(key));
    return [{ name: required.name, key, unique: required.unique, partialFilterExpression: required.partialFilterExpression,
      reason: classification.status,
      classificationReason: classification.reason,
      existingIndexes: samePattern.map(index => ({ name: index.name, unique: Boolean(index.unique),
        partialFilterExpression: index.partialFilterExpression ?? null, sparse: Boolean(index.sparse),
        expireAfterSeconds: index.expireAfterSeconds ?? null, collation: index.collation ?? null })) }];
  });
}

function sourceFingerprint() {
  const paths = ['../src/services/inventory-items/managed-unified-inbound.service.ts',
    '../src/services/inventory-items/managed-inventory-v3-outbound.service.ts',
    '../src/services/inventory-items/managed-inventory-v3-relocation.service.ts',
    '../src/controllers/inventory-items/managed-inventory-v3-outbound.controller.ts',
    '../src/models/access/managed-access-visit.model.ts', '../src/models/access/managed-access-session.model.ts', '../src/services/access/managed-access.service.ts',
    '../scripts/managed-v3-phase2sc2-readonly-check.cjs', '../scripts/managed-access-session-index-migration.draft.cjs',
    '../scripts/managed-v3-phase2sd-run-audit.cjs',
    '../scripts/managed-access-index-compatibility.cjs',
    '../scripts/managed-v3-phase2sa-preflight.cjs', '../scripts/run-managed-v3-phase2sa-integration.ps1',
    '../tests/managed-access-session-scope.test.cjs', '../tests/managed-v3-integration-harness.test.cjs',
    '../tests/managed-v3-phase2sd-audit.test.cjs',
    '../tests/managed-v3-phase2sd-r2-case-scope.test.cjs',
    '../tests/managed-v3-phase2sd-r3-it02-scope.test.cjs',
    '../tests/managed-v3-phase2sd-r4-it03-scope.test.cjs',
    '../tests/managed-v3-phase2sc0-preflight.test.cjs',
    '../tests/integration/helpers/managed-v3-fixture.cjs', '../tests/integration/helpers/managed-v3-case-selection.cjs',
    '../tests/integration/managed-inventory-v3-mongo-todo.test.cjs'];
  return createHash('sha256').update(paths.map(relative => `${relative}\0${fs.readFileSync(path.resolve(__dirname, relative))}`).join('\0')).digest('hex');
}

function writePlan(inputRunId, inputSelectedCase = process.env.MI_V3_TEST_CASE || null) {
  const selectedCase = inputSelectedCase || null;
  if (selectedCase && !/^IT(?:0[1-9]|10)$/.test(selectedCase)) throw new Error('MI_V3_TEST_CASE must be one of IT01 through IT10.');
  const runId = inputRunId || process.argv[2] || `MI3-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
  const fullSuiteFixture = {
    users: 30, facilities: 10, warehousezones: 10, warehouseracks: 10, warehousecells: 30,
    reservations: 20, reservationpayments: 20, contracts: 20, cellallocations: 30,
    managedinventorycategories: 10, managedinventoryquantityunits: 10, inventoryitems: 10,
    itemspecifications: 10, managedaccessvisits: 23, managedaccesssessions: 23,
  };
  const singleScenarioFixture = {
    users: 3, facilities: 1, warehousezones: 1, warehouseracks: 1, warehousecells: 3,
    reservations: 2, reservationpayments: 2, contracts: 2, cellallocations: 3,
    managedinventorycategories: 1, managedinventoryquantityunits: 1, inventoryitems: 1, itemspecifications: 1,
  };
  const fixture = selectedCase
    ? { ...singleScenarioFixture, managedaccessvisits: ['IT01', 'IT02'].includes(selectedCase) ? 1 : selectedCase === 'IT03' ? 3 : 'UNKNOWN',
      managedaccesssessions: ['IT01', 'IT02'].includes(selectedCase) ? 1 : selectedCase === 'IT03' ? 3 : 'UNKNOWN' }
    : fullSuiteFixture;
  const modelsByCollection = new Map(models.map(model => [model.collection.collectionName, model]));
  const fixtureScope = selectedCase ? `Fresh run-owned ObjectIds; selected scenario ${selectedCase} only` : 'Fresh run-owned ObjectIds; full ten-scenario suite';
  const sourceDerived = Object.entries(fixture).map(([collection, inserts]) => ({ collection, plannedInserts: inserts, plannedUpdates: 0, plannedDeletes: 0,
    scope: fixtureScope, risk: 'Fixture insert only; no cleanup' }));
  const fullSuiteUpdatePlan = {
    itemmovements: { plannedInserts: 13, plannedUpdates: 0, plannedDeletes: 0, scope: 'New SKU + unique run-owned idempotency keys', risk: 'Includes the committed IT05 REMOVE from Reservation B; all records are schema-v4 ADD/REMOVE/MOVE' },
    managedcellstocks: { plannedInserts: 13, plannedUpdates: 5, plannedDeletes: 3, scope: 'New SKU/Reservation/receipt/Cell keys only', risk: 'Includes IT05 partial B removal; deletes are only zeroed test-owned lots from full Outbound or full MOVE' },
    managediteminstances: { plannedInserts: 1, plannedUpdates: 0, plannedDeletes: 0, scope: 'One run-owned A1 unit', risk: 'A1 unit remains placed; no other scenario uses A1' },
    facilities: { plannedUpdates: 13, scope: 'Only ten new Facility IDs', risk: 'One managedAccessRevision fence per successful transactional operation, including IT05 REMOVE' },
    warehousecells: { plannedUpdates: 24, scope: 'Only the ten new Facility IDs', risk: '23 committed counter/revision writes plus one IT08 capacity-precondition mutation' },
    warehouseracks: { plannedUpdates: 13, scope: 'Only the ten new Facility IDs', risk: 'Expected capacity revision writes in committed service operations, including IT05 REMOVE' },
    reservations: { plannedUpdates: 30, scope: 'Only twenty new Reservation IDs', risk: '29 committed access/capacity fences plus one IT08 capacity-precondition mutation' },
    inventoryitems: { plannedUpdates: 13, scope: 'Only ten new SKU IDs', risk: 'One revision compare-and-set per committed stock operation' },
    itemspecifications: { plannedUpdates: 13, scope: 'Only ten new Specification IDs', risk: 'One inboundRevision fence per committed stock operation' },
    managedaccesssessions: { plannedUpdates: 33, scope: 'Only run-owned Session IDs', risk: '13 commit fences + 14 fixture session revocations + 6 security fixture mutations' },
    reservationpayments: { plannedUpdates: 15, scope: 'Only run-owned full-rent payment IDs', risk: 'Access fences: 13 primary plus 2 cross-Reservation target checks' },
    contracts: { plannedUpdates: 15, scope: 'Only run-owned Contract IDs', risk: 'Access fences: 13 primary plus 2 cross-Reservation target checks' },
    cellallocations: { plannedUpdates: 27, scope: 'Only run-owned Reservation/Cell pairs', risk: 'Access scope updates 27 allocation documents across the planned operations' },
  };
  const it01UpdatePlan = {
    itemmovements: { plannedInserts: 1, plannedUpdates: 0, plannedDeletes: 0, scope: 'One ADD Movement for the selected run-owned IT01 SKU', risk: 'Single transactional A1 inbound ledger event' },
    managediteminstances: { plannedInserts: 1, plannedUpdates: 0, plannedDeletes: 0, scope: 'One A1 unit for the selected run-owned IT01 SKU', risk: 'Single quantity-one physical instance' },
    managedcellstocks: { plannedInserts: 0, plannedUpdates: 0, plannedDeletes: 0, scope: 'IT01 A1 path does not create A2 Cell Stock rows', risk: 'No Cell Stock row write expected' },
    managedaccesssessions: { plannedUpdates: 1, plannedDeletes: 0, scope: 'One newly created IT01 Session only', risk: 'One transactional session revision fence' },
    facilities: { plannedUpdates: 1, scope: 'The one new IT01 Facility ID only', risk: 'One access revision fence' },
    reservations: { plannedUpdates: 2, scope: 'The primary IT01 Reservation only', risk: 'One access revision fence and one inventory capacity/revision fence' },
    reservationpayments: { plannedUpdates: 1, scope: 'The primary IT01 full-rent Payment only', risk: 'One access verification revision fence' },
    contracts: { plannedUpdates: 1, scope: 'The primary IT01 signed Contract only', risk: 'One access verification revision fence' },
    cellallocations: { plannedUpdates: 2, scope: 'The two occupied Cells allocated to the primary IT01 Reservation', risk: 'Access-scope revision fences only; fixture rows are already OCCUPIED' },
    warehousecells: { plannedUpdates: 2, scope: 'The two IT01 Cells carrying the A1 instance load', risk: 'One capacity/revision update per allocated instance Cell' },
    warehouseracks: { plannedUpdates: 1, scope: 'The single IT01 Rack containing both A1 Cells', risk: 'One Rack capacity revision fence' },
    inventoryitems: { plannedUpdates: 1, scope: 'The one new IT01 SKU only', risk: 'One SKU revision compare-and-set' },
    itemspecifications: { plannedUpdates: 1, scope: 'The one new IT01 Specification only', risk: 'One inbound revision fence' },
  };
  const it02UpdatePlan = {
    itemmovements: { plannedInserts: 1, plannedUpdates: 0, plannedDeletes: 0, scope: 'One ADD Movement for the selected run-owned IT02 SKU', risk: 'One transactional A2 inbound ledger event, quantity 10' },
    managedcellstocks: { plannedInserts: 2, plannedUpdates: 0, plannedDeletes: 0, scope: 'Two receipt lots for the two IT02 destination Cells', risk: '6 and 4 units, one shared receipt ID, ledger revision 1' },
    managediteminstances: { plannedInserts: 0, plannedUpdates: 0, plannedDeletes: 0, scope: 'IT02 is the A2 quantity/batch path', risk: 'No A1 physical instance expected' },
    managedaccesssessions: { plannedUpdates: 1, plannedDeletes: 0, scope: 'One newly created IT02 Session only', risk: 'One transactional session revision fence' },
    facilities: { plannedUpdates: 1, scope: 'The one new IT02 Facility ID only', risk: 'One access revision fence' },
    reservations: { plannedUpdates: 2, scope: 'The primary IT02 Reservation only', risk: 'One access revision fence and one inbound capacity/revision fence' },
    reservationpayments: { plannedUpdates: 1, scope: 'The primary IT02 full-rent Payment only', risk: 'One access verification revision fence' },
    contracts: { plannedUpdates: 1, scope: 'The primary IT02 signed Contract only', risk: 'One access verification revision fence' },
    cellallocations: { plannedUpdates: 2, scope: 'The two occupied Cells allocated to the primary IT02 Reservation', risk: 'Access-scope revision fences only; fixture rows are already OCCUPIED' },
    warehousecells: { plannedUpdates: 2, scope: 'The two IT02 Cells receiving the 6/4 quantity split', risk: 'One load/capacity revision update per destination Cell' },
    warehouseracks: { plannedUpdates: 1, scope: 'The single IT02 Rack containing both destination Cells', risk: 'One Rack capacity revision fence' },
    inventoryitems: { plannedUpdates: 1, scope: 'The one new IT02 SKU only', risk: 'One SKU revision compare-and-set' },
    itemspecifications: { plannedUpdates: 1, scope: 'The one new IT02 Specification only', risk: 'One inbound revision fence' },
  };
  const it03UpdatePlan = {
    itemmovements: { plannedInserts: 3, plannedUpdates: 0, plannedDeletes: 0, scope: 'One run-owned IT03 SKU: one A2 ADD and two REMOVE movements (partial 3, full 7)', risk: 'Committed movements retain ADD/REMOVE ledger revisions 1/2/3 and source receipt lineage' },
    managedcellstocks: { plannedInserts: 2, plannedUpdates: 1, plannedDeletes: 2, scope: 'Two A2 receipt/Cell lots; one partial lot update then both lots deleted at zero', risk: 'Deletes are precisely the two IT03 run-owned lots and occur transactionally' },
    managediteminstances: { plannedInserts: 0, plannedUpdates: 0, plannedDeletes: 0, scope: 'IT03 is A2 quantity stock', risk: 'No Item Instance writes expected' },
    managedaccessvisits: { plannedInserts: 3, plannedUpdates: 0, plannedDeletes: 0, scope: 'One INBOUND and two OUTBOUND visits for the IT03 Reservation', risk: 'Run-owned access fixture documents only' },
    managedaccesssessions: { plannedInserts: 3, plannedUpdates: 5, plannedDeletes: 0, scope: 'Three Session inserts; 3 service revision fences and 2 fixture revocations', risk: 'Only IT03 sessions; final outbound session remains ACTIVE' },
    facilities: { plannedUpdates: 3, scope: 'Only the new IT03 Facility', risk: 'One access revision fence per committed operation' },
    reservations: { plannedUpdates: 6, scope: 'Only the primary IT03 Reservation', risk: 'Three access fences and three capacity/version writes (inbound + two outbound)' },
    reservationpayments: { plannedUpdates: 3, scope: 'Only the primary IT03 full-rent Payment', risk: 'Access verification revision fences for three operations' },
    contracts: { plannedUpdates: 3, scope: 'Only the primary IT03 signed Contract', risk: 'Access verification revision fences for three operations' },
    cellallocations: { plannedUpdates: 6, scope: 'Two occupied Cells for the primary IT03 Reservation across three operations', risk: 'Access scope revision fences only' },
    warehousecells: { plannedUpdates: 5, scope: 'Two inbound Cells; partial removal touches one; full removal touches both', risk: 'Counter/revision writes release precisely 10 kg / 0.08 m3' },
    warehouseracks: { plannedUpdates: 3, scope: 'Single IT03 Rack', risk: 'One capacity revision fence per operation' },
    inventoryitems: { plannedUpdates: 3, scope: 'One IT03 SKU', risk: 'One SKU revision compare-and-set per committed operation' },
    itemspecifications: { plannedUpdates: 3, scope: 'One IT03 Specification', risk: 'One specification revision fence per committed operation' },
  };
  const scopedPlanStatus = !selectedCase ? 'FULL_SUITE' : ['IT01', 'IT02', 'IT03'].includes(selectedCase) ? 'VERIFIED' : 'UNVERIFIED';
  const updatePlan = !selectedCase ? fullSuiteUpdatePlan : selectedCase === 'IT01' ? it01UpdatePlan : selectedCase === 'IT02' ? it02UpdatePlan : selectedCase === 'IT03' ? it03UpdatePlan : Object.fromEntries(
    Object.keys(fullSuiteUpdatePlan).map(collection => [collection, { plannedUpdates: 'UNKNOWN', scope: `Selected ${selectedCase} only`, risk: 'Case-specific write envelope has not been verified; Write Mode must remain blocked' }]));
  const rowsByName = new Map(sourceDerived.map(row => [row.collection, row]));
  for (const [collection, changes] of Object.entries(updatePlan)) {
    const existing = rowsByName.get(collection);
    if (existing) Object.assign(existing, changes);
    else { const row = { collection, plannedInserts: 0, plannedUpdates: 0, plannedDeletes: 0, scope: '', risk: '' }; Object.assign(row, changes); sourceDerived.push(row); rowsByName.set(collection, row); }
  }
  for (const collection of ['managedv3stockprojections', 'managedv3batchplacements', 'managedv3physicalunits', 'managedv3footprints',
    'inventorystockbalances', 'managedoutboundrequests', 'inventoryinboundrequests']) {
    if (!rowsByName.has(collection)) sourceDerived.push({ collection, plannedInserts: 0, plannedUpdates: 0, plannedDeletes: 0,
      scope: 'Read-only reconciliation / legacy unresolved-request query', risk: 'No write expected from this suite' });
  }
  const missingModels = [...new Set(sourceDerived.map(row => row.collection))].filter(name => !modelsByCollection.has(name));
  const writeEnvelope = { collectionWrites: sourceDerived };
  const normalizedPlan = { planVersion: 'WDP_MANAGED_V3_PHASE2SD_R4_IT03_CASE_SCOPE_V1', sourceFingerprint: sourceFingerprint(), runId,
    selectedCase, selectedCaseId: selectedCase, scopedPlanStatus, database: 'test', fixtures: fixture, sourceDerived, writeEnvelope, missingModels };
  const planHash = createHash('sha256').update(JSON.stringify(canonical(normalizedPlan))).digest('hex');
  return { ...normalizedPlan, planHash };
}

function staticSafetyChecks() {
  const read = relative => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
  const inbound = read('../src/services/inventory-items/managed-unified-inbound.service.ts');
  const outbound = read('../src/services/inventory-items/managed-inventory-v3-outbound.service.ts');
  const relocation = read('../src/services/inventory-items/managed-inventory-v3-relocation.service.ts');
  const accessSessionModel = read('../src/models/access/managed-access-session.model.ts');
  const accessVisitModel = read('../src/models/access/managed-access-visit.model.ts');
  const accessService = read('../src/services/access/managed-access.service.ts');
  const fixture = read('../tests/integration/helpers/managed-v3-fixture.cjs');
  const suite = read('../tests/integration/managed-inventory-v3-mongo-todo.test.cjs');
  const controller = read('../src/controllers/inventory-items/managed-inventory-v3-outbound.controller.ts');
  const runnerSources = [fixture, suite];
  const it05Start = suite.indexOf("IT05 ADD 10, MOVE 6 from A to B, then REMOVE 3 from B");
  const it06Start = suite.indexOf('IT06 controlled replica-set transaction rollback primitive', it05Start);
  const it05 = it05Start >= 0 && it06Start > it05Start ? suite.slice(it05Start, it06Start) : '';
  const it02Start = suite.indexOf('IT02 Inbound A2 persists ten units, ADD ledger lines, Cell Stock and Cell capacity');
  const it03Start = suite.indexOf('IT03 partial and full Outbound', it02Start);
  const it02 = it02Start >= 0 && it03Start > it02Start ? suite.slice(it02Start, it03Start) : '';
  const outboundContractPass = /reservationId\?: string/.test(outbound) && /candidate\.reservationId/.test(outbound) &&
    /validateDirectOutboundReservationScope\(sku, reservation, actor/.test(outbound) &&
    /service\.preview\(routeSkuId\(req\), req\.body/.test(controller) && /service\.confirm\([^\n]*r\.body/.test(controller);
  const it05Pass = outboundContractPass && /before\[String\(world\.reservations\[0\]._id\)\], 4\)/.test(it05) &&
    /after\[String\(world\.reservations\[0\]._id\)\], 4\)/.test(it05) &&
    /after\[String\(world\.reservations\[1\]._id\)\], 3\)/.test(it05) && /reduce\(\(a, b\) => a \+ b, 0\), 7\)/.test(it05) &&
    /stockEffect\.action === 'ADD'/.test(it05) && /stockEffect\.action === 'MOVE'/.test(it05) && /stockEffect\.action === 'REMOVE'/.test(it05) &&
    !/CELL_NOT_ALLOCATED/.test(it05);
  const it02Pass = /world\.inbound\(\{ quantity: 10 \}\)/.test(it02) && /movements\[0\]\.stockEffect\.action, 'ADD'/.test(it02) &&
    /stock\.length, 2/.test(it02) && /new Set\(stock\.map\(row => row\.receiptId\)\)\.size, 1/.test(it02) &&
    /row\.receiptId, destination\.receiptId/.test(it02) && /row\.quantityOnHand, destination\.quantity/.test(it02) &&
    /reservation\.usedCapacityM3, 0\.08/.test(it02) && /reservation\.inventoryVersion, 1/.test(it02) &&
    /managedV3Revision, 1/.test(it02) && /inboundRevision, 1/.test(it02) && /managedInventoryRevision, 1/.test(it02);
  const it03CaseStart = suite.indexOf('IT03 partial and full Outbound');
  const it04Start = suite.indexOf('IT04 same-Reservation', it03CaseStart);
  const it03 = it03CaseStart >= 0 && it04Start > it03CaseStart ? suite.slice(it03CaseStart, it04Start) : '';
  const it03Pass = /world\.inbound\(\{ quantity: 10 \}\)/.test(it03) && /world\.outbound\(3\)/.test(it03) && /world\.outbound\(7\)/.test(it03) &&
    /partialStock\.reduce\(\(n, row\) => n \+ row\.quantityOnHand, 0\), 7\)/.test(it03) &&
    /partialStock\.reduce\(\(n, row\) => n \+ row\.totalWeightKg, 0\), 70\)/.test(it03) &&
    /stockEffect\.action === 'REMOVE'/.test(it03) && /remaining\.length, 0/.test(it03) &&
    /usedWeightKg, 0/.test(it03) && /usedVolumeM3, 0/.test(it03) && /after === 0/.test(outbound) &&
    /CellStock\.deleteOne\(/.test(outbound) && /CellStock\.updateOne\(/.test(outbound) &&
    /managedInventoryRevision: current\.managedInventoryRevision/.test(outbound) && /inventoryVersion: scope\.reservation\.inventoryVersion/.test(outbound) &&
    /assertManagedAccessSessionScope/.test(outbound) && /receiptOrder/.test(outbound);
  const checks = [
    { name: 'unique-test-facility-per-case', pass: /create\(Facility,/.test(fixture) && !/Facility\.findOne\(/.test(fixture) },
    { name: 'facility-scoped-inbound-reconciliation', pass: /readManagedFacilityStockState\(facilityId/.test(inbound) && /r\.Cell\.find\(\{ facilityId/.test(inbound) && /r\.Movement\.find\(\{ facilityId/.test(inbound) },
    { name: 'outbound-facility-fence', pass: /readManagedFacilityStockState\(sku\.facilityId/.test(outbound) && /facilityId: scope\.sku\.facilityId/.test(outbound) },
    { name: 'relocation-facility-fence', pass: /readManagedFacilityStockState\(sku\.facilityId/.test(relocation) && /facilityId: scope\.sku\.facilityId/.test(relocation) },
    { name: 'no-cleanup-or-drop', pass: runnerSources.every(text => !/dropDatabase|dropCollection|deleteMany\s*\(|deleteOne\s*\(|\.drop\s*\(/i.test(text)) },
    { name: 'no-payments-provider-or-server-start', pass: !/payos-payment|PayOS\s*\(/i.test(suite) && !/server\.listen|node-cron|scheduleJob/i.test(suite) },
    { name: 'production-inbound-guard-present', pass: /process\.env\.NODE_ENV\s*===\s*'production'\)\s*fail\(503,\s*'INBOUND_CONFIRM_ENVIRONMENT_BLOCKED'/.test(inbound) },
    { name: 'write-default-off', pass: /MI_V3_RUN_MONGODB_TESTS\s*===\s*'YES'/.test(suite) && /autoIndex:\s*false/.test(suite) && /autoCreate:\s*false/.test(suite) },
    { name: 'access-session-unique-reservation-invariant', pass: /schema\.index\(\{\s*reservationId:\s*1\s*\},\s*\{\s*unique:\s*true,\s*partialFilterExpression:\s*\{\s*status:\s*ManagedAccessSessionStatus\.ACTIVE/s.test(accessSessionModel) &&
      /schema\.index\(\{\s*scopedReservationIds:\s*1\s*\},\s*\{\s*unique:\s*true,\s*partialFilterExpression:\s*\{\s*status:\s*ManagedAccessSessionStatus\.ACTIVE/s.test(accessSessionModel) &&
      /activeSessionScopeFilter\(scopedReservationIds, activationAt\)/.test(accessService) && /scopedReservationIds: \{ \$in: reservationIds \}/.test(accessService) && /error\?\.code === 11000/.test(accessService) &&
      /scopedReservationIds must contain unique Reservation IDs including reservationId/.test(accessSessionModel) &&
      /scopedReservationIds must contain unique Reservation IDs including reservationId/.test(accessVisitModel) &&
      /normalizedReservationScope\(reservation\._id, currentVisit\.scopedReservationIds/.test(accessService) },
    { name: 'it05-cross-reservation-outbound-source-contract', pass: it05Pass },
    { name: 'it02-a2-add-stock-receipt-capacity-revision-contract', pass: it02Pass },
    { name: 'it03-partial-full-remove-fifo-capacity-revision-contract', pass: it03Pass },
  ];
  return checks;
}

function evaluateReadiness({ selectedDatabase, topology, missingCollections = [], indexIssues = [], sessionInvariant = {}, fixtureSchemaValidation = {},
  safetyChecks = [], unknownImpacts = [], missingModels = [], it05Passed = false }) {
  const blockers = [
    ...(selectedDatabase !== 'test' ? ['Configured target database is not the approved database test.'] : []),
    ...(topology !== 'replicaSet' ? ['Replica-set transactions are unavailable.'] : []),
    ...(missingCollections.length ? ['Required collections are missing; preflight does not create them.'] : []),
    ...(indexIssues.length ? ['Required indexes are missing or incompatible; preflight does not create indexes.'] : []),
    ...(sessionInvariant.duplicateReservationGroups > 0 ? ['Multiple ACTIVE Access Sessions exist for at least one Reservation; resolve data before creating the required unique partial index.'] : []),
    ...(sessionInvariant.missingReservationIdCount > 0 ? ['ACTIVE Access Sessions without reservationId prevent safe unique-index creation.'] : []),
    ...(sessionInvariant.malformedPrimaryCount > 0 ? ['ACTIVE Access Sessions have malformed primary Reservation IDs.'] : []),
    ...(sessionInvariant.missingOrEmptyScopeCount > 0 ? ['ACTIVE Access Sessions have missing or empty scopedReservationIds.'] : []),
    ...(sessionInvariant.duplicateIdsWithinScopeCount > 0 ? ['ACTIVE Access Session scope contains duplicate Reservation IDs.'] : []),
    ...(sessionInvariant.primaryOutsideScopeCount > 0 ? ['ACTIVE Access Session primary Reservation is outside its complete scope.'] : []),
    ...(sessionInvariant.malformedScopeElementCount > 0 ? ['ACTIVE Access Session scope contains malformed Reservation IDs.'] : []),
    ...(sessionInvariant.duplicateCompleteScopeGroups > 0 ? ['ACTIVE Access Sessions overlap on complete Reservation scope.'] : []),
    ...(fixtureSchemaValidation.validated !== true ? ['Offline fixture schema validation did not pass.'] : []),
    ...(unknownImpacts.length ? ['Exact durable service update counts are UNKNOWN until database integration runs; write mode remains blocked.'] : []),
    ...(missingModels.length ? ['Write plan references collections without loaded Mongoose models.'] : []),
    ...(safetyChecks.some(row => !row.pass) ? ['One or more static source-scope/safety checks failed.'] : []),
    ...(!it05Passed ? ['IT05 source/API contract no longer matches the cross-Reservation outbound acceptance test.'] : []),
    ...(safetyChecks.some(row => row.name === 'it03-partial-full-remove-fifo-capacity-revision-contract' && !row.pass) ? ['IT03 Outbound source/test contract could not be verified.'] : []),
  ];
  const technicalReady = blockers.length === 0;
  return { status: technicalReady ? 'READ_ONLY_PREFLIGHT_PASS' : 'READ_ONLY_PREFLIGHT_BLOCKED',
    writeApprovalReady: technicalReady, approvalState: technicalReady ? 'READY_FOR_HUMAN_APPROVAL' : 'BLOCKED',
    humanApproval: 'NOT_GIVEN', blockers };
}

async function main() {
  const plan = writePlan(process.argv[2]);
  const fixtureSchemaValidation = await validateManagedV3FixtureSchemas({ runId: plan.runId });
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL is not configured in Backend environment.');
  const uri = process.env.MONGO_URL;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 7000 });
  try {
    await client.connect();
    const db = client.db();
    const hello = await db.admin().command({ hello: 1 });
    const buildInfo = await db.admin().command({ buildInfo: 1 });
    const collectionRows = await db.listCollections({}, { nameOnly: true }).toArray();
    const collectionNames = new Set(collectionRows.map(row => row.name));
    const required = models.map(model => ({ name: model.collection.collectionName, model }));
    const missingCollections = [...new Set(required.map(row => row.name))].filter(name => !collectionNames.has(name));
    const indexIssues = [];
    for (const { name, model } of required) {
      if (!collectionNames.has(name)) continue;
      const existing = await db.collection(name).listIndexes().toArray();
      indexIssues.push(...missingRequiredIndexes(model.schema.indexes(), existing, buildInfo.versionArray).map(issue => ({ collection: name, ...issue })));
    }
    const safetyChecks = staticSafetyChecks();
    const it05Check = safetyChecks.find(row => row.name === 'it05-cross-reservation-outbound-source-contract');
    const hookInventory = models.map(model => ({ collection: model.collection.collectionName,
      preHooks: [...model.schema.s.hooks._pres.keys()], postHooks: [...model.schema.s.hooks._posts.keys()] }));
    const selectedDatabase = db.databaseName;
    const topology = hello.setName ? 'replicaSet' : hello.msg === 'isdbgrid' ? 'mongos' : 'other';
    const unknownImpacts = plan.sourceDerived.filter(row => row.plannedUpdates === 'UNKNOWN' || String(row.plannedInserts).includes('UNKNOWN') || row.plannedDeletes === 'UNKNOWN');
    const sessionInvariant = { activeSessionCount: 0, expiredStillActiveCount: 0, missingReservationIdCount: 0, malformedPrimaryCount: 0,
      missingOrEmptyScopeCount: 0, duplicateIdsWithinScopeCount: 0, primaryOutsideScopeCount: 0, malformedScopeElementCount: 0,
      duplicateReservationGroups: 0, duplicateCompleteScopeGroups: 0, maxActivePerReservation: 0 };
    if (collectionNames.has('managedaccesssessions')) {
      const collection = db.collection('managedaccesssessions'), now = new Date();
      const [activeSessionCount, expiredStillActiveCount, missingReservationIdCount, malformedPrimaryCount, missingOrEmptyScopeCount, duplicateIdsWithinScopeCount,
        primaryOutsideScopeCount, malformedScopeElementCount, duplicateRows, duplicateCompleteScopeRows] = await Promise.all([
        collection.countDocuments({ status: 'ACTIVE' }),
        collection.countDocuments({ status: 'ACTIVE', expiresAt: { $lte: now } }),
        collection.countDocuments({ status: 'ACTIVE', $or: [{ reservationId: { $exists: false } }, { reservationId: null }] }),
        collection.countDocuments({ status: 'ACTIVE', reservationId: { $exists: true, $ne: null }, $expr: { $ne: [{ $type: '$reservationId' }, 'objectId'] } }),
        collection.countDocuments({ status: 'ACTIVE', $or: [{ scopedReservationIds: { $exists: false } }, { scopedReservationIds: null },
          { scopedReservationIds: { $size: 0 } }, { scopedReservationIds: { $not: { $type: 'array' } } }] }),
        collection.countDocuments({ status: 'ACTIVE', $expr: { $and: [ { $isArray: '$scopedReservationIds' },
          { $gt: [{ $size: '$scopedReservationIds' }, { $size: { $setUnion: ['$scopedReservationIds', '$scopedReservationIds'] } }] } ] } }),
        collection.countDocuments({ status: 'ACTIVE', reservationId: { $exists: true, $ne: null },
          $expr: { $not: { $in: ['$reservationId', { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }] } } }),
        collection.countDocuments({ status: 'ACTIVE', $expr: { $anyElementTrue: { $map: {
          input: { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }, as: 'scopeId',
          in: { $ne: [{ $type: '$$scopeId' }, 'objectId'] },
        } } } }),
        collection.aggregate([
          { $match: { status: 'ACTIVE', reservationId: { $exists: true, $ne: null } } },
          { $group: { _id: '$reservationId', activeCount: { $sum: 1 } } },
          { $match: { activeCount: { $gt: 1 } } },
          { $group: { _id: null, duplicateReservationGroups: { $sum: 1 }, maxActivePerReservation: { $max: '$activeCount' } } },
        ]).toArray(),
        collection.aggregate([
          { $match: { status: 'ACTIVE' } },
          { $project: { effectiveScope: { $setUnion: [
            { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] },
            { $cond: [{ $eq: [{ $ifNull: ['$reservationId', null] }, null] }, [], ['$reservationId']] },
          ] } } },
          { $unwind: '$effectiveScope' }, { $group: { _id: '$effectiveScope', activeCount: { $sum: 1 } } },
          { $match: { activeCount: { $gt: 1 } } }, { $count: 'duplicateCompleteScopeGroups' },
        ]).toArray(),
      ]);
      Object.assign(sessionInvariant, { activeSessionCount, expiredStillActiveCount, missingReservationIdCount, malformedPrimaryCount, missingOrEmptyScopeCount, duplicateIdsWithinScopeCount,
        primaryOutsideScopeCount, malformedScopeElementCount,
        duplicateReservationGroups: duplicateRows[0]?.duplicateReservationGroups ?? 0,
        duplicateCompleteScopeGroups: duplicateCompleteScopeRows[0]?.duplicateCompleteScopeGroups ?? 0,
        maxActivePerReservation: duplicateRows[0]?.maxActivePerReservation ?? (activeSessionCount ? 1 : 0) });
    }
    const readiness = evaluateReadiness({ selectedDatabase, topology, missingCollections, indexIssues, sessionInvariant,
      fixtureSchemaValidation, safetyChecks, unknownImpacts, missingModels: plan.missingModels, it05Passed: it05Check?.pass === true });
    const report = {
      status: readiness.status,
      mode: 'READ_ONLY', database: selectedDatabase, topology, replicaSet: hello.setName || null,
      serverVersion: buildInfo.version, serverVersionArray: buildInfo.versionArray,
      selectedCaseId: plan.selectedCaseId, scopedPlanStatus: plan.scopedPlanStatus,
      expiredActiveSessionAssessment: { count: sessionInvariant.expiredStillActiveCount,
        selectedCaseImpact: ['IT01', 'IT02'].includes(plan.selectedCaseId) ? 'NO_NEW_RESERVATION_ID_OVERLAP_EXPECTED' : 'NOT_ASSESSED',
        reason: ['IT01', 'IT02'].includes(plan.selectedCaseId) ? 'The selected fixture creates fresh Reservation ObjectIds; expired ACTIVE rows count toward the ACTIVE-only index but cannot match those new IDs.' : 'No selected-case collision assessment.' },
      runId: plan.runId, planHash: plan.planHash, collectionCount: collectionNames.size,
      missingCollections, indexIssues, accessSessionInvariant: sessionInvariant,
      fixtureInsertCounts: plan.fixtures, fixtureSchemaValidation, hookInventory,
      safetyChecks, writePlan: plan.sourceDerived, writeEnvelope: plan.writeEnvelope,
      writeApprovalReady: readiness.writeApprovalReady, approvalState: readiness.approvalState,
      humanApproval: readiness.humanApproval, blockers: readiness.blockers, credentialsRedacted: true,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'READ_ONLY_PREFLIGHT_PASS') process.exitCode = 2;
  } finally { await client.close(); }
}

if (require.main === module) {
  main().catch(error => { console.error(JSON.stringify({ status: 'READ_ONLY_PREFLIGHT_FAIL', ...secretSafe(error), credentialsRedacted: true })); process.exitCode = 1; });
}
module.exports = { writePlan, staticSafetyChecks, missingRequiredIndexes, sourceFingerprint, evaluateReadiness };
