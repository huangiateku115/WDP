# M4 Staff / Facility Manager — kiểm thử thực tế 16/11/2026

## Phạm vi và môi trường

- Frontend local đang chỉnh, backend `https://wdp-m4ns.onrender.com/api/v1`.
- Staff `dattpse182773`, Manager `pdat0702`; cùng cơ sở `6ac29e8c72e5062a4e646ccd`.
- Không thay đổi code backend, trạng thái thanh toán, hợp đồng hay kho thật.
- Người dùng đã cho phép phân công, xử lý và đóng đúng phiếu test bên dưới.
- Kết quả này chỉ áp dụng những bước thực sự chạy; không phải chứng nhận toàn bộ hai luồng từ tạo đơn đến kết thúc.

## Bằng chứng chạy thực tế

Phiếu `TEST-QA-M4-20261116-P1`, ID `6afa84f52e969f1cb4d2b165`, không liên kết storage unit.

1. Manager tạo phiếu qua trang Bảo trì: thành công, OPEN.
2. Manager phân công Staff `6acd0a0f0a278ee519a0476d`: thành công, ASSIGNED.
3. Staff đăng nhập, thấy phiếu trong Công việc hằng ngày và mở được chi tiết.
4. Staff bắt đầu xử lý: IN_PROGRESS.
5. Khi chưa nhập kết quả xử lý, nút hoàn tất bị vô hiệu hóa.
6. Staff nhập kết quả test, xác nhận: RESOLVED.
7. Staff đóng phiếu: CLOSED.
8. Tải lại chi tiết: vẫn CLOSED, giữ kết quả xử lý.
9. Quay lại Công việc hằng ngày: phiếu đóng không còn trong hàng đợi.
10. GET chi tiết bằng cả Manager và Staff: cùng CLOSED, assignedTo đúng Staff; resolvedAt `2026-11-16T04:27:10.318Z`, closedAt `2026-11-16T04:27:37.315Z`.

## Kết quả theo mục P1

| Mục | Đã xác minh | Chưa xác minh / còn chặn |
| --- | --- | --- |
| 030 | Self Storage test hiển thị PAID, hợp đồng DRAFT, chưa có bằng chứng; quá hạn ký được cảnh báo và không có bước bàn giao sẵn sàng | Chưa chạy checkout thật, ảnh bằng chứng, thu phí phát sinh, thanh toán và gửi lại yêu cầu |
| 031 | API tổng quan tồn kho của hai vai trò trả 200; cơ sở hiện có `rows: []` | Chưa có hàng, lịch đến hoặc phiên để chạy nhập/xuất và chống ghi nhận trùng thực tế |
| 032 | Staff tải hộp thư; tìm kiếm và chọn chưa đọc hoạt động trên trạng thái rỗng; API 200, 0 thông báo | Chưa có thông báo để thử đánh dấu đã đọc, nhận thông báo theo sự kiện hoặc liên kết đến hồ sơ |
| 033 | Phiếu phân công xuất hiện đúng Staff, mở được; đóng phiếu thì rời hàng đợi | Chưa xác minh CHECKIN_READY trên hàng đợi thực tế; phần này mới có kiểm thử tự động |
| 034 | Chuỗi tạo → phân công → xử lý → giải quyết → đóng, tải lại và đối chiếu hai vai trò đã thành công | Không có ảnh bảo trì; phiếu test không gắn kho nên chưa kiểm tra đồng bộ trạng thái kho hay ngăn đặt kho bảo trì |
| 035 | Manager tải hộp thư; chọn chưa đọc, tìm kiếm trên trạng thái rỗng; API 200, 0 thông báo | Chưa xác minh thông báo sắp hết hạn, quá hạn, lịch đến, đánh dấu đã đọc hoặc liên kết hồ sơ |

## Vướng mắc và thiếu sót

- Staff GET danh sách đơn Managed qua `/reservations/facility/{facilityId}?serviceType=MANAGED_INVENTORY` vẫn 403. Manager cùng cơ sở trả 200, có một đơn.
- Staff GET chi tiết Managed `6af65e5911aad020300b86be` vẫn 403; Manager trả 200, trạng thái RESERVED, phiên bản 3. Không đổi thanh toán hoặc ký giả để đi tiếp.
- GET lịch đến cơ sở và phiên truy cập của cả hai vai trò trả 200 nhưng đều rỗng.
- Self test `6af65e4111aad020300b86b9` đã quá hạn ký, hợp đồng DRAFT: chưa đủ điều kiện để chạy bàn giao và checkout.
- Giao diện còn nhãn tiếng Anh: `Draft inspection`, `Rental start date`, `Rental start date has passed`, `Request creation date`, `Status saved: ...`, nút `Chuyển sang IN_PROGRESS/RESOLVED/CLOSED`. Đây là thiếu sót trình bày, chưa sửa trong lượt kiểm thử này.
- Bộ lọc ngày mới có kiểm thử tự động; thao tác công cụ điền ngày trên trình duyệt không giữ được giá trị sau khi render lại, chưa đủ bằng chứng kết luận lỗi thao tác người dùng.

## Kiểm thử tự động liên quan

Bộ 73 kiểm thử frontend liên quan đã đạt ở lượt chỉnh trước; build và kiểm tra định dạng thay đổi đạt. Không coi kết quả này thay thế các bước nghiệp vụ thực tế còn chặn ở trên.

## Đề xuất cập nhật Issue Tracker

- 034: ghi nhận phần vòng đời phiếu đã QA đạt; toàn mục vẫn chờ BE cho ảnh và xác minh trạng thái kho.
- 033: ghi nhận phân công/hàng đợi đã chạy thật; còn QA trạng thái CHECKIN_READY và các nhánh khác.
- 030, 031, 032, 035: giữ kết quả từng phần; không đánh dấu toàn mục hoàn tất.

Phiếu test được giữ ở CLOSED để đối chiếu, không xóa. Chưa commit hoặc push.
