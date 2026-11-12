import type {z} from 'zod';
import type {contractDto,paymentDto} from '../api/contracts/documents';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';

type Payment=z.infer<typeof paymentDto>;
export type PaymentPurpose=Payment['purpose'];
type Contract=z.infer<typeof contractDto>;
export function depositEligible(reservation:ReservationDto, contract:z.infer<typeof contractDto>|null, now=Date.now()){
  return reservation.serviceType==='SELF_STORAGE'&&reservation.status==='CONTRACTED'&&
    !!reservation.expiresAt&&Date.parse(reservation.expiresAt)>now&&contract?.status==='DRAFT'&&
    refId(contract.reservationId)===reservation._id&&refId(contract.customerId)===refId(reservation.customerId);
}
export function applied(payment:Payment){
  return payment.status==='SUCCEEDED'&&payment.providerSettlementStatus==='VERIFIED'&&
    payment.applicationStatus==='APPLIED'&&!payment.reconciliationRequired;
}
export function checkoutLink(payment:Payment,reservationId:string,purpose:PaymentPurpose='DEPOSIT'){
  if(payment.reservationId!==reservationId||payment.purpose!==purpose||payment.status!=='PENDING'||
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

function balanceRequirement(r:ReservationDto,deposit:Payment|undefined){
  if(!deposit||typeof r.estimatedRent!=='number'||typeof r.depositAmount!=='number')return 'UNKNOWN';
  const tax=r.taxAmount??0,discount=r.discountAmount??0;
  if(typeof tax!=='number'||typeof discount!=='number')return 'UNKNOWN';
  const amounts=[r.estimatedRent,r.depositAmount,tax,discount];
  if(!amounts.every(n=>Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER))return 'UNKNOWN';
  const gross=r.estimatedRent+tax;
  const total=gross-discount;
  const rounded=(n:number)=>Math.floor(n+0.5);
  if(gross>Number.MAX_SAFE_INTEGER||total<r.depositAmount||rounded(r.depositAmount)!==deposit.amount)return 'UNKNOWN';
  return rounded(total)-deposit.amount>0?'REQUIRED':'ZERO';
}

export function hasPaperProof(contract:Contract|null){
  return contract?.status==='SIGNED'&&typeof contract.signedProofUrl==='string'&&contract.signedProofUrl.trim()!==''&&
    typeof contract.signedProofPublicId==='string'&&contract.signedProofPublicId.trim()!==''&&
    typeof contract.verifiedAt==='string'&&Number.isFinite(Date.parse(contract.verifiedAt));
}

export function balanceDecision(r:ReservationDto,contract:Contract|null,payments:Payment[],attemptExists=false){
  const rows=payments.filter(p=>p.purpose==='BALANCE');
  if(rows.some(p=>p.reconciliationRequired||p.status==='RECONCILIATION_REQUIRED'||p.applicationStatus==='MANUAL_REVIEW'||
      p.reservationId!==r._id||['UNKNOWN','CREATING','RECONCILIATION_REQUIRED'].includes(p.checkoutStatus)))return {kind:'REVIEW'} as const;
  if(rows.some(applied))return {kind:'APPLIED'} as const;
  if(rows.some(p=>p.providerSettlementStatus==='VERIFIED'||p.status==='SUCCEEDED'||p.applicationStatus==='APPLIED'))return {kind:'VERIFYING'} as const;
  const linkedDeposit=payments.find(p=>p.id===r.depositPaymentId&&p.reservationId===r._id&&p.purpose==='DEPOSIT'&&applied(p));
  const requirement=balanceRequirement(r,linkedDeposit);
  const eligible=r.serviceType==='SELF_STORAGE'&&r.status==='CHECKIN_READY'&&contract&&hasPaperProof(contract)&&
    refId(contract.reservationId)===r._id&&refId(contract.customerId)===refId(r.customerId);
  if(!eligible||requirement==='UNKNOWN')return {kind:'INELIGIBLE'} as const;
  if(requirement==='ZERO')return {kind:rows.length||attemptExists?'REVIEW':'ZERO'} as const;
  const pending=rows.filter(p=>p.status==='PENDING');
  if(pending.length===1){
    const url=checkoutLink(pending[0]!,r._id,'BALANCE');
    if(url)return {kind:'READY',url} as const;
  }
  if(pending.length)return {kind:'PENDING'} as const;
  if(rows.length||attemptExists)return {kind:'REVIEW'} as const;
  return {kind:'CREATE'} as const;
}
