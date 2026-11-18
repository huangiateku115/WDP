# Thống kê Manager — 17/11/2026

## Phần thực hiện

- Trang `/manager/reports`, menu **Thống kê và báo cáo**.
- Giao diện cùng hệ thống thẻ số liệu, bộ lọc và bảng của Admin/BOM; nội dung Manager bằng tiếng Việt.
- 18 báo cáo trong 6 nhóm: tổng quan, tài chính, sức chứa, đơn/hợp đồng, vận hành, phân tích.
- Bộ lọc phù hợp từng báo cáo: ngày Việt Nam, dịch vụ, nhóm thời gian, kích thước kho, trạng thái, thao tác, cửa sổ hết hạn và so sánh kỳ trước.
- Cơ sở cố định theo tài khoản Manager. Kiểm tra phạm vi trong phản hồi, không nhận dữ liệu cơ sở khác.
- Báo cáo sức chứa hiện tại không gửi bộ lọc ngày; không mô tả snapshot thành lịch sử sử dụng.
- Không đổi `null` thành 0. Tiền hoàn, dòng tiền ròng và doanh thu ghi nhận chưa có nguồn đầy đủ được ghi rõ là chưa có dữ liệu.
- Xuất CSV/XLSX/PDF cho các báo cáo được API hỗ trợ; giữ bộ lọc đã áp dụng, không gửi tham số phân trang khi xuất.
- Các đường dẫn báo cáo doanh thu, sử dụng và đơn thuê cũ của Manager được nối đến màn mới.

## Kiểm tra Admin/BOM

Đối chiếu code hiện tại: đã có dashboard và các trang báo cáo cũ, sử dụng thẻ/bảng và API vận hành. Chưa thấy frontend gọi bộ `/statistics` mới; báo cáo doanh thu cũ vẫn ở trạng thái chờ API. Không chỉnh code trang hoặc route Admin/BOM.

## Kiểm thử

- 64/64 kiểm thử frontend liên quan đạt; build thành công; `git diff --check` đạt.
- Test bao phủ bộ lọc từng endpoint, kỳ tối đa 366 ngày, ngày không hợp lệ, từ chối scope toàn hệ thống/khác cơ sở, giữ giá trị null, chỉ cho phép GET thống kê, quyền Manager và lỗi API.
- API Render: 18 báo cáo trả 200, scope đúng HCM 1; API filters trả đúng cơ sở.
- API xuất CSV, XLSX và PDF trả 200 với Content-Type tương ứng.
- Trên giao diện Manager: mở từ menu, tổng quan có 6 đơn; lọc Managed còn 1 đơn; sức chứa Managed trả 4 ô và 7,2 m³.
- Đã bấm và tải thành công cả ba tệp CSV/XLSX/PDF từ giao diện, báo cáo tiền đã thu.
- Kiểm tra desktop 1280 px và màn hình hẹp; đã sửa tràn ngang ở màn hình hẹp. Trở về kích thước trình duyệt mặc định sau kiểm tra.

## Giới hạn

- Kết quả API được kiểm tra trên dữ liệu hiện có, không thay thế kiểm chứng các chỉ số tài chính bằng sổ kế toán độc lập.
- Chưa có dữ liệu đủ lớn để thử phân trang nhiều trang, giới hạn xuất 1.000 dòng hoặc tất cả nhánh lỗi export 413/timeout.
- Không sửa backend hoặc dữ liệu nghiệp vụ. Chưa commit, push hoặc deploy.
