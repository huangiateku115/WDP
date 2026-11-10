import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryQueuePage } from '../src/lib/inventoryQueuePage.js';

const response = pagination => ({ data: { success: true, data: { data: [], pagination } } });
test('queue reads the requested backend page and handles an empty final page', () => {
  assert.equal(inventoryQueuePage(response({ page: 2, limit: 20, total: 25, totalPages: 2 }), 2).pagination.total, 25);
  assert.equal(inventoryQueuePage(response({ page: 3, limit: 20, total: 20, totalPages: 1 }), 3).pagination.totalPages, 1);
  assert.equal(inventoryQueuePage(response({ page: 1, limit: 20, total: 0, totalPages: 0 }), 1).data.length, 0);
});
test('queue rejects another page and invalid totals instead of showing a successful empty list', () => {
  assert.throws(() => inventoryQueuePage(response({ page: 1, limit: 20, total: 25, totalPages: 2 }), 2));
  assert.throws(() => inventoryQueuePage(response({ page: 1, limit: 20, total: 25, totalPages: 1 }), 1));
  assert.throws(() => inventoryQueuePage({ data: { success: false } }, 1));
});
