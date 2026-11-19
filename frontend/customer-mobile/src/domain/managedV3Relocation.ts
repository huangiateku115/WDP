const objectId=/^[a-f\d]{24}$/i;
const round=(value:number,places:3|6)=>Math.round((value+Number.EPSILON)*10**places)/10**places;

export type ManagedRelocationDraft={lineId:string;itemSpecId:string;itemSpecRevision:number;kind:'LOT'|'INSTANCE';sourceReservationId:string;destinationReservationId:string;
  sourceCellId?:string;destinationCellId?:string;quantity:number;availableQuantity?:number;itemInstanceId?:string;sourceCellIds?:string[];instanceWeightKg?:number;instanceVolumeM3?:number;
  destinationAllocations?:Array<{cellId:string;reservationId:string;weightKg:number;volumeM3:number}>};
export type ManagedRelocationRequest={accessSessionId:string;sessionRevision:number;skuRevision:number;lines:Array<Record<string,unknown>>;customerAttestation?:'CONFIRMED'};

export function buildManagedRelocationRequest(input:{accessSessionId:string;sessionRevision:number;skuRevision:number;lines:ManagedRelocationDraft[];confirmed?:boolean}):ManagedRelocationRequest{
  if(!objectId.test(input.accessSessionId)||![input.sessionRevision,input.skuRevision].every(value=>Number.isSafeInteger(value)&&value>=0)||!input.lines.length||input.lines.length>50)
    throw new Error('Phiếu chuyển vị trí chưa đủ thông tin hợp lệ.');
  if(input.lines.some(line=>!/^[\w.-]{1,80}$/.test(line.lineId)||!objectId.test(line.sourceReservationId)||!objectId.test(line.destinationReservationId)))
    throw new Error('Mã dòng hoặc Reservation nguồn/đích không hợp lệ.');
  if(new Set(input.lines.map(line=>line.lineId)).size!==input.lines.length)throw new Error('Mã dòng chuyển bị trùng.');
  const sourceReservations=new Set(input.lines.map(line=>line.sourceReservationId)),destinationReservations=new Set(input.lines.map(line=>line.destinationReservationId));
  if(sourceReservations.size!==1||destinationReservations.size!==1)throw new Error('Một phiếu chỉ chuyển giữa một Reservation nguồn và một Reservation đích.');
  const lines=input.lines.map(line=>{
    if(!objectId.test(line.itemSpecId)||!Number.isSafeInteger(line.itemSpecRevision)||line.itemSpecRevision<0)throw new Error('Quy cách hàng hóa không hợp lệ.');
    if(line.kind==='LOT'){
      if(!line.sourceCellId||!objectId.test(line.sourceCellId)||!line.destinationCellId||!objectId.test(line.destinationCellId)||line.sourceCellId===line.destinationCellId||
        !Number.isSafeInteger(line.quantity)||line.quantity<1||typeof line.availableQuantity!=='number'||!Number.isSafeInteger(line.availableQuantity)||line.quantity>line.availableQuantity)
        throw new Error('Ô nguồn, ô đích hoặc số lượng chuyển chưa hợp lệ.');
      return {lineId:line.lineId,itemSpecId:line.itemSpecId,itemSpecRevision:line.itemSpecRevision,sourceCellId:line.sourceCellId,destinationCellId:line.destinationCellId,
        sourceReservationId:line.sourceReservationId,destinationReservationId:line.destinationReservationId,quantity:line.quantity};
    }
    const allocations=line.destinationAllocations??[];
    if(!line.itemInstanceId||line.itemInstanceId.length>160||line.quantity!==1||!Number.isFinite(line.instanceWeightKg)||!Number.isFinite(line.instanceVolumeM3)||!line.sourceCellIds?.length||line.sourceCellIds.some(cellId=>!objectId.test(cellId))||!allocations.length||
      allocations.some(row=>!objectId.test(row.cellId)||!objectId.test(row.reservationId)||row.reservationId!==line.destinationReservationId||!Number.isFinite(row.weightKg)||row.weightKg<=0||!Number.isFinite(row.volumeM3)||row.volumeM3<=0)||
      new Set(allocations.map(row=>row.cellId)).size!==allocations.length||allocations.some(row=>line.sourceCellIds!.includes(row.cellId))||
      round(allocations.reduce((sum,row)=>sum+row.weightKg,0),3)!==round(line.instanceWeightKg!,3)||round(allocations.reduce((sum,row)=>sum+row.volumeM3,0),6)!==round(line.instanceVolumeM3!,6))
      throw new Error('Món nguyên vẹn phải chuyển đủ tải trọng và thể tích sang các ô đích khác vị trí nguồn.');
    return {lineId:line.lineId,itemSpecId:line.itemSpecId,itemSpecRevision:line.itemSpecRevision,sourceReservationId:line.sourceReservationId,destinationReservationId:line.destinationReservationId,
      quantity:1,itemInstanceId:line.itemInstanceId,destinationAllocations:allocations.map(row=>({...row}))};
  });
  return {accessSessionId:input.accessSessionId,sessionRevision:input.sessionRevision,skuRevision:input.skuRevision,lines,...(input.confirmed?{customerAttestation:'CONFIRMED' as const}:{})};
}

export function managedRelocationCells(drafts:ManagedRelocationDraft[]){
  return [...new Set(drafts.flatMap(line=>line.kind==='INSTANCE'?[...(line.sourceCellIds??[]),...(line.destinationAllocations??[]).map(row=>row.cellId)]:[line.sourceCellId,line.destinationCellId]).filter((value):value is string=>!!value))];
}
