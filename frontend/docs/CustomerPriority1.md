# Customer FE — Priority 1

Implementation date: 5 October 2026.

## Requirement source

Implemented the Customer requirements in the supplied pasted task. No separate current SRS was found in the workspace or SelfStorage.zip. A path to the current SRS was requested; formal SRS conformance is therefore not yet independently verified. This task does not implement Facility Manager, Staff, BOM or Admin screens.

## Screens and routes

| Requirement | Route | Implemented behavior |
| --- | --- | --- |
| P005 Profile | `/portal/profile` | Avatar/summary, contact details, editable browser preview, existing profile GET in live mode, password-management entry with an unavailable-API state. |
| P021 Payments / receipt | `/portal/payments` | Search, status filter, reference/rental/contract/type/amount/status/date/PayOS display. Receipt/detail uses `?receipt=PAY-001`; the existing `/portal/payments/:reservationId` checkout is preserved. |
| P028 Rental extension | `/portal/rentals/:id/extend` | SELF_STORAGE: unit, current/new end date, selectable period, estimate and request. MANAGED_INVENTORY: time extension and additional-capacity branch, current allocated/used capacity, prorated estimate. |
| P027 / P040 Unit access | `/portal/rentals/:id/access` | Active self-storage demo access, status/instructions, suspended state; no credentials for Managed Inventory or inactive rentals. |
| P032 Notifications | `/portal/notifications` | All/Unread, category filter, timestamps, individual/all mark-as-read and linked updates. |
| P070 Inventory workspace | `/portal/inventory` | Existing page expanded with search/filter, capacity summary, list and register/detail links. |
| P071 Register item | `/portal/inventory/register` | Category, quantity/unit, dimensions, weight, per-unit and total volume calculation; new status Registered and null location. |
| P072 Item detail | `/portal/inventory/:id` | Item attributes, related managed rental, capacity, current Zone/Rack/Shelf when InStorage, pending requests and available actions. |
| P073 Inbound | `/portal/inventory/:id/inbound` | Registered-item restriction, projected capacity including pending inbounds, confirmation and simulated request. No customer Shelf picker. |
| P075 Outbound | `/portal/inventory/:id/outbound` | InStorage restriction, current location, instructions, confirmation and simulated request. |
| P076 History | `/portal/inventory/:id/history` | Read-only INBOUND, RELOCATION and OUTBOUND records with source/destination/performer/time/notes; pending requests do not become completed movements. |
| Refund visibility | `/portal/refunds/:id` | Reference, linked payment/rental, amount, reason and status. |
| Extra / damage charge | `/portal/charges/:id` | Reason, amount, status and payment-required state with support link; no simulated settlement presented as a real payment. |

11 routes were added. Existing payments and inventory routes were expanded; existing reservation, contract, checkout, handover and public paths were retained.

## Data and API boundaries

- Preview fixtures are isolated in `src/mocks/customerData.js`; preview writes use `src/lib/customerDemoStore.js` and localStorage key `VaultSpace_customer_priority1_demo_v1`.
- Preview actions are enabled only when `VITE_USE_MOCK` is not `false`. Turning mock mode off ignores the saved preview fixtures and disables unsupported writes.
- No files in `src/api/` were modified. Profile reads reuse the existing `authApi.me()` in live mode; profile writes and password changes have no supported endpoint in the current auth API.
- Payment history has no list/receipt/refund/charge API. It displays fixtures in demo mode and can also read payment records created by the existing mock payment API in sessionStorage.
- Rental extension/access, notifications and inventory detail/registration/movement APIs remain pending. The current inventory API exposes only a list read, without a supplied detailed response contract or the required write operations; the new workflow remains an isolated preview.
- Demo categories and units are fixture catalogs, not asserted backend enums.
- Volume per unit is length × width × height. Capacity projections use that volume × quantity and include already-pending inbound requests.
- The preview estimator uses a 30-day month and fixture rates. Actual prices, categories, rules, approvals and supported DTOs must be confirmed against the current SRS/API before production connection.
- Capacity requests do not create a rental or immediately change allocated capacity. Inbound/outbound requests do not assign a Shelf, alter used capacity, change item status or append a completed movement. Staff processing is outside this task.

## Created production files (15)

- [src/mocks/customerData.js](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/mocks/customerData.js)
- [src/lib/customerDemoStore.js](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/lib/customerDemoStore.js)
- [src/components/common/CustomerScreen.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/components/common/CustomerScreen.jsx)
- [src/components/common/CustomerRentalTools.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/components/common/CustomerRentalTools.jsx)
- [src/components/common/InventoryOverview.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/components/common/InventoryOverview.jsx)
- [src/pages/customer/ProfilePage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/ProfilePage.jsx)
- [src/pages/customer/PaymentHistoryPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/PaymentHistoryPage.jsx)
- [src/pages/customer/NotificationsPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/NotificationsPage.jsx)
- [src/pages/customer/RentalExtensionPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/RentalExtensionPage.jsx)
- [src/pages/customer/RentalAccessPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/RentalAccessPage.jsx)
- [src/pages/customer/FinancialDetailPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/FinancialDetailPage.jsx)
- [src/pages/customer/InventoryRegisterPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/InventoryRegisterPage.jsx)
- [src/pages/customer/InventoryDetailPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/InventoryDetailPage.jsx)
- [src/pages/customer/InventoryMovementRequestPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/InventoryMovementRequestPage.jsx)
- [src/pages/customer/InventoryHistoryPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/InventoryHistoryPage.jsx)

## Modified production files (5)

- [src/routes/AppRoutes.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/routes/AppRoutes.jsx)
- [src/layouts/CustomerLayout.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/layouts/CustomerLayout.jsx)
- [src/layouts/experience.css](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/layouts/experience.css)
- [src/pages/customer/MyStoragePage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/MyStoragePage.jsx)
- [src/pages/customer/MyInventoryPage.jsx](C:/Users/laptop/Downloads/vaultspace-green-orange-reactbits/src/pages/customer/MyInventoryPage.jsx)

No package/configuration/authentication/endpoint files or Public screens were modified in this task. Existing MyInventory markup was retained for the empty state and extended with the new inventory overview.

## Validation

- `npm run build`: successful. Vite reports a non-fatal warning for a main JavaScript chunk over 500 kB; no dependency or bundler configuration was changed.
- Edge headless interaction checks: profile save/reload, payment filters and receipt details, notification read state, inventory volume and null-location registration, inbound/outbound confirmation and duplicate prevention, insufficient-capacity rejection, immutable history, extension requests, capacity upgrades without rental creation, and active/suspended/managed access restrictions passed.
- 35 new/existing route scenarios checked at 1440 px and 390 px; no runtime errors, page-wide horizontal overflow or compile overlays. Tables scroll inside their card on mobile.
- Live-mode smoke test: saved mock fixtures ignored, existing profile GET supported, unavailable writes disabled, no invented write endpoints.
- Existing reservation/contract persistence regression: recorded separately in `.design-reference/check-persistence.cjs`.
- Visual previews and validation scripts are retained under `.design-reference/` as local QA artifacts.
