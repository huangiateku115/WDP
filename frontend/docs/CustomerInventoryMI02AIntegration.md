# MI-02A Customer Inventory Registration & Warehouse Map Integration

## 1. Implemented features

Customer My Inventory, registration and detail now use real Backend inventory-items APIs regardless of browser demo mode. Existing route paths, Customer layout, shadcn components, animations and authentication remain in place. The menu label is now **My Inventory**.

Implemented paginated own inventory, registration, Backend totals/detail/images, metadata editing, placement preview and a contextual Warehouse Map action to save a preferred Cell. Real inventory pages do not expose demo inbound/outbound or fabricated movement history. Previous demo implementations are retained as unused local functions, preserving source without using them for real records.

Initial Frontend git status was recorded before edits, including prior Customer/reservation/map changes. Those changes are preserved; existing success-notice copy was not restored when older regression assertions failed.

## 2. Verified API contracts

Source inspected read-only: BE-REF inventory-item routes/controller/service/validation/model/type, shared Managed reservation eligibility guard, image-url validation, reservation owner list, warehouse-map adapter/service and standard error middleware.

All paths use the existing `/api/v1` base, Axios instance and Bearer interceptor.

| Method | Path | Customer behavior |
|---|---|---|
| POST | `/inventory-items` | Register own lot against eligible Managed rental; `{success:true,data:item}` |
| GET | `/inventory-items/me?page=1&limit=20` | Own non-deleted registration history; `data` array and top-level `pagination` |
| GET | `/inventory-items/:id` | Owner detail, including history after rental closure |
| PATCH | `/inventory-items/:id` | Owner editable metadata only |
| GET | `/inventory-items/:id/placement-preview?cellId=...` | Owner advisory preview, no writes |
| GET | `/reservations/me` | Owned Managed rental selection/context |
| GET | `/public/facilities/:id` | Confirm active, non-deleted Managed Facility; obtain actual name |
| GET | `/warehouse-map?facilityId=...` | Existing sanitized structural overview |
| GET | `/racks/:id/detail-map` | Existing selected Rack/Cell structure |

Only the exact Customer inventory paths/methods were added to the API allowlist. Operational GET `/inventory-items`, DELETE, inbound/outbound, stock adjustment and structure writes remain unavailable. No second Axios client or new upload endpoint was introduced.

## 3. DTO mappings and validation

The new form uses Backend fields directly, avoiding demo DTO reuse:

| Input | Sent field |
|---|---|
| Owned ACTIVE Managed rental | `managedReservationId` |
| Item code | `itemCode`, trimmed/uppercase; 1–48 characters, letters/numbers/underscore/hyphen with alphanumeric first character |
| Item name | `name`, 1–160 characters |
| Category | `category`, free non-empty text, max 80; no invented enum |
| Handling-unit count | `quantity`, positive safe integer |
| Quantity unit | `quantityUnit`, free non-empty text, max 32; no demo unit restriction |
| Unit weight | `unitWeightKg`, finite/strictly positive |
| Unit width/depth/height | `unitDimensionsM:{widthM,depthM,heightM}`, finite/strictly positive metres |
| Description | `description`, max 2000 characters |
| Image URLs | `images`, at most 10 HTTP(S) URLs, each at most 2048 characters, hostname required, no username/password |
| Optional Cell preference | `preferredCellId`; create omits empty preference, edit sends null to clear |

Backend computes `unitVolumeM3`, `totalWeightKg` and `totalVolumeM3`. Frontend only checks numerical overflow/underflow to reject invalid measurements; it never sends calculated totals. Owner, Facility, status, createdBy and currentCellId are not sent. Facility/identity come from the authenticated rental relationship.

Returned item/collection envelopes and IDs are validated. Malformed data produces an unavailable state, never demo fallback. Current/preferred Cell IDs stay distinct; displayed totals are returned Backend values.

## 4. Reservation eligibility

The inspected shared guard requires own `MANAGED_INVENTORY`, status `ACTIVE`, finite positive allocatedCapacity in m³, an active/non-deleted Managed Facility, and Facility matching the item for edit/preview. Frontend loads `/reservations/me`, then confirms each unique active candidate Facility through public detail; unavailable facilities are excluded, while network/server failures produce an error instead of a false empty state.

Create and edit re-read eligibility immediately before mutation. No profile VERIFIED gate is invented for MI-02A beyond what the Backend guard requires. No quota consumption is calculated from registered lots.

**Date discrepancy:** current Backend guard does not compare startDate/endDate with current time. An ACTIVE record past its end date can pass it. FE follows this existing guard without creating an unconfirmed time rule; Backend must resolve the discrepancy with the documentation before production enforcement. CLOSED/OVERDUE/PAID/Self Storage records do not authorize registration/edit.

If no eligible rental exists, registration is disabled and My Storage navigation is offered.

## 5. Registration and edit restrictions

Item code is unique per Facility, including soft-deleted codes, and immutable after creation. Edit sends only descriptive/physical metadata, images and optional preference, never itemCode or managedReservationId.

Editing is offered only for REGISTERED items with `currentCellId === null` and an eligible matching Managed rental. Backend final authorization remains authoritative; fresh item/context checks precede PATCH. History remains readable after rental closure.

Successful create verifies the returned item/code/rental/Facility, REGISTERED status and null current Cell, then opens existing `/portal/inventory/:id`. Successful edit re-fetches the item. Returning to My Inventory re-fetches the real list, and an explicit list refresh is available.

Busy refs prevent duplicate submit. A definitive create error (including duplicate code) leaves fields available for correction. An ambiguous network/5xx/malformed result locks that form and directs users to My Inventory before another attempt. No mutation is retried automatically. Correcting an input clears the prior field-validation message.

## 6. Placement Preview

Detail accepts a candidate Cell ID, initially the returned preferred Cell if present. Map selection provides a direct preview action with the actual selected Cell ID. Both use the verified GET preview endpoint.

| Outcome | Display |
|---|---|
| ESTIMATED_FIT | Advisory estimate; packing and availability are not guaranteed |
| NEEDS_MEASUREMENT | Physical measurement or packing verification required |
| NOT_FIT | One or more evaluated constraints fail |

Actual Backend weight/volume/quota values, boolean/null checks, notes and uncertainty reasons are shown. Missing measurements and null checks mean **unknown**, never zero/pass. Missing measured Cell volume is displayed as unknown. Quantity, unit/lot weight and volume remain separate.

Responses must identify the requested item/candidate and explicitly state advisory/no allocation/no reservation/no stock write. No status or occupancy update follows preview. Staff confirmation remains required. Inactive rentals cannot start a new preview; their item history remains readable.

## 7. Warehouse Map integration

Detail opens the existing Facility map with `?inventoryItem=<owned item ID>`. Existing URL paths, structural drawing, selection, hover, cache, zoom/fullscreen, responsive drawer and read APIs are preserved.

A selected Cell inspector adds preview and **Use this Cell as preference** only in a validated item/Facility/rental context. Both Cell and Rack must be AVAILABLE; blocked/maintenance Cells have no preference action. Save uses an explicit confirmation and exactly:

```json
{ "preferredCellId": "<selected Cell ObjectId>" }
```

Fresh item/rental context is re-read before PATCH. Backend enforces active Zone and same-Facility Cell validity at write time. Successful response is checked and the item context refreshed. Result messages are tied to the selected item/Cell to avoid displaying an old result for a different selection. Preference context remains in Rack-detail/back-to-map links. Wrong-Facility item context produces an error without altering the map or issuing a preference mutation.

No WarehouseCell/Rack, Reservation quota, inventory status, current location or movement record is changed. MI-01 usedWeightKg remains the Backend `MI_01_EMPTY` baseline. Customer may express a preference only; physical placement is not implemented.

## 8. Files changed

Created source:

- `src/lib/inventoryRegistration.js`
- `src/components/customer/InventoryFormUI.jsx`
- `src/components/customer/inventory/InventoryBackendUI.jsx`
- `src/components/customer/inventory/InventoryItemForm.jsx`
- `src/components/customer/inventory/InventoryIntegration.jsx`
- `src/components/customer/inventory/PlacementPreview.jsx`
- `src/components/customer/inventory/InventoryMapPreference.jsx`

Modified source:

- `src/api/inventoryApi.js`: real Customer MI-02A adapter; no `/inventory/me` fake branch.
- `src/api/confirmedContract.js`: exact Customer inventory allowlist.
- `src/pages/customer/MyInventoryPage.jsx`: default export uses real list.
- `src/pages/customer/InventoryRegisterPage.jsx`: default export uses real registration.
- `src/pages/customer/InventoryDetailPage.jsx`: default export uses real detail/edit/preview.
- `src/layouts/CustomerLayout.jsx`: My Inventory label only.
- `src/components/customer/warehouse/DigitalWarehouseDashboard.jsx`: contextual preference integration and accurate physical-stock notice; map structure unchanged.

Tests/report:

- `.design-reference/check-inventory-contract.cjs` — created.
- `.design-reference/check-inventory-mi02a.cjs` — created.
- `.design-reference/check-self-storage-completion.cjs` — only creation-success assertion updated to current confirmed reservation code, preserving existing UI copy.
- `.design-reference/check-managed-reservations.cjs` — same stable success assertion adjustment.
- `docs/CustomerInventoryMI02AIntegration.md` — created.

New screenshot evidence:

- `.design-reference/inventory-register-1440.png`
- `.design-reference/inventory-register-1024.png`
- `.design-reference/inventory-register-768.png`
- `.design-reference/inventory-register-390.png`
- `.design-reference/inventory-register-320.png`
- `.design-reference/inventory-preview-1440.png`
- `.design-reference/inventory-preview-320.png`
- `.design-reference/inventory-map-preference-mobile.png`

Regression harnesses regenerate existing Self Storage review, Managed booking and digital-warehouse screenshots. Build artifacts are generated under ignored `dist/`. Other pre-existing working-tree changes are not attributed to this task.

## 9. Build and test results

- Frontend build: PASS, 1980 modules. Existing large main-chunk warning remains (~756 kB); no dependency/config changes.
- `check-inventory-contract.cjs`: PASS — DTO, image/measurement/safe quantity validation, immutable edit fields, Backend ACTIVE/date guard, pagination, advisory null handling and exact allowlist/stock-operation denial.
- `check-inventory-mi02a.cjs`: PASS — 71 intercepted requests covering empty/paginated list, active rental selection, exact create/edit DTO, invalid measurements, duplicate code/click, immutable code, detail/history, all preview outcomes/unknowns, contextual preference, wrong Facility, blocked Cell, placed/closed edit restrictions, ownership, network/mapping/401 and no stock writes. Final refinement also verifies preview failure and a single preference-conflict error; the form clears corrected validation messages.
- `check-digital-warehouse.cjs`: PASS — existing map cache/selection/tooltip/search/zoom/fullscreen/error handling and 5 responsive widths; no extra HTTP inventory reads without item context.
- `check-self-storage-completion.cjs`: PASS — 208 fixture requests, reservation create/cancel/sign/payment, changed price/unit, ownership, 401, errors and duplicate protection.
- `check-managed-reservations.cjs`: PASS — 105 fixture requests, Managed quote/create/detail/cancel/sign/payment/hold and unknown-service guards.

Responsive registration and map checked at 1440, 1024, 768, 390, 320 without document horizontal overflow. Register desktop/mobile screenshots are visually inspected. Detail/advisory/map-preference evidence is captured for review. Mutation tests use isolated fixtures; they are not real Backend E2E.

The first mobile test tried clicking a Cell underneath an open details drawer; it now closes the drawer first, matching actual navigation. The initial overflow test expected rejection of a large but finite value permitted by Backend; it now tests an actual overflowing product. Reservation regression failures were old success-message assertions, corrected without changing reservation source behavior.

## 10. Backend limitations

- Guard date enforcement discrepancy described above remains unchanged.
- Registration is not inbound stock and does not deduct commercial quota. Preview evaluates one lot against quota, not remaining quota after registered items.
- Actual Cell usage remains unknown in MI-01; preview cannot guarantee real remaining capacity.
- Unknown usable height and multiple-unit packing can require physical verification. No split-lot handling or packing allocation is implemented.
- Inventory DTO includes Facility/Reservation/Cell IDs, not populated location paths. FE obtains eligible Facility names from confirmed reads and otherwise displays returned IDs. Exact deep-link resolution for an arbitrary preferred/current Cell without a known Rack is not exposed by a Customer Cell lookup API; no management lookup or bulk scan is invented.
- Category/quantityUnit are free text in this Backend phase; prohibited-goods policy enforcement is not supplied by this API.
- `/inventory-items/me` parses category/status/search but its service only scopes/paginates owner history; FE does not claim server-side search/filter behavior.
- Production error middleware substitutes HTTP status messages, so specific validation messages may only be available in development. FE displays safe actual responses rather than inventing a cause.
- No Customer delete, inbound/outbound, movement history, stock adjustment, actual occupancy aggregate or image-upload endpoint is available. Legacy isolated demo movement routes remain unlinked from real inventory; they are not real integration.

## 11. Remaining live E2E

No approved Customer credentials or isolated live mutation data were supplied. No real create/PATCH, database writes, Staff operations or Backend scripts were run. Outstanding live verification includes database code uniqueness, real ownership/RBAC, configured active rental/Facility data, concurrent Cell status changes, measured geometry/packing and production response behavior. No production readiness or real authenticated E2E success is claimed.

## 12. Source protection

All task edits are restricted to `frontend/`. Original `backend/` contents were not accessed. No BE-REF source, routes/models/validation, migrations/seeds or database data were modified. Existing Axios/auth/token architecture and all other role workspace source remain untouched.

BE-REF initial aggregate: 155 files, SHA-256 `cf8b4f4e6054a2789f9eb672ec8556a6dc38693053de38d9c1f08f0d90330ec4`. Final comparison matches all 155 files; BE-REF is unchanged (scope excludes `.git`, `node_modules`, symlinks). Pre-existing Customer copy/formatting and working-tree changes are preserved.
