import {inventoryId as id,validInventoryId as valid} from './inventoryRegistration.js';

// BE-REF InventoryItemService.movements/movementDto: Customer-owned records, no demo fallback.
export function movementBatchLines(m){
  if(m.batchLines===undefined){if(m.schemaVersion===2)throw Error('Canonical movement batch details are missing.');return [];}
  if(m.schemaVersion!==2||!Array.isArray(m.batchLines)||!m.batchLines.length)throw Error('Canonical movement batch details are unavailable or invalid.');
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  const action={INBOUND:'ADD',OUTBOUND:'REMOVE',RELOCATION:'MOVE'}[m.type];
  for(const line of m.batchLines){
    if(typeof line?.batchId!=='string'||!line.batchId.trim()||line.action!==action||!Number.isSafeInteger(line.quantity)||line.quantity<=0||line.quantityUnit!==m.quantityUnit||![line.actualUnitWeightKg,line.actualTotalWeightKg,line.actualTotalVolumeM3,...['widthM','depthM','heightM'].map(k=>line.actualUnitDimensionsM?.[k])].every(positive)||['receiptMovementId','receiptRequestId','receivingInspectionEvidenceId'].some(k=>line[k]!==undefined&&!valid(id(line[k]))))throw Error('Movement batch quantities, units, measurements or source references are invalid.');
  }
  if(m.batchLines.reduce((sum,line)=>sum+line.quantity,0)!==m.quantity)throw Error('Batch quantities do not match the parent movement.');
  return m.batchLines;
}
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validV4Effect=(m)=>{
  const effect=m.stockEffect,expectedAction={INBOUND:'ADD',OUTBOUND:'REMOVE',RELOCATION:'MOVE'}[m.type];
  if(!effect||effect.action!==expectedAction||!Number.isSafeInteger(effect.ledgerRevision)||effect.ledgerRevision<0||![undefined,2].includes(effect.contractVersion)||!Array.isArray(effect.source)||!Array.isArray(effect.destination))return false;
  if(expectedAction==='ADD'&&(effect.source.length||!effect.destination.length)||expectedAction==='REMOVE'&&(!effect.source.length||effect.destination.length)||expectedAction==='MOVE'&&(!effect.source.length||!effect.destination.length))return false;
  const validLine=line=>valid(id(line?.itemSpecId))&&valid(id(line?.cellId))&&
    (effect.contractVersion===2||valid(id(m.itemSpecId))&&id(line.itemSpecId)===id(m.itemSpecId))&&
    (effect.contractVersion!==2||typeof line?.lineId==='string'&&!!line.lineId.trim())&&
    typeof line.receiptId==='string'&&!!line.receiptId.trim()&&Number.isSafeInteger(line.quantity)&&line.quantity>0&&
    (!line.itemInstanceId||typeof line.itemInstanceId==='string'&&!!line.itemInstanceId.trim()&&line.quantity===1)&&
    (line.quantityUnitSnapshot===undefined||typeof line.quantityUnitSnapshot==='string'&&!!line.quantityUnitSnapshot.trim())&&
    [line.unitWeightKgSnapshot,line.unitVolumeM3Snapshot,line.allocatedWeightKg,line.allocatedVolumeM3,...['widthM','depthM','heightM'].map(k=>line.unitDimensionsSnapshot?.[k])].every(positive)&&
    Math.abs(line.unitVolumeM3Snapshot-Math.round((line.unitDimensionsSnapshot.widthM*line.unitDimensionsSnapshot.depthM*line.unitDimensionsSnapshot.heightM+Number.EPSILON)*1e6)/1e6)<=.000001;
  const validSide=rows=>rows.every(validLine)&&new Set(rows.map(line=>`${line.itemInstanceId?`I:${line.itemInstanceId}`:`R:${line.receiptId}`}|${id(line.cellId)}`)).size===rows.length;
  if(!validSide(effect.source)||!validSide(effect.destination))return false;
  const eventRows=expectedAction==='ADD'?effect.destination:effect.source;
  const instanceIds=[...new Set(eventRows.filter(line=>line.itemInstanceId).map(line=>line.itemInstanceId))];
  const quantity=eventRows.filter(line=>!line.itemInstanceId).reduce((sum,line)=>sum+line.quantity,0)+instanceIds.length;
  if(quantity!==m.quantity||Math.abs(eventRows.reduce((sum,line)=>sum+line.allocatedWeightKg,0)-m.actualTotalWeightKg)>.001||Math.abs(eventRows.reduce((sum,line)=>sum+line.allocatedVolumeM3,0)-m.actualTotalVolumeM3)>.000001)return false;
  for(const unitId of instanceIds){
    const unitRows=eventRows.filter(line=>line.itemInstanceId===unitId),first=unitRows[0];
    if(unitRows.some(line=>line.receiptId!==first.receiptId||line.unitWeightKgSnapshot!==first.unitWeightKgSnapshot||line.unitVolumeM3Snapshot!==first.unitVolumeM3Snapshot)||
      Math.abs(unitRows.reduce((sum,line)=>sum+line.allocatedWeightKg,0)-first.unitWeightKgSnapshot)>.001||Math.abs(unitRows.reduce((sum,line)=>sum+line.allocatedVolumeM3,0)-first.unitVolumeM3Snapshot)>.000001)return false;
  }
  if(expectedAction==='MOVE'&&(Math.abs(effect.source.reduce((sum,line)=>sum+line.allocatedWeightKg,0)-effect.destination.reduce((sum,line)=>sum+line.allocatedWeightKg,0))>.001||Math.abs(effect.source.reduce((sum,line)=>sum+line.allocatedVolumeM3,0)-effect.destination.reduce((sum,line)=>sum+line.allocatedVolumeM3,0))>.000001))return false;
  return true;
};
export function inventoryMovements(response,item){
  const body=response?.data,seen=new Set();
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  if(body?.success!==true||!Array.isArray(body.data))throw Error('Unsupported movement history response. No demo records are substituted.');
  for(const m of body.data){
    if(!m||!valid(id(m))||seen.has(id(m))||id(m.itemId)!==id(item)||id(m.facilityId)!==id(item.facilityId)||id(m.managedReservationId)!==id(item.managedReservationId)||!['INBOUND','OUTBOUND','RELOCATION'].includes(m.type)||!Number.isSafeInteger(m.quantity)||m.quantity<=0||typeof m.quantityUnit!=='string'||!m.quantityUnit.trim()||![m.actualUnitWeightKg,m.actualTotalWeightKg,m.actualTotalVolumeM3,...['widthM','depthM','heightM'].map(k=>m.actualUnitDimensionsM?.[k])].every(positive)||![m.sourceCellId,m.destinationCellId].every(c=>c===null||valid(id(c)))||typeof m.performedAt!=='string'||!Number.isFinite(Date.parse(m.performedAt))||['inspectionNote','handoverNote','relocationNote'].some(k=>m[k]!==undefined&&typeof m[k]!=='string'))throw Error('Movement data does not match this inventory item or the confirmed response contract.');
    seen.add(id(m));
    if(m.schemaVersion!==undefined&&![1,2,3,4].includes(m.schemaVersion)||m.arithmeticPolicy!==undefined&&(m.schemaVersion!==2||m.arithmeticPolicy!=='CANONICAL_V1'))throw Error('Movement schema/arithmetic policy is unsupported.');
    if(m.schemaVersion===4&&!validV4Effect(m))throw Error('Schema v4 movement details are missing or inconsistent.');
    movementBatchLines(m);
  }
  return body.data;
}
