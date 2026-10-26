import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {apiRecord,apiRows,recordId,objectId} from './facilityReview';
import {inspectionRecord,inspectionConditions} from './inspectionReview';

export const checkOutChecklist=['Customer, reservation and unit verified within the facility','Stored property and checkout condition checked','Customer returned the unit and access items'];
export const returnedUnitStatus=condition=>['DAMAGED','NEEDS_CLEANING'].includes(condition)?'MAINTENANCE':'AVAILABLE';
export async function checkOutEligibility({reservationId,facilityId,inspectionId}) {
 if(![reservationId,facilityId].every(objectId))throw Error('Valid reservation and facility IDs are required.');
 const rental=apiRecord(await facilityReservationApi.detail(reservationId,false));
 if(recordId(rental)!==reservationId||recordId(rental.facilityId)!==facilityId||rental.serviceType!=='SELF_STORAGE')throw Error('This is not a Self Storage reservation in your assigned facility.');
 if(!['ACTIVE','OVERDUE'].includes(rental.status))throw Error('Only ACTIVE or OVERDUE reservations can be checked out.');
 const unitId=recordId(rental.storageUnitId);
 if(!objectId(unitId))throw Error('The reservation has no valid unit.');
 const [unitResponse,inspectionResponse]=await Promise.all([storageApi.unitDetail(unitId),inspectionApi.list({reservationId})]);
 const unit=apiRecord(unitResponse),rows=apiRows(inspectionResponse).map(inspectionRecord);
 if(recordId(unit)!==unitId||recordId(unit.facilityId)!==facilityId||unit.status!=='OCCUPIED')throw Error('The unit must belong to your facility and be OCCUPIED.');
 if(rows.some(r=>r.type==='CHECK_OUT'&&r.status==='COMPLETED'))throw Error('This reservation has already been checked out. Do not repeat the action.');
 let inspection;
 if(inspectionId){
  inspection=rows.find(r=>r.id===inspectionId);
  if(!inspection||inspection.type!=='CHECK_OUT'||inspection.status!=='DRAFT'||inspection.reservation!==reservationId||inspection.facility!==facilityId||inspection.unit!==unitId||!inspectionConditions.includes(inspection.condition))throw Error('The checkout inspection is no longer valid. Refresh and try again.');
 }else if(rows.some(r=>r.type==='CHECK_OUT'&&r.status==='DRAFT'))throw Error('A draft checkout inspection already exists. Open the existing record.');
 return {rental,unit,inspection};
}
