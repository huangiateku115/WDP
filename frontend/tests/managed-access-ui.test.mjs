import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessSessionCoversReservation } from '../src/lib/managedAccessFacility.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const customer=read('../src/pages/customer/ManagedAccessVisitsPage.jsx');
const staff=read('../src/components/facility/ManagedAccessFacilityPage.jsx');
const manager=staff;
const api=read('../src/api/managedAccessApi.js');
const routes=read('../src/api/confirmedContract.js');
const inventory=read('../src/components/customer/inventory/InventoryIntegration.jsx');
const inbound=read('../src/components/customer/inventory/ManagedUnifiedSelfInbound.jsx');
const outbound=read('../src/components/customer/inventory/ManagedSelfOutboundV3.jsx');
const relocation=read('../src/components/customer/inventory/ManagedSelfRelocationV3.jsx');

test('Customer Access UI uses real visit/session APIs, date picker, live slots, amend, cancel, countdown and Cell scope',()=>{
 for(const expression of [/managedAccessApi\.myVisits\(/,/managedAccessApi\.mySessions\(/,/managedAccessApi\.createVisit\(/,/managedAccessApi\.amendVisit\(/,/managedAccessApi\.cancelVisit\(/,/Countdown expiresAt=\{session\.expiresAt\}/,/allowedCellIds/,/type="date"/,/managedAccessApi\.visitAvailability\(/,/Asia\/Ho_Chi_Minh/])assert.match(customer,expression);
 assert.doesNotMatch(customer,/type="datetime-local"/);
 assert.doesNotMatch(customer,/localStorage|sessionStorage|mockSession|setItem\(/);
 assert.doesNotMatch(customer,/<label[^>]*>Mục đích<select/);
 assert.match(customer,/WAREHOUSE_VISIT|Lượt đến kho/);
 assert.match(customer,/Nhập kho/);assert.match(customer,/Xuất kho/);assert.match(customer,/Chuyển vị trí/);
 assert.match(customer,/session\.scopedReservationIds\?\.length/);
 assert.doesNotMatch(customer,/Reservation bổ sung cần dùng trong cùng lượt/);
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
test('Outbound session selector accepts another Reservation only when unified Visit scope includes it',()=>{
 const session={reservationId:'a'.repeat(24),scopedReservationIds:['a'.repeat(24),'b'.repeat(24)]};
 assert.equal(accessSessionCoversReservation(session,'b'.repeat(24)),true);
 assert.equal(accessSessionCoversReservation(session,'c'.repeat(24)),false);
 assert.equal(accessSessionCoversReservation({reservationId:'a'.repeat(24)},'b'.repeat(24)),false);
 assert.match(outbound,/accessSessionCoversReservation\(row, sessionReservationId\)/);
});
test('Access API adapter paths, Idempotency-Key and If-Match headers are explicit and allowlisted',()=>{
 for(const path of ['/access/managed-v3/visits','/access/managed-v3/visits/me','/access/managed-v3/visits/facility','/access/managed-v3/sessions/me','/access/managed-v3/sessions/facility'])assert.ok(api.includes(path));
 assert.match(api,/Idempotency-Key/);assert.match(api,/If-Match/);assert.match(routes,/access\\\/managed-v3/);
});
test('Create Visit and check-in reuse persisted idempotency keys and expose explicit reconciliation before retry',()=>{
 assert.match(api,/sessionStorage/);assert.match(api,/pendingCreateKey/);assert.match(api,/pendingCheckInKey/);assert.match(api,/clearPendingCheckInKey/);
 assert.match(api,/fingerprint/);assert.match(api,/IDEMPOTENCY_PAYLOAD_MISMATCH/);assert.match(api,/payload: canonical\(payload\)/);
 assert.match(customer,/Kiểm tra kết quả \/ thử lại cùng yêu cầu/);assert.match(customer,/idempotencyKey\s*===\s*key/);
 assert.match(staff,/facilitySessions\(\)/);assert.match(staff,/api\.pendingCheckIn\(/);assert.match(staff,/không thể báo check-in thành công/i);
 assert.match(customer,/managedAccessApi\.pendingCreate\(\)/);assert.match(staff,/api\.pendingCheckIn\(id\s*,\s*recordId\(user\)\)/);
 assert.match(staff,/payload\s*=\s*pending\?\.payload\s*\|\|\s*attestation/);
});
test('Visit amendments keep an idempotency key across ambiguous outcomes and Access UI explains the scoped Session rule',()=>{
 assert.match(api,/amendVisit: async/);assert.match(api,/Idempotency-Key/);assert.match(api,/pendingAmend/);
 assert.match(api,/expectedRevision/);assert.match(api,/originalRevision/);assert.match(customer,/pending\.expectedRevision/);
 assert.match(api,/client\.patch\([\s\S]*pending\.payload[\s\S]*String\(originalRevision\)[\s\S]*pending\.key/);
 assert.match(api,/if \(!Number\.isSafeInteger\(expectedRevision\) \|\| expectedRevision < 0\)/);
 assert.doesNotMatch(api,/Number\.isSafeInteger\(pending\.expectedRevision\) \? pending\.expectedRevision : Number\(revision\)/);
 assert.match(customer,/if\s*\(editing\)\s*\{[\s\S]*pendingAmend/);assert.match(customer,/Number\(current\.revision\)\s*!==\s*pendingAmend\.revision/);
 assert.doesNotMatch(customer,/if\(editing&&\(!cause\?\.response\?\.status\|\|cause\.response\.status>=500\)\)setPendingAmend/);
 assert.match(customer,/Session chỉ bao phủ các Reservation Managed cùng cơ sở đủ điều kiện và còn hơn 7 ngày thuê/);
 assert.match(manager,/Ngày đến \(giờ Việt Nam\)/);assert.match(manager,/Còn lại/);
});
test('One checked-in Session is linked into each permitted Customer operation and refreshed after a movement fence',()=>{
 assert.match(customer,/operation=\$\{purpose\}/);assert.match(inventory,/accessSessionId=.*operation/);assert.match(inventory,/initialSessionId/);
 for(const component of [inbound,outbound,relocation]){assert.match(component,/initialSessionId/);assert.match(component,/managed-access-session-updated/);assert.match(component,/notifyManagedAccessSessionUpdated/);}
});
test('Customer visit history shows five newest bookings per page with working previous/next controls',()=>{
 assert.match(customer,/VISITS_PER_PAGE\s*=\s*5/);
 assert.match(customer,/\[\.\.\.visits\]\.sort/);
 assert.match(customer,/createdAt\s*\|\|\s*left\.updatedAt\s*\|\|\s*left\.startsAt/);
 assert.match(customer,/newestVisits\.slice\(\(currentVisitPage\s*-\s*1\)\s*\*\s*VISITS_PER_PAGE/);
 assert.match(customer,/visibleVisits\.map\(/);
 assert.match(customer,/aria-label="Phân trang lịch đến kho"/);
 assert.match(customer,/>Trước<|>Sau</);
});
test('Customer books a warehouse visit by date and slot without selecting a Reservation',()=>{
 assert.match(customer,/maxVisitDateVN\s*=\s*\(\)\s*=>\s*addVNCalendarDays\(todayVN\(\),\s*30\)/);
 assert.doesNotMatch(customer,/Reservation V3<select|selectedReservation/);
 assert.match(customer,/managedAccessApi\.visitAvailability\(date,/);
 assert.match(customer,/facilityId: chosen\.facilityId/);
 assert.match(customer,/còn hơn 7 ngày thuê/);
 assert.match(customer,/slot\.facilityName/);
 assert.match(customer,/Chọn ngày trong 30 ngày tới/);
 assert.match(api,/reservationId \? \{ reservationId \} : \{\}/);
});
test('Facility editor exposes an explicit Admin/BOM Managed visit schedule without inferring it from general opening hours',()=>{
 const editor=read('../src/pages/bom/FacilityPage.jsx');const mapper=read('../src/lib/bomMappers.js');
 assert.match(editor,/Cấu hình lịch thăm kho/);assert.match(editor,/Asia\/Ho_Chi_Minh/);assert.match(editor,/Tách biệt với giờ mở cửa cơ sở/);
 assert.match(mapper,/managedVisitSchedule/);assert.match(mapper,/visitScheduleDraft/);
});
