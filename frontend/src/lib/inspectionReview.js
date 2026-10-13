import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {apiRecord,apiRows,recordId,objectId} from './facilityReview';

export const inspectionConditions=['EXCELLENT','GOOD','DAMAGED','NEEDS_CLEANING'];
export const checkInChecklist=['Tủ đúng đơn và cơ sở được giao','Cửa, khóa và hiện trạng đã kiểm tra','Khách xác nhận nhận kho và được hướng dẫn'];
export function inspectionRecord(row){return {...row,id:recordId(row),reservation:recordId(row.reservationId),facility:recordId(row.facilityId),unit:recordId(row.storageUnitId),unitCode:row.storageUnitId?.unitCode||recordId(row.storageUnitId),reservationCode:row.reservationId?.reservationCode||recordId(row.reservationId),actor:row.inspectedBy?.displayName||row.inspectedBy?.fullName||recordId(row.inspectedBy)};}
export function imageUrls(text){const values=text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(values.length>3)throw Error('Chỉ nhập tối đa 3 URL ảnh.');for(const value of values){let url;try{url=new URL(value);}catch{throw Error('Ảnh phải là URL HTTP/HTTPS hợp lệ.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||value.length>2048)throw Error('Ảnh phải là URL HTTP/HTTPS hợp lệ, không chứa thông tin đăng nhập.');}return values;}
export async function checkInEligibility({reservationId,contractId,facilityId,inspectionId,signal}){
 if(![reservationId,contractId,facilityId].every(objectId))throw Error('Cần Reservation ID, Contract ID và assignedFacilityId hợp lệ.');
 const [reservationResponse,contractResponse,inspectionResponse]=await Promise.all([facilityReservationApi.detail(reservationId,false,{signal}),inspectionApi.contract(contractId,{signal}),inspectionApi.list({reservationId},{signal})]);
 const reservation=apiRecord(reservationResponse),contract=apiRecord(contractResponse),inspections=apiRows(inspectionResponse).map(inspectionRecord);
 const unitId=recordId(reservation.storageUnitId);
 if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error('Đơn không thuộc Self Storage trong cơ sở được giao.');
 if(reservation.status!=='PAID')throw Error('Chỉ đơn PAID mới đủ điều kiện nhận kho; không được check-in lại đơn ACTIVE.');
 if(recordId(contract)!==contractId||recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId)||contract.status!=='SIGNED'||!contract.signedByCustomerAt)throw Error('Cần hợp đồng SIGNED đúng đơn và đúng khách.');
 if(!objectId(unitId))throw Error('Backend chưa cung cấp Storage Unit ID hợp lệ.');
 const unit=apiRecord(await storageApi.unitDetail(unitId,{signal}));
 if(recordId(unit)!==unitId||recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error('Tủ không thuộc cơ sở hoặc đang bận/bảo trì/ngừng hoạt động.');
 if(inspections.some(r=>r.type==='CHECK_IN'&&r.status==='COMPLETED'))throw Error('Đơn đã có biên bản CHECK_IN hoàn tất. Không check-in trùng.');
 if(inspectionId){const existing=inspections.find(r=>r.id===inspectionId);if(!existing||existing.status!=='DRAFT'||existing.type!=='CHECK_IN'||existing.facility!==facilityId||existing.unit!==unitId||!['EXCELLENT','GOOD'].includes(existing.condition))throw Error('Cần biên bản CHECK_IN DRAFT hợp lệ, hiện trạng GOOD/EXCELLENT, đúng đơn và tủ.');}
 else if(inspections.some(r=>r.type==='CHECK_IN'&&r.status==='DRAFT'))throw Error('Đơn đã có biên bản nháp. Hãy mở biên bản đó thay vì tạo trùng.');
 return {reservation,contract,unit};
}
