import { apiRecord, objectId, recordId } from './facilityReview.js';
import { currentDocument, canHandover } from './facilityPaperContract.js';

export function managedContract(response, reservation) {
  const contract = apiRecord(response), document = currentDocument(contract);
  const content = document?.content;
  if (!objectId(recordId(contract)) || recordId(contract.reservationId) !== recordId(reservation) ||
      recordId(contract.customerId) !== recordId(reservation.customerId) || !document ||
      !Number.isSafeInteger(document.version) || !/^[a-f\d]{64}$/i.test(document.contentHash || '') ||
      content?.schemaVersion !== 3 || content.reservation?.id !== recordId(reservation) ||
      content.reservation?.serviceType !== 'MANAGED_INVENTORY' ||
      content.reservation?.facilityId !== recordId(reservation.facilityId)) {
    throw Error('Hợp đồng không khớp đơn hàng hóa, khách hàng, cơ sở hoặc phiên bản hiện hành.');
  }
  return contract;
}
export function managedHandoverReady(data, now = Date.now()) {
  if (!data?.contract || !canHandover(data, now) || !data.reservation.allocatedCellIds?.length || !data.contract.signedProofPublicId) return false;
  const document = currentDocument(data.contract);
  const signed = data.contract.signatures?.filter(signature => signature.version === document?.version && signature.contentHash === document?.contentHash) || [];
  return signed.some(signature => signature.signerRole === 'CUSTOMER') &&
    signed.some(signature => ['FACILITY_MANAGER', 'FACILITY_STAFF'].includes(signature.signerRole));
}
export function managedHandoverPayload(data, { condition, notes, identityVerified }, now = Date.now()) {
  if (!managedHandoverReady(data, now)) throw Error('Cần hợp đồng giấy đã xác minh, đủ chữ ký, ô đã phân bổ và thời gian thuê hợp lệ.');
  if (!identityVerified) throw Error('Cần xác minh danh tính khách trực tiếp trước khi bàn giao.');
  if (!['GOOD', 'MINOR_DAMAGE'].includes(condition)) throw Error('Không bàn giao không gian chưa an toàn.');
  if (!notes.trim() || notes.trim().length > 1000) throw Error('Nhập ghi chú bàn giao từ 1 đến 1000 ký tự.');
  // The confirmed Managed endpoint only accepts these two fields.
  return { storageCondition: condition, accessNotes: notes.trim() };
}
