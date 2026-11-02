import type {CareContext, CustomerNotification, CustomerSupportRequest} from '../domain/customerCare';
import type {Fixtures} from '../domain/models';
import {inventoryDetails, inventoryRentals} from './inventory';
import {inventoryRequests} from './inventoryRequests';
import {rentalDocumentScenarios} from './rentalDocuments';

const ownerId = 'demo-customer';
const notifications: CustomerNotification[] = [
  {id: 'notice-reservation', ownerId, title: 'Cập nhật kỳ thuê ký gửi', message: 'MIR-MAU-002 đang giữ chỗ trong dữ liệu mẫu. Xem các bước tiếp theo của kỳ thuê.', category: 'RESERVATION', createdAt: '2026-10-30T08:00:00Z', read: false, destination: {kind: 'RENTAL', rentalId: 'rental-east'}},
  {id: 'notice-deposit', ownerId, title: 'Khoản trả trước đã xác nhận · ví dụ', message: 'Hồ sơ kho tự quản có khoản trả trước được cấn trừ trong fixture. Không phải thông báo giao dịch thật.', category: 'PAYMENT', createdAt: '2026-10-30T07:00:00Z', read: false, destination: {kind: 'PAYMENT', rentalId: 'rental-south', purpose: 'DEPOSIT'}},
  {id: 'notice-contract', ownerId, title: 'Theo dõi bước xem hợp đồng', message: 'Chỉ xem hợp đồng khi đủ dữ kiện trả trước và kiểm tra. Thông báo không tự mở quyền ký.', category: 'CONTRACT', createdAt: '2026-10-30T06:00:00Z', read: false, destination: {kind: 'CONTRACT', rentalId: 'rental-east'}},
  {id: 'notice-balance', ownerId, title: 'Theo dõi số dư kỳ đầu', message: 'Xem trạng thái số dư và bằng chứng cấn trừ trong hồ sơ mẫu; không có yêu cầu chuyển tiền.', category: 'PAYMENT', createdAt: '2026-10-29T08:00:00Z', read: false, destination: {kind: 'PAYMENT', rentalId: 'rental-east', purpose: 'BALANCE'}},
  {id: 'notice-inventory', ownerId, title: 'Lịch sử hàng hóa có cập nhật mẫu', message: 'Hộp giấy Kraft có sự kiện xuất kho trong lịch sử minh họa. Tồn kho gốc giữ nguyên.', category: 'OUTBOUND', createdAt: '2026-10-29T07:00:00Z', read: true, destination: {kind: 'ITEM', itemId: 'packaging'}},
  {id: 'notice-inbound', ownerId, title: 'Yêu cầu nhập thêm đang chờ · mẫu', message: 'Có thể xem bản ghi NHAP-MAU-001, không phải lệnh mới được gửi từ ứng dụng.', category: 'INBOUND', createdAt: '2026-10-29T06:00:00Z', read: false, destination: {kind: 'REQUEST', itemId: 'packaging', requestId: 'inbound-pending'}},
  {id: 'notice-outbound', ownerId, title: 'Yêu cầu xuất được xử lý một phần · mẫu', message: 'XUAT-MAU-001 có lịch sử xử lý một phần để đánh giá giao diện.', category: 'OUTBOUND', createdAt: '2026-10-28T06:00:00Z', read: false, destination: {kind: 'REQUEST', itemId: 'packaging', requestId: 'outbound-partial'}},
  {id: 'notice-expiry', ownerId, title: 'Xem lại thời hạn thuê', message: 'Kiểm tra khoảng thời gian đã lưu trong kỳ thuê. Không tự gia hạn hoặc đặt hạn thanh toán.', category: 'EXPIRY', createdAt: '2026-10-28T05:00:00Z', read: true, destination: {kind: 'RENTAL', rentalId: 'rental-south'}},
  {id: 'notice-support', ownerId, title: 'Phản hồi hỗ trợ minh họa', message: 'Yêu cầu HT-MAU-002 có hội thoại dựng sẵn, chỉ đọc trong chế độ ngoại tuyến.', category: 'SUPPORT', createdAt: '2026-10-27T05:00:00Z', read: false, destination: {kind: 'SUPPORT', requestId: 'support-progress'}},
  {id: 'notice-missing', ownerId, title: 'Tài nguyên mẫu không còn sẵn', message: 'Ví dụ kiểm tra liên kết đã thiếu tài nguyên. Ứng dụng sẽ không chuyển sang hồ sơ khác.', category: 'INTAKE', createdAt: '2026-10-26T05:00:00Z', read: false, destination: {kind: 'ITEM', itemId: 'missing-item'}},
  {id: 'notice-unknown', ownerId, title: 'Thông tin bổ sung', message: 'Loại thông báo chưa được ánh xạ. Không suy diễn hành động hoặc đường dẫn.', category: 'FUTURE_DEMO', createdAt: '2026-10-25T05:00:00Z', read: true, destination: {kind: 'UNKNOWN'}},
  {id: 'notice-incomplete', ownerId, category: 'SYSTEM', createdAt: null, read: false, metadata: null},
];
const base = (id: string, reference: string, subject: string): CustomerSupportRequest => ({id, reference, ownerId, category: 'Vấn đề kỳ thuê', subject, description: 'Nội dung yêu cầu hỗ trợ minh họa có sẵn, không được tạo hoặc gửi từ màn hình này.', status: 'OPEN_DEMO', createdAt: '2026-10-20T02:00:00Z', updatedAt: '2026-10-29T03:00:00Z', messages: [], resolution: null});
const requests: CustomerSupportRequest[] = [
  {...base('support-open', 'HT-MAU-001', 'Cần hiểu các bước bàn giao kho'), rentalId: 'rental-south', category: 'Truy cập kho tự quản'},
  {...base('support-progress', 'HT-MAU-002', 'Cách xem thông tin lô hàng ký gửi'), category: 'Hàng hóa ký gửi', rentalId: 'inventory-active', itemId: 'packaging', status: 'PROCESSING_DEMO', messages: Array.from({length: 28}, (_, i) => ({id: 'message-demo-' + i, author: i % 2 ? 'SUPPORT_DEMO' as const : 'CUSTOMER_DEMO' as const, body: i % 2 ? 'Phản hồi dựng sẵn: bạn có thể xem thông tin lô và lịch sử tại Chi tiết hàng hóa. Đây là cuộc trao đổi mẫu, không có người trực tuyến hoặc phản hồi mới.' : 'Câu hỏi minh họa: tôi muốn hiểu cách đọc lịch sử lô, ô lưu trữ và trạng thái hàng trên giao diện khách hàng.', at: '2026-10-29T' + String(2 + Math.floor(i / 6)).padStart(2, '0') + ':' + String(i % 6 * 10).padStart(2, '0') + ':00Z'}))},
  {...base('support-resolved', 'HT-MAU-003', 'Giải thích khoản tiền thuê trả trước'), category: 'Thanh toán', rentalId: 'rental-south', status: 'RESOLVED_DEMO', resolution: 'Giải đáp mẫu: tiền thuê trả trước được cấn trừ tổng thuê. Không khẳng định quyền hoàn tiền hoặc tình trạng giao dịch thật.', messages: [{id: 'resolved-example', author: 'SUPPORT_DEMO', body: 'Hội thoại dựng sẵn để xem cách trình bày giải đáp; không có thao tác gửi phản hồi.', at: '2026-10-23T03:00:00Z'}]},
  {...base('support-closed', 'HT-MAU-004', 'Xem lại hồ sơ kỳ thuê cũ'), rentalId: 'rental-history', status: 'CLOSED_DEMO', resolution: 'Phiếu lịch sử minh họa đã đóng, chỉ xem.'},
  {...base('support-missing', 'HT-MAU-005', 'Tham chiếu vị trí chưa khả dụng'), category: 'Vị trí lưu kho', itemId: 'missing-item', rentalId: 'missing-rental'},
  {...base('support-unknown', 'HT-MAU-006', 'Trạng thái hỗ trợ chưa xác định'), category: 'Khác', status: 'UNAVAILABLE_DEMO'},
];
function freeze<T>(value: T): T {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;}
export const customerNotifications: readonly CustomerNotification[] = freeze(notifications);
export const customerSupportRequests: readonly CustomerSupportRequest[] = freeze(requests);
export const careContext = (data: Fixtures): CareContext => ({data, details: inventoryDetails, inventoryRentals, requests: inventoryRequests, rentalScenarios: rentalDocumentScenarios, supportRequests: customerSupportRequests});
