import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';

const id = 'a'.repeat(24);
const routes = [
  ['GET', '/inbound-requests/receiving-queue'],
  ['GET', `/inbound-requests/${id}/receiving`],
  ['POST', `/inbound-requests/${id}/evidence-uploads`],
  ['POST', `/inbound-requests/${id}/inspection`],
  ['POST', `/inbound-requests/${id}/return-completed`],
  ['POST', `/inbound-requests/${id}/confirm`],
  ['GET', '/inventory-items/managed-v3/facility/overview'],
];

test('Facility inventory read and existing inbound APIs remain allowlisted; outbound is a read-only V3 monitor', () => {
  for (const [method, url] of routes) assert.doesNotThrow(() => assertConfirmedRequest({ method, url }));
  for (const [method, url] of [
    ['GET', `/inventory-items/${id}/relocate-canonical/context`],
    ['POST', `/inventory-items/${id}/relocate-canonical`],
    ['GET', '/outbound-requests/staff-queue'],
    ['GET', `/outbound-requests/${id}/staff-detail`],
    ['POST', `/outbound-requests/${id}/confirm`],
  ]) assert.throws(() => assertConfirmedRequest({ method, url }), /not confirmed/);
});

test('Facility allowlist rejects incorrect methods and unconfirmed route variants', () => {
  for (const [allowed, url] of routes) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (method !== allowed) assert.throws(() => assertConfirmedRequest({ method, url }), /not confirmed/);
    }
    assert.throws(() => assertConfirmedRequest({ method: allowed, url: `${url}/extra` }), /not confirmed/);
  }
  assert.throws(() => assertConfirmedRequest({ method: 'POST', url: `/outbound-requests/${id}/confirm` }), /not confirmed/);
});

test('retired Staff relocation deep links explain Customer ownership and cannot mount the old writer', async () => {
  const routesPath = fileURLToPath(new URL('../src/routes/StaffRoutes.jsx', import.meta.url));
  const oldPagePath = fileURLToPath(new URL('../src/pages/staff/CanonicalRelocationPage.jsx', import.meta.url));
  const routes = await readFile(routesPath, 'utf8');
  assert.match(routes, /inventory\/relocation\/:id[^\n]*StaffUnavailable title="Chuyển vị trí do Customer thực hiện/);
  assert.doesNotMatch(routes, /CanonicalRelocationPage/);
  await assert.rejects(access(oldPagePath));
});
