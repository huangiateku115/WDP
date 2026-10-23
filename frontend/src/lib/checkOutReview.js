import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {apiRecord,apiRows,recordId,objectId} from './facilityReview';
import {inspectionRecord,inspectionConditions} from './inspectionReview';

export const checkOutChecklist=['Đúng khách, đơn thuê và tủ trong cơ sở','Đã kiểm tra tài sản và hiện trạng trả kho','Khách đã bàn giao lại tủ và phương tiện truy cập'];
export const returnedUnitStatus=condition=>['DAMAGED','NEEDS_CLEANING'].includes(condition)?'MAINTENANCE':'AVAILABLE';
export async function checkOutEligibility({reservationId,facilityId,inspectionId}) {
 if(![reservationId,facilityId].every(objectId))throw Error('Cần ID đơn và cơ sở hợp lệ.');
 const rental=apiRecord(await facilityReservationApi.detail(reservationId,false));
 if(recordId(rental)!==reservationId||recordId(rental.facilityId)!==facilityId||rental.serviceType!=='SELF_STORAGE')throw Error('Đơn không thuộc Self Storage trong cơ sở được giao.');
 if(!['ACTIVE','OVERDUE'].includes(rental.status))throw Error('Chỉ trả kho cho đơn ACTIVE hoặc OVERDUE.');
 const unitId=recordId(rental.storageUnitId);
 if(!objectId(unitId))throw Error('Đơn chưa có tủ hợp lệ.');
 const [unitResponse,inspectionResponse]=await Promise.all([storageApi.unitDetail(unitId),inspectionApi.list({reservationId})]);
 const unit=apiRecord(unitResponse),rows=apiRows(inspectionResponse).map(inspectionRecord);
 if(recordId(unit)!==unitId||recordId(unit.facilityId)!==facilityId||unit.status!=='OCCUPIED')throw Error('Tủ phải thuộc cơ sở và đang OCCUPIED.');
 if(rows.some(r=>r.type==='CHECK_OUT'&&r.status==='COMPLETED'))throw Error('Đơn đã hoàn tất trả kho; không thực hiện lại.');
 let inspection;
 if(inspectionId){
  inspection=rows.find(r=>r.id===inspectionId);
  if(!inspection||inspection.type!=='CHECK_OUT'||inspection.status!=='DRAFT'||inspection.reservation!==reservationId||inspection.facility!==facilityId||inspection.unit!==unitId||!inspectionConditions.includes(inspection.condition))throw Error('Biên bản trả kho không còn hợp lệ. Hãy tải lại.');
 }else if(rows.some(r=>r.type==='CHECK_OUT'&&r.status==='DRAFT'))throw Error('Đã có biên bản trả kho nháp; mở biên bản hiện có.');
 return {rental,unit,inspection};
}
