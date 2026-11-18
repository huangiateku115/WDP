const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const domain = require('../dist/services/inventory-items/managed-cell-stock.domain');
const { reconcileManagedV4SkuEvidence } = require('../dist/services/inventory-items/managed-cell-stock-read.service');
const { ManagedCellStockReadService } = require('../dist/services/inventory-items/managed-cell-stock-read.service');
const { mapManagedV3InventoryDetail, InventoryItemService } = require('../dist/services/inventory-items/inventory-item.service');
const InventoryItemModel = require('../dist/models/inventory-items/inventory-item.model').default;
const { ManagedV4StockBatchReadService } = require('../dist/services/inventory-items/managed-v4-stock-batch-read.service');
const SpecModel = require('../dist/models/inventory-items/item-specification.model').default;
const StockModel = require('../dist/models/inventory-items/managed-cell-stock.model').default;
const InstanceModel = require('../dist/models/inventory-items/managed-item-instance.model').default;
const MovementModel = require('../dist/models/inventory-items/item-movement.model').default;
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const CellModel = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const CategoryModel = require('../dist/models/inventory-items/managed-inventory-category.model').default;
const CustomerProfileModel = require('../dist/models/users/customer-profile.model').default;
const customerProfileController = require('../dist/controllers/users/customer-profile.controller');
const { EmailService } = require('../dist/services/email/email.service');

const ids = Object.fromEntries(['sku', 'spec', 'reservation', 'facility', 'customer', 'cell', 'cell2', 'unit'].map((name, i) => [name, new Types.ObjectId(String(i + 1).padStart(24, '0'))]));
const dimensions = { widthM: .2, depthM: .2, heightM: .2 };
function add(revision, receiptId, quantity = 10) {
  const line = { itemSpecId: ids.spec, reservationId: ids.reservation, cellId: ids.cell, receiptId, quantity,
    quantityUnitSnapshot: 'box', unitWeightKgSnapshot: 1, unitVolumeM3Snapshot: .008, unitDimensionsSnapshot: dimensions,
    allocatedWeightKg: quantity, allocatedVolumeM3: quantity * .008 };
  return { _id: new Types.ObjectId(), itemId: ids.sku, managedReservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    schemaVersion: 4, operationId: `op-${revision}`, quantity, actualTotalWeightKg: quantity, actualTotalVolumeM3: quantity * .008, performedAt: new Date(`2026-01-0${revision}T00:00:00Z`),
    stockEffect: { action: 'ADD', operationId: `op-${revision}`, requestHash: String(revision).padStart(64, 'a'), ledgerRevision: revision, source: [], destination: [line] } };
}
function reconcile(events, stocks, overrides = {}) {
  return reconcileManagedV4SkuEvidence({ skuId: ids.sku, movements: events, stocks, instances: [],
    specifications: [{ _id: ids.spec, quantityUnitId: { _id: ids.unit, name: 'thùng' } }], canonicalScopeMatches: true, initialized: false, ...overrides });
}
class MockQuery {
  constructor(rows) { this.rows = rows; this.max = Infinity; }
  select() { return this; } populate() { return this; } sort() { return this; } skip() { return this; } limit(n) { this.max = n; return this; } lean() { return this; }
  async exec() { return this.rows.slice(0, this.max); }
}

test('shared reconciler replays multiple receipts and reports physical totals without changing ledger semantics', () => {
  const events = [add(1, 'r1', 4), add(2, 'r2', 6)];
  const replay = domain.replayManagedStockMovements(events);
  const result = reconcile(events, replay.lots);
  assert.equal(result.ledgerStatus, 'REPLAYED');
  assert.equal(result.totalWeightKg, 10);
  assert.equal(result.totalVolumeM3, .08);
  assert.deepEqual(result.quantityByUnit.map(row => [row.quantityUnit, row.quantity]), [['thùng', 10]]);
});

test('shared reconciler fails closed for projection, scope, invalid ledger, and bounded history failures', () => {
  const event = add(1, 'r1');
  const replay = domain.replayManagedStockMovements([event]);
  assert.equal(reconcile([event], []).ledgerStatus, 'UNKNOWN');
  assert.equal(reconcile([event], [], { canonicalScopeMatches: false }).reasonCode, 'STOCK_SCOPE_MISMATCH');
  const invalid = { ...event, stockEffect: { ...event.stockEffect, ledgerRevision: 2 } };
  assert.equal(reconcile([invalid], replay.lots).ledgerStatus, 'MISMATCH');
  const over = reconcile(Array.from({ length: 10001 }, () => ({ schemaVersion: 4 })), []);
  assert.equal(over.ledgerStatus, 'UNKNOWN');
  assert.equal(over.reasonCode, 'MOVEMENT_HISTORY_LIMIT_EXCEEDED');
  assert.equal(over.totalWeightKg, null);
});

test('verified empty evidence is NOT_REQUIRED and unknown evidence never becomes zero', () => {
  const empty = reconcileManagedV4SkuEvidence({ skuId: ids.sku, movements: [], stocks: [], instances: [], specifications: [], canonicalScopeMatches: true, initialized: true });
  assert.equal(empty.ledgerStatus, 'NOT_REQUIRED');
  assert.equal(empty.totalWeightKg, 0);
  const unknown = reconcile([], [], { initialized: false });
  assert.equal(unknown.ledgerStatus, 'UNKNOWN');
  assert.equal(unknown.totalWeightKg, null);
});

test('detail mapper adds V4/category fields, preserves legacy fields, and suppresses unverified metrics', () => {
  const legacy = { _id: ids.sku, category: 'LEGACY_LABEL', quantity: undefined, totalWeightKg: undefined, status: 'ACTIVE' };
  const category = { _id: ids.spec, code: 'ARCHIVE', name: 'Archive' };
  const verified = mapManagedV3InventoryDetail(legacy, category, { ledgerStatus: 'REPLAYED', reconciliationStatus: 'UNKNOWN', totalWeightKg: 10, totalVolumeM3: .08,
    byCell: [{ cellId: ids.cell }], itemSpecifications: [{ itemSpecId: ids.spec, quantityUnitId: String(ids.unit), quantityUnit: 'thùng', quantityOnHand: 10 }] });
  assert.equal(verified.category, 'LEGACY_LABEL');
  assert.equal(verified.categoryCode, 'ARCHIVE');
  assert.equal(verified.stock.totalQuantity, 10);
  assert.equal(verified.stock.totalWeightKg, 10);
  assert.equal(verified.stock.totalVolumeM3, .08);
  const unknown = mapManagedV3InventoryDetail(legacy, null, { ledgerStatus: 'UNKNOWN', reconciliationStatus: 'UNKNOWN', reasonCode: 'MISSING_EVIDENCE',
    totalWeightKg: null, totalVolumeM3: null, byCell: [], itemSpecifications: [] });
  assert.equal(unknown.stock.totalQuantity, null);
  assert.equal(unknown.stock.totalWeightKg, null);
  assert.equal(unknown.stock.unavailableReason, 'MISSING_EVIDENCE');
});

test('batch loader uses bounded set queries, reuses the reconciler, and keeps verified-empty SKUs distinct', async t => {
  const sku2 = new Types.ObjectId(), reservation2 = new Types.ObjectId();
  const event = add(1, 'r1', 10);
  const instanceCommon = { itemSpecId: ids.spec, reservationId: ids.reservation, receiptId: 'instance-r', itemInstanceId: 'inst-1', quantity: 1,
    unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: .05, unitDimensionsSnapshot: { widthM: .5, depthM: .5, heightM: .2 } };
  event.stockEffect.destination.push({ ...instanceCommon, cellId: ids.cell, allocatedWeightKg: 6, allocatedVolumeM3: .03 },
    { ...instanceCommon, cellId: ids.cell2, allocatedWeightKg: 4, allocatedVolumeM3: .02 });
  event.quantity = 11; event.actualTotalWeightKg = 20; event.actualTotalVolumeM3 = .13;
  const events = [event];
  const replay = domain.replayManagedStockMovements(events);
  const skus = [
    { _id: ids.sku, inventorySchemaVersion: 3, facilityId: ids.facility, customerId: ids.customer, reservationId: ids.reservation, quantity: null, currentCellId: null },
    { _id: sku2, inventorySchemaVersion: 3, facilityId: ids.facility, customerId: ids.customer, reservationId: reservation2, quantity: null, currentCellId: null },
  ];
  let queryCount = 0, skuReaderCalls = 0;
  const recordQuery = (rows, filter, key) => { queryCount++; const allowed = new Set(filter[key].$in.map(String)); return new MockQuery(rows.filter(row => allowed.has(String(row[key])))); };
  t.mock.method(SpecModel, 'find', filter => recordQuery([{ _id: ids.spec, skuId: ids.sku, customerId: ids.customer, reservationId: ids.reservation, facilityId: ids.facility,
    quantityUnitId: { _id: ids.unit, name: 'thùng' }, code: 'BOX' }], filter, 'skuId'));
  t.mock.method(StockModel, 'find', filter => recordQuery(replay.lots, filter, 'skuId'));
  t.mock.method(InstanceModel, 'find', filter => recordQuery(replay.instances, filter, 'skuId'));
  t.mock.method(MovementModel, 'find', filter => recordQuery(events, filter, 'itemId'));
  t.mock.method(ReservationModel, 'find', filter => { queryCount++; const allowed = new Set(filter._id.$in.map(String)); return new MockQuery([
    { _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility }, { _id: reservation2, customerId: ids.customer, facilityId: ids.facility },
  ].filter(row => allowed.has(String(row._id)))); });
  t.mock.method(CellModel, 'find', filter => { queryCount++; const allowed = new Set(filter._id.$in.map(String)); return new MockQuery([ids.cell, ids.cell2].map(_id => ({ _id, facilityId: ids.facility })).filter(row => allowed.has(String(row._id)))); });
  t.mock.method(ManagedCellStockReadService, 'skuStock', async () => { skuReaderCalls++; throw new Error('single-SKU reader must not be called'); });
  const result = await ManagedV4StockBatchReadService.summarize(skus, { _id: ids.customer, role: 'ADMIN' });
  assert.equal(queryCount, 6); assert.equal(skuReaderCalls, 0);
  assert.equal(result.get(String(ids.sku)).totalQuantity, 11);
  assert.equal(result.get(String(ids.sku)).totalWeightKg, 20);
  assert.equal(result.get(String(ids.sku)).totalVolumeM3, .13);
  assert.equal(result.get(String(sku2)).ledgerStatus, 'NOT_REQUIRED');
  assert.equal(result.get(String(sku2)).totalWeightKg, 0);
  for (const role of ['BOM', 'FACILITY_MANAGER', 'FACILITY_STAFF']) {
    const scoped = await ManagedV4StockBatchReadService.summarize(skus, { _id: ids.customer, role, assignedFacilityId: ids.facility });
    assert.equal(scoped.get(String(ids.sku)).totalWeightKg, 20);
  }
  await assert.rejects(ManagedV4StockBatchReadService.summarize(skus, { _id: ids.customer, role: 'FACILITY_STAFF', assignedFacilityId: ids.cell }),
    error => error.status === 403 && error.code === 'FACILITY_SCOPE_REQUIRED');
  await assert.rejects(ManagedV4StockBatchReadService.summarize(skus, { _id: ids.customer, role: 'CUSTOMER' }), error => error.status === 403);
  const detailEvidence = reconcileManagedV4SkuEvidence({ skuId: ids.sku, movements: events, stocks: replay.lots, instances: replay.instances,
    specifications: [{ _id: ids.spec, quantityUnitId: { _id: ids.unit, name: 'thùng' } }], canonicalScopeMatches: true, initialized: false });
  detailEvidence.itemSpecifications = [{ itemSpecId: ids.spec, quantityUnitId: String(ids.unit), quantityUnit: 'thùng', quantityOnHand: 11 }];
  detailEvidence.byCell = [...detailEvidence.summary.byCell.entries()].map(([cellId, value]) => ({ cellId, ...value }));
  const detail = mapManagedV3InventoryDetail({ categoryId: ids.spec }, { _id: ids.spec, code: 'ARCHIVE', name: 'Archive' }, detailEvidence);
  assert.equal(result.get(String(ids.sku)).totalQuantity, detail.stock.totalQuantity);
  assert.equal(result.get(String(ids.sku)).totalWeightKg, detail.stock.totalWeightKg);
  assert.equal(result.get(String(ids.sku)).totalVolumeM3, detail.stock.totalVolumeM3);
  assert.equal(result.get(String(ids.sku)).reconciliationStatus, detail.stock.reconciliationStatus);
});

test('batch loader rejects unsafe page scope and detects stock-row limit overflow without truncation', async t => {
  const actor = { _id: ids.customer, role: 'ADMIN' };
  const template = { _id: ids.sku, inventorySchemaVersion: 3, facilityId: ids.facility, customerId: ids.customer, reservationId: ids.reservation };
  await assert.rejects(ManagedV4StockBatchReadService.summarize(Array.from({ length: 101 }, (_, i) => ({ ...template, _id: new Types.ObjectId() })), actor),
    error => error.code === 'MANAGED_V4_BATCH_EVIDENCE_LIMIT' && error.status === 503);
  await assert.rejects(ManagedV4StockBatchReadService.summarize([template], { _id: ids.customer, role: 'FACILITY_MANAGER', assignedFacilityId: ids.cell }),
    error => error.status === 403);
  t.mock.method(SpecModel, 'find', () => new MockQuery([]));
  t.mock.method(StockModel, 'find', () => new MockQuery(Array.from({ length: 50001 }, () => ({ skuId: ids.sku }))));
  t.mock.method(InstanceModel, 'find', () => new MockQuery([]));
  t.mock.method(MovementModel, 'find', () => new MockQuery([]));
  await assert.rejects(ManagedV4StockBatchReadService.summarize([template], actor),
    error => error.code === 'MANAGED_V4_BATCH_EVIDENCE_LIMIT' && error.status === 503);
});

test('InventoryItemService list preserves pagination and legacy DTO while enriching V3 rows from batch evidence', async t => {
  const event = add(1, 'r-list', 10), replay = domain.replayManagedStockMovements([event]);
  const rows = [{ _id: ids.sku, inventorySchemaVersion: 3, facilityId: ids.facility, customerId: ids.customer, reservationId: ids.reservation,
    categoryId: ids.spec, itemCode: 'V3-1', name: 'Cartons', status: 'ACTIVE', quantity: undefined, currentCellId: null },
  { _id: ids.cell, facilityId: ids.facility, itemCode: 'LEGACY-1', name: 'Legacy', category: 'OLD', quantity: 2, status: 'ACTIVE' }];
  t.mock.method(InventoryItemModel, 'find', () => new MockQuery(rows));
  t.mock.method(InventoryItemModel, 'countDocuments', () => ({ exec: async () => 2 }));
  t.mock.method(SpecModel, 'find', filter => new MockQuery([{ _id: ids.spec, skuId: ids.sku, customerId: ids.customer, reservationId: ids.reservation, facilityId: ids.facility, quantityUnitId: { _id: ids.unit, name: 'thùng' } }].filter(row => filter.skuId.$in.map(String).includes(String(row.skuId)))));
  t.mock.method(StockModel, 'find', () => new MockQuery(replay.lots));
  t.mock.method(InstanceModel, 'find', () => new MockQuery([]));
  t.mock.method(MovementModel, 'find', () => new MockQuery([event]));
  t.mock.method(ReservationModel, 'find', filter => new MockQuery([{ _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility }].filter(row => filter._id.$in.map(String).includes(String(row._id)))));
  t.mock.method(CellModel, 'find', filter => new MockQuery([{ _id: ids.cell, facilityId: ids.facility }].filter(row => filter._id.$in.map(String).includes(String(row._id)))));
  t.mock.method(CategoryModel, 'find', filter => new MockQuery([{ _id: ids.spec, code: 'ARCHIVE', name: 'Archive' }].filter(row => filter._id.$in.map(String).includes(String(row._id)))));
  const response = await InventoryItemService.list({}, { _id: ids.customer, role: 'ADMIN' });
  assert.deepEqual(response.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
  assert.equal(response.data[0].stock.totalQuantity, 10);
  assert.equal(response.data[0].categoryCode, 'ARCHIVE');
  assert.equal(response.data[0].category, undefined);
  assert.equal(response.data[1].category, 'OLD');
  assert.equal(response.data[1].stock, undefined);
});

test('Customer Profile list/detail populate only displayName and existing public contact fields', async t => {
  const profile = { _id: ids.customer, userId: { displayName: 'Customer Name', email: 'customer@example.test', phone: '0900000000' } };
  const selections = [];
  class PopulateQuery {
    constructor(value) { this.value = value; }
    populate(path, fields) { selections.push([path, fields]); return this; }
    async exec() { return this.value; }
  }
  t.mock.method(CustomerProfileModel, 'find', () => new PopulateQuery([profile]));
  t.mock.method(CustomerProfileModel, 'findById', () => new PopulateQuery(profile));
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const listRes = response(); await customerProfileController.getCustomers({}, listRes);
  const detailRes = response(); await customerProfileController.getCustomerById({ params: { id: String(ids.customer) } }, detailRes);
  assert.deepEqual(selections, [['userId', 'email phone displayName'], ['userId', 'email phone displayName']]);
  assert.equal(listRes.body.data[0].userId.displayName, 'Customer Name');
  assert.equal(detailRes.body.data.userId.email, 'customer@example.test');
  assert.equal(JSON.stringify(listRes.body).includes('password'), false);
});

test('EmailService resolves displayName and falls back safely without sending email', async () => {
  const named = await EmailService.resolveReservationEmailContext({ _id: ids.sku, customerId: { email: 'a@example.test', displayName: 'Display Name' }, startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') });
  assert.equal(named.fullName, 'Display Name');
  const unnamed = await EmailService.resolveReservationEmailContext({ _id: ids.sku, customerId: { email: 'a@example.test' }, startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') });
  assert.equal(unnamed.fullName, 'Quý khách');
});
