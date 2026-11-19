type Ref={_id?:unknown;id?:unknown};
export type ManagedMovement=Record<string,any>;
export type MovementPlacement={cellId:string;quantity?:number;itemSpecId:string;receiptId?:string;itemInstanceId?:string;quantityBefore?:number;quantityAfter?:number;weightKg?:number;volumeM3?:number};
const id=(value:unknown)=>String((value as Ref|null)?.['_id']??(value as Ref|null)?.id??value??'');

export function movementAction(row:ManagedMovement){
  const action=row?.stockEffect?.action??row?.v3Effect?.action;
  if(action==='ADD'||row?.type==='INBOUND')return 'INBOUND';
  if(action==='REMOVE'||row?.type==='OUTBOUND')return 'OUTBOUND';
  if(action==='MOVE'||row?.type==='RELOCATION')return 'RELOCATION';
  return 'UNKNOWN';
}
export const movementActionLabel=(row:ManagedMovement)=>({INBOUND:'Nhập kho',OUTBOUND:'Xuất kho',RELOCATION:'Điều chuyển',UNKNOWN:'Biến động'}[movementAction(row)]);
export function movementPlacements(row:ManagedMovement,side:'source'|'destination'):MovementPlacement[]{
  const lines=row?.stockEffect?.[side]??row?.v3Effect?.[side];
  if(Array.isArray(lines))return lines.map((line:any)=>({cellId:id(line.cellId),quantity:line.quantity,itemSpecId:id(line.itemSpecId),receiptId:line.receiptId,itemInstanceId:line.itemInstanceId,
    quantityBefore:line.quantityBefore,quantityAfter:line.quantityAfter,weightKg:line.allocatedWeightKg??line.weightKg,volumeM3:line.allocatedVolumeM3??line.volumeM3})).filter(line=>line.cellId);
  const legacyCell=side==='source'?row?.sourceCellId:row?.destinationCellId;
  return legacyCell? [{cellId:id(legacyCell),quantity:row.quantity,itemSpecId:id(row.itemSpecId),weightKg:row.actualTotalWeightKg,volumeM3:row.actualTotalVolumeM3}]:[];
}
export function movementCellIds(row:ManagedMovement){return [...new Set([...movementPlacements(row,'source'),...movementPlacements(row,'destination')].map(line=>line.cellId).filter(Boolean))];}
export function movementIdentifier(row:ManagedMovement){return row?.movementCode||row?.operationId||row?.referenceCode||id(row?._id)||'Movement';}
export function movementOccurredAt(row:ManagedMovement){return row?.performedAt??row?.occurredAt??null;}
export function movementTime(value:unknown){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return 'Chưa có thời điểm xác minh';
  return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
}
export function movementNotes(row:ManagedMovement){return [row?.inspectionNote,row?.handoverNote,row?.relocationNote,row?.stockEffect?.notes,row?.stockEffect?.reason].filter(value=>typeof value==='string'&&value.trim()).map(String);}
