const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:27017/mi-read-test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const { Types } = require('mongoose');
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Stock = require('../dist/models/inventory-items/managed-cell-stock.model').default;
const Instance = require('../dist/models/inventory-items/managed-item-instance.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const InventoryItem = require('../dist/models/inventory-items/inventory-item.model').default;
const { ManagedCellStockReadService, sameCellDiagnosticLines } = require('../dist/services/inventory-items/managed-cell-stock-read.service');

class Query {
  constructor(value) { this.value = value; }
  sort() { return this; }
  limit() { return this; }
  select() { return this; }
  lean() { return this; }
  exec() { return Promise.resolve(this.value); }
}

function fixture(t, { cells, movements = [], reservations = [] }) {
  t.mock.method(Cell, 'find', () => new Query(cells));
  t.mock.method(Rack, 'find', () => new Query([...new Map(cells.map(row => [String(row.rackId), { _id: row.rackId, rackCode: 'R-1', maxWeightKgPerLevel: 500 }])).values()]));
  t.mock.method(Stock, 'find', () => new Query([]));
  t.mock.method(Instance, 'find', () => new Query([]));
  t.mock.method(Movement, 'find', () => new Query(movements));
  t.mock.method(Allocation, 'find', () => new Query([]));
  t.mock.method(Reservation, 'find', () => new Query(reservations));
  t.mock.method(InventoryItem, 'find', () => new Query([]));
}

function cell(cellNumber, usedWeightKg = 0) {
  return { _id: new Types.ObjectId(), facilityId: new Types.ObjectId('507f1f77bcf86cd799439001'),
    rackId: new Types.ObjectId('507f1f77bcf86cd799439002'), levelNumber: 1, cellNumber,
    code: `R1-L1-C${cellNumber}`, maxWeightKg: 400, usedWeightKg, usedVolumeM3: 0,
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } };
}

const manager = { _id: new Types.ObjectId(), role: 'FACILITY_MANAGER', assignedFacilityId: new Types.ObjectId('507f1f77bcf86cd799439001') };

test('facility diagnostics keep empty verified Cells separate from unverified facility history', async t => {
  const cells = [cell(1), cell(2)];
  fixture(t, { cells });
  const result = await ManagedCellStockReadService.facilityDiagnostics(manager);
  assert.equal(result.cells.length, 2);
  assert.ok(result.cells.every(row => row.reconciliationStatus === 'EMPTY_VERIFIED'));
  assert.ok(result.cells.every(row => row.levelCapacityStatus === 'WITHIN_LIMIT'), JSON.stringify(result.cells));
  assert.ok(result.reservationSummary.length === 0);
});

test('legacy movement blocks its Cell instead of being labelled V4 reconciled or empty', async t => {
  const cells = [cell(1), cell(2)];
  fixture(t, { cells, movements: [{ _id: new Types.ObjectId(), schemaVersion: 3, sourceCellId: cells[0]._id, performedAt: new Date() }] });
  const result = await ManagedCellStockReadService.facilityDiagnostics(manager);
  assert.equal(result.cells[0].reconciliationStatus, 'LEGACY_BLOCKED');
  assert.equal(result.cells[0].reasonCode, 'LEGACY_STOCK_REQUIRES_RECONCILIATION');
  assert.equal(result.cells[1].reconciliationStatus, 'UNKNOWN', 'Facility-wide incomplete history cannot be presented as empty');
});

test('truncated facility movement evidence stays UNKNOWN at Cell and Level scope', async t => {
  const cells = [cell(1), cell(2)];
  const movements = Array.from({ length: 10001 }, (_, index) => ({ schemaVersion: 4, _id: new Types.ObjectId(), performedAt: new Date(index) }));
  fixture(t, { cells, movements });
  const result = await ManagedCellStockReadService.facilityDiagnostics(manager);
  assert.ok(result.cells.every(row => row.reconciliationStatus === 'UNKNOWN'));
  assert.ok(result.cells.every(row => row.levelCapacityStatus === 'UNKNOWN'));
  assert.ok(result.cells.every(row => row.stockQuantity === null));
});

test('shared Rack Level overload is MISMATCH, never a within-limit result', async t => {
  const cells = [cell(1, 300), cell(2, 300)];
  fixture(t, { cells });
  const result = await ManagedCellStockReadService.facilityDiagnostics(manager);
  assert.ok(result.cells.every(row => row.levelCapacityStatus === 'MISMATCH'));
  assert.ok(result.cells.every(row => row.reconciliationStatus === 'MISMATCH'));
});

test('Facility Staff cannot read cross-customer raw Cell diagnostics', async t => {
  const source = cell(1);
  t.mock.method(Cell, 'findOne', () => new Query(source));
  const staff = { _id: new Types.ObjectId(), role: 'FACILITY_STAFF', assignedFacilityId: source.facilityId };
  await assert.rejects(
    ManagedCellStockReadService.cellStock(String(source._id), staff),
    error => error.code === 'FORBIDDEN' && error.status === 403,
  );
});

test('Facility Manager cannot read Cell diagnostics outside the assigned Facility', async t => {
  const source = cell(1);
  t.mock.method(Cell, 'findOne', () => new Query(source));
  const managerFromAnotherFacility = { ...manager, assignedFacilityId: new Types.ObjectId('507f1f77bcf86cd799439099') };
  await assert.rejects(
    ManagedCellStockReadService.cellStock(String(source._id), managerFromAnotherFacility),
    error => error.code === 'CELL_NOT_FOUND' && error.status === 404,
  );
});

test('Cell diagnostics keep expected values UNKNOWN when a Movement has no SKU scope', async t => {
  const source = cell(1, 4);
  t.mock.method(Cell, 'findOne', () => new Query(source));
  t.mock.method(Stock, 'find', () => new Query([]));
  t.mock.method(Instance, 'find', () => new Query([]));
  t.mock.method(Movement, 'find', () => new Query([{ _id: new Types.ObjectId(), facilityId: source.facilityId, schemaVersion: 4, sourceCellId: source._id }]));
  t.mock.method(Allocation, 'find', () => new Query([]));
  t.mock.method(InventoryItem, 'find', () => new Query([]));
  const result = await ManagedCellStockReadService.cellStock(String(source._id), manager);
  assert.equal(result.diagnostics.evidenceStatus, 'UNKNOWN');
  assert.equal(result.diagnostics.ledger.expectedWeightKg, null);
  assert.equal(result.diagnostics.projection.weightKg, null);
  assert.equal(result.diagnostics.difference.counterMinusLedgerWeightKg, null);
});

test('Cell diagnostics report verified ledger-versus-counter differences without writing stock', async t => {
  const source = cell(1, 4);
  t.mock.method(Cell, 'findOne', () => new Query(source));
  t.mock.method(Stock, 'find', () => new Query([]));
  t.mock.method(Instance, 'find', () => new Query([]));
  t.mock.method(Movement, 'find', () => new Query([]));
  t.mock.method(Allocation, 'find', () => new Query([]));
  t.mock.method(InventoryItem, 'find', () => new Query([]));
  const result = await ManagedCellStockReadService.cellStock(String(source._id), manager);
  assert.equal(result.diagnostics.evidenceStatus, 'COMPLETE');
  assert.equal(result.diagnostics.ledger.status, 'EMPTY_VERIFIED');
  assert.equal(result.diagnostics.ledger.expectedWeightKg, 0);
  assert.equal(result.diagnostics.projection.weightKg, 0);
  assert.equal(result.diagnostics.difference.counterMinusLedgerWeightKg, 4);
  assert.equal(result.reconciliationStatus, 'MISMATCH');
});

test('Cell diagnostic compares batch evidence and preserves per-Cell PhysicalUnit load semantics', () => {
  const batch = { kind: 'BATCH', itemSpecId: 'spec-1', receiptId: 'receipt-1', reservationId: 'reservation-1', quantity: 2, weightKg: 7, volumeM3: 0.01 };
  assert.equal(sameCellDiagnosticLines([batch], [{ ...batch }]), true);
  assert.equal(sameCellDiagnosticLines([batch], [{ ...batch, weightKg: 8 }]), false);
  const unit = { kind: 'PHYSICAL_UNIT', itemSpecId: 'spec-2', receiptId: 'receipt-2', itemInstanceId: 'unit-1', reservationId: 'reservation-1', quantity: 1, weightKg: 3, volumeM3: 0.02 };
  assert.equal(sameCellDiagnosticLines([unit], [{ ...unit, quantity: 0 }]), true, 'a multi-Cell unit is not counted again per footprint Cell');
});
