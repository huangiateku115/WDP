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
export function inventoryMovements(response,item){
  const body=response?.data,seen=new Set();
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  if(body?.success!==true||!Array.isArray(body.data))throw Error('Unsupported movement history response. No demo records are substituted.');
  for(const m of body.data){
    if(!m||!valid(id(m))||seen.has(id(m))||id(m.itemId)!==id(item)||id(m.facilityId)!==id(item.facilityId)||id(m.managedReservationId)!==id(item.managedReservationId)||!['INBOUND','OUTBOUND','RELOCATION'].includes(m.type)||!Number.isSafeInteger(m.quantity)||m.quantity<=0||typeof m.quantityUnit!=='string'||!m.quantityUnit.trim()||![m.actualUnitWeightKg,m.actualTotalWeightKg,m.actualTotalVolumeM3,...['widthM','depthM','heightM'].map(k=>m.actualUnitDimensionsM?.[k])].every(positive)||![m.sourceCellId,m.destinationCellId].every(c=>c===null||valid(id(c)))||typeof m.performedAt!=='string'||!Number.isFinite(Date.parse(m.performedAt))||['inspectionNote','handoverNote','relocationNote'].some(k=>m[k]!==undefined&&typeof m[k]!=='string'))throw Error('Movement data does not match this inventory item or the confirmed response contract.');
    seen.add(id(m));
    if(m.schemaVersion!==undefined&&![1,2].includes(m.schemaVersion)||m.arithmeticPolicy!==undefined&&(m.schemaVersion!==2||m.arithmeticPolicy!=='CANONICAL_V1'))throw Error('Movement schema/arithmetic policy is unsupported.');
    movementBatchLines(m);
  }
  return body.data;
}
