const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { reservationDetailDto } = require('../dist/services/reservations/reservation-detail.dto');
const { withSelfStorageRentalInterval } = require('../dist/services/contracts/self-storage-pricing-snapshot');
const { contractRentalPeriodDto } = require('../dist/services/contracts/contract-rental-period.dto');
const { ManagedSkuService, ManagedSkuError } = require('../dist/services/inventory-items/managed-sku.service');
const InventoryItemModel = require('../dist/models/inventory-items/inventory-item.model').default;
const ItemSpecificationModel = require('../dist/models/inventory-items/item-specification.model').default;
const { UserRole } = require('../dist/types/user.type');

test('reservation detail DTO includes stored A3 fields and normalizes missing values to null', () => {
  const date = new Date('2026-02-03T00:00:00Z');
  assert.deepEqual(reservationDetailDto({ allocatedCapacity: 12, expiresAt: date, rejectReason: 'reason', statusHistory: [1] }), {
    allocatedCapacity: 12, expiresAt: date, rejectReason: 'reason', statusHistory: [1],
  });
  assert.deepEqual(reservationDetailDto({ status: 'REJECTED' }), {
    status: 'REJECTED', allocatedCapacity: null, expiresAt: null, rejectReason: null,
  });
});

test('Self Storage new contract snapshots receive verified reservation interval; other services unchanged', () => {
  const startDate = new Date('2026-03-01T00:00:00Z'), endDate = new Date('2026-04-01T00:00:00Z');
  const legacy = { estimatedRent: 100 };
  const result = withSelfStorageRentalInterval({ serviceType: 'SELF_STORAGE', startDate, endDate, rentalPricingSnapshot: { durationDays: 31 } }, legacy);
  assert.equal(result.startDate.getTime(), startDate.getTime()); assert.equal(result.endDate.getTime(), endDate.getTime());
  assert.deepEqual(result.term, { value: 31, unit: 'DAY' }); assert.equal(result.estimatedRent, 100);
  assert.deepEqual(withSelfStorageRentalInterval({ serviceType: 'MANAGED_INVENTORY', startDate, endDate }, legacy), legacy);
  assert.deepEqual(withSelfStorageRentalInterval({ serviceType: 'SELF_STORAGE' }, legacy), legacy);
  assert.deepEqual(withSelfStorageRentalInterval({ serviceType: 'SELF_STORAGE', rentalPricingSnapshot: { term: { value: 2, unit: 'MONTH' } } }, legacy).term,
    { value: 2, unit: 'MONTH' });
});

test('contract rental DTO preserves signed snapshot and exposes current period plus only activated paid addenda', () => {
  const originalStart = new Date('2026-01-01T00:00:00Z'), originalEnd = new Date('2026-02-01T00:00:00Z');
  const currentEnd = new Date('2026-04-01T00:00:00Z'), effectiveAt = new Date('2026-02-01T00:00:00Z');
  const signedSnapshot = { startDate: originalStart, endDate: originalEnd, term: { value: 1, unit: 'MONTH' }, estimatedRent: 100 };
  const contract = { pricingSnapshot: signedSnapshot, contentVersions: [{ contentHash: 'signed-hash' }], signatures: [{ signedAt: originalStart }],
    reservationId: { startDate: originalStart, endDate: currentEnd, renewals: [], extendContract: [
      { _id: 'a', status: 'ACTIVE', extensionCode: 'EXT-A', oldEndDate: originalEnd, newEndDate: currentEnd,
        durationMonths: 2, amount: 200, paymentId: 'payment-a', verifiedAt: effectiveAt },
      { _id: 'b', status: 'PAID', extensionCode: 'EXT-B', oldEndDate: currentEnd, newEndDate: new Date('2026-06-01'), paymentId: 'payment-b' },
      { _id: 'c', status: 'ACTIVE', extensionCode: 'EXT-C', oldEndDate: currentEnd, newEndDate: new Date('2026-06-01'), verifiedAt: effectiveAt },
    ] } };
  const dto = contractRentalPeriodDto(contract);
  assert.deepEqual(dto.originalContractPeriod, { startDate: originalStart, endDate: originalEnd, term: { value: 1, unit: 'MONTH' } });
  assert.deepEqual(dto.currentRentalPeriod, { startDate: originalStart, endDate: currentEnd });
  assert.equal(dto.renewalHistory.length, 1);
  assert.equal(dto.renewalHistory[0].extensionCode, 'EXT-A');
  assert.equal(contract.pricingSnapshot, signedSnapshot);
  assert.equal(contract.pricingSnapshot.endDate, originalEnd);
  assert.equal(contract.contentVersions[0].contentHash, 'signed-hash');
  assert.equal(contract.signatures[0].signedAt, originalStart);
});

test('Item Specification reads enforce customer and facility scope, allow Admin/BOM, and keep write roles closed', async () => {
  const ids = { sku: new Types.ObjectId(), customer: new Types.ObjectId(), facility: new Types.ObjectId(), spec: new Types.ObjectId() };
  const originalFindOne = InventoryItemModel.findOne, originalFind = ItemSpecificationModel.find;
  let skuRow = { _id: ids.sku, customerId: ids.customer, facilityId: ids.facility };
  let specFilter;
  InventoryItemModel.findOne = () => ({ lean() { return this; }, exec: async () => skuRow });
  ItemSpecificationModel.find = filter => { specFilter = filter; return { populate() { return this; }, sort() { return this; }, lean() { return this; }, exec: async () => [{ _id: ids.spec, skuId: ids.sku, customerId: ids.customer, facilityId: ids.facility, code: 'BOX', name: 'Box', quantityUnitId: ids.spec, status: 'ACTIVE' }] }; };
  try {
    for (const role of [UserRole.ADMIN, UserRole.BOM]) assert.equal((await ManagedSkuService.listSpecifications(ids.sku.toString(), { _id: ids.customer, role })).length, 1);
    assert.equal((await ManagedSkuService.listSpecifications(ids.sku.toString(), { _id: ids.customer, role: UserRole.CUSTOMER })).length, 1);
    assert.equal((await ManagedSkuService.listSpecifications(ids.sku.toString(), { _id: ids.customer, role: UserRole.FACILITY_MANAGER, assignedFacilityId: ids.facility })).length, 1);
    for (const actor of [
      { _id: new Types.ObjectId(), role: UserRole.CUSTOMER },
      { _id: ids.customer, role: UserRole.FACILITY_STAFF, assignedFacilityId: new Types.ObjectId() },
    ]) await assert.rejects(ManagedSkuService.listSpecifications(ids.sku.toString(), actor), e => e instanceof ManagedSkuError && e.status === 404);
    assert.equal(specFilter.customerId, ids.customer); assert.equal(specFilter.facilityId, ids.facility);
    assert.equal(specFilter.deletedAt.$exists, false); assert.equal(specFilter.status.$ne, 'DELETED');
    for (const role of [UserRole.ADMIN, UserRole.BOM]) {
      await assert.rejects(ManagedSkuService.createSpecification(ids.sku.toString(), {}, { _id: ids.customer, role }), e => e instanceof ManagedSkuError && e.status === 403);
      await assert.rejects(ManagedSkuService.updateSpecification(ids.sku.toString(), ids.spec.toString(), {}, '1', { _id: ids.customer, role }), e => e instanceof ManagedSkuError && e.status === 403);
      await assert.rejects(ManagedSkuService.deleteSpecification(ids.sku.toString(), ids.spec.toString(), '1', { _id: ids.customer, role }), e => e instanceof ManagedSkuError && e.status === 403);
    }
  } finally { InventoryItemModel.findOne = originalFindOne; ItemSpecificationModel.find = originalFind; }
});
