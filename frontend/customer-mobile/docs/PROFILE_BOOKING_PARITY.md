# Customer Mobile Profile và Self Storage booking

## Hợp đồng API

Các đường dẫn dưới đây tương đối với `/api/v1`.

| Chức năng | Hợp đồng |
| --- | --- |
| Danh sách và chi tiết kho | `GET /facilities/:facilityId/storage-units`, `GET /storage-units/:unitId`, yêu cầu đăng nhập. Mobile kiểm tra kho thuộc đúng cơ sở và chỉ cho bắt đầu với `status === 'AVAILABLE'`. |
| Lịch và kỳ thuê | `GET /storage-units/:unitId/availability` với `month` dạng `YYYY-MM`. Kiểm tra khoảng thuê gửi thêm `startDate` và `endDate` dạng `YYYY-MM-DD`. Khoảng thuê dùng nửa mở [bắt đầu, kết thúc) theo UTC. |
| Kỳ hạn và giá | `GET /pricing-rules` lấy kỳ hạn đang hiệu lực cho cơ sở, dịch vụ và kích cỡ kho. `GET /pricing-rules/resolve` xác định quy tắc cho kỳ hạn và thời điểm thuê. `POST /reservations/estimate` nhận `pricingPolicyId`, `startDate`, `endDate` với ngày giờ ISO UTC. |
| Đặt kho | `POST /reservations` thêm `facilityId` và `storageUnitId` vào payload báo giá. Backend xác minh cuối trong transaction. Mobile kiểm tra lại trước khi gửi và giữ cùng `Idempotency-Key` khi khôi phục lần gửi. |
| Tài khoản | `GET /users/me` và `PUT /users/me/profile` với `displayName` và `phone` nếu đổi. Backend cập nhật theo người dùng đã xác thực và tự đồng bộ tên sang Keycloak. |
| Hồ sơ Customer | `GET /customers/me/profile` và `PUT /customers/me/profile` với các trường chỉnh sửa `address`, `taxCode`. Customer được xác định từ token. Backend đặt trạng thái xác minh thành `PENDING`. CCCD hiển thị tình trạng đã cung cấp và giữ chỉ đọc vì model khai báo immutable. |

Nguồn đối chiếu Web gồm `src/components/customer/RentalBookingIntegration.jsx`, `RentalPeriodIntegration.jsx`, `src/lib/rentalPeriod.js` và `src/pages/customer/ProfilePage.jsx`. Nguồn Backend gồm `src/routes/storage-unit.routes.ts`, `pricing-policy.routes.ts`, `reservation.routes.ts`, `customer-profile.routes.ts` và `user.routes.ts`.

## Render read-only

API gốc là `https://wdp-m4ns.onrender.com/api/v1`.

| Request không token | Kết quả |
| --- | --- |
| `GET /public/facilities?limit=100` | HTTP 200, danh sách có HCM-03 (`6ac4561b9a1f0501dfd90243`) |
| `GET /public/facilities/6ac4561b9a1f0501dfd90243` | HTTP 200 |
| `GET /facilities/6ac4561b9a1f0501dfd90243/storage-units` | HTTP 401 |
| `GET /users/me`, `GET /customers/me/profile` | HTTP 401 |

Chưa có phiên Customer được cấp phép để đối chiếu ID, trạng thái và kỳ thuê của `DEMO-CLASS-22-19900`, `DEMO-PDAT-02`, `C-001`, `B-01`. Dữ liệu các kho này trên Render và parity end-to-end chưa được xác minh. GET hồ sơ có thể khởi tạo hồ sơ khi chưa tồn tại, vì vậy chỉ dùng tài khoản test đã có hồ sơ để kiểm tra chỉ đọc.

## Kiểm tra thủ công

1. Chạy `npx expo start` trong `customer-mobile/` với Backend đã được cấp phép. Đăng nhập bằng tài khoản Customer test đã có hồ sơ.
2. Mở cùng cơ sở HCM-03 trên Web và Mobile. Dùng mã và ID kho từ cùng API để đối chiếu. Kiểm tra kho `OCCUPIED` báo đã có người thuê và nút chọn bị khóa. Với kho `AVAILABLE`, chọn cùng ngày bắt đầu và kỳ hạn để đối chiếu ngày kết thúc, phản hồi availability và giá.
3. Trên môi trường test được phép ghi, chỉnh tên/điện thoại trong phần tài khoản hoặc địa chỉ/mã số thuế trong phần hồ sơ. Lưu, tải lại và đăng nhập lại để kiểm tra dữ liệu. Các trường email, quyền và xác minh không có ô chỉnh sửa.
4. Chỉ xác nhận tạo Reservation trên môi trường test được cấp phép ghi. Thử nhấn nhanh hai lần và kiểm tra một Reservation. Khi kỳ thuê xung đột, kiểm tra thông báo và luồng dừng trước màn thanh toán.

Jest dùng Axios fixtures. Smoke Expo Web chặn toàn bộ API và Hosted Checkout qua browser interception. Android/iOS export kiểm tra đóng gói Hermes. Kiểm thử thiết bị và ghi dữ liệu thật thuộc bước xác minh thủ công.
