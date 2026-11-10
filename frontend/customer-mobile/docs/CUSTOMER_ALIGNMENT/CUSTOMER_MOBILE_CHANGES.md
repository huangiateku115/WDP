# Customer Mobile: contract offline

Các file sau nằm trong `customer-mobile/src/api/contracts/`. Module không nhập Axios client và không kết nối màn hình với Backend.

| File | Mô hình và kiểm tra |
| --- | --- |
| `core.ts` | Envelope, ID, phân trang, owner, lỗi 401/409/428/503 và session epoch trong bộ nhớ. Không lưu credential hay refresh tự động. |
| `customer.ts` | Login/register/logout, `displayName`, vai trò CUSTOMER, user đang hoạt động, identity profile riêng, facilities và rentals thuộc owner. Dashboard chỉ tổng hợp từ dữ liệu đã xác minh, không có API tổng hợp giả. |
| `booking.ts` | UTC/date-only, exact Unit/calendar, UNKNOWN fail closed, server estimate, pricing policy, Self CONTRACTED và 409 alternatives. Managed V2 quote/term DAY-MONTH-YEAR, Cell period/ownership/bookability, rack coordinates đã xác nhận, không tự tạo Zone bounds hoặc legacy fallback. |
| `inventory.ts` | Item code bắt buộc, DTO register/edit, stock projection và batch, missing stock giữ là không xác minh, không lấy registered quantity làm physical stock. Tách payload repeated inbound/canonical outbound, version/If-Match/key, scope item-parent và movement. |
| `documents.ts` | Contract version/hash và chữ ký riêng, tách giấy tờ Self khỏi Managed signatures. Self PayOS theo purpose và ba trạng thái provider/settlement/application; Managed mock và zero balance riêng. Sign/checkout thực vẫn khóa. |
| `communications.ts` | Owner notification, contract offline `PATCH /notifications/:id/read` không body và xác thực owner/ID/isRead, support text-only và lọc internal messages; không giả bulk, push, typed navigation, attachments hoặc private related IDs. |
| `fixtureAdapter.ts` | GET thử nghiệm với transport inject `FIXTURE_ONLY`, owner guard, không đọc khi session đổi, loại response cũ và expire trên 401. Không fallback demo nếu server fixture trả thiếu/sai. |

`src/forms/inventory.ts` và `src/screens/InventoryFormScreen.tsx` thêm item code bắt buộc, không sửa code của lot khi edit. `BookingConfirmationScreen.tsx`, `ContractReviewScreen.tsx`, `PaymentDetailScreen.tsx`, `SupportDetailScreen.tsx` chỉ sửa nội dung cho đúng trạng thái và khả năng hiện tại. Các thao tác demo hiện hữu vẫn là prototype, với validation UI riêng; DTO wire không thay thế dữ liệu demo bằng record giả live.

`tests/backend-contracts.test.ts` và `tests/customer-web-containment.test.ts` là test mới. `tests/inventory.test.tsx`, `scripts/smoke-inventory.cjs` bổ sung item code cho input hợp lệ. 23 design và năm tab được giữ, không thay route. Không gọi login, booking, nhận/xuất hàng, ký, thanh toán hoặc notification write thật.
