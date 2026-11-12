import type {z} from 'zod';
import type {contractDto,paymentDto} from '../api/contracts/documents';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';

type Payment=z.infer<typeof paymentDto>;
export type PaymentPurpose=Payment['purpose'];
type Contract=z.infer<typeof contractDto>;
export function depositEligible(reservation:ReservationDto, contract:z.infer<typeof contractDto>|null, now=Date.now()){
  return reservation.rentalPaymentFlow!=='FULL_UPFRONT_V1'&&reservation.serviceType==='SELF_STORAGE'&&reservation.status==='CONTRACTED'&&
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
  if (!attemptExists && deposits.length && deposits.every(fullRentTerminal) && deposits[0]?.retryAllowed === true) return {kind:'CREATE'} as const;
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
  const eligible=r.rentalPaymentFlow!=='FULL_UPFRONT_V1'&&r.serviceType==='SELF_STORAGE'&&r.status==='CHECKIN_READY'&&contract&&hasPaperProof(contract)&&
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

export function fullRentReady(payment: Payment, reservationId: string) {
  return payment.reservationId === reservationId && payment.purpose === 'FULL_RENT' &&
    payment.status === 'PENDING' && payment.checkoutStatus === 'READY' &&
    payment.providerSettlementStatus === 'NOT_VERIFIED' && payment.applicationStatus === 'NOT_APPLIED' &&
    !payment.reconciliationRequired && (!payment.expiresAt || Date.parse(payment.expiresAt) > Date.now());
}

export function fullRentTerminal(payment: Payment) {
  return payment.providerSettlementStatus === 'NOT_VERIFIED' && payment.applicationStatus === 'NOT_APPLIED' &&
    !payment.reconciliationRequired &&
    ((payment.status === 'CANCELLED' && payment.checkoutStatus === 'CANCELLED' && !!payment.cancelVerifiedAt) ||
     (payment.status === 'FAILED' && payment.checkoutStatus === 'FAILED'));
}

export function fullRentDecision(r: ReservationDto, contract: Contract | null, payments: Payment[],
  attempt?: {resourceId?: string} | null) {
  const rows = payments.filter(payment => payment.purpose === 'FULL_RENT');
  if (rows.some(payment => payment.reservationId !== r._id || payment.reconciliationRequired ||
      payment.applicationStatus === 'MANUAL_REVIEW' || payment.status === 'RECONCILIATION_REQUIRED')) return {kind: 'REVIEW'} as const;
  if (rows.some(applied)) return {kind: 'APPLIED'} as const;
  if (r.rentalPaymentFlow !== 'FULL_UPFRONT_V1' || r.status !== 'CONTRACTED' ||
      !r.expiresAt || Date.parse(r.expiresAt) <= Date.now() || contract?.status !== 'DRAFT' ||
      refId(contract.reservationId) !== r._id || refId(contract.customerId) !== refId(r.customerId))
    return {kind: 'INELIGIBLE'} as const;
  const outstanding = rows.filter(payment => !fullRentTerminal(payment));
  if (outstanding.length === 1 && fullRentReady(outstanding[0]!, r._id)) {
    const payment = outstanding[0]!;
    const url = checkoutLink(payment, r._id, 'FULL_RENT');
    if (url || (payment.qrCode && /^000201[\x20-\x7E]{10,4090}$/.test(payment.qrCode))) return {kind: 'READY', payment, url} as const;
  }
  if (outstanding.length) return {kind: 'REVIEW'} as const;
  if (attempt && !rows.some(row => row.id === attempt.resourceId && fullRentTerminal(row))) return {kind: 'REVIEW'} as const;
  if (rows.length && rows[0]?.retryAllowed !== true) return {kind: 'REVIEW'} as const;
  return {kind: 'CREATE', retry: rows.length > 0} as const;
}
