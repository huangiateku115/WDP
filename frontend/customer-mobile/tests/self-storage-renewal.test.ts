import {availableRenewalTerms,createRenewalPayment,createRenewalRequest,isRenewalPaymentApplied,quoteRenewal,reconcilePaymentReturn,renewalCheckoutUrl,renewalErrorMessage,type RenewalExtension,type RenewalPayment} from '../src/api/selfStorageRenewal';
import type {ReservationDto} from '../src/api/contracts/customer';
import {mapReservations} from '../src/api/contracts/customer';

const mockWire=jest.fn();
jest.mock('../src/api/client',()=>({wire:(...args:unknown[])=>mockWire(...args),apiIssueWithStatus:()=> 'Không thể xác minh dữ liệu máy chủ.',MobileInputError:class MobileInputError extends Error{}}));

const owner='aaaaaaaaaaaaaaaaaaaaaaaa',reservationId='bbbbbbbbbbbbbbbbbbbbbbbb',extensionId='cccccccccccccccccccccccc',paymentId='dddddddddddddddddddddddd';
const reservation={_id:reservationId,reservationCode:'R-1',customerId:owner,facilityId:'eeeeeeeeeeeeeeeeeeeeeeee',storageUnitId:'ffffffffffffffffffffffff',serviceType:'SELF_STORAGE',status:'ACTIVE',startDate:'2026-01-01T00:00:00.000Z',endDate:'2026-12-01T00:00:00.000Z'} as ReservationDto;
const extension={_id:extensionId,extensionCode:'EXT-1',durationMonths:1,amount:100000,status:'PENDING_PAYMENT',oldEndDate:'2026-12-01T00:00:00.000Z',newEndDate:'2027-01-01T00:00:00.000Z',createdAt:'2026-11-01T00:00:00.000Z'} as RenewalExtension;
const payment={id:paymentId,reservationId,extensionId,purpose:'RENEWAL',amount:100000,currency:'VND',provider:'PAYOS',providerSettlementStatus:'NOT_VERIFIED',status:'PENDING',applicationStatus:'NOT_APPLIED',checkoutStatus:'READY',checkoutUrl:'https://pay.payos.vn/web/abc',reconciliationRequired:false} as RenewalPayment;

beforeEach(()=>mockWire.mockReset());

test('Renewal is applied only with verified settlement and backend application',()=>{
  expect(isRenewalPaymentApplied(payment)).toBe(false);
  expect(isRenewalPaymentApplied({...payment,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED'})).toBe(false);
  expect(isRenewalPaymentApplied({...payment,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'})).toBe(true);
  expect(isRenewalPaymentApplied({...payment,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED',reconciliationRequired:true})).toBe(false);
});

test('Only a current Backend READY HTTPS checkout can be opened',()=>{
  expect(renewalCheckoutUrl(payment,reservationId,extensionId)).toBe(payment.checkoutUrl);
  expect(renewalCheckoutUrl({...payment,checkoutStatus:'UNKNOWN'},reservationId,extensionId)).toBeNull();
  expect(renewalCheckoutUrl({...payment,checkoutUrl:'https://checkout.example/web/abc'},reservationId,extensionId)).toBeNull();
  expect(renewalCheckoutUrl({...payment,checkoutUrl:'https://pay.payos.vn/web/first/second'},reservationId,extensionId)).toBeNull();
  expect(renewalCheckoutUrl(payment,reservationId,'111111111111111111111111')).toBeNull();
});

test('Extension request sends only Backend term with persisted idempotency key',async()=>{
  mockWire.mockResolvedValue({success:true,outcome:'CREATED',data:{reservationId,extension}});
  const result=await createRenewalRequest(reservation,'aaaaaaaaaaaaaaaaaaaaaaaa',{value:1,unit:'MONTH'},'wdp-mobile-00000000-0000-4000-8000-000000000001');
  expect(result._id).toBe(extensionId);
  expect(mockWire).toHaveBeenCalledWith('POST',`/reservations/${reservationId}/extension-request`,expect.objectContaining({
    body:{termValue:1,termUnit:'MONTH'},key:'wdp-mobile-00000000-0000-4000-8000-000000000001'}));
});

test('PayOS renewal intent sends only extension ID and MOBILE client marker',async()=>{
  mockWire.mockResolvedValue({success:true,outcome:'CREATED',data:payment});
  await createRenewalPayment(reservation,owner,extension,'wdp-mobile-00000000-0000-4000-8000-000000000002');
  expect(mockWire).toHaveBeenCalledWith('POST',`/reservations/${reservationId}/extension-payments/payos`,{
    body:{extensionId},key:'wdp-mobile-00000000-0000-4000-8000-000000000002',clientPlatform:'MOBILE'});
  mockWire.mockResolvedValue({success:true,outcome:'CREATED',data:{...payment,amount:1}});
  await expect(createRenewalPayment(reservation,owner,extension,'wdp-mobile-00000000-0000-4000-8000-000000000003')).rejects.toThrow();
});

test('Renewal term choices come from current Facility pricing rules',async()=>{
  const activeRental={...reservation,storageUnitId:{_id:'ffffffffffffffffffffffff',unitCode:'U-1',size:'MEDIUM',volumeM3:1,status:'OCCUPIED'}};
  const [mappedRental]=mapReservations({success:true,data:[activeRental]},owner);
  mockWire.mockResolvedValue({success:true,data:[
    {_id:'111111111111111111111111',facilityId:'eeeeeeeeeeeeeeeeeeeeeeee',serviceType:'SELF_STORAGE',unitSize:'MEDIUM',term:{value:2,unit:'MONTH'},isActive:true,effectiveFrom:'2025-01-01T00:00:00.000Z'},
    {_id:'222222222222222222222222',facilityId:'eeeeeeeeeeeeeeeeeeeeeeee',serviceType:'SELF_STORAGE',unitSize:'MEDIUM',term:{value:6,unit:'MONTH'},isActive:false,effectiveFrom:'2025-01-01T00:00:00.000Z'},
  ],pagination:{page:1,limit:100,total:2,totalPages:1}});
  await expect(availableRenewalTerms(mappedRental!,owner)).resolves.toEqual([{value:2,unit:'MONTH'}]);
  expect(mockWire).toHaveBeenCalledWith('GET','/pricing-rules',{params:{facilityId:'eeeeeeeeeeeeeeeeeeeeeeee',serviceType:'SELF_STORAGE',unitSize:'MEDIUM',isActive:true,page:1,limit:100},signal:undefined});
  expect(mockWire).toHaveBeenCalledTimes(1);
  expect(mockWire).not.toHaveBeenCalledWith('GET','/storage-units/ffffffffffffffffffffffff',expect.anything());
});

test('Renewal does not read an occupied unit through the booking detail endpoint and fails closed if Reservation lacks its size',async()=>{
  await expect(availableRenewalTerms(reservation,owner)).rejects.toThrow('Chưa thể xác minh kích thước Ô kho');
  expect(mockWire).not.toHaveBeenCalled();
});

test('Customer ownership is checked before requesting Renewal pricing',async()=>{
  await expect(availableRenewalTerms(reservation,'999999999999999999999999')).rejects.toThrow();
  expect(mockWire).not.toHaveBeenCalled();
});

test('Actual Backend renewal rejection message and HTTP status are preserved for Mobile',()=>{
  expect(renewalErrorMessage({response:{status:409,data:{message:'Gia hạn bị từ chối do lịch thuê bị trùng.',error:{status:409}}}}))
    .toBe('Gia hạn bị từ chối do lịch thuê bị trùng. · HTTP 409');
});

test('Ineligible quote preserves the Backend reason and never calculates a Client price',async()=>{
  mockWire.mockResolvedValue({success:true,data:{reservationId,termValue:2,termUnit:'MONTH',durationMonths:2,
    pricingPolicyId:'111111111111111111111111',monthlyPrice:70000,totalAmount:140000,amount:140000,currency:'VND',
    oldEndDate:'2026-12-01T00:00:00.000Z',newEndDate:'2027-02-01T00:00:00.000Z',canExtend:false,reason:'Hợp đồng giấy chưa được xác minh.'}});
  const quote=await quoteRenewal(reservation,owner,{value:2,unit:'MONTH'});
  expect(quote.canExtend).toBe(false);
  expect(quote.reason).toBe('Hợp đồng giấy chưa được xác minh.');
  expect(mockWire).toHaveBeenCalledWith('POST',`/reservations/${reservationId}/renew-quote`,{body:{termValue:2,termUnit:'MONTH'},signal:undefined});
});

test('PayOS return reconciles Renewal through the shared payment status endpoint and verifies Extension identity',async()=>{
  mockWire.mockResolvedValue({success:true,data:payment});
  const result=await reconcilePaymentReturn({...reservation,extendContract:[extension]} as ReservationDto,owner,paymentId);
  expect(result.purpose).toBe('RENEWAL');
  expect(mockWire).toHaveBeenCalledWith('POST',`/reservations/${reservationId}/payments/${paymentId}/reconcile`,{body:{}});
});
