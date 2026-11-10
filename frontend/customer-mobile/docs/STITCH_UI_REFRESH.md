# Đối chiếu Customer Mobile với Stitch Handoff

Nguồn thiết kế là bộ VaultSpace_Stitch_23_Screens_Handoff trong Downloads. Đã đối chiếu README, manifest và 23 HTML. Các mẫu dùng Inter với thang tiêu đề 18/22/26/32, nền mint, card trắng bo góc và bóng nhẹ, surface xanh nhiều cấp, nút xanh đậm, amber cho cảnh báo và icon viền. Màu được chuyển thành tokens React Native. Nhịp khoảng cách 4/8/12/16/20/24/32 và hit target 44–48 được dùng cho thao tác Mobile. Ảnh remote trong handoff không được nhúng; catalog tiếp tục dùng vector minh họa cục bộ.

| Stitch | Màn Mobile và thay đổi |
| --- | --- |
| 01 Dashboard | Lời chào và tiêu đề rõ cấp, khối xanh đậm dành cho Khám phá kho, ô chỉ số lấy dữ liệu thật, nút thông báo và nhóm đơn thuê gần đây. |
| 02 Explore | Tiêu đề có mô tả, khối tìm kiếm và lọc chung, ảnh minh họa lớn hơn, CTA phụ ở từng cơ sở. |
| 03 Facility detail | Tiêu đề và ảnh dẫn, card dịch vụ, giữ các điểm vào Self Storage và Managed. |
| 04 Unit selection | Tiêu đề theo bước, biểu tượng đơn vị kho, chip và trạng thái khóa hiện có. |
| 05 Period/pricing | Tiêu đề theo bước, lịch hiện có và khối chi phí nền mint cho quote thật. |
| 06 Confirmation | Route xác nhận riêng hiện là màn chưa khả dụng. Luồng thật vẫn đi tới đơn thuê và PayOS, không thêm màn thành công giả. |
| 07 Map | Card tiêu đề, chú giải chip, thanh zoom màu mint, khung kệ nhiều lớp và chi tiết ô. Không thêm lại nút chọn tầng. |
| 08 Managed review | Cơ sở, lịch, sức chứa và quote có các khối riêng. CTA tạo đơn vẫn khóa theo contract hiện tại. |
| 09 My Rentals | Card đơn thuê với biểu tượng, trạng thái thực và thao tác mở chi tiết. |
| 10 Rental detail | Phân cấp hồ sơ và CTA, timeline có đường nối, bước hiện tại nổi bật và khối bước tiếp theo. |
| 11 Contract | Card tài liệu và phản hồi ký, giữ kiểm tra nội dung, chữ ký và xác minh. |
| 12 Payment | Card tài chính và lịch sử, nền mint cho khoản đã ghi nhận, amber cho đối soát, nút kiểm tra trạng thái rõ hơn. |
| 13 Managed Inventory | CTA tìm kho, chỉ số và card đơn, hồ sơ hàng, tồn theo nguồn và lịch sử gần đây. |
| 14 Item detail | Tiêu đề và card theo nhóm hàng hóa, tồn kho và lịch sử. |
| 15 Inventory form | Màn runtime chưa khả dụng, dùng trạng thái chung mới. |
| 16 Repeated inbound | Màn runtime chưa khả dụng, dùng trạng thái chung mới. |
| 17 Canonical outbound | Màn runtime chưa khả dụng, dùng trạng thái chung mới. |
| 18 Movements | Tiêu đề rõ ngữ cảnh và card lịch sử nhất quán. |
| 19 Notifications | Phân biệt đã đọc/chưa đọc bằng icon, giữ hành động hiện có. |
| 20 Support | Màn runtime chưa khả dụng, dùng trạng thái chung mới. |
| 21 Profile | Nhóm tài khoản, hồ sơ xác minh, form chỉnh sửa và phản hồi lưu. Đăng xuất dùng nút phụ tông cảnh báo. |
| 22 Login | Tiêu đề, minh họa cục bộ, input và button dùng chung. |
| 23 Registration | Tiêu đề và form dùng cùng hệ thống nhập liệu với Login. |

Hệ thống chung gồm ScreenHeading, CardHeading, IconBadge, MetricTile và TintedPanel. Tab bar giữ năm điểm điều hướng và nhấn tab hiện tại bằng nền mint. Native header giữ hành vi back. Những màn đã hoạt động giữ cùng route, dữ liệu, điều kiện và thao tác. Các mô tả này là đối chiếu bố cục trước/sau theo mã nguồn, không phải kết quả so ảnh pixel hoặc xác minh thiết bị thật.
