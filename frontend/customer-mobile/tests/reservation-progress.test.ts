import {reservationProgress} from '../src/domain/reservationProgress';
import type {ReservationDto} from '../src/api/contracts/customer';
import type {z} from 'zod';
import type {contractDto,paymentDto} from '../src/api/contracts/documents';

const [id,owner,facility,unit,contractId,depositId,balanceId]='1234567'.split('').map(value=>value.repeat(24)) as [string,string,string,string,string,string,string];
const now=Date.parse('2099-01-01T00:00:00Z');
const r:ReservationDto={_id:id,reservationCode:'R-TEST',customerId:owner,facilityId:facility,storageUnitId:unit,serviceType:'SELF_STORAGE',
  status:'CONTRACTED',startDate:'2099-01-03T00:00:00Z',endDate:'2099-02-03T00:00:00Z',expiresAt:'2099-01-02T00:00:00Z',
  estimatedRent:2000,depositAmount:1000,depositPaymentId:depositId};
const draft:z.infer<typeof contractDto>={_id:contractId,reservationId:id,customerId:owner,status:'DRAFT'};
const signed={...draft,status:'SIGNED' as const,signedProofPublicId:'test-proof',signedProofUrl:'https://proof.invalid/fixture',verifiedAt:'2099-01-02T00:00:00Z'};
const ready:z.infer<typeof paymentDto>={id:depositId,reservationId:id,purpose:'DEPOSIT',provider:'PAYOS',amount:1000,currency:'VND',
  status:'PENDING',providerSettlementStatus:'NOT_VERIFIED',applicationStatus:'NOT_APPLIED',checkoutStatus:'READY',checkoutUrl:'https://pay.payos.vn/web/fixture',
  qrCode:null,succeededAt:null,reconciliationRequired:false};
const settled={...ready,status:'SUCCEEDED' as const,providerSettlementStatus:'VERIFIED' as const,applicationStatus:'APPLIED' as const,checkoutUrl:null};
const settledBalance={...settled,id:balanceId,purpose:'BALANCE' as const};
type Evidence=NonNullable<Parameters<typeof reservationProgress>[1]>;
const run=(status:ReservationDto['status'],overrides:Partial<Evidence>={},reservation:Partial<ReservationDto>={})=>
  reservationProgress({...r,status,...reservation},{contract:draft,payments:[],decision:'INELIGIBLE',...overrides},now)!;
const step=(result:ReturnType<typeof run>,id:string)=>result.steps.find(s=>s.id===id);

test('creation is complete, deposit is next, and a READY checkout is still unpaid',()=>{
  const fresh=run('CONTRACTED',{decision:'CREATE'});
  expect(step(fresh,'booking')?.state).toBe('COMPLETED');
  expect(fresh.next).toMatchObject({mode:'CUSTOMER_ACTION_REQUIRED',action:{destination:'PAYMENT'}});
  const available=run('CONTRACTED',{payments:[ready],decision:'READY'});
  expect(step(available,'deposit')?.state).toBe('CURRENT');
  expect(available.next?.action?.label).toBe('Xem liên kết thanh toán');
});

test.each([
  [{...ready,checkoutStatus:'UNKNOWN'},'BLOCKED','BLOCKED'],
  [{...ready,checkoutStatus:'CREATING'},'CURRENT','WAITING_FOR_SYSTEM'],
  [{...ready,providerSettlementStatus:'VERIFIED'},'CURRENT','WAITING_FOR_SYSTEM'],
  [{...settled,applicationStatus:'NOT_APPLIED'},'CURRENT','WAITING_FOR_SYSTEM'],
  [{...settled,reconciliationRequired:true},'BLOCKED','BLOCKED'],
  [{...ready,status:'FAILED'},'FAILED','BLOCKED'],
] as const)('exceptional deposit evidence remains non-complete (%#)',(payment,state,mode)=>{
  const result=run('CONTRACTED',{payments:[payment],decision:'REVIEW'});
  expect(step(result,'deposit')?.state).toBe(state);
  expect(result.next?.mode).toBe(mode);
  expect(result.next?.action?.label).toBe('Xem trạng thái thanh toán');
});

test('a PayOS redirect hint or an advanced reservation alone cannot settle deposit',()=>{
  const returned=run('DEPOSIT_PAID',{}, {paymentReturnStatus:'PAID'});
  expect(step(returned,'deposit')?.state).toBe('BLOCKED');
  expect(step(returned,'contract')?.state).toBe('UPCOMING');
});

test('applied deposit leads to paper signing and proof is required beyond SIGNED',()=>{
  const draftResult=run('DEPOSIT_PAID',{payments:[settled],decision:'APPLIED'});
  expect(step(draftResult,'deposit')?.state).toBe('COMPLETED');
  expect(draftResult.next).toMatchObject({mode:'WAITING_FOR_STAFF',action:{destination:'CONTRACT',label:'Xem hợp đồng'}});
  expect(step(run('CHECKIN_READY',{contract:{...draft,status:'SIGNED'},payments:[settled]},),'contract')?.state).toBe('CURRENT');
  expect(step(run('DEPOSIT_PAID',{contract:null,payments:[settled]}),'contract')?.state).toBe('BLOCKED');
});

test('verified paper and CHECKIN_READY expose only balance guidance; zero balance does not authorize handover',()=>{
  const due=run('CHECKIN_READY',{contract:signed,payments:[settled]});
  expect(step(due,'contract')?.state).toBe('COMPLETED');
  expect(step(due,'balance')?.state).toBe('CURRENT');
  expect(due.next).toMatchObject({mode:'CUSTOMER_ACTION_REQUIRED'});
  expect(due.next?.action).toBeUndefined();
  const zero=run('CHECKIN_READY',{contract:signed,payments:[settled]},{estimatedRent:1000});
  expect(step(zero,'balance')?.state).toBe('SKIPPED');
  expect(step(zero,'handover')?.state).toBe('BLOCKED');
  const unlinked=run('CHECKIN_READY',{contract:signed,payments:[settled]},{depositPaymentId:undefined});
  expect(step(unlinked,'balance')?.state).toBe('BLOCKED');
});

test('balance settled still needs PAID and physical handover before completion',()=>{
  const evidence={contract:signed,payments:[settled,settledBalance]};
  expect(run('CHECKIN_READY',evidence).next?.mode).toBe('WAITING_FOR_SYSTEM');
  const waiting=run('PAID',evidence);
  expect(step(waiting,'balance')?.state).toBe('COMPLETED');
  expect(waiting.next?.mode).toBe('WAITING_FOR_STAFF');
  const active=run('ACTIVE',evidence);
  expect(step(active,'handover')?.state).toBe('COMPLETED');
  expect(active.next?.mode).toBe('COMPLETED');
  expect(run('ACTIVE',{contract:signed,payments:[]}).next?.mode).toBe('BLOCKED');
});

test('expiry and cancellation suppress checkout and preserve unresolved payment evidence',()=>{
  const expired=run('CONTRACTED',{decision:'READY',payments:[ready]},{expiresAt:'2098-12-31T00:00:00Z'});
  expect(expired.summary).toBe('Đã hết hạn giữ kho');
  expect(expired.next?.action).toBeUndefined();
  const rejected=run('CANCELLED',{payments:[{...ready,checkoutStatus:'UNKNOWN'}]},{rejectReason:'fixture'});
  expect(rejected.summary).toBe('Đơn thuê đã bị từ chối');
  expect(step(rejected,'deposit')?.state).toBe('BLOCKED');
  expect(rejected.next?.action).toBeUndefined();
});

test('My Rentals summary matches the detail projection and does not infer settlement from a list',()=>{
  const reservation={...r,status:'PAID' as const};
  const summary=reservationProgress(reservation)!;
  expect(summary.summary).toBe(run('PAID').summary);
  expect(summary.steps).toEqual([]);
  expect(summary.next).toBeUndefined();
  expect(reservationProgress({...r,serviceType:'MANAGED_INVENTORY'})).toBeNull();
});

test('mismatched payment, contract owner or reservation linkage fail closed',()=>{
  expect(run('DEPOSIT_PAID',{payments:[{...settled,reservationId:unit}]}).steps).toEqual([]);
  expect(run('DEPOSIT_PAID',{contract:{...signed,customerId:unit},payments:[settled]}).next?.mode).toBe('BLOCKED');
});
