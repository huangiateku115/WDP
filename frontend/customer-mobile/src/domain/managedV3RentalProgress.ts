type PaymentRow = {
  id?: string;
  status: string;
  providerSettlementStatus: string;
  applicationStatus: string;
  checkoutStatus: string;
  reconciliationRequired: boolean;
};

export type ManagedPaymentProgress = 'NONE' | 'PENDING' | 'VERIFYING' | 'APPLIED' | 'REVIEW' | 'FAILED' | 'CANCELLED' | 'UNSYNCED';
export type ProgressState = 'COMPLETED' | 'CURRENT' | 'PENDING' | 'BLOCKED';

export function managedPaymentProgress(rows?: readonly PaymentRow[]): ManagedPaymentProgress {
  if (!rows) return 'NONE';
  if (rows.some(row => row.status === 'SUCCEEDED' && row.providerSettlementStatus === 'VERIFIED' &&
    row.applicationStatus === 'APPLIED' && !row.reconciliationRequired)) return 'APPLIED';
  if (rows.some(row => row.reconciliationRequired || row.status === 'RECONCILIATION_REQUIRED' ||
    row.checkoutStatus === 'RECONCILIATION_REQUIRED' || row.applicationStatus === 'MANUAL_REVIEW')) return 'REVIEW';
  if (rows.some(row => row.status === 'SUCCEEDED' || row.providerSettlementStatus === 'VERIFIED' ||
    row.applicationStatus === 'APPLIED' || row.checkoutStatus === 'UNKNOWN' || row.checkoutStatus === 'CREATING')) return 'VERIFYING';
  if (rows.length && rows.every(row => row.status === 'CANCELLED' || row.checkoutStatus === 'CANCELLED')) return 'CANCELLED';
  if (rows.some(row => row.status === 'FAILED' || row.checkoutStatus === 'FAILED')) return 'FAILED';
  return rows.length ? 'PENDING' : 'NONE';
}

export function managedRentalPaymentProgress(reservationStatus: string, rows?: readonly PaymentRow[], linkedFullPaymentId?: string): ManagedPaymentProgress {
  const progress = managedPaymentProgress(rows);
  if (reservationStatus === 'ACTIVE') {
    return linkedFullPaymentId&&rows?.some(row=>row.id===linkedFullPaymentId&&managedPaymentProgress([row])==='APPLIED')?'APPLIED':'UNSYNCED';
  }
  return progress;
}

export function managedPaymentLabel(row: PaymentRow) {
  const state = managedPaymentProgress([row]);
  if (state === 'APPLIED') return 'Đã thanh toán';
  if (state === 'REVIEW') return 'Cần đối soát';
  if (state === 'VERIFYING') return 'Đang xác minh';
  if (state === 'FAILED') return 'Thanh toán thất bại';
  if (state === 'CANCELLED') return 'Đã hủy';
  if (state === 'UNSYNCED') return 'Thông tin thanh toán chưa đồng bộ';
  return 'Đang chờ thanh toán';
}

export function managedPaperContractNextStep(reservationStatus:string,payment:ManagedPaymentProgress){
  return reservationStatus==='PAID'&&payment==='APPLIED';
}

export function managedHandoverVerified(reservation:{status:string;handoverAt?:unknown;handoverByStaffId?:unknown}){
  const staffId=reservation.handoverByStaffId;
  const validStaff=typeof staffId==='string'?/^[a-f\d]{24}$/i.test(staffId):
    !!staffId&&typeof staffId==='object'&&'_id' in staffId&&typeof staffId._id==='string'&&/^[a-f\d]{24}$/i.test(staffId._id);
  return reservation.status==='ACTIVE'&&typeof reservation.handoverAt==='string'&&
    Number.isFinite(Date.parse(reservation.handoverAt))&&validStaff;
}

export function managedRentalProgress(input: {
  reservationStatus: string;
  payment: ManagedPaymentProgress;
  hasVisit?: boolean;
  visitEligible?: boolean;
  hasInboundSession?: boolean;
  hasStoredItems?: boolean;
  handoverComplete?: boolean;
}) {
  const terminal = ['CANCELLED', 'OVERDUE', 'CLOSED', 'CHECKED_OUT'].includes(input.reservationStatus);
  const eligibleForVisit = input.visitEligible ?? ['CHECKIN_READY', 'ACTIVE'].includes(input.reservationStatus);
  const paymentDone = input.payment === 'APPLIED';
  const contractDone = ['CHECKIN_READY', 'ACTIVE'].includes(input.reservationStatus);
  const handoverDone = input.handoverComplete ?? input.reservationStatus === 'ACTIVE';
  const blockedPayment = ['REVIEW', 'FAILED', 'CANCELLED', 'UNSYNCED'].includes(input.payment);
  return [
    { key: 'booking', title: 'Đặt kho', state: terminal ? 'BLOCKED' : 'COMPLETED', detail: terminal ? 'Đơn thuê đã kết thúc hoặc bị hủy.' : 'Đơn thuê đã được xác nhận.' },
    { key: 'payment', title: 'Thanh toán', state: paymentDone ? 'COMPLETED' : blockedPayment ? 'BLOCKED' : 'CURRENT', detail: paymentDone ? 'Thanh toán đã được xác minh và ghi nhận.' : input.payment === 'UNSYNCED' ? 'Chưa thể xác minh khoản thanh toán liên kết. Hãy tải lại hoặc liên hệ cơ sở để được hỗ trợ.' : input.payment === 'REVIEW' ? 'Giao dịch cần được kiểm tra trước khi tiếp tục.' : input.payment === 'FAILED' ? 'Giao dịch chưa thành công. Hãy kiểm tra trạng thái trước khi thử lại.' : input.payment === 'CANCELLED' ? 'Giao dịch đã bị hủy.' : input.payment === 'VERIFYING' ? 'Đang xác minh kết quả thanh toán.' : input.payment === 'PENDING' ? 'Đang chờ xác nhận thanh toán.' : 'Chưa có thông tin xác nhận thanh toán.' },
    { key: 'contract', title: 'Ký hợp đồng', state: contractDone ? 'COMPLETED' : paymentDone && input.reservationStatus === 'PAID' ? 'CURRENT' : terminal || blockedPayment ? 'BLOCKED' : 'PENDING', detail: contractDone ? 'Cơ sở đã xác nhận hợp đồng.' : paymentDone && input.reservationStatus === 'PAID' ? 'Vui lòng hoàn tất ký hợp đồng giấy tại cơ sở.' : 'Chờ xác nhận thanh toán và tạo hợp đồng.' },
    { key: 'handover', title: 'Bàn giao và kích hoạt', state: handoverDone ? 'COMPLETED' : input.reservationStatus === 'CHECKIN_READY' ? 'CURRENT' : terminal ? 'BLOCKED' : 'PENDING', detail: handoverDone ? 'Đơn thuê đã được kích hoạt.' : input.reservationStatus === 'CHECKIN_READY' ? 'Đang chờ cơ sở hoàn tất bàn giao.' : 'Chỉ cơ sở mới có thể xác nhận bàn giao.' },
    { key: 'visit', title: 'Đặt lịch đến kho', state: input.hasVisit ? 'COMPLETED' : eligibleForVisit ? 'CURRENT' : terminal ? 'BLOCKED' : 'PENDING', detail: input.hasVisit ? 'Lịch đến kho đã được xác nhận.' : eligibleForVisit ? 'Đơn thuê đã đủ điều kiện để đặt lịch.' : 'Có thể đặt lịch sau khi đơn đủ điều kiện.' },
    { key: 'inbound', title: 'Nhập hàng', state: input.hasStoredItems ? 'COMPLETED' : input.hasInboundSession && handoverDone ? 'CURRENT' : terminal ? 'BLOCKED' : 'PENDING', detail: input.hasStoredItems ? 'Đã có hàng được ghi nhận trong kho.' : input.hasInboundSession && handoverDone ? 'Phiên nhập hàng hợp lệ đang hoạt động.' : handoverDone ? 'Cần phiên nhập hàng hợp lệ do cơ sở cấp.' : 'Chỉ nhập hàng sau khi đơn được kích hoạt và có phiên hợp lệ.' },
  ] satisfies { key: string; title: string; state: ProgressState; detail: string }[];
}
