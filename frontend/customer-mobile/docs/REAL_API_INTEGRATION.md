# VaultSpace Customer Mobile — Real API V1

Task WDP_CUSTOMER_MOBILE_REAL_API_INTEGRATION_V1. Source được xác minh từ Backend chính và Customer Web. Render chỉ được kiểm chứng bằng GET danh sách cơ sở công khai. Các API yêu cầu tài khoản chưa được xác minh trên deployment.

| Tính năng | Trước | API đã xác nhận trong source | Trạng thái Mobile |
| --- | --- | --- | --- |
| Đăng nhập | Phiên trong bộ nhớ dựa trên dữ liệu mẫu | POST /auth/login, GET /users/me, POST /auth/logout | Xác thực Customer, xác minh role và danh tính qua Backend, khôi phục SecureStore trên native |
| Tạo tài khoản | Xác thực biểu mẫu cục bộ | POST /users/register | Tạo tài khoản bằng DTO Backend |
| Tổng quan | Dữ liệu mẫu | GET /reservations/me, /contracts/me, /inventory-items/me, /notifications/me | KPI từ phản hồi thật. Khi API lỗi, KPI hiển thị chưa khả dụng |
| Cơ sở và đơn thuê | Dữ liệu mẫu | GET /public/facilities, /public/facilities/:id, /facilities/:id/storage-units, /storage-units/:id, /storage-units/:id/availability, /pricing-rules/resolve, POST /reservations/estimate, POST /reservations | Có phân trang, kiểm tra khoảng thuê, báo giá và xác nhận tạo đơn |
| Kho đã thuê và hợp đồng | Dữ liệu mẫu | GET /reservations/me, /reservations/:id, /contracts/reservation/:id | Đọc theo quyền sở hữu. Ký và hủy chưa mở trên Mobile |
| Đặt cọc | Giao diện thanh toán minh họa | GET /reservations/:id/payments/payos, GET /reservations/:id/payments/:paymentId, POST /reservations/:id/payments/payos | Hosted Checkout cho Self Storage. Balance và thanh toán kho ký gửi chưa mở |
| Hàng hóa | Dữ liệu mẫu | GET /inventory-items/me, /inventory-items/:id, /inventory-items/:id/stock-balance, /inventory-items/:id/movements | Đọc hàng, tồn kho, lô hàng và lịch sử. Không ghi inventory hoặc dùng fallback legacy |
| Hồ sơ | Dữ liệu mẫu | GET /users/me, /customers/me/profile | Đọc danh tính và hồ sơ Customer |
| Thông báo | Dữ liệu mẫu | GET /notifications/me, PATCH /notifications/:id/read | Danh sách, badge chưa đọc và đánh dấu từng thông báo |

## Cấu hình

Development mặc định dùng `http://localhost:5000/api/v1` trên Expo Web và `http://10.0.2.2:5000/api/v1` trên Android emulator. Thiết bị thật cần đặt `EXPO_PUBLIC_API_BASE_URL` thành địa chỉ LAN của Backend. Bản release yêu cầu URL HTTPS được cấu hình rõ ràng. Giá trị cấu hình sai hoặc thiếu ở release chặn request.

Dùng Expo SDK 58 và cài dependency từ lockfile. Chạy npm start để mở Metro. Hai module SDK bổ sung là expo-secure-store và expo-crypto. Trên native, token được lưu trong SecureStore theo Backend origin. Web chỉ giữ token trong bộ nhớ và cần đăng nhập lại sau khi tải lại trang. Cấu hình Keycloak hiện đọc được là confidential client dùng qua Backend. Chưa xác nhận public client PKCE hoặc endpoint refresh của WDP, nên app không nhúng secret và yêu cầu đăng nhập lại khi nhận 401.

## Khôi phục đặt kho và thanh toán

Mobile lưu key đặt kho và DTO gốc trước POST. Người dùng có thể mở Kho của tôi để khôi phục đơn đã tạo, hoặc nhập lại cùng kỳ thuê và yêu cầu khôi phục bằng đúng key. Thử lại thanh toán luôn đi từ màn hình đơn đã lưu.

Mobile đọc Reservation, Contract và lịch sử đầy đủ trước khi tạo Deposit. Lượt tạo duy nhất được ghi vào nhật ký trước POST. Một lần thử chưa rõ kết quả chỉ cho kiểm tra trạng thái. Backend vẫn chịu trách nhiệm chống trùng giữa các thiết bị. READY chỉ mở qua HTTPS pay.payos.vn/web/ với giao dịch đúng đơn. Thành công cần SUCCEEDED, VERIFIED và APPLIED do Backend trả về. Quay lại hoặc đưa app lên foreground sẽ đọc lại. Callback hiện vẫn về Customer Web. Mobile không đọc query để xác nhận thanh toán.

Stock-balance hiện trả projection có onHandQuantity, heldQuantity và batches. Khi response thiếu availableQuantity, Mobile hiển thị chưa có xác nhận cho số lượng có thể xuất. Thông báo chưa có trường đích liên kết Reservation trong model hiện hành. Mobile không suy ra liên kết từ nội dung.

## Kiểm thử và giới hạn

Automated tests dùng Axios adapter hoặc intercept trình duyệt. Chạy npm run typecheck, npm test -- --silent, npm run export:native. Smoke Web dùng bản export riêng với EXPO_PUBLIC_API_BASE_URL=https://fixture.invalid/api/v1 và node tests/live-web-smoke.cjs, yêu cầu Edge và Playwright qua WDP_PLAYWRIGHT_MODULE hoặc đường dẫn runtime Codex của workspace.

Không dùng mock fallback. Các route cũ của quản lý kho ký gửi, ghi inventory, inbound/outbound và hỗ trợ hiện hiển thị trạng thái chưa hỗ trợ. Fixture giai đoạn trước được giữ cho test hồi quy, ngoài graph điều hướng runtime. Những mutation chưa nối như hủy đơn, cập nhật hồ sơ, ký hợp đồng và các nghiệp vụ canonical ledger cần kiểm thử contract có xác thực trước khi mở. Bulk read, xóa thông báo, liên kết Reservation từ thông báo, refresh token và native payment deep link cần hợp đồng hoặc cấu hình Backend bổ sung.

Cần tài khoản test và xác nhận deployment để chạy smoke có xác thực trên Render. Chỉ kiểm thử tạo PayOS thật sau khi được phê duyệt riêng. Không thanh toán, deploy hoặc sử dụng giao dịch đã phát sinh trong lần tích hợp này.

## Hợp đồng cần xác nhận thêm

- Phiên Mobile cần public Keycloak client với PKCE và redirect URI được allowlist, hoặc refresh qua Backend với token rotation. Chưa có route refresh trong source hiện tại.
- Callback Mobile cần một Universal Link hoặc App Link do Backend cấu hình theo client, cùng việc xác minh quyền sở hữu trước khi đọc lại payment. Callback hiện tại giữ nguyên cho Customer Web.
- Notification cần đích có kiểu và ID đã xác minh theo owner để mở Reservation. Bulk read hoặc xóa cần endpoint riêng có kiểm tra owner.
- Hủy Self Storage cần Backend kiểm tra intent đang chờ hoặc chưa rõ kết quả một cách nguyên tử. Bộ lọc hủy hiện chỉ kiểm tra owner, loại dịch vụ và trạng thái Reservation. Mobile chưa bật nút hủy để tránh xung đột khi tiền đang được xử lý.
- DTO payment nội bộ chưa cung cấp CANCELLED/EXPIRED từ provider. Để hiện hai trạng thái này, cần xác nhận contract lookup theo orderCode trên deployment và chỉ hiển thị kết quả provider tách khỏi settlement nội bộ.

### Self Storage localhost

Mở một PowerShell tại Backend và chạy `npm run dev` nếu chưa có Backend test chạy. Kiểm tra cấu hình test và cổng 5000 trước khi đăng nhập. Không chạy thêm một tiến trình trên cùng cổng.

Trên Expo Web, dùng `npm run web -- --port 8081`, mở `http://localhost:8081` và đặt `EXPO_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1` nếu cần override. Backend phải cho phép đúng Origin của trang qua `CORS_ORIGINS`. `localhost` và `127.0.0.1` là hai origin khác nhau. Giữ các origin hiện có khi bổ sung một origin đã được duyệt.

Trên Android emulator dùng `$env:EXPO_PUBLIC_API_BASE_URL='http://10.0.2.2:5000/api/v1'` rồi `npm run android`. Với điện thoại thật, thay bằng IP LAN và dùng mạng test phù hợp. Cổng đang dùng được giữ nguyên khi chạy audit; nếu cần mở Metro thứ hai, chọn cổng khác.

Dùng tài khoản Customer test đã xác minh, Facility/Unit test và Terms hiện hành. Đi qua báo giá, xác nhận điều khoản, đọc đơn `CONTRACTED` và hợp đồng `DRAFT`. Chỉ dùng PayOS test được phê duyệt. Sau settlement, để Staff test xác minh hợp đồng giấy và bàn giao. Từ Chi tiết đơn thuê `ACTIVE` hoặc `OVERDUE`, chọn **Yêu cầu trả kho**, đọc chính sách và gửi ghi chú. Chỉ Staff test mới nghiệm thu hoặc từ chối. Mobile đọc lại trạng thái Backend để hiển thị `PENDING`, kết quả từ chối hoặc `CHECKED_OUT`.
