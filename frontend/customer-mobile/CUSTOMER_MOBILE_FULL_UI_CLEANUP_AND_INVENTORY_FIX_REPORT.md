# WDP Customer Mobile UI Cleanup & Inventory Fix Report

**TASK_ID:** `WDP_CUSTOMER_MOBILE_FULL_UI_CLEANUP_AND_INVENTORY_FIX`  
**STATE:** PARTIAL  
**Checkpoint:** `WDP_CUSTOMER_MOBILE_FULL_UI_CLEANUP_REVIEW_REQUIRED`

## A. Inventory loading root cause

The mobile rental helper `mobileRepo.rental()` gets `/reservations/me` and searches the returned list for the ID. When absent, it throws “Không tìm thấy đơn thuê này trong tài khoản của bạn.” This couples SKU stock loading to list membership and overstates ownership denial when absence alone is not proof. `/reservations/me` in the inspected backend controller returns an unpaginated array, so pagination was not the cause in this source. A live customer account/session was not available for reproducing the reported data, so the account-specific original cause remains unconfirmed.

The SKU’s `managedReservationId` is the reservation reference used by the mobile adapter. The item mapper normalizes references through `refId`; item ownership is checked by customer ID; the managed detail mapper also enforces customer ownership and validates the returned ID and `MANAGED_INVENTORY` service type. V3 scope additionally checks active SKU, booking-flow version, reservation linkage and facility match before calling stock APIs.

## B. Reservation mapping findings

The old shared list lookup could return “not found in your account” for a missing list row; it did not distinguish absent from confirmed unauthorized. The V3 stock panel now calls `GET /reservations/managed/:id` directly through `mobileRepo.managedRental`, which avoids that list dependency while preserving customer ownership and reservation/service checks. Backend `ManagedReservationService.get()` is customer scoped. Cross-customer requests remain denied.

## C. Stock API findings

Backend route source confirms `GET /inventory-items/:id/v3/stock`, `GET /:skuId/v3/cell-stock`, and `GET /:skuId/v3/specifications/:specId/cell-stock`. Stock remains gated on a successfully loaded, customer-owned reservation and matching SKU/facility scope. API errors are not represented as zero stock. The panel preserves retry states, and `CHECKING` is shown as “Thông tin tồn kho đang được kiểm tra.” A confirmed no-activity response is shown as “Chưa có hàng trong kho.”

## D. Files changed

Primary changes are in `src/api/mobileRepository.ts`, `src/components/ManagedSkuStockPanel.tsx`, `src/components/liveUI.tsx`, `src/api/client.ts`, managed reservation/payment/inventory UI components, and the tests under `tests/`. Several additional screen copy edits were made during the text audit. No backend, `.env`, payment business logic, database, or Git metadata was changed.

## E. Inventory bug fix

V3 stock reservation lookup now uses the scoped managed detail endpoint rather than searching `/reservations/me`. SKU, reservation, customer and facility checks remain in place. Unknown reconciliation and failed stock loads remain distinguishable and retryable.

## F–G. Full UI text audit and wording cleanup

Scanned route/screen/component source under `app/`, `src/screens/`, and `src/components/`: 48 route/layout TypeScript files, 47 screen TSX files and 34 component TSX files. Customer-facing error states no longer expose raw API error details, HTTP codes or raw error codes via shared `ResourceState`; technical identifiers are retained internally. Copy was cleaned in managed inventory, booking/support and other relevant screens.

The full removal criterion is not met. Remaining customer-visible technical wording was found, especially in `src/components/ManagedInboundPreviewCard.tsx` (Backend, SKU, Operation Lookup, Cell Stock, Specification, Movement, Readback), plus other sample/preview flows such as `src/screens/InventoryRequestScreen.tsx`, `src/screens/InventoryRequestDetailScreen.tsx`, `src/screens/SupportDetailScreen.tsx`, and `src/screens/RentalDetailScreen.tsx`. Preview/sample labels also remain across several flows. This is why the task is marked PARTIAL. Audit counts of total found/corrected strings were not mechanically deduplicated, so they are not claimed as exact counts.

Representative audit rows:

| File | Text found | Customer visible? | Action |
|---|---|---:|---|
| `src/components/ManagedInboundPreviewCard.tsx` | “Backend đã xác nhận…” / “Operation Lookup…” | Yes | Unresolved; requires copy pass |
| `src/components/ManagedInboundPreviewCard.tsx` | “Cell Stock”, “Specification”, “Readback” | Yes | Unresolved; requires copy pass |
| `src/screens/InventoryRequestScreen.tsx` | “Backend”, sample/preview labels | Yes | Copy partially cleaned; verify remaining lines |
| `src/screens/SupportDetailScreen.tsx` | “Backend có API hội thoại…” | Yes | Unresolved |
| `src/components/ManagedSkuStockPanel.tsx` | raw reservation/stock resource errors | Yes | Replaced with customer-safe shared resource state |

## H. Error messages

Shared resource errors no longer display raw error strings, status numbers or codes to customers. Network/session/configuration errors use safe Vietnamese copy. Retry affordances remain where the resource state supports retry. Some screen-specific messages outside the audited main live inventory/payment flow still need review.

## I. Payment progress consistency

Payment evidence logic was not changed. Managed rental progress continues to require linked payment evidence and verified/applied settlement state; unknown or contradictory evidence is not converted into success. Customer-facing managed payment/progress components no longer surface raw linked payment IDs or backend terminology in their revised states. No checkout was created.

## J. Tests

- `npm run typecheck`: PASS
- `npm test -- --runInBand`: PASS — 46 suites, 749 tests
- `npm run export:native`: PASS — Android and iOS bundles exported

## K. Expo export

`artifacts/native` contains Android and iOS exports (approximately 4.8 MB and 4.7 MB bundles). `.env` was loaded by Expo but not modified.

## L. Runtime UI evidence

No Expo Web/device runtime walkthrough was performed. Build/export success is not runtime UI PASS. Manual review is still required for the screen and error-state checklist below.

## M. Remaining blockers

No backend change is identified as necessary for the source fix. The live account-specific failure and UI rendering on device/browser remain unverified. The incomplete all-screen customer-copy pass is the primary remaining source task.

## N. Manual testing checklist

- Sign in with a customer account containing a V3 managed SKU; confirm its linked managed reservation loads via detail endpoint.
- Confirm a customer-owned reservation and a mismatched/other-customer reservation retain the correct access behavior.
- Check stock success, confirmed empty stock, checking reconciliation, network/API failure and retry.
- Verify stock, cell and specification quantities never show zero on failed/unknown responses.
- Check active managed reservation and facility scope mismatch handling.
- Verify account switching/session expiry clears old owner-scoped reservation and stock data.
- Review the five main tabs, nested booking, payment, rental, inventory, support and error/empty/modal states on a narrow device.
- Confirm payment progress with verified applied payment and with missing/conflicting evidence; no new checkout should be initiated.
- Recheck self-storage booking and customer inventory flows for regressions.
