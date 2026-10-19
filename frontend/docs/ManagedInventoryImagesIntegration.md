# Managed Inventory Images — IMAGE-01 → IMAGE-03

Ngày kiểm tra: 19/10/2026. Kết luận: **READY FOR LIVE E2E trong môi trường development được phê duyệt**. Chưa chạy Live Backend E2E; không upload ảnh, tạo Item hoặc ghi dữ liệu lên Backend thật.

## Contract đã xác minh (BE-REF chỉ đọc)

Nguồn: `BE-REF/docs/MI_IMAGE_01_CLOUDINARY.md`, `src/routes/inventory-item.routes.ts`, `src/controllers/inventory-items/inventory-item.controller.ts`, `src/services/upload/managed-inventory-image.service.ts`, `src/services/upload/inventory-image-validation.service.ts`, `src/services/inventory-items/inventory-item.service.ts`.

Các URL bên dưới là tương đối với API base hiện có (`/api/v1`), dùng Bearer token qua axiosClient hiện có, không thêm Axios instance.

| Method / endpoint | Request | Response được FE sử dụng |
| --- | --- | --- |
| POST `/inventory-items/image-uploads` | Multipart: `file` (1 ảnh), `managedReservationId`; header `Idempotency-Key` 8–128 ký tự hợp lệ | `{success:true,data:{uploadId,secureUrl,publicId,width,height,format,expiresAt}}` |
| DELETE `/inventory-items/image-uploads/:uploadId` | Không có body; chỉ chủ upload | `{success:true,data:{deleted:false,scheduledFor}}` hoặc `{success:true,data:{deleted:true}}` |
| POST `/inventory-items` | DTO đăng ký hiện có: `managedReservationId,itemCode,name,category,quantity,quantityUnit,unitWeightKg,unitDimensionsM,description,images` và `preferredCellId` tùy chọn | `{success:true,data:Item}`; Item chứa `images:string[]` theo thứ tự |
| GET `/inventory-items/:id` | Item ID | `{success:true,data:Item}`; gallery lấy trực tiếp `Item.images` |
| PATCH `/inventory-items/:id` | DTO metadata hiện có; `images:string[]` là toàn bộ collection theo thứ tự mong muốn; không gửi `itemCode` hoặc `managedReservationId` | `{success:true,data:Item}`; xác nhận collection/thứ tự rồi GET lại |

Các GET hiện có dùng nguyên trạng: `/reservations/me`, `/public/facilities/:id`, `/reservations/managed/:id`, `/warehouse-map`, `/racks/:id/detail-map` để kiểm tra eligibility và preferred Cell. Không thay payload hoặc logic các API này.

`uploadId` không phải field gắn ảnh trong DTO Item: Backend gắn bằng URL `secureUrl` khớp chính xác upload thuộc Customer/reservation. Không gửi metadata tự tạo hoặc blob URL vào `images`.

Giới hạn: 10 ảnh/Item; 8 MiB/ảnh; JPEG/PNG/WebP; 6000 px mỗi cạnh; 24 MP; một frame. Browser kiểm tra MIME/bytes/dimensions, Backend tiếp tục kiểm tra nội dung thực bằng Sharp, MIME khớp bytes và một frame. Quota: 20 upload outstanding/Customer/reservation, 30 request/IP/15 phút, không có API quota-read được giả định.

## Kết quả triển khai

- **IMAGE-01:** Chọn nhiều file, preview local, tên file, progress, cancel/retry, kiểm tra giới hạn, ngăn request upload trùng đang chạy. Retry cùng file giữ nguyên idempotency key. Dùng multipart của client đã có và token hiện tại.
- **IMAGE-02:** Payload đăng ký lấy URL từ kết quả upload; giữ metadata khi validation đăng ký thất bại để retry không upload lại. Kết quả mutation phải xác nhận chính xác collection/thứ tự. Trang detail GET Item, hiển thị gallery, preview và fallback ảnh lỗi; refresh lấy lại ảnh từ Backend.
- **IMAGE-03:** Edit lấy ảnh persisted từ Item; thêm upload mới; remove ảnh persisted chỉ thay draft collection và được lưu bằng PATCH, không gọi DELETE upload đã attached. Remove upload mới gọi discard của Backend. Di chuyển ảnh trước/sau và lưu đúng thứ tự, rồi reload Item.

## Vòng đời và phục hồi lỗi

Local selected → queued → uploading → uploaded/UNATTACHED. Upload thành công **không** được hiển thị là attached. Chỉ Item response/GET xác nhận ảnh đã lưu. Backend gắn ảnh và cập nhật upload trong transaction khi POST/PATCH Item thành công.

Đang upload, upload lỗi, đang discard hoặc upload hết hạn đều chặn Save. Upload quá hạn cần remove và chọn lại file. Lỗi quota, mạng, validation được hiển thị; retry chủ động giữ key. Không tự retry mutation Item khi kết quả chưa xác minh; giữ safeguard uncertain hiện có. 401 dùng cơ chế đăng xuất hiện có; request/progress cũ không được áp dụng sang phiên mới. Đổi reservation xóa draft ảnh để tránh gắn nhầm reservation.

Discard là yêu cầu Backend xử lý sau, không phải FE xóa Cloudinary ngay. Backend giữ attached assets; upload không sử dụng hết hạn sau 24 giờ và được cleanup. Không gọi Cloudinary upload/delete trực tiếp; không thay upload avatar hoặc chức năng ảnh khác.

## Files

Source sửa:

- `src/api/inventoryApi.js`: thêm upload/discard dùng axiosClient.
- `src/api/confirmedContract.js`: chỉ cho phép POST upload và DELETE upload ID đã xác minh.
- `src/components/customer/inventory/InventoryImagePicker.jsx`: lifecycle/validation/preview/retry/discard/reorder.
- `src/components/customer/inventory/InventoryItemForm.jsx`: reset ảnh khi đổi reservation, khóa upload khi form không eligible, xác nhận collection trong response.
- `src/components/customer/inventory/InventoryIntegration.jsx`: sử dụng gallery/fallback/preview đã có ở Item Detail.

Source thêm: `src/lib/inventoryImages.js` (validation và readiness thuần presentation).

Test sửa: `tests/inventory-image-picker.test.mjs` (điều chỉnh kỳ vọng từ uploaded sang attached cho ảnh persisted).

Test thêm: `tests/inventory-images.test.mjs`, `.design-reference/check-inventory-images.cjs`.

Tài liệu/QA: tài liệu này; `.design-reference/image-integration-baseline.json` (hash kiểm tra phạm vi); `.design-reference/inventory-images-edit.png` (fixture screenshot). Regression hiện có tạo lại `inventory-register-{1440,1024,768,390,320}.png`, `inventory-preview-{1440,320}.png`, `inventory-map-preference-mobile.png`. Build tạo artifacts trong `dist/`; không commit artifacts.

## Kiểm thử

| Nhóm | Kết quả |
| --- | --- |
| Syntax parse toàn bộ source | PASS, 215 JS/JSX/TS/TSX files |
| `npm test` | PASS, 6 tests |
| `tests/managed-warehouse-booking.test.cjs` | PASS, 3 tests |
| `check-inventory-contract.cjs` | PASS |
| `check-managed-contract.cjs`, `check-self-storage-contract.cjs` | PASS |
| Browser IMAGE fixtures | PASS, 66 request fixture, 0 request Backend thật; multipart/bearer, type/size/count, quota/mạng/retry cùng key, double-click, register failure/retry, register/detail/refresh, preview, add/discard/remove/reorder/save/GET, upload 401, responsive 320/390/768/1440 |
| Browser Inventory regression hiện có | PASS, 72 request fixture; DTO, edit guards, pagination, detail/history, preferred Cell, ownership/network/401; widths 320/390/768/1024/1440 |
| Production build | PASS; còn cảnh báo chunk lớn hơn 500 KB |
| Live Backend E2E | NOT RUN — chưa có phê duyệt upload ảnh và tạo Item thật |

Browser fixture chạy bằng Edge headless. Test Inventory cũ được đổi port và storage fixture sang sessionStorage trong bộ nhớ để phù hợp Remember Me hiện tại; không sửa file test cũ, auth implementation hoặc token storage. Fixture API được intercept hoàn toàn, external traffic bị chặn. Single-frame/MIME-content validation thực bằng Sharp, transaction và Cloudinary cleanup cần xác nhận ở live environment.

Hash trước/sau xác nhận chỉ 5 source hiện có liệt kê trên thay đổi, cộng helper mới. BE-REF/src và BE-REF/docs không đổi. Không truy cập thư mục backend bị cấm; không sửa dependency, config, route, auth, Staff/Manager/BOM, Inbound/Outbound, pricing, contract hoặc payment.

## Giới hạn Backend và điều kiện chạy tiếp

Backend hiện từ chối upload mới ở `NODE_ENV=production` (503) vì delivery URL đang public. Không có workaround Frontend. Chỉ dùng ảnh development không nhạy cảm; Item vẫn render ảnh legacy HTTP(S). Image metadata chi tiết chỉ có trong upload response, Item GET trả URL array nên không dựng metadata/ID upload cho ảnh persisted.

Để chạy live: Backend development với Cloudinary cấu hình server-side, MongoDB replica set/transaction-capable, quota indexes sẵn sàng, Customer và reservation được phép đăng ký/edit, dữ liệu/ảnh test được phê duyệt. Sau đó kiểm tra upload → register → GET/refresh → edit/add/remove/reorder → PATCH → GET, và kiểm tra cleanup riêng theo chính sách Backend.
