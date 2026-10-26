# WDP — Project Handoff

**Ngày lập:** 2026-10-24  
**Mục đích:** Chuyển toàn bộ bối cảnh dự án sang một cuộc trò chuyện khác mà không làm mất trạng thái Git hiện tại.

## 1. Workspace và trạng thái Git đã kiểm tra

- **Repository root:** `C:\Users\taing\OneDrive\Desktop\WDP`
- **Branch:** `feat/change-inbound-and-outbound-flow`
- **HEAD:** `3d193aad0413ed5212697c3d4b9d8c9385e75ae5`
- **Working tree:** có thay đổi chưa commit; cần giữ nguyên. Không reset, clean, checkout, pull hay ghi đè.
- Tại thời điểm lập file, `git status` ghi nhận:

| Trạng thái | File |
|---|---|
| Modified | `backend/.env.example` |
| Modified | `backend/src/config/env.ts` |
| Modified | `backend/src/middlewares/error.middleware.ts` |
| Modified | `backend/src/models/inventory-items/item-movement.model.ts` |
| Modified | `backend/src/types/item-movement.type.ts` |
| Untracked | `backend/docs/MI_06A_STOCK_LEDGER.md` |
| Untracked | `backend/src/models/inventory-items/inventory-stock-balance.model.ts` |
| Untracked | `backend/src/services/inventory-items/managed-stock-ledger.service.ts` |
| Untracked | `backend/src/types/managed-stock.type.ts` |
| Untracked | `backend/tests/managed-stock-ledger.test.cjs` |

File handoff này cũng là file mới trong workspace. Danh sách trên mô tả trạng thái trước khi tạo file này; khi tiếp tục, hãy chạy `git status` để lấy danh sách mới nhất.

## 2. Tóm tắt dự án

WDP là hệ thống quản lý kho và lưu trữ nhiều Facility. Backend dùng Node.js, Express, TypeScript, Mongoose và MongoDB; Frontend dùng React/Vite. Hai loại dịch vụ là `SELF_STORAGE` và `MANAGED_INVENTORY`.

- **SELF_STORAGE:** khách thuê một StorageUnit riêng và tự quản lý đồ.
- **MANAGED_INVENTORY:** khách thuê dung lượng tại Facility; Staff nhận, lưu kho, kiểm tra, di chuyển và giao hàng.
- Khu vực Managed Inventory dùng khóa giao dịch theo Facility/Reservation/Zone/Rack/Cell, movement ledger, payment ledger và audit.
- Không đưa thay đổi nghiệp vụ Self-Storage vào các công việc Managed Inventory.

Tài liệu nền nghiệp vụ: [`backend/docs/PROJECT_CONTEXT.md`](backend/docs/PROJECT_CONTEXT.md). Đây là bản ghi nhớ SRS, không phải bằng chứng rằng mọi yêu cầu SRS đã được triển khai.

## 3. Các phần Managed Inventory đã triển khai theo lịch sử dự án

Các mục dưới đây phản ánh lịch sử công việc trong cuộc trò chuyện và tài liệu hiện có; trạng thái và diff thực tế cần được kiểm tra lại trước khi nghiệm thu.

### Reservation, thanh toán và check-in

P0/P1/P2/P3A/P3B đã được triển khai theo các handoff trước. Luồng Managed Inventory v2 dự kiến hiện tại:

```text
RESERVED + Cell HOLD
  → DEPOSIT_PAID + Cell RESERVED
  → đăng ký Item / inbound request
  → Staff receiving inspection và xác nhận custody
  → hợp đồng được Customer và Facility ký đúng phiên bản
  → thanh toán BALANCE
  → CHECKIN_READY
  → Staff xác nhận inbound đầu tiên
  → ACTIVE + Cell OCCUPIED + Item IN_STORAGE
```

MI-03A giữ `CHECKIN_READY` khác `ACTIVE`; MI-03B kích hoạt Reservation ở giao dịch inbound đầu tiên. Inbound sau đó cho Reservation `ACTIVE` đi theo nhánh subsequent inbound. Xem [`BUSINESS_FLOW_P0_P1.md`](backend/docs/BUSINESS_FLOW_P0_P1.md), [`MI_03A_MANAGED_CHECKIN.md`](backend/docs/MI_03A_MANAGED_CHECKIN.md), [`MI_03B_MANAGED_FIRST_INBOUND.md`](backend/docs/MI_03B_MANAGED_FIRST_INBOUND.md).

### Outbound — MI-04

- Customer sở hữu Item yêu cầu outbound; Item sang `PENDING_OUTBOUND` nhưng vẫn giữ Cell và không giảm counter.
- Staff thuộc đúng Facility xác nhận giao cả lô hoặc từ chối có lý do.
- Xác nhận dùng số đo và movement inbound đã lưu; transaction cập nhật Cell/capacity, movement, Item và allocation.
- Outbound không tự đóng hoặc checkout Reservation; Reservation vẫn `ACTIVE`.
- Idempotency/replay, audit và movement append-only được mô tả trong [`MI_04_MANAGED_OUTBOUND.md`](backend/docs/MI_04_MANAGED_OUTBOUND.md).
- Partial outbound hiện thuộc phạm vi tương lai MI-06C, chưa coi là hoàn tất.

### Relocation — MI-05

Staff đúng Facility có thể chuyển Item đã lưu giữa các Cell trong cùng Facility. Giữ nguyên Reservation và `usedCapacityM3`; source/destination counters và allocation đổi nguyên tử; lineage movement giữ nguồn số đo inbound. Hạn chế hiện tại: relocation cả lô, chưa hỗ trợ quantity/batch relocation. Xem [`MI_05_MANAGED_RELOCATION.md`](backend/docs/MI_05_MANAGED_RELOCATION.md).

### Customer image upload — IMAGE-01 → IMAGE-03

Theo lịch sử trao đổi, đã triển khai upload ảnh Item bằng hạ tầng Cloudinary hiện có, metadata upload riêng, kiểm tra quyền/Reservation, giới hạn file, attachment an toàn, picker và gallery. Ảnh legacy HTTP(S) phải tiếp tục tương thích. Upload chưa attach có cleanup trì hoãn/retry; URL Cloudinary public chỉ được bật cho development/test, không phải private storage. Không sửa Contract Proof, Avatar hay Self-Storage.

### Staff Receiving Inspection evidence — IMAGE-04

Tài liệu [`MI_IMAGE_04_RECEIVING_EVIDENCE.md`](backend/docs/MI_IMAGE_04_RECEIVING_EVIDENCE.md) mô tả endpoint context Facility-scoped, upload ảnh cho Staff, snapshot inspection bất biến, gallery lịch sử và attachment trong cùng transaction với inspection/state transition. Evidence tách khỏi `InventoryItem.images` và không lộ qua Customer Item API. Public delivery bị giới hạn development/test. Legacy inspection không có ảnh tiếp tục được hỗ trợ.

### MI-06A — Ledger và stock balance nền tảng, hiện là phần đang review

MI-06A chỉ tạo nền tảng schema/reader/reconciliation; không đổi hành vi inbound/outbound/relocation hiện tại và không ghi projection rows.

- `InventoryItem.quantity` tiếp tục giữ nghĩa số lượng đăng ký ban đầu; không cộng dồn các lần inbound.
- Movement v2 là append-only, có `batchLines` và delta `ADD` / `REMOVE` / `MOVE`; legacy v1 được đọc bằng batch ID xác định.
- `InventoryStockBalance` là projection theo Item, có batch còn lại, on-hand/held, tổng kg/m³, Cell hiện tại và cursor.
- Reconciliation chỉ đọc; kiểm tra movement lineage, số dư, Cell counters, Reservation `usedCapacityM3`, capacity status và lỗi có mã ổn định.
- `MI06_STOCK_LEDGER_WRITES_ENABLED` mặc định tắt; production luôn bị chặn trong giai đoạn này.
- Không chạy migration/backfill; chưa có MI-06B/C/D/E.
- Bản sửa rounding gần nhất chuẩn hóa total volume theo quantity × dimensions trước khi round, gồm regression dimensions `0.125 × 0.125 × 0.125`, quantity 100.

Chi tiết: [`MI_06A_STOCK_LEDGER.md`](backend/docs/MI_06A_STOCK_LEDGER.md). Thay đổi MI-06A chưa commit nằm trong danh sách Git ở trên và phải được giữ lại.

## 4. Kết quả xác minh gần nhất được ghi trong lịch sử

> Các kết quả này được báo trong phiên trước; **không được chạy lại trong phiên tạo file này**.

- MI-06A targeted tests: **16/16 PASS**.
- Managed Inventory regressions: **189/189 PASS**.
- Full backend suite chạy tuần tự: **410/410 PASS**.
- Backend build: **PASS**.
- `git diff --check`: **PASS**.
- Một lượt full-suite chạy song song trước đó có 3 lỗi timeout subprocess seed; seed chạy riêng **18/18 PASS**, full suite chạy tuần tự **410/410 PASS**.
- Chưa xác nhận transaction rollback/concurrency trên MongoDB replica set thật. Các mock/unit tests không thay thế xác minh integration.
- Chưa có bằng chứng browser/Cloudinary/MongoDB integration thật trong phiên gần nhất.

## 5. Việc đang chờ và thứ tự tiếp theo

1. **Khôi phục kết nối ChatGPT cho WDP:** trạng thái kiểm tra cục bộ gần nhất cho thấy bridge và dịch vụ WDP hoạt động, nhưng địa chỉ kết nối tạm đã đổi và connector `Codex with ChatGPT · WDP` cần được tạo lại. Hướng dẫn tạo lại đang làm theo từng bước; cần tiếp tục từ bước xóa connector cũ nếu nó còn hiện, sau đó tạo lại bằng địa chỉ mới do chẩn đoán cung cấp, cấp quyền và ghép nối bằng mã mới. Không dùng lại địa chỉ/mã ghép nối cũ; không đụng connector workspace khác. Không ghi URL hoặc pairing code tạm vào tài liệu dự án.
2. Khi connector đã kết nối, xác nhận `workspace_info` thực sự trả về workspace **WDP**. Chỉ khi đó mới coi kết nối ChatGPT đã hoàn tất.
3. Review diff MI-06A trên branch hiện tại, đối chiếu code/test với rounding fix và các quyết định kiến trúc bên dưới.
4. Nếu cần xác minh lại, chạy MI-06A targeted tests, Managed Inventory regressions, full backend suite, backend build và `git diff --check`; ghi rõ kiểm tra replica set thật chưa có.
5. Dừng để ChatGPT review MI-06A. **Không bắt đầu MI-06B** cho đến khi có chấp thuận rõ ràng.

## 6. Quyết định và ranh giới phải giữ

- Tách metadata Item, physical stock state, và operation request state.
- Một Item có thể có nhiều receipt batches nhưng chỉ một Cell vật lý tại một thời điểm trong phạm vi MI-06.
- Outbound partial tương lai: Staff ghi số lượng giao thực tế; phần hold chưa giao được giải phóng nguyên tử; request kết thúc `PARTIALLY_FULFILLED`; lần lấy tiếp theo cần request mới.
- Stock về 0 không xóa Item identity hoặc movement history; Item tương thích có thể nhận hàng lại khi Reservation còn đủ điều kiện.
- Relocation tương lai bị chặn khi còn outbound hold chưa giải quyết.
- `CapacityStatus` được suy ra từ stock/capacity; không ghi đè `Cell.operationalStatus` hoặc Reservation status.
- Reservation allocated capacity và CellAllocation còn giữ khi lease hợp lệ; physical usage độc lập.
- Evidence snapshot IMAGE-04 được tạo khi inspection; confirm inbound sau này chỉ xác minh và tham chiếu snapshot accepted hiện tại.
- Không sửa Self-Storage, Customer image upload, Staff evidence hoặc Contract Proof nếu yêu cầu tiếp theo không liên quan và được chấp thuận cụ thể.
- Không commit, migration, seed, production/Atlas write, deploy nếu chưa có yêu cầu/ủy quyền riêng.

## 7. Hướng dẫn mở cuộc trò chuyện mới

Đính kèm file này và yêu cầu ChatGPT:

> Tiếp tục dự án WDP từ `WDP_PROJECT_HANDOFF_2026-10-24.md`. Trước tiên kiểm tra workspace root, branch, HEAD và git status hiện tại; giữ nguyên toàn bộ thay đổi chưa commit. Tiếp tục bước kết nối ChatGPT đang chờ, sau đó review MI-06A FINAL ROUNDING FIX trên branch `feat/change-inbound-and-outbound-flow`. Chỉ báo cáo/đề xuất sửa lỗi cụ thể trong phạm vi đã duyệt; chưa bắt đầu MI-06B và không commit.

