import {inventoryId as id,validInventoryId as valid} from './inventoryRegistration.js';
export const isV2Rental=r=>r?.serviceType==='MANAGED_INVENTORY'&&r.bookingFlowVersion===2;
export function inspectionPayload(form){
  const quantity=Number(form.observedQuantity),weight=Number(form.observedUnitWeightKg),dimensions=Object.fromEntries(['widthM','depthM','heightM'].map(k=>[k,Number(form[k])]));
  if(!['ACCEPTED','DISCREPANCY','REJECTED'].includes(form.decision)||!Number.isSafeInteger(quantity)||quantity<1||![weight,...Object.values(dimensions)].every(n=>Number.isFinite(n)&&n>0))throw Error('Inspection decision, positive safe quantity, weight and dimensions are required.');
  if(typeof form.note!=='string'||!form.note.trim()||form.note.length>1000||typeof form.custodyTaken!=='boolean'||typeof form.packingLayoutVerified!=='boolean'||!Array.isArray(form.compatibleCellIds)||!form.compatibleCellIds.every(valid)||new Set(form.compatibleCellIds).size!==form.compatibleCellIds.length)throw Error('Inspection requires a note up to 1000 characters, explicit custody/packing flags and unique valid compatible Cell IDs.');
  if(form.decision==='REJECTED'&&form.custodyTaken)throw Error('Rejected goods must be returned before recording rejection.');
  if(form.decision==='ACCEPTED'&&(!form.compatibleCellIds.length||(quantity>1&&!form.packingLayoutVerified)))throw Error('Acceptance requires compatible allocated Cells and verified multi-unit packing.');
  return {decision:form.decision,observedQuantity:quantity,observedUnitWeightKg:weight,observedUnitDimensionsM:dimensions,compatibleCellIds:form.compatibleCellIds,note:form.note.trim(),custodyTaken:form.custodyTaken,packingLayoutVerified:form.packingLayoutVerified};
}
export function contractReady(r,items){
  return isV2Rental(r)&&r.status==='DEPOSIT_PAID'&&Array.isArray(items)&&items.length>0&&items.every(i=>id(i.managedReservationId)===id(r)&&id(i.facilityId)===id(r.facilityId))&&items.some(i=>i.receivingInspection?.decision==='ACCEPTED')&&!items.some(i=>(i.status==='PENDING_INBOUND'&&!i.receivingInspection?.decision)||['DISCREPANCY','REJECTED'].includes(i.receivingInspection?.decision));
}
export function currentManagedContract(c,r){
  const version=c?.currentContentVersion,active=c?.contentVersions?.find(v=>v.version===version),content=active?.content;
  if(!valid(id(c))||!valid(id(c?.reservationId))||!valid(id(c?.customerId))||!['DRAFT','SIGNED','EXPIRED','TERMINATED'].includes(c.status)||!Number.isSafeInteger(version)||version<1||!active||!/^[a-f\d]{64}$/i.test(active.contentHash)||!content||typeof content!=='object'||Array.isArray(content)||!valid(content.reservation?.facilityId)||content.reservation?.id!==id(c.reservationId)||!Array.isArray(content.reservation?.cellIds)||!content.reservation.cellIds.every(valid)||!Array.isArray(content.handover)||!content.pricing||!Array.isArray(c.signatures))throw Error('Managed contract version, snapshot or signature data is unavailable. Refresh; signing is disabled.');
  if(r&&(!isV2Rental(r)||id(r)!==id(c.reservationId)||id(r.facilityId)!==content.reservation.facilityId||id(r.customerId)!==id(c.customerId)))throw Error('Contract does not match the V2 reservation and owner.');
  const signatures=c.signatures.filter(s=>s.version===version&&s.contentHash===active.contentHash);
  if(signatures.some(s=>!valid(id(s.signerId))||!['CUSTOMER','FACILITY_STAFF','FACILITY_MANAGER'].includes(s.signerRole)||!Number.isFinite(Date.parse(s.signedAt))))throw Error('Unsupported current signature representation.');
  const customer=signatures.find(s=>s.signerRole==='CUSTOMER'),facility=signatures.find(s=>s.signerRole!=='CUSTOMER');
  if(customer&&id(customer.signerId)!==id(c.customerId))throw Error('Customer signature identity does not match the contract owner.');
  if((c.status==='SIGNED')!==!!(customer&&facility)&&['DRAFT','SIGNED'].includes(c.status))throw Error('Contract status and current signatures are inconsistent. Refresh before proceeding.');
  return {version,hash:active.contentHash,content,signatures,customer,facility,status:c.status==='DRAFT'&&signatures.length?'PARTIALLY_SIGNED':c.status};
}
export function maySignManaged(c,r,user){
  try{const p=currentManagedContract(c,r),status=r?.status||c.reservationId?.status;
    if(!['DEPOSIT_PAID','CHECKIN_READY'].includes(status)||c.status!=='DRAFT')return false;
    if(user?.role==='CUSTOMER')return !!r&&id(user)===id(c.customerId)&&!p.customer;
    return ['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)&&id(user.assignedFacilityId)===p.content.reservation.facilityId&&!!p.customer&&!p.facility;
  }catch{return false;}
}
export const contractFingerprint=c=>{const p=currentManagedContract(c);return JSON.stringify([id(c),p.version,p.hash,p.signatures]);};
