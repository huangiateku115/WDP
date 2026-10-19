import {inventoryId,validInventoryId} from './inventoryRegistration.js';

export const inventoryStatusLabels={IN_STORAGE:'Đang lưu kho',PENDING_OUTBOUND:'Đang chờ xuất kho',CHECKED_OUT:'Đã xuất kho'};
// The owned GET endpoint establishes ownership. Allocation eligibility remains Backend-authoritative.
export function outboundEligible(item,rental,now=Date.now()){
  if(item?.status!=='IN_STORAGE'||!validInventoryId(inventoryId(item.currentCellId)))return false;
  if(!rental)return true;
  return rental.serviceType==='MANAGED_INVENTORY'&&inventoryId(rental)===inventoryId(item.managedReservationId)&&inventoryId(rental.facilityId)===inventoryId(item.facilityId)&&rental.status==='ACTIVE'&&Date.parse(rental.startDate)<=now&&Date.parse(rental.endDate)>now;
}
export function outboundError(error){
  const status=error?.response?.status;
  return ({400:'Yêu cầu không hợp lệ. Vui lòng tải lại thông tin mặt hàng.',401:'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',403:'Bạn không có quyền yêu cầu xuất mặt hàng này.',404:'Không tìm thấy mặt hàng hoặc bạn không có quyền truy cập.',409:'Mặt hàng hoặc kỳ thuê đã thay đổi, hoặc không còn đủ điều kiện xuất kho. Vui lòng tải lại trước khi tiếp tục.'})[status]||(status>=500?'Máy chủ chưa thể xử lý yêu cầu. Hãy kiểm tra trạng thái trước khi thử lại.':'Không xác định được kết quả yêu cầu. Hãy tải lại trạng thái; hệ thống không tự gửi lại yêu cầu.');
}
