# Customer Mobile UI Cleanup & SKU Image Upload R5

**Checkpoint:** `WDP_MOBILE_UI_CLEANUP_SKU_IMAGE_R5`

## Kết quả

- Visit success banner đã chuyển thành Toast ở cấp ứng dụng. Toast xuất hiện phía trên màn hình đích, nằm dưới vùng Safe Area/tiêu đề, có icon và animation, tự ẩn sau 3 giây.
- SKU và Item Specification được đồng bộ dùng Toast sau khi response đã được xác minh. Sửa lịch cũng dùng Toast.
- Danh sách Visit chỉ được xem là đã cập nhật sau khi tải thành công và tìm thấy đúng Visit ID. Nếu tải xong nhưng chưa thấy lịch mới, màn hình báo chưa hiển thị và cho phép tải lại; không tự thêm lịch vào danh sách.
- Đã thay các câu giải thích dành cho Developer trong các màn hình Managed Inventory liên quan bằng hướng dẫn/ngôn ngữ khách hàng. Trạng thái lỗi và hạn chế nghiệp vụ vẫn được trình bày.
- Form SKU có chọn ảnh từ thư viện, camera trên native, xem trước trước khi tải, tải lại khi lỗi, gỡ ảnh, giới hạn tối đa 10 ảnh, và hiển thị lại ảnh đã lưu khi mở sửa/chi tiết SKU.

## Hợp đồng ảnh đã đối chiếu

Customer Web dùng `InventoryImagePicker` trong `InventoryItemForm` cho ảnh SKU và trong `ItemSpecifications` cho ảnh riêng của từng loại hàng. Adapter gọi `POST /inventory-items/image-uploads` bằng multipart field `file`, `managedReservationId` và header `Idempotency-Key`. Backend yêu cầu Customer đã xác thực, kiểm tra Reservation sở hữu, xác thực nội dung ảnh rồi tải lên Cloudinary. Kết quả gồm upload ID, HTTPS URL, định dạng/kích thước và thời hạn. Web lưu URL trong danh sách `images` khi tạo/cập nhật SKU hoặc Item Specification; Backend kiểm tra upload thuộc Customer/Reservation trước khi gắn. Upload chưa gắn có endpoint `DELETE /inventory-items/image-uploads/:uploadId` để yêu cầu dọn dẹp; ảnh đã gắn không bị xóa bằng endpoint dọn upload.

Contract giới hạn JPEG, PNG hoặc WebP; tối đa 8 MiB mỗi ảnh, 6.000 px mỗi chiều, 24 MP và 10 ảnh. Mobile kiểm tra metadata trước khi gửi; Backend vẫn là nơi xác thực nội dung ảnh thật.

**Giới hạn production:** source Backend hiện trả HTTP 503 cho upload khi `NODE_ENV=production`, cho tới khi có chính sách phân phối ảnh riêng. Mobile gọi endpoint thật, không tạo URL thay thế và hiển thị thông báo chưa khả dụng khi nhận 503. Vì vậy upload chưa thể dùng trên production cho tới khi Backend mở chính sách này. Không có ảnh nào được tải lên trong công việc này.

## Thay đổi giao diện

| Trước | Sau |
|---|---|
| Banner thành công lớn chiếm chỗ cho tới khi đóng; lời nhắn còn khẳng định đã đồng bộ trước khi đọc danh sách | Toast gọn, tự ẩn; màn hình danh sách tự đọc dữ liệu và chỉ phản ánh kết quả đã tải |
| SKU không có ảnh; thông tin mở đầu giải thích cấu trúc dữ liệu cho Developer | Khu vực ảnh dạng lưới, xem trước, chọn thư viện/chụp ảnh và quản lý ảnh; mô tả ngắn “Khai báo thông tin hàng hóa để quản lý và nhập kho.” |
| Tên field/thuật ngữ kỹ thuật hoặc chuỗi JSON được đưa vào một số màn hình thao tác | Nhãn tiếng Việt dễ hiểu; các mức tồn/sức chứa hiển thị thành dòng tóm tắt thay cho JSON thô |

## Files changed

- `app/_layout.tsx`, `app.json`
- `package.json`, `package-lock.json` (`expo-image-picker` phiên bản SDK 58 tương thích: `58.0.10`)
- `src/api/managedImageUploads.ts`
- `src/components/ManagedInboundPreviewCard.tsx`
- `src/components/ManagedReservationOperations.tsx`
- `src/components/ManagedSkuEditor.tsx`
- `src/components/ManagedSpecifications.tsx`
- `src/components/ToastViewport.tsx`
- `src/screens/LiveAccount.tsx`
- `src/screens/ManagedStockOperations.tsx`
- `src/screens/ManagedVisitActivityScreen.tsx`
- `src/screens/ManagedVisitForm.tsx`
- `src/state/toastStore.ts`
- `tests/managed-image-upload.test.ts`
- `tests/managed-sku-image-picker.test.tsx`
- `tests/managed-visit-routing.test.tsx`
- `tests/managed-visit-success-navigation.test.tsx`
- `tests/managed-mobile-form-navigation.test.tsx`
- `tests/toast-store.test.ts`

## Verification

| Check | Result | Details |
|---|---|---|
| `npm run typecheck` | PASS | `tsc --noEmit`, exit code 0 |
| Focused Jest | PASS | 6 suites, 20/20 tests; Visit, routing, SKU picker, upload contract, Toast |
| Full Jest | PARTIAL | 34/35 suites, 667/668 tests pass. Remaining failure: `tests/customer-web-containment.test.ts` → `InventoryItemForm` throws `useMemo is not a function` in the Web test harness. Web is outside this task and was not changed. |
| `npx expo install --check` | PASS* | Dependencies reported up to date against Expo’s bundled SDK map; network access was disabled, so remote compatibility lookup was skipped. |
| Expo Web export | PASS | `npx expo export --platform web`; final export in `%TEMP%\wdp-mobile-r5-web` |
| Expo Android + iOS export | PASS | `npx expo export --platform android --platform ios --max-workers 2`; final export in `%TEMP%\wdp-mobile-r5-native` |
| Device verification / live upload | NOT_RUN | No physical device test and no user image upload were performed. |

An export attempt under the workspace hit `EPERM` while creating `assets/node_modules`; no existing output was deleted. Final Web and native exports succeeded in the current environment’s temporary directory.

## Remaining limitations

- Production image upload remains blocked by the Backend’s explicit 503 guard described above.
- The mobile screen currently adds photos to the SKU `images` contract. The Backend/Web also support images on Item Specification; that separate form was not extended in R5 because the requested Mobile gap is SKU image entry.
- Confirm gallery/camera permissions and visual placement on physical Android and iOS devices. Expo export proves bundle generation only.
- Full Jest remains partially blocked by the unrelated Customer Web test harness failure; no Web code was changed to address it.

No Backend, Customer Web, `.env`, PayOS, MongoDB, or integration-write tests were changed or used.
