import {objectId} from './facilityReview.js';

export const outboundLabel = value => ({PENDING:'Chờ khách xuất hàng',CONFIRMED:'Đã xuất hàng',CANCELLED:'Đã hủy',CREATE:'Tạo yêu cầu',CANCEL:'Hủy yêu cầu',CONFIRM:'Xác nhận xuất hàng'})[value] || 'Chưa xác định';
export function outboundRequest(row, facilityId) {
  if (!row || !objectId(row.requestId) || !objectId(row.skuId) || !objectId(row.reservationId) || row.facilityId !== facilityId || !['PENDING','CONFIRMED','CANCELLED'].includes(row.state) || !Number.isSafeInteger(row.requestedQuantity) || row.requestedQuantity <= 0 || !Array.isArray(row.sourceCellIds) || !row.sourceCellIds.every(objectId)) throw Error('Chưa xác minh được yêu cầu xuất hàng thuộc cơ sở.');
  return row;
}
export function outboundPage(response, facilityId, page) {
  const data = response?.data?.data;
  const pagination = data?.pagination;
  if (!Array.isArray(data?.data) || !pagination || pagination.page !== page || !['total','totalPages'].every(key => Number.isSafeInteger(pagination[key]) && pagination[key] >= 0)) throw Error('Dữ liệu phân trang yêu cầu xuất chưa hợp lệ.');
  return {rows:data.data.map(row => outboundRequest(row, facilityId)), pagination};
}
export function outboundDetail(response, facilityId, requestId) {
  const data = response?.data?.data;
  outboundRequest(data?.request, facilityId);
  if (data.request.requestId !== requestId || !Array.isArray(data.events) || !Array.isArray(data.movements)) throw Error('Chi tiết không khớp yêu cầu xuất đang chọn.');
  return data;
}
