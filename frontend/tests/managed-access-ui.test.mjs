import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const customer=read('../src/pages/customer/ManagedAccessVisitsPage.jsx');
const staff=read('../src/components/facility/ManagedAccessFacilityPage.jsx');
const manager=staff;
const api=read('../src/api/managedAccessApi.js');
const routes=read('../src/api/confirmedContract.js');

test('Customer Access UI uses real visit/session APIs, date picker, live slots, amend, cancel, countdown and Cell scope',()=>{
 for(const expression of [/managedAccessApi\.myVisits\(/,/managedAccessApi\.mySessions\(/,/managedAccessApi\.createVisit\(/,/managedAccessApi\.amendVisit\(/,/managedAccessApi\.cancelVisit\(/,/Countdown expiresAt=\{session\.expiresAt\}/,/allowedCellIds/,/type="date"/,/managedAccessApi\.visitAvailability\(/,/Asia\/Ho_Chi_Minh/])assert.match(customer,expression);
 assert.doesNotMatch(customer,/type="datetime-local"/);
 assert.doesNotMatch(customer,/localStorage|sessionStorage|mockSession|setItem\(/);
});
test('Staff Access UI uses real check-in, checkout and revoke actions with explicit manual attestation',()=>{
 for(const expression of [/api\.facilityVisits\(/,/api\.checkIn\(/,/api\.checkOut\(/,/api\.revoke\(/,/identityVerified/,
  /customerPresent/,
  /safetyReviewed/,
  /thủ công/])assert.match(staff,expression);
 assert.doesNotMatch(staff,/localStorage|sessionStorage|mockSession|setItem\(/);
});
test('Manager Access UI uses real Facility assignment and session monitoring/revocation',()=>{
 for(const expression of [/api\.facilityVisits\(/,/api\.staff\(/,/api\.assign\(/,/api\.facilitySessions\(/,/api\.revoke\(/,/assignmentHistory/])assert.match(manager,expression);
 assert.doesNotMatch(manager,/localStorage|sessionStorage|mockSession|setItem\(/);
});
test('Access API adapter paths, Idempotency-Key and If-Match headers are explicit and allowlisted',()=>{
 for(const path of ['/access/managed-v3/visits','/access/managed-v3/visits/me','/access/managed-v3/visits/facility','/access/managed-v3/sessions/me','/access/managed-v3/sessions/facility'])assert.ok(api.includes(path));
 assert.match(api,/Idempotency-Key/);assert.match(api,/If-Match/);assert.match(routes,/access\\\/managed-v3/);
});
test('Create Visit and check-in reuse persisted idempotency keys and expose explicit reconciliation before retry',()=>{
 assert.match(api,/sessionStorage/);assert.match(api,/pendingCreateKey/);assert.match(api,/pendingCheckInKey/);assert.match(api,/clearPendingCheckInKey/);
 assert.match(api,/fingerprint/);assert.match(api,/IDEMPOTENCY_PAYLOAD_MISMATCH/);assert.match(api,/payload: canonical\(payload\)/);
 assert.match(customer,/Kiểm tra kết quả \/ thử lại cùng yêu cầu/);assert.match(customer,/idempotencyKey===key/);
 assert.match(staff,/facilitySessions\(\)/);assert.match(staff,/api\.pendingCheckIn\(/);assert.match(staff,/không thể báo check-in thành công/i);
 assert.match(customer,/managedAccessApi\.pendingCreate\(\)/);assert.match(staff,/api\.pendingCheckIn\(id,recordId\(user\)\)/);
 assert.match(staff,/payload=pending\?\.payload\|\|attestation/);
});
test('Visit amendments keep an idempotency key across ambiguous outcomes and Access UI explains provisional capacity and the 60-minute session boundary',()=>{
 assert.match(api,/amendVisit: async/);assert.match(api,/Idempotency-Key/);assert.match(api,/pendingAmend/);
 assert.match(api,/expectedRevision/);assert.match(api,/originalRevision/);assert.match(customer,/pending\.expectedRevision/);
 assert.match(customer,/if\(editing\)\{[\s\S]*pendingAmend/);assert.match(customer,/Number\(current\.revision\)!==pendingAmend\.revision/);
 assert.doesNotMatch(customer,/if\(editing&&\(!cause\?\.response\?\.status\|\|cause\.response\.status>=500\)\)setPendingAmend/);
 assert.match(customer,/số tài khoản Staff đang hoạt động/);assert.match(customer,/chưa phải xác nhận Staff đang trực/);assert.match(customer,/không tự gia hạn/);
 assert.match(manager,/Ngày đến \(giờ Việt Nam\)/);assert.match(manager,/Còn lại/);
});
test('Facility editor exposes an explicit Admin/BOM Managed visit schedule without inferring it from general opening hours',()=>{
 const editor=read('../src/pages/bom/FacilityPage.jsx');const mapper=read('../src/lib/bomMappers.js');
 assert.match(editor,/Configure Managed Inventory visit schedule/);assert.match(editor,/Asia\/Ho_Chi_Minh/);assert.match(editor,/active Staff accounts/);
 assert.match(mapper,/managedVisitSchedule/);assert.match(mapper,/visitScheduleDraft/);
});
