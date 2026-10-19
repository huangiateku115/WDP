# Customer Warehouse Map — Layout Separation

## Route sau sửa
| URL | Layout | Guard |
| --- | --- | --- |
| /portal/warehouse-map | CustomerLayout, đủ navigation Customer | CustomerGate |
| /portal/warehouse-map/:facilityId | CustomerWarehouseLayout, standalone | CustomerGate |
| /portal/warehouse-map/:facilityId/racks/:rackId | CustomerWarehouseLayout, standalone | CustomerGate |

## File thay đổi
Chỉ sửa source `src/routes/AppRoutes.jsx`: chuyển Facility Selection vào route con CustomerLayout, đổi route cha dedicated thành đường dẫn có :facilityId, giữ Map ở index và Rack ở racks/:rackId. URL, CustomerGate và các page/component giữ nguyên; không thay đổi CSS/API/auth/business/map/filter.
Thêm kiểm thử `.design-reference/check-map-layout-separation.cjs` và báo cáo này. Screenshot fixtures dưới `.design-reference/`; dist do build sinh ra không dùng để commit.

## Kết quả kiểm thử
- Syntax parse 219 JS/JSX sources PASS.
- Production build PASS; cảnh báo bundle >500 kB hiện có.
- npm test 6/6 PASS; managed warehouse booking tests 3/3 PASS.
- Navigation/layout fixture PASS tại 320/390/768/1024/1440/1920: từ Portal dùng keyboard mở Warehouse Map; Facility Selection có 9 links, Warehouse Map aria-current=page; View 2D Map mở standalone; Back to Facility Selection khôi phục CustomerLayout; Back/Forward và refresh cả hai URL PASS. Rack deep link/refresh PASS.
- Không duplicate header, không document overflow. Map width bằng viewport. Mobile navigation focus/Enter hoạt động.
- 72 intercepted fixture GETs cho navigation, không live API hoặc mutation.
- Existing Warehouse Map regression PASS: lazy detail/cache, cells, selection/tooltip/focus/Escape, zoom/reset/fullscreen, search, refresh/retry/stale/facility checks, responsive drawer. Runner dùng compatibility UNKNOWN label và width-independent zone assertion như lần trước; đổi tên screenshot vì một file ảnh cũ bị khóa, rerun PASS.
- Existing status filter regression PASS: 5 badges, toggle/clear, zero matches, search, selection/booking disabled states, unchanged grid offsets/order và cả 6 widths. 3 intercepted GETs, zero live/mutation.

## Screenshots
- `.design-reference/map-layout-selection-{320,390,768,1024,1440,1920}.png`
- `.design-reference/map-layout-workspace-{320,390,768,1024,1440,1920}.png`

## Phạm vi
Không truy cập BE-REF hoặc backend. Không sửa Staff/Manager/Admin/BOM/Public. Không thay đổi giao diện/map geometry/booking/status logic hay API. Chưa thực hiện live authenticated Backend E2E; kết quả trình duyệt dựa trên fixtures.
