import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';

const id = 'a'.repeat(24);
const routes = [
  ['GET', '/inbound-requests/receiving-queue'],
  ['GET', `/inbound-requests/${id}/receiving`],
  ['GET', '/outbound-requests/staff-queue'],
  ['GET', `/outbound-requests/${id}/staff-detail`],
  ['GET', `/inventory-items/${id}/relocate-canonical/context`],
  ['POST', `/inbound-requests/${id}/evidence-uploads`],
  ['POST', `/inbound-requests/${id}/inspection`],
  ['POST', `/inbound-requests/${id}/return-completed`],
  ['POST', `/inbound-requests/${id}/confirm`],
  ['POST', `/outbound-requests/${id}/confirm`],
  ['POST', `/inventory-items/${id}/relocate-canonical`],
];

test('Staff inventory requests reach the backend through the application allowlist', () => {
  for (const [method, url] of routes) {
    assert.doesNotThrow(() => assertConfirmedRequest({ method, url }));
  }
});

test('Staff inventory allowlist rejects incorrect methods and unconfirmed route variants', () => {
  for (const [allowed, url] of routes) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (method !== allowed) assert.throws(() => assertConfirmedRequest({ method, url }), /not confirmed/);
    }
    assert.throws(() => assertConfirmedRequest({ method: allowed, url: `${url}/extra` }), /not confirmed/);
  }
  assert.throws(() => assertConfirmedRequest({ method: 'POST', url: '/outbound-requests/invalid-id/confirm' }), /not confirmed/);
});
