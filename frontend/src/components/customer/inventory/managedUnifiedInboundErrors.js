const messages = {
  RENTAL_NOT_ACTIVE: 'Đơn thuê chưa trong thời hạn sử dụng hoặc chưa hoàn tất bàn giao.',
  CONTRACT_NOT_SIGNED: 'Hợp đồng hiện hành cần chữ ký của bạn và đại diện cơ sở trước khi nhập kho.',
  ACCESS_SESSION_SCOPE_INVALID: 'Phiên đến kho không hợp lệ, đã hết hạn hoặc không bao gồm ô kệ đã chọn.',
  ACCESS_SESSION_EXPIRED: 'Phiên đến kho đã hết hạn. Hãy liên hệ nhân viên để được hỗ trợ.',
  CELL_NOT_ALLOCATED: 'Có ô kệ không thuộc đơn thuê này.',
  ITEM_SPECIFICATION_NOT_FOUND: 'Một loại hàng không thuộc SKU hoặc không còn hoạt động.',
  CELL_CAPACITY_UNKNOWN: 'Sức chứa của ô kệ chưa được xác minh. Vui lòng liên hệ cơ sở.',
  CAPACITY_UNKNOWN: 'Sức chứa kho chưa được xác minh. Vui lòng liên hệ cơ sở.',
  CAPACITY_EXCEEDED: 'Khối lượng hoặc thể tích hàng vượt sức chứa.',
  LEVEL_CAPACITY_EXCEEDED: 'Khối lượng hàng vượt giới hạn của tầng kệ.',
  RESERVATION_CAPACITY_EXCEEDED: 'Dung lượng còn lại của đơn thuê không đủ.',
  STALE_SKU_REVISION: 'Thông tin SKU đã thay đổi. Hãy tải lại và xem trước phiếu mới.',
  STALE_ITEM_SPECIFICATION: 'Thông tin loại hàng đã thay đổi. Hãy tải lại và xem trước phiếu mới.',
  ITEM_SPECIFICATION_STALE: 'Phiên bản loại hàng đã thay đổi. Thông tin đã được làm mới; hãy xem trước phiếu nhập lại.',
  STALE_CELL_CAPACITY: 'Sức chứa ô kệ vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',
  STALE_RACK_CAPACITY: 'Sức chứa kệ vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',
  STALE_RESERVATION_CAPACITY: 'Dung lượng đơn thuê vừa thay đổi. Hãy tải lại và xem trước phiếu mới.',
  CELL_ALLOCATION_CHANGED: 'Phân bổ ô kệ vừa thay đổi. Hãy tải lại trước khi xác nhận.',
  IDEMPOTENCY_CONFLICT: 'Mã yêu cầu đã được dùng cho nội dung khác. Không tạo phiếu mới; hãy liên hệ hỗ trợ.',
  IDEMPOTENCY_KEY_REQUIRED: 'Không tạo được mã đối soát an toàn cho phiếu. Hãy tải lại trang rồi thử lại.',
  OUTCOME_UNKNOWN: 'Chưa xác định được kết quả ghi phiếu. Dùng chức năng đối soát; không tạo phiếu khác.',
  INBOUND_COMMIT_UNKNOWN: 'Chưa xác định được kết quả ghi phiếu. Dùng chức năng đối soát; không tạo phiếu khác.',
  TRANSACTIONS_UNAVAILABLE: 'Cơ sở dữ liệu không hỗ trợ giao dịch an toàn nên phiếu chưa được ghi.',
  INVALID_INPUT: 'Một số thông tin chưa hợp lệ. Kiểm tra các trường được đánh dấu rồi thử lại.',
  INVALID_MEASUREMENTS: 'Số lượng hoặc số đo không hợp lệ. Kiểm tra thông tin từng dòng hàng.',
  INVALID_INSTANCE_ALLOCATION: 'Phân bổ khối lượng hoặc thể tích giữa các ô kệ chưa chính xác.',
  ITEM_DOES_NOT_FIT: 'Kích thước mặt hàng không phù hợp với ô kệ đã chọn.',
  CAPACITY_RECONCILIATION_UNKNOWN: 'Tồn kho hoặc sức chứa chưa đối soát được. Vui lòng liên hệ cơ sở.',
  LEGACY_STOCK_UNRECONCILED: 'Khu vực kho hoặc đơn thuê này còn lịch sử tồn kho cũ chưa được đối soát. Vui lòng liên hệ cơ sở để kiểm tra.',
  LEGACY_STOCK_SCOPE_UNKNOWN: 'Chưa xác định được phạm vi tồn kho cũ có thể ảnh hưởng đến khu vực này. Phiếu chưa được tạo; vui lòng liên hệ cơ sở.',
  CELL_STOCK_RECONCILIATION_UNKNOWN: 'Tồn theo ô kệ chưa khớp với sổ giao dịch. Vui lòng liên hệ cơ sở để đối soát.',
  CELL_COUNTER_RECONCILIATION_UNKNOWN: 'Sức chứa đang sử dụng của ô kệ chưa khớp với tồn kho đã ghi nhận.',
  RESERVATION_COUNTER_RECONCILIATION_UNKNOWN: 'Dung lượng đã sử dụng của đơn thuê chưa khớp với tồn kho đã ghi nhận.',
};

export function managedUnifiedInboundErrorMessage(error, fallback = 'Không thể hoàn tất thao tác nhập kho.') {
  const data = error?.response?.data;
  const code = data?.code;
  if (code && messages[code]) return messages[code];
  const backendMessage = data?.message;
  if (typeof backendMessage === 'string' && backendMessage.trim() && !/^invalid body request$/i.test(backendMessage.trim())) return backendMessage;
  if (error?.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') return error.message;
  return fallback;
}

export const managedUnifiedInboundErrorMessages = messages;
