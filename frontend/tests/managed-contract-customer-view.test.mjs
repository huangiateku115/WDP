import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Customer contract page reloads Backend state and distinguishes verified paper proof from print summary',async()=>{
 const page=await read('../src/components/customer/RentalLifecycleIntegration.jsx');
 assert.match(page,/Làm mới hợp đồng/);
 assert.match(page,/Hợp đồng giấy đã xác nhận/);
 assert.match(page,/signedProofPublicId/);
 assert.match(page,/signedProofUrl/);
 assert.match(page,/Xem hợp đồng đã ký/);
 assert.match(page,/Tải tệp/);
 assert.match(page,/verifiedAt/);
 assert.match(page,/verifiedByStaff\?\.displayName/);
 assert.match(page,/res\.cloudinary\.com/);
 assert.match(page,/\.pdf\$/i);
});

test('Contract proof name is populated only from the existing authenticated contract read APIs',async()=>{
 const controller=await read('../../backend/src/controllers/contracts/contract.controller.ts');
 const routes=await read('../../backend/src/routes/contract.routes.ts');
 assert.match(controller,/populate\('verifiedByStaff', 'fullName displayName'\)/);
 assert.match(routes,/router\.get\('\/reservation\/:reservationId', requireRole\(\[UserRole\.CUSTOMER/);
 assert.match(controller,/if \(!isOwner && !isStaff\) return res\.status\(404\)/);
});
