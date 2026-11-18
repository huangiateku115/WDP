import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {assertOwner,idRef,objectId,readData,refId,whole} from './contracts/core';
import type {mobileRepo} from './mobileRepository';
import type {ReservationDto} from './contracts/customer';
import type {managedReservationReads} from './managedReservationReads';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
type Session=Awaited<ReturnType<typeof managedReservationReads.sessions>>[number];
const id=(v:unknown)=>objectId.parse(v);
const contextDto=z.object({sku:z.object({id:objectId,itemCode:z.string(),name:z.string(),revision:whole}),reservation:z.object({id:objectId,reservationCode:z.string(),status:z.string()}),
  reservationScopes:z.array(z.object({reservation:z.object({id:objectId,reservationCode:z.string(),facilityId:objectId,status:z.string()}),stock:z.object({skuRevision:whole,reservationId:objectId,
    itemSpecifications:z.array(z.object({itemSpecId:objectId,code:z.string(),name:z.string(),revision:whole,quantityUnit:z.string(),quantityAvailable:whole,stockKind:z.string(),
      receipts:z.array(z.object({receiptId:z.string(),cellId:objectId,cellCode:z.string().nullable(),quantityOnHand:whole,quantityHeld:whole,quantityAvailable:whole}).passthrough()),
      instances:z.array(z.object({itemInstanceId:z.string(),quantity:whole}).passthrough())}).passthrough())}).passthrough()}).passthrough()),
  stock:z.object({skuRevision:whole,reservationId:objectId,itemSpecifications:z.array(z.unknown())}).passthrough()}).passthrough();
const relocationDto=z.object({sku:z.object({id:objectId,itemCode:z.string(),name:z.string(),revision:whole}),reservation:z.object({id:objectId,reservationCode:z.string(),status:z.string()}),
  reservations:z.array(z.object({id:objectId,reservationCode:z.string(),status:z.string()})),cells:z.array(z.object({id:objectId,code:z.string(),reservationId:objectId,reservationCode:z.string(),operationalStatus:z.string(),maxWeightKg:z.number(),usedWeightKg:z.number(),maxVolumeM3:z.number(),usedVolumeM3:z.number()}).passthrough()),
  itemSpecifications:z.array(z.object({itemSpecId:objectId,code:z.string(),name:z.string(),revision:whole,availableQuantity:whole,receipts:z.array(z.object({receiptId:z.string(),reservationId:objectId,cellId:objectId,cellCode:z.string().nullable(),quantityAvailable:whole}).passthrough()),instances:z.array(z.unknown())}).passthrough()),ledgerRevision:whole}).passthrough();
const proof=z.object({status:z.literal('READY'),canConfirm:z.literal(true).optional(),skuId:objectId,reservationId:objectId,accessSession:z.object({sessionId:objectId,purpose:z.enum(['OUTBOUND','RELOCATION']),revision:whole,expiresAt:z.string()}),
  lines:z.array(z.unknown()),totalQuantity:whole,totalWeightKg:z.number(),totalVolumeM3:z.number(),warnings:z.array(z.string()).optional(),capacity:z.array(z.unknown()).optional()}).passthrough();
const committed=z.object({status:z.literal('COMMITTED'),movement:z.object({itemId:objectId,customerId:idRef,idempotencyKey:z.string(),schemaVersion:z.literal(4),
  stockEffect:z.object({action:z.enum(['REMOVE','MOVE'])}).passthrough()}).passthrough()}).passthrough();
function verifiedCommit(value:z.infer<typeof committed>,item:Item,owner:string,key:string,action:'REMOVE'|'MOVE'){
  if(refId(value.movement.itemId)!==item._id||refId(value.movement.customerId)!==owner||value.movement.idempotencyKey!==key||value.movement.stockEffect.action!==action)
    throw new MobileInputError('Chưa xác minh được Movement đã ghi sổ cho đúng SKU và yêu cầu.');
  return value;
}
function base(item:Item,owner:string){assertOwner(item,owner);if(item.inventorySchemaVersion!==3)throw new MobileInputError('Thao tác này chỉ hỗ trợ SKU Managed Inventory V3.');return `/inventory-items/${id(item._id)}/v3/`;}
function assertReservation(item:Item,r:ReservationDto,owner:string){assertOwner(r,owner);if(r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3||refId(item.managedReservationId)!==r._id||refId(item.facilityId)!==refId(r.facilityId))throw new MobileInputError('Reservation không thuộc SKU V3 này.');}
export const managedStockOperations={
  async outboundContext(item:Item,owner:string){return readData(contextDto,await wire('GET',base(item,owner)+'outbound/context'));},
  async outboundPreview(item:Item,r:ReservationDto,owner:string,session:Session,input:unknown){assertReservation(item,r,owner);const body=z.object({accessSessionId:objectId,sessionRevision:whole,skuRevision:whole,reservationId:objectId,lines:z.array(z.unknown()).min(1)}).passthrough().parse(input);
    if(body.reservationId!==r._id||body.accessSessionId!==session._id||!session.allowedPurposes.includes('OUTBOUND')||session.revision!==body.sessionRevision)throw new MobileInputError('Phiên xuất kho hoặc Reservation không còn khớp.');
    return readData(proof,await wire('POST',base(item,owner)+'outbound/preview',{body}));},
  async outboundConfirm(item:Item,r:ReservationDto,owner:string,body:unknown,key:string){assertReservation(item,r,owner);return verifiedCommit(readData(committed,await wire('POST',base(item,owner)+'outbound',{body,key,ifMatch:(body as {skuRevision:number}).skuRevision})),item,owner,key,'REMOVE');},
  async outboundOperation(item:Item,owner:string,key:string){return verifiedCommit(readData(committed,await wire('GET',base(item,owner)+'outbound/operations',{params:{key}})),item,owner,key,'REMOVE');},
  async relocationContext(item:Item,owner:string){return readData(relocationDto,await wire('GET',base(item,owner)+'relocation/context'));},
  async relocationPreview(item:Item,r:ReservationDto,owner:string,session:Session,body:unknown){assertOwner(r,owner);const candidate=z.object({accessSessionId:objectId,sessionRevision:whole,skuRevision:whole,lines:z.array(z.unknown()).min(1)}).passthrough().parse(body);
    if(!session.allowedPurposes.includes('RELOCATION')||candidate.accessSessionId!==session._id||candidate.sessionRevision!==session.revision)throw new MobileInputError('Phiên chuyển vị trí không còn khớp.');
    return readData(proof,await wire('POST',base(item,owner)+'relocation/preview',{body}));},
  async relocationConfirm(item:Item,owner:string,body:unknown,key:string){return verifiedCommit(readData(committed,await wire('POST',base(item,owner)+'relocation',{body,key,ifMatch:(body as {skuRevision:number}).skuRevision})),item,owner,key,'MOVE');},
  async relocationOperation(item:Item,owner:string,key:string){return verifiedCommit(readData(committed,await wire('GET',base(item,owner)+'relocation/operations',{params:{key}})),item,owner,key,'MOVE');},
};
