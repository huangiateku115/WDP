export const objectId=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
export const recordId=value=>typeof value==='object'?value?._id||value?.id:value;
export function apiRecord(response){const row=response?.data?.data;if(response?.data?.success!==true||!row||typeof row!=='object'||Array.isArray(row))throw Error("Máy chủ trả chi tiết bản ghi không hợp lệ.");return row;}
export function apiRows(response){const rows=response?.data?.data;if(response?.data?.success!==true||!Array.isArray(rows))throw Error("Máy chủ trả danh sách không hợp lệ.");return rows;}
export function customerRecord(row){const user=typeof row.userId==='object'&&row.userId?row.userId:{};return {id:recordId(row),userId:recordId(row.userId),name:user.displayName||user.fullName||"Chưa cung cấp tên",email:user.email||'—',phone:user.phone||'—',address:row.address||'—',verification:row.verificationStatus,note:row.note,verifiedAt:row.verifiedAt,verifiedBy:typeof row.verifiedBy==='object'?row.verifiedBy?.displayName||row.verifiedBy?._id:row.verifiedBy,history:row.verificationHistory||[],createdAt:row.createdAt};}
export function reservationRecord(row){return {...row,id:recordId(row),customerName:row.customerId?.displayName||row.customerId?.fullName||recordId(row.customerId),customerUserId:recordId(row.customerId),facility:recordId(row.facilityId),unit:row.storageUnitId?.unitCode||recordId(row.storageUnitId),history:(row.statusHistory||[]).map(e=>({at:e.createdAt,status:e.status,note:e.reason}))};}
export function reviewError(error){
 const status=error?.response?.status;
 const hints={400:'Dữ liệu yêu cầu không hợp lệ.',401:'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',403:'Vai trò hoặc cơ sở được phân công không cho phép thao tác này.',404:'Không tìm thấy bản ghi trong phạm vi được phép.',409:'Dữ liệu đã thay đổi hoặc không còn đủ điều kiện. Vui lòng tải lại.',429:'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',500:'Máy chủ không thể hoàn tất yêu cầu.',503:'Dịch vụ tạm thời không khả dụng.'};
 const message=error?.response?.data?.message;
 const text=value=>typeof value==='string'&&value.trim()?value:null;
 // Server details remain visible so operators can identify the exact failure.
 return [hints[status],text(message)].filter(Boolean).join(' ')||text(error?.message)||'Không thể hoàn tất yêu cầu. Kiểm tra kết nối và thử lại.';
}
