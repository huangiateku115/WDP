import {z} from 'zod';
import {wire,MobileInputError,apiIssueWithStatus} from './client';
import {assertOwner,objectId,readData,readPage,refId,instant,whole,nonnegative,httpUrl} from './contracts/core';
import type {ReservationDto} from './contracts/customer';
import {mapSelfPayment} from './contracts/documents';
import {journal,newAttempt} from '../state/attemptJournal';

export const renewalTerm=z.object({value:whole.min(1).max(120),unit:z.enum(['DAY','MONTH','YEAR'])}).strict();
export type RenewalTerm=z.infer<typeof renewalTerm>;
export const renewalExtension=z.object({_id:objectId,extensionCode:z.string().min(1),durationMonths:whole.min(1),amount:whole.min(1),
  status:z.enum(['PENDING_PAYMENT','PAID','ACTIVE','CANCELLED','REJECTED']),signingDeadline:instant.optional(),paymentId:objectId.optional(),
  oldEndDate:instant,newEndDate:instant,createdAt:instant,updatedAt:instant.optional(),rejectionReason:z.string().optional()}).passthrough();
export const renewalQuote=z.object({reservationId:objectId,durationMonths:whole.min(1),termValue:whole.min(1),termUnit:z.enum(['DAY','MONTH','YEAR']),
  pricingPolicyId:objectId,monthlyPrice:nonnegative,totalAmount:whole.min(1),amount:whole.min(1),currency:z.literal('VND'),oldEndDate:instant,newEndDate:instant,
  canExtend:z.boolean(),reason:z.string()}).passthrough();
export const renewalPayment=z.object({id:objectId,reservationId:objectId,extensionId:objectId,purpose:z.literal('RENEWAL'),amount:whole.min(1),currency:z.literal('VND'),
  provider:z.literal('PAYOS'),providerSettlementStatus:z.enum(['NOT_VERIFIED','VERIFIED']),status:z.enum(['PENDING','SUCCEEDED','FAILED','CANCELLED','RECONCILIATION_REQUIRED']),
  applicationStatus:z.enum(['NOT_APPLIED','APPLIED','MANUAL_REVIEW']),checkoutStatus:z.enum(['NOT_CREATED','CREATING','READY','UNKNOWN','FAILED','CANCELLED','RECONCILIATION_REQUIRED']),
  checkoutUrl:httpUrl.nullable(),expiresAt:instant.nullish(),reconciliationRequired:z.boolean(),retryAllowed:z.boolean().optional(),cancelVerifiedAt:instant.nullable().optional(),succeededAt:instant.nullable().optional()}).passthrough();
export type RenewalExtension=z.infer<typeof renewalExtension>;
export type RenewalPayment=z.infer<typeof renewalPayment>;

export function isRenewalPaymentApplied(payment:RenewalPayment|null|undefined){
  return !!payment&&payment.status==='SUCCEEDED'&&payment.providerSettlementStatus==='VERIFIED'&&payment.applicationStatus==='APPLIED'&&!payment.reconciliationRequired;
}
export function renewalCheckoutUrl(payment:RenewalPayment|null|undefined,reservationId:string,extensionId:string){
  if(!payment||payment.reservationId!==reservationId||payment.extensionId!==extensionId||payment.purpose!=='RENEWAL'||payment.status!=='PENDING'||
    payment.providerSettlementStatus!=='NOT_VERIFIED'||payment.applicationStatus!=='NOT_APPLIED'||payment.checkoutStatus!=='READY'||
    payment.reconciliationRequired||!payment.checkoutUrl||(payment.expiresAt&&Date.parse(payment.expiresAt)<=Date.now()))return null;
  try{const url=new URL(payment.checkoutUrl);return url.protocol==='https:'&&url.hostname==='pay.payos.vn'&&!url.port&&!url.username&&!url.password&&
    /^\/web\/[^/]+\/?$/.test(url.pathname)&&!url.hash?url.href:null;}catch{return null;}
}

const pricingRule=z.object({_id:objectId,facilityId:z.union([objectId,z.object({_id:objectId}).passthrough()]),serviceType:z.literal('SELF_STORAGE'),
  unitSize:z.enum(['SMALL','MEDIUM','LARGE']),term:renewalTerm,isActive:z.boolean(),effectiveFrom:instant,effectiveTo:instant.nullish()}).passthrough();
const isEffective=(row:z.infer<typeof pricingRule>,at:number)=>row.isActive&&Date.parse(row.effectiveFrom)<=at&&(!row.effectiveTo||Date.parse(row.effectiveTo)>at);
const routeId=(value:string)=>objectId.parse(value);

export function renewalErrorMessage(error:unknown){
  const shape=error as {response?:{status?:unknown;data?:{message?:unknown;code?:unknown;error?:{status?:unknown}}}};
  const data=shape?.response?.data;
  const message=typeof data?.message==='string'?data.message.trim():'';
  if(!message)return apiIssueWithStatus(error);
  const status=typeof shape.response?.status==='number'?shape.response.status:typeof data?.error?.status==='number'?data.error.status:undefined;
  const code=typeof data?.code==='string'?data.code:undefined;
  return [message,status?`HTTP ${status}`:undefined,code?`Mã lỗi: ${code}`:undefined].filter(Boolean).join(' · ');
}

export async function availableRenewalTerms(reservation:ReservationDto,owner:string,signal?:AbortSignal):Promise<RenewalTerm[]> {
  assertOwner(reservation,owner);
  if(reservation.serviceType!=='SELF_STORAGE'||!reservation.storageUnitId)throw new MobileInputError('Đơn thuê không hỗ trợ gia hạn Self Storage.');
  const facilityId=refId(reservation.facilityId);
  const unit=reservation.storageUnitId;
  if(typeof unit==='string'||!unit.size)throw new MobileInputError('Chưa thể xác minh kích thước Ô kho trong dữ liệu đơn thuê. Tải lại đơn hoặc liên hệ cơ sở.');
  const size=unit.size;
  const at=Date.parse(reservation.endDate);
  if(!Number.isFinite(at))throw new MobileInputError('Ngày kết thúc hợp đồng không hợp lệ.');
  const seen=new Map<string,RenewalTerm>();
  for(let page=1;page<=100;page++){
    const result=readPage(pricingRule,await wire('GET','/pricing-rules',{params:{facilityId,serviceType:'SELF_STORAGE',...(size?{unitSize:size}:{}),isActive:true,page,limit:100},signal}));
    for(const row of result.items){
      if(refId(row.facilityId)!==facilityId||(size&&row.unitSize!==size))throw new MobileInputError('Bảng giá gia hạn không khớp với đơn thuê.');
      if(isEffective(row,at))seen.set(row.term.unit+':'+row.term.value,row.term);
    }
    if(page>=result.pagination.totalPages)return [...seen.values()].sort((a,b)=>a.value-b.value||a.unit.localeCompare(b.unit));
  }
  throw new MobileInputError('Chưa xác minh được toàn bộ các kỳ hạn gia hạn.');
}

export async function quoteRenewal(reservation:ReservationDto,owner:string,term:RenewalTerm,signal?:AbortSignal){
  assertOwner(reservation,owner);
  const selected=renewalTerm.parse(term);
  const response=await wire('POST','/reservations/'+routeId(reservation._id)+'/renew-quote',{body:{termValue:selected.value,termUnit:selected.unit},signal});
  const quote=readData(renewalQuote,response);
  if(quote.reservationId!==reservation._id||quote.termValue!==selected.value||quote.termUnit!==selected.unit||quote.currency!=='VND')throw new MobileInputError('Báo giá gia hạn không khớp với đơn thuê hoặc kỳ hạn.');
  return quote;
}

export async function createRenewalRequest(reservation:ReservationDto,owner:string,term:RenewalTerm,key:string){
  assertOwner(reservation,owner);
  const selected=renewalTerm.parse(term);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(key))throw new MobileInputError('Khóa yêu cầu gia hạn không hợp lệ.');
  const response=await wire('POST','/reservations/'+routeId(reservation._id)+'/extension-request',{body:{termValue:selected.value,termUnit:selected.unit},key});
  const result=z.object({success:z.literal(true),outcome:z.enum(['CREATED','REPLAYED']).optional(),data:z.object({reservationId:objectId,extension:renewalExtension})}).parse(response);
  if(result.data.reservationId!==reservation._id)throw new MobileInputError('Yêu cầu gia hạn không thuộc đơn thuê này.');
  return result.data.extension;
}

export async function createRenewalPayment(reservation:ReservationDto,owner:string,extension:RenewalExtension,key:string){
  assertOwner(reservation,owner);
  const response=await wire('POST','/reservations/'+routeId(reservation._id)+'/extension-payments/payos',{
    body:{extensionId:objectId.parse(extension._id)},key,clientPlatform:'MOBILE'});
  const result=z.object({success:z.literal(true),outcome:z.enum(['CREATED','REPLAYED']),data:renewalPayment}).parse(response);
  return assertPaymentIdentity(result.data,reservation,extension);
}

function assertPaymentIdentity(payment:RenewalPayment,reservation:ReservationDto,extension:RenewalExtension){
  if(payment.reservationId!==reservation._id||payment.extensionId!==extension._id||payment.amount!==extension.amount||payment.currency!=='VND')
    throw new MobileInputError('Giao dịch gia hạn không khớp với yêu cầu hoặc số tiền Backend.');
  return payment;
}

export async function renewalPaymentStatus(reservation:ReservationDto,owner:string,extension:RenewalExtension,paymentId:string,signal?:AbortSignal){
  assertOwner(reservation,owner);
  const payment=readData(renewalPayment,await wire('GET','/reservations/'+routeId(reservation._id)+'/payments/'+routeId(paymentId),{signal}));
  if(payment.id!==paymentId)throw new MobileInputError('Mã giao dịch gia hạn không khớp.');
  return assertPaymentIdentity(payment,reservation,extension);
}

export async function reconcileRenewalPayment(reservation:ReservationDto,owner:string,extension:RenewalExtension,paymentId:string){
  assertOwner(reservation,owner);
  const payment=readData(renewalPayment,await wire('POST','/reservations/'+routeId(reservation._id)+'/payments/'+routeId(paymentId)+'/reconcile',{body:{}}));
  if(payment.id!==paymentId)throw new MobileInputError('Mã giao dịch gia hạn không khớp.');
  return assertPaymentIdentity(payment,reservation,extension);
}

export async function reconcilePaymentReturn(reservation:ReservationDto,owner:string,paymentId:string){
  assertOwner(reservation,owner);
  const response=await wire('POST','/reservations/'+routeId(reservation._id)+'/payments/'+routeId(paymentId)+'/reconcile',{body:{}});
  const purpose=readData(z.object({purpose:z.string()}),response).purpose;
  if(purpose!=='RENEWAL'){
    const payment=mapSelfPayment(response,reservation,owner);
    if(payment.id!==paymentId)throw new MobileInputError('Giao dịch không khớp.');
    return payment;
  }
  const payment=readData(renewalPayment,response);
  if(payment.id!==paymentId)throw new MobileInputError('Mã giao dịch gia hạn không khớp.');
  const raw=reservation.extendContract?.find(entry=>entry._id===payment.extensionId);
  const extension=renewalExtension.safeParse(raw);
  if(!extension.success)throw new MobileInputError('Không tìm thấy yêu cầu gia hạn tương ứng với giao dịch.');
  return assertPaymentIdentity(payment,reservation,extension.data);
}

export const renewalRequestJournal=(owner:string,reservationId:string)=>journal('renewal-request',owner,reservationId);
export const renewalPaymentJournal=(owner:string,extensionId:string)=>journal('renewal-payment',owner,extensionId);
export {newAttempt};
