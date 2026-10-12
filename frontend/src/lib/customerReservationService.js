import {rentalEndDate, termKey} from './rentalPeriod.js';

export const SELF_STORAGE='SELF_STORAGE';
export const MANAGED_INVENTORY='MANAGED_INVENTORY';
export const serviceType=reservation=>[SELF_STORAGE,MANAGED_INVENTORY].includes(reservation?.serviceType)?reservation.serviceType:null;
export const serviceLabel=reservation=>serviceType(reservation)===SELF_STORAGE?'Self Storage':serviceType(reservation)===MANAGED_INVENTORY?'Managed Inventory':'Unsupported / unknown service';
export const liveHold=(reservation,now=Date.now())=>Number.isFinite(Date.parse(reservation?.expiresAt))&&Date.parse(reservation.expiresAt)>now;
export const canCancel=reservation=>!!serviceType(reservation)&&['RESERVED','CONTRACTED'].includes(reservation.status);
export const canSign=(contract,reservation,now=Date.now())=>contract?.status==='DRAFT'&&!!serviceType(reservation)&&(serviceType(reservation)===SELF_STORAGE||(reservation.status==='CONTRACTED'&&liveHold(reservation,now)));
export function canMockPay(reservation,contract,enabled,now=Date.now()) {
  if(!serviceType(reservation)||reservation.status!=='CONTRACTED')return false;
  return serviceType(reservation)===SELF_STORAGE||!!enabled&&liveHold(reservation,now)&&contract?.status==='SIGNED'&&!!contract.signedByCustomerAt;
}
export const managedMockEnabled=env=>env.DEV===true&&env.VITE_MI_MOCK_PAYMENT_ENABLED==='true';
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
export function managedRequest({facilityId,allocatedCapacityM3,startDate,term}) {
  if(!/^[a-f\d]{24}$/i.test(facilityId||'')||typeof allocatedCapacityM3!=='number'||!Number.isFinite(allocatedCapacityM3)||allocatedCapacityM3<=0||!term||!Number.isSafeInteger(term.value)||term.value<=0||!['DAY','MONTH','YEAR'].includes(term.unit))throw Error('Invalid Managed facility, quota or rental term.');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(startDate||'')||!Number.isFinite(Date.parse(startDate))||new Date(startDate).toISOString()!==startDate.replace(/Z$/,startDate.includes('.')?'Z':'.000Z')||Date.parse(startDate)<=Date.now())throw Error('Managed start date must be a valid future ISO UTC timestamp.');
  return {facilityId,allocatedCapacityM3,startDate,term:{value:term.value,unit:term.unit}};
}
export function managedCreation(response) {
  const data=response?.data?.success===true?response.data.data:null,r=data?.reservation;
  if(!r||!/^([a-f\d]{24})$/i.test(r._id||'')||r.serviceType!==MANAGED_INVENTORY||r.status!=='RESERVED'||!data.quote||typeof data.quote!=='object')throw Error('Backend did not confirm a Managed reservation. Check My Storage before attempting another booking.');
  return data;
}
