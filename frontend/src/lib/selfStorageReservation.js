import {matchingRentalTerms,rentalEndDate} from './rentalPeriod.js';
const id=value=>typeof value==='string'?value:value?._id||value?.id;
const validId=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
const validBookingKey=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(value);

export function selfStorageBookingAttemptStorageKey(customerId,payload) {
  if(!validId(customerId)||!payload||![payload.facilityId,payload.storageUnitId,payload.pricingPolicyId].every(validId)||
    !Number.isFinite(Date.parse(payload.startDate))||!Number.isFinite(Date.parse(payload.endDate))) throw Error('Self-Storage booking identity is invalid.');
  const identity=[customerId.toLowerCase(),payload.facilityId.toLowerCase(),payload.storageUnitId.toLowerCase(),
    new Date(payload.startDate).toISOString(),new Date(payload.endDate).toISOString(),payload.pricingPolicyId.toLowerCase()].join('|');
  return `SelfStorage_booking_attempt_${encodeURIComponent(identity)}`;
}

function createBookingIdempotencyKey() {
  const cryptoProvider=globalThis.crypto;
  if(typeof cryptoProvider?.randomUUID==='function') return `wdp-booking-${cryptoProvider.randomUUID()}`;
  if(typeof cryptoProvider?.getRandomValues==='function') {
    const bytes=new Uint8Array(16);cryptoProvider.getRandomValues(bytes);
    return `wdp-booking-${Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')}`;
  }
  throw Error('Secure booking recovery is unavailable in this browser.');
}

export function readOrCreateSelfStorageBookingAttempt(storage,customerId,payload) {
  const storageKey=selfStorageBookingAttemptStorageKey(customerId,payload);
  let raw;
  try { raw=storage.getItem(storageKey); } catch { throw Error('The browser could not safely preserve this booking attempt.'); }
  if(raw!==null) {
    try {
      const value=JSON.parse(raw);
      if(!value||typeof value!=='object'||!validBookingKey(value.idempotencyKey)||
        !(value.reservationId===null||value.reservationId===undefined||validId(value.reservationId))) throw Error();
      return { storageKey, idempotencyKey:value.idempotencyKey, reservationId:value.reservationId||null };
    } catch { throw Error('The saved booking attempt could not be verified. Check My Storage before booking again.'); }
  }
  const attempt={storageKey,idempotencyKey:createBookingIdempotencyKey(),reservationId:null};
  writeSelfStorageBookingAttempt(storage,attempt);
  return attempt;
}

export function writeSelfStorageBookingAttempt(storage,attempt) {
  if(!attempt||typeof attempt.storageKey!=='string'||!validBookingKey(attempt.idempotencyKey)||
    !(attempt.reservationId===null||validId(attempt.reservationId))) throw Error('The saved booking attempt is invalid.');
  try { storage.setItem(attempt.storageKey,JSON.stringify({idempotencyKey:attempt.idempotencyKey,reservationId:attempt.reservationId||null})); }
  catch { throw Error('The browser could not safely preserve this booking attempt.'); }
}

export function selfStorageRequest(draft,now=Date.now()) {
  const {facility,unit,term,startDate,endDate}=draft,rule=draft.quote?.price;
  if(!validId(id(facility))||!facility.serviceTypes?.includes('SELF_STORAGE')||(facility.status!=null&&facility.status!=='ACTIVE')||!validId(id(unit))||id(unit.facilityId)!==id(facility)||['INACTIVE','MAINTENANCE'].includes(unit.status)||!['SMALL','MEDIUM','LARGE'].includes(unit.size))throw Error('Select an available Self Storage unit at an eligible facility.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||rentalEndDate(startDate,term)!==endDate||!endDate||Date.parse(`${startDate}T00:00:00Z`)<=now)throw Error('Choose a valid future rental period.');
  if(!validId(id(rule))||!matchingRentalTerms([rule],{facilityId:id(facility),serviceType:'SELF_STORAGE',unitSize:unit.size,at:`${startDate}T00:00:00Z`}).terms.some(t=>t.value===term.value&&t.unit===term.unit))throw Error('An effective matching Self Storage Pricing Rule is required.');
  return {facilityId:id(facility),storageUnitId:id(unit),startDate:`${startDate}T00:00:00.000Z`,endDate:`${endDate}T00:00:00.000Z`,pricingPolicyId:id(rule)};
}
export function selfStorageEstimate(response) {
  const data=response?.data?.success===true?response.data.data:null;
  if(!data||!['estimatedRent','depositAmount','taxAmount','basePrice'].every(key=>typeof data[key]==='number'&&Number.isFinite(data[key])&&data[key]>=0)||!Number.isSafeInteger(data.durationDays)||data.durationDays<=0)throw Error('Backend returned an invalid Self Storage estimate. No financial amounts will be inferred.');
  return data;
}
export const sameEstimate=(a,b)=>['estimatedRent','depositAmount','taxAmount','durationDays','basePrice'].every(key=>a?.[key]===b?.[key]);
export function selfStorageCreation(response,payload) {
  const data=response?.data?.success===true?response.data.data:null;
  if(!data||!validId(id(data))||data.serviceType!=='SELF_STORAGE'||data.status!=='CONTRACTED'||id(data.facilityId)!==payload.facilityId||id(data.storageUnitId)!==payload.storageUnitId||Date.parse(data.startDate)!==Date.parse(payload.startDate)||Date.parse(data.endDate)!==Date.parse(payload.endDate)||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()||data.approvedBy||data.approvedAt)throw Error('Backend did not confirm the requested Self Storage reservation and active Deposit window. Check My Storage before booking again.');
  return data;
}
