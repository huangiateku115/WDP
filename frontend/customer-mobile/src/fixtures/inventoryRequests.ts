import type {Fixtures} from '../domain/models';
import {ownItem} from '../domain/inventory';
import type {InventoryRequest, RequestContext, RequestKind, RequestPolicy} from '../domain/inventoryRequests';
import {inventoryDetails, inventoryRentals} from './inventory';

const ownerId = 'demo-customer';
export const inventoryRequestPolicies: RequestPolicy[] = [
  ...(['INBOUND', 'OUTBOUND'] as const).flatMap(kind => [
    {itemId: 'packaging', ownerId, kind, feature: 'DEMO_AVAILABLE' as const, eligible: true, firstIntakeCompleted: true, reason: 'Kỳ thuê mẫu ACTIVE có điều kiện yêu cầu được cho phép rõ ràng.'},
    {itemId: 'coffee', ownerId, kind, feature: 'DISABLED' as const, eligible: false, firstIntakeCompleted: true, reason: 'Ví dụ tính năng bị khóa; không tự bật theo môi trường Frontend.'},
    {itemId: 'samples', ownerId, kind, feature: 'DEMO_AVAILABLE' as const, eligible: false, firstIntakeCompleted: false, reason: 'Danh mục mới đăng ký, chưa tiếp nhận lần đầu.'},
  ]),
];
const declared = {widthM: '0.4', depthM: '0.3', heightM: '0.2', weightKg: '2'};
const record = (id: string, reference: string, kind: RequestKind, quantity: number): InventoryRequest => ({id, reference, itemId: 'packaging', ownerId, kind, quantity, unit: 'kiện', createdAt: '2026-10-20T02:00:00Z', updatedAt: '2026-10-20T03:00:00Z', status: 'WAITING_DEMO', version: 3, allowAmend: kind === 'INBOUND', allowCancel: true, actionReason: 'Trạng thái mẫu không cho phép thao tác này.', issue: 'NONE', declared: kind === 'INBOUND' ? {...declared} : null, note: 'Thông tin đóng gói minh họa; ghi chú chưa được gửi lên hệ thống.', fulfilledQuantity: null, heldQuantity: null, timeline: [{at: '2026-10-20T02:00:00Z', label: 'Khách hàng chuẩn bị yêu cầu trong dữ liệu mẫu', actor: 'CUSTOMER_DEMO'}]});
export const inventoryRequests: InventoryRequest[] = [
  record('inbound-pending', 'NHAP-MAU-001', 'INBOUND', 12),
  {...record('inbound-completed', 'NHAP-MAU-002', 'INBOUND', 80), status: 'COMPLETED_DEMO', version: 5, allowAmend: false, allowCancel: false, actionReason: 'Yêu cầu mẫu đã hoàn tất, không thể điều chỉnh/hủy.', createdAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T02:00:00Z', timeline: [{at: '2026-10-02T01:00:00Z', label: 'Khách hàng tạo yêu cầu mẫu', actor: 'CUSTOMER_DEMO'}, {at: '2026-10-02T02:00:00Z', label: 'Nhân viên hoàn tất tiếp nhận trong lịch sử mẫu · chỉ đọc', actor: 'STAFF_DEMO'}]},
  {...record('inbound-conflict', 'NHAP-MAU-003', 'INBOUND', 4), issue: 'VERSION_CONFLICT'},
  {...record('inbound-uncertain', 'NHAP-MAU-004', 'INBOUND', 6), issue: 'UNCERTAIN'},
  {...record('inbound-no-version', 'NHAP-MAU-005', 'INBOUND', 2), version: null, issue: 'MISSING_PRECONDITION'},
  {...record('outbound-partial', 'XUAT-MAU-001', 'OUTBOUND', 20), status: 'PARTIAL_DEMO', allowCancel: false, actionReason: 'Yêu cầu đã xử lý một phần trong fixture; không cho hủy tại ví dụ này.', fulfilledQuantity: 8, heldQuantity: 12, timeline: [{at: '2026-10-20T02:00:00Z', label: 'Khách hàng yêu cầu xuất 20 kiện · mẫu', actor: 'CUSTOMER_DEMO'}, {at: '2026-10-20T03:00:00Z', label: 'Nhân viên đã giao 8 kiện, còn giữ 12 kiện · chỉ đọc', actor: 'STAFF_DEMO'}]},
  {...record('outbound-pending', 'XUAT-MAU-002', 'OUTBOUND', 3), heldQuantity: 3},
  {...record('outbound-status-changed', 'XUAT-MAU-003', 'OUTBOUND', 1), issue: 'STATUS_CHANGED'},
  {...record('outbound-network', 'XUAT-MAU-004', 'OUTBOUND', 2), issue: 'NETWORK_UNAVAILABLE'},
  ...Array.from({length: 16}, (_, index): InventoryRequest => ({...record('inbound-archived-' + index, 'NHAP-LUUTRU-MAU-' + (index + 1), 'INBOUND', 2), status: 'CANCELLED_DEMO', version: 2, allowAmend: false, allowCancel: false, actionReason: 'Yêu cầu lịch sử đã đóng trong dữ liệu mẫu.', createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T02:00:00Z`, updatedAt: `2026-09-${String(index + 1).padStart(2, '0')}T03:00:00Z`})),
];
export function requestContext(data: Fixtures, itemId: string | undefined, kind: RequestKind): RequestContext | null {
  const own = ownItem(data, itemId, inventoryDetails);
  if (!own || !data.customer) return null;
  return {...own, ownerId: data.customer.id, rental: inventoryRentals.find(r => r.id === own.detail.rentalId && r.ownerId === data.customer!.id), policy: inventoryRequestPolicies.find(p => p.itemId === itemId && p.ownerId === data.customer!.id && p.kind === kind)};
}
export const scopedRequest = (ownerId: string, itemId: string, id: string | undefined) => inventoryRequests.find(r => r.id === id && r.ownerId === ownerId && r.itemId === itemId);
