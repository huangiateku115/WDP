# Customer Website

| File | Thay đổi và contract |
| --- | --- |
| `src/components/customer/inventory/customerInventoryPolicy.js` (mới), `managedInventoryContext.js` (cùng thư mục) | Biểu diễn trạng thái reservation, marker closure và phiên bản inventory. Mặc định version 0 theo source; version sai bị từ chối. Không giả định closure đồng nghĩa với giải phóng Cell. |
| `src/components/customer/inventory/InventoryItemForm.jsx` | Đọc reservation detail cho cả hai flow trước khi cho gửi, kiểm lại điều kiện và Cell preference khi submit. Backend thực thi fence/CAS; FE không phát minh header. 409 tải lại danh sách và detail, giữ form; kết quả create không rõ không tự gửi lại. |
| `src/components/customer/inventory/RepeatedInboundRequests.jsx` | Chặn create/amend khi closure hoặc detail không xác minh được; history/detail/cancel vẫn dùng điều kiện riêng. 409/428 tải lại history và eligibility, 503/transport loss giữ đúng key/body/version. Refresh (GET) cũng làm mới eligibility; thay đổi context cha loại bỏ cache cũ. Không fallback first inbound, không cập nhật stock. |
| `src/components/customer/inventory/ManagedContractReview.jsx` | Khóa Customer Sign ở UI và handler vì POST hiện chưa ràng buộc nội dung đã review. Đọc, tiến độ chữ ký và refresh được giữ; Facility branch được giữ. |
| `src/lib/customerReservationService.js` | Phân biệt Self mới CONTRACTED + DRAFT, DEPOSIT_PAID, CHECKIN_READY, PAID và ACTIVE; RESERVED vẫn có nghĩa cũ. Chỉ đổi trình bày. |
| `src/components/customer/selfStorageSuggestions.js` (mới), `src/components/customer/SelfStorageReservationReview.jsx` | Đọc top-level `suggestedUnits` trên HTTP 409, xác thực shape/ID/size và giới hạn tối đa 5. Customer chọn rõ ràng; FE kiểm Unit detail cùng Facility, giữ dates/term, bỏ quote cũ và trở lại bước period. Không tự thay Unit, giữ guard kết quả chưa rõ và đường dẫn PayOS khi booking thành công. |
| `tests/customer-alignment-policy.test.mjs` (mới), `tests/customer-repeated-inbound.test.mjs`, `tests/customer-payment-load.test.mjs` | Kiểm tra policy, lifecycle, suggestions, support, signing, preflight và closure với cancel. Cập nhật fixture Review để nạp helper suggestions thực tế và fixture Repeated Inbound để kiểm tra item thiếu không gọi API. [Kết quả kiểm thử](CUSTOMER_API_CONTRACT_TESTS.md). |

**Đã kiểm, không cần sửa:** `CustomerSupportIntegration.jsx` gửi category/subject/description, không cho private `relatedEntity`; chỉ hiển thị public messages. Canonical outbound, contract A4 từ detail an toàn, Self PayOS checkout/status/history/QR, notification và period availability giữ nguyên. Raw print endpoint không được đưa vào Customer UI.

**Giới hạn còn lại:** Không mở rộng quyền edit sang nhánh sửa hàng bị từ chối trước hợp đồng; frontend vẫn giữ điều kiện edit hiện hữu. Kiểm tra QR xác nhận `qrcode@1.5.4` đã có trong manifest và lockfile; không đổi implementation hoặc payload.
