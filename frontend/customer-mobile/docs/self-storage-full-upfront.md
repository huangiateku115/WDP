# Customer Mobile Self Storage trả trước 100%

Các route Expo Router cho danh mục cơ sở, đặt kho và hồ sơ thuê sử dụng Customer session và API client hiện có. Các màn hình minh họa nằm ngoài luồng runtime này.

| Bước | API được đối chiếu với Backend |
| --- | --- |
| Chọn cơ sở và kho | GET /public/facilities, GET /public/facilities/:id, GET /facilities/:id/storage-units |
| Kiểm tra kỳ thuê và báo giá | GET /storage-units/:id/availability, GET /pricing-rules/resolve, POST /reservations/estimate |
| Điều khoản và đặt kho | GET /public/terms/current với serviceType SELF_STORAGE, POST /reservations với termsAccepted, termsVersionId và Idempotency-Key |
| Thanh toán | GET/POST /reservations/:id/payments/payos, GET /reservations/:id/payments/:paymentId, POST /reservations/:id/payments/:paymentId/reconcile |
| Hủy đơn chưa thanh toán | GET /reservations/me cung cấp customerCancellationEligible, PATCH /reservations/:id/cancel |
| Hợp đồng giấy và bàn giao | GET /reservations/me và GET /contracts/reservation/:reservationId |

Mobile gửi FULL_RENT cho đơn FULL_UPFRONT_V1. Giá giao dịch và thông tin VietQR do Backend trả về. Hosted Checkout và VietQR sử dụng cùng Payment ID. Khi kết quả tạo giao dịch chưa rõ, journal chặn tạo thêm intent. Hủy PayOS đã xác minh có thể mở một lần thanh toán mới nếu Backend trả retryAllowed. Thao tác này giữ nguyên đơn thuê. Khi kết quả đặt kho chưa rõ, khách có thể mở Kho của tôi hoặc dùng lại payload và khóa đã lưu.

Backend source đăng ký callback native vaultspace-customer://payments/return khi nhận X-WDP-Payment-Client: MOBILE. Việc mở lại ứng dụng phụ thuộc vào bản cài có đăng ký scheme và gateway. Khách cũng có thể tự quay về ứng dụng và kiểm tra trạng thái. Mobile chỉ chuyển đến hợp đồng sau khi thấy Payment SUCCEEDED, VERIFIED, APPLIED và đơn đã sang trạng thái phù hợp.

Customer ký giấy tại cơ sở. Nhân viên xác minh và bàn giao theo luồng Backend hiện có. Phiên bản Backend được kiểm tra không cấp credential số khi bàn giao upfront. Mobile không hiển thị PIN giả. Chức năng hủy đơn ẩn khi Backend đã triển khai thiếu trường customerCancellationEligible hoặc trả false.

Các fixture chạy cục bộ. Nghiệm thu trên thiết bị cần môi trường test riêng, Customer đã xác minh danh tính, và dữ liệu Facility/Unit đủ điều kiện. Kiểm tra callback, foreground, quét VietQR, luồng PAID đến ACTIVE và hủy đơn trong môi trường đó.

## File thay đổi

- API và DTO gồm `src/api/contracts/booking.ts`, `src/api/contracts/customer.ts`, `src/api/contracts/documents.ts`, `src/api/mobileRepository.ts`, `src/api/paymentReturnLink.ts`, `src/api/selfStorageContract.ts`, `src/api/selfStoragePayment.ts`.
- Nghiệp vụ và journal gồm `src/domain/liveBooking.ts`, `src/domain/livePayment.ts`, `src/domain/reservationProgress.ts`, `src/state/attemptJournal.ts`.
- Màn hình và component gồm `src/components/FullRentCheckout.tsx`, `src/components/ReservationProgressTracker.tsx`, `src/screens/LiveAccount.tsx`, `src/screens/LiveCatalog.tsx`, `src/screens/LiveContract.tsx`, `src/screens/LiveRental.tsx`, `src/screens/PayosPaymentReturn.tsx`.
- Kiểm thử gồm `tests/full-rent-checkout.test.tsx`, `tests/live-api.test.ts`, `tests/live-booking.test.ts`.
- Báo cáo trong tài liệu này.
