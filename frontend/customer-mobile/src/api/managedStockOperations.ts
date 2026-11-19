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
const relocationDto=z.object({sku:z.object({id:objectId,itemCode:z.string(),name:z.string(),revision:whole}).passthrough(),
  reservation:z.object({id:objectId,reservationCode:z.string(),facilityId:objectId,status:z.string()}).passthrough(),minimumDestinationRemainingDays:whole,
  reservations:z.array(z.object({id:objectId,reservationCode:z.string(),status:z.string(),endDate:z.string(),canReceiveRelocation:z.boolean()}).passthrough()),
  cells:z.array(z.object({id:objectId,code:z.string(),reservationId:objectId,reservationCode:z.string(),reservationEndDate:z.string(),canReceiveRelocation:z.boolean(),destinationBlockedReason:z.string().nullable(),rackId:idRef,levelNumber:whole,operationalStatus:z.string(),maxWeightKg:z.number().nonnegative(),usedWeightKg:z.number().nonnegative(),maxVolumeM3:z.number().nonnegative(),usedVolumeM3:z.number().nonnegative(),managedInventoryRevision:whole}).passthrough()),
  itemSpecifications:z.array(z.object({itemSpecId:objectId,code:z.string(),name:z.string(),revision:whole,quantityUnit:z.string(),availableQuantity:whole,
    receipts:z.array(z.object({receiptId:z.string(),reservationId:objectId,reservationCode:z.string().nullable(),cellId:objectId,cellCode:z.string().nullable(),quantityOnHand:whole,quantityHeld:whole,quantityAvailable:whole,unitWeightKg:z.number().nonnegative(),unitVolumeM3:z.number().nonnegative()}).passthrough()),
    instances:z.array(z.object({itemInstanceId:z.string(),reservationId:objectId,reservationCode:z.string().nullable(),receiptId:z.string(),quantity:z.literal(1),weightKg:z.number().nonnegative(),volumeM3:z.number().nonnegative(),
      allocations:z.array(z.object({cellId:objectId,cellCode:z.string().nullable(),weightKg:z.number().nonnegative(),volumeM3:z.number().nonnegative()}).passthrough())}).passthrough())}).passthrough()),ledgerRevision:whole}).passthrough();
const proof=z.object({status:z.literal('READY'),canConfirm:z.literal(true).optional(),skuId:objectId,reservationId:objectId,accessSession:z.object({sessionId:objectId,purpose:z.enum(['OUTBOUND','RELOCATION']),revision:whole,expiresAt:z.string()}),
  lines:z.array(z.unknown()),totalQuantity:whole,totalWeightKg:z.number(),totalVolumeM3:z.number(),warnings:z.array(z.string()).optional(),capacity:z.array(z.unknown()).optional()}).passthrough();
const relocationPreviewDto=z.object({status:z.literal('READY'),canConfirm:z.literal(true),skuId:objectId,reservationId:objectId,
  accessSession:z.object({sessionId:objectId,purpose:z.literal('RELOCATION'),revision:whole,expiresAt:z.string()}),
  lines:z.array(z.object({lineId:z.string(),itemSpecId:objectId,itemSpecCode:z.string(),itemSpecName:z.string(),quantity:whole,sourceCellIds:z.array(objectId),destinationCellIds:z.array(objectId),weightKg:z.number().nonnegative(),volumeM3:z.number().nonnegative(),itemInstanceId:z.string().optional(),
  source:z.array(z.object({lineId:z.string(),itemSpecId:objectId,reservationId:objectId,receiptId:z.string(),cellId:objectId,quantity:whole,quantityBefore:whole.optional(),quantityAfter:whole.optional(),allocatedWeightKg:z.number().nonnegative(),allocatedVolumeM3:z.number().nonnegative()}).passthrough()),
    destination:z.array(z.object({lineId:z.string(),itemSpecId:objectId,reservationId:objectId,receiptId:z.string(),cellId:objectId,quantity:whole,quantityBefore:whole.optional(),quantityAfter:whole.optional(),allocatedWeightKg:z.number().nonnegative(),allocatedVolumeM3:z.number().nonnegative()}).passthrough())}).passthrough()),
  totalQuantity:whole,totalWeightKg:z.number().nonnegative(),totalVolumeM3:z.number().nonnegative(),capacity:z.array(z.object({cellId:objectId,weightDeltaKg:z.number(),volumeDeltaM3:z.number(),usedWeightBeforeKg:z.number().nonnegative(),usedWeightAfterKg:z.number().nonnegative(),maxWeightKg:z.number().nonnegative(),usedVolumeBeforeM3:z.number().nonnegative(),usedVolumeAfterM3:z.number().nonnegative(),maxVolumeM3:z.number().nonnegative()}).passthrough()),
  levelCapacity:z.array(z.object({rackId:objectId,levelNumber:whole,usedWeightBeforeKg:z.number().nonnegative(),usedWeightAfterKg:z.number().nonnegative(),usedVolumeBeforeM3:z.number().nonnegative(),usedVolumeAfterM3:z.number().nonnegative(),maxWeightKg:z.number().nonnegative(),maxVolumeM3:z.number().nonnegative()}).passthrough()),skuRevision:whole,ledgerRevision:whole,warnings:z.array(z.string())}).passthrough();
const relocationLine=z.object({lineId:z.string().regex(/^[\w.-]{1,80}$/),itemSpecId:objectId,itemSpecRevision:whole,sourceCellId:objectId.optional(),destinationCellId:objectId.optional(),sourceReservationId:objectId.optional(),destinationReservationId:objectId.optional(),quantity:whole.min(1),itemInstanceId:z.string().min(1).max(160).optional(),
  destinationAllocations:z.array(z.object({cellId:objectId,reservationId:objectId.optional(),weightKg:z.number().positive(),volumeM3:z.number().positive()}).strict()).min(1).max(100).optional()}).strict().superRefine((line,ctx)=>{
    if(line.itemInstanceId){if(line.quantity!==1||line.sourceCellId||line.destinationCellId||!line.destinationAllocations?.length)ctx.addIssue({code:'custom',message:'Instance line requires one complete item and destination allocations.'});}
    else if(!line.sourceCellId||!line.destinationCellId||line.destinationAllocations)ctx.addIssue({code:'custom',message:'Lot line requires source and destination Cells.'});
  });
const relocationBody=z.object({accessSessionId:objectId,sessionRevision:whole,skuRevision:whole,lines:z.array(relocationLine).min(1).max(50),reason:z.string().max(240).optional(),notes:z.string().max(1000).optional(),customerAttestation:z.string().max(1000).optional()}).strict();
const committed=z.object({status:z.literal('COMMITTED'),movement:z.object({itemId:objectId,managedReservationId:idRef,facilityId:idRef,customerId:idRef,idempotencyKey:z.string(),schemaVersion:z.literal(4),type:z.enum(['OUTBOUND','RELOCATION']),
  stockEffect:z.object({action:z.enum(['REMOVE','MOVE'])}).passthrough()}).passthrough()}).passthrough();
function verifiedCommit(value:z.infer<typeof committed>,item:Item,owner:string,key:string,action:'REMOVE'|'MOVE'){
  if(refId(value.movement.itemId)!==item._id||refId(value.movement.customerId)!==owner||value.movement.idempotencyKey!==key||value.movement.stockEffect.action!==action)
    throw new MobileInputError('Chưa xác minh được Movement đã ghi sổ cho đúng SKU và yêu cầu.');
  return value;
}
function verifiedOutbound(value:z.infer<typeof committed>,item:Item,reservation:ReservationDto,owner:string,key:string){
  const result=verifiedCommit(value,item,owner,key,'REMOVE');
  if(result.movement.type!=='OUTBOUND'||refId(result.movement.managedReservationId)!==reservation._id||refId(result.movement.facilityId)!==refId(reservation.facilityId))
    throw new MobileInputError('Chưa xác minh được phiếu xuất thuộc đúng đơn thuê và cơ sở.');
  return result;
}
function relocationIdentityMatches(movement:z.infer<typeof committed>['movement'],body:z.infer<typeof relocationBody>,primaryReservationId:string){
  const sources=Array.isArray(movement.stockEffect.source)?movement.stockEffect.source as Record<string,any>[]:[];
  const destinations=Array.isArray(movement.stockEffect.destination)?movement.stockEffect.destination as Record<string,any>[]:[];
  if(!sources.length||!destinations.length||movement.type!=='RELOCATION'||movement.stockEffect.action!=='MOVE'||movement.quantity!==body.lines.reduce((sum,line)=>sum+line.quantity,0))return false;
  if(sources.some(row=>!body.lines.some(line=>row.lineId===line.lineId))||destinations.some(row=>!body.lines.some(line=>row.lineId===line.lineId)))return false;
  for(const line of body.lines){
    const src=sources.filter(row=>row.lineId===line.lineId),dst=destinations.filter(row=>row.lineId===line.lineId);
    if(!src.length||!dst.length||src.some(row=>refId(row.itemSpecId)!==line.itemSpecId)||dst.some(row=>refId(row.itemSpecId)!==line.itemSpecId)||
      src.some(row=>row.lineId!==line.lineId)||dst.some(row=>row.lineId!==line.lineId))return false;
    if(line.itemInstanceId){
      if(new Set(src.map(row=>row.itemInstanceId)).size!==1||src.some(row=>row.itemInstanceId!==line.itemInstanceId)||new Set(dst.map(row=>row.itemInstanceId)).size!==1||dst.some(row=>row.itemInstanceId!==line.itemInstanceId))return false;
      const expected= new Set((line.destinationAllocations??[]).map(row=>`${row.reservationId??line.destinationReservationId??''}:${row.cellId}`));
      const expectedSourceCells=new Set((movement.stockEffect.source as any[]).filter(effect=>effect.lineId===line.lineId&&effect.itemInstanceId===line.itemInstanceId).map(effect=>refId(effect.cellId)));
      if(src.some(row=>refId(row.reservationId)!==(line.sourceReservationId??primaryReservationId))||src.some(row=>!expectedSourceCells.has(refId(row.cellId)))||expectedSourceCells.size!==src.length||
        dst.some(row=>!expected.has(`${refId(row.reservationId)}:${refId(row.cellId)}`))||expected.size!==dst.length)return false;
    }else{
      const srcReservation=line.sourceReservationId??primaryReservationId,dstReservation=line.destinationReservationId??primaryReservationId;
      if(src.some(row=>refId(row.reservationId)!==srcReservation||refId(row.cellId)!==line.sourceCellId)||dst.some(row=>refId(row.reservationId)!==dstReservation||refId(row.cellId)!==line.destinationCellId))return false;
      const sum=(rows:Record<string,any>[])=>rows.reduce((total,row)=>total+Number(row.quantity),0);
      if(sum(src)!==line.quantity||sum(dst)!==line.quantity||src.some(row=>row.quantity<=0)||dst.some(row=>row.quantity<=0))return false;
      const byReceipt=(rows:Record<string,any>[])=>JSON.stringify(Object.fromEntries([...new Set(rows.map(row=>String(row.receiptId)))].sort().map(receipt=>[receipt,rows.filter(row=>String(row.receiptId)===receipt).reduce((total,row)=>total+Number(row.quantity),0)])));
      if(src.some(row=>!Number.isFinite(row.allocatedWeightKg)||!Number.isFinite(row.allocatedVolumeM3))||dst.some(row=>!Number.isFinite(row.allocatedWeightKg)||!Number.isFinite(row.allocatedVolumeM3)))return false;
      const weight=(rows:Record<string,any>[])=>rows.reduce((sum,row)=>sum+Number(row.allocatedWeightKg),0),volume=(rows:Record<string,any>[])=>rows.reduce((sum,row)=>sum+Number(row.allocatedVolumeM3),0);
      if(Math.abs(weight(src)-weight(dst))>0.001||Math.abs(volume(src)-volume(dst))>0.000001)return false;
      if(byReceipt(src)!==byReceipt(dst))return false;
    }
  }
  return true;
}
function verifiedRelocation(value:z.infer<typeof committed>,item:Item,reservation:ReservationDto,owner:string,key:string,rawBody:unknown){
  const body=relocationBody.parse(rawBody),result=verifiedCommit(value,item,owner,key,'MOVE');
  if(result.movement.type!=='RELOCATION'||refId(result.movement.facilityId)!==refId(reservation.facilityId)||!relocationIdentityMatches(result.movement,body,reservation._id))
    throw new MobileInputError('Chưa xác minh được phiếu chuyển thuộc đúng hàng hóa và nội dung yêu cầu.');
  const sourceReservations=new Set(body.lines.map(line=>line.sourceReservationId??reservation._id));
  if(sourceReservations.size!==1||!sourceReservations.has(refId(result.movement.managedReservationId)))
    throw new MobileInputError('Reservation nguồn của Movement không khớp phiếu chuyển.');
  return result;
}
function base(item:Item,owner:string){assertOwner(item,owner);if(item.inventorySchemaVersion!==3)throw new MobileInputError('Thao tác này chỉ hỗ trợ SKU Managed Inventory V3.');return `/inventory-items/${id(item._id)}/v3/`;}
function assertReservation(item:Item,r:ReservationDto,owner:string){assertOwner(r,owner);if(r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3||refId(item.managedReservationId)!==r._id||refId(item.facilityId)!==refId(r.facilityId))throw new MobileInputError('Reservation không thuộc SKU V3 này.');}
export const managedStockOperations={
  async outboundContext(item:Item,owner:string){return readData(contextDto,await wire('GET',base(item,owner)+'outbound/context'));},
  async outboundPreview(item:Item,r:ReservationDto,owner:string,session:Session,input:unknown){assertReservation(item,r,owner);const body=z.object({accessSessionId:objectId,sessionRevision:whole,skuRevision:whole,reservationId:objectId,lines:z.array(z.unknown()).min(1)}).passthrough().parse(input);
    if(body.reservationId!==r._id||body.accessSessionId!==session._id||!session.allowedPurposes.includes('OUTBOUND')||session.revision!==body.sessionRevision)throw new MobileInputError('Phiên xuất kho hoặc Reservation không còn khớp.');
    return readData(proof,await wire('POST',base(item,owner)+'outbound/preview',{body}));},
  async outboundConfirm(item:Item,r:ReservationDto,owner:string,body:unknown,key:string){assertReservation(item,r,owner);return verifiedOutbound(readData(committed,await wire('POST',base(item,owner)+'outbound',{body,key,ifMatch:`"${(body as {skuRevision:number}).skuRevision}"`})),item,r,owner,key);},
  async outboundOperation(item:Item,r:ReservationDto,owner:string,key:string){assertReservation(item,r,owner);return verifiedOutbound(readData(committed,await wire('GET',base(item,owner)+'outbound/operations',{params:{key}})),item,r,owner,key);},
  async relocationContext(item:Item,owner:string,signal?:AbortSignal){
    const result=readData(relocationDto,await wire('GET',base(item,owner)+'relocation/context',{signal}));
    const reservationId=refId(item.managedReservationId),facilityId=refId(item.facilityId),reservationIds=new Set<string>(result.reservations.map(row=>row.id));
    if(result.sku.id!==item._id||result.reservation.id!==reservationId||refId(result.reservation.facilityId)!==facilityId||
      !reservationIds.has(reservationId)||result.reservations.some(row=>row.status!=='ACTIVE'||refId(row.facilityId as string)!==facilityId)||result.cells.some(row=>!reservationIds.has(row.reservationId as string))||
      new Set(result.itemSpecifications.map(row=>row.itemSpecId)).size!==result.itemSpecifications.length||
      result.cells.some(cell=>!result.reservations.some(row=>row.id===cell.reservationId&&row.reservationCode===cell.reservationCode))||
      result.itemSpecifications.some(spec=>spec.receipts.some(row=>!reservationIds.has(row.reservationId as string)||!result.cells.some(cell=>cell.id===row.cellId&&cell.reservationId===row.reservationId))||
        spec.instances.some(row=>!reservationIds.has(row.reservationId as string)||row.allocations.some(allocation=>!result.cells.some(cell=>cell.id===allocation.cellId&&cell.reservationId===row.reservationId)))))
      throw new MobileInputError('Dữ liệu chuyển vị trí không khớp mặt hàng, đơn thuê hoặc cơ sở.');
    return result;
  },
  async relocationPreviewForScope(item:Item,owner:string,session:Session,input:unknown,instanceSourceCellIds:string[]=[]){
    const candidate=relocationBody.parse(input),sessionReservationIds=new Set((session.scopedReservationIds??[session.reservationId]).map(refId));
    const reservations=new Set(candidate.lines.flatMap(line=>[line.sourceReservationId??'',line.destinationReservationId??'',...(line.destinationAllocations??[]).map(row=>row.reservationId??line.destinationReservationId??'')]));
    const cells=new Set(candidate.lines.flatMap(line=>[line.sourceCellId,line.destinationCellId,...(line.destinationAllocations??[]).map(row=>row.cellId)].filter((value):value is string=>!!value)).concat(instanceSourceCellIds));
    if(candidate.accessSessionId!==session._id||!session.allowedPurposes.includes('RELOCATION')||session.revision!==candidate.sessionRevision||session.status!=='ACTIVE'||
      [...reservations].some(value=>!value||!sessionReservationIds.has(value))||[...cells].some(value=>!session.allowedCellIds.map(refId).includes(value)))
      throw new MobileInputError('Phiên RELOCATION không còn hiệu lực hoặc chưa bao phủ các Reservation và ô đã chọn.');
    const result=readData(relocationPreviewDto,await wire('POST',base(item,owner)+'relocation/preview',{body:candidate}));
    if(result.skuId!==item._id||result.reservationId!==refId(item.managedReservationId)||result.skuRevision!==candidate.skuRevision||result.ledgerRevision<0||
      result.accessSession.sessionId!==session._id||result.accessSession.revision!==session.revision||result.lines.length!==candidate.lines.length||
      result.lines.some((line,index)=>line.lineId!==candidate.lines[index]?.lineId||line.itemSpecId!==candidate.lines[index]?.itemSpecId||line.quantity!==candidate.lines[index]?.quantity||
        (candidate.lines[index]?.itemInstanceId&&line.itemInstanceId!==candidate.lines[index]?.itemInstanceId)||
        (!candidate.lines[index]?.itemInstanceId&&(line.sourceCellIds.length!==1||line.sourceCellIds[0]!==candidate.lines[index]?.sourceCellId||line.destinationCellIds.length!==1||line.destinationCellIds[0]!==candidate.lines[index]?.destinationCellId))))
      throw new MobileInputError('Bản xem trước không khớp phiếu, phiên hoặc revision đang chọn.');
    for(let index=0;index<result.lines.length;index++){
      const line=result.lines[index]!,request=candidate.lines[index]!;
      if(line.source.some(effect=>refId(effect.itemSpecId)!==request.itemSpecId||refId(effect.reservationId)!==(request.sourceReservationId??refId(item.managedReservationId)))||
        line.destination.some(effect=>refId(effect.itemSpecId)!==request.itemSpecId||refId(effect.reservationId)!==(request.destinationReservationId??refId(item.managedReservationId))))
        throw new MobileInputError('Reservation/specification tại nguồn hoặc đích không khớp Preview.');
    }
    return result;
  },
  async relocationPreview(item:Item,r:ReservationDto,owner:string,session:Session,input:unknown,instanceSourceCellIds:string[]=[]){
    assertReservation(item,r,owner);const candidate=relocationBody.parse(input);
    const sessionReservationIds=new Set((session.scopedReservationIds??[session.reservationId]).map(refId));
    const reservationIds=new Set(candidate.lines.flatMap(line=>[line.sourceReservationId??r._id,line.destinationReservationId??r._id,...(line.destinationAllocations??[]).map(row=>row.reservationId??line.destinationReservationId??r._id)]));
    const sourceReservationIds=new Set(candidate.lines.map(line=>line.sourceReservationId??r._id)),destinationReservationIds=new Set(candidate.lines.map(line=>line.destinationReservationId??r._id));
    const cellIds=new Set(candidate.lines.flatMap(line=>[line.sourceCellId,line.destinationCellId,...(line.destinationAllocations??[]).map(row=>row.cellId)].filter((value):value is string=>!!value)).concat(instanceSourceCellIds));
    if(candidate.accessSessionId!==session._id||!session.allowedPurposes.includes('RELOCATION')||session.revision!==candidate.sessionRevision||session.status!=='ACTIVE'||
      refId(session.facilityId)!==refId(r.facilityId)||!sessionReservationIds.has(r._id)||sourceReservationIds.size!==1||destinationReservationIds.size!==1||[...reservationIds].some(value=>!sessionReservationIds.has(value))||
      [...cellIds].some(value=>!session.allowedCellIds.map(refId).includes(value)))throw new MobileInputError('Phiên RELOCATION không còn hiệu lực hoặc chưa bao phủ các Reservation và ô đã chọn.');
    const result=readData(relocationPreviewDto,await wire('POST',base(item,owner)+'relocation/preview',{body:candidate}));
    if(result.skuId!==item._id||result.reservationId!==r._id||result.skuRevision!==candidate.skuRevision||result.ledgerRevision<0||
      result.accessSession.sessionId!==session._id||result.accessSession.revision!==session.revision||result.lines.length!==candidate.lines.length||
      result.lines.some((line,index)=>line.lineId!==candidate.lines[index]?.lineId||line.itemSpecId!==candidate.lines[index]?.itemSpecId||line.quantity!==candidate.lines[index]?.quantity||
        (candidate.lines[index]?.itemInstanceId&&line.itemInstanceId!==candidate.lines[index]?.itemInstanceId)||
        (candidate.lines[index]?.itemInstanceId&&JSON.stringify([...line.destinationCellIds].sort())!==JSON.stringify([...(candidate.lines[index]?.destinationAllocations??[]).map(row=>row.cellId)].sort()))||
        (!candidate.lines[index]?.itemInstanceId&&(line.sourceCellIds.length!==1||line.sourceCellIds[0]!==candidate.lines[index]?.sourceCellId||line.destinationCellIds.length!==1||line.destinationCellIds[0]!==candidate.lines[index]?.destinationCellId))))
      throw new MobileInputError('Bản xem trước không khớp phiếu, phiên hoặc revision đang chọn.');
    return result;
  },
  async relocationConfirm(item:Item,r:ReservationDto,owner:string,body:unknown,key:string){
    assertReservation(item,r,owner);const candidate=relocationBody.parse(body);
    return verifiedRelocation(readData(committed,await wire('POST',base(item,owner)+'relocation',{body:candidate,key,ifMatch:`"${candidate.skuRevision}"`})),item,r,owner,key,candidate);
  },
  async relocationOperation(item:Item,r:ReservationDto,owner:string,key:string,body:unknown){
    assertReservation(item,r,owner);return verifiedRelocation(readData(committed,await wire('GET',base(item,owner)+'relocation/operations',{params:{key}})),item,r,owner,key,body);
  },
};
