import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {apiRecord,apiRows,recordId,objectId} from './facilityReview';
import {inspectionRecord,inspectionConditions} from './inspectionReview';

export const checkOutChecklist=["Đã đối chiếu khách, đơn thuê và kho trong cơ sở","Đã kiểm tra tài sản lưu trữ và tình trạng trả kho","Khách đã trả kho và vật dụng truy cập"];
export const returnedUnitStatus=condition=>['DAMAGED','NEEDS_CLEANING'].includes(condition)?'MAINTENANCE':'AVAILABLE';
export async function checkOutEligibility({reservationId,facilityId,inspectionId}) {
 if(![reservationId,facilityId].every(objectId))throw Error("Cần mã đơn thuê và cơ sở hợp lệ.");
 const rental=apiRecord(await facilityReservationApi.detail(reservationId,false));
 if(recordId(rental)!==reservationId||recordId(rental.facilityId)!==facilityId||rental.serviceType!=='SELF_STORAGE')throw Error("Đây không phải đơn thuê kho riêng thuộc cơ sở của bạn.");
 if(!['ACTIVE','OVERDUE'].includes(rental.status))throw Error("Chỉ đơn đang sử dụng hoặc quá hạn mới có thể trả kho.");
 const unitId=recordId(rental.storageUnitId);
 if(!objectId(unitId))throw Error("Đơn chưa có kho hợp lệ.");
 const [unitResponse,inspectionResponse]=await Promise.all([storageApi.unitDetail(unitId),inspectionApi.list({reservationId})]);
 const unit=apiRecord(unitResponse),rows=apiRows(inspectionResponse).map(inspectionRecord);
 if(recordId(unit)!==unitId||recordId(unit.facilityId)!==facilityId||unit.status!=='OCCUPIED')throw Error("Kho cần thuộc cơ sở của bạn và đang được sử dụng.");
 if(rows.some(r=>r.type==='CHECK_OUT'&&r.status==='COMPLETED'))throw Error("Đơn đã hoàn tất trả kho.");
 let inspection;
 if(inspectionId){
  inspection=rows.find(r=>r.id===inspectionId);
  if(!inspection||inspection.type!=='CHECK_OUT'||inspection.status!=='DRAFT'||inspection.reservation!==reservationId||inspection.facility!==facilityId||inspection.unit!==unitId||!inspectionConditions.includes(inspection.condition))throw Error("Biên bản trả kho không còn hợp lệ. Tải lại và thử lại.");
 }else if(rows.some(r=>r.type==='CHECK_OUT'&&r.status==='DRAFT'))throw Error("Đã có biên bản trả kho nháp. Vui lòng mở hồ sơ hiện có.");
 return {rental,unit,inspection};
}
