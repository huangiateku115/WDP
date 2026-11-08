# Phase 6B.1A — Customer Mobile offline auth

**REVIEW_REQUIRED.** Đã triển khai adapter auth fixture và session state machine dùng DTO đã có. Session chỉ xác thực sau khi login trả envelope hợp lệ và current-user xác nhận cùng Customer ID đang hoạt động. Register trả receipt đã xác minh và kết thúc ở trạng thái signed out. Epoch và cancellation loại bỏ phản hồi cũ khi logout, hết hạn hoặc đổi tài khoản.

Màn hình, demo store, guards và năm tab tiếp tục dùng luồng demo. Session fixture chỉ được khởi tạo qua dependency injection trong test. Client Axios vẫn fail closed. Phase này kiểm thử được contract và chuyển trạng thái trên fixture. Review cutover vẫn cần xác nhận deployment, native credential storage, re-login và acceptance trên thiết bị.

- [Thiết kế session](PHASE6B1A_SESSION_DESIGN.md)
- [Kết quả kiểm thử](PHASE6B1A_CONTRACT_TESTS.md)
- [Đối chiếu phạm vi và manifest](PHASE6B1A_PRESERVATION.md)

```text
[C2C]
TASK_ID: WDP_CUSTOMER_MOBILE_AUTH_FOUNDATION
PHASE: 6B.1A
STATE: REVIEW_REQUIRED
BACKEND_BASELINE: b7f09b4
SCOPE: CUSTOMER_MOBILE_ONLY
WEBSITE_SOURCE_CHANGED: 0
NON_CUSTOMER_SOURCE_CHANGED: 0
BACKEND_CHANGED: 0
BASELINE_TESTS: 447
FINAL_TESTS: 468/468 PASS
HERMES_EXPORT: ANDROID AND IOS PASS
SMOKE_TESTS: 7/7 RN WEB PASS
AXIOS_TRANSPORT: FAIL_CLOSED
LIVE_API_CALLS: 0
NEXT_PHASE: REVIEW_BEFORE_LIVE_AUTH_CUTOVER
```
