export function facilityAccessState(row, now = Date.now()) {
  if (!row || row.status !== 'ACTIVE') return { allowed: false, label: row?.status === 'OVERDUE' ? 'Bị chặn do quá hạn' : 'Chưa bàn giao hoặc đã kết thúc' };
  const start = Date.parse(row.startDate), end = Date.parse(row.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { allowed: false, label: 'Chưa xác minh được thời hạn thuê' };
  if (now < start) return { allowed: false, label: 'Chưa đến thời gian sử dụng' };
  if (now >= end) return { allowed: false, label: 'Đã hết thời gian sử dụng' };
  if (row.rentalPaymentFlow === 'FULL_UPFRONT_V1' && !/^\d{6}$/.test(row.accessPinCode || '')) return { allowed: false, label: 'Đã bàn giao — chưa được cấp PIN mô phỏng' };
  return { allowed: true, label: 'Đủ điều kiện kiểm tra PIN mô phỏng' };
}
export function validFacilityPin(row, value) {
  return (row?.rentalPaymentFlow === 'FULL_UPFRONT_V1' ? /^\d{6}$/ : /^(?:\d{4}|\d{6})$/).test(value);
}
export function handoverAccessMessage(row) {
  if (row?.status !== 'ACTIVE') return 'Chưa xác nhận hoàn tất bàn giao.';
  if (/^\d{6}$/.test(row.accessPinCode || '')) return 'Đã ghi nhận bàn giao. Đã cấp PIN mô phỏng cho đơn thuê. Mã này không điều khiển khóa cửa thật.';
  return 'Đã ghi nhận bàn giao. Chưa xác nhận PIN mô phỏng được cấp; vui lòng liên hệ quản lý trước khi thử mở khóa.';
}
