import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {apiRecord,apiRows,recordId,objectId} from './facilityReview';

export const inspectionConditions=['EXCELLENT','GOOD','DAMAGED','NEEDS_CLEANING'];
export const checkInChecklist=['Unit matches the reservation and assigned facility','Door, lock and unit condition checked','Customer acknowledged receipt and received instructions'];
export function inspectionRecord(row){return {...row,id:recordId(row),reservation:recordId(row.reservationId),facility:recordId(row.facilityId),unit:recordId(row.storageUnitId),unitCode:row.storageUnitId?.unitCode||recordId(row.storageUnitId),reservationCode:row.reservationId?.reservationCode||recordId(row.reservationId),actor:row.inspectedBy?.displayName||row.inspectedBy?.fullName||recordId(row.inspectedBy)};}
export function imageUrls(text){const values=text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(values.length>3)throw Error('Enter up to 3 image URLs.');for(const value of values){let url;try{url=new URL(value);}catch{throw Error('Images must use valid HTTP/HTTPS URLs.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||value.length>2048)throw Error('Images must use valid HTTP/HTTPS URLs without credentials.');}return values;}
export async function checkInEligibility({reservationId,facilityId,inspectionId,signal}){
 if(![reservationId,facilityId].every(objectId))throw Error('Valid reservation and assigned facility IDs are required.');
 // Sequential reads on purpose: each call is one request to the backend and the next step depends
 // on the previous result, so opening an inspection never bursts the API with parallel calls.
 const reservation=apiRecord(await facilityReservationApi.detail(reservationId,false,{signal}));
 if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error('This is not a Self Storage reservation in your assigned facility.');
 if(reservation.status!=='PAID')throw Error('Only PAID reservations can be checked in. ACTIVE reservations cannot be checked in again.');
 const contract=apiRecord(await inspectionApi.contractByReservation(reservationId,{signal}));
 if(contract.signedProofUrl||reservation.bookingFlowVersion===2)throw Error('This reservation uses the paper contract or Managed workflow. Use its handover page, not legacy inspection completion.');
 if(recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId)||contract.status!=='SIGNED'||!contract.signedByCustomerAt)throw Error('A SIGNED contract matching this reservation and customer is required.');
 const unitId=recordId(reservation.storageUnitId);
 if(!objectId(unitId))throw Error('A valid storage unit ID is missing.');
 const unit=apiRecord(await storageApi.unitDetail(unitId,{signal}));
 if(recordId(unit)!==unitId||recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error('The unit is outside your facility, occupied, under maintenance or inactive.');
 const inspections=apiRows(await inspectionApi.list({reservationId},{signal})).map(inspectionRecord);
 if(inspections.some(r=>r.type==='CHECK_IN'&&r.status==='COMPLETED'))throw Error('A completed CHECK_IN inspection already exists. Do not check in twice.');
 if(inspectionId){const existing=inspections.find(r=>r.id===inspectionId);if(!existing||existing.status!=='DRAFT'||existing.type!=='CHECK_IN'||existing.facility!==facilityId||existing.unit!==unitId||!['EXCELLENT','GOOD'].includes(existing.condition))throw Error('A valid DRAFT CHECK_IN inspection with GOOD or EXCELLENT condition is required for this reservation and unit.');}
 else if(inspections.some(r=>r.type==='CHECK_IN'&&r.status==='DRAFT'))throw Error('A draft inspection already exists. Open it instead of creating another.');
 return {reservation,contract,unit};
}
