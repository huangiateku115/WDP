# Kết quả kiểm thử Staff / Facility Manager — 18/11/2026

## Phạm vi và cách kiểm

- Frontend localhost, backend Render `https://wdp-m4ns.onrender.com/api/v1`, code hiện tại sau pull dev HEAD `8e41567`.
- Thực hiện thao tác nghiệp vụ qua API với Customer, Staff, Manager; đối chiếu một số màn hình bằng trình duyệt. Không phải mọi nút trên giao diện đều đã được bấm thủ công.
- Chỉ dùng bộ dữ liệu TEST-M4 trong database test. Thanh toán, nội dung hợp đồng, chữ ký và tình huống bàn giao là mô phỏng; không có chuyển tiền thật hay ký kết pháp lý thật.
- Không sửa mã nguồn backend/frontend, không push. Dữ liệu kết quả chi tiết nằm ở `artifacts/TEST-M4-20261118-FULL.json`; không đưa token/PIN vào báo cáo.

## Các nhánh đã chạy thành công

| Nhóm | Thao tác thực tế | Kết quả |
|---|---|---|
| Self Storage: hợp đồng | Đơn TEST mới đã chuẩn bị PAID → tải PNG ghi rõ mô phỏng → xác minh bằng chứng → Staff bàn giao | API thành công; đơn ACTIVE. Đã kiểm tra đường tải ảnh lên dịch vụ lưu trữ |
| Self Storage: PIN | Gọi cấp lại PIN đã có → kiểm PIN sai → PIN đúng | Cấp lại 200; PIN 6 số; sai 401; đúng mở cửa thành công |
| Self Storage: trả kho | Customer yêu cầu → Staff từ chối thiếu lý do → từ chối có lý do → Customer gửi lại → Staff nghiệm thu GOOD | Thiếu lý do bị chặn 400; các bước hợp lệ thành công; đơn CHECKED_OUT, kho AVAILABLE |
| Thu hồi truy cập | Thử mở cửa sau trả kho | Bị chặn 403 đúng trạng thái |
| Managed: phiên đến kho | Manager phân công lịch TEST → Staff thiếu xác nhận an toàn → bổ sung xác nhận → bắt đầu phiên → gửi lặp | Thiếu xác nhận bị chặn 400; tạo phiên thành công; thời hạn 60 phút; hỗ trợ INBOUND/OUTBOUND/RELOCATION |
| Managed: nhập | Customer nhập thêm 2 → gửi lại cùng yêu cầu | Tồn 10 → 12; không ghi trùng |
| Managed: xuất | Customer xuất 3 → gửi lại cùng yêu cầu | Tồn 12 → 9; không ghi trùng |
| Managed: di chuyển | Chuyển 2 từ C1 sang C2 → gửi lại | Tổng vẫn 9; C1=7, C2=2; không ghi trùng |
| Managed: thu hồi phiên | Manager thu hồi → Customer thử nhập tiếp | Thu hồi thành công; thao tác tiếp bị chặn 409 |
| Hỗ trợ | Tạo phiếu TEST → phân công → bỏ phân công → giao lại → Staff xử lý → giải quyết → đóng | Thành công. Staff chưa được giao bị chặn 403; giải quyết thiếu nội dung bị chặn 400 |
| Tin nhắn hỗ trợ | Staff ghi nội bộ + công khai → Customer đọc | Customer chỉ thấy tin công khai; không lộ tin nội bộ |
| Bảo trì | Tạo phiếu TEST → phân công/bỏ/giao lại → đang xử lý → giải quyết → đóng | Thành công; thiếu nội dung giải quyết bị chặn 400 |
| Cấu hình kho | Manager tạo khu/kệ/ô TEST → thử trùng mã → thử tải trọng 0 → đổi trạng thái ô | Tạo thành công; trùng 409; tải trọng sai 400. Staff tạo/sửa bị chặn 403. Ô TEST cuối cùng BLOCKED |
| Bản đồ | Manager đọc bản đồ kệ; Staff đọc bản đồ cơ sở | 200 |
| Thống kê | 18 loại báo cáo Manager | Tất cả 200; Staff truy cập thống kê bị chặn 403 |
| Xuất báo cáo | CSV, XLSX, PDF báo cáo doanh thu | 200; đúng định dạng file: BOM CSV, ZIP XLSX, `%PDF` |
| Phạm vi đơn và thống kê | Đọc đơn Managed, thống kê của cơ sở khác | 403 đúng quyền |

### Giao diện đã đối chiếu

- Manager: tồn kho, lịch sử nhập/xuất/di chuyển, chi tiết phiếu hỗ trợ đã đóng.
- Staff: danh sách Self có đơn TEST mới ACTIVE và hai đơn TEST đã trả kho; lựa chọn Lưu trữ hàng hóa xuất hiện; danh sách và chi tiết Managed đọc được, không còn bị chặn 403 như trước.
- Tồn kho Manager thể hiện đúng 9 và lịch sử không bị nhân đôi. Có lỗi trình bày số lẻ thể tích, ghi bên dưới.
- Chi tiết hợp đồng của một fixture Managed cũ báo không khớp phiên bản/thông tin. Không coi đây là bằng chứng lỗi production: fixture này đã chuẩn bị chữ ký/hợp đồng mô phỏng từ trước; chưa có ca Managed mới đầy đủ từ booking đến ký hợp đồng hiện hành.

## Vướng mắc cần báo

### Backend / cấu hình

1. **036 — API kiểm tra kho còn lộ dữ liệu ngoài cơ sở.** `GET /inspections` với cả Manager và Staff HCM1 trả 11 bản ghi, trong đó 10 bản ghi ngoài HCM1. Cần lọc theo cơ sở tài khoản và kiểm tra quyền trên chi tiết/thao tác ghi. Chỉ kiểm chứng đọc; không thử sửa bản ghi của cơ sở khác.
2. **Đặt lịch Managed tại HCM1 chưa chạy được:** API availability trả 409 `VISIT_SCHEDULE_NOT_CONFIGURED`, thiếu cấu hình giờ hoạt động/độ dài slot. Chưa thay đổi cấu hình dùng chung. Đã dùng lịch mô phỏng riêng để kiểm tiếp các bước sau; không tính bước Customer đặt lịch là PASS.
3. **Đóng đơn/trả không gian Managed chưa hoàn chỉnh:** `closure-readiness` chỉ là chẩn đoán, không đóng đơn hay trả quota. Với SKU đã nhập/xuất/di chuyển thành công, endpoint vẫn trả `STOCK_LEDGER_UNKNOWN`, số lượng null và `PHYSICAL_COUNTER_UNKNOWN`, dù counter lưu ở ô là 7 và 2, dung lượng đơn 0.072 m³. Cần đối chiếu nguồn ledger V3. Đồng thời còn `FINANCIAL_POLICY_UNRESOLVED` và `DISPOSITION_POLICY_UNRESOLVED`. Đơn đang còn hạn và còn hàng nên không kỳ vọng đóng được ngay, nhưng trạng thái không xác định cần được làm rõ.
4. **Chuyển cấp phiếu hỗ trợ bị chặn:** 409 `Facility escalation requires exactly one active Facility Manager`. Cần kiểm tra dữ liệu phân công quản lý/cách chọn người nhận chuyển cấp. Chưa kết luận do trùng tài khoản nếu chưa đối chiếu danh sách quản lý hoạt động.
5. **Thông báo tự động chưa xác nhận hoạt động:** `/notifications/me` của cả hai vai trò trả danh sách rỗng sau các nghiệp vụ test. API đọc có, nhưng chưa chứng minh có phát sinh thông báo theo sự kiện. Cần BE kiểm tra trigger/người nhận. Chưa kiểm hộp email.
6. **Bảo trì mới chứng minh được vòng đời phiếu.** Chưa chứng minh được đồng bộ trạng thái kho MAINTENANCE → AVAILABLE và chặn booking khi bảo trì. Service được rà soát chưa thấy cập nhật StorageUnit; cần BE hoàn thiện/kiểm chứng phần này và upload ảnh theo yêu cầu.

### Frontend

- Tại chi tiết tồn kho, thể tích hiển thị `0.07200000000000001` thay vì số đã làm tròn như `0.072 m³`. Cần định dạng số.
- Một số lời dẫn còn nhắc “phiên bản 3”, “bản chốt báo giá ô”; nên tiếp tục làm gọn ngôn ngữ cho người dùng.

## Những phần chưa được tính hoàn tất

- Customer tạo booking mới hoàn toàn và PayOS thật; webhook, hoàn tiền, thanh toán phụ phí.
- Ký hợp đồng thật, xác minh danh tính thật, bàn giao vật lý thật.
- Managed: Customer đặt lịch qua slot đang bị cấu hình chặn; hợp đồng/bàn giao Managed mới theo phiên bản hiện hành; xuất hết và đóng đơn/trả không gian cuối cùng.
- Chờ phiên tự hết đúng 60 phút; mới kiểm tra TTL và nhánh thu hồi chủ động.
- Upload ảnh hiện trạng trả kho, tính/thu phí hư hỏng, trả kho DAMAGED và toàn bộ liên kết bảo trì.
- Tự động email/thông báo theo sự kiện; xác nhận mọi nút UI và mọi kích thước màn hình.

## Dữ liệu TEST để đối chiếu

- Self mới ACTIVE: `6afd8e072ca8d3481cd0c4be`, mã `TEST-M4-20261118-FULL-SELF`.
- Self trả kho trong lần chạy này: `a1d6f1c828a859df4642ca2d`.
- Managed nhập/xuất/chuyển: `3852cf7992b490695d2a6886`; SKU `d9b7c1de2c3112e7a0fef036`.
- Phiên Managed đã thu hồi: `6afd8c7386c809f05df1ddbe`.
- Hỗ trợ CLOSED: `6afd8d0686c809f05df1ddce`.
- Bảo trì CLOSED: `6afd8d2586c809f05df1dddd`.
- Ô cấu hình TEST đang BLOCKED: `6afd8eb286c809f05df1de08`.

Không sử dụng số liệu thanh toán/chữ ký mô phỏng trong bộ này để báo cáo doanh thu hoặc chứng minh giao dịch thật.
