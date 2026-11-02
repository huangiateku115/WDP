# Task 4A — Customer Stock Balance & Canonical Outbound

## Kết luận

Source integration hoàn tất trong phạm vi Customer. Unit/fixture và browser đã PASS. **Không xác minh live E2E** và không bật gate Backend. Canonical creation thực tế vẫn phụ thuộc deployment/gate và dữ liệu ledger đã reconcile. Không gọi API thật, không ghi database, không truy cập `backend/`, không sửa BE-REF.

## Backend contracts

Các đường dẫn dưới đây có prefix `/api/v1`.

| Method/path | Contract thực tế | Evidence trong BE-REF |
| --- | --- | --- |
| GET `/inventory-items/:itemId/stock-balance` | Owner Customer; trả nguyên StockBalance trong `{success:true,data}`; chưa có balance → 404 ITEM_PROJECTION_MISMATCH. Không có gate riêng trong read này. | `src/routes/inventory-item.routes.ts:23`; `src/controllers/inventory-items/inventory-inbound-request.controller.ts:45`; `src/services/inventory-items/repeated-inbound-operations.service.ts:149` |
| POST `/inventory-items/:itemId/outbound-requests` | Body chỉ `{requestedQuantity: positive safe integer}`; Idempotency-Key bắt buộc. Tạo mới 201, replay 200; ETag version; data là request snapshot. | `src/routes/inventory-item.routes.ts:21`; `src/controllers/inventory-items/managed-outbound-request.controller.ts:13`; `src/services/inventory-items/managed-outbound-request.service.ts:198` |
| GET `/inventory-items/:itemId/outbound-requests` | Owner; query page>=1, limit 1..100; response data `{data:[requests],pagination:{page,limit,total,totalPages}}`. Không có create gate cho read. | `src/services/inventory-items/managed-outbound-request.service.ts:239` |
| GET `/outbound-requests/:requestId` | Owner; request snapshot, ETag version; không có create gate cho read. | `src/routes/managed-outbound-request.routes.ts:11`; service:251 |
| POST `/outbound-requests/:requestId/cancel` | Body `{}`; If-Match quoted nonnegative safe version và Idempotency-Key. Chỉ PENDING và item IN_STORAGE còn Cell. Response snapshot CANCELLED, held=0; transaction release holds. Không có create gate áp dụng riêng cho cancel. | `src/routes/managed-outbound-request.routes.ts:12`; controller:29; service:256 |

- Role/auth ở routes, owner filters trong service. Key regex `[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}`; If-Match dạng `"0"` (Backend cũng nhận weak ETag). Thiếu version → 428, sai định dạng → 400, stale → 409. Parse rules tại service:53-69.
- Create mới yêu cầu `MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED=true` và `MI06_STOCK_LEDGER_WRITES_ENABLED=true`. `src/config/mi06-canonical-outbound-gate.ts:2` luôn false khi NODE_ENV production. Source `assertCreateGate` service:131 trả 503 OUTBOUND_REQUEST_FEATURE_DISABLED. Frontend không bật hoặc suy diễn server gate bằng Vite.
- Prior committed event được tìm trước create gate. Replay cùng key/payload có thể được trả khi gate mới đã tắt; không coi đây là tạo request mới. Frontend khóa new-create ở production, vẫn giữ read/cancel và cùng-key retry theo contract Backend.
- Preconditions create: owned IN_STORAGE Item, current Cell hợp lệ, ACTIVE Managed reservation trong `[startDate,endDate)`, facility active, Cell thuộc allocatedCellIds và allocation OCCUPIED đúng Customer/reservation, không unresolved inbound/canonical outbound. Backend vẫn quyết định reconciliation/authorization cuối cùng.
- Các request states: PENDING, CONFIRMED, PARTIALLY_FULFILLED, CANCELLED (`src/types/managed-outbound-request.type.ts:3`). Create/cancel chỉ giữ/nhả stock; không xác nhận physical handover. Customer không gọi Staff confirm/relocation.
- Event replay giữ key + payload; cancel payload hash bao gồm expectedVersion. Khác payload cùng key → 409. Unknown commit/read → 503 OUTBOUND_REQUEST_OUTCOME_UNKNOWN, phải retry đúng key. Transaction và recovery trong service:87-121; cancel dùng transaction và event.
- Legacy/canonical được phân biệt bằng movement metadata hiện có. `src/services/inventory-items/inventory-item.service.ts:51-65` chặn legacy writers trên canonical stock history. Không fallback canonical mutation sang legacy.

## Quantity semantics

StockBalance không có field `availableQuantity` hoặc top-level `quantityUnit`. Các field đã xác minh: itemId/customerId/facilityId/managedReservationId/currentCellId, onHandQuantity, heldQuantity, source, batches, schemaVersion/version và reconciliation fields. Sources: LEDGER_V2, LEGACY_RECONCILED (`src/types/managed-stock.type.ts:48+`). Batches có quantity, heldQuantity, quantityUnit và receiptMovementId.

Available được trình bày bằng **onHandQuantity - heldQuantity**, chỉ sau khi xác minh safe integers không âm, held<=onHand, batch totals khớp, units khớp Item và identity/placement đúng. Không tính từ Item.quantity và không tính lại weight/volume/capacity. Item.quantity được ghi rõ Registered quantity (metadata). Missing/error stock luôn là unknown, không hiển thị zero mặc định.

## Coverage trước sửa và gap đã xử lý

API helpers và allowlist năm endpoint đã có và đúng; giữ nguyên `src/api/inventoryApi.js` và `src/api/confirmedContract.js`, Axios/auth/routes không thay đổi. Item Detail đã gọi CanonicalCustomerOutbound nhưng dedicated outbound page gọi CustomerOutboundAction legacy trực tiếp.

Sửa đúng gap:

- Reuse CanonicalCustomerOutbound trên `/portal/inventory/:id/outbound` bằng outboundAction prop của page hiện có; không tạo component/page/route mới và tránh circular imports.
- Page tải rental qua helper hiện có để xác minh ACTIVE/in-term UI, giữ default legacy action cho callers không truyền prop.
- Thêm link Outbound requests trong Item Detail; Registered quantity được tách khỏi physical stock.
- Parse/validate stock và request envelope, identity, units, totals, state/version; show registered/on-hand/held/available, source và receipt batch summary. Không làm Task 4B Movement History presentation.
- Movement canonical → canonical UI; lỗi read hoặc mutation không chuyển legacy. Movement legacy vẫn giữ action legacy; stock read bổ sung nếu có balance, 404 thể hiện unavailable thay vì suy diễn quantity.
- Quantity phải nguyên dương <=available; không tạo request mới khi còn held quantity. Owner/Cell/rental checks ở UI không thay thế Backend allocation checks.
- Busy ref chặn double-click đồng bộ cho create/cancel/detail. Saved create key/payload đóng băng khi kết quả chưa rõ. Cancel retry giữ key/version. Storage lỗi thì không gửi mutation.
- 409/428 giữ thông báo và refresh current state; không tự overwrite version. Feature-disabled khác với uncertain outcome; không khởi tạo key mới khi outcome chưa rõ.
- Refresh stock/history và selected detail tại chỗ sau create/cancel. Không reload parent Item khi chỉ thay hold vì parent unmount làm mất conflict/retry messages. Parent Item refresh vẫn giữ cho action legacy.
- Read sequence/token guards bỏ stale responses. History hỗ trợ previous/next theo pagination Backend, giữ secondary Item identity guards.

## Files thay đổi

1. `src/components/customer/inventory/CanonicalCustomerOutbound.jsx`
2. `src/components/customer/inventory/CustomerOutbound.jsx`
3. `src/components/customer/inventory/InventoryIntegration.jsx`
4. `src/pages/customer/InventoryMovementRequestPage.jsx`
5. `tests/customer-canonical-outbound.test.mjs` (mới)
6. `tests/customer-canonical-outbound-browser.cjs` (mới)
7. `docs/CustomerStockCanonicalOutboundTask4A.md` (báo cáo này)

Không sửa Repeated Inbound, images, Staff operations, movement/relocation, booking, contracts hoặc payments. Không sửa existing tests để nới assertions; 74 tests baseline giữ nguyên.

## Verification

- Syntax parse: 274 source files PASS.
- `npm test`: **89/89 PASS**, gồm 74 baseline và 15 tests mới.
- `node --test tests/managed-warehouse-booking.test.cjs`: **3/3 PASS**.
- `npm run build`: PASS; cảnh báo chunk >500kB còn tồn tại.
- Canonical browser: **PASS**, 24 intercepted fixture requests; 2 create POST (503 rồi same-key retry), 3 cancel POST (409/version refresh, 503, same-key/version retry). Stock/units, quantity max, details, cancellation, no fallback, 320/390/768/1024/1440/1920 px không document overflow. Không live requests.
- Item Detail P1 browser runner: **PASS**, 9 fixture GET; initial loading/success/null/500, 404/503 feature-disabled; không mutation.
- Inventory Register/Edit/image runner: **PASS**, 74 fixture requests, 0 live requests. Thêm read fixtures trong memory cho movements[] và stock-balance 404; không sửa runner/ảnh cũ. Existing registration, edit, multipart, retry, persisted image order, validation và auth expiry vẫn PASS.

## Remaining limitations

Không biết Backend deployment có bật gate hay không; không claim production create khả dụng. Chưa chạy live E2E hoặc xác minh database transactions/indexes/real batch integrity. Backend vẫn quản lý unresolved inbound/allocation/capacity và staff physical movement. Legacy reads không có initialized ledger có thể 404; UI giữ unknown, không giả lập stock.

Parent Item metadata thay đổi do Staff ở ngoài phiên được cập nhật qua refresh Item/page; stock/history local reads không thực hiện physical movement. Nếu saved operation storage hỏng, UI fail closed thay vì tự tạo key mới; cần reconcile existing history trước khi khôi phục thủ công. Frontend markers không thay thế server idempotency/concurrency.
