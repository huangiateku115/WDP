const { test } = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../dist/controllers/inventory-items/managed-sku.controller');
const { ManagedSkuService } = require('../dist/services/inventory-items/managed-sku.service');

test('Customer SKU list returns data array and pagination as sibling fields', async () => {
  const original = ManagedSkuService.listMine;
  const rows = [{ _id: '507f1f77bcf86cd799439011', itemCode: 'SKU-1' }];
  ManagedSkuService.listMine = async (actor, query) => {
    assert.equal(actor._id, 'customer-id');
    assert.equal(query.page, '2');
    return { data: rows, pagination: { page: 2, limit: 20, total: 21, totalPages: 2 } };
  };
  try {
    let response;
    let forwarded;
    await controller.listMine(
      { user: { _id: 'customer-id' }, query: { page: '2' } },
      { json(value) { response = value; return this; } },
      error => { forwarded = error; },
    );
    assert.equal(forwarded, undefined);
    assert.deepEqual(response, {
      success: true,
      data: rows,
      pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });
    assert.equal(Array.isArray(response.data), true);
  } finally {
    ManagedSkuService.listMine = original;
  }
});

test('Customer SKU list forwards service errors to the shared error handler', async () => {
  const original = ManagedSkuService.listMine;
  const expected = new Error('database unavailable');
  ManagedSkuService.listMine = async () => { throw expected; };
  try {
    let forwarded;
    await controller.listMine({ user: {}, query: {} }, { json() { assert.fail('must not claim success'); } }, error => { forwarded = error; });
    assert.equal(forwarded, expected);
  } finally {
    ManagedSkuService.listMine = original;
  }
});

test('SKU registration rejects legacy stock/location fields with field-level errors before database access', async () => {
  const { UserRole } = require('../dist/types/user.type');
  const actor = { _id: '507f1f77bcf86cd799439071', role: UserRole.CUSTOMER };
  await assert.rejects(
    ManagedSkuService.create({ managedReservationId: '507f1f77bcf86cd799439021', itemCode: 'SKU-1', name: 'Cartons', categoryId: '507f1f77bcf86cd799439051', quantity: 3, quantityUnit: 'box', preferredCellId: '507f1f77bcf86cd799439011', unitDimensionsM: { widthM: 1 }, unitWeightKg: 1 }, actor),
    error => error.status === 400 && error.code === 'INVALID_SKU_FIELD' && ['quantity', 'quantityUnit', 'preferredCellId', 'unitDimensionsM', 'unitWeightKg'].every(field => error.fieldErrors[field]),
  );
});
