const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const { auditRun, parseScenarioMarker, parseCliArgs, refValues } = require('../scripts/managed-v3-phase2sd-run-audit.cjs');

const RUN_ID = 'MI3-604e97492d2140589255b29ed69cc66a';
const scenarios = Array.from({ length: 10 }, (_, index) => `IT${String(index + 1).padStart(2, '0')}`);
const accessCounts = Object.fromEntries(scenarios.map(id => [id,
  ['IT01', 'IT02', 'IT03', 'IT04', 'IT05', 'IT07', 'IT10'].includes(id) ? 1 : 0]));

function matchesValue(actual, expected) {
  if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
  if (actual instanceof ObjectId || expected instanceof ObjectId) return false;
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  return actual === expected;
}
function getPath(value, pathText) { return pathText.split('.').reduce((current, key) => current == null ? undefined : current[key], value); }
function matches(doc, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(clause => matches(doc, clause));
    const actual = getPath(doc, key);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof RegExp) && !(expected instanceof ObjectId)) {
      if ('$in' in expected) return expected.$in.some(candidate => matchesValue(actual, candidate));
    }
    return matchesValue(actual, expected);
  });
}
function project(doc, projection) {
  if (!projection) return structuredClone(doc);
  const result = {};
  for (const [field, enabled] of Object.entries(projection)) if (enabled) {
    const value = getPath(doc, field);
    if (value !== undefined) {
      const segments = field.split('.');
      let target = result;
      for (const segment of segments.slice(0, -1)) target = target[segment] ??= {};
      target[segments.at(-1)] = value;
    }
  }
  if (projection._id !== 0 && doc._id !== undefined) result._id = doc._id;
  return result;
}
function memoryClient(collections) {
  const writes = [];
  const db = { databaseName: 'test', collection(name) { return {
    find(filter, options = {}) { return { toArray: async () => (collections[name] ?? []).filter(doc => matches(doc, filter)).map(doc => project(doc, options.projection)) }; },
    insertOne() { writes.push('insertOne'); throw new Error('read-only test detected a write'); },
    updateOne() { writes.push('updateOne'); throw new Error('read-only test detected a write'); },
    deleteOne() { writes.push('deleteOne'); throw new Error('read-only test detected a write'); },
  }; } };
  return { client: { db: () => db }, writes };
}
function fixtureCollections() {
  const c = Object.fromEntries(['users', 'facilities', 'warehousezones', 'warehouseracks', 'warehousecells', 'reservations', 'reservationpayments',
    'contracts', 'cellallocations', 'managedinventorycategories', 'managedinventoryquantityunits', 'inventoryitems', 'itemspecifications',
    'managedaccessvisits', 'managedaccesssessions', 'itemmovements', 'managedcellstocks', 'managediteminstances', 'managedv3stockprojections',
    'managedv3batchplacements', 'managedv3physicalunits', 'managedv3footprints'].map(name => [name, []]));
  for (let n = 1; n <= 10; n += 1) {
    const scenario = `IT${String(n).padStart(2, '0')}`;
    const randomLabel = String(n).padStart(8, 'a');
    const suffix = String(n).padStart(16, 'b');
    const prefix = `MI3-${RUN_ID}-${scenario}-${randomLabel}-${suffix}`;
    const facilityId = new ObjectId(), customerId = new ObjectId(), staffId = new ObjectId(), managerId = new ObjectId();
    const ids = { facilityId, customerId, staffId, managerId };
    c.users.push({ _id: customerId, keycloakSub: `${prefix}-customer`, email: 'private-customer@example.invalid' });
    c.users.push({ _id: staffId, keycloakSub: `${prefix}-staff`, email: 'private-staff@example.invalid', assignedFacilityId: facilityId });
    c.users.push({ _id: managerId, keycloakSub: `${prefix}-manager`, email: 'private-manager@example.invalid', assignedFacilityId: facilityId });
    c.facilities.push({ _id: facilityId, code: prefix.toUpperCase(), managedAccessRevision: 0 });
    c.warehousezones.push({ _id: new ObjectId(), facilityId, code: `Z-${suffix}`.toUpperCase() });
    c.warehouseracks.push({ _id: new ObjectId(), facilityId, rackCode: `R-${suffix}`.toUpperCase(), managedInventoryRevision: 0 });
    const cells = [new ObjectId(), new ObjectId(), new ObjectId()];
    for (let index = 0; index < cells.length; index += 1) c.warehousecells.push({ _id: cells[index], facilityId: String(facilityId), code: `C-${suffix}-${index + 1}`.toUpperCase(), usedWeightKg: 0, usedVolumeM3: 0, managedInventoryRevision: 0 });
    const reservations = [new ObjectId(), new ObjectId()];
    const payments = [new ObjectId(), new ObjectId()];
    for (let index = 0; index < 2; index += 1) {
      c.reservations.push({ _id: reservations[index], facilityId: index ? String(facilityId) : facilityId, reservationCode: `${prefix}-RES-${index + 1}`,
        fullPaymentId: payments[index], allocatedCapacity: 1, usedCapacityM3: 0, inventoryVersion: 0 });
      c.reservationpayments.push({ _id: payments[index], reservationId: index ? String(reservations[index]) : reservations[index], idempotencyKey: `${prefix}-full-rent-${index + 1}` });
      c.contracts.push({ _id: new ObjectId(), reservationId: reservations[index], contractCode: `${prefix}-CONTRACT-${index + 1}` });
      c.cellallocations.push({ _id: new ObjectId(), facilityId, reservationId: reservations[index], cellId: cells[index ? 2 : 0] });
    }
    c.cellallocations.push({ _id: new ObjectId(), facilityId, reservationId: reservations[0], cellId: cells[1] });
    c.managedinventorycategories.push({ _id: new ObjectId(), code: `CAT-${suffix}`.toUpperCase(), createdBy: managerId });
    c.managedinventoryquantityunits.push({ _id: new ObjectId(), code: `UNIT-${suffix}`.toUpperCase(), createdBy: managerId });
    const skuId = new ObjectId();
    c.inventoryitems.push({ _id: skuId, facilityId, reservationId: reservations[0], itemCode: `${prefix}-SKU`.toUpperCase(), managedV3Revision: 0 });
    c.itemspecifications.push({ _id: new ObjectId(), skuId: String(skuId), reservationId: reservations[0], code: `SPEC-${suffix}`.toUpperCase(), revision: 0, inboundRevision: 0 });
    for (let index = 0; index < accessCounts[scenario]; index += 1) {
      const marker = `${prefix}-session-${scenario}-${index}`;
      c.managedaccessvisits.push({ _id: new ObjectId(), reservationId: reservations[0], facilityId, idempotencyKey: `${prefix}-visit-${scenario}-${index}` });
      c.managedaccesssessions.push({ _id: new ObjectId(), reservationId: reservations[0], facilityId, checkInIdempotencyKey: marker });
    }
    ids.reservations = reservations;
    ids.cells = cells;
    ids.skuId = skuId;
    ids.scenario = scenario;
  }
  return c;
}

function persistIt01Success(collections) {
  const marker = `MI3-${RUN_ID}-IT01-`.toLowerCase();
  const facility = collections.facilities.find(row => row.code.toLowerCase().startsWith(marker));
  const sku = collections.inventoryitems.find(row => row.itemCode.toLowerCase().startsWith(marker));
  const reservation = collections.reservations.find(row => String(row._id) === String(sku.reservationId));
  const spec = collections.itemspecifications.find(row => String(row.skuId) === String(sku._id));
  const session = collections.managedaccesssessions.find(row => String(row.reservationId) === String(reservation._id));
  const cells = collections.warehousecells.filter(row => String(row.facilityId) === String(facility._id)).slice(0, 2);
  const rack = collections.warehouseracks.find(row => String(row.facilityId) === String(facility._id));
  facility.managedAccessRevision = 1;
  sku.managedV3Revision = 1;
  spec.inboundRevision = 1;
  reservation.usedCapacityM3 = 0.008;
  reservation.inventoryVersion = 1;
  session.revision = 1;
  rack.managedInventoryRevision = 1;
  const allocations = [{ cellId: cells[0]._id, weightKg: 4, volumeM3: 0.003 }, { cellId: cells[1]._id, weightKg: 6, volumeM3: 0.005 }];
  cells[0].usedWeightKg = 4; cells[0].usedVolumeM3 = 0.003; cells[0].managedInventoryRevision = 1;
  cells[1].usedWeightKg = 6; cells[1].usedVolumeM3 = 0.005; cells[1].managedInventoryRevision = 1;
  collections.managediteminstances.push({ _id: new ObjectId(), skuId: sku._id, facilityId: facility._id, reservationId: reservation._id,
    itemInstanceId: 'offline-it01-unit', status: 'PLACED', quantity: 1, unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: 0.008, allocations });
  collections.itemmovements.push({ _id: new ObjectId(), itemId: sku._id, facilityId: facility._id, quantity: 1, stockEffect: { action: 'ADD' } });
  return collections;
}

function persistIt02Success(collections) {
  const marker = `MI3-${RUN_ID}-IT02-`.toLowerCase();
  const facility = collections.facilities.find(row => row.code.toLowerCase().startsWith(marker));
  const sku = collections.inventoryitems.find(row => row.itemCode.toLowerCase().startsWith(marker));
  const reservation = collections.reservations.find(row => String(row._id) === String(sku.reservationId));
  const spec = collections.itemspecifications.find(row => String(row.skuId) === String(sku._id));
  const session = collections.managedaccesssessions.find(row => String(row.reservationId) === String(reservation._id));
  const cells = collections.warehousecells.filter(row => String(row.facilityId) === String(facility._id))
    .sort((a, b) => a.code.localeCompare(b.code)).slice(0, 2);
  const rack = collections.warehouseracks.find(row => String(row.facilityId) === String(facility._id));
  const receiptId = 'offline-it02-shared-receipt';
  const stockRows = cells.map((cell, index) => {
    const quantityOnHand = index === 0 ? 6 : 4;
    const totalWeightKg = quantityOnHand * 10;
    const totalVolumeM3 = quantityOnHand * 0.008;
    cell.usedWeightKg = totalWeightKg;
    cell.usedVolumeM3 = totalVolumeM3;
    cell.managedInventoryRevision = 1;
    return { _id: new ObjectId(), skuId: sku._id, facilityId: facility._id, reservationId: reservation._id, itemSpecId: spec._id,
      cellId: cell._id, receiptId, quantityOnHand, quantityHeld: 0, quantityAvailable: quantityOnHand,
      totalWeightKg, totalVolumeM3, ledgerRevision: 1, revision: 0 };
  });
  facility.managedAccessRevision = 1;
  sku.managedV3Revision = 1;
  spec.inboundRevision = 1;
  reservation.usedCapacityM3 = 0.08;
  reservation.inventoryVersion = 1;
  reservation.managedAccessRevision = 1;
  session.revision = 1;
  rack.managedInventoryRevision = 1;
  collections.managedcellstocks.push(...stockRows);
  collections.itemmovements.push({ _id: new ObjectId(), itemId: sku._id, facilityId: facility._id, quantity: 10,
    stockEffect: { action: 'ADD', ledgerRevision: 1,
      destination: stockRows.map(row => ({ cellId: row.cellId, receiptId: row.receiptId, quantity: row.quantityOnHand })) } });
  return collections;
}

function persistIt03Success(collections) {
  const marker = `MI3-${RUN_ID}-IT03-`.toLowerCase();
  const facility = collections.facilities.find(row => row.code.toLowerCase().startsWith(marker));
  const sku = collections.inventoryitems.find(row => row.itemCode.toLowerCase().startsWith(marker));
  const reservation = collections.reservations.find(row => String(row._id) === String(sku.reservationId));
  const spec = collections.itemspecifications.find(row => String(row.skuId) === String(sku._id));
  const cells = collections.warehousecells.filter(row => String(row.facilityId) === String(facility._id)).sort((a, b) => a._id.toString().localeCompare(b._id.toString())).slice(0, 2);
  const rack = collections.warehouseracks.find(row => String(row.facilityId) === String(facility._id));
  const receiptId = 'offline-it03-receipt';
  const addDestination = cells.map((cell, index) => ({ cellId: cell._id, receiptId, quantity: index === 0 ? 6 : 4 }));
  const sources = [];
  let fifoRemaining = addDestination.map(line => ({ ...line }));
  for (const quantity of [3, 7]) {
    let needed = quantity;
    const consumed = [];
    for (const lot of fifoRemaining) {
      const take = Math.min(lot.quantity, needed);
      if (take > 0) { consumed.push({ cellId: lot.cellId, receiptId, quantity: take }); lot.quantity -= take; needed -= take; }
      if (!needed) break;
    }
    sources.push(consumed);
  }
  facility.managedAccessRevision = 3;
  sku.managedV3Revision = 3;
  spec.inboundRevision = 3;
  reservation.usedCapacityM3 = 0;
  reservation.inventoryVersion = 3;
  reservation.managedAccessRevision = 3;
  rack.managedInventoryRevision = 3;
  cells[0].managedInventoryRevision = 3;
  cells[1].managedInventoryRevision = 2;
  for (const session of collections.managedaccesssessions.filter(row => String(row.reservationId) === String(reservation._id))) {
    session.revision = 2; session.status = 'REVOKED';
  }
  collections.managedaccesssessions.push({ _id: new ObjectId(), reservationId: reservation._id, facilityId: facility._id, revision: 2, status: 'REVOKED' });
  collections.managedaccesssessions.push({ _id: new ObjectId(), reservationId: reservation._id, facilityId: facility._id, revision: 1, status: 'ACTIVE' });
  collections.managedaccessvisits.push({ _id: new ObjectId(), reservationId: reservation._id, facilityId: facility._id });
  collections.managedaccessvisits.push({ _id: new ObjectId(), reservationId: reservation._id, facilityId: facility._id });
  collections.itemmovements.push({ _id: new ObjectId(), itemId: sku._id, facilityId: facility._id, quantity: 10, performedAt: new Date('2026-01-01T00:00:00Z'),
    stockEffect: { action: 'ADD', ledgerRevision: 1, destination: addDestination } });
  collections.itemmovements.push({ _id: new ObjectId(), itemId: sku._id, facilityId: facility._id, quantity: 3, performedAt: new Date('2026-01-01T00:01:00Z'),
    stockEffect: { action: 'REMOVE', ledgerRevision: 2, source: sources[0] } });
  collections.itemmovements.push({ _id: new ObjectId(), itemId: sku._id, facilityId: facility._id, quantity: 7, performedAt: new Date('2026-01-01T00:02:00Z'),
    stockEffect: { action: 'REMOVE', ledgerRevision: 3, source: sources[1] } });
  return collections;
}

test('fixture marker parser matches the builder label/suffix and normalized uppercase roots', () => {
  const marker = `MI3-${RUN_ID}-it01-0123abcd-0123456789abcdef-customer`;
  assert.deepEqual(parseScenarioMarker(marker, RUN_ID), { scenario: 'IT01', suffix: '0123456789ABCDEF' });
  assert.deepEqual(refValues([new ObjectId('0123456789abcdef01234567')]), [new ObjectId('0123456789abcdef01234567'), '0123456789abcdef01234567']);
});

test('audit CLI accepts a single explicit CaseId and validates its value', () => {
  assert.deepEqual(parseCliArgs([RUN_ID, '--case', 'IT01']), { runId: RUN_ID, caseId: 'IT01' });
  assert.deepEqual(parseCliArgs([RUN_ID]), { runId: RUN_ID, caseId: null });
  assert.throws(() => parseCliArgs([RUN_ID, '--case', 'IT11']), /IT01 through IT10/);
  assert.throws(() => parseCliArgs([RUN_ID, '--unknown']), /Unknown audit option/);
});

test('IT01 audit ignores unselected scenario fixture gaps and verifies committed A1 state', async () => {
  const { client } = memoryClient(persistIt01Success(fixtureCollections()));
  const result = await auditRun({ client, runId: RUN_ID, caseId: 'IT01' });
  assert.equal(result.auditCompleteness, 'COMPLETE');
  assert.equal(result.inventoryConsistency, 'PASS', JSON.stringify(result.inventoryCheck));
  assert.equal(result.caseId, 'IT01');
  assert.equal(result.verifiedRootCounts.users, 3);
  assert.equal(result.fixtureCounts.actual.users, 3);
  assert.equal(result.fixtureCounts.actual.facilities, 1);
  assert.equal(result.fixtureCounts.actual.reservations, 2);
  assert.equal(result.fixtureCounts.actual.inventoryitems, 1);
  assert.equal(result.inventoryCheck.actual.movements.ADD, 1);
  assert.equal(result.inventoryCheck.actual.itemInstances, 1);
  assert.deepEqual(result.inventoryCheck.actual.instanceLoad, { cells: 2, weightKg: 10, volumeM3: 0.008 });
  assert.deepEqual(result.inventoryCheck.actual.cellCounters, { cells: 2, weightKg: 10, volumeM3: 0.008 });
  assert.deepEqual(result.inventoryCheck.actual.reservation, { usedCapacityM3: 0.008, allocatedCapacity: 1, inventoryVersion: 1 });
  assert.equal(result.fixtureCounts.differences.length, 0);
  assert.equal(Object.hasOwn(result, 'fixtureCountsByScenario'), false);
});

test('IT01 audit reports a real capacity mismatch as FAIL after fixture correlation is complete', async () => {
  const collections = persistIt01Success(fixtureCollections());
  const facility = collections.facilities.find(row => row.code.toLowerCase().startsWith(`MI3-${RUN_ID}-IT01-`.toLowerCase()));
  collections.warehousecells.find(row => String(row.facilityId) === String(facility._id) && row.code.endsWith('-1')).usedWeightKg = 5;
  const result = await auditRun({ client: memoryClient(collections).client, runId: RUN_ID, caseId: 'IT01' });
  assert.equal(result.auditCompleteness, 'COMPLETE');
  assert.equal(result.inventoryConsistency, 'FAIL');
  assert.equal(result.inventoryCheck.status, 'FAIL');
  assert.ok(result.inventoryCheck.checks.some(check => check.name === 'Cell counters match the instance allocation totals' && !check.pass));
});

test('IT02 audit ignores other case fixtures and verifies A2 ADD, Cell Stock, receipt lineage and capacity', async () => {
  const { client } = memoryClient(persistIt02Success(fixtureCollections()));
  const result = await auditRun({ client, runId: RUN_ID, caseId: 'IT02' });
  assert.equal(result.auditCompleteness, 'COMPLETE');
  assert.equal(result.inventoryConsistency, 'PASS');
  assert.equal(result.caseId, 'IT02');
  assert.deepEqual(result.verifiedRootCounts, { users: 3, facilities: 1, reservations: 2, inventoryitems: 1 });
  assert.equal(result.fixtureCounts.actual.managedaccesssessions, 1);
  assert.equal(result.inventoryCheck.actual.movements.ADD, 1);
  assert.equal(result.inventoryCheck.actual.movements.ADDQuantity, 10);
  assert.deepEqual(result.inventoryCheck.actual.cellStock, { rows: 2, quantityOnHand: 10, quantityAvailable: 10, quantityHeld: 0,
    weightKg: 100, volumeM3: 0.08, ledgerRevisions: [1, 1], distinctReceiptCount: 1, receiptLineageMatchesMovement: true });
  assert.deepEqual(result.inventoryCheck.actual.cellLoads.map(row => [row.cellNumber, row.quantity]), [[1, 6], [2, 4]]);
  assert.deepEqual(result.inventoryCheck.actual.reservation, { usedCapacityM3: 0.08, allocatedCapacity: 1, inventoryVersion: 1 });
  assert.equal(result.fixtureCounts.differences.length, 0);
  assert.equal(Object.hasOwn(result, 'fixtureCountsByScenario'), false);
});

test('IT03 audit verifies partial/full REMOVE, FIFO lineage, zeroed stock deletion, capacity and revisions', async () => {
  const collections = persistIt03Success(fixtureCollections());
  const { client, writes } = memoryClient(collections);
  const result = await auditRun({ client, runId: RUN_ID, caseId: 'IT03' });
  assert.equal(result.auditCompleteness, 'COMPLETE', JSON.stringify(result));
  assert.equal(result.inventoryConsistency, 'PASS', JSON.stringify(result.inventoryCheck));
  assert.equal(result.fixtureCounts.actual.managedaccessvisits, 3);
  assert.equal(result.fixtureCounts.actual.managedaccesssessions, 3);
  assert.deepEqual(result.inventoryCheck.actual.movements, { total: 3, actions: ['ADD', 'REMOVE', 'REMOVE'], quantities: [10, 3, 7], ledgerRevisions: [1, 2, 3] });
  assert.deepEqual(result.inventoryCheck.actual.cellStock, { rows: 0, quantityOnHand: 0, quantityHeld: 0, totalWeightKg: 0, totalVolumeM3: 0 });
  assert.equal(result.inventoryCheck.actual.receiptLineage.removeSourcesMatchFIFO, true);
  assert.deepEqual(result.inventoryCheck.actual.reservation, { usedCapacityM3: 0, allocatedCapacity: 1, inventoryVersion: 3 });
  assert.deepEqual(result.inventoryCheck.actual.revisions.sessions.map(row => [row.revision, row.status]), [[2, 'REVOKED'], [2, 'REVOKED'], [1, 'ACTIVE']]);
  assert.deepEqual(writes, []);
  assert.equal(JSON.stringify(result).includes('@example.invalid'), false);
});

test('IT03 audit reports incorrect FIFO source allocation as FAIL', async () => {
  const collections = persistIt03Success(fixtureCollections());
  const marker = `MI3-${RUN_ID}-IT03-`.toLowerCase();
  const sku = collections.inventoryitems.find(row => row.itemCode.toLowerCase().startsWith(marker));
  const remove = collections.itemmovements.find(row => String(row.itemId) === String(sku._id) && row.stockEffect.action === 'REMOVE');
  remove.stockEffect.source[0].cellId = new ObjectId();
  const result = await auditRun({ client: memoryClient(collections).client, runId: RUN_ID, caseId: 'IT03' });
  assert.equal(result.auditCompleteness, 'COMPLETE');
  assert.equal(result.inventoryConsistency, 'FAIL');
  assert.ok(result.inventoryCheck.checks.some(check => check.name.includes('FIFO') && !check.pass));
});

test('IT02 audit reports receipt-lineage or capacity drift as FAIL, not PASS', async () => {
  const collections = persistIt02Success(fixtureCollections());
  collections.itemmovements[0].stockEffect.destination[0].receiptId = 'wrong-receipt';
  collections.reservations.find(row => String(row._id) === String(collections.inventoryitems.find(row => row.itemCode.toLowerCase().includes('-it02-')).reservationId)).usedCapacityM3 = 0.07;
  const result = await auditRun({ client: memoryClient(collections).client, runId: RUN_ID, caseId: 'IT02' });
  assert.equal(result.auditCompleteness, 'COMPLETE');
  assert.equal(result.inventoryConsistency, 'FAIL');
  assert.ok(result.inventoryCheck.checks.some(check => check.name === 'receipt lineage matches both ADD destination lines' && !check.pass));
  assert.ok(result.inventoryCheck.checks.some(check => check.name === 'Reservation capacity is 0.08 m3 and inventoryVersion is 1' && !check.pass));
});

test('audit follows Facility → Reservation → SKU and descendant references across ObjectId/string storage', async () => {
  const seeded = fixtureCollections();
  const { client, writes } = memoryClient(seeded);
  const result = await auditRun({ client, runId: RUN_ID });
  assert.equal(result.auditCompleteness, 'COMPLETE', JSON.stringify(result.correlationIssues));
  assert.equal(result.inventoryConsistency, 'PASS');
  assert.deepEqual(result.verifiedRootCounts, { users: 30, facilities: 10, reservations: 20, inventoryitems: 10 });
  assert.equal(result.fixtureCountsByScenario.IT01.facilities, 1);
  assert.equal(result.fixtureCountsByScenario.IT10.managedaccesssessions, 1);
  assert.equal(result.fixtureDocumentCounts.reservationpayments, 20);
  assert.deepEqual(result.movementActions, []);
  assert.deepEqual(writes, []);
});

test('missing root and partial fixture setup are INCOMPLETE and never claim inventory consistency', async () => {
  const missingRoot = fixtureCollections();
  missingRoot.facilities.pop();
  const first = await auditRun({ client: memoryClient(missingRoot).client, runId: RUN_ID });
  assert.equal(first.auditCompleteness, 'INCOMPLETE');
  assert.equal(first.inventoryConsistency, 'NOT_VERIFIED');
  assert.ok(first.correlationIssues.some(issue => issue.code === 'ROOT_COUNT_MISMATCH' && issue.collection === 'facilities'));

  const partial = fixtureCollections();
  partial.contracts.pop();
  const second = await auditRun({ client: memoryClient(partial).client, runId: RUN_ID });
  assert.equal(second.auditCompleteness, 'INCOMPLETE');
  assert.ok(second.fixtureCountDifferencesByScenario.IT10.some(row => row.collection === 'contracts'));
  assert.ok(second.correlationIssues.some(issue => issue.code === 'FIXTURE_COUNT_MISMATCH'));
});

test('orphaned relationships are surfaced as unresolved correlation issues', async () => {
  const seeded = fixtureCollections();
  seeded.contracts[0].reservationId = new ObjectId();
  const result = await auditRun({ client: memoryClient(seeded).client, runId: RUN_ID });
  assert.equal(result.auditCompleteness, 'INCOMPLETE');
  assert.equal(result.inventoryConsistency, 'NOT_VERIFIED');
  assert.ok(result.orphanOrUnresolvedReferences.some(issue => issue.code === 'contract_reservation_not_found'));
});

test('zero movement with correlated nonzero stock/capacity fails consistency instead of passing', async () => {
  const seeded = fixtureCollections();
  const { scenario } = parseScenarioMarker(seeded.facilities[0].code, RUN_ID);
  const cell = seeded.warehousecells[0];
  cell.usedWeightKg = 5;
  seeded.managedcellstocks.push({ _id: new ObjectId(), skuId: seeded.inventoryitems[0]._id, facilityId: seeded.facilities[0]._id,
    reservationId: seeded.reservations[0]._id, cellId: cell._id, quantityOnHand: 1, quantityHeld: 0, totalWeightKg: 5, totalVolumeM3: 0.001 });
  const result = await auditRun({ client: memoryClient(seeded).client, runId: RUN_ID });
  assert.equal(result.auditCompleteness, 'COMPLETE');
  assert.equal(result.fixtureDocumentCounts.itemmovements, 0);
  assert.equal(result.inventoryConsistency, 'FAIL');
  assert.equal(result.stockTotals.quantityOnHand, 1);
});

test('audit output excludes personal fields and implementation is read-only', async () => {
  const seeded = fixtureCollections();
  const { client, writes } = memoryClient(seeded);
  const result = await auditRun({ client, runId: RUN_ID });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('private-customer@example.invalid'), false);
  assert.equal(serialized.includes('displayName'), false);
  assert.equal(result.personalDataReturned, false);
  assert.deepEqual(writes, []);
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/managed-v3-phase2sd-run-audit.cjs'), 'utf8');
  assert.doesNotMatch(source, /\.insert(?:One|Many)?\s*\(|\.update(?:One|Many)?\s*\(|\.delete(?:One|Many)?\s*\(|\.createIndex\s*\(|\.drop(?:Database|Collection|Index)?\s*\(/i);
});
