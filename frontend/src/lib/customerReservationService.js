import {rentalEndDate, termKey} from './rentalPeriod.js';

export const SELF_STORAGE='SELF_STORAGE';
export const MANAGED_INVENTORY='MANAGED_INVENTORY';
export const serviceType=reservation=>[SELF_STORAGE,MANAGED_INVENTORY].includes(reservation?.serviceType)?reservation.serviceType:null;
export const isManagedV2=reservation=>serviceType(reservation)===MANAGED_INVENTORY&&reservation.bookingFlowVersion===2;
export const isManagedV3=reservation=>serviceType(reservation)===MANAGED_INVENTORY&&reservation.bookingFlowVersion===3;
export const isLegacyManaged=reservation=>serviceType(reservation)===MANAGED_INVENTORY&&(reservation.bookingFlowVersion==null||reservation.bookingFlowVersion===1);
export const hasLegacyRentalFlow=reservation=>serviceType(reservation)===SELF_STORAGE||isLegacyManaged(reservation);
const managedLegacyDescriptions={RESERVED:'Managed quota is held while awaiting Manager/Admin approval.',CONTRACTED:'A Managed contract has been created. Sign it while the hold is valid.',PAID:'Payment has been recorded. Authorized management must activate the Managed quota; no unit handover is required.',ACTIVE:'Managed rental is activated. Selected Cells remain allocated; physical occupancy requires Staff-confirmed inbound.',OVERDUE:'Managed rental is overdue. Unresolved obligations may continue to hold commercial quota.',CANCELLED:'Managed reservation is cancelled. Payment and activation are unavailable.',CHECKED_OUT:'The backend reports CHECKED_OUT for this Managed reservation.',CLOSED:'The backend reports this Managed reservation as closed.'};
const selfDescriptions={RESERVED:'Legacy Self Storage reservation awaiting review. New bookings are automatically CONTRACTED with a DRAFT contract. Any deadline is shown only when returned by the Backend.',CONTRACTED:'Reservation confirmed with a DRAFT contract. Complete the advance-rent Deposit with PayOS; routine Manager approval is not required.',DEPOSIT_PAID:'Advance-rent Deposit applied. Awaiting signed paper contract verification; the rental is not active.',CHECKIN_READY:'Signed paper evidence verified. Remaining Balance payment is due; the rental is not active.',PAID:'Payment completed. Waiting for Facility Manager handover.',ACTIVE:'Rental active. Simulated access is available.',OVERDUE:'Rental overdue. Access is unavailable.',CHECKED_OUT:'Storage returned. Access is unavailable.',CLOSED:'Rental completed and archived.',CANCELLED:'Reservation cancelled. Payment and access are unavailable.'};
const managedV2Descriptions={...managedLegacyDescriptions,RESERVED:'Reservation held. Advance rent deposit is not confirmed. No routine Manager approval or contract signature is required at booking.',DEPOSIT_PAID:'Advance rent deposit confirmed. First inventory registration and intake preparation are permitted subject to Backend guards. The rental is not active.',CHECKIN_READY:'Contract and balance stage completed. Awaiting Staff physical first inbound; the rental is not ACTIVE.',ACTIVE:'Staff confirmed first physical inbound. The Managed rental is active.',CONTRACTED:'CONTRACTED is a legacy stage, not a valid new Managed V2 stage. Refresh the record; legacy signing and payment are unavailable.',PAID:'PAID is a legacy state. Managed V2 uses CHECKIN_READY before Staff first inbound. Refresh the record; legacy activation and payment are unavailable.'};
const v2Labels={RESERVED:'Reservation held — deposit pending',DEPOSIT_PAID:'Advance rent deposit confirmed',CHECKIN_READY:'Rent settled — awaiting Staff first inbound',ACTIVE:'Active — first inbound confirmed'};
const managedV3Descriptions={RESERVED:'Managed V3 Cells are held while the advance-rent Deposit is pending.',DEPOSIT_PAID:'Verified advance-rent Deposit received. A versioned Cell and price snapshot is ready for both parties to sign.',PAID:'Deposit and remaining rent are settled. Facility Staff handover is still required; the rental is not active.',ACTIVE:'Facility Staff recorded the access handover. The first physical inbound remains a separate operation.'};
const v3Labels={RESERVED:'Cells held — Deposit pending',DEPOSIT_PAID:'Deposit received — contract signing',PAID:'Rent settled — handover pending',ACTIVE:'Active — handover recorded'};
export function reservationLifecycle(reservation){
  const flow=isManagedV3(reservation)?'MANAGED_V3':isManagedV2(reservation)?'MANAGED_V2':isLegacyManaged(reservation)?'MANAGED_LEGACY':serviceType(reservation)===SELF_STORAGE?'SELF_STORAGE':'UNKNOWN';
  const descriptions=flow==='MANAGED_V3'?managedV3Descriptions:flow==='MANAGED_V2'?managedV2Descriptions:flow==='MANAGED_LEGACY'?managedLegacyDescriptions:flow==='SELF_STORAGE'?selfDescriptions:{};
  return {flow,status:reservation?.status,label:flow==='MANAGED_V3'?v3Labels[reservation.status]:flow==='MANAGED_V2'?v2Labels[reservation.status]:undefined,description:descriptions[reservation?.status]||'Status or flow version is not supported. Refresh the record; service-specific actions are unavailable.'};
}
export const serviceLabel=reservation=>serviceType(reservation)===SELF_STORAGE?'Self Storage':serviceType(reservation)===MANAGED_INVENTORY?'Managed Inventory':'Unsupported / unknown service';
export const liveHold=(reservation,now=Date.now())=>Number.isFinite(Date.parse(reservation?.expiresAt))&&Date.parse(reservation.expiresAt)>now;
export const canCancel=reservation=>{
  if (isManagedV2(reservation)) return reservation?.status==='RESERVED';
  if (serviceType(reservation)===SELF_STORAGE) {
    return false; // Customer không thể tự hủy đơn Self-Storage; nhân viên tại cơ sở sẽ xử lý xác nhận hoặc từ chối khi khách không ưng kho
  }
  return hasLegacyRentalFlow(reservation)&&['RESERVED','CONTRACTED'].includes(reservation?.status);
};
export const canSign=(contract,reservation,now=Date.now())=>contract?.status==='DRAFT'&&hasLegacyRentalFlow(reservation)&&(serviceType(reservation)===SELF_STORAGE?reservation.status==='DEPOSIT_PAID':reservation.status==='CONTRACTED'&&liveHold(reservation,now));
export function contractAmounts(contract,reservation) {
  if(serviceType(reservation)===MANAGED_INVENTORY)return contract?.pricingSnapshot?.amountBreakdown||{};
  if(serviceType(reservation)===SELF_STORAGE)return contract?.pricingSnapshot||{};
  return {};
}
export function managedTerms(rules,facilityId,start) {
  const at=Date.parse(`${start}T00:00:00Z`),terms=new Map();
  for(const rule of rules) {
    const fid=typeof rule.facilityId==='string'?rule.facilityId:rule.facilityId?._id;
    if(fid!==facilityId||rule.serviceType!==MANAGED_INVENTORY||rule.billingBasis!=='PER_M3'||rule.isActive!==true)continue;
    if(!Number.isSafeInteger(rule.term?.value)||rule.term.value<=0||!['DAY','MONTH','YEAR'].includes(rule.term.unit))continue;
    if(!Number.isFinite(at)||!Number.isFinite(Date.parse(rule.effectiveFrom))||Date.parse(rule.effectiveFrom)>at||(rule.effectiveTo!=null&&(!Number.isFinite(Date.parse(rule.effectiveTo))||Date.parse(rule.effectiveTo)<=at)))continue;
    if(rentalEndDate(start,rule.term))terms.set(termKey(rule.term),rule.term);
  }
  return [...terms.values()].sort((a,b)=>['DAY','MONTH','YEAR'].indexOf(a.unit)-['DAY','MONTH','YEAR'].indexOf(b.unit)||a.value-b.value);
}
export function managedRequest({facilityId,allocatedCapacityM3,startDate,term,cellIds}) {
  if(!/^[a-f\d]{24}$/i.test(facilityId||'')||typeof allocatedCapacityM3!=='number'||!Number.isFinite(allocatedCapacityM3)||allocatedCapacityM3<=0||!term||!Number.isSafeInteger(term.value)||term.value<=0||!['DAY','MONTH','YEAR'].includes(term.unit))throw Error('Invalid Managed facility, quota or rental term.');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(startDate||'')||!Number.isFinite(Date.parse(startDate))||new Date(startDate).toISOString()!==startDate.replace(/Z$/,startDate.includes('.')?'Z':'.000Z')||Date.parse(startDate)<=Date.now())throw Error('Managed start date must be a valid future ISO UTC timestamp.');
  if(cellIds!==undefined&&(!Array.isArray(cellIds)||cellIds.length<1||cellIds.length>100||!cellIds.every(v=>typeof v==='string'&&/^[a-f\d]{24}$/i.test(v))||new Set(cellIds.map(v=>v.toLowerCase())).size!==cellIds.length))throw Error('Select 1–100 unique valid Cell IDs.');
  return {facilityId,allocatedCapacityM3,startDate,term:{value:term.value,unit:term.unit},...(cellIds===undefined?{}:{cellIds:cellIds.map(v=>v.toLowerCase())})};
}
export function managedQuoteRequest(payload){const result=managedRequest(payload);if(!result.cellIds?.length)throw Error('Select specific Warehouse Cells before requesting a Managed quote.');const {allocatedCapacityM3,...serverQuoted}=result;return serverQuoted;}
export function managedCreateRequest(payload){const result=managedRequest(payload);if(!result.cellIds?.length)throw Error('Select specific Warehouse Cells before creating a Managed reservation.');const {allocatedCapacityM3,...serverPriced}=result;return serverPriced;}
export function managedCreation(response) {
  const data=response?.data?.success===true?response.data.data:null,r=data?.reservation;
  if(!r||!/^([a-f\d]{24})$/i.test(r._id||'')||r.serviceType!==MANAGED_INVENTORY||r.status!=='RESERVED'||!data.quote||typeof data.quote!=='object')throw Error('Backend did not confirm a Managed reservation. Check My Storage before attempting another booking.');
  return data;
}
