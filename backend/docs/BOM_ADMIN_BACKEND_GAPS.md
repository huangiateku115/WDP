# BOM/Admin – Backend contract gaps (cần backend xử lý)

Ngày kiểm tra: 2026-11-09 · Nhánh: `feat/04-BOM+Admin` · Phạm vi: đối chiếu validator/service backend với form/table của console BOM & Admin.

Các mục dưới đây **không thể sửa ở FE** (thiếu field, thiếu endpoint, hoặc backend trả sai shape).
Các lỗi đã sửa được ở FE được liệt kê ở mục cuối.

---

## P0 – Chặn nghiệp vụ

### P0-1. Reservation Managed không xuất hiện trong oversight của BOM/Admin

- **Hiện tượng**: BOM/Admin không thấy reservation `MANAGED_INVENTORY` ở bất kỳ danh sách nào (Oversight, Dashboard, Rental report, Contract lookup). Mở chi tiết bằng URL `/bom/reservations/managed/:id` vẫn được, nhưng không có đường dẫn từ UI.
- **Nguyên nhân**: hai endpoint đọc của BOM/Admin lọc cứng `serviceType: SELF_STORAGE`:
  - `backend/src/controllers/reservations/reservation.controller.ts:298` — `getReservationsByFacility`
  - `backend/src/controllers/reservations/reservation.controller.ts:312` — `getReservationById`
- **Ảnh hưởng**: báo cáo doanh thu/utilization của BOM thiếu toàn bộ doanh thu Managed; Admin không review được Managed reservation.
- **Đề xuất**:
  1. Cho `ADMIN`/`BOM` bỏ filter `serviceType` (giữ filter cho `CUSTOMER`/`FACILITY_*`), hoặc
  2. Thêm `GET /reservations/managed?facilityId=&status=&page=&limit=` trả danh sách Managed cho `ADMIN|BOM|FACILITY_MANAGER`.
- **Acceptance**: `GET /api/v1/reservations/facility/:id` với token BOM trả về cả reservation `serviceType=MANAGED_INVENTORY`; FE hiển thị cột Service tương ứng.

### P0-2. Populate `customerId` chọn field không tồn tại → mất tên khách hàng

- **Hiện tượng**: cột Customer ở Oversight/Dashboard/Rental hiển thị email thay vì tên.
- **Nguyên nhân**: `reservation.controller.ts:302,314` populate `'customerId', 'fullName email phone'`, nhưng model `User` chỉ có `displayName` (`backend/src/models/users/user.model.ts:20`), không có `fullName`.
- **Đề xuất**: đổi select thành `'displayName email phone'` (giữ `fullName` như fallback nếu có dữ liệu cũ).
- **Acceptance**: response `GET /reservations/facility/:id` có `customerId.displayName` khác rỗng.

### P0-3. `customerSnapshot.fullName` luôn undefined trong contract Self-Storage

- **Hiện tượng**: chi tiết hợp đồng hiển thị email thay vì tên khách.
- **Nguyên nhân**: `reservation.controller.ts:363` lưu `fullName: user.fullName` (field không tồn tại trên `User`).
- **Đề xuất**: `fullName: user.displayName`, đồng thời backfill `customerSnapshot.fullName` cho contract cũ (script một lần).
- **Acceptance**: `GET /contracts/:id` trả `customerSnapshot.fullName` có giá trị với contract mới.

---

## P1 – Thiếu field/không đối xứng contract

### P1-1. Field write-only không được trả về (không sửa lại được)

- `POST /racks` nhận `cellCapacitiesKg`, `usableHeightMByLevel` nhưng không lưu/echo lại (`backend/src/services/warehouse-map/warehouse-map.service.ts:402-421,121-140`). Mở form Edit rack không thấy giá trị đã nhập; muốn đổi capacity phải sửa từng cell.
- **Đề xuất**: trả thêm 2 field dạng dẫn xuất (`cellCapacitiesKg` từ danh sách cell, `usableHeightMByLevel` từ cell dimensions) trong `rackDto`, hoặc thêm endpoint `GET /racks/:id/capacity-layout`.
- **Acceptance**: `GET /racks/:id` có dữ liệu capacity theo từng level/cell.

### P1-2. Cell DTO ẩn tải thực tế với BOM/Admin

- `cellDto` bỏ `usedWeightKg`, `usedVolumeM3` (`warehouse-map.service.ts:142-159`); hai giá trị này chỉ có trong `GET /warehouse-map`.
- **Đề xuất**: trả 2 field (read-only) trong `cellDto` cho role `ADMIN|BOM|FACILITY_MANAGER`, hoặc ghi rõ trong tài liệu là console phải dùng read-model `/warehouse-map`.
- **Acceptance**: BOM thấy được tải/khối lượng đã dùng khi xem chi tiết cell.

### P1-3. Snapshot giá của contract Self-Storage thiếu các key FE đang render

- Contract Self-Storage lưu `pricingSnapshot = { estimatedRent, depositAmount, pricingPolicyId }` (`reservation.controller.ts:368-372`), trong khi Managed lưu `amountBreakdown` đầy đủ (`managed-reservation.service.ts:339`).
- FE dùng chung một khối "Pricing" cho cả hai loại → với Self-Storage chỉ hiện 3 dòng.
- **Đề xuất**: thống nhất shape snapshot cho Self-Storage (`amountBreakdown: { estimatedRent, depositAmount, taxAmount, discountAmount, totalDue }`, `pricingRule: { ratePerUnit, version }`, `term`) hoặc tách render theo `serviceType` và ghi rõ contract.
- **Acceptance**: chi tiết contract Self-Storage hiển thị đủ breakdown hoặc tài liệu xác nhận chỉ có 3 field.

### P1-4. Hai field nội bộ bị trả ra ngoài ở mọi read reservation

- `bookingIdempotencyKey`, `bookingPayloadHash` (`reservation.model.ts:18-19`) xuất hiện trong mọi response reservation (kể cả của Customer).
- **Đề xuất**: đặt `select: false` hoặc `toJSON.transform` bỏ 2 field này.
- **Acceptance**: response reservation không còn 2 field trên.

---

## P2 – Cải thiện (không chặn)

1. `GET /users` (ADMIN) không phân trang và trả cả `keycloakSub`, `lastLoginAt` (`user.service.ts:170-172`) → nên paginate + `select('-keycloakSub')`.
2. BOM/FE cần danh sách "subject" để tra audit ngoài phạm vi customer: hiện chỉ dùng `GET /customers` (`frontend/src/pages/bom/AuditLivePage.jsx:78-80`). Đề xuất `GET /audit/{bom|admin}/subjects`.
3. `PATCH /facilities/:id` ghi sub-object bằng dot-path nên `contact`/`address` merge từng key (`facility.validation.ts:66-75`). FE hiện chỉ gửi `contact` khi có giá trị — cần giữ nguyên hành vi này khi refactor.
4. `GET /inventory-items` đã hỗ trợ `category`/`search` nhưng `ServiceConsolePage` (support/maintenance) chưa gửi filter — API đã sẵn sàng: `page, limit, facilityId, status, priority, category, search` (`support-request.validation.ts:41`, `maintenance-ticket.validation.ts:67`).
5. Bổ sung `effectiveFrom`/`effectiveTo` dạng ISO cho `GET /pricing-rules` list filter nếu cần lọc theo thời gian ở server (hiện FE lọc client trên tối đa 300 dòng, `frontend/src/lib/bomApiData.js:7-8`).

---

## Đã sửa ở FE trong lần này (tham chiếu)

| Lỗi | File FE | Cách sửa |
|---|---|---|
| PATCH pricing/policy/discount/category luôn 400 vì gửi full body | `src/lib/bomMappers.js`, `src/pages/bom/RecordPage.jsx`, `src/pages/bom/PolicyRecordsPage.jsx` | Thêm `pricingUpdateBody`/`policyUpdateBody`/`discountUpdateBody`/`categoryUpdateBody` chỉ gửi `effectiveFrom/effectiveTo/price/currency/config` |
| Rule/policy đã hiệu lực bị backend chặn `409` | như trên | Khoá field + chỉ cho đặt `effectiveTo` tương lai; chặn submit khi thiếu ngày kết thúc |
| Pricing MANAGED thiếu `billingBasis` | `src/lib/bomMappers.js` | Gửi `billingBasis: "PER_M3"` cho MANAGED_INVENTORY |
| Item categories sai shape config | `src/lib/bomMappers.js`, `src/pages/bom/PolicyRecordsPage.jsx` | Chuyển form sang `allowedCategories`/`blockedCategories`, cố định `serviceType: MANAGED_INVENTORY` |
| `district` bị gán bằng `city` mỗi lần PATCH | `src/lib/bomMappers.js` | Bỏ fallback `a.district \|\| a.city` |
| Không sửa được `contact.phone/email` | `src/lib/bomMappers.js`, `src/pages/bom/FacilityPage.jsx` | Thêm input + gửi `contact` khi có giá trị, validate email |
| Contract lookup luôn hiện SELF_STORAGE | `src/pages/shared/ContractLookupPage.jsx` | Đọc `row.service` (fallback `row.serviceType`) |
| `quantityUnit` render "undefined" | `src/pages/bom/OversightLivePage.jsx` | Guard chuỗi rỗng |
| Assignee support/maintenance có FACILITY_MANAGER (409) | `src/pages/admin/ServiceConsolePage.jsx` | Chỉ offer `FACILITY_STAFF` |
| Thiếu kiểm tra facility/currency trước khi gửi | `RecordPage.jsx`, `PolicyRecordsPage.jsx` | Bắt buộc `facilityId`, currency đúng 3 chữ cái |

---

## P1-5 (mới). BOM không đọc được danh sách tài khoản → không gán được ticket

- **Hiện tượng**: ở `/bom/support` và `/bom/maintenance`, ô chọn assignee luôn rỗng ("no assignable account"), nên BOM không thể assign dù backend cho phép.
- **Nguyên nhân**: `GET /users` chỉ cho `ADMIN` (`backend/src/routes/user.routes.ts:24-25`), trong khi UI lấy danh sách assignee từ endpoint này (`frontend/src/lib/adminUsers.js` → `useAdminUsers`) và backend cho `BOM` assign ticket (`support-request.routes.ts:8`, `maintenance-ticket.routes.ts:8`).
- **Đề xuất**: thêm endpoint tối thiểu `GET /users/staff?facilityId=&role=FACILITY_STAFF` cho `ADMIN|BOM|FACILITY_MANAGER`, chỉ trả `_id, displayName, role, assignedFacilityId, isActive`.
- **Acceptance**: BOM gọi được danh sách FACILITY_STAFF của một facility và assign thành công.

---

## Trạng thái triển khai chức năng BOM/Admin (cập nhật 2026-11-09)

| Nhóm chức năng | Route | Nguồn dữ liệu | Trạng thái |
|---|---|---|---|
| Dashboard (BOM) | `/bom/dashboard` | `GET /facilities`, `GET /reservations/facility/:id` | Đầy đủ (thiếu reservation Managed – P0-1) |
| Facility oversight | `/bom/oversight`, `/bom/oversight/facilities/:id` | facilities + warehouse-map + storage-units + inventory-items + reservations | Đầy đủ (managed chưa thấy – P0-1) |
| Facilities CRUD | `/bom|/admin/facilities*` | `POST/PATCH/DELETE /facilities`, `POST /facilities/:id/restore` | Đầy đủ |
| Warehouse structure | `/bom|/admin/warehouse` | `/warehouse-zones`, `/racks`, `/rack-cells`, `PUT /reservations/managed/capacity/:facilityId` | Đầy đủ (thiếu echo capacity – P1-1) |
| Storage units | `/bom|/admin/units` | `/facilities/:id/storage-units`, `/storage-units/:id(/status|/restore)` | Đầy đủ |
| Reservations | `/bom|/admin/reservations*` | `/reservations/facility/:id`, `/reservations/:id`, `/reservations/managed/:id`, approve/reject/activate/mock-pay | Một phần (managed không list được – P0-1) |
| Managed inventory | `/bom|/admin/inventory*` | `GET /inventory-items`, `/:id`, `/:id/movements` | Chỉ đọc (đúng thiết kế; chưa có màn hình placement) |
| Customers | `/bom|/admin/customers*` | `GET /customers`, `/:id`, `PATCH /customers/:id/verify` | Đầy đủ |
| Contracts | `/bom|/admin/contracts*` | `GET /contracts/reservation/:id`, `GET /contracts/:id` | Đầy đủ (snapshot Self-Storage nghèo – P1-3) |
| Pricing rules | `/bom|/admin/pricing*` | `/pricing-rules` CRUD + `/status` | Đầy đủ sau khi sửa FE |
| Policies | `/bom|/admin/policies*` | `/policies` CRUD + `/status` | Đầy đủ sau khi sửa FE |
| Discounts / waivers | `/bom|/admin/policies/discounts*` | `/policies` type DISCOUNT/WAIVER | Đầy đủ sau khi sửa FE (config free-form) |
| Item categories | `/bom|/admin/policies/item-categories*` | `/policies` type CATEGORY | Đầy đủ sau khi sửa FE |
| Reports – utilization | `/bom|/admin/reports/utilization` | warehouse-map + units + inventory + managed capacity | Đầy đủ |
| Reports – rentals | `/bom|/admin/reports/rentals` | reservations | Đầy đủ (managed thiếu – P0-1) |
| Reports – revenue | `/bom|/admin/reports/revenue` | **không có endpoint** | Chưa triển khai (chờ `GET /payments` + `/reports/revenue`) |
| Business audit (BOM) | `/bom/audit` | `GET /customers` + `/audit/bom/*` | Một phần (chỉ audit được CUSTOMER – P2-2) |
| System audit (Admin) | `/admin/audit`, `/admin/login-history` | `/audit/admin/*` | Đầy đủ |
| Users (Admin) | `/admin/users*` | `GET/POST/PUT/PATCH/DELETE /users*` | Đầy đủ (thiếu phân trang – P2-1) |
| Notifications | `/bom|/admin/notifications` | `/notifications/me`, `/:id/read` | Đầy đủ |
| Support / maintenance | `/bom|/admin/support|maintenance` | `/support-requests*`, `/maintenance-tickets*` | Đầy đủ với Admin; BOM thiếu assignee – P1-5 |
| Export báo cáo | — | — | Chưa có (`GET /reports/:kind/export`) |

## UI đã dọn trong lần này (FE)

- Xoá các trang demo không còn route nào dùng: `pages/bom/BusinessRecordsPage.jsx`, `pages/bom/OverviewPages.jsx`, `pages/admin/UsersPage.jsx` (bản trùng của `UsersLivePage`), `pages/admin/SystemPages.jsx` (bản trùng của `LiveSystemPages`).
- Xoá dữ liệu demo chỉ phục vụ các trang trên: `lib/bomDemoStore.js`, `mocks/bomData.js`, `mocks/adminData.js`.
- Gỡ banner "Isolated business demo" ở `layouts/BomLayout.jsx` và notice sai "BOM APIs ... not connected" ở `components/bom/BomUI.jsx`.
- Bỏ toàn bộ note hiển thị trên UI: hằng `LIVE_NOTICE` (notice bar của mọi màn hình BOM/Admin), panel "Backend surface" ở Contract lookup, panel "Managed reservations" giải thích thiếu endpoint, đoạn note "GET /users is ADMIN-only" ở Service console, cùng các hint/subtitle lộ endpoint ở Audit page. Comment giải thích trong code vẫn giữ.
- `ManagerUI.Screen` không còn render notice demo mặc định ("Demo facility · Changes are saved in this browser only…") cho route `/bom` và `/admin`; nhãn đầu trang cũng đổi thành "BUSINESS OPERATIONS" / "SYSTEM ADMINISTRATION" thay vì "FACILITY WORKSPACE". `AdminScreen` không render notice nữa.
- Chuẩn hoá toàn bộ text hiển thị của BOM/Admin (description, subtitle, hint, empty state, toast, nhãn sidebar): không còn nhắc "backend", "API/endpoint", "Live …", "demo", "mock", "GET/PATCH /…". Comment giải thích kỹ thuật trong code vẫn giữ nguyên.
- Không còn mã nội bộ hiển thị trên UI: role (`FACILITY_MANAGER`, `FACILITY_STAFF`, `ADMIN`, `BOM`) được render qua `ROLE_LABELS` ("Facility Manager", "Business Operations Manager"…), service model qua `serviceLabel()`, loại/giá trị discount qua nhãn thân thiện; các câu mô tả dùng "held/occupied", "active", "Self Storage" thay cho mã enum và không còn nhắc mã lỗi HTTP.
- Bỏ panel "Still demo (backend contract pending)" ở `DashboardLivePage` và `RentalReportLivePage`; viết lại `ReportsPages.jsx` chỉ còn 2 export live và mô tả đúng trạng thái revenue.

