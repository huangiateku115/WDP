# WDP — Bản ghi nhớ yêu cầu dự án

Đọc ngày 2026-10-02 theo yêu cầu người dùng. Người dùng xác nhận đây là tài liệu hiện tại của dự án.
Nguồn: `C:\Users\taing\Downloads\SRS_Self-Storage_Hybrid_Rigorous_v2.docx`.
Tên tài liệu: **Self-Storage Facility Rental and Inventory Management System — Software Requirement Specification**, WDP301, Team 5, Semester 2026. Bản sửa đổi nghiệp vụ gần nhất trong tài liệu: 01-Oct-2026.

Đây là bản tóm tắt để duy trì ngữ cảnh, không thay thế SRS gốc và không khẳng định tính năng đã được triển khai. Khi cần chi tiết, đối chiếu CF/BR/P trong tài liệu gốc. Những điểm mâu thuẫn dưới đây vẫn chưa được chốt.

## Phạm vi và công nghệ

- Hệ thống nhiều cơ sở (Facility), đúng hai service_type: SELF_STORAGE và MANAGED_INVENTORY.
- SELF_STORAGE: khách thuê đúng một StorageUnit riêng theo Small/Medium/Large và thời hạn; tự truy cập, tự quản lý đồ. Không theo dõi từng món đồ trong Unit.
- MANAGED_INVENTORY: khách thuê quota dung tích m³ tại Facility. Đăng ký/xem hàng và yêu cầu nhập/xuất; Staff thực hiện nhận, kiểm tra, xếp, di chuyển, lấy và giao hàng. Không cấp quyền khách tự vào vị trí lưu trữ chung.
- Đặt Managed capacity không gán Shelf. Chỉ chọn vị trí vật lý khi nhập hàng.
- Stack trong SRS: React web; Flutter mobile cho Staff/Manager; Node.js + Express; MongoDB với multi-document transactions cho ghi quan trọng về booking/payment; PayOS.
- Repo hiện tại là backend TypeScript/Express với auth/user và cấu hình Keycloak. SRS không chỉ định Keycloak; không coi quyết định triển khai sẵn có là yêu cầu được SRS xác nhận.
- Ngoài phạm vi: procurement, suppliers, purchase/sales orders, picking/packing/shipping, fleet logistics, FIFO/LIFO valuation, RFID/IoT, thiết bị kho tự động, Bin-level tracking và dịch vụ climate-controlled. Truy cập Self-Storage chỉ có thể mô phỏng bằng UI cho demo.

## Vai trò và phạm vi dữ liệu

- Customer: các rental và item thuộc sở hữu của mình; đặt/chi trả/quản lý thuê; yêu cầu nhập/xuất Managed Inventory.
- Facility Staff: thao tác thực địa, bàn giao/kiểm tra Unit, support, nhập/di chuyển/xuất item trong cơ sở được phân công.
- Facility Manager (FM): quản lý cơ sở được phân công, tài nguyên, đặt thuê, nhân sự, ngoại lệ, báo cáo; duyệt refund.
- Business Operations Manager (BOM): cơ sở, giá, chính sách, danh mục hàng hỗ trợ/cấm và báo cáo liên cơ sở; không thường xuyên thao tác hàng vật lý.
- Admin: tài khoản, role/permission, phạm vi cơ sở, audit/login history và quản trị hệ thống.
- RBAC phải kết hợp facility scope và ownership; không chỉ kiểm tra role.

## Vòng đời

Rental.status là trạng thái vòng đời chuẩn dùng xuyên các luồng:
`Reserved`, `Contracted`, `Paid`, `Active`, `Overdue`, `CheckedOut`, `Closed`, `Cancelled`.

- Reserved: đang giữ tạm Unit/quota, chờ duyệt.
- Contracted: đã duyệt và tạo hợp đồng, chờ chấp nhận/thanh toán.
- Paid: thanh toán bắt buộc thành công, chưa kích hoạt.
- Active: đã bàn giao Unit hoặc kích hoạt quota Managed.
- Gia hạn không phải trạng thái riêng: giữ Active, cập nhật current_end_date/extension_count sau thanh toán thành công.
- Overdue: đã hết grace period. CheckedOut: hoàn tất nghĩa vụ vật lý nhưng còn chờ quyết toán. Closed: hoàn tất nghĩa vụ, quyết toán và giải phóng tài nguyên.
- Rental, StorageUnit, Payment, InventoryItem có các miền trạng thái riêng; không dùng lẫn nhau.
- Item: Registered → PendingInbound → InStorage → PendingOutbound → CheckedOut. MI-04 implements normal in-term Managed outbound; overdue outbound still requires a future explicit controlled-outbound policy. Relocation giữ InStorage. Staff rejection returns PendingOutbound to InStorage without changing location or physical counters.

## 15 Core Flows

1. CF-01 Reservation & PayOS: chọn đúng Unit hoặc quota Managed, kiểm tra khả dụng, giữ tạm chống overbooking, Staff/FM duyệt; tạo đúng một hợp đồng/reservation với snapshot giá/chính sách; khách chấp nhận và trả PayOS. Webhook xác minh chữ ký, idempotent. Thành công → Paid, hủy hold timer; hết hold chưa thanh toán → giải phóng; thất bại được retry khi hold còn hiệu lực.
2. CF-02 Activation: chỉ Paid mới kích hoạt. Self-Storage kiểm tra đúng Unit, inspection, bàn giao và khách xác nhận → Active/Occupied. Managed chỉ kích hoạt quota đã cam kết. No-show là background rule riêng: không tự kích hoạt; FM gia hạn deadline hoặc hủy theo chính sách và xử lý CF-05 C.
3. CF-03 Extension/upgrade: extension yêu cầu Active, kiểm tra cùng Unit hoặc tiếp tục cam kết quota trong thời gian thêm, duyệt và thanh toán. Thất bại giữ nguyên. Managed tăng quota trong cùng rental cần đủ capacity cho thời gian còn lại, duyệt, phí prorated và thanh toán thành công; lưu amendment có audit.
4. CF-04 Overdue: **Overdue Day 0 là ngày lịch đầu tiên ngay sau current_end_date** khi chưa gia hạn/check-out. Mọi grace/access-suspension/force-termination tính từ mốc này. Managed Overdue chặn inbound mới, vẫn giữ vị trí hàng và cho outbound có kiểm soát theo policy. FM xác nhận balance=0 và đủ điều kiện tiếp tục mới khôi phục Active. Force termination chuyển CF-05 E.
5. CF-05 kết thúc thuê gồm A thông thường; B trả sớm; C hủy trước kích hoạt/no-show; D extra/damage charge bổ sung A/B; E thu hồi/buộc chấm dứt. Phải hoàn tất nghĩa vụ vật lý và trả/miễn rõ ràng mọi khoản nợ; refund phải được FM duyệt rồi Staff xử lý. Managed không được Closed nếu còn InStorage/PendingOutbound hoặc disposition case chưa giải quyết. Forced disposition phải có phê duyệt/lý do và audit/movement cho thao tác vật lý. Unit chỉ về Available/Maintenance sau hoàn tất nghĩa vụ thu hồi.
6. CF-06 Support: phân loại rental/access/payment/item/location/other, gắn đối tượng, giải quyết và ghi chú; vượt SLA chuyển FM.
7. CF-07 tài nguyên: BOM quản lý Facility; inactive chặn đặt mới nhưng không hủy thuê cũ. FM quản lý Unit và Zone/Rack/Shelf trong scope; không sửa cấu trúc làm mất tính hợp lệ của thuê/vị trí đang dùng. Shelf còn hàng không được xóa/deactivate trước relocation/outbound.
8. CF-08 vận hành: FM phân công Staff cho bàn giao, kiểm tra, support, bảo trì, nhập/di chuyển/xuất; task dashboard và trạng thái công việc.
9. CF-09 giá/chính sách: Self-Storage theo size/thời hạn; Managed theo m³/thời hạn. Cấu hình deposit/cancellation/refund/overdue/discount/waiver/category/Shelf constraints, có effective date; không sửa hồi tố snapshot kỳ thuê gốc.
10. CF-10 báo cáo: occupancy Unit, utilization Managed, rental active/overdue, revenue, item status/count và movements; FM giới hạn cơ sở, BOM liên cơ sở, export CSV/XLSX.
11. CF-11 tài khoản/phân quyền: Admin quản lý tài khoản/role/facility scope, guard, audit và login/logout.
12. CF-12 đăng ký item: rental Managed thuộc khách và đủ điều kiện; category hỗ trợ, kích thước/cân nặng dương, quantity/unit, item_code duy nhất; volume_m3 = length_m × width_m × height_m trên mỗi stored item/handling unit. Registered, location=null; chưa chiếm chỗ.
13. CF-13 inbound: rental Active/Managed, ownership/category/quota hợp lệ; Staff kiểm tra hàng thực, chọn Shelf cùng Facility đủ hình học/thể tích/tải trọng và Active. Sai thông tin/không có Shelf → giữ pending để xử lý. Xác nhận vật lý mới cập nhật item/location/quota/Shelf và ghi INBOUND atomically.
14. CF-14 relocation: item InStorage, Shelf đích khác Shelf nguồn, cùng Facility, Active và đủ điều kiện. Staff xác nhận → giải phóng nguồn, chiếm đích, đổi location, ghi RELOCATION atomically. Không đổi used_capacity_m3 của Rental.
15. CF-15 outbound: khách yêu cầu trong kỳ thuê Managed ACTIVE, kiểm tra ownership/location/eligibility; Staff được phân công xác nhận đã giao đủ cả lot. Xác nhận → OUTBOUND, location=null, CheckedOut, giảm quota đã dùng và Shelf utilization atomically theo số đo INBOUND đã lưu. Reject giữ location/counters và phục hồi InStorage. OVERDUE cần controlled-outbound policy được ủy quyền riêng; không cho khách tự xuất hàng.

## Các bất biến quan trọng (BR-01…BR-44)

- Unit code và StorageLocation code duy nhất trong Facility. Inactive/Maintenance không nhận đặt mới hoặc placement mới.
- Chống trùng và race condition khi giữ chỗ, duyệt, kích hoạt, checkout, payment callback và movement commit.
- Contract snapshot giữ giá/chính sách kỳ gốc; generation đúng một lần. Xác minh khách theo policy trước contract/check-in. Partial payment không được chấp nhận trừ cấu hình rõ ràng.
- Managed capacity có hai tầng độc lập: quota khách và khả năng Shelf thực tế; qua một tầng không đồng nghĩa qua tầng còn lại.
- Quota: `used_capacity_m3 + item.volume_m3 <= allocated_capacity_m3`.
- Shelf: hình học phù hợp; `used_volume_m3 + item.volume_m3 <= max_volume_m3`; `used_weight_kg + item.weight_kg <= max_weight_kg`.
- Hierarchy cố định Zone → Rack → Shelf. Rack tham chiếu 2.0m cao × 0.6m sâu × 2.0m dài, 6 tầng/bề mặt. Mỗi Shelf có usable_length_m/depth_m/height_m, max_volume_m3, max_weight_kg và used volume/weight.
- 400–500kg/tầng là thông số tham chiếu, không phải giá trị runtime; mỗi Shelf phải cấu hình một max_weight_kg cụ thể.
- Item InStorage có đúng một current_location_id; CheckedOut không có location hiện hành. PendingOutbound vẫn cần bảo toàn vị trí cho đến xác nhận xuất.
- Mỗi movement thành công có đúng một immutable ItemMovement. Lịch sử append-only; sửa sai bằng corrective record có audit.
- Cập nhật item, Shelf utilization, quota rental và movement đồng bộ trong transaction. Registration chưa dùng capacity; inbound/outbound xác nhận mới tăng/giảm quota; relocation không thay quota.
- Hold duration, grace period, suspension/reclaim threshold, SLA, deposit, phí và refund chưa có giá trị số được chốt; phải cấu hình/xác nhận, không tự hard-code giả định thành yêu cầu cuối cùng.

## Mô hình dữ liệu trong SRS

User, Facility, StorageZone, StorageUnit, StorageLocation (Shelf), Reservation, RentalContract, InventoryItem, ItemMovement, Payment, RefundRequest, ExtensionRequest, InspectionChecklist, AccessInfo, MaintenanceTicket, SupportRequest, StaffAssignment, Policy, Notification, SystemLog.

Luồng còn nhắc Rental, Rack, capacity amendment và Forced Termination & Item Disposition case; mô hình chi tiết của các phần này chưa được định nghĩa đầy đủ trong bảng entity.

Mã chức năng quan trọng: P004 guards; P016 holds; P017 contract; P020 payment callback; P024 assignment/capacity; P033 reminder; P041 overdue; P054 validation/error handling; P063 state transition engine; P070–P078 inventory/location/category UI; P079 capacity validator; P080 atomic movement service.

## Chỗ cần làm rõ trước khi triển khai phần liên quan

- BR-05/changelog viết không có “Storage Unit” service model trong khi toàn văn yêu cầu private StorageUnit cho SELF_STORAGE. Cách đọc nhất quán: chỉ có hai service_type đã nêu; StorageUnit vẫn là tài nguyên Self-Storage. Cần xác nhận lỗi thuật ngữ này.
- Ma trận User Authorization để trống nhiều quyền Facility Staff/Profile, không khớp CF và bảng actor; chưa thể dùng ma trận đó làm RBAC cuối cùng.
- Có status Cancelled nhưng CF-05 C đi thẳng Closed; đường rejection/hold-expiry/forced termination chưa thống nhất đầy đủ với định nghĩa Cancelled. Cần chốt transition matrix.
- Rental.status được gọi là canonical nhưng bảng entity chỉ mô tả RentalContract, chưa chốt cách tách/gộp Rental và Contract.
- Quantity được khai báo, nhưng công thức volume chỉ nói mỗi item/handling unit; cần chốt quantity tác động thế nào tới quota/tải trọng và có xuất từng phần hay không.
- Chưa nêu cách tính usable_height mỗi Shelf từ Rack 6 tầng, quy tắc xoay item để fit, hay mô hình capacity cam kết theo khoảng thời gian.
- BR-22 nói active refund policy trong khi CF-05 B/C dùng contract snapshot; cần làm rõ phiên bản policy áp dụng cho refund.
- Sơ đồ ảnh là điều hướng portal cấp cao, thiên về Unit; chưa thể hiện đầy đủ CF-12–15. Context Diagram, ERD và Use Case Diagram có heading nhưng không có sơ đồ tương ứng trong file; Section II lặp heading và chủ yếu có bảng actor, chưa có đặc tả use case chi tiết. Một số mô tả P trong chính file kết thúc bằng dấu “…”.

## Trạng thái ghi nhớ

Đã đọc nội dung văn bản, bảng và ảnh điều hướng duy nhất trong DOCX. Chưa thay đổi code, chưa triển khai các chức năng SRS. Dùng tài liệu này làm ngữ cảnh nghiệp vụ cho công việc sau; phân biệt rõ yêu cầu tài liệu với trạng thái code thực tế.
