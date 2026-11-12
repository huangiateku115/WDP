import { apiRecord, apiRows, objectId, recordId } from './facilityReview.js';

export function managedItemPage(response, facilityId, page) {
  const rows = apiRows(response);
  const pagination = response.data.pagination;
  if (!pagination || pagination.page !== page || !Number.isSafeInteger(pagination.total) || pagination.total < 0 ||
      !Number.isSafeInteger(pagination.totalPages) || pagination.totalPages < 0 ||
      rows.some(row => !objectId(recordId(row)) || recordId(row.facilityId) !== facilityId || !objectId(recordId(row.managedReservationId))) ||
      new Set(rows.map(recordId)).size !== rows.length) throw Error('Danh sách hàng hóa không khớp cơ sở hoặc trang yêu cầu.');
  return { rows: rows.map(row => ({ ...row, id: recordId(row) })), pagination };
}

export function scopedManagedReservation(response, reservationId, facilityId) {
  const row = apiRecord(response);
  if (recordId(row) !== reservationId || recordId(row.facilityId) !== facilityId || row.serviceType !== 'MANAGED_INVENTORY') {
    throw Error('Đơn hàng hóa không thuộc cơ sở được phân công.');
  }
  return row;
}

export function managedReadiness(response, reservationId) {
  const row = apiRecord(response);
  if (row.readonly !== true || row.reservationId !== reservationId || row.serviceType !== 'MANAGED_INVENTORY' ||
      !['READY', 'BLOCKED', 'UNKNOWN'].includes(row.overallReadiness) || !Array.isArray(row.blockers)) {
    throw Error('Chưa xác minh được kết quả kiểm tra điều kiện trả không gian.');
  }
  return row;
}

export function positiveNumber(value, label, integer = false) {
  const number = Number(value);
  if (!String(value).trim() || !Number.isFinite(number) || number <= 0 || integer && !Number.isSafeInteger(number)) {
    throw Error(`${label} phải là số ${integer ? 'nguyên ' : ''}dương.`);
  }
  return number;
}

export function scopedTopology(response, facilityId, expectedId) {
  const row = apiRecord(response);
  if (!objectId(recordId(row)) || recordId(row.facilityId) !== facilityId || expectedId && recordId(row) !== expectedId) {
    throw Error('Dữ liệu cấu trúc không khớp cơ sở hoặc bản ghi yêu cầu.');
  }
  return row;
}
