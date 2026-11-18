# M4 — Kết quả frontend và kiểm tra API ngày 17/11/2026

## Phạm vi

Chỉ sửa frontend Staff/Facility Manager. Backend giữ nguyên bản đã pull từ dev; không sửa dữ liệu, thanh toán, hợp đồng hoặc trạng thái đơn. Chưa commit, push hoặc deploy.

## Đã thực hiện

- Nối chi tiết tồn theo ô, quy cách và đơn thuê bằng API tồn hiện có.
- Đọc biến động mới trong báo cáo giám sát; ghép biến động gần đây vào chi tiết và loại trùng. Lịch sử hiển thị là tập dữ liệu có giới hạn, không khẳng định đầy đủ.
- Không dùng projection cũ của báo cáo tổng quan làm số liệu tồn mới đã đối soát. Mở chi tiết mặt hàng để tải tồn theo ô.
- Staff chỉ thấy lịch sử xuất thuộc phiên đang hoạt động được giao; Manager xem trong cơ sở của mình. Giao diện không tự xác nhận nhập/xuất hoặc giảm tồn thay khách.
- Giữ trạng thái chưa xác minh khi số liệu thiếu hoặc chưa đối chiếu; lỗi API không được coi là tồn bằng không hoặc danh sách rỗng thành công.
- Chuẩn bị form hợp đồng giấy/bàn giao Staff; chưa thể nghiệm thu khi backend vẫn chặn quyền đọc đơn Managed.
- Việt hóa nhãn loại công việc, ngày ghi nhận, cảnh báo quá ngày, trạng thái xử lý và lịch sử xuất hàng.

## Kiểm tra

- 59/59 kiểm thử frontend liên quan đạt, gồm hàng đợi, quyền hiển thị, tồn mới, lịch sử xuất theo phiên, lỗi API và điều kiện hợp đồng.
- Build frontend thành công; còn cảnh báo kích thước bundle, không làm build thất bại.
- `git diff --check` đạt; backend không có thay đổi local.
- Kiểm thử dữ liệu giả lập không thay thế chạy đủ luồng nghiệp vụ trên dữ liệu thật.

## API Render chỉ đọc

Frontend đang dùng `https://wdp-m4ns.onrender.com/api/v1`.

| Nội dung | Manager HCM 1 | Staff HCM 1 |
| --- | --- | --- |
| Tổng quan tồn Managed | 200, 0 mặt hàng | 200, 0 mặt hàng |
| Lịch đến cơ sở | 200, 0 lịch | 200, 0 lịch |
| Phiên truy cập cơ sở | 200, 0 phiên | 200, 0 phiên |
| Danh sách đơn Managed cùng cơ sở | 200, 1 đơn | 403 |

Chưa đủ dữ liệu để chạy thực tế nhập → xuất → di chuyển → đối chiếu tồn. Chưa đánh dấu 031 hoàn tất. Chưa có thêm ca nghiệp vụ thực tế thành công so với báo cáo ngày 16/11; lượt này là kiểm thử frontend và đối chiếu API chỉ đọc.

## Cần báo backend

1. **036:** kiểm tra và chặn đọc/tạo/hoàn tất biên bản, duyệt/từ chối trả kho khác cơ sở. Sửa ở frontend không thay thế kiểm tra quyền trên server.
2. **028:** cho FACILITY_STAFF đọc danh sách và chi tiết đơn Managed đúng assignedFacilityId; vẫn chặn cơ sở khác.
3. **031:** API lịch sử mặt hàng hiện chưa cung cấp đầy đủ biến động mới cho các vai trò cơ sở; báo cáo tổng quan vẫn có projection cũ. Frontend chỉ có thể dùng tồn theo ô và tập biến động gần đây mà API đang trả; cần API lịch sử thống nhất, có phân trang để nghiệm thu đầy đủ.
4. **029:** cấp PIN đã có trong code mới, nhưng cần rà phản hồi khi gọi lại bàn giao; cần đơn test có hợp đồng giấy xác minh và xác nhận bàn giao thực tế để thử thành công.
5. **030/034:** còn luồng ảnh nghiệm thu/bảo trì, phí phát sinh và đồng bộ trạng thái kho.
6. **032/035:** cần phát thông báo nghiệp vụ vào hộp thư, kèm thông tin dẫn đến tác vụ; email nhắc hạn là kênh riêng.

## Issue Tracker

- 031: Chờ QA / Bị chặn do chưa có dữ liệu chạy thực tế; ghi nhận phần FE và test tự động đã làm.
- 033: Chờ QA, đã đạt kiểm thử tự động; lịch sử chạy phiếu bảo trì ngày 16/11 được ghi ở báo cáo trước.
- 028: Chờ BE / Bị chặn 403.
- 036: Chờ BE, chưa coi là đã sửa.
- 029: Chờ QA thực tế; chưa có đơn đủ điều kiện.

## Cập nhật sau khi pull quyền Staff — dev `f603e64`

Phần kết quả 403 ở trên là trước khi cập nhật. Đã pull hai commit mới của dev, bao gồm `aea47e0` (fix staff routes and mongo), giữ nguyên toàn bộ thay đổi frontend đang làm; không có xung đột.

- Staff HCM 1 đọc danh sách Managed cùng cơ sở trên Render: **200**, có 1 đơn.
- Staff đọc chi tiết Managed test `6af65e5911aad020300b86be`: **200**, trạng thái **RESERVED**.
- Staff đọc danh sách Managed ở cơ sở HCM khác: **403** như yêu cầu.
- GET hợp đồng của đơn test: **404 Contract not found**, vì đơn chưa có hợp đồng; không còn là lỗi quyền đọc Managed.
- Kiểm thử service bằng dữ liệu giả lập: cùng cơ sở được đọc; khác cơ sở, thiếu phân công bị 403; Customer khác chủ đơn vẫn bị 404.
- 64/64 kiểm thử frontend liên quan đạt; build frontend và kiểm tra kiểu backend đạt.
- Backend không có chỉnh sửa local của M4; chỉ nhận code từ dev.

**028:** lỗi quyền đọc đã được giải quyết. Chưa nghiệm thu toàn bộ bàn giao Managed: còn cần đơn đủ thanh toán và hợp đồng giấy đã xác minh. Chưa push frontend.
