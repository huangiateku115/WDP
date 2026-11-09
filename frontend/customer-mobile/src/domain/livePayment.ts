import type {z} from 'zod';
import type {contractDto,paymentDto} from '../api/contracts/documents';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';

type Payment=z.infer<typeof paymentDto>;
export function depositEligible(reservation:ReservationDto, contract:z.infer<typeof contractDto>|null, now=Date.now()){
  return reservation.serviceType==='SELF_STORAGE'&&reservation.status==='CONTRACTED'&&
    !!reservation.expiresAt&&Date.parse(reservation.expiresAt)>now&&contract?.status==='DRAFT'&&
    refId(contract.reservationId)===reservation._id&&refId(contract.customerId)===refId(reservation.customerId);
}
export function applied(payment:Payment){
  return payment.status==='SUCCEEDED'&&payment.providerSettlementStatus==='VERIFIED'&&
    payment.applicationStatus==='APPLIED'&&!payment.reconciliationRequired;
}
export function checkoutLink(payment:Payment,reservationId:string){
  if(payment.reservationId!==reservationId||payment.purpose!=='DEPOSIT'||payment.status!=='PENDING'||
     payment.checkoutStatus!=='READY'||payment.applicationStatus!=='NOT_APPLIED'||
     payment.providerSettlementStatus!=='NOT_VERIFIED'||payment.reconciliationRequired||!payment.checkoutUrl) return null;
  try {
    const u=new URL(payment.checkoutUrl);
    return u.protocol==='https:'&&u.hostname==='pay.payos.vn'&&!u.port&&!u.username&&!u.password&&
      /^\/web\/[^/]+\/?$/.test(u.pathname)&&!u.hash ? u.href : null;
  } catch {return null;}
}
export function depositDecision(reservation:ReservationDto,contract:z.infer<typeof contractDto>|null,
  payments:Payment[],attemptExists:boolean){
  const deposits=payments.filter(payment=>payment.purpose==='DEPOSIT');
  if(deposits.some(applied)) return {kind:'APPLIED'} as const;
  if(deposits.some(payment=>payment.reservationId!==reservation._id||payment.reconciliationRequired||
      payment.applicationStatus==='MANUAL_REVIEW'||payment.status==='RECONCILIATION_REQUIRED'||
      ['UNKNOWN','CREATING','RECONCILIATION_REQUIRED'].includes(payment.checkoutStatus))){
    return {kind:'REVIEW'} as const;
  }
  if(!depositEligible(reservation,contract)) return {kind:'INELIGIBLE'} as const;
  if(deposits.length===1){
    const url=checkoutLink(deposits[0]!,reservation._id);
    if(url)return {kind:'READY',url} as const;
  }
  return deposits.length||attemptExists ? {kind:'REVIEW'} as const : {kind:'CREATE'} as const;
}
