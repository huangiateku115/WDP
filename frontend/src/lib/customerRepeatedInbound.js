import {inventoryId as id,validInventoryId as valid} from './inventoryRegistration.js';

export const receiptStates=['PENDING_INSPECTION','DISCREPANCY','ACCEPTED_PENDING_CONFIRMATION','RETURN_PENDING','REJECTED','CONFIRMED','CANCELLED'];
export const unresolvedReceiptStates=receiptStates.slice(0,4);
export function receiptPayload(value,unit){
  const d=value?.declaredUnitDimensionsM;
  if(!Number.isSafeInteger(value?.requestedQuantity)||value.requestedQuantity<=0||typeof value.quantityUnit!=='string'||!value.quantityUnit.trim()||value.quantityUnit.length>32||value.quantityUnit!==unit||value.quantityUnit!==value.quantityUnit.trim()||![value.declaredUnitWeightKg,d?.widthM,d?.depthM,d?.heightM].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||!Number.isFinite(d.widthM*d.depthM*d.heightM*value.requestedQuantity)||!Number.isFinite(value.declaredUnitWeightKg*value.requestedQuantity))throw Error('Enter a positive whole quantity and finite positive declared weight/dimensions in kg and metres. The quantity unit must match the Item.');
  return {requestedQuantity:value.requestedQuantity,quantityUnit:value.quantityUnit,declaredUnitWeightKg:value.declaredUnitWeightKg,declaredUnitDimensionsM:{widthM:d.widthM,depthM:d.depthM,heightM:d.heightM}};
}
export function receiptRecord(value,item){
  if(!valid(id(value))||id(value.itemId)!==id(item)||id(value.reservationId)!==id(item.managedReservationId)||id(value.facilityId)!==id(item.facilityId)||!receiptStates.includes(value.state)||!['NOT_TAKEN','IN_CUSTODY','RETURNED'].includes(value.custodyState)||!Number.isSafeInteger(value.version)||value.version<0||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||['currentInspectionAttemptId','acceptedEvidenceSnapshotId','confirmedMovementId'].some(k=>value[k]!==undefined&&!valid(id(value[k]))))throw Error('Receipt response identity, state or version could not be verified. Refresh before acting.');
  receiptPayload(value,item.quantityUnit);return value;
}
export function receiptList(response,item,page){
  const body=response?.data,p=body?.pagination;
  if(body?.success!==true||!Array.isArray(body.data)||!p||![p.page,p.limit,p.total,p.totalPages].every(Number.isSafeInteger)||p.page!==page||p.page<1||p.limit<1||p.limit>100||p.total<0||p.totalPages<0||body.data.length>p.limit||new Set(body.data.map(id)).size!==body.data.length)throw Error('Receipt history pagination is unavailable. No empty or demo history is substituted.');
  body.data.forEach(row=>receiptRecord(row,item));return {rows:body.data,pagination:p};
}
export function receiptResponse(response,item){
  if(response?.data?.success!==true)throw Error('Receipt response envelope is invalid. Refresh before retrying.');
  return receiptRecord(response.data.data,item);
}
// Absence of an inspection ID is not proof that the server has an explicit null.
// These are candidate UI actions; Backend verifies inspection history atomically.
export const mayChangeReceipt=row=>row?.state==='PENDING_INSPECTION'&&row.custodyState==='NOT_TAKEN'&&!row.currentInspectionAttemptId;
export function eligibleRepeatedReceipt(item,rental,user,now=Date.now()){
  return user?.role==='CUSTOMER'&&valid(id(user))&&id(user)===id(item?.customerId)&&['IN_STORAGE','CHECKED_OUT'].includes(item?.status)&&(item.status==='IN_STORAGE'?valid(id(item.currentCellId)):item.currentCellId===null)&&rental?.serviceType==='MANAGED_INVENTORY'&&id(rental)===id(item.managedReservationId)&&id(rental.facilityId)===id(item.facilityId)&&rental.status==='ACTIVE'&&Date.parse(rental.startDate)<=now&&Date.parse(rental.endDate)>now;
}
