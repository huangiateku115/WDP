import {z} from 'zod';
import type {InventoryDetail, InventoryRental} from './inventory';
import {canonicalStock} from './inventory';
import type {InventoryItem} from './models';

export type RequestKind = 'INBOUND' | 'OUTBOUND';
export type RequestIntent = 'CREATE' | 'AMEND' | 'CANCEL';
export type RequestIssue = 'NONE' | 'VERSION_CONFLICT' | 'MISSING_PRECONDITION' | 'STATUS_CHANGED' | 'UNCERTAIN' | 'NETWORK_UNAVAILABLE';
export interface RequestPolicy {
  itemId: string; ownerId: string; kind: RequestKind;
  feature: 'DEMO_AVAILABLE' | 'DISABLED';
  eligible: boolean; firstIntakeCompleted: boolean; reason: string;
}
// These statuses describe fictional UI scenarios, not backend enums.
export type DemoRequestStatus = 'WAITING_DEMO' | 'PROCESSING_DEMO' | 'PARTIAL_DEMO' | 'COMPLETED_DEMO' | 'CANCELLED_DEMO';
export const requestStatusLabels: Record<DemoRequestStatus, string> = {
  WAITING_DEMO: 'Chờ xử lý · mẫu', PROCESSING_DEMO: 'Đang xử lý · mẫu', PARTIAL_DEMO: 'Xử lý một phần · mẫu',
  COMPLETED_DEMO: 'Đã hoàn tất · mẫu', CANCELLED_DEMO: 'Đã hủy · mẫu',
};
export interface InventoryRequest {
  id: string; reference: string; itemId: string; ownerId: string; kind: RequestKind;
  quantity: number; unit: string; createdAt: string; updatedAt: string;
  status: DemoRequestStatus; version: number | null; allowAmend: boolean; allowCancel: boolean;
  actionReason: string; issue: RequestIssue;
  declared: {widthM: string; depthM: string; heightM: string; weightKg: string} | null;
  note: string;
  fulfilledQuantity: number | null; heldQuantity: number | null;
  timeline: {at: string; label: string; actor: 'CUSTOMER_DEMO' | 'STAFF_DEMO'}[];
}
export interface InboundValues {quantity: string; unit: string; widthM: string; depthM: string; heightM: string; weightKg: string; note: string;}
export interface OutboundValues {quantity: string; unit: string; note: string;}
export interface RequestContext {
  ownerId: string; item: InventoryItem; detail: InventoryDetail; rental: InventoryRental | undefined; policy: RequestPolicy | undefined;
}
export const issueMessages: Record<RequestIssue, string> = {
  NONE: '', VERSION_CONFLICT: 'Phiên bản yêu cầu đã thay đổi trong tình huống mẫu. Không dùng bản cũ để xem trước điều chỉnh hoặc hủy.',
  MISSING_PRECONDITION: 'Thiếu thông tin phiên bản cần kiểm tra. Thao tác bị khóa; không tự bỏ điều kiện an toàn.',
  STATUS_CHANGED: 'Trạng thái yêu cầu không còn cho phép thao tác này trong dữ liệu mẫu.',
  UNCERTAIN: 'Kết quả xử lý chưa xác định trong tình huống mẫu. Không xác nhận thành công hoặc tự gửi lại.',
  NETWORK_UNAVAILABLE: 'Tình huống mẫu: không thể xác minh dữ liệu mới. Không gửi lại hoặc thay đổi yêu cầu. Ứng dụng vẫn ngoại tuyến.',
};
export function requestEligibility(context: RequestContext, kind: RequestKind) {
  const {item, detail, rental, policy, ownerId} = context;
  if (!policy || policy.ownerId !== ownerId || policy.itemId !== item.id || policy.kind !== kind || detail.ownerId !== ownerId) return {eligible: false, reason: 'Chưa có điều kiện yêu cầu được xác nhận trong dữ liệu mẫu.'};
  if (policy.feature !== 'DEMO_AVAILABLE') return {eligible: false, reason: kind === 'INBOUND' ? 'Tính năng yêu cầu nhập thêm hiện chưa khả dụng.' : 'Tính năng yêu cầu xuất kho hiện chưa khả dụng.'};
  if (item.status !== 'IN_STORAGE' || !policy.firstIntakeCompleted) return {eligible: false, reason: kind === 'INBOUND' ? 'Hàng chưa hoàn tất tiếp nhận lần đầu; không thể dùng luồng nhập thêm.' : 'Hàng chưa đủ điều kiện yêu cầu xuất trong dữ liệu mẫu.'};
  if (!rental || rental.ownerId !== ownerId) return {eligible: false, reason: 'Chưa có kỳ thuê mẫu thuộc khách hàng hiện tại.'};
  if (rental.stage !== 'ACTIVE') return {eligible: false, reason: 'Kỳ thuê mẫu chưa ở trạng thái cho phép chuẩn bị yêu cầu này.'};
  if (!policy.eligible) return {eligible: false, reason: policy.reason || 'Item hoặc kỳ thuê mẫu chưa đủ điều kiện.'};
  if (kind === 'OUTBOUND') {
    const stock = canonicalStock(item, detail);
    if (!stock.balance) return {eligible: false, reason: 'Chưa có dữ liệu tồn kho đã xác minh; không thể chuẩn bị yêu cầu xuất.'};
    if (stock.balance.available === 0) return {eligible: false, reason: 'Số lượng có thể xuất đã xác minh bằng 0; không thể yêu cầu số dương.'};
  }
  return {eligible: true, reason: 'Chỉ đủ điều kiện thử giao diện theo dữ liệu mẫu; chưa xác minh Backend.'};
}
export function requestActionEligibility(context: RequestContext, request: InventoryRequest | undefined, intent: RequestIntent, kind: RequestKind) {
  const base = requestEligibility(context, kind);
  if (!base.eligible || intent === 'CREATE') return base;
  if (!request || request.ownerId !== context.ownerId || request.itemId !== context.item.id || request.kind !== kind) return {eligible: false, reason: 'Không tìm thấy yêu cầu mẫu thuộc Item hiện tại.'};
  if (request.issue !== 'NONE') return {eligible: false, reason: issueMessages[request.issue]};
  if (!Number.isSafeInteger(request.version) || request.version! <= 0) return {eligible: false, reason: issueMessages.MISSING_PRECONDITION};
  if (intent === 'AMEND' && (kind !== 'INBOUND' || !request.allowAmend) || intent === 'CANCEL' && !request.allowCancel) return {eligible: false, reason: request.actionReason};
  return {eligible: true, reason: 'Chỉ xem trước thay đổi cục bộ; trạng thái yêu cầu gốc giữ nguyên.'};
}
const quantityField = z.string().trim().refine(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0, 'Nhập số lượng nguyên dương hợp lệ.');
const decimalField = z.string().trim().refine(v => /^\d+(?:[.,]\d{1,3})?$/.test(v) && Number.isFinite(Number(v.replace(',', '.'))) && Number(v.replace(',', '.')) > 0, 'Nhập số dương, tối đa 3 chữ số thập phân.');
export function inboundRequestSchema(context: RequestContext) {
  return z.object({quantity: quantityField, unit: z.string().refine(v => v === context.item.unit, 'Đơn vị phải khớp mặt hàng.'), widthM: decimalField, depthM: decimalField, heightM: decimalField, weightKg: decimalField, note: z.string().trim().max(1000, 'Ghi chú tối đa 1.000 ký tự.')})
    .superRefine((_, ctx) => {const check = requestEligibility(context, 'INBOUND'); if (!check.eligible) ctx.addIssue({code: 'custom', path: ['quantity'], message: check.reason});});
}
export function outboundRequestSchema(context: RequestContext) {
  return z.object({quantity: quantityField, unit: z.string().refine(v => v === context.item.unit && v === context.detail.stockUnit, 'Đơn vị phải khớp số dư tồn kho.'), note: z.string().trim().max(1000, 'Ghi chú tối đa 1.000 ký tự.')})
    .superRefine((v, ctx) => {const check = requestEligibility(context, 'OUTBOUND'); if (!check.eligible) ctx.addIssue({code: 'custom', path: ['quantity'], message: check.reason}); const stock = canonicalStock(context.item, context.detail).balance; if (stock && Number(v.quantity) > stock.available) ctx.addIssue({code: 'custom', path: ['quantity'], message: 'Số lượng yêu cầu vượt quá tồn có thể xuất đã xác minh.'});});
}
export function requestFingerprint(context: RequestContext, request?: InventoryRequest) {
  return JSON.stringify({ownerId: context.ownerId, item: context.item, detail: context.detail, rental: context.rental, policy: context.policy, request});
}
export function requestInitialValues(context: RequestContext, kind: RequestKind, request?: InventoryRequest): InboundValues | OutboundValues {
  const basic = {quantity: request ? String(request.quantity) : '', unit: context.item.unit, note: request?.note ?? ''};
  if (kind === 'OUTBOUND') return basic;
  const m = context.detail.declaredMeasurements;
  return {...basic, widthM: request?.declared?.widthM ?? (m?.widthM == null ? '' : String(m.widthM)), depthM: request?.declared?.depthM ?? (m?.depthM == null ? '' : String(m.depthM)), heightM: request?.declared?.heightM ?? (m?.heightM == null ? '' : String(m.heightM)), weightKg: request?.declared?.weightKg ?? (m?.weightKg == null ? '' : String(m.weightKg))};
}
