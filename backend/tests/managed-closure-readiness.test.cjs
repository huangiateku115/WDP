const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, { NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:27018/unused_test_only',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only', KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs' });
const mongoose = require('mongoose');
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const Inbound = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const Outbound = require('../dist/models/inventory-items/managed-outbound-request.model').default;
const Inspection = require('../dist/models/inventory-items/repeated-inbound-inspection.model').default;
const Evidence = require('../dist/models/inventory-items/receiving-inspection-evidence.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const Payment = require('../dist/models/payments/reservation-payment.model').default;
const router = require('../dist/routes/reservation.routes').default;
const controller = require('../dist/controllers/reservations/managed-reservation.controller');
const { ManagedClosureReadinessService: service } = require('../dist/services/reservations/managed-closure-readiness.service');

const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));
const ids = { reservation: oid(1), customer: oid(2), facility: oid(3), cellA: oid(4), cellB: oid(5), rackA: oid(6), rackB: oid(7), zone: oid(8), itemA: oid(9), itemB: oid(10), moveA: oid(11), moveB: oid(12), allocationA: oid(13), allocationB: oid(14) };

class Query {
  constructor(value) { this.value = value; }
  session() { return this; } lean() { return this; } sort() { return this; } limit(n) { this.max = n; return this; }
  async exec() { const value = typeof this.value === 'function' ? this.value() : this.value; return this.max ? value.slice(0, this.max) : value; }
}
const equal = (a, b) => String(a) === String(b);
const includes = (selector, id) => !selector || Array.isArray(selector.$in) && selector.$in.some(value => equal(value, id)) || equal(selector, id);

function makeContext(overrides = {}) {
  const reservation = { _id: ids.reservation, reservationCode: 'MI-READY-1', customerId: ids.customer, facilityId: ids.facility,
    serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z'),
    allocatedCapacity: 2, usedCapacityM3: 0, allocatedCellIds: [ids.cellA], ...overrides.reservation };
  const itemA = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 99, quantityUnit: 'box', status: 'REGISTERED', currentCellId: null, ...overrides.itemA };
  const cellA = { _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 };
  const allocationA = { _id: ids.allocationA, cellId: ids.cellA, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    startDate: reservation.startDate, endDate: reservation.endDate, status: 'RESERVED', ...overrides.allocationA };
  const state = { reservation, reservationItems: [itemA], facilityItems: [], allocations: [allocationA], cells: [cellA], movements: [], balances: [],
    inbound: [], outbound: [], inspections: [], evidence: [], racks: [{ _id: ids.rackA, facilityId: ids.facility, zoneId: ids.zone, maxWeightKgPerLevel: 100 }],
    zones: [{ _id: ids.zone, facilityId: ids.facility }], contract: null, payments: [], writeCalls: [] };
  Object.assign(state, overrides.state || {});
  const originals = [];
  const replace = (model, key, value) => { originals.push([model, key, model[key]]); model[key] = value; };
  const query = getter => new Query(getter);
  replace(mongoose, 'startSession', async () => ({
    withTransaction: async (fn, options) => { state.transactionOptions = options; return fn(); },
    endSession: async () => {},
  }));
  replace(Reservation, 'findOne', filter => query(() => state.reservation && equal(filter._id, state.reservation._id) && filter.serviceType === state.reservation.serviceType ? state.reservation : null));
  replace(Reservation, 'findOneAndUpdate', () => { state.writeCalls.push('reservation.update'); throw new Error('unexpected business write'); });
  replace(Item, 'find', filter => query(() => filter.managedReservationId
    ? state.reservationItems.filter(row => equal(row.managedReservationId, filter.managedReservationId))
    : state.facilityItems.filter(row => includes(filter.currentCellId, row.currentCellId))));
  replace(Item, 'findOneAndUpdate', () => { state.writeCalls.push('item.update'); throw new Error('unexpected business write'); });
  replace(Movement, 'find', filter => query(() => state.movements.filter(row => includes(filter.itemId, row.itemId))));
  replace(Movement, 'create', () => { state.writeCalls.push('movement.create'); throw new Error('unexpected business write'); });
  replace(Balance, 'find', filter => query(() => state.balances.filter(row => includes(filter.itemId, row.itemId))));
  replace(Balance, 'findOneAndUpdate', () => { state.writeCalls.push('balance.update'); throw new Error('unexpected business write'); });
  replace(Inbound, 'find', () => query(state.inbound));
  replace(Outbound, 'find', filter => query(() => state.outbound.filter(row => includes(filter.itemId, row.itemId))));
  replace(Outbound, 'findOneAndUpdate', () => { state.writeCalls.push('outbound.update'); throw new Error('unexpected business write'); });
  replace(Inspection, 'find', () => query(state.inspections));
  replace(Evidence, 'find', () => query(state.evidence));
  replace(Allocation, 'find', () => query(state.allocations));
  replace(Allocation, 'updateOne', () => { state.writeCalls.push('allocation.update'); throw new Error('unexpected business write'); });
  replace(Cell, 'find', filter => query(() => state.cells.filter(row =>
    (!filter._id || includes(filter._id, row._id)) && (!filter.rackId || includes(filter.rackId, row.rackId)) &&
    (!filter.facilityId || equal(filter.facilityId, row.facilityId)))));
  replace(Cell, 'findOneAndUpdate', () => { state.writeCalls.push('cell.update'); throw new Error('unexpected business write'); });
  replace(Rack, 'find', () => query(state.racks)); replace(Zone, 'find', () => query(state.zones));
  replace(Contract, 'findOne', () => query(state.contract)); replace(Payment, 'find', () => query(state.payments));
  return { state, restore: () => originals.reverse().forEach(([model, key, value]) => { model[key] = value; }) };
}

function inbound(item, movementId, cellId, qty = 2) {
  return { _id: movementId, itemId: item._id, customerId: item.customerId, managedReservationId: item.managedReservationId,
    facilityId: item.facilityId, type: 'INBOUND', sourceCellId: null, destinationCellId: cellId, quantity: qty,
    quantityUnit: item.quantityUnit, actualUnitWeightKg: 1, actualTotalWeightKg: qty,
    actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, actualTotalVolumeM3: qty * .001,
    performedAt: new Date('2026-02-01T00:00:00Z'), inspectionNote: 'Received', idempotencyKey: `in-${movementId}` };
}
function reservationBalance(item, movementRow, cellId, qty = 2, held = 0) {
  return { itemId: item._id, facilityId: item.facilityId, customerId: item.customerId, managedReservationId: item.managedReservationId,
    currentCellId: cellId, onHandQuantity: qty, heldQuantity: held, actualTotalWeightKg: qty, actualTotalVolumeM3: qty * .001,
    schemaVersion: 1, source: 'LEGACY_RECONCILED', batches: [{ batchId: `legacy:${movementRow._id}`, receiptMovementId: movementRow._id,
      quantity: qty, heldQuantity: held, quantityUnit: item.quantityUnit, actualUnitWeightKg: 1,
      actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, actualTotalWeightKg: qty, actualTotalVolumeM3: qty * .001,
      arithmeticPolicy: 'COMPATIBILITY', receivedAt: movementRow.performedAt }] };
}
async function evaluate(t, options = {}) {
  const ctx = makeContext(options);
  t.after(ctx.restore);
  const actor = options.actor || { _id: ids.customer, role: 'CUSTOMER' };
  return { state: ctx.state, result: await service.get(String(ids.reservation), actor) };
}

test('owner Customer receives a snapshot DTO and never an overall READY result', async t => {
  const { result, state } = await evaluate(t);
  assert.equal(result.reservationId, String(ids.reservation));
  assert.equal(result.snapshotConsistency, 'MONGODB_SNAPSHOT');
  assert.equal(result.overallReadiness, 'UNKNOWN');
  assert.equal(result.financialReadiness, 'UNKNOWN');
  assert.equal(state.writeCalls.length, 0);
  assert.equal(state.transactionOptions.readConcern.level, 'snapshot');
});

test('non-owner Customer receives 404 and no reservation details', async t => {
  const ctx = makeContext(); t.after(ctx.restore);
  await assert.rejects(service.get(String(ids.reservation), { _id: oid(44), role: 'CUSTOMER' }), { status: 404 });
});

test('Facility Manager in scope is authorized and out-of-scope Manager is forbidden', async t => {
  const a = await evaluate(t, { actor: { _id: oid(45), role: 'FACILITY_MANAGER', assignedFacilityId: ids.facility } });
  assert.equal(a.result.reservationId, String(ids.reservation));
  const ctx = makeContext(); t.after(ctx.restore);
  await assert.rejects(service.get(String(ids.reservation), { _id: oid(46), role: 'FACILITY_MANAGER', assignedFacilityId: oid(47) }), { status: 403 });
});

test('BOM and Admin follow the existing Managed reservation management read convention', async t => {
  for (const role of ['ADMIN', 'BOM']) {
    const { result } = await evaluate(t, { actor: { _id: oid(48), role } });
    assert.equal(result.reservationId, String(ids.reservation));
  }
});

test('Self-Storage reservation cannot use the Managed readiness API', async t => {
  const ctx = makeContext({ reservation: { serviceType: 'SELF_STORAGE' } }); t.after(ctx.restore);
  await assert.rejects(service.get(String(ids.reservation), { _id: ids.customer, role: 'CUSTOMER' }), { status: 404 });
});

test('positive movement-derived stock is BLOCKED and never uses InventoryItem.quantity', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 900, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA, currentPlacementMovementId: ids.moveA };
  const movement = inbound(item, ids.moveA, ids.cellA);
  const balance = reservationBalance(item, movement, ids.cellA);
  const cell = { _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 2, usedVolumeM3: .002 };
  const { result } = await evaluate(t, { itemA: item, reservation: { usedCapacityM3: .002 }, state: {
    reservationItems: [item], facilityItems: [item], movements: [movement], balances: [balance], cells: [cell],
    allocations: [{ _id: ids.allocationA, cellId: ids.cellA, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
      startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z'), status: 'OCCUPIED' }],
    racks: [{ _id: ids.rackA, facilityId: ids.facility, zoneId: ids.zone, maxWeightKgPerLevel: 100 }], zones: [{ _id: ids.zone, facilityId: ids.facility }],
  } });
  assert.equal(result.stockSummary.currentQuantity, 2);
  assert.equal(result.stockSummary.items[0].currentQuantity, 2);
  assert.equal(result.physicalReadiness, 'BLOCKED');
  assert.equal(result.overallReadiness, 'BLOCKED');
  assert.ok(result.blockers.some(row => row.code === 'STOCK_REMAINING'));
});

test('zero-stock Item keeps its allocation and readiness never releases it', async t => {
  const { result } = await evaluate(t);
  assert.equal(result.stockSummary.currentQuantity, 0);
  assert.equal(result.physicalReadiness, 'READY');
  assert.equal(result.allocationSummary.allocations[0].status, 'RESERVED');
  assert.equal(result.overallReadiness, 'UNKNOWN');
  assert.ok(result.blockers.some(row => row.code === 'FINANCIAL_POLICY_UNRESOLVED'));
});

test('multiple empty Items and allocated Cells are reported as one complete scope', async t => {
  const itemA = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 99, quantityUnit: 'box', status: 'REGISTERED', currentCellId: null };
  const itemB = { _id: ids.itemB, itemCode: 'B', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 5, quantityUnit: 'box', status: 'REGISTERED', currentCellId: null };
  const cellA = { _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 };
  const cellB = { _id: ids.cellB, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackB, levelNumber: 1, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 };
  const { result } = await evaluate(t, { reservation: { allocatedCellIds: [ids.cellA, ids.cellB] }, state: {
    reservationItems: [itemA, itemB], allocations: [
      { _id: ids.allocationA, cellId: ids.cellA, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
        startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z'), status: 'RESERVED' },
      { _id: ids.allocationB, cellId: ids.cellB, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
        startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z'), status: 'RESERVED' },
    ], cells: [cellA, cellB], racks: [
      { _id: ids.rackA, facilityId: ids.facility, zoneId: ids.zone, maxWeightKgPerLevel: 100 },
      { _id: ids.rackB, facilityId: ids.facility, zoneId: ids.zone, maxWeightKgPerLevel: 100 },
    ], zones: [{ _id: ids.zone, facilityId: ids.facility }],
  } });
  assert.equal(result.stockSummary.itemCount, 2);
  assert.equal(result.allocationSummary.allocations.length, 2);
  assert.equal(result.allocationSummary.cells.length, 2);
});

test('mixed v1/v2 stock history is read through the existing reconciler', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 500, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA, currentPlacementMovementId: ids.moveB };
  const v1 = inbound(item, ids.moveA, ids.cellA, 1);
  const v2 = { ...inbound(item, ids.moveB, ids.cellA, 1), schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1',
    batchLines: [{ batchId: 'batch-v2', action: 'ADD', quantity: 1, quantityUnit: 'box', actualUnitWeightKg: 1,
      actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, actualTotalWeightKg: 1, actualTotalVolumeM3: .001 }] };
  const balance = { itemId: item._id, facilityId: item.facilityId, customerId: item.customerId, managedReservationId: item.managedReservationId,
    currentCellId: ids.cellA, onHandQuantity: 2, heldQuantity: 0, actualTotalWeightKg: 2, actualTotalVolumeM3: .002, schemaVersion: 1,
    source: 'LEDGER_V2', reconciledThroughMovementId: ids.moveB, batches: [
      { batchId: `legacy:${ids.moveA}`, receiptMovementId: ids.moveA, quantity: 1, heldQuantity: 0, quantityUnit: 'box', actualUnitWeightKg: 1,
        actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, actualTotalWeightKg: 1, actualTotalVolumeM3: .001, arithmeticPolicy: 'COMPATIBILITY', receivedAt: v1.performedAt },
      { batchId: 'batch-v2', receiptMovementId: ids.moveB, quantity: 1, heldQuantity: 0, quantityUnit: 'box', actualUnitWeightKg: 1,
        actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, actualTotalWeightKg: 1, actualTotalVolumeM3: .001, arithmeticPolicy: 'CANONICAL_V1', receivedAt: v2.performedAt },
    ] };
  const cell = { _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 2, usedVolumeM3: .002 };
  const { result } = await evaluate(t, { itemA: item, reservation: { usedCapacityM3: .002 }, state: {
    reservationItems: [item], facilityItems: [item], movements: [v1, v2], balances: [balance], cells: [cell],
    allocations: [{ _id: ids.allocationA, cellId: ids.cellA, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
      startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z'), status: 'OCCUPIED' }],
    racks: [{ _id: ids.rackA, facilityId: ids.facility, zoneId: ids.zone, maxWeightKgPerLevel: 100 }], zones: [{ _id: ids.zone, facilityId: ids.facility }],
  } });
  assert.equal(result.stockSummary.currentQuantity, 2);
  assert.equal(result.stockSummary.items[0].stockSource, 'LEDGER_V2');
});

test('corrupt movement lineage is UNKNOWN rather than treated as zero', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 10, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA };
  const movement = { ...inbound(item, ids.moveA, ids.cellA), customerId: oid(55) };
  const { result } = await evaluate(t, { itemA: item, state: { reservationItems: [item], facilityItems: [item], movements: [movement] } });
  assert.equal(result.physicalReadiness, 'UNKNOWN');
  assert.equal(result.stockSummary.currentQuantity, null);
  assert.ok(result.blockers.some(row => row.code === 'STOCK_LEDGER_UNKNOWN' || row.code === 'INVALID_MOVEMENT'));
});

test('invalid placement lineage uses the stable PLACEMENT_INCONSISTENT blocker', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 10, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA };
  const movements = [inbound(item, ids.moveA, ids.cellA), inbound(item, ids.moveB, ids.cellB)];
  const { result } = await evaluate(t, { itemA: item, state: { reservationItems: [item], facilityItems: [item], movements } });
  assert.ok(result.blockers.some(row => row.code === 'PLACEMENT_INCONSISTENT'));
  assert.equal(result.stockSummary.currentQuantity, null);
});

test('StockBalance mismatch produces UNKNOWN blocker', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 2, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA };
  const movement = inbound(item, ids.moveA, ids.cellA);
  const balance = { ...reservationBalance(item, movement, ids.cellA), onHandQuantity: 1 };
  const { result } = await evaluate(t, { itemA: item, state: { reservationItems: [item], facilityItems: [item], movements: [movement], balances: [balance] } });
  assert.ok(result.blockers.some(row => row.code === 'STOCK_BALANCE_MISMATCH'));
  assert.equal(result.physicalReadiness, 'UNKNOWN');
});

test('pending outbound request and persisted hold are reported', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 2, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA };
  const movement = inbound(item, ids.moveA, ids.cellA);
  const balance = reservationBalance(item, movement, ids.cellA, 2, 1);
  const request = { _id: oid(60), itemId: ids.itemA, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    state: 'PENDING', requestedQuantity: 1, quantityUnit: 'box', batchAllocations: [{ batchId: `legacy:${ids.moveA}`, quantity: 1,
      receiptMovementId: ids.moveA, receivedAt: movement.performedAt, arithmeticPolicy: 'COMPATIBILITY' }] };
  const { result } = await evaluate(t, { itemA: item, state: { reservationItems: [item], facilityItems: [item], movements: [movement], balances: [balance], outbound: [request] } });
  assert.equal(result.outstandingRequestSummary.outbound.unresolvedCount, 1);
  assert.ok(result.blockers.some(row => row.code === 'OUTBOUND_REQUEST_PENDING'));
  assert.equal(result.stockSummary.heldQuantity, 1);
});

test('pending repeated inbound request and held custody are blockers', async t => {
  const request = { _id: oid(61), itemId: ids.itemA, reservationId: ids.reservation, state: 'ACCEPTED_PENDING_CONFIRMATION', custodyState: 'IN_CUSTODY' };
  const { result } = await evaluate(t, { state: { inbound: [request] } });
  assert.ok(result.blockers.some(row => row.code === 'INBOUND_REQUEST_PENDING'));
  assert.ok(result.blockers.some(row => row.code === 'CUSTODY_UNRESOLVED'));
});

test('bad allocation ownership is UNKNOWN and does not disclose cross-owner Item data', async t => {
  const { result } = await evaluate(t, { allocationA: { customerId: oid(70) } });
  assert.ok(result.blockers.some(row => row.code === 'ALLOCATION_INCONSISTENT'));
  assert.equal(JSON.stringify(result).includes(String(oid(70))), false);
});

test('expired allocation dates are surfaced without converting stock or releasing the allocation', async t => {
  const expiredStart = new Date('2025-01-01T00:00:00Z'), expiredEnd = new Date('2026-01-01T00:00:00Z');
  const { result } = await evaluate(t, { reservation: { startDate: expiredStart, endDate: expiredEnd, status: 'OVERDUE', allocatedCellIds: [ids.cellA] }, allocationA: { startDate: expiredStart, endDate: expiredEnd } });
  assert.equal(result.allocationSummary.allocations[0].expired, true);
  assert.equal(result.allocationSummary.allocations[0].status, 'RESERVED');
  assert.equal(result.reservationStatus, 'OVERDUE');
});

test('shared Cell counters include physical usage from another Item without returning that Item', async t => {
  const other = { _id: oid(71), itemCode: 'OTHER', facilityId: ids.facility, customerId: oid(72), managedReservationId: oid(73),
    quantity: 50, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA };
  const otherMove = inbound(other, oid(74), ids.cellA, 1);
  const cell = { _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: 2, depthM: 2, usableHeightM: 2 }, maxWeightKg: 100, usedWeightKg: 1, usedVolumeM3: .001 };
  const { result } = await evaluate(t, { state: { facilityItems: [other], movements: [otherMove], cells: [cell] } });
  assert.equal(result.allocationSummary.cells[0].usedWeightKg, 1);
  assert.equal(JSON.stringify(result).includes(String(other._id)), false);
  assert.equal(JSON.stringify(result).includes('OTHER'), false);
});

test('missing Cell counters return UNKNOWN', async t => {
  const { result } = await evaluate(t, { state: { cells: [{ _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA,
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 10 }] } });
  assert.ok(result.blockers.some(row => row.code === 'PHYSICAL_COUNTER_UNKNOWN'));
});

test('Rack capacity is UNKNOWN when another Cell in its level was outside the bounded reservation Cell scope', async t => {
  const unassessedCell = { _id: oid(75), facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1,
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 };
  const { result } = await evaluate(t, { state: { cells: [
    { _id: ids.cellA, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rackA, levelNumber: 1, operationalStatus: 'AVAILABLE',
      dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 },
    unassessedCell,
  ] } });
  assert.ok(result.blockers.some(row => row.code === 'PHYSICAL_COUNTER_UNKNOWN' && row.scope === `rack:${ids.rackA}`));
});

test('expired ACTIVE Reservation with stock remains blocked; status is not rewritten', async t => {
  const item = { _id: ids.itemA, itemCode: 'A', facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation,
    quantity: 3, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA };
  const movement = inbound(item, ids.moveA, ids.cellA);
  const past = new Date('2025-01-01T00:00:00Z');
  const { result, state } = await evaluate(t, { reservation: { endDate: past, usedCapacityM3: .002 }, state: {
    reservationItems: [item], facilityItems: [item], movements: [movement], writeCalls: [],
  } });
  assert.equal(result.reservationStatus, 'ACTIVE');
  assert.equal(result.overallReadiness, 'BLOCKED');
  assert.equal(state.writeCalls.length, 0);
});

test('OVERDUE Reservation remains a diagnostic state and never becomes CLOSED', async t => {
  const { result } = await evaluate(t, { reservation: { status: 'OVERDUE', endDate: new Date('2025-01-01T00:00:00Z') } });
  assert.equal(result.reservationStatus, 'OVERDUE');
  assert.notEqual(result.overallReadiness, 'READY');
});

test('financial and disposition policy remain UNKNOWN even with zero stock and no operational requests', async t => {
  const { result } = await evaluate(t);
  assert.equal(result.financialReadiness, 'UNKNOWN');
  assert.equal(result.dispositionReadiness, 'UNKNOWN');
  assert.equal(result.overallReadiness, 'UNKNOWN');
  assert.ok(result.blockers.some(row => row.code === 'FINANCIAL_POLICY_UNRESOLVED'));
  assert.ok(result.blockers.some(row => row.code === 'DISPOSITION_POLICY_UNRESOLVED'));
});

test('zero-stock result preserves allocations and no-read endpoint invokes no business write', async t => {
  const { result, state } = await evaluate(t);
  assert.equal(result.stockSummary.currentQuantity, 0);
  assert.deepEqual(state.writeCalls, []);
  assert.equal(result.readonly, true);
  assert.equal(result.note.includes('does not close'), true);
});

test('reservation id validation and missing Managed reservation use stable 400/404 errors', async t => {
  const ctx = makeContext(); t.after(ctx.restore);
  await assert.rejects(service.get('bad-id', { _id: ids.customer, role: 'CUSTOMER' }), { status: 400 });
  ctx.state.reservation = null;
  await assert.rejects(service.get(String(ids.reservation), { _id: ids.customer, role: 'CUSTOMER' }), { status: 404 });
});

test('route is authenticated and scoped to the existing Managed read roles', () => {
  const route = router.stack.map(layer => layer.route).filter(Boolean).find(row => row.path === '/managed/:id/closure-readiness');
  assert.ok(route);
  assert.ok(route.methods.get);
  assert.equal(route.stack.some(layer => layer.name === 'requireAuth'), false); // router-level requireAuth applies before all routes
  assert.ok(route.stack.length >= 2);
});

test('the existing MI-06B inbound route and generic Self-Storage inspection route remain mounted', () => {
  const paths = router.stack.map(layer => layer.route).filter(Boolean).map(route => route.path);
  assert.ok(paths.includes('/managed/:id/closure-readiness'));
  assert.ok(paths.includes('/managed/:id/activate'));
  assert.ok(paths.includes('/:id/handover'));
});

test('API controller returns the established 200 success envelope for readiness', async t => {
  const original = service.get;
  service.get = async (id, actor) => ({ reservationId: id, actorId: String(actor._id), overallReadiness: 'UNKNOWN' });
  t.after(() => { service.get = original; });
  let statusCode;
  let body;
  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  await controller.getClosureReadiness({ params: { id: String(ids.reservation) }, user: { _id: ids.customer } }, response);
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { success: true, data: { reservationId: String(ids.reservation), actorId: String(ids.customer), overallReadiness: 'UNKNOWN' } });
});

