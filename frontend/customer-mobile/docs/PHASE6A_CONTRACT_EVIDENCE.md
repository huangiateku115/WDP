# Phase 6A — Contract Evidence

Source root: `C:/Users/laptop/Desktop/WDP/BE-REF/`. All VERIFIED_FROM_BACKEND_SOURCE findings refer to this frozen accessible snapshot, not production. `.git` absent: branch/commit UNVERIFIED. See PHASE6A_SOURCE_BASELINE.json for per-file SHA-256; never read `.env`. No version-matched OpenAPI found/referenced in inspected src/docs/README/package. Tests below were read, NOT executed. Symbols/line anchors identify exact reviewed implementation; route evidence alone is not treated as DTO/ownership proof.

## E-ROOT — Mounts and global protection

- [src/app.ts:33](C:/Users/laptop/Desktop/WDP/BE-REF/src/app.ts:33) — `app.use('/api/v1'`; inspect lines 33–38.
- [src/app.ts:22](C:/Users/laptop/Desktop/WDP/BE-REF/src/app.ts:22) — `globalLimiter`; inspect lines 22–33.
- [src/routes/index.ts:35](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/index.ts:35) — `router.use('/public'`; inspect lines 35–46.
- [src/routes/index.ts:52](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/index.ts:52) — `router.use('/reservations'`; inspect lines 52–63.
- [src/routes/index.ts:53](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/index.ts:53) — `router.use('/contracts'`; inspect lines 53–63.

## E-AUTH — Bearer JSON login, no refresh route, account status and logout

- [src/routes/auth.routes.ts:8](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/auth.routes.ts:8) — `router.post('/login'`; inspect lines 8–19.
- [src/routes/auth.routes.ts:11](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/auth.routes.ts:11) — `router.post('/logout'`; inspect lines 11–22.
- [src/routes/auth.routes.ts:14](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/auth.routes.ts:14) — `forgotPasswordLimiter`; inspect lines 14–24.
- [src/controllers/auth/auth.controller.ts:6](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/auth/auth.controller.ts:6) — `export const login`; inspect lines 6–17.
- [src/controllers/auth/auth.controller.ts:48](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/auth/auth.controller.ts:48) — `export const logout`; inspect lines 48–59.
- [src/controllers/auth/auth.controller.ts:87](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/auth/auth.controller.ts:87) — `export const resetPassword`; inspect lines 87–98.
- [src/services/auth/auth.service.ts:11](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/auth/auth.service.ts:11) — `static async login`; inspect lines 11–22.
- [src/services/auth/auth.service.ts:50](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/auth/auth.service.ts:50) — `accessToken:`; inspect lines 50–61.
- [src/services/auth/auth.service.ts:56](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/auth/auth.service.ts:56) — `static async logout`; inspect lines 56–67.
- [src/services/auth/auth.service.ts:74](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/auth/auth.service.ts:74) — `static async forgotPassword`; inspect lines 74–85.
- [src/services/auth/auth.service.ts:116](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/auth/auth.service.ts:116) — `static async resetPassword`; inspect lines 116–127.
- [src/middlewares/auth/requireAuth.ts:20](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/auth/requireAuth.ts:20) — `export const requireAuth`; inspect lines 20–31.
- [src/middlewares/auth/requireAuth.ts:35](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/auth/requireAuth.ts:35) — `jwtVerify(token`; inspect lines 35–46.
- [src/middlewares/auth/requireAuth.ts:54](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/auth/requireAuth.ts:54) — `if (!user.isActive)`; inspect lines 54–65.
- [src/middlewares/auth/requireRole.ts:8](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/auth/requireRole.ts:8) — `export const requireRole`; inspect lines 8–19.

## E-USER — Registration/self profile/password, Customer role forced server-side

- [src/routes/user.routes.ts:10](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/user.routes.ts:10) — `router.post('/register'`; inspect lines 10–21.
- [src/routes/user.routes.ts:14](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/user.routes.ts:14) — `router.get('/me'`; inspect lines 14–25.
- [src/routes/user.routes.ts:15](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/user.routes.ts:15) — `router.put('/me/profile'`; inspect lines 15–26.
- [src/routes/user.routes.ts:16](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/user.routes.ts:16) — `router.put('/me/password'`; inspect lines 16–27.
- [src/controllers/users/user.controller.ts:7](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/user.controller.ts:7) — `export const registerCustomer`; inspect lines 7–18.
- [src/controllers/users/user.controller.ts:27](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/user.controller.ts:27) — `export const getMe`; inspect lines 27–38.
- [src/controllers/users/user.controller.ts:31](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/user.controller.ts:31) — `export const updateMyProfile`; inspect lines 31–42.
- [src/controllers/users/user.controller.ts:52](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/user.controller.ts:52) — `export const changeMyPassword`; inspect lines 52–63.
- [src/services/users/user.service.ts:9](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/users/user.service.ts:9) — `static async registerCustomer`; inspect lines 9–20.
- [src/services/users/user.service.ts:24](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/users/user.service.ts:24) — `role: UserRole.CUSTOMER`; inspect lines 24–35.
- [src/services/users/user.service.ts:50](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/users/user.service.ts:50) — `static async changeMyPassword`; inspect lines 50–61.
- [src/models/users/user.model.ts:20](C:/Users/laptop/Desktop/WDP/BE-REF/src/models/users/user.model.ts:20) — `displayName`; inspect lines 20–31.
- [src/models/users/user.model.ts:39](C:/Users/laptop/Desktop/WDP/BE-REF/src/models/users/user.model.ts:39) — `isActive`; inspect lines 39–50.

## E-PROFILE — Customer identity profile; GET can create missing profile

- [src/routes/customer-profile.routes.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/customer-profile.routes.ts:13) — `router.get('/me/profile'`; inspect lines 13–23.
- [src/routes/customer-profile.routes.ts:14](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/customer-profile.routes.ts:14) — `router.put('/me/profile'`; inspect lines 14–23.
- [src/controllers/users/customer-profile.controller.ts:7](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/customer-profile.controller.ts:7) — `export const getMyProfile`; inspect lines 7–18.
- [src/controllers/users/customer-profile.controller.ts:12](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/customer-profile.controller.ts:12) — `CustomerProfileModel.create`; inspect lines 12–23.
- [src/controllers/users/customer-profile.controller.ts:20](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/users/customer-profile.controller.ts:20) — `export const updateMyProfile`; inspect lines 20–31.

## E-CATALOG — Public allowlisted catalog and informational size availability

- [src/routes/public.routes.ts:5](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/public.routes.ts:5) — `router.get('/facilities'`; inspect lines 5–10.
- [src/services/public/public-catalog.service.ts:14](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/public/public-catalog.service.ts:14) — `function publicFacility`; inspect lines 14–25.
- [src/services/public/public-catalog.service.ts:36](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/public/public-catalog.service.ts:36) — `static async listFacilities`; inspect lines 36–47.
- [src/services/public/public-catalog.service.ts:57](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/public/public-catalog.service.ts:57) — `static async getFacility`; inspect lines 57–68.
- [src/services/public/public-catalog.service.ts:75](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/public/public-catalog.service.ts:75) — `static async storageOptions`; inspect lines 75–86.
- [src/services/public/public-catalog.service.ts:90](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/public/public-catalog.service.ts:90) — `static async pricing`; inspect lines 90–99.

## E-UNITS — Exact physical Units; list has no period availability query

- [src/routes/storage-unit.routes.ts:10](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/storage-unit.routes.ts:10) — `router.get('/facilities/`; inspect lines 10–17.
- [src/routes/storage-unit.routes.ts:11](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/storage-unit.routes.ts:11) — `router.get('/storage-units/`; inspect lines 11–17.
- [src/services/storage-units/storage-unit.service.ts:10](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/storage-units/storage-unit.service.ts:10) — `function scope`; inspect lines 10–21.
- [src/services/storage-units/storage-unit.service.ts:69](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/storage-units/storage-unit.service.ts:69) — `static async getStorageUnits`; inspect lines 69–80.
- [src/services/storage-units/storage-unit.service.ts:83](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/storage-units/storage-unit.service.ts:83) — `static async getStorageUnitById`; inspect lines 83–94.
- [src/services/storage-units/storage-unit.validation.ts:71](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/storage-units/storage-unit.validation.ts:71) — `export function parseList`; inspect lines 71–82.

## E-PRICING — Effective pricing and policy resolver

- [src/routes/pricing-policy.routes.ts:14](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/pricing-policy.routes.ts:14) — `resource.get('/resolve'`; inspect lines 14–23.
- [src/routes/pricing-policy.routes.ts:15](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/pricing-policy.routes.ts:15) — `resource.get('/'`; inspect lines 15–23.
- [src/routes/pricing-policy.routes.ts:16](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/pricing-policy.routes.ts:16) — `resource.get('/:id'`; inspect lines 16–23.
- [src/services/pricing-policy/rule.validation.ts:140](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/pricing-policy/rule.validation.ts:140) — `export function resolver`; inspect lines 140–151.
- [src/services/pricing-policy/rule.validation.ts:144](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/pricing-policy/rule.validation.ts:144) — `export function list`; inspect lines 144–155.
- [src/services/pricing-policy/rule.service.ts:117](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/pricing-policy/rule.service.ts:117) — `async resolve`; inspect lines 117–128.
- [src/services/pricing-policy/rule.service.ts:130](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/pricing-policy/rule.service.ts:130) — `currentPublicPricing`; inspect lines 130–141.

## E-SELF — Self creation/estimate/owner list/detail/cancel and incomplete overlap states

- [src/routes/reservation.routes.ts:12](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:12) — `router.post('/estimate'`; inspect lines 12–23.
- [src/routes/reservation.routes.ts:35](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:35) — `router.post('/'`; inspect lines 35–46.
- [src/routes/reservation.routes.ts:36](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:36) — `router.get('/me'`; inspect lines 36–47.
- [src/routes/reservation.routes.ts:54](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:54) — `router.get('/:id'`; inspect lines 54–63.
- [src/controllers/reservations/reservation.controller.ts:16](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:16) — `export const createReservation`; inspect lines 16–27.
- [src/controllers/reservations/reservation.controller.ts:44](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:44) — `export const getMyReservations`; inspect lines 44–55.
- [src/controllers/reservations/reservation.controller.ts:72](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:72) — `export const getReservationById`; inspect lines 72–83.
- [src/controllers/reservations/reservation.controller.ts:167](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:167) — `export const cancelReservation`; inspect lines 167–178.
- [src/controllers/reservations/reservation.controller.ts:239](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:239) — `export const estimateRent`; inspect lines 239–250.
- [src/services/reservations/reservation.service.ts:24](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/reservation.service.ts:24) — `private static async checkOverlap`; inspect lines 24–35.
- [src/services/reservations/reservation.service.ts:64](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/reservation.service.ts:64) — `static async calculatePricing`; inspect lines 64–75.
- [src/services/reservations/reservation.service.ts:107](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/reservation.service.ts:107) — `static async createReservation`; inspect lines 107–118.
- [src/types/reservation.type.ts:4](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/reservation.type.ts:4) — `export enum ReservationStatus`; inspect lines 4–15.

## E-MANAGED — Distinct multi-Cell quote/create and owner/facility rules

- [src/routes/reservation.routes.ts:18](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:18) — `router.post('/managed/quote'`; inspect lines 18–29.
- [src/routes/reservation.routes.ts:19](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:19) — `router.post('/managed'`; inspect lines 19–30.
- [src/routes/reservation.routes.ts:22](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/reservation.routes.ts:22) — `router.get('/managed/:id'`; inspect lines 22–33.
- [src/services/reservations/managed-reservation.service.ts:29](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:29) — `const managedDepositFlowEnabled`; inspect lines 29–40.
- [src/services/reservations/managed-reservation.service.ts:59](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:59) — `function parseRequest`; inspect lines 59–70.
- [src/services/reservations/managed-reservation.service.ts:92](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:92) — `function committedQuery`; inspect lines 92–103.
- [src/services/reservations/managed-reservation.service.ts:284](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:284) — `static async quote`; inspect lines 284–295.
- [src/services/reservations/managed-reservation.service.ts:313](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:313) — `static async create`; inspect lines 313–324.
- [src/services/reservations/managed-reservation.service.ts:397](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:397) — `static async getCapacity`; inspect lines 397–408.
- [src/services/reservations/managed-reservation.service.ts:415](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:415) — `static async get(`; inspect lines 415–426.
- [src/services/reservations/managed-reservation.service.ts:474](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:474) — `static async cancel`; inspect lines 474–485.
- [src/services/reservations/managed-reservation.service.ts:493](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:493) — `static async mockPay`; inspect lines 493–504.

## E-MAP — Sanitized map geometry, period status, bookability and ownership flags

- [src/routes/warehouse-map.routes.ts:12](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/warehouse-map.routes.ts:12) — `router.get('/warehouse-map'`; inspect lines 12–23.
- [src/routes/warehouse-map.routes.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/warehouse-map.routes.ts:13) — `router.get('/racks/:id/detail-map'`; inspect lines 13–24.
- [src/controllers/warehouse-map/warehouse-map.controller.ts:67](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/warehouse-map/warehouse-map.controller.ts:67) — `export const warehouseMap`; inspect lines 67–75.
- [src/services/warehouse-map/warehouse-map.service.ts:47](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:47) — `async function assertCustomerMapAccess`; inspect lines 47–58.
- [src/services/warehouse-map/warehouse-map.service.ts:191](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:191) — `function parseBookingRange`; inspect lines 191–202.
- [src/services/warehouse-map/warehouse-map.service.ts:229](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:229) — `function cellBookingDto`; inspect lines 229–240.
- [src/services/warehouse-map/warehouse-map.service.ts:240](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:240) — `const periodStatus`; inspect lines 240–251.
- [src/services/warehouse-map/warehouse-map.service.ts:245](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:245) — `const isBookable`; inspect lines 245–256.
- [src/services/warehouse-map/warehouse-map.service.ts:656](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:656) — `static async warehouseMap`; inspect lines 656–667.
- [src/services/warehouse-map/warehouse-map.service.ts:133](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:133) — `mapX: rack.mapX`; inspect lines 133–144.
- [src/services/warehouse-map/warehouse-map.service.ts:730](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:730) — `static async rackDetailMap`; inspect lines 730–741.

## E-DEPOSIT — Managed development-only MOCK deposit with body idempotency

- [src/services/reservations/managed-reservation.service.ts:514](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:514) — `static async initiateDeposit`; inspect lines 514–525.
- [src/services/reservations/managed-reservation.service.ts:549](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:549) — `static async confirmMockDeposit`; inspect lines 549–560.
- [src/services/reservations/managed-reservation.service.ts:578](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:578) — `reconciliationRequired: true`; inspect lines 578–589.

## E-CHECKIN — Managed version/hash server snapshots, signatures, balance and gates

- [src/services/reservations/managed-checkin.service.ts:32](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:32) — `const enabled`; inspect lines 32–43.
- [src/services/reservations/managed-checkin.service.ts:60](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:60) — `async function currentContent`; inspect lines 60–71.
- [src/services/reservations/managed-checkin.service.ts:84](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:84) — `async function ensureVersion`; inspect lines 84–95.
- [src/services/reservations/managed-checkin.service.ts:244](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:244) — `static async createOrRefreshContract`; inspect lines 244–255.
- [src/services/reservations/managed-checkin.service.ts:276](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:276) — `static async signContract`; inspect lines 276–287.
- [src/services/reservations/managed-checkin.service.ts:298](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:298) — `static async signFacilityContract`; inspect lines 298–309.
- [src/services/reservations/managed-checkin.service.ts:322](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:322) — `static async initiateBalance`; inspect lines 322–333.
- [src/services/reservations/managed-checkin.service.ts:364](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:364) — `static async confirmMockBalance`; inspect lines 364–375.
- [src/services/reservations/managed-checkin.service.ts:398](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:398) — `function signedByBothCurrentVersion`; inspect lines 398–409.
- [src/services/reservations/managed-checkin.service.ts:405](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-checkin.service.ts:405) — `async function updateSignedState`; inspect lines 405–416.
- [src/types/contract.type.ts:3](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/contract.type.ts:3) — `export enum ContractStatus`; inspect lines 3–14.
- [src/types/contract.type.ts:26](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/contract.type.ts:26) — `currentContentVersion`; inspect lines 26–37.
- [src/types/contract.type.ts:34](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/contract.type.ts:34) — `signatures?`; inspect lines 34–45.

## E-CONTRACT — Customer contract reads and unsafe print; legacy paper path

- [src/routes/contract.routes.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/contract.routes.ts:13) — `router.get('/me'`; inspect lines 13–24.
- [src/routes/contract.routes.ts:15](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/contract.routes.ts:15) — `router.get('/:id/print'`; inspect lines 15–26.
- [src/routes/contract.routes.ts:17](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/contract.routes.ts:17) — `router.patch('/:id/sign'`; inspect lines 17–28.
- [src/controllers/contracts/contract.controller.ts:15](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:15) — `export const getMyContracts`; inspect lines 15–26.
- [src/controllers/contracts/contract.controller.ts:26](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:26) — `export const getContractById`; inspect lines 26–37.
- [src/controllers/contracts/contract.controller.ts:51](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:51) — `export const getContractByReservationId`; inspect lines 51–62.
- [src/controllers/contracts/contract.controller.ts:71](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:71) — `export const signContract`; inspect lines 71–82.
- [src/controllers/contracts/contract.controller.ts:129](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:129) — `export const confirmSignedPaper`; inspect lines 129–140.
- [src/controllers/contracts/contract.controller.ts:180](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:180) — `export const getContractPrintData`; inspect lines 180–191.

## E-SELF_PAYMENT — Self stage initiation is breakdown-only; unsafe un-gated mock confirms

- [src/controllers/reservations/reservation.controller.ts:276](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:276) — `export const initiateDeposit`; inspect lines 276–287.
- [src/controllers/reservations/reservation.controller.ts:315](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:315) — `export const confirmMockDeposit`; inspect lines 315–326.
- [src/controllers/reservations/reservation.controller.ts:406](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:406) — `export const initiateBalance`; inspect lines 406–417.
- [src/controllers/reservations/reservation.controller.ts:455](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:455) — `export const confirmMockBalance`; inspect lines 455–466.
- [src/controllers/reservations/reservation.controller.ts:518](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:518) — `export const handoverReservation`; inspect lines 518–529.
- [src/controllers/reservations/reservation.controller.ts:200](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/reservations/reservation.controller.ts:200) — `export const mockPayReservation`; inspect lines 200–211.

## E-PAYMENT — Accounting, distinct purposes and ledger shape; provider enum is not implementation

- [src/services/payments/payment-accounting.ts:35](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/payments/payment-accounting.ts:35) — `export function calculateRentalPaymentBreakdown`; inspect lines 35–46.
- [src/services/payments/payment-accounting.ts:63](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/payments/payment-accounting.ts:63) — `export function assertIdempotentPaymentMatch`; inspect lines 63–74.
- [src/services/payments/payment-accounting.ts:71](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/payments/payment-accounting.ts:71) — `export function transitionPaymentStatus`; inspect lines 71–82.
- [src/services/payments/payment-accounting.ts:80](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/payments/payment-accounting.ts:80) — `export function roundVndAmount`; inspect lines 80–86.
- [src/types/payment.type.ts:5](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/payment.type.ts:5) — `export enum PaymentPurpose`; inspect lines 5–16.
- [src/types/payment.type.ts:10](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/payment.type.ts:10) — `export enum PaymentStatus`; inspect lines 10–21.
- [src/types/payment.type.ts:17](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/payment.type.ts:17) — `export enum PaymentProvider`; inspect lines 17–28.
- [src/models/payments/reservation-payment.model.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/models/payments/reservation-payment.model.ts:13) — `idempotencyKey`; inspect lines 13–24.

## E-ITEM — Item DTOs, registration validation/ownership/edit/first inbound/history

- [src/routes/inventory-item.routes.ts:27](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-item.routes.ts:27) — `router.get('/me'`; inspect lines 27–38.
- [src/routes/inventory-item.routes.ts:44](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-item.routes.ts:44) — `router.patch('/:id'`; inspect lines 44–47.
- [src/routes/inventory-item.routes.ts:30](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-item.routes.ts:30) — `router.post('/:id/inbound-request'`; inspect lines 30–41.
- [src/routes/inventory-item.routes.ts:42](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-item.routes.ts:42) — `router.get('/:id/movements'`; inspect lines 42–47.
- [src/services/inventory-items/inventory-item.validation.ts:59](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.validation.ts:59) — `export function parseCreate`; inspect lines 59–70.
- [src/services/inventory-items/inventory-item.validation.ts:76](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.validation.ts:76) — `export function parseUpdate`; inspect lines 76–87.
- [src/services/inventory-items/inventory-item.service.ts:88](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:88) — `function dto`; inspect lines 88–99.
- [src/services/inventory-items/inventory-item.service.ts:491](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:491) — `function movementDto`; inspect lines 491–502.
- [src/services/inventory-items/inventory-item.service.ts:528](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:528) — `async function assertItemReadAccess`; inspect lines 528–539.
- [src/services/inventory-items/inventory-item.service.ts:551](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:551) — `static async create`; inspect lines 551–562.
- [src/services/inventory-items/inventory-item.service.ts:591](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:591) — `static async listMine`; inspect lines 591–602.
- [src/services/inventory-items/inventory-item.service.ts:641](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:641) — `static async update`; inspect lines 641–652.
- [src/services/inventory-items/inventory-item.service.ts:711](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:711) — `static async requestInbound`; inspect lines 711–722.
- [src/services/inventory-items/inventory-item.service.ts:736](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:736) — `static async confirmInbound`; inspect lines 736–747.
- [src/services/inventory-items/inventory-item.service.ts:936](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:936) — `static async requestOutbound`; inspect lines 936–947.
- [src/services/inventory-items/inventory-item.service.ts:1353](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:1353) — `static async movements`; inspect lines 1353–1364.
- [src/services/inventory-items/inventory-item.service.ts:1363](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:1363) — `static async placementPreview`; inspect lines 1363–1374.
- [src/services/reservations/managed-inventory-reservation.guard.ts:50](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-inventory-reservation.guard.ts:50) — `requireManagedInventoryReservationForRegistration`; inspect lines 50–61.

## E-IMAGE — Owned Cloudinary image upload/attach lifecycle; production disabled

- [src/routes/inventory-item.routes.ts:24](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-item.routes.ts:24) — `router.post('/image-uploads'`; inspect lines 24–35.
- [src/routes/inventory-item.routes.ts:25](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-item.routes.ts:25) — `router.delete('/image-uploads/`; inspect lines 25–36.
- [src/middlewares/upload.middleware.ts:24](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/upload.middleware.ts:24) — `uploadInventoryImageMiddleware`; inspect lines 24–35.
- [src/middlewares/upload.middleware.ts:34](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/upload.middleware.ts:34) — `single('file')`; inspect lines 34–43.
- [src/services/upload/managed-inventory-image.service.ts:28](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/upload/managed-inventory-image.service.ts:28) — `static async upload`; inspect lines 28–39.
- [src/services/upload/managed-inventory-image.service.ts:124](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/upload/managed-inventory-image.service.ts:124) — `static async remove`; inspect lines 124–135.
- [src/services/upload/managed-inventory-image.service.ts:245](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/upload/managed-inventory-image.service.ts:245) — `private static dto`; inspect lines 245–249.

## E-STOCK — Owner-scoped raw transactional balance, legacy/canonical arithmetic

- [src/controllers/inventory-items/inventory-inbound-request.controller.ts:45](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/inventory-items/inventory-inbound-request.controller.ts:45) — `export const stockBalance`; inspect lines 45–56.
- [src/services/inventory-items/repeated-inbound-operations.service.ts:149](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/repeated-inbound-operations.service.ts:149) — `static async stockBalance`; inspect lines 149–160.
- [src/types/managed-stock.type.ts:41](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/managed-stock.type.ts:41) — `export enum ManagedStockSource`; inspect lines 41–52.
- [src/types/managed-stock.type.ts:60](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/managed-stock.type.ts:60) — `export interface InventoryStockBalanceFields`; inspect lines 60–71.
- [src/services/inventory-items/managed-stock-ledger.service.ts:40](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-stock-ledger.service.ts:40) — movementArithmeticPolicy, lines40–45: COMPATIBILITY vs CANONICAL_V1, schema validation.
- [src/services/inventory-items/managed-stock-ledger.service.ts:413](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-stock-ledger.service.ts:413) — `export function managedStockLedgerWritesEnabled`; inspect lines 413–422.
- [src/utils/managed-stock-arithmetic.ts:24](C:/Users/laptop/Desktop/WDP/BE-REF/src/utils/managed-stock-arithmetic.ts:24) — `export function exactPrecisionUnits`; inspect lines 24–35.
- [src/utils/managed-stock-arithmetic.ts:38](C:/Users/laptop/Desktop/WDP/BE-REF/src/utils/managed-stock-arithmetic.ts:38) — `export function roundedProductUnits`; inspect lines 38–49.

## E-INBOUND — Repeated receipt commands vs first intake; owner/version/idempotency/production gates

- [src/routes/inventory-inbound-request.routes.ts:20](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-inbound-request.routes.ts:20) — `router.get('/:requestId'`; inspect lines 20–24.
- [src/routes/inventory-inbound-request.routes.ts:21](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-inbound-request.routes.ts:21) — `router.patch('/:requestId'`; inspect lines 21–24.
- [src/routes/inventory-inbound-request.routes.ts:22](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/inventory-inbound-request.routes.ts:22) — `router.post('/:requestId/cancel'`; inspect lines 22–24.
- [src/controllers/inventory-items/inventory-inbound-request.controller.ts:10](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/inventory-items/inventory-inbound-request.controller.ts:10) — `export const create`; inspect lines 10–21.
- [src/controllers/inventory-items/inventory-inbound-request.controller.ts:29](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/inventory-items/inventory-inbound-request.controller.ts:29) — `export const amend`; inspect lines 29–40.
- [src/controllers/inventory-items/inventory-inbound-request.controller.ts:36](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/inventory-items/inventory-inbound-request.controller.ts:36) — `export const cancel`; inspect lines 36–47.
- [src/services/inventory-items/managed-inbound-request.service.ts:40](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:40) — `const enabled`; inspect lines 40–51.
- [src/services/inventory-items/managed-inbound-request.service.ts:94](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:94) — `function parseIfMatch`; inspect lines 94–105.
- [src/services/inventory-items/managed-inbound-request.service.ts:103](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:103) — `function parsePayload(`; inspect lines 103–114.
- [src/services/inventory-items/managed-inbound-request.service.ts:142](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:142) — `function requestDto`; inspect lines 142–153.
- [src/services/inventory-items/managed-inbound-request.service.ts:250](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:250) — `async function lockActiveReservation`; inspect lines 250–261.
- [src/services/inventory-items/managed-inbound-request.service.ts:312](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:312) — `static async create`; inspect lines 312–323.
- [src/services/inventory-items/managed-inbound-request.service.ts:361](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:361) — `static async listForItem`; inspect lines 361–372.
- [src/services/inventory-items/managed-inbound-request.service.ts:380](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:380) — `static async get(`; inspect lines 380–391.
- [src/services/inventory-items/managed-inbound-request.service.ts:388](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:388) — `static async amend`; inspect lines 388–399.
- [src/services/inventory-items/managed-inbound-request.service.ts:446](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-inbound-request.service.ts:446) — `static async cancel`; inspect lines 446–457.
- [src/config/mi06b-feature-gate.ts:6](C:/Users/laptop/Desktop/WDP/BE-REF/src/config/mi06b-feature-gate.ts:6) — `export function resolveMi06BRepeatedInboundGate`; inspect lines 6–10.
- [src/types/inventory-inbound-request.type.ts:3](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/inventory-inbound-request.type.ts:3) — `export enum InventoryInboundRequestState`; inspect lines 3–14.

## E-OUTBOUND — Canonical FIFO holds, safe cancel, Staff physical confirm and unknown outcomes

- [src/routes/managed-outbound-request.routes.ts:11](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/managed-outbound-request.routes.ts:11) — `router.get('/:requestId'`; inspect lines 11–15.
- [src/routes/managed-outbound-request.routes.ts:12](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/managed-outbound-request.routes.ts:12) — `router.post('/:requestId/cancel'`; inspect lines 12–15.
- [src/routes/managed-outbound-request.routes.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/managed-outbound-request.routes.ts:13) — `router.post('/:requestId/confirm'`; inspect lines 13–15.
- [src/controllers/inventory-items/managed-outbound-request.controller.ts:12](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/inventory-items/managed-outbound-request.controller.ts:12) — `export const create`; inspect lines 12–23.
- [src/controllers/inventory-items/managed-outbound-request.controller.ts:26](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/inventory-items/managed-outbound-request.controller.ts:26) — `export const cancel`; inspect lines 26–37.
- [src/services/inventory-items/managed-outbound-request.service.ts:47](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:47) — `const gateEnabled`; inspect lines 47–58.
- [src/services/inventory-items/managed-outbound-request.service.ts:48](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:48) — `const confirmationGateEnabled`; inspect lines 48–59.
- [src/services/inventory-items/managed-outbound-request.service.ts:62](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:62) — `function parseCreate`; inspect lines 62–73.
- [src/services/inventory-items/managed-outbound-request.service.ts:56](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:56) — `function parseVersion`; inspect lines 56–67.
- [src/services/inventory-items/managed-outbound-request.service.ts:131](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:131) — `function assertCreateGate`; inspect lines 131–142.
- [src/services/inventory-items/managed-outbound-request.service.ts:198](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:198) — `static async create`; inspect lines 198–209.
- [src/services/inventory-items/managed-outbound-request.service.ts:239](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:239) — `static async listForItem`; inspect lines 239–250.
- [src/services/inventory-items/managed-outbound-request.service.ts:251](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:251) — `static async get(`; inspect lines 251–262.
- [src/services/inventory-items/managed-outbound-request.service.ts:256](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:256) — `static async cancel`; inspect lines 256–267.
- [src/services/inventory-items/managed-outbound-request.service.ts:305](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:305) — `static async confirm`; inspect lines 305–316.
- [src/services/inventory-items/managed-outbound-request.service.ts:99](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/managed-outbound-request.service.ts:99) — `OUTBOUND_REQUEST_OUTCOME_UNKNOWN`; inspect lines 99–110.
- [src/config/mi06-canonical-outbound-gate.ts:2](C:/Users/laptop/Desktop/WDP/BE-REF/src/config/mi06-canonical-outbound-gate.ts:2) — `export function resolveMi06CanonicalOutboundGate`; inspect lines 2–12.
- [src/config/mi06-canonical-outbound-gate.ts:8](C:/Users/laptop/Desktop/WDP/BE-REF/src/config/mi06-canonical-outbound-gate.ts:8) — `export function resolveMi06CanonicalOutboundConfirmationGate`; inspect lines 8–12.
- [src/types/managed-outbound-request.type.ts:3](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/managed-outbound-request.type.ts:3) — `export enum ManagedOutboundRequestState`; inspect lines 3–14.

## E-NOTIFICATION — Only list-own and mark-one REST; metadata/detail/all-read/push absent

- [src/routes/notification.routes.ts:8](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/notification.routes.ts:8) — `router.get('/me'`; inspect lines 8–12.
- [src/routes/notification.routes.ts:9](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/notification.routes.ts:9) — `router.patch('/:id/read'`; inspect lines 9–12.
- [src/controllers/notifications/notification.controller.ts:4](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/notifications/notification.controller.ts:4) — `export const getMyNotifications`; inspect lines 4–15.
- [src/controllers/notifications/notification.controller.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/notifications/notification.controller.ts:13) — `export const markAsRead`; inspect lines 13–24.
- [src/models/notifications/notification.model.ts:4](C:/Users/laptop/Desktop/WDP/BE-REF/src/models/notifications/notification.model.ts:4) — `const notificationSchema`; inspect lines 4–15.
- [src/types/notification.type.ts:3](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/notification.type.ts:3) — `export enum NotificationType`; inspect lines 3–14.
- [src/types/notification.type.ts:16](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/notification.type.ts:16) — `export interface INotification`; inspect lines 16–27.

## E-SUPPORT — Real Customer support messages exist; generic related IDs not owner-validated

- [src/routes/support-request.routes.ts:11](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/support-request.routes.ts:11) — `router.get('/'`; inspect lines 11–22.
- [src/routes/support-request.routes.ts:12](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/support-request.routes.ts:12) — `router.post('/'`; inspect lines 12–23.
- [src/routes/support-request.routes.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/support-request.routes.ts:13) — `router.get('/:id/messages'`; inspect lines 13–24.
- [src/routes/support-request.routes.ts:14](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/support-request.routes.ts:14) — `router.post('/:id/messages'`; inspect lines 14–24.
- [src/routes/support-request.routes.ts:17](C:/Users/laptop/Desktop/WDP/BE-REF/src/routes/support-request.routes.ts:17) — `router.patch('/:id/status'`; inspect lines 17–24.
- [src/services/support-requests/support-request.validation.ts:20](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.validation.ts:20) — `export function parseCreate`; inspect lines 20–31.
- [src/services/support-requests/support-request.validation.ts:56](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.validation.ts:56) — `export function parseUpdate`; inspect lines 56–67.
- [src/services/support-requests/support-request.validation.ts:75](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.validation.ts:75) — `export function parseMessage`; inspect lines 75–81.
- [src/services/support-requests/support-request.service.ts:47](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:47) — `function assertCanAccess`; inspect lines 47–58.
- [src/services/support-requests/support-request.service.ts:65](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:65) — `static async create`; inspect lines 65–76.
- [src/services/support-requests/support-request.service.ts:95](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:95) — `static async list(`; inspect lines 95–106.
- [src/services/support-requests/support-request.service.ts:127](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:127) — `static async get(`; inspect lines 127–138.
- [src/services/support-requests/support-request.service.ts:132](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:132) — `static async update(`; inspect lines 132–143.
- [src/services/support-requests/support-request.service.ts:188](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:188) — `static async addMessage`; inspect lines 188–199.
- [src/services/support-requests/support-request.service.ts:198](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:198) — `static async listMessages`; inspect lines 198–209.
- [src/services/support-requests/support-request.service.ts:172](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/support-requests/support-request.service.ts:172) — `static async updateStatus`; inspect lines 172–183.
- [src/types/support-request.type.ts:3](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/support-request.type.ts:3) — `export enum SupportCategory`; inspect lines 3–14.
- [src/types/support-request.type.ts:6](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/support-request.type.ts:6) — `export enum RelatedEntityType`; inspect lines 6–17.

## E-ERROR — Different endpoint-family envelopes and common middleware

- [src/middlewares/error.middleware.ts:10](C:/Users/laptop/Desktop/WDP/BE-REF/src/middlewares/error.middleware.ts:10) — `export const errorHandler`; inspect lines 10–21.
- [src/app.ts:22](C:/Users/laptop/Desktop/WDP/BE-REF/src/app.ts:22) — `const globalLimiter`; inspect lines 22–33.
- [src/types/managed-stock.type.ts:4](C:/Users/laptop/Desktop/WDP/BE-REF/src/types/managed-stock.type.ts:4) — `export enum ManagedStockErrorCode`; inspect lines 4–15.

## E-TESTS — Backend tests inspected only, not run or claimed live PASS

- [tests/managed-checkin.test.cjs:232](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-checkin.test.cjs:232) — `test('one signature remains DRAFT`; inspect lines 232–243.
- [tests/managed-checkin.test.cjs:299](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-checkin.test.cjs:299) — `test('new contract version`; inspect lines 299–310.
- [tests/managed-checkin.test.cjs:327](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-checkin.test.cjs:327) — `test('zero remaining balance`; inspect lines 327–338.
- [tests/managed-reservation.test.cjs:387](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-reservation.test.cjs:387) — `test('deposit confirmation is owner-only`; inspect lines 387–398.
- [tests/managed-reservation.test.cjs:468](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-reservation.test.cjs:468) — `test('quote applies half-open`; inspect lines 468–479.
- [tests/managed-customer-stock-read.test.cjs:16](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-customer-stock-read.test.cjs:16) — `test('Customer stock-balance`; inspect lines 16–26.
- [tests/managed-outbound-request-api.test.cjs:121](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-outbound-request-api.test.cjs:121) — `test('canonical outbound gate`; inspect lines 121–132.
- [tests/managed-outbound-request-api.test.cjs:192](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-outbound-request-api.test.cjs:192) — `test('Staff confirmation consumes`; inspect lines 192–203.
- [tests/managed-outbound-request-api.test.cjs:177](C:/Users/laptop/Desktop/WDP/BE-REF/tests/managed-outbound-request-api.test.cjs:177) — `test('safe CANCEL`; inspect lines 177–188.
- [tests/support-request.test.cjs:61](C:/Users/laptop/Desktop/WDP/BE-REF/tests/support-request.test.cjs:61) — `test('customer ownership`; inspect lines 61–72.
- [tests/support-request.test.cjs:130](C:/Users/laptop/Desktop/WDP/BE-REF/tests/support-request.test.cjs:130) — `test('internal messages`; inspect lines 130–141.

## Negative findings and search scope

No payment route family mounted in src/routes/index.ts; no provider SDK/checkout/webhook implementation found by PayOS/payos/webhook/checkoutUrl/returnUrl searches of src. PAYOS enum/comment/old documentation is DOCUMENTED_ONLY, not a verified provider integration. No refresh/auth-cookie route, socket/push token service, bulk notification-read/count/detail/delete route, support attachment route or dedicated Customer dashboard endpoint in inspected routers. No Customer relocation/fulfillment endpoint: the operational routes require FACILITY_STAFF. Unsupported entries in CSV deliberately have no invented URL.

Important contradictions: docs/BUSINESS_FLOW_P0_P1.md:7 and docs/MI_03A_MANAGED_CHECKIN.md:79 describe earlier phases (no ledger/first inbound) while current source includes ReservationPayment and confirmInbound v2 activation. Source takes precedence; docs alone do not attest deployment. Backend tests often mock transactions/read dist; reviewed assertions are supporting evidence, not execution or data acceptance.

## E-HARDENING — additional exact critical ranges

- [src/services/reservations/reservation.service.ts:24](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/reservation.service.ts:24), lines24–61 — Self overlap query lacks DEPOSIT_PAID/CHECKIN_READY
- [src/services/reservations/reservation.service.ts:64](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/reservation.service.ts:64), lines64–101 — Self pricing rule/policy lookup and short-term formula
- [src/controllers/contracts/contract.controller.ts:180](C:/Users/laptop/Desktop/WDP/BE-REF/src/controllers/contracts/contract.controller.ts:180), lines180–192 — export const getContractPrintData
- [src/services/keycloak.service.ts:20](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/keycloak.service.ts:20), lines20–32 — emailVerified: true
- [src/models/auth/otp.model.ts:13](C:/Users/laptop/Desktop/WDP/BE-REF/src/models/auth/otp.model.ts:13), lines13–13 — expires:30000 vs comment300sec
- [src/services/auth/auth.service.ts:118](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/auth/auth.service.ts:118), lines118–130 — const otpRecord = await OtpModel.findOne
- [src/services/inventory-items/inventory-inbound-request.lifecycle.ts:44](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-inbound-request.lifecycle.ts:44), lines44–49 — Exact canAmendReceiptRequest before inspection
- [src/services/inventory-items/repeated-inbound-operations.service.ts:149](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/repeated-inbound-operations.service.ts:149), lines149–162 — Owner-scoped raw StockBalance read

## E-WEB — OBSERVED_IN_WEB_FRONTEND (not Backend proof)

- [src/api/axiosClient.js:5](C:/Users/laptop/Desktop/WDP/frontend/src/api/axiosClient.js:5) — const axiosClient
- [src/api/axiosClient.js:14](C:/Users/laptop/Desktop/WDP/frontend/src/api/axiosClient.js:14) — config.headers.Authorization
- [src/api/authApi.js:11](C:/Users/laptop/Desktop/WDP/frontend/src/api/authApi.js:11) — register:
- [src/api/authApi.js:15](C:/Users/laptop/Desktop/WDP/frontend/src/api/authApi.js:15) — logout:
- [src/lib/authSession.js:31](C:/Users/laptop/Desktop/WDP/frontend/src/lib/authSession.js:31) — export function saveAuthSession
- [src/lib/authSession.js:43](C:/Users/laptop/Desktop/WDP/frontend/src/lib/authSession.js:43) — export function clearAuthSession
- [src/api/inventoryApi.js:11](C:/Users/laptop/Desktop/WDP/frontend/src/api/inventoryApi.js:11) — createRepeatedInbound:
- [src/api/inventoryApi.js:19](C:/Users/laptop/Desktop/WDP/frontend/src/api/inventoryApi.js:19) — cancelCanonicalOutbound:
- [src/api/inventoryApi.js:42](C:/Users/laptop/Desktop/WDP/frontend/src/api/inventoryApi.js:42) — uploadImage:
- [src/lib/inventoryRegistration.js:22](C:/Users/laptop/Desktop/WDP/frontend/src/lib/inventoryRegistration.js:22) — if(!edit)
- [src/components/customer/inventory/CanonicalCustomerOutbound.jsx:64](C:/Users/laptop/Desktop/WDP/frontend/src/components/customer/inventory/CanonicalCustomerOutbound.jsx:64) — inventoryApi.stockBalance
- [src/components/customer/inventory/CanonicalCustomerOutbound.jsx:124](C:/Users/laptop/Desktop/WDP/frontend/src/components/customer/inventory/CanonicalCustomerOutbound.jsx:124) — inventoryApi.createCanonicalOutbound
- [src/components/customer/inventory/RepeatedInboundRequests.jsx:64](C:/Users/laptop/Desktop/WDP/frontend/src/components/customer/inventory/RepeatedInboundRequests.jsx:64) — inventoryApi.amendRepeatedInbound
- [src/api/paymentApi.js:6](C:/Users/laptop/Desktop/WDP/frontend/src/api/paymentApi.js:6) — const USE_MOCK
- [src/api/paymentApi.js:28](C:/Users/laptop/Desktop/WDP/frontend/src/api/paymentApi.js:28) — /payments/payos/create
- [src/api/contractApi.js:11](C:/Users/laptop/Desktop/WDP/frontend/src/api/contractApi.js:11) — signReal:
- [src/api/selfStoragePaymentApi.js:9](C:/Users/laptop/Desktop/WDP/frontend/src/api/selfStoragePaymentApi.js:9) — initiateSelfStoragePayment
- [src/api/selfStoragePaymentApi.js:14](C:/Users/laptop/Desktop/WDP/frontend/src/api/selfStoragePaymentApi.js:14) — confirmSelfStoragePayment
- [src/api/confirmedContract.js:102](C:/Users/laptop/Desktop/WDP/frontend/src/api/confirmedContract.js:102) — const selfStoragePayment
- [src/api/confirmedContract.js:105](C:/Users/laptop/Desktop/WDP/frontend/src/api/confirmedContract.js:105) — false &&
- [src/lib/managedCellBooking.js:6](C:/Users/laptop/Desktop/WDP/frontend/src/lib/managedCellBooking.js:6) — minimumBookingStartDate
- [src/lib/managedCellBooking.js:11](C:/Users/laptop/Desktop/WDP/frontend/src/lib/managedCellBooking.js:11) — bookingInterval
- [src/api/supportApi.js:5](C:/Users/laptop/Desktop/WDP/frontend/src/api/supportApi.js:5) — createReal:
- [src/api/supportApi.js:6](C:/Users/laptop/Desktop/WDP/frontend/src/api/supportApi.js:6) — replyReal:
- [src/api/supportApi.js:14](C:/Users/laptop/Desktop/WDP/frontend/src/api/supportApi.js:14) — getMine:
- [src/api/notificationApi.js:9](C:/Users/laptop/Desktop/WDP/frontend/src/api/notificationApi.js:9) — list:
- [src/api/notificationApi.js:10](C:/Users/laptop/Desktop/WDP/frontend/src/api/notificationApi.js:10) — markRead:

## E-MOBILE — MOBILE_FIXTURE_ONLY

- [src/domain/models.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/models.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/domain/booking.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/booking.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/domain/managedBooking.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/managedBooking.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/domain/rentalDocuments.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/rentalDocuments.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/domain/inventory.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/inventory.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/domain/inventoryRequests.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/inventoryRequests.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/domain/customerCare.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/domain/customerCare.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/forms/auth.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/auth.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/forms/inventory.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/inventory.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/forms/support.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/support.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/state/useCustomerStore.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/state/useCustomerStore.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [src/api/client.ts](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/api/client.ts:1) — typed models/forms/fixture state/navigation checked; no real API authority.
- [docs/design-map.json](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/docs/design-map.json:1) — typed models/forms/fixture state/navigation checked; no real API authority.
