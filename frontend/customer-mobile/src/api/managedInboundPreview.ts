import {z} from 'zod';
import {mapV3Movements} from './contracts/managedV3Ledger';
import {wire,MobileInputError} from './client';
import {assertOwner,instant,nonnegative,objectId,positive,readData,refId,whole} from './contracts/core';
import type {ReservationDto} from './contracts/customer';
import type {mobileRepo} from './mobileRepository';
import type {managedReservationReads} from './managedReservationReads';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
type Session=Awaited<ReturnType<typeof managedReservationReads.sessions>>[number];
type Spec=z.infer<typeof itemSpecificationDto>;
const id=(value:unknown)=>objectId.parse(value);
const isPositive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const itemSpecificationDto=z.object({_id:objectId,itemSpecId:objectId,skuId:objectId,code:z.string(),name:z.string(),
  quantityUnitId:objectId,quantityUnit:z.string(),quantityUnitCode:z.string(),dimensionsM:z.object({widthM:positive,depthM:positive,heightM:positive}),
  unitWeightKg:positive,unitVolumeM3:positive,revision:whole,status:z.enum(['ACTIVE','INACTIVE','DELETED'])}).passthrough();
const inboundContextDto=z.object({skuId:objectId,reservationId:objectId,facilityId:objectId,skuRevision:whole,
  specifications:z.array(itemSpecificationDto),apiVersion:z.literal(3)}).passthrough();
const lineProofDto=z.object({lineId:z.string(),itemSpecId:objectId,itemName:z.string(),itemCode:z.string(),itemSpecRevision:whole,
  quantity:whole,quantityUnit:z.string(),unitWeightKg:positive,dimensionsM:z.object({widthM:positive,depthM:positive,heightM:positive}),
  unitVolumeM3:positive,totalWeightKg:nonnegative,totalVolumeM3:nonnegative,
  cellAllocations:z.array(z.object({cellId:objectId,cellCode:z.string().optional(),addedWeightKg:nonnegative,addedVolumeM3:nonnegative,
    usedWeightKg:nonnegative,usedVolumeM3:nonnegative,remainingWeightAfterKg:nonnegative.nullable(),remainingVolumeAfterM3:nonnegative.nullable()}).passthrough())}).passthrough();
const previewDto=z.object({status:z.literal('READY'),skuId:objectId,reservationId:objectId,facilityId:objectId,
  accessSession:z.object({sessionId:objectId,purpose:z.literal('INBOUND'),expiresAt:instant,revision:whole}),
  lines:z.array(lineProofDto).min(1),totalQuantity:whole,totalWeightKg:nonnegative,totalVolumeM3:nonnegative,
  previewRevision:z.object({skuRevision:whole,sessionRevision:whole,inventoryRevision:whole}),warnings:z.array(z.string())}).passthrough();
const operationDto=z.object({status:z.literal('COMMITTED'),movement:z.unknown()}).passthrough();
const ref=(value:unknown)=>String((value as { _id?:unknown; id?:unknown }|null)?.['_id']??(value as { id?:unknown }|null)?.id??value??'');

function scope(item:Item,r:ReservationDto,owner:string){
  assertOwner(item,owner);assertOwner(r,owner);
  if(item.inventorySchemaVersion!==3||item.status!=='ACTIVE'||r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3||
    ref(item.managedReservationId)!==r._id||ref(item.facilityId)!==ref(r.facilityId)){
    throw new MobileInputError('SKU không thuộc đơn thuê V3 đang hoạt động này.');
  }
  return '/inventory-items/'+id(item._id)+'/v3/';
}

export function eligibleInboundCells(r:ReservationDto,session:Session,now=Date.now()){
  if(r.status!=='ACTIVE'||Date.parse(r.startDate)>now||Date.parse(r.endDate)<=now||
    session.status!=='ACTIVE'||Date.parse(session.startedAt)>now||Date.parse(session.expiresAt)<=now||
    !session.allowedPurposes.includes('INBOUND')||ref(session.reservationId)!==r._id||
    ref(session.customerId)!==ref(r.customerId)||ref(session.facilityId)!==ref(r.facilityId))return [];
  const allowed=new Set(session.allowedCellIds.map(ref));
  return (r.allocatedCellIds??[]).map(ref).filter(cell=>allowed.has(cell));
}

export type UnifiedInboundLineInput={lineId:string;itemSpecId:string;itemSpecRevision:number;quantity:number;
  measurementMode:'SPECIFICATION'|'MEASURED';actualUnitWeightKg?:number;dimensionsM?:{widthM:number;depthM:number;heightM:number};
  cellAllocations:{cellId:string;quantity:number}[];instanceAllocations?:{cellId:string;weightKg:number;volumeM3:number}[]};
export function buildUnifiedInboundRequest(input:{accessSessionId:string;sessionRevision:number;skuRevision:number;lines:UnifiedInboundLineInput[]}){
  const lines=input.lines.map(line=>({lineId:line.lineId,itemSpecId:id(line.itemSpecId),itemSpecRevision:line.itemSpecRevision,
    quantity:line.quantity,measurementMode:line.measurementMode,
    ...(line.measurementMode==='MEASURED'?{actualUnitWeightKg:line.actualUnitWeightKg,dimensionsM:line.dimensionsM}:{}),
    cellAllocations:line.cellAllocations.map(row=>({cellId:id(row.cellId),quantity:row.quantity})),
    ...(line.instanceAllocations?.length?{instanceAllocations:line.instanceAllocations.map(row=>({cellId:id(row.cellId),weightKg:row.weightKg,volumeM3:row.volumeM3}))}:{})}));
  if(!input.accessSessionId||!Number.isSafeInteger(input.sessionRevision)||input.sessionRevision<0||
    !Number.isSafeInteger(input.skuRevision)||input.skuRevision<0||!lines.length||lines.length>50)throw new MobileInputError('Thiếu thông tin phiên, SKU hoặc dòng hàng hợp lệ.');
  for(const line of lines){
    if(!line.lineId||!Number.isSafeInteger(line.itemSpecRevision)||line.itemSpecRevision<0||!Number.isSafeInteger(line.quantity)||line.quantity<1||
      !line.cellAllocations.length||line.cellAllocations.some(row=>!Number.isSafeInteger(row.quantity)||row.quantity<1)||
      line.cellAllocations.reduce((sum,row)=>sum+row.quantity,0)!==line.quantity||
      new Set(line.cellAllocations.map(row=>String(row.cellId))).size!==line.cellAllocations.length){
      throw new MobileInputError('Số lượng hoặc phân bổ ô kệ chưa hợp lệ.');
    }
    if(line.measurementMode==='MEASURED'&&(!isPositive(line.actualUnitWeightKg)||!line.dimensionsM||
      ![line.dimensionsM.widthM,line.dimensionsM.depthM,line.dimensionsM.heightM].every(isPositive)))throw new MobileInputError('Số đo thực tế chưa hợp lệ.');
  }
  return {accessSessionId:id(input.accessSessionId),sessionRevision:input.sessionRevision,skuRevision:input.skuRevision,lines};
}

export const managedInboundPreview={
  async context(item:Item,r:ReservationDto,owner:string,signal?:AbortSignal){
    const data=readData(inboundContextDto,await wire('GET',scope(item,r,owner)+'inbound/context',{signal}));
    if(data.skuId!==item._id||data.reservationId!==r._id||data.facilityId!==ref(r.facilityId))throw new MobileInputError('Ngữ cảnh nhập hàng không khớp SKU/đơn thuê.');
    return {...data,specifications:data.specifications.filter(spec=>spec.status==='ACTIVE').map(spec=>{
      if(spec.skuId!==item._id)throw new MobileInputError('Item Specification không thuộc SKU hiện tại.');return spec;
    })};
  },
  async preview(item:Item,r:ReservationDto,owner:string,session:Session,body:ReturnType<typeof buildUnifiedInboundRequest>){
    const path=scope(item,r,owner),allowed=eligibleInboundCells(r,session);
    const cellIds=body.lines.flatMap(line=>[...line.cellAllocations.map(row=>String(row.cellId)),...(line.instanceAllocations??[]).map(row=>String(row.cellId))]);
    if(body.accessSessionId!==session._id||body.sessionRevision!==session.revision||cellIds.some(cell=>!allowed.includes(cell)))
      throw new MobileInputError('Phiên hoặc ô đã chọn không còn hợp lệ.');
    const proof=readData(previewDto,await wire('POST',path+'inbound/preview',{body}));
    if(proof.skuId!==item._id||proof.reservationId!==r._id||proof.facilityId!==ref(r.facilityId)||
      proof.accessSession.sessionId!==session._id||proof.accessSession.revision!==session.revision||
      proof.previewRevision.skuRevision!==body.skuRevision||proof.previewRevision.sessionRevision!==session.revision||
      proof.lines.length!==body.lines.length||proof.lines.some((line,index)=>line.lineId!==body.lines[index]?.lineId||line.itemSpecId!==body.lines[index]?.itemSpecId||line.quantity!==body.lines[index]?.quantity)){
      throw new MobileInputError('Không thể xác minh kết quả xem trước nhập kho.');
    }
    return {proof,request:body};
  },
  async confirm(item:Item,r:ReservationDto,owner:string,body:ReturnType<typeof buildUnifiedInboundRequest>,key:string){
    const path=scope(item,r,owner);await wire('POST',path+'inbound',{body,key});
  },
  async operation(item:Item,r:ReservationDto,owner:string,key:string){
    const path=scope(item,r,owner),result=readData(operationDto,await wire('GET',path+'operations',{params:{key}}));
    const row=z.object({_id:objectId,itemId:objectId,managedReservationId:objectId,customerId:objectId,facilityId:objectId,
      schemaVersion:z.literal(4),idempotencyKey:z.string(),operationId:z.string(),stockEffect:z.object({action:z.literal('ADD')}).passthrough()}).passthrough().parse(result.movement);
    if(row.idempotencyKey!==key||row.itemId!==item._id||row.customerId!==owner||row.managedReservationId!==r._id||row.facilityId!==ref(r.facilityId))
      throw new MobileInputError('Bằng chứng phiếu nhập đã đối soát không khớp yêu cầu.');
    const movement=mapV3Movements({success:true,data:[row]},item,owner)[0];
    if(!movement)throw new MobileInputError('Chưa xác minh được phiếu nhập đã ghi sổ.');return movement;
  },
};
