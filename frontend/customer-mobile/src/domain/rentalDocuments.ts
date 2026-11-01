import type {Fixtures, Service} from './models';

export type PaymentPurpose = 'DEPOSIT' | 'BALANCE';
export type DemoPaymentStatus = 'PENDING_DEMO' | 'CONFIRMED_DEMO' | 'FAILED_DEMO' | 'EXPIRED_DEMO' | 'UNKNOWN_DEMO';
export const paymentLabels: Record<DemoPaymentStatus, string> = {PENDING_DEMO: 'Chờ thanh toán · mẫu', CONFIRMED_DEMO: 'Đã xác nhận · mẫu', FAILED_DEMO: 'Thanh toán thất bại · mẫu', EXPIRED_DEMO: 'Hết hiệu lực · mẫu', UNKNOWN_DEMO: 'Chưa xác định kết quả · mẫu'};
export interface DemoPayment {
  purpose: PaymentPurpose; amount: number; currency: string; status: DemoPaymentStatus;
  recordedAt: string | null; reference: string | null;
}
export interface FinancialSnapshot {
  currency: string; totalRent: number | null; depositRequired: number | null; depositCredited: number | null;
  remainingInitialBalance: number | null; balancePaid: number | null;
  settlement: 'OPEN_DEMO' | 'SETTLED_DEMO' | 'UNKNOWN_DEMO';
  payments: Record<PaymentPurpose, DemoPayment | null>;
}
export interface PartySignature {
  party: 'CUSTOMER' | 'FACILITY'; name: string; roleLabel: string;
  status: 'PENDING_DEMO' | 'RECORDED_DEMO'; signedVersion: number | null;
  documentReference: string | null; recordedAt: string | null;
}
export interface ContractDocument {
  reference: string; version: number; documentReference: string; updatedAt: string | null;
  status: 'DRAFT' | 'PARTIALLY_SIGNED' | 'SIGNED'; legacyReadOnly: boolean;
  customer: PartySignature; facility: PartySignature;
  snapshot: {ownerId: string; rentalId: string; rentalCode: string; service: Service; facilityName: string; customerLabel: string; start: string; end: string; resource: string; capacityLabel: string;
    terms: {totalRent: number; depositRequired: number; depositCredited: number; remainingInitialBalance: number}} | null;
}
export interface RentalDocumentScenario {
  id: string; ownerId: string; rentalId: string; label: string; alternate: boolean; service: Service;
  finance: FinancialSnapshot | null;
  contractAvailability: 'AVAILABLE' | 'DEPOSIT_REQUIRED' | 'INSPECTION_REQUIRED' | 'MISSING' | 'ERROR';
  contract: ContractDocument | null;
  lifecycle: {reservationCreated: boolean; registrationComplete: boolean; inspectionComplete: boolean; firstInboundConfirmed: boolean; handoverComplete: boolean; activatedByStaff: boolean; readyForStaff: boolean};
}
const validMoney = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export type FinanceReview = {valid: false; reason: string} | {valid: true; total: number; required: number; credited: number; initialBalance: number; paid: number; outstanding: number; settled: boolean; settlementUnknown: boolean};
export function reviewFinance(snapshot: FinancialSnapshot | null | undefined): FinanceReview {
  const invalid = (reason: string): FinanceReview => ({valid: false, reason});
  if (!snapshot) return invalid('Chưa có dữ liệu tài chính đầy đủ.');
  const s = snapshot;
  if (s.currency !== 'VND' || ![s.totalRent, s.depositRequired, s.depositCredited, s.remainingInitialBalance, s.balancePaid].every(validMoney)) return invalid('Số tiền hoặc đơn vị tiền không hợp lệ; chỉ hiển thị số nguyên VND không âm.');
  const total = s.totalRent!, required = s.depositRequired!, credited = s.depositCredited!, paid = s.balancePaid!;
  if (required > total || credited > required || credited > total) return invalid('Tiền thuê trả trước không nhất quán với tổng tiền thuê.');
  const initialBalance = Math.max(0, total - credited);
  if (s.remainingInitialBalance !== initialBalance || paid > initialBalance) return invalid('Tổng, tiền cấn trừ và số dư ban đầu không khớp.');
  if (!s.payments || !Object.hasOwn(s.payments, 'DEPOSIT') || !Object.hasOwn(s.payments, 'BALANCE') || !['OPEN_DEMO', 'SETTLED_DEMO', 'UNKNOWN_DEMO'].includes(s.settlement)) return invalid('Thiếu bằng chứng trạng thái thanh toán/tất toán.');
  for (const purpose of ['DEPOSIT', 'BALANCE'] as const) {
    const p = s.payments[purpose];
    if (p && (!validMoney(p.amount) || p.amount === 0 || p.currency !== 'VND' || p.purpose !== purpose || !Object.hasOwn(paymentLabels, p.status))) return invalid('Bản ghi thanh toán không hợp lệ; không tạo yêu cầu 0 VND.');
  }
  const deposit = s.payments.DEPOSIT, balance = s.payments.BALANCE;
  if (deposit && deposit.amount !== required) return invalid('Số tiền của yêu cầu trả trước không khớp số tiền cần trả trước.');
  if (deposit?.status === 'CONFIRMED_DEMO' ? credited !== deposit.amount : credited !== 0) return invalid('Chỉ khoản trả trước đã xác nhận trong dữ liệu mẫu mới được cấn trừ.');
  if (balance && balance.amount > initialBalance) return invalid('Số tiền thanh toán số dư vượt số dư ban đầu.');
  if (balance?.status === 'CONFIRMED_DEMO' ? paid !== balance.amount : paid !== 0) return invalid('Số dư đã trả chưa có bản ghi xác nhận tương ứng.');
  const outstanding = initialBalance - paid;
  const evidence = (credited === 0 || deposit?.status === 'CONFIRMED_DEMO') && (paid === 0 || balance?.status === 'CONFIRMED_DEMO');
  if (s.settlement === 'SETTLED_DEMO' && (outstanding !== 0 || credited < required || !evidence)) return invalid('Trạng thái tất toán không khớp các khoản đã xác nhận.');
  return {valid: true, total, required, credited, initialBalance, paid, outstanding, settled: s.settlement === 'SETTLED_DEMO' && outstanding === 0 && evidence, settlementUnknown: s.settlement !== 'SETTLED_DEMO' && outstanding === 0};
}
export function signatureProgress(document: ContractDocument | null | undefined): {state: 'MISSING' | 'DRAFT' | 'PARTIAL' | 'SIGNED' | 'INVALID'; reason: string} {
  if (!document) return {state: 'MISSING', reason: 'Chưa có tài liệu hợp đồng.'};
  const d = document;
  if (!Number.isSafeInteger(d.version) || d.version <= 0 || !d.documentReference || !d.customer || !d.facility || d.customer.party !== 'CUSTOMER' || d.facility.party !== 'FACILITY' || !['DRAFT', 'PARTIALLY_SIGNED', 'SIGNED'].includes(d.status)) return {state: 'INVALID', reason: 'Thiếu hoặc không nhất quán phiên bản và thông tin hai bên.'};
  const signatures = [d.customer, d.facility];
  if (signatures.some(s => !['PENDING_DEMO', 'RECORDED_DEMO'].includes(s.status))) return {state: 'INVALID', reason: 'Chưa xác định trạng thái chữ ký minh họa.'};
  if (signatures.some(s => s.status === 'RECORDED_DEMO' && (s.signedVersion !== d.version || s.documentReference !== d.documentReference))) return {state: 'INVALID', reason: 'Chữ ký được ghi nhận trên phiên bản hoặc nội dung khác. Không coi là hợp đồng đã ký đủ.'};
  const signed = signatures.filter(s => s.status === 'RECORDED_DEMO').length;
  if (d.status === 'SIGNED' && signed !== 2) return {state: 'INVALID', reason: 'Trạng thái hợp đồng không khớp bằng chứng hai bên trong dữ liệu mẫu.'};
  if (signed === 2) return d.status === 'SIGNED' ? {state: 'SIGNED', reason: 'Hai bên đã ký cùng phiên bản · dữ liệu minh họa'} : {state: 'INVALID', reason: 'Cần xác minh trạng thái hợp đồng; không tự nâng trạng thái từ chữ ký.'};
  if (signed === 1) return {state: 'PARTIAL', reason: d.customer.status === 'RECORDED_DEMO' ? 'Khách hàng đã ký · chờ đại diện cơ sở (mẫu)' : 'Đại diện cơ sở đã ký · chờ khách hàng (mẫu)'};
  return {state: 'DRAFT', reason: 'Bản nháp · chưa có chữ ký được ghi nhận'};
}
export function contractAvailabilityReason(scenario: RentalDocumentScenario) {
  if (scenario.contractAvailability === 'ERROR') return 'Tình huống mẫu: chưa thể hiển thị tài liệu. Không có yêu cầu mạng hoặc bản hợp đồng thay thế được tạo.';
  const finance = reviewFinance(scenario.finance);
  if (!finance.valid) return 'Chưa đủ dữ liệu tài chính nhất quán để xem tài liệu hợp đồng.';
  if (scenario.contractAvailability === 'DEPOSIT_REQUIRED' || finance.credited < finance.required) return 'Tiền thuê trả trước chưa được xác nhận; hợp đồng chưa khả dụng.';
  if (scenario.contractAvailability === 'INSPECTION_REQUIRED' || !scenario.lifecycle?.inspectionComplete) return 'Chưa hoàn tất kiểm tra hoặc tiếp nhận thực tế; chưa có hợp đồng để xem.';
  if (scenario.contractAvailability !== 'AVAILABLE' || !scenario.contract) return 'Chưa có tài liệu hợp đồng trong dữ liệu mẫu.';
  const snapshot = scenario.contract.snapshot;
  if (!snapshot || snapshot.ownerId !== scenario.ownerId || snapshot.rentalId !== scenario.rentalId || snapshot.service !== scenario.service || !snapshot.terms) return 'Ảnh chụp nội dung hợp đồng thiếu hoặc không khớp kỳ thuê; không tạo nội dung thay thế.';
  if (snapshot.terms.totalRent !== finance.total || snapshot.terms.depositRequired !== finance.required || snapshot.terms.depositCredited !== finance.credited || snapshot.terms.remainingInitialBalance !== finance.initialBalance) return 'Điều khoản tài chính của tài liệu không khớp ảnh chụp dữ liệu; cần kiểm tra phiên bản.';
  return null;
}
export function paymentPresentation(scenario: RentalDocumentScenario, purpose: PaymentPurpose) {
  const finance = reviewFinance(scenario.finance);
  if (!finance.valid) return {label: 'Chưa thể hiển thị thanh toán', amount: null, reason: finance.reason, record: null};
  const record = scenario.finance!.payments[purpose];
  if (purpose === 'BALANCE' && finance.initialBalance === 0) return {label: finance.settled ? 'Không cần thanh toán thêm · mẫu' : 'Chờ xác minh tất toán', amount: null, reason: 'Không tạo yêu cầu thanh toán 0 VND.', record: null};
  if (!record) return {label: 'Chưa có yêu cầu thanh toán', amount: null, reason: 'Thông tin thanh toán sẽ hiển thị khi kết nối hệ thống.', record: null};
  return {label: paymentLabels[record.status], amount: record.amount, reason: record.status === 'UNKNOWN_DEMO' ? 'Chưa xác định kết quả; không tự ghi nhận thành công hoặc đối soát.' : 'Trạng thái chỉ đọc từ dữ liệu minh họa, không phải giao dịch thật.', record};
}
export function ownedRentalScenario(data: Fixtures, rentalId: string | undefined, scenarios: readonly RentalDocumentScenario[], scenarioId?: string) {
  if (!data.customer || typeof rentalId !== 'string') return null;
  const rental = data.rentals.find(r => r.id === rentalId);
  const scenario = scenarios.find(s => s.rentalId === rentalId && s.ownerId === data.customer!.id && (scenarioId ? s.id === scenarioId : !s.alternate));
  return rental && scenario && rental.service === scenario.service ? {rental, scenario} : null;
}
