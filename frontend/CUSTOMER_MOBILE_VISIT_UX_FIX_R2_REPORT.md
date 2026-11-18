# Customer Mobile Visit UX Fix R2

Checkpoint: `WDP_MOBILE_VISIT_AND_RENTAL_DETAIL_UX_FIX_R2`

## Kết quả

- Visit form có date picker native cho iOS/Android và lịch tháng tương thích Expo Web. Ngày mới dùng ngày lịch `Asia/Ho_Chi_Minh`; đổi ngày hoặc mục đích xóa slot đã chọn. Availability key thay đổi theo ngày nên Mobile tải lại slot từ Backend.
- Mobile render nguyên danh sách slot Backend trả về. Slot đã qua thời điểm hiện tại bị vô hiệu hóa, không bị xóa khỏi danh sách; không có slot giả. Nếu response có đúng một slot, form thông báo chỉ còn một khung giờ.
- Visit/Session chuyển sang route riêng với hai tab, trạng thái loading/empty/error, hiển thị HTTP status và phân biệt lỗi 401/403. Visit hỗ trợ sửa/hủy chỉ khi `SCHEDULED`; thao tác dùng API hiện có, lỗi giữ nguyên hiển thị, danh sách tải lại theo focus sau khi quay lại.
- Reservation Detail giữ một nút `Xem lịch và phiên truy cập`. Component này không gọi Closure Readiness; UI đánh giá kết thúc thuê không còn được render.

## Phân tích nguyên nhân

1. **Date picker:** `@expo/ui/community/datetime-picker` không render trên Web (implementation khai báo trả `null`), nên state mở picker nhưng không có giao diện. Đã thêm calendar Modal cho Web; native tiếp tục dùng picker Expo UI. Đã kiểm tra Expo export, chưa thử trực tiếp trên thiết bị.
2. **Một slot 22:00:** Mobile không lọc response xuống một slot; API adapter giữ toàn bộ `slots`. Backend availability xây dựng slot theo lịch cơ sở, giờ hiện tại, kỳ thuê và sức chứa/nhân viên. Không có response phiên đăng nhập của Reservation được nêu nên chưa thể xác minh Backend thực sự đã trả đúng một slot 22:00 trong lần kiểm tra đó. UI giờ sẽ nêu rõ nếu response có một slot và không tạo thêm lựa chọn.
3. **Visit List:** Có lỗi DTO Mobile đã xác nhận trong source: Backend cho phép trạng thái `MISSED`, còn schema Mobile cũ từ chối trạng thái đó; một row như vậy khiến parse toàn bộ mảng thất bại. Trường `assignedStaffId` populate thành object cũng được DTO mới hỗ trợ. Adapter gọi đúng GET `/access/managed-v3/visits/me`, dùng envelope và authorization chung của API client.
4. **Reservation scope:** Mapping cũ chỉ giữ row có `reservationId` chính. Đã mở rộng để nhận cả `scopedReservationIds`, tránh bỏ Visit/Session của Reservation phụ trong scope chuyển vị trí.
5. **Access Session:** Endpoint Customer query Session `ACTIVE`; Session hết hạn nhưng chưa được cập nhật có thể được trả với trạng thái tính toán `EXPIRED`. Session đã kết thúc/thu hồi không được trả như lịch sử. Empty state có nghĩa API không trả Session trong tập dữ liệu hiện endpoint cung cấp, không chứng minh Reservation chưa từng có Session. Mapping theo scope cũng đã được sửa. Không thực hiện request với phiên Customer thật trong lượt này.
6. **Closure Readiness:** UI gọi endpoint qua `ManagedReservationOperations` trước đây. Component này hiện không tham chiếu `readiness`; API adapter được giữ lại để không ảnh hưởng nơi khác.

## Files changed

- `customer-mobile/src/screens/ManagedVisitForm.tsx` — Web calendar, chọn ngày theo timezone HCMC, xóa slot cũ khi đổi ngày/mục đích, thông báo một slot.
- `customer-mobile/src/components/ManagedVisitDatePicker.tsx` — date picker tái sử dụng cho Web/iOS/Android.
- `customer-mobile/src/screens/ManagedVisitActivityScreen.tsx` — màn hình lịch/phiên truy cập hai tab, lỗi quyền/API, empty state chính xác, thao tác lịch được Backend hỗ trợ.
- `customer-mobile/app/managed/reservations/[reservationId]/visits/index.tsx` — route màn hình hoạt động.
- `customer-mobile/src/components/ManagedReservationOperations.tsx` — chỉ điều hướng và duy trì progress Reservation; bỏ Closure Readiness UI/API call.
- `customer-mobile/src/api/managedReservationReads.ts` — DTO `MISSED`/staff populated và lọc scope hoàn chỉnh.
- `customer-mobile/src/components/liveUI.tsx` — giữ HTTP status cho màn hình phân biệt lỗi quyền và lỗi server.
- `customer-mobile/tests/managed-v3-visits.test.ts` — regression cho `MISSED`, populated staff, secondary scope và lỗi 403.
- `customer-mobile/tests/managed-visit-date-picker.test.tsx` — test mở Web calendar và chọn ngày HCMC.
- `customer-mobile/tests/managed-mobile-form-navigation.test.tsx` — route riêng và không còn Closure Readiness UI.

## Verification

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | PASS |
| `npm test -- --runTestsByPath tests/managed-visit-date-picker.test.tsx tests/managed-v3-visits.test.ts tests/managed-mobile-form-navigation.test.tsx` | PASS, 3 suites / 11 tests |
| `npm test -- --runInBand` | 29 suites PASS, 649/650 tests PASS; 1 test FAIL ngoài phạm vi: `tests/customer-web-containment.test.ts` — test harness React mock không cung cấp `useMemo` (`InventoryItemForm`). Không sửa Web theo ràng buộc. |
| `npm run export:native` | PASS, Android + iOS bundles |
| `npx expo export --platform web --max-workers 2 --output-dir artifacts/web-r2-final` | PASS |

Không chạy MongoDB, IT01–IT10 hoặc API ghi dữ liệu. Không kiểm tra thiết bị vật lý. Expo export xác nhận bundle, không xác nhận hành vi native thực tế.

## Kiểm tra thủ công còn lại

- Trên Android/iOS, mở Reservation → `Xem lịch và phiên truy cập` → `Đặt lịch đến kho`; mở picker, chọn ngày hiện tại và ngày khác; xác nhận ngày HCMC và slot được tải lại.
- Trên Web, xác nhận calendar modal, tháng trước/sau, chọn ngày và đóng lịch.
- Xác nhận số slot khớp response Backend trong cùng ngày/purpose; nếu chỉ một lựa chọn, kiểm tra response availability để xác định nguyên nhân lịch.
- Với phiên Customer đăng nhập, xác minh Visit List/Session List và HTTP status thực tế. Đối chiếu Visit `MISSED` hoặc staff populated nếu xuất hiện.
- Xác nhận Detail chỉ có một nút lịch/phiên và không gọi closure-readiness.

Không thay đổi Backend, Web, `.env`, PayOS hoặc dữ liệu MongoDB.
