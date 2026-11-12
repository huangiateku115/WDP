import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {authenticatedDestination} from '../src/lib/customerRedirect.js';
import {paymentStatusView} from '../src/lib/selfStoragePayos.js';

const reservationId='507f1f77bcf86cd799439011',paymentId='507f1f77bcf86cd799439012';

test('PayOS cancellation callback restores only the fixed authenticated Customer return destination',()=>{
  const callback=`/portal/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=SELF_STORAGE&cancel=true&status=CANCELLED&orderCode=1234567890`;
  assert.equal(authenticatedDestination('CUSTOMER',callback),`/portal/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=SELF_STORAGE&cancel=true`);
  assert.equal(authenticatedDestination('CUSTOMER',`https://attacker.example/portal/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=SELF_STORAGE`),'/portal');
});

test('cancel return page reconciles using authenticated API and ignores provider status query values',async()=>{
  const page=await readFile(fileURLToPath(new URL('../src/pages/customer/PayosPaymentReturnPage.jsx',import.meta.url)),'utf8');
  assert.match(page,/reconcilePayosPayment\(reservationId, paymentId, serviceType\)/);
  assert.match(page,/params\.get\("cancel"\) === "true"/);
  assert.doesNotMatch(page,/params\.get\("(?:status|code|orderCode|success)"\)/);
  assert.match(page,/navigate\(`\/portal\/payments\?\$\{query\}`,[\s\S]*replace: true/);
  assert.match(page,/catch \{[\s\S]*Provider lookup can be temporarily unavailable[\s\S]*finally \{[\s\S]*navigate\(`\/portal\/payments\?/);
});

test('Payment History reconciles a cancel return and never treats a pending DTO as cancelled',async()=>{
  const page=await readFile(fileURLToPath(new URL('../src/pages/customer/PaymentHistoryPage.jsx',import.meta.url)),'utf8');
  assert.match(page,/paymentApi\.reconcilePayosPayment\(reservationId, requestedPaymentId, service\)/);
  assert.match(page,/cancelReturn && !confirmedCancel/);
  assert.match(page,/Kiểm tra trạng thái hủy/);
  assert.match(page,/relevantPayment\.status === "CANCELLED" && relevantPayment\.cancelVerifiedAt/);
});

test('only a Backend-confirmed cancellation DTO is presented as cancelled',()=>{
  assert.notEqual(paymentStatusView({status:'CANCELLED',cancelVerifiedAt:null,providerSettlementStatus:'NOT_VERIFIED',applicationStatus:'NOT_APPLIED'}).key,'CANCELLED');
  assert.equal(paymentStatusView({status:'CANCELLED',cancelVerifiedAt:'2026-11-10T00:00:00Z',providerSettlementStatus:'NOT_VERIFIED',applicationStatus:'NOT_APPLIED'}).label,'Đã hủy thanh toán');
});

test('Self Storage full-rent cancel callback must reconcile the persisted READY intent', async () => {
  const page = await readFile(new URL('../src/pages/customer/PayosPaymentReturnPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /if \(cancelReturn \|\| payment\?\.purpose !== "FULL_RENT"\) await reconcilePayosPayment/);
});
