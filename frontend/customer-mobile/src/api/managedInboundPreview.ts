import {z} from 'zod';
import {mapV3Movements} from './contracts/managedV3Ledger';
import {wire,MobileInputError} from './client';
import {assertOwner,instant,nonnegative,objectId,positive,readData,refId,whole} from './contracts/core';
import type {ReservationDto} from './contracts/customer';
import type {mobileRepo} from './mobileRepository';
import type {managedReservationReads} from './managedReservationReads';
import {managedSessionEligibility} from '../domain/managedAccessSessionEligibility';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
type Session=Awaited<ReturnType<typeof managedReservationReads.sessions>>[number];
type Spec=z.infer<typeof itemSpecificationDto>;
const id=(value:unknown)=>objectId.parse(value);
const isPositive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const contextUnit=z.union([objectId,z.object({_id:objectId,code:z.string().min(1),name:z.string().min(1)}).passthrough()]);
const itemSpecificationDto=z.object({_id:objectId,itemSpecId:objectId.optional(),skuId:objectId,code:z.string(),name:z.string(),
  quantityUnitId:contextUnit,quantityUnit:z.string().optional(),quantityUnitCode:z.string().optional(),dimensionsM:z.object({widthM:positive,depthM:positive,heightM:positive}),
  unitWeightKg:positive,unitVolumeM3:positive,revision:whole,status:z.enum(['ACTIVE','INACTIVE','DELETED'])}).passthrough().transform(spec=>{
    const unit=typeof spec.quantityUnitId==='string'?undefined:spec.quantityUnitId;
    return {...spec,itemSpecId:spec.itemSpecId??spec._id,quantityUnitId:unit?unit._id:spec.quantityUnitId,
      quantityUnit:spec.quantityUnit??unit?.name??unit?.code,quantityUnitCode:spec.quantityUnitCode??unit?.code};
  }).pipe(z.object({_id:objectId,itemSpecId:objectId,skuId:objectId,code:z.string(),name:z.string(),quantityUnitId:objectId,
    quantityUnit:z.string().min(1),quantityUnitCode:z.string().min(1),dimensionsM:z.object({widthM:positive,depthM:positive,heightM:positive}),
    unitWeightKg:positive,unitVolumeM3:positive,revision:whole,status:z.enum(['ACTIVE','INACTIVE','DELETED'])}).passthrough());
const inboundContextDto=z.object({skuId:objectId,reservationId:objectId,facilityId:objectId,skuRevision:whole,
  allocatedCellIds:z.array(objectId),specifications:z.array(itemSpecificationDto),apiVersion:z.literal(3)}).passthrough();
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
const inboundStockDto=z.object({skuId:objectId,reservationId:objectId,facilityId:objectId,
  totalQuantity:whole.nullable(),totalWeightKg:nonnegative.nullable(),totalVolumeM3:nonnegative.nullable(),
  reconciliationStatus:z.enum(['NO_ACTIVITY','VERIFIED','CHECKING']),verificationMessage:z.string().nullable().optional(),
  itemSpecifications:z.array(z.object({itemSpecId:objectId,code:z.string(),name:z.string(),quantityUnit:z.string().nullable(),
    quantityOnHand:whole.nullable(),quantityHeld:whole.nullable(),quantityAvailable:whole.nullable(),totalWeightKg:nonnegative.nullable(),totalVolumeM3:nonnegative.nullable(),
    byCell:z.array(z.object({cellId:objectId,quantityOnHand:whole,quantityHeld:whole,quantityAvailable:whole,weightKg:nonnegative,volumeM3:nonnegative}).passthrough())}).passthrough()),
  byCell:z.array(z.object({cellId:objectId,quantityOnHand:whole,quantityHeld:whole,quantityAvailable:whole,weightKg:nonnegative,volumeM3:nonnegative}).passthrough())}).passthrough()
  .transform(stock=>{
    if(stock.reconciliationStatus!=='VERIFIED'&&stock.reconciliationStatus!=='NO_ACTIVITY')return stock;
    const totalByCell=stock.byCell.reduce((sum,row)=>sum+row.quantityOnHand,0);
    const totalBySpecifications=stock.itemSpecifications.reduce((sum,row)=>sum+(row.quantityOnHand??0),0);
    const verifiedShape=stock.totalQuantity!==null&&stock.totalQuantity===totalByCell&&stock.totalQuantity===totalBySpecifications&&
      stock.itemSpecifications.every(row=>row.quantityOnHand!==null&&row.byCell.reduce((sum,cell)=>sum+cell.quantityOnHand,0)===row.quantityOnHand)&&
      (stock.reconciliationStatus!=='NO_ACTIVITY'||stock.totalQuantity===0&&stock.byCell.length===0);
    return verifiedShape?stock:{...stock,reconciliationStatus:'CHECKING' as const,
      verificationMessage:'Số liệu tổng và phân bổ theo vị trí chưa khớp; đang cần đối soát.'};
  });
const confirmResponseDto=z.object({status:z.literal('COMMITTED'),replayed:z.boolean().optional(),movementId:objectId.optional(),movementCode:z.string().optional(),
  quantity:whole.optional(),totalWeightKg:nonnegative.optional(),totalVolumeM3:nonnegative.optional(),lineCount:whole.optional(),sessionRevision:whole.optional(),movement:z.unknown().optional()}).passthrough();
const specificationStockDto=z.object({skuId:objectId,itemSpecId:objectId,
  reconciliationStatus:z.enum(['NO_ACTIVITY','VERIFIED','CHECKING']),quantityOnHand:whole.nullable(),quantityHeld:whole.nullable(),quantityAvailable:whole.nullable(),
  totalWeightKg:nonnegative.nullable(),totalVolumeM3:nonnegative.nullable(),byCell:z.array(z.object({cellId:objectId,quantityOnHand:whole,quantityHeld:whole,quantityAvailable:whole,weightKg:nonnegative,volumeM3:nonnegative}).passthrough())}).passthrough()
  .transform(stock=>{
    if(stock.reconciliationStatus!=='VERIFIED'&&stock.reconciliationStatus!=='NO_ACTIVITY')return stock;
    const byCellQuantity=stock.byCell.reduce((sum,row)=>sum+row.quantityOnHand,0);
    const consistent=stock.quantityOnHand!==null&&stock.quantityOnHand===byCellQuantity&&
      (stock.reconciliationStatus!=='NO_ACTIVITY'||stock.quantityOnHand===0&&stock.byCell.length===0);
    return consistent?stock:{...stock,reconciliationStatus:'CHECKING' as const};
  });
export type InboundStockReadback=z.infer<typeof inboundStockDto>;
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
    !managedSessionEligibility(session,{customerId:ref(r.customerId),facilityId:ref(r.facilityId),reservationId:r._id,purpose:'INBOUND',now,primaryReservationOnly:true}).eligible)return [];
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
    const reservationCells=new Set((r.allocatedCellIds??[]).map(ref));
    if(data.allocatedCellIds.some(cell=>!reservationCells.has(cell))||data.allocatedCellIds.length!==reservationCells.size||new Set(data.allocatedCellIds).size!==data.allocatedCellIds.length)
      throw new MobileInputError('Các ô trong Context không khớp phạm vi Reservation.');
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
    const path=scope(item,r,owner),response=readData(confirmResponseDto,await wire('POST',path+'inbound',{body,key}));
    if(response.status!=='COMMITTED')throw new MobileInputError('Backend chưa xác nhận phiếu nhập đã ghi nhận.');
    return response;
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
  async stockReadback(item:Item,r:ReservationDto,owner:string,signal?:AbortSignal){
    const stock=readData(inboundStockDto,await wire('GET',scope(item,r,owner)+'stock',{signal}));
    if(stock.skuId!==item._id||stock.reservationId!==r._id||stock.facilityId!==ref(r.facilityId))throw new MobileInputError('Tồn kho đọc lại không thuộc SKU, Reservation hoặc Facility này.');
    return stock;
  },
  async cellStockReadback(item:Item,r:ReservationDto,owner:string,signal?:AbortSignal){
    const stock=readData(inboundStockDto,await wire('GET',scope(item,r,owner)+'cell-stock',{signal}));
    if(stock.skuId!==item._id||stock.reservationId!==r._id||stock.facilityId!==ref(r.facilityId))throw new MobileInputError('Cell Stock đọc lại không thuộc SKU, Reservation hoặc Facility này.');
    return stock;
  },
  async specificationStockReadback(item:Item,r:ReservationDto,owner:string,specId:string,signal?:AbortSignal){
    const path=scope(item,r,owner),stock=readData(specificationStockDto,
      await wire('GET',path+'specifications/'+id(specId)+'/cell-stock',{signal}));
    if(stock.skuId!==item._id||stock.itemSpecId!==specId)throw new MobileInputError('Cell Stock của Specification không khớp SKU.');
    return stock;
  },
  async movementsReadback(item:Item,r:ReservationDto,owner:string,signal?:AbortSignal){
    const rows=mapV3Movements(await wire('GET',scope(item,r,owner)+'movements',{signal}),item,owner);
    if(rows.some(row=>ref(row.managedReservationId)!==r._id))throw new MobileInputError('Movement History có Reservation không khớp thao tác.');
    return rows;
  },
};
