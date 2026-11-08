import {z} from 'zod';
import {assertOwner,idRef,instant,nonnegative,objectId,positive,readData,refId,whole} from './core';
import {closureContext} from './booking';
import type {ReservationDto} from './customer';

export const dimensions=z.object({widthM:positive,depthM:positive,heightM:positive}).strict();
export const itemCode=z.string().trim().min(1).max(48).transform(v=>v.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]*$/));
const metadata={name:z.string().trim().min(1).max(160),category:z.string().trim().min(1).max(80),quantity:whole.min(1),quantityUnit:z.string().trim().min(1).max(32),unitWeightKg:positive,unitDimensionsM:dimensions};
export const createItemBody=z.object({managedReservationId:objectId,itemCode,...metadata,description:z.string().trim().max(2000).optional(),preferredCellId:objectId.optional(),images:z.array(z.string().url().refine(v=>/^https?:\/\//.test(v))).max(10).optional()}).strict();
export const updateItemBody=createItemBody.omit({managedReservationId:true,itemCode:true}).partial().extend({preferredCellId:objectId.nullable().optional()}).refine(v=>Object.keys(v).length>0);
export const itemDto=z.object({_id:objectId,customerId:idRef,managedReservationId:idRef,facilityId:idRef,itemCode:z.string().min(1),...metadata,status:z.enum(['REGISTERED','PENDING_INBOUND','RECEIVED_PENDING_ACCEPTANCE','IN_STORAGE','PENDING_OUTBOUND','CHECKED_OUT']),currentCellId:idRef.nullish(),images:z.array(z.string().url()).optional()}).passthrough();
export function mapItem(response:unknown,owner:string){const item=readData(itemDto,response);assertOwner(item,owner);return item;}
export const batchDto=z.object({batchId:z.string().min(1),quantity:whole,heldQuantity:whole,quantityUnit:z.string().min(1),actualUnitWeightKg:positive,actualUnitDimensionsM:dimensions,actualTotalWeightKg:nonnegative,actualTotalVolumeM3:nonnegative,receivedAt:instant,arithmeticPolicy:z.enum(['COMPATIBILITY','CANONICAL_V1']).optional()}).passthrough();
export const stockDto=z.object({itemId:idRef,customerId:idRef,managedReservationId:idRef,facilityId:idRef,currentCellId:idRef.nullable(),schemaVersion:z.literal(1),source:z.enum(['LEDGER_V2','LEGACY_RECONCILED']),version:whole,onHandQuantity:whole,heldQuantity:whole,actualTotalWeightKg:nonnegative,actualTotalVolumeM3:nonnegative,batches:z.array(batchDto)}).passthrough();
export function mapStock(response:unknown,item:z.infer<typeof itemDto>,owner:string){
  assertOwner(item,owner);const s=readData(stockDto,response);assertOwner(s,owner);
  if(refId(s.itemId)!==item._id||refId(s.managedReservationId)!==refId(item.managedReservationId)||refId(s.facilityId)!==refId(item.facilityId)||s.heldQuantity>s.onHandQuantity||s.batches.some(b=>b.quantityUnit!==item.quantityUnit||b.heldQuantity>b.quantity))throw Error('Stock projection identity/unit/hold mismatch');
  if(s.batches.reduce((n,b)=>n+b.quantity,0)!==s.onHandQuantity||s.batches.reduce((n,b)=>n+b.heldQuantity,0)!==s.heldQuantity)throw Error('Stock batches do not match projection');
  return {...s,quantityUnit:item.quantityUnit,availableQuantity:s.onHandQuantity-s.heldQuantity};
}
export function inventoryEligibility(r:ReservationDto,operation:'REGISTER'|'EDIT'|'INBOUND'|'OUTBOUND'|'CANCEL',now=Date.now()){
  const c=closureContext(r);if(r.serviceType!=='MANAGED_INVENTORY')return {eligible:false,reason:'Sai dịch vụ lưu trữ'};
  if(operation==='CANCEL')return {eligible:true,reason:'Cần kiểm tra phiên bản, quyền sở hữu và trạng thái của yêu cầu hiện tại trên Backend.'};
  if(operation!=='OUTBOUND'&&!c.mayAddOrEdit)return {eligible:false,reason:'Kỳ thuê đang chờ đóng; không thêm/chỉnh sửa/nhập hàng.'};
  const inTerm=r.status==='ACTIVE'&&Date.parse(r.startDate)<=now&&Date.parse(r.endDate)>now;
  const register=operation==='REGISTER'&&r.bookingFlowVersion===2&&r.status==='DEPOSIT_PAID'&&Date.parse(r.endDate)>now;
  return {eligible:inTerm||register,reason:inTerm||register?'Chỉ eligibility kỳ thuê; Backend vẫn kiểm Item, inspection/custody và gate.':'Kỳ thuê chưa đủ điều kiện. Ngoại lệ sửa hàng sau inspection bị từ chối cần context Backend riêng.'};
}
export const requestKey=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/);
export const repeatedBody=z.object({requestedQuantity:whole.min(1),quantityUnit:z.string().trim().min(1).max(32),declaredUnitWeightKg:positive,declaredUnitDimensionsM:dimensions}).strict();
export const outboundBody=z.object({requestedQuantity:whole.min(1)}).strict();
export function requestHeaders(key:string,version?:number){return {'Idempotency-Key':requestKey.parse(key),...(version===undefined?{}:{'If-Match':`"${whole.parse(version)}"`})};}
export const repeatedRequestDto=z.object({_id:objectId,itemId:idRef,reservationId:idRef,facilityId:idRef,...repeatedBody.shape,state:z.enum(['PENDING_INSPECTION','DISCREPANCY','ACCEPTED_PENDING_CONFIRMATION','RETURN_PENDING','REJECTED','CONFIRMED','CANCELLED']),custodyState:z.enum(['NOT_TAKEN','IN_CUSTODY','RETURNED']),version:whole,createdAt:instant}).passthrough();
export const outboundRequestDto=z.object({_id:objectId,itemId:idRef,reservationId:idRef,facilityId:idRef,requestedQuantity:whole.min(1),quantityUnit:z.string().min(1),state:z.enum(['PENDING','CONFIRMED','PARTIALLY_FULFILLED','CANCELLED']),version:whole}).passthrough();
export function mapScopedRequest(response:unknown,item:z.infer<typeof itemDto>,kind:'INBOUND'|'OUTBOUND',owner:string){
  assertOwner(item,owner);
  const row=kind==='INBOUND'?readData(repeatedRequestDto,response):readData(outboundRequestDto,response);
  if(refId(row.itemId)!==item._id||refId(row.reservationId)!==refId(item.managedReservationId)||refId(row.facilityId)!==refId(item.facilityId)||row.quantityUnit!==item.quantityUnit)throw Error('Request parent scope mismatch');return row;
}
export const movementDto=z.object({_id:objectId,itemId:idRef,type:z.enum(['INBOUND','OUTBOUND','RELOCATION']),quantity:whole.min(1),quantityUnit:z.string().min(1),sourceCellId:idRef.nullish(),destinationCellId:idRef.nullish(),performedAt:instant,actualUnitWeightKg:positive,actualUnitDimensionsM:dimensions,actualTotalWeightKg:nonnegative,actualTotalVolumeM3:nonnegative,inspectionNote:z.string().optional(),schemaVersion:z.union([z.literal(1),z.literal(2)]).optional(),arithmeticPolicy:z.literal('CANONICAL_V1').nullish(),batchLines:z.array(z.object({action:z.enum(['ADD','REMOVE','MOVE']),batchId:z.string().min(1),quantity:whole.min(1),quantityUnit:z.string().min(1)}).passthrough()).optional()}).passthrough();
export function mapMovements(response:unknown,item:z.infer<typeof itemDto>,owner:string){assertOwner(item,owner);return readData(z.array(movementDto),response).map(row=>{if(refId(row.itemId)!==item._id||row.quantityUnit!==item.quantityUnit||row.arithmeticPolicy==='CANONICAL_V1'&&row.schemaVersion!==2)throw Error('Movement identity/unit/arithmetic schema mismatch');return row;});}
