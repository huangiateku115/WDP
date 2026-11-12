import {apiRows, objectId, recordId} from './facilityReview.js';

export const accessLabels = {
  SCHEDULED:'Chờ đến kho', CHECKED_IN:'Đang ở kho', COMPLETED:'Đã hoàn tất lượt đến', CANCELLED:'Đã hủy',
  ACTIVE:'Đang hoạt động', CHECKED_OUT:'Đã rời kho', REVOKED:'Đã thu hồi', EXPIRED:'Đã hết hạn', NOT_STARTED:'Chưa bắt đầu',
  INBOUND:'Nhập hàng', OUTBOUND:'Xuất hàng', RELOCATION:'Di chuyển hàng', INSPECTION:'Kiểm tra',
  VISIT_CREATED:'Tạo lịch', VISIT_AMENDED:'Sửa lịch', STAFF_ASSIGNED:'Phân công hộ tống',
  SESSION_CREATED:'Bắt đầu phiên', SESSION_CHECKED_OUT:'Kết thúc phiên', SESSION_REVOKED:'Thu hồi phiên',
  SESSION_EXPIRED:'Phiên hết hạn', CUSTOMER_CHECKED_OUT:'Khách rời kho', ACCESS_SESSION_EXPIRED:'Hết thời gian truy cập',
};
export const accessLabel = value => accessLabels[value] || value || 'Chưa có';
export function scopedAccess(row, kind, user) {
  if (!row || !objectId(recordId(row)) || recordId(row.facilityId) !== user.assignedFacilityId ||
      !Number.isSafeInteger(row.revision) || row.revision < 0 || !objectId(recordId(row.reservationId)) ||
      !objectId(recordId(row.customerId)) ||
      (user.role === 'FACILITY_STAFF' && recordId(row.assignedStaffId) !== recordId(user))) {
    throw Error('Bản ghi truy cập không khớp cơ sở, người được phân công hoặc phiên bản dữ liệu.');
  }
  const allowed = kind === 'visit' ? ['SCHEDULED','CHECKED_IN','COMPLETED','CANCELLED'] : ['ACTIVE','CHECKED_OUT','REVOKED','EXPIRED'];
  if (!allowed.includes(row.status)) throw Error('Trạng thái truy cập không hợp lệ.');
  const dates = kind === 'visit' ? [row.startsAt,row.endsAt] : [row.startedAt,row.expiresAt];
  if (dates.some(date => !Number.isFinite(Date.parse(date))) || Date.parse(dates[1]) <= Date.parse(dates[0])) throw Error('Thời gian truy cập không hợp lệ.');
  if (kind === 'session' && (!objectId(recordId(row.visitId)) || !Array.isArray(row.allowedCellIds) || !row.allowedCellIds.length || row.allowedCellIds.some(id => !objectId(recordId(id))))) throw Error('Phiên chưa có phạm vi ô lưu trữ hợp lệ.');
  return row;
}
export function accessRows(response, kind, user) {
  const rows = apiRows(response).map(row => scopedAccess(row,kind,user));
  if (new Set(rows.map(recordId)).size !== rows.length) throw Error('Danh sách truy cập có bản ghi trùng.');
  return rows;
}
export function sessionStatus(row, now = Date.now()) {
  if(row.status==='ACTIVE'&&Date.parse(row.startedAt)>now)return 'NOT_STARTED';
  return row.status === 'ACTIVE' && Date.parse(row.expiresAt) <= now ? 'EXPIRED' : row.status;
}
export function visitInWindow(row, now = Date.now()) {
  return row.status === 'SCHEDULED' && Date.parse(row.startsAt) <= now && Date.parse(row.endsAt) > now;
}
export function currentRevision(original, fresh) {
  if (recordId(original) !== recordId(fresh) || original.revision !== fresh.revision) throw Error('Dữ liệu đã thay đổi. Đóng hộp thoại và tải lại trước khi thao tác.');
}
export function attestation(input) {
  if (input?.identityVerified !== true || input?.customerPresent !== true || input?.safetyReviewed !== true || typeof input.safetyNotes !== 'string' || input.safetyNotes.trim().length < 3 || input.safetyNotes.length > 1000) throw Error('Cần đủ ba xác nhận trực tiếp và ghi chú an toàn từ 3 đến 1000 ký tự.');
  return {...input, safetyNotes:input.safetyNotes.trim()};
}
