/*
 * Real MongoDB integration tests for the current Managed V3 service writers.
 * All tests are skipped unless the dedicated explicit opt-in is present. They
 * create uniquely owned fixtures and intentionally never clean up/delete.
 */
require('dotenv').config({ quiet: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createManagedV3Fixture } = require('./helpers/managed-v3-fixture.cjs');
const { shouldRunIntegrationCase } = require('./helpers/managed-v3-case-selection.cjs');
const { writePlan, staticSafetyChecks } = require('../../scripts/managed-v3-phase2sa-preflight.cjs');
const { auditRun } = require('../../scripts/managed-v3-phase2sd-run-audit.cjs');

const enabled = process.env.MI_V3_RUN_MONGODB_TESTS === 'YES';
const runId = process.env.MI_V3_TEST_RUN_ID;
const approvedDatabase = process.env.MI_V3_APPROVED_DATABASE;
const approvedPlanHash = process.env.MI_V3_APPROVED_PLAN_HASH;
const testName = name => `${name} [MongoDB write integration]`;
const caseFilter = process.env.MI_V3_TEST_CASE;
const caseEnabled = name => shouldRunIntegrationCase(name, { enabled, selectedCase: caseFilter });
let currentStage = 'test_start';
function integrationTest(name, run) {
  const caseId = name.slice(0, 4);
  test(testName(name), { skip: !caseEnabled(name) }, async () => {
    currentStage = 'fixture_setup';
    try { await run(); }
    catch (error) {
      let fixtureAudit = 'NOT_VERIFIED';
      try { fixtureAudit = await auditRun({ client: { db: () => mongoose.connection.db }, runId }); } catch (auditError) {
        fixtureAudit = { status: 'READ_ONLY_AUDIT_FAILED', name: auditError?.name ?? 'Error', code: auditError?.code ?? null };
      }
      const safeMessage = String(error?.message ?? 'Unknown failure').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI REDACTED]');
      console.error(JSON.stringify({ caseId, errorType: error?.name ?? 'Error', errorCode: error?.code ?? null,
        stage: currentStage, message: safeMessage, runId, fixtureAudit }));
      throw error;
    } finally { currentStage = 'test_complete'; }
  });
}

async function connectApprovedDatabase() {
  if (!enabled) throw new Error('Integration write opt-in is disabled.');
  if (!runId || !/^[a-zA-Z0-9-]{8,80}$/.test(runId)) throw new Error('MI_V3_TEST_RUN_ID is required.');
  if (!approvedPlanHash || !/^[a-f\d]{64}$/i.test(approvedPlanHash)) throw new Error('Reviewed read-only plan hash is required.');
  const currentPlan = writePlan(runId);
  if (currentPlan.planHash !== approvedPlanHash) throw new Error('Approved plan hash does not match this test source/run ID.');
  if (currentPlan.selectedCaseId !== (process.env.MI_V3_TEST_CASE || null)) throw new Error('Approved plan does not match selected CaseId.');
  if (currentPlan.scopedPlanStatus === 'UNVERIFIED') throw new Error('Selected case write envelope is not verified; refusing to connect for Write Mode.');
  if (currentPlan.selectedCase !== (process.env.MI_V3_TEST_CASE || null)) throw new Error('Approved plan does not match selected integration case.');
  const failedStaticChecks = staticSafetyChecks().filter(row => !row.pass);
  if (failedStaticChecks.length) throw new Error(`Static safety checks failed: ${failedStaticChecks.map(row => row.name).join(', ')}`);
  if (!process.env.MONGO_URL) throw new Error('Backend MONGO_URL is not configured.');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing tests under NODE_ENV=production; the runner never changes NODE_ENV.');
  await mongoose.connect(process.env.MONGO_URL, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const dbName = mongoose.connection.name;
  if (dbName !== approvedDatabase || dbName !== 'test') throw new Error(`Connected database ${dbName} differs from approved database ${approvedDatabase || '(unset)'} or expected test.`);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('A replica set is required for transaction integration tests.');
  return dbName;
}

test.before(async () => { if (enabled) await connectApprovedDatabase(); });
test.after(async () => { if (enabled && mongoose.connection.readyState !== 0) await mongoose.disconnect(); });

function fixture(label) {
  currentStage = 'fixture_setup';
  return createManagedV3Fixture({ runId, label: `${label}-${randomUUID().slice(0, 8)}`,
    onStage: stage => { currentStage = stage; } });
}

async function getStock(world) {
  currentStage = 'post_operation_verification';
  const Stock = require(path.resolve(__dirname, '../../dist/models/inventory-items/managed-cell-stock.model')).default;
  return Stock.find({ skuId: world.sku._id }).sort({ reservationId: 1, cellId: 1 }).lean();
}
async function getMovements(world) {
  currentStage = 'post_operation_verification';
  const Movement = require(path.resolve(__dirname, '../../dist/models/inventory-items/item-movement.model')).default;
  return Movement.find({ itemId: world.sku._id, facilityId: world.facility._id, customerId: world.customer._id, schemaVersion: 4 }).sort({ performedAt: 1, _id: 1 }).lean();
}
const totalsByReservation = rows => Object.fromEntries([...new Set(rows.map(row => String(row.reservationId)))].map(reservationId =>
  [reservationId, rows.filter(row => String(row.reservationId) === reservationId).reduce((sum, row) => sum + row.quantityOnHand, 0)]));
const assertRejectedCode = (promise, code) => assert.rejects(promise, error => error?.code === code, `expected error code ${code}`);

integrationTest('IT01 Inbound A1 persists ADD, a quantity-one instance, its multi-Cell footprint and capacity', async () => {
  const world = await fixture('it01');
  const request = await world.inbound({ quantity: 1, allocations: [{ cellId: world.cells[0]._id, quantity: 1 }],
    instanceAllocations: [{ cellId: world.cells[0]._id, weightKg: 4, volumeM3: 0.003 }, { cellId: world.cells[1]._id, weightKg: 6, volumeM3: 0.005 }] });
  assert.equal(request.result.status, 'COMMITTED');
  assert.equal(request.result.quantity, 1);
  const { ItemInstance, Cell, Reservation } = world.models;
  const instances = await ItemInstance.find({ skuId: world.sku._id, facilityId: world.facility._id }).lean();
  assert.equal(instances.length, 1);
  assert.equal(instances[0].quantity, 1);
  assert.equal(instances[0].allocations.length, 2);
  assert.equal(instances[0].allocations.reduce((n, row) => n + row.weightKg, 0), 10);
  assert.equal(instances[0].allocations.reduce((n, row) => n + row.volumeM3, 0), 0.008);
  const movement = (await getMovements(world))[0];
  assert.equal(movement.stockEffect.action, 'ADD');
  assert.equal(movement.stockEffect.destination.filter(row => row.itemInstanceId).length, 2);
  const cells = await Cell.find({ _id: { $in: [world.cells[0]._id, world.cells[1]._id] } }).lean();
  assert.deepEqual(cells.map(row => row.usedWeightKg).sort((a, b) => a - b), [4, 6]);
  assert.deepEqual(cells.map(row => row.usedVolumeM3).sort((a, b) => a - b), [0.003, 0.005]);
  assert.equal((await Reservation.findById(world.reservations[0]._id).lean()).usedCapacityM3, 0.008);
});

integrationTest('IT02 Inbound A2 persists ten units, ADD ledger lines, Cell Stock and Cell capacity', async () => {
  const world = await fixture('it02');
  const request = await world.inbound({ quantity: 10 });
  assert.equal(request.result.status, 'COMMITTED');
  const movements = await getMovements(world), stock = await getStock(world);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].stockEffect.action, 'ADD');
  assert.equal(movements[0].quantity, 10);
  assert.equal(movements[0].stockEffect.ledgerRevision, 1);
  assert.equal(stock.reduce((n, row) => n + row.quantityOnHand, 0), 10);
  assert.equal(stock.reduce((n, row) => n + row.quantityAvailable, 0), 10);
  assert.equal(stock.reduce((n, row) => n + row.quantityHeld, 0), 0);
  assert.equal(stock.reduce((n, row) => n + row.totalWeightKg, 0), 100);
  assert.equal(stock.reduce((n, row) => n + row.totalVolumeM3, 0), 0.08);
  assert.ok(stock.every(row => row.ledgerRevision === 1));
  assert.equal(new Set(stock.map(row => row.receiptId)).size, 1, 'both Cell Stock lots share the line receipt');
  const destinationByCell = new Map(movements[0].stockEffect.destination.map(line => [String(line.cellId), line]));
  assert.equal(destinationByCell.size, 2);
  for (const row of stock) {
    const destination = destinationByCell.get(String(row.cellId));
    assert.ok(destination, 'each Cell Stock lot has a corresponding ADD destination line');
    assert.equal(row.receiptId, destination.receiptId);
    assert.equal(row.quantityOnHand, destination.quantity);
  }
  const cells = await world.models.Cell.find({ _id: { $in: [world.cells[0]._id, world.cells[1]._id] } }).lean();
  assert.equal(cells.reduce((n, row) => n + row.usedWeightKg, 0), 100);
  assert.equal(cells.reduce((n, row) => n + row.usedVolumeM3, 0), 0.08);
  assert.equal(stock.length, 2, 'A2 stock remains split by its two destination Cells');
  const reservation = await world.models.Reservation.findById(world.reservations[0]._id).lean();
  assert.equal(reservation.usedCapacityM3, 0.08);
  assert.equal(reservation.inventoryVersion, 1);
  assert.equal((await world.models.Item.findById(world.sku._id).lean()).managedV3Revision, 1);
  assert.equal((await world.models.Spec.findById(world.spec._id).lean()).inboundRevision, 1);
  assert.equal((await world.models.Session.findById(request.body.accessSessionId).lean()).revision, 1);
  assert.equal((await world.models.Rack.findById(world.rack._id).lean()).managedInventoryRevision, 1);
  assert.ok(cells.every(row => row.managedInventoryRevision === 1));
});

integrationTest('IT03 partial and full Outbound persist REMOVE movements and release Cell capacity', async () => {
  const world = await fixture('it03');
  await world.inbound({ quantity: 10 });
  const partial = await world.outbound(3);
  assert.equal(partial.result.status, 'COMMITTED');
  assert.equal(partial.result.quantity, 3);
  const partialStock = await getStock(world);
  assert.equal(partialStock.reduce((n, row) => n + row.quantityOnHand, 0), 7);
  assert.equal(partialStock.reduce((n, row) => n + row.totalWeightKg, 0), 70);
  const full = await world.outbound(7);
  assert.equal(full.result.status, 'COMMITTED');
  const movements = await getMovements(world), remaining = await getStock(world);
  assert.equal(movements.filter(row => row.stockEffect.action === 'ADD').length, 1);
  assert.deepEqual(movements.filter(row => row.stockEffect.action === 'REMOVE').map(row => row.quantity).sort((a, b) => a - b), [3, 7]);
  assert.equal(remaining.length, 0);
  const cells = await world.models.Cell.find({ _id: { $in: [world.cells[0]._id, world.cells[1]._id] } }).lean();
  assert.equal(cells.reduce((n, row) => n + row.usedWeightKg, 0), 0);
  assert.equal(cells.reduce((n, row) => n + row.usedVolumeM3, 0), 0);
});

integrationTest('IT04 same-Reservation and cross-Reservation Relocation persist MOVE with receipt ownership', async () => {
  const world = await fixture('it04');
  await world.inbound({ quantity: 10 });
  const sameReservation = await world.relocate(2, { sourceCell: world.cells[0], destinationCell: world.cells[1], cross: false });
  assert.equal(sameReservation.result.status, 'COMMITTED');
  const crossReservation = await world.relocate(2, { sourceCell: world.cells[0], destinationCell: world.cells[2], cross: true });
  assert.equal(crossReservation.result.status, 'COMMITTED');
  const movements = await getMovements(world), stocks = await getStock(world);
  const moves = movements.filter(row => row.stockEffect.action === 'MOVE');
  assert.equal(movements.filter(row => row.stockEffect.action === 'ADD').length, 1);
  assert.equal(moves.length, 2);
  for (const move of moves) assert.equal(move.stockEffect.source[0].receiptId, move.stockEffect.destination[0].receiptId);
  assert.equal(stocks.reduce((n, row) => n + row.quantityOnHand, 0), 10);
  assert.equal(stocks.filter(row => String(row.reservationId) === String(world.reservations[0]._id)).reduce((n, row) => n + row.quantityOnHand, 0), 8);
  assert.equal(stocks.filter(row => String(row.reservationId) === String(world.reservations[1]._id)).reduce((n, row) => n + row.quantityOnHand, 0), 2);
});

integrationTest('IT05 ADD 10, MOVE 6 from A to B, then REMOVE 3 from B with persisted reservation and receipt lineage', async () => {
  const world = await fixture('it05');
  await world.inbound({ quantity: 10 });
  const moved = await world.relocate(6, { sourceCell: world.cells[0], destinationCell: world.cells[2], cross: true });
  assert.equal(moved.result.status, 'COMMITTED');
  const before = totalsByReservation(await getStock(world));
  assert.equal(before[String(world.reservations[0]._id)], 4);
  assert.equal(before[String(world.reservations[1]._id)], 6);
  const removed = await world.outbound(3, { reservation: world.reservations[1], cellId: world.cells[2] });
  assert.equal(removed.result.status, 'COMMITTED');
  const movements = await getMovements(world), afterStocks = await getStock(world);
  const add = movements.find(row => row.stockEffect.action === 'ADD');
  const move = movements.find(row => row.stockEffect.action === 'MOVE');
  const remove = movements.find(row => row.stockEffect.action === 'REMOVE');
  assert.ok(add && move && remove);
  assert.equal(String(add.stockEffect.destination[0].reservationId), String(world.reservations[0]._id));
  assert.equal(add.stockEffect.destination[0].receiptId, move.stockEffect.source[0].receiptId);
  assert.equal(String(move.stockEffect.source[0].reservationId), String(world.reservations[0]._id));
  assert.equal(String(move.stockEffect.destination[0].reservationId), String(world.reservations[1]._id));
  assert.equal(move.stockEffect.source[0].receiptId, move.stockEffect.destination[0].receiptId);
  assert.equal(String(remove.managedReservationId), String(world.reservations[1]._id));
  assert.equal(String(remove.stockEffect.source[0].reservationId), String(world.reservations[1]._id));
  assert.equal(String(remove.stockEffect.source[0].cellId), String(world.cells[2]._id));
  assert.equal(remove.stockEffect.source[0].receiptId, move.stockEffect.destination[0].receiptId);
  assert.equal(remove.stockEffect.source[0].quantity, 3);
  assert.equal(remove.stockEffect.source[0].quantityBefore, 6);
  assert.equal(remove.stockEffect.source[0].quantityAfter, 3);
  assert.equal(remove.stockEffect.ledgerRevision, 3);
  const after = totalsByReservation(afterStocks);
  assert.equal(after[String(world.reservations[0]._id)], 4);
  assert.equal(after[String(world.reservations[1]._id)], 3);
  assert.equal(Object.values(after).reduce((a, b) => a + b, 0), 7);
  assert.equal(afterStocks.length, 2);
  assert.equal(afterStocks.find(row => String(row.reservationId) === String(world.reservations[0]._id)).quantityOnHand, 4);
  assert.equal(afterStocks.find(row => String(row.reservationId) === String(world.reservations[1]._id)).quantityOnHand, 3);
  const cells = await world.models.Cell.find({ _id: { $in: world.cells.map(cell => cell._id) } }).lean();
  const cellById = new Map(cells.map(cell => [String(cell._id), cell]));
  assert.equal(cellById.get(String(world.cells[0]._id)).usedWeightKg, 0);
  assert.equal(cellById.get(String(world.cells[1]._id)).usedWeightKg, 40);
  assert.equal(cellById.get(String(world.cells[2]._id)).usedWeightKg, 30);
  assert.equal(cellById.get(String(world.cells[2]._id)).usedVolumeM3, 0.024);
  const [reservationA, reservationB] = await Promise.all(world.reservations.map(row => world.models.Reservation.findById(row._id).lean()));
  assert.equal(reservationA.usedCapacityM3, 0.032);
  assert.equal(reservationB.usedCapacityM3, 0.024);
  assert.equal(reservationA.inventoryVersion, 2);
  assert.equal(reservationB.inventoryVersion, 2);
});

integrationTest('IT06 controlled replica-set transaction rollback primitive (not a service-level rollback proof)', async () => {
  const world = await fixture('it06');
  currentStage = 'service_operation';
  const cell = world.cells[0], before = await world.models.Cell.findById(cell._id).lean();
  const session = await mongoose.startSession();
  try {
    await assert.rejects(session.withTransaction(async () => {
      await world.models.Cell.updateOne({ _id: cell._id, facilityId: world.facility._id }, { $inc: { usedWeightKg: 17, managedInventoryRevision: 1 } }, { session });
      throw new Error('MI3_CONTROLLED_TRANSACTION_ABORT');
    }), /MI3_CONTROLLED_TRANSACTION_ABORT/);
  } finally { await session.endSession(); }
  const after = await world.models.Cell.findById(cell._id).lean();
  assert.equal(after.usedWeightKg, before.usedWeightKg);
  assert.equal(after.managedInventoryRevision, before.managedInventoryRevision);
});

integrationTest('IT07 same-key replay, changed-payload conflict and persisted inbound operation lookup', async () => {
  const world = await fixture('it07');
  const request = await world.inboundRequest({ quantity: 10, idempotencyKey: `${world.prefix}-replay-key` });
  const { ManagedUnifiedInboundService } = require(path.resolve(__dirname, '../../dist/services/inventory-items/managed-unified-inbound.service'));
  currentStage = 'service_operation';
  const committed = await ManagedUnifiedInboundService.confirm(String(world.sku._id), request.body, world.actor, request.key);
  assert.equal(committed.status, 'COMMITTED');
  const replay = await ManagedUnifiedInboundService.confirm(String(world.sku._id), request.body, world.actor, request.key);
  assert.equal(replay.replayed, true);
  const changed = structuredClone(request.body);
  changed.lines[0].quantity = 9;
  changed.lines[0].cellAllocations[1].quantity = 3;
  await assertRejectedCode(ManagedUnifiedInboundService.confirm(String(world.sku._id), changed, world.actor, request.key), 'IDEMPOTENCY_CONFLICT');
  const operation = await ManagedUnifiedInboundService.operation(String(world.sku._id), request.key, world.actor);
  assert.equal(String(operation.movement._id), String(committed.movement?._id ?? committed.movementId));
  assert.equal((await getMovements(world)).length, 1);
});

integrationTest('IT08 stale SKU/session revisions and insufficient reservation/Cell capacity fail closed', async () => {
  const world = await fixture('it08');
  const { ManagedUnifiedInboundService } = require(path.resolve(__dirname, '../../dist/services/inventory-items/managed-unified-inbound.service'));
  currentStage = 'service_operation';
  const staleSku = await world.inboundRequest({ quantity: 10 });
  staleSku.body.skuRevision += 1;
  await assertRejectedCode(ManagedUnifiedInboundService.preview(String(world.sku._id), staleSku.body, world.actor), 'STALE_SKU_REVISION');
  const staleSession = await world.inboundRequest({ quantity: 10 });
  staleSession.body.sessionRevision += 1;
  await assertRejectedCode(ManagedUnifiedInboundService.preview(String(world.sku._id), staleSession.body, world.actor), 'ACCESS_SESSION_SCOPE_INVALID');

  const request = await world.inboundRequest({ quantity: 10 });
  await world.models.Reservation.updateOne({ _id: world.reservations[0]._id, customerId: world.customer._id }, { $set: { allocatedCapacity: 0 } });
  await assertRejectedCode(ManagedUnifiedInboundService.confirm(String(world.sku._id), request.body, world.actor, request.key), 'STALE_RESERVATION_CAPACITY');
  assert.equal((await getMovements(world)).length, 0);
  assert.equal((await getStock(world)).length, 0);

  const cellCapacityRequest = await world.inboundRequest({ quantity: 10 });
  await world.models.Cell.updateOne({ _id: world.cells[0]._id, facilityId: world.facility._id }, { $set: { maxWeightKg: 1 } });
  await assert.rejects(ManagedUnifiedInboundService.preview(String(world.sku._id), cellCapacityRequest.body, world.actor), error =>
    ['CAPACITY_EXCEEDED', 'CELL_WEIGHT_CAPACITY_EXCEEDED'].includes(error?.code));
});

integrationTest('IT09 wrong owner, facility, purpose, Cell scope, expiry and revoked Access Sessions are rejected', async () => {
  const world = await fixture('it09');
  const { ManagedUnifiedInboundService } = require(path.resolve(__dirname, '../../dist/services/inventory-items/managed-unified-inbound.service'));
  currentStage = 'service_operation';
  const scenarios = [
    ['owner', { customerId: new mongoose.Types.ObjectId() }],
    ['facility', { facilityId: new mongoose.Types.ObjectId() }],
    ['purpose', { allowedPurposes: ['OUTBOUND'] }],
    ['cell', { allowedCellIds: [new mongoose.Types.ObjectId()] }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['revoked', { status: 'REVOKED', revokedAt: new Date() }],
  ];
  for (const [label, patch] of scenarios) {
    const session = await world.accessFor('INBOUND');
    await world.models.Session.updateOne({ _id: session._id, facilityId: world.facility._id }, { $set: patch });
    const body = { accessSessionId: String(session._id), sessionRevision: 0, skuRevision: 0, lines: [{ lineId: `sec-${label}`,
      itemSpecId: String(world.spec._id), itemSpecRevision: 0, quantity: 1, measurementMode: 'SPECIFICATION',
      cellAllocations: [{ cellId: String(world.cells[0]._id), quantity: 1 }] }] };
    await assertRejectedCode(ManagedUnifiedInboundService.preview(String(world.sku._id), body, world.actor), 'ACCESS_SESSION_SCOPE_INVALID');
  }
  assert.equal((await getMovements(world)).length, 0);
});

integrationTest('IT10 two bounded concurrent ADDs cannot double commit or exceed stock/capacity', async () => {
  const world = await fixture('it10');
  const request = await world.inboundRequest({ quantity: 10, allocations: [{ cellId: world.cells[0]._id, quantity: 10 }] });
  const { ManagedUnifiedInboundService } = require(path.resolve(__dirname, '../../dist/services/inventory-items/managed-unified-inbound.service'));
  currentStage = 'service_operation';
  const attempts = await Promise.allSettled([
    ManagedUnifiedInboundService.confirm(String(world.sku._id), request.body, world.actor, `${world.prefix}-concurrent-a`),
    ManagedUnifiedInboundService.confirm(String(world.sku._id), request.body, world.actor, `${world.prefix}-concurrent-b`),
  ]);
  const committed = attempts.filter(row => row.status === 'fulfilled' && row.value.status === 'COMMITTED' && !row.value.replayed);
  assert.equal(committed.length, 1, 'exactly one fresh operation must commit');
  const movements = await getMovements(world), stock = await getStock(world);
  assert.equal(movements.filter(row => row.stockEffect.action === 'ADD').length, 1);
  assert.equal(stock.reduce((n, row) => n + row.quantityOnHand, 0), 10);
  const cell = await world.models.Cell.findById(world.cells[0]._id).lean();
  assert.equal(cell.usedWeightKg, 100);
  assert.equal(cell.usedVolumeM3, 0.08);
  assert.ok(attempts.some(row => row.status === 'rejected'), 'the losing concurrent attempt must fail closed');
});
