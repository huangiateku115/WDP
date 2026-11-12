import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {apiRecord,apiRows,recordId,objectId} from './facilityReview';

export const inspectionConditions=['EXCELLENT','GOOD','DAMAGED','NEEDS_CLEANING'];
export const checkInChecklist=["Kho khớp đơn thuê và cơ sở được phân công","Đã kiểm tra cửa, khóa và tình trạng kho","Khách đã xác nhận nhận kho và được hướng dẫn"];
export function inspectionRecord(row){return {...row,id:recordId(row),reservation:recordId(row.reservationId),facility:recordId(row.facilityId),unit:recordId(row.storageUnitId),unitCode:row.storageUnitId?.unitCode||recordId(row.storageUnitId),reservationCode:row.reservationId?.reservationCode||recordId(row.reservationId),actor:row.inspectedBy?.displayName||row.inspectedBy?.fullName||recordId(row.inspectedBy)};}
export function imageUrls(text){const values=text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(values.length>3)throw Error("Nhập tối đa 3 địa chỉ ảnh.");for(const value of values){let url;try{url=new URL(value);}catch{throw Error("Ảnh cần dùng địa chỉ HTTP/HTTPS hợp lệ.");}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||value.length>2048)throw Error("Ảnh cần dùng địa chỉ HTTP/HTTPS hợp lệ và không chứa thông tin đăng nhập.");}return values;}
export async function checkInEligibility({reservationId,facilityId,inspectionId,signal}){
 if(![reservationId,facilityId].every(objectId))throw Error("Cần mã định danh đơn thuê và cơ sở được phân công hợp lệ.");
 // Sequential reads on purpose: each call is one request to the backend and the next step depends
 // on the previous result, so opening an inspection never bursts the API with parallel calls.
 const reservation=apiRecord(await facilityReservationApi.detail(reservationId,false,{signal}));
 if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error("Đây không phải đơn thuê kho riêng thuộc cơ sở của bạn.");
 if(reservation.status!=='PAID')throw Error("Chỉ đơn đã thanh toán mới được nhận kho. Đơn đang sử dụng không thể nhận kho lại.");
 const contract=apiRecord(await inspectionApi.contractByReservation(reservationId,{signal}));
 if(contract.signedProofUrl||reservation.bookingFlowVersion===2)throw Error("Đơn dùng luồng hợp đồng giấy hoặc hàng hóa. Hãy mở trang bàn giao tương ứng.");
 if(recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId)||contract.status!=='SIGNED'||!contract.signedByCustomerAt)throw Error("Cần hợp đồng đã ký khớp đơn thuê và khách hàng.");
 const unitId=recordId(reservation.storageUnitId);
 if(!objectId(unitId))throw Error("Thiếu mã kho hợp lệ.");
 const unit=apiRecord(await storageApi.unitDetail(unitId,{signal}));
 if(recordId(unit)!==unitId||recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error("Kho ngoài cơ sở, đang được sử dụng, bảo trì hoặc ngừng hoạt động.");
 const inspections=apiRows(await inspectionApi.list({reservationId},{signal})).map(inspectionRecord);
 if(inspections.some(r=>r.type==='CHECK_IN'&&r.status==='COMPLETED'))throw Error("Đã có biên bản nhận kho hoàn tất.");
 if(inspectionId){const existing=inspections.find(r=>r.id===inspectionId);if(!existing||existing.status!=='DRAFT'||existing.type!=='CHECK_IN'||existing.facility!==facilityId||existing.unit!==unitId||!['EXCELLENT','GOOD'].includes(existing.condition))throw Error("Cần biên bản nhận kho nháp hợp lệ với tình trạng tốt hoặc rất tốt cho đúng đơn và kho.");}
 else if(inspections.some(r=>r.type==='CHECK_IN'&&r.status==='DRAFT'))throw Error("Đã có biên bản nháp. Vui lòng mở biên bản hiện có.");
 return {reservation,contract,unit};
}
