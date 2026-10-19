import {inventoryId as id,validInventoryId as valid} from './inventoryRegistration.js';

// BE-REF InventoryItemService.movements/movementDto: Customer-owned records, no demo fallback.
export function inventoryMovements(response,item){
  const body=response?.data,seen=new Set();
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  if(body?.success!==true||!Array.isArray(body.data))throw Error('Unsupported movement history response. No demo records are substituted.');
  for(const m of body.data){
    if(!m||!valid(id(m))||seen.has(id(m))||id(m.itemId)!==id(item)||id(m.facilityId)!==id(item.facilityId)||id(m.managedReservationId)!==id(item.managedReservationId)||!['INBOUND','OUTBOUND','RELOCATION'].includes(m.type)||!Number.isSafeInteger(m.quantity)||m.quantity<=0||typeof m.quantityUnit!=='string'||!m.quantityUnit.trim()||![m.actualUnitWeightKg,m.actualTotalWeightKg,m.actualTotalVolumeM3,...['widthM','depthM','heightM'].map(k=>m.actualUnitDimensionsM?.[k])].every(positive)||![m.sourceCellId,m.destinationCellId].every(c=>c===null||valid(id(c)))||typeof m.performedAt!=='string'||!Number.isFinite(Date.parse(m.performedAt))||['inspectionNote','handoverNote','relocationNote'].some(k=>m[k]!==undefined&&typeof m[k]!=='string'))throw Error('Movement data does not match this inventory item or the confirmed response contract.');
    seen.add(id(m));
  }
  return body.data;
}
