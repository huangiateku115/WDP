import {nativePaymentReturnPath,restoreNativePaymentReturnPath} from '../src/api/paymentReturnLink';

const reservationId='507f1f77bcf86cd799439011',paymentId='507f1f77bcf86cd799439012';

test('PayOS callback maps to the registered native return route with a safe cancellation hint',()=>{
  expect(nativePaymentReturnPath(reservationId,paymentId,'SELF_STORAGE',true)).toBe(
    `/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=SELF_STORAGE&cancel=true`);
  expect(nativePaymentReturnPath(reservationId,paymentId,'MANAGED_INVENTORY')).toBeNull();
  expect(nativePaymentReturnPath('../other',paymentId,'SELF_STORAGE')).toBeNull();
});

test('login restoration accepts only the fixed native callback and strips provider query values',()=>{
  const target=`/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=SELF_STORAGE&cancel=true&status=PAID&orderCode=123`;
  expect(restoreNativePaymentReturnPath(target)).toBe(
    `/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=SELF_STORAGE&cancel=true`);
  expect(restoreNativePaymentReturnPath('https://attacker.invalid/payments/return?reservationId='+reservationId)).toBeNull();
  expect(restoreNativePaymentReturnPath('/rentals/'+reservationId+'/payment')).toBeNull();
});
