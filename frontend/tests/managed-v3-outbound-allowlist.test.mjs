import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';

const sku = '507f1f77bcf86cd799439011';
const request = '507f1f77bcf86cd799439012';

test('V3 Customer outbound and Facility read routes are explicitly allowlisted', () => {
  const allowed = [
    ['get', `/inventory-items/${sku}/v3/outbound/context`],
    ['get', `/inventory-items/${sku}/v3/outbound/operations`],
    ['get', `/inventory-items/${sku}/v3/outbound-requests`],
    ['get', `/inventory-items/${sku}/v3/outbound-requests/${request}`],
    ['post', `/inventory-items/${sku}/v3/outbound-requests`],
    ['post', `/inventory-items/${sku}/v3/outbound-requests/${request}/cancel`],
    ['post', `/inventory-items/${sku}/v3/outbound-requests/${request}/preview`],
    ['post', `/inventory-items/${sku}/v3/outbound-requests/${request}/confirm`],
    ['get', '/inventory-items/managed-v3/facility/outbound-requests'],
    ['get', `/inventory-items/managed-v3/facility/outbound-requests/${request}`],
  ];
  for (const [method, url] of allowed) assert.doesNotThrow(() => assertConfirmedRequest({ method, url }));
});

test('V3 outbound allowlist rejects wrong methods, malformed IDs and unsupported paths', () => {
  for (const [method, url] of [
    ['delete', `/inventory-items/${sku}/v3/outbound-requests`],
    ['post', `/inventory-items/${sku}/v3/outbound/operations`],
    ['post', `/inventory-items/not-an-id/v3/outbound-requests`],
    ['patch', `/inventory-items/${sku}/v3/outbound-requests/${request}`],
  ]) assert.throws(() => assertConfirmedRequest({ method, url }));
});
