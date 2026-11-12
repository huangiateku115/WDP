export const fullUpfront = data => data?.reservation?.rentalPaymentFlow === 'FULL_UPFRONT_V1';
export const currentDocument = contract => contract?.contentVersions?.find(version => version.version === contract.currentContentVersion);
export function paperEvidence(data, input, now = Date.now()) {
  if (!fullUpfront(data)) return undefined;
  const document = currentDocument(data.contract);
  if (!document || !Number.isSafeInteger(document.version) || !document.contentHash) throw Error('Chưa có phiên bản hợp đồng hợp lệ. Vui lòng tải lại.');
  if (data.reservation.status !== 'PAID' || data.contract.status !== 'DRAFT') throw Error('Cần đơn đã thanh toán đủ và hợp đồng nháp.');
  if (!input.customerIdentityVerified) throw Error('Cần xác minh danh tính khách hàng trực tiếp.');
  if (data.reservation.signingDeadline && Date.parse(data.reservation.signingDeadline) <= now) throw Error('Đã quá hạn ký. Cần quản lý xem xét; chưa có chức năng tự hủy hoặc hoàn tiền.');
  const times = [input.customerSignedAt, input.facilitySignedAt].map(value => value ? new Date(value).getTime() : NaN);
  const created = Date.parse(document.createdAt);
  if (!Number.isFinite(created) || times.some(time => !Number.isFinite(time) || time > now || time < created)) throw Error('Nhập thời điểm ký thực tế của hai bên, từ lúc tạo phiên bản hợp đồng đến hiện tại.');
  return { documentVersion: document.version, documentHash: document.contentHash, customerSignedAt: new Date(times[0]).toISOString(), facilitySignedAt: new Date(times[1]).toISOString(), customerIdentityVerified: true };
}
export function canHandover(data, now = Date.now()) {
  if (!data || data.contract.status !== 'SIGNED' || !(data.contract.signedProofUrl || data.reservation.paperContractProofUrl)) return false;
  if (!fullUpfront(data)) return data.reservation.status === 'PAID';
  return data.reservation.status === 'CHECKIN_READY' && !!data.contract.verifiedAt && Date.parse(data.reservation.startDate) <= now && Date.parse(data.reservation.endDate) > now;
}
export function checkoutMessage(result, reservation, contract, unit) {
  const expectedUnit = result.unitStatus;
  if (!['AVAILABLE', 'MAINTENANCE'].includes(expectedUnit) || typeof result.isEarly !== 'boolean' ||
      reservation.status !== 'CHECKED_OUT' || reservation.checkoutRequest?.status !== 'COMPLETED' ||
      contract.status !== (result.isEarly ? 'TERMINATED' : 'EXPIRED') || unit.status !== expectedUnit) {
    throw Error('Chưa xác minh được kết quả trả kho. Tải lại để đối chiếu đơn, hợp đồng và kho.');
  }
  return `${result.isEarly ? 'Đã nghiệm thu trả kho sớm, chấm dứt hợp đồng và không hoàn tiền thuê chưa sử dụng.' : 'Đã nghiệm thu trả kho đúng hạn và kết thúc hợp đồng.'} ${expectedUnit === 'MAINTENANCE' ? 'Kho chuyển sang bảo trì, chưa thể cho thuê tiếp.' : 'Kho đã sẵn sàng cho thuê tiếp.'}`;
}
