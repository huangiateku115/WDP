import {z} from 'zod';
import {assertOwner,httpUrl,idRef,instant,nonnegative,objectId,readData,refId,whole} from './core';
import {reservationDto,type ReservationDto} from './customer';

const contentVersion=z.object({version:whole.min(1),contentHash:z.string().regex(/^[a-f\d]{64}$/i),content:z.record(z.string(),z.unknown())}).passthrough();
const signature=z.object({version:whole.min(1),contentHash:z.string().regex(/^[a-f\d]{64}$/i),signerId:objectId,signerRole:z.enum(['CUSTOMER','FACILITY_STAFF','FACILITY_MANAGER']),signedAt:instant});
export const contractDto=z.object({_id:objectId,customerId:idRef,reservationId:idRef,status:z.enum(['DRAFT','SIGNED','TERMINATED','EXPIRED']),currentContentVersion:whole.min(1).optional(),contentVersions:z.array(contentVersion).optional(),signatures:z.array(signature).optional(),customerSnapshot:z.record(z.string(),z.unknown()).optional(),pricingSnapshot:z.record(z.string(),z.unknown()).optional()}).passthrough();
export function mapContract(response:unknown,owner:string,service:'SELF_STORAGE'|'MANAGED_INVENTORY'){
  const contract=readData(contractDto,response);assertOwner(contract,owner);
  if(service==='SELF_STORAGE')return {contract,current:null,customer:null,facility:null,
    progress:contract.status==='SIGNED'&&typeof contract.signedProofUrl==='string'&&typeof contract.verifiedAt==='string'?'SIGNED_PAPER':contract.status==='SIGNED'?'REQUIRES_VERIFICATION':'DRAFT',
    canSign:false as const,signingReason:'Self Storage dùng hợp đồng giấy và bằng chứng được nhân viên xác minh; không suy diễn chữ ký V2.'};
  const current=contract.contentVersions?.find(v=>v.version===contract.currentContentVersion);
  const valid=contract.signatures?.filter(s=>current&&s.version===current.version&&s.contentHash===current.contentHash)??[];
  const customer=valid.find(s=>s.signerRole==='CUSTOMER'&&s.signerId===owner);
  const facility=valid.find(s=>s.signerRole==='FACILITY_STAFF'||s.signerRole==='FACILITY_MANAGER');
  const signed=contract.status==='SIGNED'&&!!customer&&!!facility;
  const stale=!!contract.signatures?.some(s=>!current||s.version!==current.version||s.contentHash!==current.contentHash);
  return {contract,current,customer,facility,progress:signed?'SIGNED':stale||contract.status==='SIGNED'?'REQUIRES_VERIFICATION':customer?'PARTIAL':'DRAFT',
    canSign:false as const,signingReason:'Tạm khóa ký: Backend chưa ràng buộc đúng phiên bản/mã băm đã đọc. Self hợp đồng giấy không được suy diễn thành chữ ký V2.'};
}
export const paymentDto=z.object({id:objectId,reservationId:objectId,purpose:z.enum(['DEPOSIT','BALANCE']),amount:whole.min(1),currency:z.literal('VND'),provider:z.literal('PAYOS'),providerSettlementStatus:z.enum(['NOT_VERIFIED','VERIFIED']),status:z.enum(['PENDING','SUCCEEDED','FAILED','CANCELLED','RECONCILIATION_REQUIRED']),applicationStatus:z.enum(['NOT_APPLIED','APPLIED','MANUAL_REVIEW']),checkoutStatus:z.enum(['NOT_CREATED','CREATING','READY','UNKNOWN','FAILED','CANCELLED','RECONCILIATION_REQUIRED']),checkoutUrl:httpUrl.nullable(),qrCode:z.string().nullable(),succeededAt:instant.nullable(),cancelVerifiedAt:instant.nullable().optional(),retryAllowed:z.boolean().optional(),reconciliationRequired:z.boolean()});
export function mapSelfPayment(response:unknown,reservation:ReservationDto,owner:string){
  assertOwner(reservation,owner);if(reservation.serviceType!=='SELF_STORAGE')throw Error('Managed PayOS is not supported');const p=readData(paymentDto,response);
  if(p.reservationId!==reservation._id)throw Error('Payment scope mismatch');
  return {...p,applied:p.status==='SUCCEEDED'&&p.providerSettlementStatus==='VERIFIED'&&p.applicationStatus==='APPLIED'&&!p.reconciliationRequired,
    canInitiate:false as const,nativeReturnSupported:true as const};
}
export const payosBody=z.object({purpose:z.enum(['DEPOSIT','BALANCE'])}).strict();
export const payosKey=z.string().trim().min(1).max(120).refine(v=>!/[\r\n]/.test(v));
export function zeroBalancePolicy(service:'SELF_STORAGE'|'MANAGED_INVENTORY'){return service==='SELF_STORAGE'?'ZERO_BALANCE_REQUIRES_REVIEW':'BACKEND_CHECKIN_READY_WITHOUT_PAYMENT_ONLY';}
export const paymentHistoryDto=z.object({items:z.array(paymentDto.extend({createdAt:instant})),nextCursor:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable()});
export function mapPaymentHistory(response:unknown,reservationId:string){const page=readData(paymentHistoryDto,response);if(page.items.some(p=>p.reservationId!==reservationId))throw Error('Payment history scope mismatch');return page;}
export const managedPaymentDto=z.object({_id:objectId,reservationId:idRef,customerId:idRef,serviceType:z.literal('MANAGED_INVENTORY'),purpose:z.enum(['DEPOSIT','BALANCE']),provider:z.literal('MOCK'),amount:whole.min(1),currency:z.literal('VND'),status:z.enum(['PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'])}).passthrough();
export function mapManagedBalance(response:unknown,owner:string){
  const data=readData(z.object({reservation:reservationDto,payment:managedPaymentDto.nullable(),amount:nonnegative,currency:z.literal('VND'),zeroBalance:z.boolean().optional()}).passthrough(),response);
  assertOwner(data.reservation,owner);
  if(data.reservation.serviceType!=='MANAGED_INVENTORY'||data.reservation.bookingFlowVersion!==2)throw Error('Version2 Managed balance required');
  if(data.zeroBalance){if(data.amount!==0||data.payment!==null||data.reservation.status!=='CHECKIN_READY')throw Error('Invalid zero balance result');}
  else {if(!data.payment)throw Error('Missing Managed payment');assertOwner(data.payment,owner);if(refId(data.payment.reservationId)!==data.reservation._id||data.payment.purpose!=='BALANCE'||data.payment.amount!==data.amount)throw Error('Managed balance identity/amount mismatch');}
  return {...data,canInitiate:false as const,canMockConfirm:false as const,active:data.reservation.status==='ACTIVE'};
}
