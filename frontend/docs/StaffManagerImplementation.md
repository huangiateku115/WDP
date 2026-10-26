# Staff và Facility Manager sau cập nhật dev ngày 26/10/2026

Phần frontend vận hành đã có các luồng khách hàng, duyệt đơn, nhận/trả kho, hợp đồng giấy, bảo trì, hỗ trợ; lượt này thêm bảng công việc và mô phỏng truy cập. Chưa thể gọi toàn bộ yêu cầu Excel là hoàn tất: hoàn tiền, gia hạn, phí phát sinh và quản lý quyền truy cập còn thiếu API backend. Không dùng dữ liệu mock để thay thế các chức năng chưa có API.

## Nguồn đối chiếu và phạm vi

- Code local sau pull: `3d193aa`. So với lần trước `cc8632d`, không có thay đổi trong `backend/`; thay đổi chính là frontend BOM/Admin và một số module dùng chung.
- Tài liệu `WDP_API_Tung_Request_Va_Luong_Thuc_Hanh (1).docx`: luồng Self Storage, hợp đồng giấy, Managed Inventory, maintenance/support/access. Tài liệu có mục tự ghi chưa kiểm chứng source; routes/controller/service trong repo được dùng để xác nhận method, quyền và dữ liệu.
- Excel `Self_Storage_Project_Tracking_WDP301_Group4 (2).xlsx`, `Team_Assignment!A6:E6`: Đạt phụ trách ứng dụng vận hành Staff/Facility Manager. Dòng 9 chia trách nhiệm theo ứng dụng, không phải mọi API có cùng role đều thuộc phần cá nhân.
- `Iter1!A14:J15`, `Iter2!A6:J6` và `A18:J19`, `Iter3!A5:J25`: đối chiếu các chức năng dưới đây.
- `Product!A42:J43` mô tả bàn giao số/mô phỏng, nhưng Iter3 vẫn có mô tả thẻ/khóa vật lý. Bản web theo hướng mô phỏng phần mềm của Product, không tích hợp thiết bị.
- Iter4 ghi M4 cho một số báo cáo/cấu hình, trái với Team_Assignment giao toàn bộ back-office cho M5. Không sửa hay nhận phần BOM/Admin của thành viên khác. P034/P035 mobile không được coi là hoàn thành React Native chỉ vì web chạy responsive.

## Trạng thái theo chức năng

| Phạm vi | Frontend/API hiện có | Phần còn thiếu |
| --- | --- | --- |
| P010 khách hàng | Tìm theo tên/email/điện thoại, xem hồ sơ; Staff và Manager xem lịch sử Self Storage trong cơ sở | API khách hàng vẫn trả danh sách chung; không hiển thị CCCD. Không phải lịch sử toàn hệ thống |
| P011 xác minh | Ghi trạng thái và ghi chú qua API | Lịch sử đầy đủ phụ thuộc dữ liệu backend |
| P013 duyệt đặt chỗ | Manager duyệt/từ chối; Staff chỉ đọc theo quyền route thực tế | Thông báo khách do backend chịu trách nhiệm |
| P064/P065 hoàn tiền | Trang mock tiếp tục ẩn | Thiếu API tính theo policy, tạo/duyệt yêu cầu, thực hiện và receipt/idempotency |
| P025 nhận kho | CHECK_IN DRAFT → COMPLETED; kiểm tra hợp đồng, đơn, tủ, xác minh ACTIVE/OCCUPIED | Backend cần bảo đảm scope và transaction; frontend không thay thế kiểm soát server |
| P026 trả kho | CHECK_OUT; đơn CHECKED_OUT, tủ AVAILABLE hoặc MAINTENANCE | Chưa đối soát công nợ, phí thiệt hại, hoàn cọc hay đóng tài chính |
| P029 gia hạn | Trang mock tiếp tục ẩn | Thiếu API yêu cầu/duyệt, chống trùng lịch, giá và phiên bản hợp đồng |
| P030 inspection | Biên bản gắn đơn/tủ, điều kiện, ghi chú checklist và URL ảnh | Checklist lưu trong notes, chưa schema checklist độc lập |
| P031 bảo trì | Tạo/sửa/phân công/bỏ phân công, IN_PROGRESS → RESOLVED → CLOSED | Không tự khẳng định ticket khóa tủ hoặc đổi trạng thái tủ; việc này cần backend xác nhận |
| P038 hỗ trợ | Tạo theo quyền Manager, phân công, nội bộ/công khai, ghi kết quả và đóng | Gửi notification do backend; không báo đã gửi nếu response không chứng minh |
| P039 bàn giao | In dữ liệu, upload proofFile, chờ balance, handover và đọc lại ACTIVE/OCCUPIED | Chưa có bằng chứng xác nhận số của Customer/checklist độc lập. Cloudinary từng disabled ngày 22/10, chưa kiểm tra lại live hôm nay |
| P040 truy cập | Trang mới gọi simulate-unlock; kiểm tra lại cơ sở/ACTIVE; PIN sai giữ phiên, thành công phải đúng đơn/tủ/khách | Chưa có lock/suspend/revoke/reset, nhật ký Staff/Manager; API /access/me chỉ cho Customer |
| P044 phân công | Bảng gom maintenance/support, mở chi tiết phân công thật; Staff xem ticket được giao | Chưa API danh bạ Staff cho Manager; nhập User ID. Chưa phân công handover/inspection hoặc lịch khả dụng nhân viên |
| P045 công việc ngày | Gom kỳ thuê, biên bản nháp, maintenance/support; lọc ngày/loại/người/từ khóa; nhóm theo assignee; cảnh báo ưu tiên cao chưa giao, ngày thuê đã qua | Chỉ Self Storage và desk. Ticket không có hạn nên không tự suy ra SLA; không có API lịch tác nghiệp độc lập |

## Thay đổi đã thực hiện

1. Sửa `checkInEligibility` đọc biến contract trước khi khởi tạo sau merge dev. Hợp đồng vẫn phải được đọc và kiểm tra trước thao tác.
2. Khôi phục allowlist GET contracts/:id/print, POST contracts/:id/confirm-signed-paper, POST reservations/:id/handover. Giữ nguyên các route BOM/Admin vừa pull.
3. Bật lịch sử thuê trong cơ sở cho Staff, lọc đúng facility và Self Storage trước hiển thị.
4. Thêm bảng công việc chỉ đọc dữ liệu API; mở trang nghiệp vụ để thao tác phân công. Lấy đủ phân trang desk, không coi lỗi nguồn dữ liệu là danh sách rỗng thành công.
5. Thêm mô phỏng truy cập, xác nhận trước POST, không lưu PIN vào localStorage/sessionStorage, không gọi API access log dành riêng Customer.
6. Chỉ mở thêm menu có API cho Staff/Manager. Customer/Admin/BOM, backend và cấu hình môi trường không thay đổi.

## Đường dẫn và thao tác mới

| Trang | Đường dẫn |
| --- | --- |
| Manager công việc ngày | http://localhost:5173/manager/operations |
| Manager phân công | http://localhost:5173/manager/tasks |
| Staff công việc | http://localhost:5173/staff/tasks |
| Manager mô phỏng truy cập | http://localhost:5173/manager/access |
| Staff mô phỏng truy cập | http://localhost:5173/staff/access |

Bảng ngày dùng giờ Việt Nam. Chọn ngày để xem việc của ngày đó và việc còn mở trước đó. Ngày nhận/trả lấy từ startDate/endDate; ngày của biên bản/ticket lấy từ createdAt, không phải lịch phân công. Bộ lọc nhân viên dựa trên assignee của ticket, không lấy inspectedBy làm người được giao. Tự tải lại mỗi phút khi trang đang hiển thị; cập nhật ngay khi quay về trang hoặc có sự kiện thay đổi trong trình duyệt.

Để trình bày: Manager tạo hoặc mở ticket → mở `/manager/tasks`, chọn ngày phù hợp → bấm tên ticket → nhập Staff User ID và phân công → Staff mở `/staff/tasks` → mở ticket được giao và xử lý → Manager tải lại bảng để thấy trạng thái mới. Ticket CLOSED không còn trong bảng việc mở.

Mô phỏng truy cập: chọn đúng đơn ACTIVE trong cơ sở → nhập PIN thử nghiệm 1234 → Mô phỏng mở khóa → Xác nhận mở khóa. Chỉ thông báo thành công khi response xác nhận UNLOCK_SUCCESS và khớp các ID. Có thể thử PIN sai trên đơn demo để thấy lỗi; phiên đăng nhập vẫn còn. Không mô phỏng chuyển tiền, không coi mở khóa là thiết bị thật.

## Các phụ thuộc nên giao lại backend

- Ưu tiên trước: khôi phục Cloudinary cho hợp đồng giấy; kiểm soát facility/owner ngay trong access controller và inspection complete; nhật ký phải có actor thực hiện, không chỉ customerId.
- Sau đó: hoàn tiền P064/P065; gia hạn P029; khoản phải thu/waive P043 và đối soát P026.
- Tiếp theo: API danh bạ nhân viên cùng cơ sở, lịch/phân công inspection/handover, lưu checklist và customer acknowledgment độc lập.
- Bổ sung API trạng thái khóa, suspend/revoke/reset và nhật ký truy cập theo quyền Staff/Manager.

Không tự đặt tên endpoint rồi gọi khi backend chưa triển khai. Khi có API, đối chiếu routes, DTO và quyền trước khi mở lại menu.

## Kiểm chứng

Các test lượt 26/10 sử dụng browser fixture theo contract source; không tạo hay chỉnh dữ liệu database thật. Test bao gồm phân trang, scope, nguồn dữ liệu lỗi, PIN sai, hết phiên, trạng thái thay đổi trước POST, phản hồi thành công không khớp, mobile, cùng hồi quy nhận/trả kho và service desk. Kết quả live ngày 22/10 là lịch sử, không thay cho xác minh backend hiện tại.

Kết quả cuối lượt: `npm test` 14/14 PASS; `npm run build` PASS (cảnh báo bundle >500 kB); năm bộ browser fixture review, inspection, checkout, facility-operations và board-access PASS; `git diff --check` PASS. Không sửa backend hoặc các trang Customer/Admin/BOM. Chưa commit/push trong lượt 26/10.
