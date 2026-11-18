# Customer Mobile Implementation

**Workspace:** `WDP/frontend/customer-mobile/`  
**Verification mode:** offline source, typecheck, Jest, Expo native export  
**Database/Integration:** no MongoDB writes or IT01–IT10 runs were performed.

## Implemented screens

The existing Expo Router and React Native project was extended in place. No Mobile project was recreated, and no dependencies, Web source, Backend source, `.env`, PayOS webhook, or database configuration were changed.

| Area | Mobile screens and behavior |
| --- | --- |
| Self Storage | Existing live facility discovery/detail, availability, storage unit and term selection, quote/review, reservation creation, hosted PayOS payment, rental list/detail, payment history, contract detail, notifications, and checkout request retained. |
| Managed Inventory | Existing live facility map, Cell selection/booking, quote/payment, reservation lifecycle, access visits/sessions, stock reads, inbound preview/confirm, and movement history retained. Added live SKU registration/edit, Item Specification list/create/edit/soft-delete, live V3 Outbound preview/confirm/recovery, and V3 Relocation preview/confirm/recovery. |
| Customer account | Existing live login/register, profile, contract and payment history retained. Support list/create/detail/messages now use authenticated Support APIs rather than fixture content. |
| Navigation | Added a live SKU detail route and connected the SKU picker and SKU save actions to it. Inventory details expose inbound, outbound, relocation, specification, edit, and movement-history actions. |

Outbound supports partial or full receipt-lot removal and whole Item Instance selection. Relocation supports receipt-lot movement between Cells and Reservation scopes exposed by the Backend context, plus whole Item Instance movement to a selected destination Cell. Both flows require a current Access Session, server preview, explicit customer confirmation, idempotency key, and committed Movement verification before showing success. They do not optimistically change stock.

## API connection status

“Connected” below means the Mobile adapter uses a route present in the current Backend source and validates the response. This task did not call an authenticated production deployment, so it does not claim live deployment verification.

### Connected to current Backend routes

- Authentication, current user, customer profile, reservations, facilities, storage units, availability, pricing, booking estimates, contracts, payments, notifications and checkout request.
- Managed Inventory facility map, capacity/quote/booking, reservations, contract/payment state, access visits/sessions, closure readiness, SKU collection/detail, SKU categories, Item Specification and quantity-unit catalogs.
- Unified Inbound context, preview, confirm and operation lookup. The existing production guard response is surfaced as an API error; the app does not bypass it.
- V3 stock, Cell stock and Movement history.
- V3 Direct Outbound context, preview, confirm and operation lookup.
- V3 Relocation context, preview, confirm and operation lookup.
- Customer Support list/create/detail and public message list/send. Support requests are intentionally not linked automatically to Reservation or SKU because the current Customer API does not verify those related entity types on create.

### Not enabled or still blocked

- **Self Storage renewal:** the legacy `/renew` endpoint changes the Reservation term immediately without a payment fence. The extension flow has a PayOS checkout endpoint whose controller does not verify that the authenticated Customer owns the Reservation before returning checkout data. Mobile does not expose either route until Backend ownership and payment-state handling are corrected. The current hosted PayOS booking/payment flows remain available.
- **Inbound A1 physical-unit creation:** current Backend physical-unit routes are fail-closed with HTTP 410. The UI does not simulate A1 success. A2 receipt-lot Inbound remains behind the current Backend production guard and displays its response, including HTTP 503.
- **IT03:** `skuId không hợp lệ` is recorded as a Backend/integration backlog item. No Write Mode was run or retried.
- Deployment credentials/data and authenticated live API behavior were not tested during this task.

## Files changed

- `src/api/client.ts` — added the HTTP `DELETE` method required by the existing Item Specification soft-delete API.
- `src/api/managedSpecifications.ts` — owner-scoped SKU specification/catalog client, request validation and saved-result checks.
- `src/api/managedStockOperations.ts` — V3 Outbound/Relocation context, preview, confirm, operation lookup and Movement ownership/idempotency validation.
- `src/components/ManagedSpecifications.tsx` — reusable Vietnamese Item Specification manager.
- `src/screens/ManagedSkuForms.tsx` — live SKU registration and edit routes.
- `src/screens/ManagedStockOperations.tsx` — Outbound and Relocation flows with session, preview, confirmation and recovery states.
- `src/screens/LiveSupport.tsx` — live Support list, request creation, request detail and message flow.
- `src/screens/LiveAccount.tsx` — live SKU route, specification section and operation navigation.
- `src/screens/ManagedCatalog.tsx`, `src/screens/ManagedDashboard.tsx`, `src/screens/ManagedSessionSkuPicker.tsx` — connected current SKU actions to the live detail route and exposed registration.
- `app/inventory/register.tsx`, `app/inventory/edit/[id].tsx`, `app/inventory/[id].tsx`, `app/inventory/[id]/inbound.tsx`, `app/inventory/[id]/outbound.tsx`, `app/inventory/[id]/relocation.tsx` — live inventory routes replacing stubs or adding route entries.
- `app/support/index.tsx`, `app/support/new.tsx`, `app/support/[requestId].tsx` — connected the existing Support routes to live screens.
- This report.

## Verification

| Command | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | PASS | Mobile TypeScript strict check. |
| `npm test -- tests/screens.test.tsx tests/managed-v3-visits.test.ts tests/live-api.test.ts tests/live-booking.test.ts --runInBand --forceExit` | PASS | 4 suites, 111 tests. |
| `npm test -- --runInBand --forceExit` | PARTIAL | 25 suites passed, 3 failed; 638 tests passed, 4 failed. Failures are in `live-managed-inventory.test.ts` (fixture Item is not V3), `managed-v3-booking-payment.test.ts` (two assertions expect obsolete SKU DTO/operation envelope), and `customer-web-containment.test.ts` (Web test hook mock lacks `useMemo`). No failing test names point to the newly added Mobile screens/adapters. These were not rewritten to make the suite green. |
| `npm run export:native` | PASS | Metro exported Android and iOS bundles to `artifacts/native`. This verifies bundle/navigation compilation, not a device runtime session. |
| MongoDB Integration / Write Mode | NOT_RUN | No database access or data mutation was performed. |

## Run on a phone

From PowerShell:

```powershell
Set-Location C:\Users\laptop\Desktop\WDP\frontend\customer-mobile
$env:EXPO_PUBLIC_API_BASE_URL = "http://<COMPUTER-LAN-IP>:5000/api/v1"
npm start
```

Open the Expo QR code with Expo Go on the phone. The phone and Backend computer must be reachable on the same development network, and the Backend must allow the Expo app's requests. For Android emulator, use `http://10.0.2.2:5000/api/v1`; a physical phone must use the computer's reachable LAN address. Release builds require HTTPS. The Expo command read the existing `.env` during export; it was not modified.

## Backend backlog

1. Fix the IT03 `skuId không hợp lệ` request/fixture contract and run a separately approved, newly scoped integration attempt later.
2. Keep the production Unified Inbound HTTP 503 guard in force until Backend readiness is approved. Do not represent A2 as production-ready while blocked.
3. Implement and verify the A1 physical-unit API before enabling Mobile A1.
4. Repair Self Storage renewal ownership and payment fences; the direct renewal mutation and extension PayOS ownership gap currently make renewal unsafe to expose.
5. Update the three stale/failing Jest contracts and Web hook mock listed above, then rerun the entire suite.
6. Run authenticated API checks on a designated test deployment and verify native PayOS return behavior before claiming deployment/device acceptance.

**Checkpoint:** `WDP_CUSTOMER_MOBILE_IMPLEMENTATION_COMPLETE`
