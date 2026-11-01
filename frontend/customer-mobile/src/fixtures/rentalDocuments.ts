import type {ContractDocument, DemoPayment, DemoPaymentStatus, FinancialSnapshot, PartySignature, RentalDocumentScenario} from '../domain/rentalDocuments';
import {rentalFacts} from './booking';
import {customerFixtures} from './customer';

const ownerId = 'demo-customer';
const payment = (purpose: 'DEPOSIT' | 'BALANCE', amount: number, status: DemoPaymentStatus): DemoPayment => ({purpose, amount, currency: 'VND', status, recordedAt: status === 'CONFIRMED_DEMO' ? purpose === 'DEPOSIT' ? '2026-09-30T03:00:00Z' : '2026-10-01T03:00:00Z' : null, reference: null});
const signature = (party: 'CUSTOMER' | 'FACILITY', signed: boolean, reference: string, version = 1): PartySignature => ({party, name: party === 'CUSTOMER' ? 'Khách hàng bản mẫu' : 'Đại diện kho bản mẫu', roleLabel: party === 'CUSTOMER' ? 'Bên thuê minh họa' : 'Đại diện cơ sở được chỉ định trong mẫu', status: signed ? 'RECORDED_DEMO' : 'PENDING_DEMO', signedVersion: signed ? version : null, documentReference: signed ? reference : null, recordedAt: signed ? '2026-10-01T02:00:00Z' : null});
function document(reference: string, status: ContractDocument['status'], customer: boolean, facility: boolean): ContractDocument {
  const documentReference = reference + '-NOI-DUNG-V1';
  return {reference, version: 1, documentReference, status, legacyReadOnly: false, updatedAt: '2026-10-01T01:00:00Z', customer: signature('CUSTOMER', customer, documentReference), facility: signature('FACILITY', facility, documentReference), snapshot: null};
}
function originalFinance(id: string, required: number, depositStatus: DemoPaymentStatus, balanceStatus: DemoPaymentStatus | null, settlement: FinancialSnapshot['settlement']): FinancialSnapshot {
  const f = rentalFacts[id]!;
  return {currency: 'VND', totalRent: f.total, depositRequired: required, depositCredited: f.depositCredited, remainingInitialBalance: f.total - f.depositCredited, balancePaid: f.balancePaid, settlement, payments: {
    DEPOSIT: payment('DEPOSIT', required, depositStatus),
    BALANCE: balanceStatus ? payment('BALANCE', f.balancePaid, balanceStatus) : null,
  }};
}
const south: RentalDocumentScenario = {
  id: 'south-original', ownerId, rentalId: 'rental-south', service: 'SELF_STORAGE', label: 'Hồ sơ mẫu của kỳ thuê', alternate: false,
  finance: originalFinance('rental-south', 1850000, 'CONFIRMED_DEMO', 'CONFIRMED_DEMO', 'SETTLED_DEMO'), contractAvailability: 'AVAILABLE', contract: document('HD-MAU-SELF-001', 'SIGNED', true, true),
  lifecycle: {reservationCreated: true, registrationComplete: false, inspectionComplete: true, firstInboundConfirmed: false, handoverComplete: true, activatedByStaff: true, readyForStaff: true},
};
const east: RentalDocumentScenario = {
  id: 'east-original', ownerId, rentalId: 'rental-east', service: 'MANAGED_INVENTORY', label: 'Hồ sơ mẫu: đang chờ tiền thuê trả trước', alternate: false,
  finance: originalFinance('rental-east', 960000, 'PENDING_DEMO', null, 'OPEN_DEMO'), contractAvailability: 'DEPOSIT_REQUIRED', contract: null,
  lifecycle: {reservationCreated: true, registrationComplete: false, inspectionComplete: false, firstInboundConfirmed: false, handoverComplete: false, activatedByStaff: false, readyForStaff: false},
};
const history: RentalDocumentScenario = {
  id: 'history-original', ownerId, rentalId: 'rental-history', service: 'SELF_STORAGE', label: 'Hồ sơ lịch sử · chỉ đọc', alternate: false,
  finance: originalFinance('rental-history', 850000, 'CONFIRMED_DEMO', 'CONFIRMED_DEMO', 'SETTLED_DEMO'), contractAvailability: 'AVAILABLE', contract: {...document('HD-MAU-LICHSU-003', 'SIGNED', true, true), legacyReadOnly: true},
  lifecycle: {...south.lifecycle},
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function eastExample(id: string, label: string, edit: (example: RentalDocumentScenario) => void) {
  const example = clone(east); example.id = id; example.label = label; example.alternate = true; edit(example); return example;
}
function confirmedDeposit(s: RentalDocumentScenario) {
  s.finance!.depositCredited = 960000; s.finance!.remainingInitialBalance = 1920000;
  s.finance!.payments.DEPOSIT = payment('DEPOSIT', 960000, 'CONFIRMED_DEMO');
}
function readyDocument(s: RentalDocumentScenario, status: ContractDocument['status'] = 'DRAFT', customer = false, facility = false) {
  confirmedDeposit(s); s.lifecycle.registrationComplete = true; s.lifecycle.inspectionComplete = true;
  s.contractAvailability = 'AVAILABLE'; s.contract = document('HD-MAU-KYGUI-002', status, customer, facility);
}
history.finance!.payments.DEPOSIT!.recordedAt = '2026-05-31T03:00:00Z';
history.finance!.payments.BALANCE!.recordedAt = '2026-06-01T03:00:00Z';
history.contract!.updatedAt = '2026-06-01T01:00:00Z';
history.contract!.customer.recordedAt = history.contract!.facility.recordedAt = '2026-06-01T02:00:00Z';
const examples = [
  eastExample('east-inspection', 'Đã trả trước · chưa kiểm tra thực tế', s => {confirmedDeposit(s); s.contractAvailability = 'INSPECTION_REQUIRED';}),
  eastExample('east-draft', 'Tài liệu sẵn sàng đọc · hai bên chờ ký', s => readyDocument(s)),
  eastExample('east-partial', 'Khách hàng đã ký · chờ đại diện kho', s => readyDocument(s, 'PARTIALLY_SIGNED', true, false)),
  eastExample('east-signed', 'Hai bên cùng phiên bản · chưa thanh toán số dư', s => {readyDocument(s, 'SIGNED', true, true); s.finance!.payments.BALANCE = payment('BALANCE', 1920000, 'PENDING_DEMO');}),
  eastExample('east-mismatch', 'Chữ ký khác phiên bản', s => {readyDocument(s, 'SIGNED', true, true); s.contract!.facility.signedVersion = 2;}),
  eastExample('east-stale', 'Tài liệu mới · chữ ký phiên bản cũ', s => {readyDocument(s, 'SIGNED', true, true); s.contract!.version = 2; s.contract!.documentReference = 'NOI-DUNG-MAU-MOI-V2';}),
  eastExample('east-content-mismatch', 'Tham chiếu nội dung không khớp', s => {readyDocument(s, 'SIGNED', true, true); s.contract!.customer.documentReference = 'NOI-DUNG-MAU-CU';}),
  eastExample('east-contract-error', 'Tài liệu chưa thể hiển thị', s => {confirmedDeposit(s); s.lifecycle.inspectionComplete = true; s.contractAvailability = 'ERROR';}),
  eastExample('east-no-contract', 'Thiếu tài liệu dù đã kiểm tra', s => {confirmedDeposit(s); s.lifecycle.inspectionComplete = true; s.contractAvailability = 'MISSING';}),
  eastExample('east-no-payment', 'Chưa có yêu cầu thanh toán', s => {s.finance!.payments.DEPOSIT = null;}),
  eastExample('east-failed', 'Tiền thuê trả trước thất bại', s => {s.finance!.payments.DEPOSIT = payment('DEPOSIT', 960000, 'FAILED_DEMO');}),
  eastExample('east-expired', 'Yêu cầu trả trước hết hiệu lực', s => {s.finance!.payments.DEPOSIT = payment('DEPOSIT', 960000, 'EXPIRED_DEMO');}),
  eastExample('east-unknown', 'Kết quả thanh toán chưa xác định', s => {s.finance!.payments.DEPOSIT = payment('DEPOSIT', 960000, 'UNKNOWN_DEMO'); s.finance!.settlement = 'UNKNOWN_DEMO';}),
  eastExample('east-settled', 'Đã trả đủ kỳ đầu · nhân viên chưa kích hoạt', s => {readyDocument(s, 'SIGNED', true, true); s.finance!.balancePaid = 1920000; s.finance!.settlement = 'SETTLED_DEMO'; s.finance!.payments.BALANCE = payment('BALANCE', 1920000, 'CONFIRMED_DEMO');}),
  eastExample('east-zero-balance', 'Đã cấn trừ đủ tổng thuê · không tạo thanh toán 0', s => {confirmedDeposit(s); s.finance!.totalRent = 960000; s.finance!.remainingInitialBalance = 0; s.finance!.settlement = 'SETTLED_DEMO'; s.finance!.payments.BALANCE = null;}),
  eastExample('east-missing-finance', 'Thiếu dữ liệu tài chính', s => {s.finance = null;}),
  eastExample('east-inconsistent', 'Dữ liệu cấn trừ mâu thuẫn', s => {s.finance!.depositCredited = 960000; s.finance!.remainingInitialBalance = 1920000; s.finance!.payments.DEPOSIT = payment('DEPOSIT', 960000, 'FAILED_DEMO');}),
];
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {Object.freeze(value); Object.values(value).forEach(freeze);}
  return value;
}
const allScenarios = [south, east, history, ...examples];
for (const s of allScenarios) {
  const r = customerFixtures.rentals.find(r => r.id === s.rentalId), f = s.finance;
  if (s.contract && r && f) s.contract.snapshot = {ownerId: s.ownerId, rentalId: r.id, rentalCode: r.code, service: r.service,
    facilityName: customerFixtures.facilities.find(f => f.id === r.facilityId)?.name ?? 'Cơ sở bản mẫu', customerLabel: 'Khách hàng bản mẫu',
    start: r.start, end: r.end, resource: r.unit, capacityLabel: r.capacityLabel,
    terms: {totalRent: f.totalRent!, depositRequired: f.depositRequired!, depositCredited: f.depositCredited!, remainingInitialBalance: f.remainingInitialBalance!}};
}
// All signed/paid examples exist at load time. UI actions never create evidence.
// Document references are plain fixture labels, not hashes/certificates.
export const rentalDocumentScenarios: readonly RentalDocumentScenario[] = freeze(allScenarios);
