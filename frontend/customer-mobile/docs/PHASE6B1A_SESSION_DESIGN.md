# Phase 6B.1A — Thiết kế session fixture

`createFixtureAuthSession` tạo một session độc lập trong bộ nhớ. Test truyền `FixtureTransport` với mode `FIXTURE_ONLY` để thực thi contract. Đây là điểm tiêm fixture tin cậy dành cho test. Expo Router, Login, Register, Profile và Zustand demo tiếp tục chạy theo luồng demo hiện có.

| Thao tác | Contract tương đối với `/api/v1` | Điều kiện chuyển trạng thái |
| --- | --- | --- |
| Login | `POST /auth/login` với `email` và `password`. Đọc access token, refresh token và user bằng mapper hiện có. | Xóa danh tính của epoch trước và chuyển sang `authenticating`. Chỉ công bố `authenticated` khi `GET /users/me` xác nhận cùng ID, vai trò CUSTOMER và `isActive: true`. |
| Register | `POST /users/register` với `email`, `password`, `displayName` và `phone` nếu có. | Chuyển sang `registering`. Trả danh tính trong phản hồi fixture đã kiểm tra, gồm email khớp request, rồi về `signedOut`. Login là một thao tác riêng. |
| Current user | `GET /users/me` với Bearer access token. | Chỉ chạy trong phiên `authenticated`. Cập nhật bản sao danh tính của epoch đang hoạt động. HTTP 401 chuyển sang `expired` với lý do `SESSION_EXPIRED`. HTTP 403 hoặc danh tính không hợp lệ chuyển sang `expired` với lý do `INVALID_IDENTITY`. Lỗi tạm thời trả lỗi cho caller và giữ snapshot đã xác minh. |
| Logout | `POST /auth/logout` với Bearer access token và body `refreshToken` khi đã có cặp token. | Hủy epoch, bỏ danh tính và token khỏi session trước khi gửi fixture logout. Logout không cần transport nếu chưa có session. Lỗi fixture logout không khôi phục session. |

Mỗi login, logout, expiration và lần bắt đầu/kết thúc register đổi epoch. `AbortController` truyền tín hiệu hủy đến fixture và làm promise phía caller kết thúc ngay cả khi fixture bỏ qua tín hiệu. Kiểm tra epoch sau mỗi await bảo vệ cả kết quả thành công và lỗi. Khi chuyển A → B, session xóa snapshot A ngay khi bắt đầu login B. Kết quả muộn của A không cập nhật B hay làm B hết phiên.

Snapshot chỉ lưu trạng thái, epoch và các trường danh tính cần dùng. Cặp token nằm trong closure của session. Mật khẩu chỉ đi qua request fixture. Lỗi trả mã ổn định và thông báo do app kiểm soát, không chứa request, body lỗi hay token. Kết quả register chưa xác nhận được sẽ báo lỗi, không tự gửi lại. HTTP 401 yêu cầu đăng nhập lại. Source Backend có logout dùng refresh token nhưng chưa có refresh endpoint cho app.

**Điều kiện cho lần cutover native.** Trước khi dùng credential thật, cần review transport tin cậy và triển khai kho bảo mật dựa trên iOS Keychain / Android Keystore nếu quyết định lưu session qua lần mở app. Giữ access token trong bộ nhớ. Chỉ xem xét lưu refresh credential khi contract và chính sách khôi phục phiên được duyệt. Thiết kế cleanup khi đổi tài khoản, logout, hết hạn, thu hồi hoặc lỗi đọc kho. Kiểm thử trên thiết bị gồm mở lại app, khóa máy và luồng app foreground/background. Dữ liệu riêng phải được phân vùng theo Customer ID và epoch trước khi nối các cache khác.

Đối chiếu source tại revision `b7f09b4`. Route/method và envelope từ `BE-REF/src/routes/auth.routes.ts`, `BE-REF/src/routes/user.routes.ts`, `BE-REF/src/controllers/auth/auth.controller.ts` và `BE-REF/src/controllers/users/user.controller.ts`. Active-user guard nằm trong `BE-REF/src/middlewares/auth/requireAuth.ts`. [Audit Phase 6A-R](PHASE6AR/PHASE6AR_REPORT.md).
