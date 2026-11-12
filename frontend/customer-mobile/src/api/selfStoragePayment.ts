import axios from 'axios';
import {apiIssue,MobileInputError} from './client';
import type {ReservationDto} from './contracts/customer';
import {assertOwner,objectId} from './contracts/core';
import {mobileRepo} from './mobileRepository';
import {balanceDecision,checkoutLink,depositDecision,fullRentDecision,type PaymentPurpose} from '../domain/livePayment';
import {journal,newAttempt} from '../state/attemptJournal';

const requests={
  reservation:{label:'Tải đơn thuê',method:'GET',path:'/reservations/me'},
  contract:{label:'Tải hợp đồng',method:'GET',path:'/contracts/reservation/:reservationId'},
  history:{label:'Tải lịch sử thanh toán',method:'GET',path:'/reservations/:reservationId/payments/payos'},
  status:{label:'Kiểm tra giao dịch',method:'GET',path:'/reservations/:reservationId/payments/:paymentId'},
  checkout:{label:'Tạo liên kết thanh toán',method:'POST',path:'/reservations/:reservationId/payments/payos'},
} as const;

const checkoutMessages:Record<string,string>={
  BALANCE_NOT_ELIGIBLE:'Đơn thuê chưa đủ điều kiện thanh toán số dư.',
  SIGNED_PROOF_REQUIRED:'Hợp đồng giấy chưa được xác minh.',
  VERIFIED_DEPOSIT_REQUIRED:'Tiền cọc chưa được xác minh và áp dụng.',
  ZERO_BALANCE_REQUIRES_REVIEW:'Không có số dư dương. Vui lòng liên hệ cơ sở.',
  CONTRACT_REQUIRED:'Đơn thuê cần có hợp đồng trước khi thanh toán.',
  CONTRACT_STATE_INVALID:'Hợp đồng hiện tại không còn đủ điều kiện thanh toán tiền cọc.',
  DEPOSIT_NOT_ELIGIBLE:'Đơn thuê đã hết hạn hoặc không còn đủ điều kiện thanh toán tiền cọc.',
  PAYMENT_INTENT_NO_LONGER_ELIGIBLE:'Giao dịch hiện tại không còn đủ điều kiện mở liên kết.',
  PAYMENT_ALREADY_SETTLED:'Máy chủ đã ghi nhận thanh toán trước đó. Hãy kiểm tra trạng thái.',
  PAYMENT_INTENT_OUTCOME_UNKNOWN:'Chưa xác định kết quả. Hãy kiểm tra giao dịch hiện có trước khi tiếp tục.',
  PAYOS_RESPONSE_MISMATCH:'Máy chủ yêu cầu đối soát phản hồi của PayOS. Hãy kiểm tra giao dịch hiện có.',
};

export class PaymentRequestError extends MobileInputError {
  constructor(readonly step:keyof typeof requests,readonly status:number|null,readonly code:string|null,detail:string){
    const {label,method,path}=requests[step];
    const response=status===null?'':` (${method} ${path}, HTTP ${status}${code?`, ${code}`:''})`;
    super(`${label} chưa thành công${response}. ${detail}`);
  }
}

async function atStep<T>(step:keyof typeof requests,load:()=>Promise<T>):Promise<T>{
  try{return await load();}
  catch(error){
    if(axios.isCancel(error))throw error;
    const response=axios.isAxiosError(error)?error.response:undefined;
    const raw=response?.data?.code;
    const code=typeof raw==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(raw)?raw:null;
    const detail=(step==='checkout'&&code&&Object.hasOwn(checkoutMessages,code)?checkoutMessages[code]:undefined)??apiIssue(error);
    throw new PaymentRequestError(step,response?.status??null,code,detail);
  }
}

export async function paymentContext(id:string,owner:string,signal?:AbortSignal,refreshBalance=false){
  if(!objectId.safeParse(id).success)throw new MobileInputError('Mã đơn thuê không hợp lệ.');
  const reservation=await atStep('reservation',()=>mobileRepo.rental(id,owner,signal));
  return readRentalPayment(reservation,owner,signal,refreshBalance);
}

export async function readRentalPayment(reservation:ReservationDto,owner:string,signal?:AbortSignal,refreshBalance=false){
  assertOwner(reservation,owner);
  const id=reservation._id;
  if(reservation.serviceType!=='SELF_STORAGE')throw new MobileInputError('PayOS hiện chỉ hỗ trợ kho tự quản.');
  const upfront = reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1';
  const [contract,history,attemptStore,balanceStore]=await Promise.all([
    atStep('contract',()=>mobileRepo.contract(reservation,owner,signal)),
    atStep('history',()=>mobileRepo.payments(reservation,owner,signal)),
    journal(upfront?'full-rent':'deposit',owner,id),
    refreshBalance&&!upfront?journal('balance',owner,id):null,
  ]);
  const [attempt,balanceAttempt]=await Promise.all([attemptStore.read(),balanceStore?.read()]);
  const payments=[...history].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));
  const targets=new Map<string,PaymentPurpose>();
  function addTarget(paymentId:string|undefined,purpose:PaymentPurpose){
    if(!paymentId)return;
    if(targets.has(paymentId)&&targets.get(paymentId)!==purpose)throw new MobileInputError('Giao dịch không khớp mục đích thanh toán.');
    targets.set(paymentId,purpose);
  }
  if (upfront) {
    addTarget(payments.find(p=>p.purpose==='FULL_RENT')?.id??attempt?.resourceId,'FULL_RENT');
    addTarget(attempt?.resourceId,'FULL_RENT');
  } else {
    addTarget(payments.find(p=>p.purpose==='DEPOSIT')?.id??attempt?.resourceId,'DEPOSIT');
  }
  if(refreshBalance&&!upfront){
    addTarget(payments.find(p=>p.purpose==='BALANCE')?.id??balanceAttempt?.resourceId,'BALANCE');
    if(reservation.status==='CHECKIN_READY'&&typeof reservation.depositPaymentId==='string'){
      addTarget(reservation.depositPaymentId,'DEPOSIT');
    }
  }
  const refreshed=await Promise.all(Array.from(targets,([paymentId,purpose])=>atStep('status',async()=>{
    const payment=await mobileRepo.payment(reservation,paymentId,owner,signal);
    if(payment.purpose!==purpose)throw new MobileInputError('Loại thanh toán không khớp.');
    return payment;
  })));
  const byId=new Map(refreshed.map(payment=>[payment.id,payment]));
  const verifiedPayments:Array<Omit<typeof payments[number],'createdAt'>&{createdAt?:string}>=payments.map(payment=>({
    ...payment,...byId.get(payment.id),
  }));
  for(const payment of refreshed){
    if(!payments.some(row=>row.id===payment.id))verifiedPayments.push(payment);
  }
  return {reservation,contract,payments:verifiedPayments,attempt,attemptStore,balanceStore,balanceAttemptExists:!!balanceAttempt,
    fullRentDecision:upfront?fullRentDecision(reservation,contract,verifiedPayments,attempt):null,
    decision:depositDecision(reservation,contract,verifiedPayments,!!attempt),
    balanceDecision:balanceDecision(reservation,contract,verifiedPayments,!!balanceAttempt)};
}

export async function openDeposit(id:string,owner:string,isCurrent:()=>boolean,openUrl:(url:string)=>Promise<unknown>){
  return openSelfStoragePayment(id,owner,'DEPOSIT',isCurrent,openUrl);
}

export async function openSelfStoragePayment(id:string,owner:string,purpose:PaymentPurpose,isCurrent:()=>boolean,openUrl:(url:string)=>Promise<unknown>){
  const context=await paymentContext(id,owner,undefined,purpose==='BALANCE');
  if (purpose === 'FULL_RENT' || context.reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1') return;
  const decision=purpose==='BALANCE'?context.balanceDecision:context.decision;
  const store=purpose==='BALANCE'?context.balanceStore:context.attemptStore;
  if(!isCurrent())return;
  if(decision.kind==='READY'){
    await openUrl(decision.url);
  }else if(decision.kind==='CREATE'&&store){
    const attempt=newAttempt();
    if(!await store.claim(attempt)||!isCurrent())return;
    const payment=await atStep('checkout',()=>mobileRepo.checkout(context.reservation,attempt.key,owner,purpose));
    await store.write({...attempt,resourceId:payment.id});
    const url=checkoutLink(payment,id,purpose);
    if(url&&isCurrent())await openUrl(url);
  }
}

export async function createFullRentIntent(id: string, owner: string, isCurrent: () => boolean) {
  const context = await paymentContext(id, owner);
  if (!isCurrent() || context.fullRentDecision?.kind !== 'CREATE') return;
  const attempt = newAttempt();
  if (!await context.attemptStore.claim(attempt, context.attempt?.key) || !isCurrent()) return;
  const payment = await atStep('checkout', () => mobileRepo.checkout(context.reservation, attempt.key, owner, 'FULL_RENT'));
  await context.attemptStore.write({...attempt, resourceId:payment.id});
  return payment;
}
