import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {assertOwner,instant,nonnegative,objectId,positive,readData,refId,whole} from './contracts/core';
import type {ReservationDto} from './contracts/customer';
import {dimensions,itemDto} from './contracts/inventory';
import type {managedReservationReads} from './managedReservationReads';

type Item=z.infer<typeof itemDto>;
type Session=Awaited<ReturnType<typeof managedReservationReads.sessions>>[number];
const common={accessSessionId:objectId,cellIds:z.array(objectId).min(1).max(100)};
const unitBody=z.object({serial:z.string().trim().min(1).max(120),actualUnitWeightKg:positive,dimensionsM:dimensions}).strict();
const previewBody=z.discriminatedUnion('itemKind',[
  z.object({...common,itemKind:z.literal('A1_PHYSICAL_UNIT'),physicalUnitId:objectId,
    pose:z.object({xStartM:nonnegative,yStartM:nonnegative,rotationDeg:z.union([z.literal(0),z.literal(90)])}).strict()}).strict(),
  z.object({...common,itemKind:z.literal('A2_BATCH'),quantity:whole.min(1),quantityUnit:z.string().min(1),
    actualUnitWeightKg:positive,dimensionsM:dimensions,
    placements:z.array(z.object({cellId:objectId,quantity:whole.min(1)}).strict()).min(1).max(100)}).strict(),
]);
const unitDto=z.object({_id:objectId,skuId:objectId,reservationId:objectId,customerId:objectId,facilityId:objectId,
  serial:z.string(),state:z.string(),revision:whole});
const previewBase=z.object({status:z.literal('READY'),skuId:objectId,reservationId:objectId,accessSessionId:objectId,
  cellIds:z.array(objectId),sessionRevision:whole,previewRevision:whole,expiresAt:instant,quantity:whole,weightKg:nonnegative,volumeM3:nonnegative});
const previewDto=z.discriminatedUnion('itemKind',[
  previewBase.extend({itemKind:z.literal('A1_PHYSICAL_UNIT'),physicalUnitId:objectId,topologyCertificationId:objectId,topologyRevision:whole}),
  previewBase.extend({itemKind:z.literal('A2_BATCH'),topologyCertificationIds:z.array(objectId).min(1),topologyRevisions:z.array(whole).min(1)}),
]);

function scope(item:Item,r:ReservationDto,owner:string){
  assertOwner(item,owner);assertOwner(r,owner);
  if(item.inventorySchemaVersion!==3||r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3||
    refId(item.managedReservationId)!==r._id||refId(item.facilityId)!==refId(r.facilityId)){
    throw new MobileInputError('SKU không thuộc đơn thuê V3 này.');
  }
  return '/inventory-items/'+item._id+'/v3/';
}

export function eligibleInboundCells(r:ReservationDto,session:Session,now=Date.now()){
  if(r.status!=='ACTIVE'||Date.parse(r.startDate)>now||Date.parse(r.endDate)<=now||
    session.status!=='ACTIVE'||Date.parse(session.startedAt)>now||Date.parse(session.expiresAt)<=now||
    !session.allowedPurposes.includes('INBOUND')||refId(session.reservationId)!==r._id||
    refId(session.customerId)!==refId(r.customerId)||refId(session.facilityId)!==refId(r.facilityId))return [];
  const allowed=new Set(session.allowedCellIds.map(refId));
  return (r.allocatedCellIds??[]).map(refId).filter(cell=>allowed.has(cell));
}

function verifyUnit(unit:z.infer<typeof unitDto>,item:Item,r:ReservationDto,owner:string){
  assertOwner(unit,owner);
  if(unit.skuId!==item._id||unit.reservationId!==r._id||unit.facilityId!==refId(r.facilityId))throw new MobileInputError('Kiện không thuộc SKU này.');
  return unit;
}

export const managedInboundPreview={
  async units(item:Item,r:ReservationDto,owner:string,signal?:AbortSignal){
    const path=scope(item,r,owner);
    return readData(z.array(unitDto),await wire('GET',path+'physical-units',{signal})).map(unit=>verifyUnit(unit,item,r,owner));
  },
  async prepare(item:Item,r:ReservationDto,owner:string,input:unknown){
    const path=scope(item,r,owner);
    const body=unitBody.parse(input);
    const unit=verifyUnit(readData(unitDto,await wire('POST',path+'physical-units',{body})),item,r,owner);
    if(unit.serial!==body.serial||unit.state!=='PREPARED')throw new MobileInputError('Chưa xác minh được kiện đã chuẩn bị.');
    return unit;
  },
  async preview(item:Item,r:ReservationDto,owner:string,session:Session,input:unknown){
    const path=scope(item,r,owner),body=previewBody.parse(input);
    const allowed=eligibleInboundCells(r,session);
    if(body.accessSessionId!==session._id||new Set(body.cellIds).size!==body.cellIds.length||body.cellIds.some(cell=>!allowed.includes(cell))){
      throw new MobileInputError('Phiên hoặc ô đã chọn không còn hợp lệ.');
    }
    if(body.itemKind==='A1_PHYSICAL_UNIT'&&body.cellIds.length!==1)throw new MobileInputError('Mỗi kiện riêng chỉ được kiểm tra trên một ô.');
    if(body.itemKind==='A2_BATCH'&&(body.quantityUnit!==item.quantityUnit||
      body.placements.length!==body.cellIds.length||new Set(body.placements.map(row=>row.cellId)).size!==body.cellIds.length||
      body.placements.some(row=>!body.cellIds.includes(row.cellId))||body.placements.reduce((n,row)=>n+row.quantity,0)!==body.quantity)){
      throw new MobileInputError('Phân bổ số lượng chưa khớp các ô đã chọn.');
    }
    const proof=readData(previewDto,await wire('POST',path+'inbound/preview',{body}));
    if(proof.skuId!==item._id||proof.reservationId!==r._id||proof.accessSessionId!==session._id||
      proof.sessionRevision!==session.revision||proof.itemKind!==body.itemKind||Date.parse(proof.expiresAt)<=Date.now()||
      proof.cellIds.length!==body.cellIds.length||new Set(proof.cellIds).size!==body.cellIds.length||
      proof.cellIds.some(cell=>!body.cellIds.includes(cell))||
      (body.itemKind==='A1_PHYSICAL_UNIT'?proof.itemKind!=='A1_PHYSICAL_UNIT'||proof.physicalUnitId!==body.physicalUnitId||proof.quantity!==1:proof.quantity!==body.quantity)){
      throw new MobileInputError('Không thể xác minh kết quả kiểm tra vị trí.');
    }
    return proof;
  },
};
