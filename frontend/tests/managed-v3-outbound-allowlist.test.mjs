import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';

const sku = '507f1f77bcf86cd799439011';

test('V3 direct Customer outbound contract allows context, operation lookup, preview and confirm', () => {
  const allowed = [
    ['get', `/inventory-items/${sku}/v3/outbound/context`],
    ['get', `/inventory-items/${sku}/v3/outbound/operations`],
    ['post', `/inventory-items/${sku}/v3/outbound/preview`],
    ['post', `/inventory-items/${sku}/v3/outbound`],
  ];
  for (const [method, url] of allowed) assert.doesNotThrow(() => assertConfirmedRequest({ method, url }));
});

test('direct V3 outbound allowlist rejects old request/hold APIs and wrong methods', () => {
  for (const [method, url] of [
    ['get', `/inventory-items/${sku}/v3/outbound-requests`],
    ['post', `/inventory-items/${sku}/v3/outbound-requests`],
    ['post', `/inventory-items/${sku}/v3/outbound-requests/507f1f77bcf86cd799439012/confirm`],
    ['post', `/inventory-items/${sku}/v3/outbound/operations`],
    ['get', `/inventory-items/not-an-id/v3/outbound/context`],
    ['patch', `/inventory-items/${sku}/v3/outbound`],
  ]) assert.throws(() => assertConfirmedRequest({ method, url }));
});
