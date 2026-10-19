# Customer Warehouse Map — Direct Status Filtering

## Thay đổi
- Sửa `src/components/customer/warehouse/DigitalWarehouseDashboard.jsx`: state lọc presentation-only; chuyển legend thành button thật, aria-pressed, toggle/clear; truyền bộ lọc xuống Cell grid.
- Sửa `src/components/customer/warehouse/CellInformation.jsx`: bỏ logical list; làm mờ Cell không khớp, giữ nguyên thứ tự/vị trí, selection và nút booking; thông báo kết quả rỗng và Clear filter dưới grid.
- Sửa `src/components/customer/warehouse/warehouse-dashboard.css`: xóa CSS sorting/list cũ, thêm active/focus/muted styles có scope Customer.
- Xóa `src/components/customer/warehouse/CellStatusList.jsx` và `cellListingSort.js` sau khi bỏ tham chiếu.
- Thêm fixture browser runner `.design-reference/check-cell-filter.cjs` và báo cáo này.

## Nguồn trạng thái
Filter dùng chính `cellPeriodStatus(cell)` đang tạo nhãn trên Cell, không dùng raw displayStatus để ghi đè interval-aware status. Các kết quả hiện có: AVAILABLE, RESERVED, OCCUPIED, UNAVAILABLE, UNKNOWN. Legend có AVAILABLE/RESERVED/OCCUPIED/BLOCKED/MAINTENANCE; hai badge cuối được giữ nguyên màu và lọc chính xác theo nhãn hiển thị. Vì helper hiện không trả BLOCKED/MAINTENANCE, chọn chúng cho zero matches và thông báo rõ; không suy diễn từ operationalStatus.

## Hành vi
Một filter tại một thời điểm, bấm lại badge đang chọn hoặc Clear filter để bỏ lọc. Cell không khớp bị làm mờ, không bị xóa/reorder; selection, ownership, preferred Cell, basket, eligibility, detail và navigation giữ nguyên. Hover/focus tăng độ rõ của Cell bị mờ để vẫn đọc và tương tác được; Cell vẫn được đánh dấu không khớp. Giữ nguyên map search cũ, không thêm search/sort/list mới. Filter không fetch hoặc mutate dữ liệu.

## Kiểm thử
- Syntax parse toàn bộ 219 JS/JSX sources PASS.
- Production build PASS. Cảnh báo bundle >500 kB hiện có vẫn còn.
- npm test: 6/6 PASS. Managed warehouse booking: 3/3 PASS.
- New filter fixture PASS: 5 badges, zero matches, toggle, switch, Clear, keyboard Enter, search kết hợp, selected Cell giữ nguyên, grid offsets/order giữ nguyên, disabled state booking giữ nguyên. 3 intercepted GETs, 0 live requests/mutations.
- Responsive PASS: 320/390/768/1024/1440/1920 px; không document overflow, legend mobile dùng được qua Zones & search.
- Cell period-status regression: 14 trường hợp PASS, kể cả UNKNOWN/unavailable/reserved fail-closed và available booking.
- Digital Warehouse regression PASS: lazy detail/cache, tooltip/focus/Escape, selection, zoom/reset/fullscreen, search, lỗi/retry/refresh, stale/facility checks và mobile drawer. Giữ các điều chỉnh fixture trước đó cho UNKNOWN label và width-dependent zone scroll assertion.
- Ảnh: `.design-reference/cell-filter-{320,390,768,1024,1440,1920}.png`.

## Giới hạn và phạm vi
Chỉ filter Cell của Rack hiện được load; không tự tải toàn bộ Rack. Fixture-only validation, không khẳng định Live E2E. Không sửa API/status helper/booking logic/routes/auth. Không truy cập BE-REF hoặc backend. Staff/Manager/Admin/BOM/Public không thay đổi. Sorting runner cũ được giữ như artifact lịch sử, không còn dùng để kiểm thử UI hiện tại.
