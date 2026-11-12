import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const customer=read('../src/pages/customer/ManagedAccessVisitsPage.jsx');
const staff=read('../src/pages/staff/ManagedAccessOperationsPage.jsx');
const manager=read('../src/pages/manager/ManagedAccessOversightPage.jsx');
const api=read('../src/api/managedAccessApi.js');
const routes=read('../src/api/confirmedContract.js');

test('Customer Access UI uses real visit/session APIs and provides schedule, amend, cancel, countdown and Cell scope',()=>{
 for(const expression of [/managedAccessApi\.myVisits\(/,/managedAccessApi\.mySessions\(/,/managedAccessApi\.createVisit\(/,/managedAccessApi\.amendVisit\(/,/managedAccessApi\.cancelVisit\(/,/Countdown expiresAt=\{s\.expiresAt\}/,/allowedCellIds/])assert.match(customer,expression);
 assert.doesNotMatch(customer,/localStorage|sessionStorage|mockSession|setItem\(/);
});
test('Staff Access UI uses real check-in, checkout and revoke actions with explicit manual attestation',()=>{
 for(const expression of [/managedAccessApi\.facilityVisits\(/,/managedAccessApi\.checkIn\(/,/managedAccessApi\.checkOut\(/,/managedAccessApi\.revoke\(/,/identityVerified/,
  /customerPresent/,
  /safetyReviewed/,
  /MANUAL|manual attestation/i])assert.match(staff,expression);
 assert.doesNotMatch(staff,/localStorage|sessionStorage|mockSession|setItem\(/);
});
test('Manager Access UI uses real Facility assignment and session monitoring/revocation',()=>{
 for(const expression of [/managedAccessApi\.facilityVisits\(/,/managedAccessApi\.staff\(/,/managedAccessApi\.assign\(/,/managedAccessApi\.facilitySessions\(/,/managedAccessApi\.revoke\(/,/assignmentHistory/])assert.match(manager,expression);
 assert.doesNotMatch(manager,/localStorage|sessionStorage|mockSession|setItem\(/);
});
test('Access API adapter paths, Idempotency-Key and If-Match headers are explicit and allowlisted',()=>{
 for(const path of ['/access/managed-v3/visits','/access/managed-v3/visits/me','/access/managed-v3/visits/facility','/access/managed-v3/sessions/me','/access/managed-v3/sessions/facility'])assert.ok(api.includes(path));
 assert.match(api,/Idempotency-Key/);assert.match(api,/If-Match/);assert.match(routes,/access\\\/managed-v3/);
});
test('Create Visit and check-in reuse persisted idempotency keys and expose explicit reconciliation before retry',()=>{
 assert.match(api,/sessionStorage/);assert.match(api,/pendingCreateKey/);assert.match(api,/pendingCheckInKey/);assert.match(api,/clearPendingCheckInKey/);
 assert.match(api,/fingerprint/);assert.match(api,/IDEMPOTENCY_PAYLOAD_MISMATCH/);assert.match(api,/payload: canonical\(payload\)/);
 assert.match(customer,/Kiểm tra kết quả \/ thử lại cùng yêu cầu/);assert.match(customer,/idempotencyKey===managedAccessApi\.pendingCreateKey\(\)/);
 assert.match(staff,/facilitySessions\(\)/);assert.match(staff,/pendingCheckIn===v\._id/);assert.match(staff,/không thể báo check-in thành công/i);
 assert.match(customer,/managedAccessApi\.pendingCreate\(\)/);assert.match(staff,/managedAccessApi\.pendingCheckIn\(visit\._id\)/);
 assert.match(staff,/pendingCheckInRef\.current=\{visitId:visit\._id,attestation:pending\.payload\}/);
});
