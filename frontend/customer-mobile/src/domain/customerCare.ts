import type {Href} from 'expo-router';
import type {Fixtures} from './models';
import {ownItem, type InventoryDetail, type InventoryRental} from './inventory';
import type {InventoryRequest} from './inventoryRequests';
import {ownedRentalScenario, type RentalDocumentScenario} from './rentalDocuments';

// Presentation-only categories/statuses; not verified Backend enums.
export const notificationCategories = {
  RESERVATION: 'Kỳ thuê', PAYMENT: 'Thanh toán', CONTRACT: 'Hợp đồng', INTAKE: 'Tiếp nhận',
  INBOUND: 'Nhập kho', OUTBOUND: 'Xuất kho', EXPIRY: 'Thời hạn thuê', SUPPORT: 'Hỗ trợ', SYSTEM: 'Hệ thống',
} as const;
export interface CareDestination {kind: string; rentalId?: string; itemId?: string; requestId?: string; purpose?: string;}
export interface CustomerNotification {
  id: string; ownerId: string; title?: string | null; message?: string | null; category?: string | null;
  createdAt?: string | null; read?: boolean; destination?: CareDestination | null; metadata?: {note?: string} | null;
}
export const supportCategories = ['Vấn đề kỳ thuê', 'Truy cập kho tự quản', 'Thanh toán', 'Hàng hóa ký gửi', 'Vị trí lưu kho', 'Khác'] as const;
export const supportStatuses = {OPEN_DEMO: 'Mới tiếp nhận · mẫu', PROCESSING_DEMO: 'Đang xử lý · mẫu', RESOLVED_DEMO: 'Đã giải đáp · mẫu', CLOSED_DEMO: 'Đã đóng · mẫu'} as const;
export interface SupportMessage {id: string; author: 'CUSTOMER_DEMO' | 'SUPPORT_DEMO'; body: string; at: string | null;}
export interface CustomerSupportRequest {
  id: string; reference: string; ownerId: string; category: string; subject: string; description: string;
  rentalId?: string | null; itemId?: string | null; status: string; createdAt: string | null; updatedAt: string | null;
  messages: readonly SupportMessage[]; resolution?: string | null;
}
export interface CareContext {
  data: Fixtures; details: InventoryDetail[]; inventoryRentals: InventoryRental[]; requests: InventoryRequest[];
  rentalScenarios: readonly RentalDocumentScenario[]; supportRequests: readonly CustomerSupportRequest[];
}
export const notificationCategory = (category: string | null | undefined) => category && Object.hasOwn(notificationCategories, category) ? notificationCategories[category as keyof typeof notificationCategories] : 'Thông tin khác';
export const supportStatus = (status: string) => Object.hasOwn(supportStatuses, status) ? supportStatuses[status as keyof typeof supportStatuses] : 'Trạng thái chưa xác định';
export const notificationTitle = (n: CustomerNotification) => n.title?.trim() || 'Thông báo chưa có tiêu đề';
export const notificationMessage = (n: CustomerNotification) => n.message?.trim() || 'Chưa có nội dung chi tiết trong dữ liệu mẫu.';
export const isNotificationRead = (n: CustomerNotification, overrides: Record<string, boolean> = {}) => overrides[n.id] ?? n.read === true;
export function ownNotifications(rows: readonly CustomerNotification[], ownerId: string | undefined) {
  const time = (n: CustomerNotification) => n.createdAt && Number.isFinite(Date.parse(n.createdAt)) ? Date.parse(n.createdAt) : -Infinity;
  return ownerId ? rows.filter(n => n.ownerId === ownerId && typeof n.id === 'string' && !!n.id).slice().sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id)) : [];
}
export function notificationDate(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'}).format(new Date(value)) : 'Chưa có ngày hợp lệ';
}
export function ownSupportRequest(ctx: CareContext, id: string | undefined) {
  return typeof id === 'string' && ctx.data.customer ? ctx.supportRequests.find(r => r.id === id && r.ownerId === ctx.data.customer!.id) : undefined;
}
export function ownedSupportRentals(ctx: CareContext) {
  const ownerId = ctx.data.customer?.id;
  if (!ownerId) return [];
  const myRentals = ctx.data.rentals.filter(r => ownedRentalScenario(ctx.data, r.id, ctx.rentalScenarios)).map(r => ({id: r.id, label: r.code, detailAvailable: true}));
  // Inventory form rental contexts are separate existing fixtures, not new My Rentals.
  return [...myRentals, ...ctx.inventoryRentals.filter(r => r.ownerId === ownerId && !myRentals.some(m => m.id === r.id)).map(r => ({id: r.id, label: r.code + ' · ngữ cảnh hàng hóa', detailAvailable: false}))];
}
export function ownedSupportItems(ctx: CareContext) {
  return ctx.data.items.flatMap(item => {const record = ownItem(ctx.data, item.id, ctx.details); return record ? [{id: item.id, label: item.code, rentalId: record.detail.rentalId}] : [];});
}
export function supportSourceBinding(ctx: CareContext) {
  return JSON.stringify({ownerId: ctx.data.customer?.id, rentals: ownedSupportRentals(ctx), items: ownedSupportItems(ctx)});
}
export function resolveNotificationTarget(ctx: CareContext, n: CustomerNotification): Href | null {
  if (!ctx.data.customer || n.ownerId !== ctx.data.customer.id || !n.id || !n.destination) return null;
  const d = n.destination;
  const rental = typeof d.rentalId === 'string' ? ownedRentalScenario(ctx.data, d.rentalId, ctx.rentalScenarios) : null;
  const item = typeof d.itemId === 'string' ? ownItem(ctx.data, d.itemId, ctx.details) : null;
  switch (d.kind) {
    case 'RENTAL': return rental ? {pathname: '/preview/[kind]/[id]', params: {kind: 'rental', id: rental.rental.id}} : null;
    case 'CONTRACT': return rental ? {pathname: '/rentals/[id]/contract', params: {id: rental.rental.id}} : null;
    case 'PAYMENT': return rental && (d.purpose === 'DEPOSIT' || d.purpose === 'BALANCE') ? {pathname: '/rentals/[id]/payment', params: {id: rental.rental.id, purpose: d.purpose}} : null;
    case 'ITEM': return item ? {pathname: '/preview/[kind]/[id]', params: {kind: 'item', id: item.item.id}} : null;
    case 'REQUEST': {
      const request = item && typeof d.requestId === 'string' && ctx.requests.find(r => r.id === d.requestId && r.itemId === item.item.id && r.ownerId === ctx.data.customer!.id);
      return request ? {pathname: '/inventory/[id]/requests/[requestId]', params: {id: item.item.id, requestId: request.id}} : null;
    }
    case 'SUPPORT': {const request = ownSupportRequest(ctx, d.requestId); return request ? {pathname: '/support/[requestId]', params: {requestId: request.id}} : null;}
    default: return null;
  }
}
