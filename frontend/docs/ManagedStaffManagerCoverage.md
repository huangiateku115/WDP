# Đối chiếu giao diện nhân viên và quản lý — mục 10

Nguồn: `WDP_API_Tung_Request_Va_Luong_Thuc_Hanh (5).docx`, đối chiếu với mã nguồn backend hiện có. Chưa khẳng định các API đề xuất trong tài liệu đã được triển khai trên máy chủ deploy.

## Phân chia trách nhiệm

Khách tự khai báo nhập, xuất và di chuyển hàng trong luồng mới. Nhân viên hỗ trợ truy cập, an toàn và xử lý sự cố; quản lý giám sát và cấu hình không gian. Các trang nhân viên xác nhận nhập/xuất/di chuyển theo quy trình cũ chuyển về giám sát, không còn được mở để ghi biến động tồn từ menu.

## Đã triển khai giao diện có API hiện hữu

| Chức năng | Nhân viên | Quản lý | Trang |
|---|---|---|---|
| Danh sách hàng theo cơ sở, tìm kiếm, trạng thái, phân trang | Xem | Xem | `/staff/managed`, `/manager/managed` |
| Tồn hiện tại, lượng giữ và lô hàng theo mặt hàng | Xem | Xem | `/{role}/inventory/stock?itemId={id}` |
| Lịch sử biến động hàng | Xem | Xem | `/{role}/inventory/items/{id}/history` |
| Bản đồ kho | Xem | Xem | `/{role}/warehouse-map` |
| Lịch khách đến và phiên truy cập | Xác minh, check-in, kết thúc và thu hồi phiên được giao | Phân công nhân viên, giám sát và thu hồi vì an toàn | `/{role}/managed-access` |
| Giám sát nhập hàng tự quản V3 | Theo dõi biến động trong phiên được giao, không nhập thay khách | Xem tồn, vị trí lô, dung lượng và tình trạng đối soát | `/{role}/managed-inventory-v3` |
| Khu vực, kệ, kích thước và tải trọng ô | Không ghi | Tạo khu vực/kệ, sửa khu vực/kệ/ô | `/manager/warehouse-settings` |
| Kiểm tra điều kiện kết thúc đơn | Chưa được cấp API đọc | Xem báo cáo, không đóng đơn | `/manager/managed?tab=checkout` |
| Hợp đồng giấy và bàn giao V3 thanh toán 100% | Chưa được cấp API đọc đơn Managed | Tạo hợp đồng sau thanh toán đủ, xác minh bản giấy và bàn giao từ CHECKIN_READY | `/manager/reservations/{id}?service=managed` |

API đọc dùng `GET /inventory-items`, `GET /inventory-items/:id`, `GET /inventory-items/:id/stock-balance`, `GET /inventory-items/:id/movements`. Cấu hình dùng GET/POST/PATCH `/warehouse-zones`, `/racks`; GET/PATCH `/rack-cells`. Báo cáo dùng `GET /reservations/managed/:id/closure-readiness` sau khi kiểm tra đơn đúng cơ sở.

Thao tác cấu hình kiểm tra dữ liệu đầu vào, yêu cầu xác nhận và đọc lại bản ghi sau khi lưu. Nếu chưa xác minh kết quả, không báo thành công và yêu cầu tải lại để đối chiếu, tránh gửi trùng.

## Hợp đồng giấy cho đơn Managed thanh toán 100%

1. Manager mở đơn bằng đường dẫn ở cột Theo dõi của mặt hàng hoặc nhập ID tại danh sách đơn hàng hóa. API danh sách tất cả đơn Managed theo cơ sở vẫn chưa có; danh sách mặt hàng không thay thế danh sách đơn.
2. Khi đơn PAID và chưa có hợp đồng, tạo hợp đồng từ báo giá đã thanh toán. Giao diện kiểm tra phiên bản, cơ sở, khách và đơn sau khi đọc lại.
3. Hai bên ký bản giấy tại cơ sở. Manager tải ảnh/PDF tối đa 10 MB, nhập thời điểm ký thực tế của khách và đại diện cơ sở, xác nhận đã kiểm tra danh tính. Giao diện gửi documentVersion, documentHash, customerSignedAt, facilitySignedAt, customerIdentityVerified cùng proofFile. Không gọi API ký điện tử của luồng cũ cho đơn thanh toán 100%.
4. Backend xác minh và chuyển đơn sang CHECKIN_READY, hợp đồng SIGNED. Không hiển thị bước thanh toán phần còn lại.
5. Khi trong kỳ thuê, còn ô được phân bổ và hợp đồng đủ hai chữ ký trên phiên bản hiện hành, Manager nhập tình trạng và ghi chú bàn giao. Không cho xác nhận tình trạng UNSAFE. API Managed chỉ nhận storageCondition và accessNotes; xác minh danh tính là điều kiện thao tác trên giao diện, chưa có trường lưu riêng trong API bàn giao hiện tại.
6. Đọc lại đơn ACTIVE và dấu vết bàn giao trước khi báo thành công. Không tuyên bố đã nhập hàng, cấp mã khóa số hoặc hoàn thành phiên truy cập.

Đơn cũ không có FULL_UPFRONT_V1 giữ nhánh xử lý phiên bản trước. Nếu phiên bản hợp đồng thay đổi, thời điểm ký không hợp lệ, sai cơ sở hoặc quá hạn ký, không gửi bằng chứng. Nếu kết quả gửi chưa xác định, yêu cầu tải lại để đối chiếu trước khi gửi tiếp.

Liên kết Điều kiện trả không gian tự điền ID đơn tại `/manager/managed?tab=checkout&reservationId={id}`. Đây vẫn chỉ là báo cáo đọc, không tự đóng đơn hoặc giải phóng ô.

## Chưa thể hoàn tất vì thiếu API hoặc quyền backend

| Mục 10 yêu cầu | Hiện trạng |
|---|---|
| Lịch khách đến, phân công hộ tống, xác minh danh tính | Đã nối API `/access/managed-v3/visits`; chỉ đúng nhân viên được giao mới check-in |
| Bắt đầu, kết thúc hoặc thu hồi phiên truy cập | Đã nối `/access/managed-v3/sessions`; kết thúc phiên không phải kết thúc hợp đồng |
| Sự cố hàng hóa, ngoại lệ tồn, đối chiếu có phê duyệt | Chưa có API chuyên biệt; hỗ trợ/bảo trì không được coi là biên bản sự cố hàng hóa |
| Nhóm ô liền kề và chứng nhận hình học/tải trọng | Chưa có API nhóm ô/chứng nhận |
| Nhân viên xác nhận trả không gian, quản lý đóng đơn/giải phóng ô | Chưa có API xác nhận tương ứng; báo cáo điều kiện chỉ đọc không thực hiện giải phóng |
| Nhân viên đọc chi tiết đơn Managed | Route hiện tại chưa cho quyền FACILITY_STAFF |
| Danh sách đơn Managed theo cơ sở cho quản lý | Chưa có danh sách chuyên biệt; mở chi tiết bằng ID thật |

Tab lịch truy cập dẫn tới chức năng đã nối API. Sự cố chuyên biệt và xác nhận trả không gian vẫn chưa khả dụng, không hiển thị nút xác nhận giả hay tự sửa tồn. Không gọi các đường dẫn `/api/v2/managed/...` mới ở mức đề xuất. Nhập tự quản V3 hiện đã có API; xuất và di chuyển tự quản chưa được tính là hoàn tất.

## Cách kiểm tra trên giao diện

1. Đăng nhập nhân viên đã được phân công cơ sở; mở `/staff/managed`, tìm mặt hàng thật, lọc trạng thái và mở tồn/lịch sử. Đối chiếu mã hàng, cơ sở và lô với dữ liệu backend.
2. Mở một đường dẫn nhập/xuất/di chuyển cũ; phải chuyển về `/staff/managed`, không hiện biểu mẫu ghi tồn cũ.
3. Đăng nhập quản lý cùng cơ sở; mở `/manager/managed` để xem cùng dữ liệu hàng hóa.
4. Mở `/manager/warehouse-settings`; xem khu vực/kệ/ô. Khi cần cấu hình thật, nhập kích thước, tải trọng và tọa độ thực tế, kiểm tra rồi xác nhận. Chỉ coi là hoàn tất khi đã đọc lại được kết quả từ backend.
5. Mở tab Trả không gian, nhập ID đơn Managed thuộc cơ sở. Báo cáo thể hiện tồn, lượng giữ và các điều kiện chặn/chưa xác định; không có hành động tự đóng hoặc giải phóng ô.
6. Customer tạo lịch ở `/portal/managed-access`. Manager mở `/manager/managed-access`, chọn lịch và phân công nhân viên cùng cơ sở, ghi lý do rồi xác nhận. Staff mở `/staff/managed-access`, trong giờ hẹn tích đủ ba xác nhận và nhập ghi chú an toàn để bắt đầu phiên. Backend kiểm tra điều kiện đơn/hợp đồng/thanh toán/ô được thuê.
7. Customer nhập hàng V3 trong phiên hợp lệ. Staff và Manager xem tại `/{role}/managed-inventory-v3`. Staff không có nút xác nhận nhập thay; tồn chưa đối soát không được trình bày như số liệu đã xác nhận. Dung lượng ô chỉ là số liệu hiện tại, chưa khẳng định đối soát toàn bộ.
8. Staff xác nhận khách rời kho để kết thúc phiên. Staff/Manager có thể thu hồi phiên đang hoạt động với lý do an toàn. Giao diện đọc lại phiên và lịch đến kho trước khi báo thành công; phiên hết hạn không còn nút thao tác. Hợp đồng thuê không bị kết thúc bởi thao tác này.
9. Nếu kết quả check-in chưa rõ, thử lại giữ đúng nội dung và khóa yêu cầu theo từng tài khoản nhân viên. Nếu khách sửa lịch hoặc nhân viên đã bị thay đổi, tải lại và phân công lại; không ép xác nhận bằng dữ liệu cũ.

Chưa thể tuyên bố hoàn tất toàn bộ mục 10: các phần cuối cần nhóm backend bổ sung API/quyền và kiểm thử tích hợp sau khi triển khai. Không sửa backend hay giao diện Customer/Admin/BOM trong đợt này.
