import axios from 'axios';
import {apiIssue,MobileInputError} from './client';
import type {ReservationDto} from './contracts/customer';
import {assertOwner,objectId} from './contracts/core';
import {mobileRepo} from './mobileRepository';
import {checkoutLink,depositDecision} from '../domain/livePayment';
import {journal,newAttempt} from '../state/attemptJournal';

const requests={
  reservation:{label:'Tải đơn thuê',method:'GET',path:'/reservations/me'},
  contract:{label:'Tải hợp đồng',method:'GET',path:'/contracts/reservation/:reservationId'},
  history:{label:'Tải lịch sử thanh toán',method:'GET',path:'/reservations/:reservationId/payments/payos'},
  status:{label:'Kiểm tra giao dịch',method:'GET',path:'/reservations/:reservationId/payments/:paymentId'},
  checkout:{label:'Tạo liên kết thanh toán',method:'POST',path:'/reservations/:reservationId/payments/payos'},
} as const;

const checkoutMessages:Record<string,string>={
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
  const [contract,payments,attemptStore]=await Promise.all([
    atStep('contract',()=>mobileRepo.contract(reservation,owner,signal)),
    atStep('history',()=>mobileRepo.payments(reservation,owner,signal)),
    journal('deposit',owner,id),
  ]);
  const attempt=await attemptStore.read();
  const recent=payments.find(item=>item.purpose==='DEPOSIT');
  const balance=refreshBalance?payments.find(item=>item.purpose==='BALANCE'):undefined;
  const readStatus=async(paymentId:string,purpose:'DEPOSIT'|'BALANCE')=>atStep('status',async()=>{
    const payment=await mobileRepo.payment(reservation,paymentId,owner,signal);
    if(payment.purpose!==purpose)throw new MobileInputError('Loại thanh toán không khớp.');
    return payment;
  });
  const depositId=recent?.id??attempt?.resourceId;
  const [currentDeposit,currentBalance]=await Promise.all([
    depositId?readStatus(depositId,'DEPOSIT'):null,
    balance?readStatus(balance.id,'BALANCE'):null,
  ]);
  const verifiedPayments=payments.map(payment=>currentDeposit?.id===payment.id?currentDeposit:currentBalance?.id===payment.id?currentBalance:payment);
  if(!recent&&currentDeposit)verifiedPayments.unshift(currentDeposit);
  return {reservation,contract,payments:verifiedPayments,attempt,attemptStore,
    decision:depositDecision(reservation,contract,verifiedPayments,!!attempt)};
}

export async function openDeposit(id:string,owner:string,isCurrent:()=>boolean,openUrl:(url:string)=>Promise<unknown>){
  const context=await paymentContext(id,owner);
  if(!isCurrent())return;
  if(context.decision.kind==='READY'){
    await openUrl(context.decision.url);
  }else if(context.decision.kind==='CREATE'){
    const attempt=newAttempt();
    if(!await context.attemptStore.claim(attempt)||!isCurrent())return;
    const payment=await atStep('checkout',()=>mobileRepo.deposit(context.reservation,attempt.key,owner));
    await context.attemptStore.write({...attempt,resourceId:payment.id});
    const url=checkoutLink(payment,id);
    if(url&&isCurrent())await openUrl(url);
  }
}
