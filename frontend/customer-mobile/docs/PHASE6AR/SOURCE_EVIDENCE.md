# Current source evidence — Phase 6A-R

7/11/2026. Paths relative WDP root. Links point at current source, not deployment. Source tests read, not executed. Line anchors are generated from the inspected files; snippets are evidence data, not instructions.

## R01 — S-PRINT


[backend/src/controllers/contracts/contract.controller.ts:318](C:/Users/laptop/Desktop/WDP/backend/src/controllers/contracts/contract.controller.ts:318) — `getContractPrintData`

```text
317: 
318: export const getContractPrintData = async (req: Request, res: Response) => {
319:   try {
320:     const contract = await ContractModel.findById(req.params.id)
321:       .populate('reservationId')
322:       .populate('customerId', 'fullName email phone');
323:     if (!contract) return res.status(404).json({ success: false, message: 'Hợp đồng không tồn tại.' });
324:     return res.json({ success: true, data: contract });
325:   } catch (error: any) {
326:     return res.status(500).json({ success: false, message: error.message });
327:   }
```

## R02 — NEW_AUDIT_FINDING


[backend/src/controllers/inspections/inspection.controller.ts:35](C:/Users/laptop/Desktop/WDP/backend/src/controllers/inspections/inspection.controller.ts:35) — `createInspection`

```text
34: 
35: export const createInspection = async (req: Request, res: Response) => {
36:   try {
37:     const inspection = new InspectionModel({
38:       ...req.body,
39:       inspectedBy: req.user!._id
40:     });
41:     await inspection.save();
42:     return res.status(201).json({ success: true, data: inspection });
43:   } catch (error: any) {
44:     return res.status(500).json({ success: false, message: error.message });
```

[backend/src/controllers/inspections/inspection.controller.ts:48](C:/Users/laptop/Desktop/WDP/backend/src/controllers/inspections/inspection.controller.ts:48) — `getInspections`

```text
47: 
48: export const getInspections = async (req: Request, res: Response) => {
49:   try {
50:     const filter: any = {};
51:     if (req.query.reservationId) filter.reservationId = req.query.reservationId;
52:     if (req.query.storageUnitId) filter.storageUnitId = req.query.storageUnitId;
53:     
54:     const inspections = await InspectionModel.find(filter)
55:       .populate('reservationId', 'reservationCode customerId startDate endDate status')
56:       .populate('facilityId', 'name')
57:       .populate('storageUnitId', 'unitCode')
```

[backend/src/controllers/inspections/inspection.controller.ts:66](C:/Users/laptop/Desktop/WDP/backend/src/controllers/inspections/inspection.controller.ts:66) — `completeInspection`

```text
65: 
66: export const completeInspection = async (req: Request, res: Response) => {
67:   try {
68:     const before = await InspectionModel.findById(req.params.id);
69:     if (!before) return res.status(404).json({ success: false, message: 'Inspection not found or already completed' });
70: 
71:     if (before.type === InspectionType.CHECK_IN) {
72:       if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
73:         return res.status(404).json({ success: false, message: 'Self-Storage CHECK_IN activation is disabled in this environment pending payment verification.' });
74:       }
75:       if (before.status !== InspectionStatus.DRAFT) {
```

## R03 — S-SIGN-VERSION


[backend/src/services/reservations/managed-checkin.service.ts:274](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-checkin.service.ts:274) — `signContract`

```text
273: 
274:   static async signContract(contractIdInput: unknown, actor: Actor) {
275:     if (!enabled()) fail(404, 'Managed check-in flow is disabled');
276:     if (actor.role !== UserRole.CUSTOMER) fail(403, 'Reservation owner must sign as Customer');
277:     const contractId = id(contractIdInput, 'contractId');
278:     return tx(async session => {
279:       const contract = await ContractModel.findOne({ _id: contractId, customerId: actor._id }).session(session).exec();
280:       if (!contract) fail(404, 'Managed contract not found');
281:       const reservation = await loadV2Reservation(contract.reservationId, session, actor._id);
282:       if (![ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY].includes(reservation.status)) fail(409, 'Contract signing requires a v2 reservation after deposit');
283:       await lockFacility(reservation.facilityId, session);
```

[backend/src/services/reservations/managed-checkin.service.ts:84](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-checkin.service.ts:84) — `ensureVersion`

```text
83: function hashContent(content: unknown) { return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex'); }
84: async function ensureVersion(contract: IContract, reservation: any, actorId: Types.ObjectId, session: ClientSession) {
85:   const { content } = await currentContent(reservation, session);
86:   const contentHash = hashContent(content);
87:   const active = contract.contentVersions?.find(version => version.version === contract.currentContentVersion);
88:   if (!active || active.contentHash !== contentHash) {
89:     const version = (contract.currentContentVersion ?? 0) + 1;
90:     contract.contentVersions = [...(contract.contentVersions ?? []), { version, contentHash, content, createdBy: actorId, createdAt: new Date() }] as any;
91:     contract.currentContentVersion = version;
92:     contract.status = ContractStatus.DRAFT;
93:     contract.set('signedByCustomerAt', undefined);
```

[backend/src/services/reservations/managed-checkin.service.ts:217](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-checkin.service.ts:217) — `ensureVersion`

```text
216:       if (existingContract) {
217:         const version = await ensureVersion(existingContract, reservation, actor._id, session);
218:         await existingContract.save({ session });
219:         await audit(reservation, actor, ManagedReservationAction.CONTRACT_VERSION_CREATED, { contractId: existingContract._id, version: version.version, reason: 'Inspected handover content changed' }, session);
220:       }
221:       await audit(reservation, actor, ManagedReservationAction.ITEM_INSPECTED, { itemId: current._id, evidenceSnapshotId: evidenceSnapshot._id,
222:         evidenceAttempt: evidenceSnapshot.attempt, imageCount: evidenceSnapshot.images.length, decision: input.decision,
223:         observedQuantity: input.observedQuantity, observedUnitWeightKg: input.observedUnitWeightKg, observedUnitDimensionsM: dimensions,
224:         custodyTaken: input.custodyTaken, compatibleCellIds, packingLayoutVerified: input.packingLayoutVerified, note: input.note.trim() }, session);
225:       return current;
226:     });
```

[backend/src/services/reservations/managed-checkin.service.ts:267](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-checkin.service.ts:267) — `ensureVersion`

```text
266:         await contract.save({ session });
267:       } else await ensureVersion(contract, reservation, actor._id, session);
268:       await contract.save({ session });
269:       await audit(reservation, actor, ManagedReservationAction.CONTRACT_VERSION_CREATED, { contractId: contract._id, version: contract.currentContentVersion }, session);
270:       return contract;
271:     });
272:   }
273: 
274:   static async signContract(contractIdInput: unknown, actor: Actor) {
275:     if (!enabled()) fail(404, 'Managed check-in flow is disabled');
276:     if (actor.role !== UserRole.CUSTOMER) fail(403, 'Reservation owner must sign as Customer');
```

[backend/src/services/reservations/managed-checkin.service.ts:285](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-checkin.service.ts:285) — `ensureVersion`

```text
284:       if (!(await currentContent(reservation, session)).ready) fail(409, 'Resolve all receiving discrepancies or rejected inspections and inspect at least one requested item before signing');
285:       const active = await ensureVersion(contract, reservation, actor._id, session);
286:       if (contract.signatures?.some(signature => signature.version === active.version && signature.contentHash === active.contentHash && signature.signerRole === UserRole.CUSTOMER)) return contract;
287:       contract.signatures = [...(contract.signatures ?? []), { version: active.version, contentHash: active.contentHash, signerId: actor._id, signerRole: UserRole.CUSTOMER, signedAt: new Date() }] as any;
288:       await updateSignedState(contract, active.version, active.contentHash);
289:       syncLegacySignatureFields(contract, active.version, active.contentHash);
290:       await contract.save({ session });
291:       await audit(reservation, actor, ManagedReservationAction.CONTRACT_SIGNED, { contractId, version: active.version, contentHash: active.contentHash, signerRole: UserRole.CUSTOMER }, session);
292:       return contract;
293:     });
294:   }
```

## R04 — A-REFRESH


[backend/src/routes/auth.routes.ts:8](C:/Users/laptop/Desktop/WDP/backend/src/routes/auth.routes.ts:8) — `router.post`

```text
7: // Đăng nhập
8: router.post('/login', login);
9: 
10: // Đăng xuất (Yêu cầu phải có Access Token hợp lệ mới được gọi)
11: router.post('/logout', requireAuth, logout);
12: // Quên mật khẩu
13: import rateLimit from 'express-rate-limit';
14: const forgotPasswordLimiter = rateLimit({
15:   windowMs: 5 * 60 * 1000, // 5 phút
16:   max: 3, // Mỗi IP chỉ được xin 3 lần OTP trong 5 phút
17:   message: { success: false, message: 'Bạn đã xin OTP quá nhiều lần. Vui lòng thử lại sau 5 phút.' }
```

[backend/src/routes/auth.routes.ts:11](C:/Users/laptop/Desktop/WDP/backend/src/routes/auth.routes.ts:11) — `router.post`

```text
10: // Đăng xuất (Yêu cầu phải có Access Token hợp lệ mới được gọi)
11: router.post('/logout', requireAuth, logout);
12: // Quên mật khẩu
13: import rateLimit from 'express-rate-limit';
14: const forgotPasswordLimiter = rateLimit({
15:   windowMs: 5 * 60 * 1000, // 5 phút
16:   max: 3, // Mỗi IP chỉ được xin 3 lần OTP trong 5 phút
17:   message: { success: false, message: 'Bạn đã xin OTP quá nhiều lần. Vui lòng thử lại sau 5 phút.' }
18: });
19: 
20: router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
```

[backend/src/routes/auth.routes.ts:20](C:/Users/laptop/Desktop/WDP/backend/src/routes/auth.routes.ts:20) — `router.post`

```text
19: 
20: router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
21: router.post('/reset-password', resetPassword);
22: 
23: export default router;
24: 
```

[backend/src/routes/auth.routes.ts:21](C:/Users/laptop/Desktop/WDP/backend/src/routes/auth.routes.ts:21) — `router.post`

```text
20: router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
21: router.post('/reset-password', resetPassword);
22: 
23: export default router;
24: 
```

## R05 — A-AUTH-HARDEN


[backend/src/services/auth/auth.service.ts:74](C:/Users/laptop/Desktop/WDP/backend/src/services/auth/auth.service.ts:74) — `forgotPassword`

```text
73: 
74:   static async forgotPassword(email: string) {
75:     const user = await UserModel.findOne({ email });
76:     if (!user) {
77:       throw new Error('Email không tồn tại trong hệ thống');
78:     }
79: 
80:     // Generate 6-digit OTP
81:     const otp = Math.floor(100000 + Math.random() * 900000).toString();
82: 
83:     // Upsert OTP (Nếu đã có OTP cũ thì đè lên, TTL sẽ tự reset)
```

[backend/src/services/auth/auth.service.ts:116](C:/Users/laptop/Desktop/WDP/backend/src/services/auth/auth.service.ts:116) — `resetPassword`

```text
115: 
116:   static async resetPassword(email: string, otp: string, newPassword: string) {
117:     // 1. Verify OTP
118:     const otpRecord = await OtpModel.findOne({ email, otp });
119:     if (!otpRecord) {
120:       throw new Error('Mã OTP không hợp lệ hoặc đã hết hạn');
121:     }
122: 
123:     // 2. Get User
124:     const user = await UserModel.findOne({ email });
125:     if (!user) {
```

## R06 — B-SELF-PRICE


[backend/src/services/reservations/reservation.service.ts:194](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:194) — `calculatePricing`

```text
193:    */
194:   static async calculatePricing(
195:     pricingPolicyId: string,
196:     startDate: Date,
197:     endDate: Date
198:   ): Promise<{
199:     estimatedRent: number;
200:     depositAmount: number;
201:     durationDays: number;
202:     basePrice: number;
203:   }> {
```

[backend/src/services/reservations/reservation.service.ts:268](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:268) — `calculatePricing`

```text
267:     // 2. Tự tính toán tiền thuê và tiền cọc từ Pricing Policy
268:     const { estimatedRent, depositAmount } = await this.calculatePricing(
269:       data.pricingPolicyId,
270:       startDate,
271:       endDate
272:     );
273: 
274:     const session = await mongoose.startSession();
275:     try {
276:       let createdReservation: IReservation | null = null;
277:       
```

## R07 — S-SELF-PAY


[backend/src/controllers/reservations/reservation.controller.ts:549](C:/Users/laptop/Desktop/WDP/backend/src/controllers/reservations/reservation.controller.ts:549) — `confirmMockDeposit`

```text
548:  */
549: export const confirmMockDeposit = async (req: Request, res: Response) => {
550:   try {
551:     const reservationId = req.params.id;
552:     const reservation = await ReservationModel.findById(reservationId);
553:     if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
554: 
555:     if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
556:       return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
557:     }
558: 
```

[backend/src/controllers/reservations/reservation.controller.ts:715](C:/Users/laptop/Desktop/WDP/backend/src/controllers/reservations/reservation.controller.ts:715) — `confirmMockBalance`

```text
714:  */
715: export const confirmMockBalance = async (req: Request, res: Response) => {
716:   try {
717:     if (process.env.NODE_ENV === 'production') {
718:       return res.status(404).json({ success: false, message: 'Mock payment confirmation is disabled in production.' });
719:     }
720:     const reservationId = req.params.id;
721:     const reservation = await ReservationModel.findById(reservationId);
722:     if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
723: 
724:     if (req.user!.role === UserRole.CUSTOMER && reservation.customerId.toString() !== req.user!._id.toString()) {
```

## R08 — S-STAFF-SCOPE


[backend/src/controllers/contracts/contract.controller.ts:146](C:/Users/laptop/Desktop/WDP/backend/src/controllers/contracts/contract.controller.ts:146) — `confirmSignedPaper`

```text
145:  */
146: export const confirmSignedPaper = async (req: Request, res: Response) => {
147:   try {
148:     const contractId = req.params.id;
149:     const contract = await ContractModel.findById(contractId);
150:     if (!contract) {
151:       return res.status(404).json({ success: false, message: 'Hợp đồng không tồn tại.' });
152:     }
153: 
154:     const reservation = await ReservationModel.findById(contract.reservationId);
155:     if (!reservation) {
```

[backend/src/controllers/contracts/contract.controller.ts:68](C:/Users/laptop/Desktop/WDP/backend/src/controllers/contracts/contract.controller.ts:68) — `getContractByReservationId`

```text
67: 
68: export const getContractByReservationId = async (req: Request, res: Response) => {
69:   try {
70:     const reservationId = req.params.reservationId;
71:     const contract: any = await (ContractModel as any).findOne({ reservationId })
72:       .populate('reservationId', 'reservationCode facilityId storageUnitId startDate endDate status serviceType')
73:       .populate('customerId', 'fullName email phone');
74:     if (!contract) return res.status(404).json({ success: false, message: 'Contract not found for this reservation.' });
75: 
76:     const customerId = contract.customerId?._id ?? contract.customerId;
77:     const isOwner = customerId?.toString() === req.user!._id.toString();
```

## R09 — B-V2-PROD


[backend/src/services/reservations/managed-reservation.service.ts:29](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-reservation.service.ts:29) — `managedDepositFlowEnabled`

```text
28: const occupying = [ReservationStatus.RESERVED, ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY, ReservationStatus.CONTRACTED, ReservationStatus.PAID, ReservationStatus.ACTIVE, ReservationStatus.OVERDUE];
29: const managedDepositFlowEnabled = () => process.env.NODE_ENV === 'development' && process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true';
30: 
31: export class ManagedReservationError extends Error {
32:   constructor(public readonly status: number, message: string) { super(message); }
33: }
34: function fail(status: number, message: string): never { throw new ManagedReservationError(status, message); }
35: function object(value: unknown, allowed: string[], label: string) {
36:   if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !allowed.includes(k) || k.startsWith('$'))) fail(400, `Invalid ${label}`);
37:   return value as Record<string, unknown>;
38: }
```

[backend/src/services/reservations/managed-reservation.service.ts:171](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-reservation.service.ts:171) — `managedDepositFlowEnabled`

```text
170:   let depositAmount = estimatedRent * Number(depositConfig.percentage) / 100;
171:   if (managedDepositFlowEnabled()) {
172:     if (pricingRule.currency !== 'VND') fail(409, 'Managed deposit flow currently requires VND pricing');
173:     estimatedRent = roundVndAmount(estimatedRent);
174:     depositAmount = roundVndAmount(estimatedRent * Number(depositConfig.percentage) / 100);
175:     if (depositAmount <= 0) fail(409, 'Managed deposit policy must produce a positive deposit for version 2 bookings');
176:   }
177:   if (![estimatedRent, depositAmount].every(Number.isFinite)) fail(409, 'Managed quote amount overflow');
178:   let paymentBreakdown;
179:   try {
180:     paymentBreakdown = calculateRentalPaymentBreakdown({ rentAmount: estimatedRent, depositAmount, taxAmount: 0, discountAmount: 0 });
```

[backend/src/services/reservations/managed-reservation.service.ts:268](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-reservation.service.ts:268) — `managedDepositFlowEnabled`

```text
267:   return {
268:     ...(managedDepositFlowEnabled() ? { bookingFlowVersion: 2 } : {}),
269:     facilityId: input.facilityId, allocatedCapacityM3: input.allocatedCapacityM3, startDate: input.startDate, endDate: input.endDate, term: input.term,
270:     sellableCapacityM3: result.capacity.sellableCapacityM3, committedPeakCapacityM3: result.committedCapacityM3,
271:     availableCapacityM3: result.availableCapacityM3,
272:     pricing: { ruleId: result.pricingRule._id, version: result.pricingRule.version, billingBasis: result.pricingRule.billingBasis, ratePerM3: result.pricingRule.price, currency: result.pricingRule.currency, estimatedRent: result.estimatedRent },
273:     deposit: { policyId: result.depositPolicy._id, version: result.depositPolicy.version, calculation: 'PERCENT_OF_RENT', percentage: (result.depositPolicy.config as any).percentage, amount: result.depositAmount },
274:     taxAmount: 0,
275:     paymentBreakdown: {
276:       totalDue: result.paymentBreakdown.totalDue,
277:       depositCredit: result.paymentBreakdown.depositCredit,
```

[backend/src/services/reservations/managed-reservation.service.ts:332](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-reservation.service.ts:332) — `managedDepositFlowEnabled`

```text
331:         allocatedCapacity: input.allocatedCapacityM3, allocatedCellIds: selectedCells.map(cell => cell._id), startDate: input.startDate, endDate: input.endDate,
332:         status: ReservationStatus.RESERVED, ...(managedDepositFlowEnabled() ? { bookingFlowVersion: 2 } : {}), estimatedRent: result.estimatedRent, depositAmount: result.depositAmount, taxAmount: 0, discountAmount: 0,
333:         expiresAt: new Date(now.getTime() + capacity.holdDurationMinutes * 60_000),
334:         pricingPolicyId: result.pricingRule._id,
335:         managedPricingSnapshot: {
336:           quotaM3: input.allocatedCapacityM3, term: input.term, startDate: input.startDate, endDate: input.endDate,
337:           pricingRule: { id: result.pricingRule._id, version: result.pricingRule.version, billingBasis: PricingBasis.PER_M3, ratePerM3: result.pricingRule.price, currency: result.pricingRule.currency },
338:           depositPolicy: { id: result.depositPolicy._id, version: result.depositPolicy.version, calculation: 'PERCENT_OF_RENT', percentage: (result.depositPolicy.config as any).percentage },
339:           amountBreakdown: {
340:             estimatedRent: result.estimatedRent, depositAmount: result.depositAmount, taxAmount: 0, discountAmount: 0,
341:             totalDue: result.paymentBreakdown.totalDue, depositCredit: result.paymentBreakdown.depositCredit, balanceDue: result.paymentBreakdown.balanceDue,
```

## R10 — B-MI06


[backend/src/config/mi06-canonical-outbound-gate.ts:2](C:/Users/laptop/Desktop/WDP/backend/src/config/mi06-canonical-outbound-gate.ts:2) — `resolveMi06CanonicalOutboundGate`

```text
1: /** New canonical outbound holds remain opt-in and are always disabled in production. */
2: export function resolveMi06CanonicalOutboundGate(nodeEnv: string, configuredValue?: string): boolean {
3:   if (nodeEnv === 'production') return false;
4:   return configuredValue?.trim().toLowerCase() === 'true';
5: }
6: 
7: /** Canonical confirmation is separately gated so pending holds have no legacy stock-writing fallback. */
8: export function resolveMi06CanonicalOutboundConfirmationGate(nodeEnv: string, configuredValue?: string): boolean {
9:   if (nodeEnv === 'production') return false;
10:   return configuredValue?.trim().toLowerCase() === 'true';
11: }
```

## R11 — B-PROVIDER


[backend/src/services/payments/payos-payment.service.ts:253](C:/Users/laptop/Desktop/WDP/backend/src/services/payments/payos-payment.service.ts:253) — `createCheckout`

```text
252: 
253:   async createCheckout(reservationIdInput: unknown, purposeInput: unknown, keyInput: unknown, customerId: unknown) {
254:     assertEnabled(this.enabled);
255:     this.assertConfiguration();
256:     const purpose = assertPurpose(purposeInput);
257:     const key = paymentKey(assertKey(keyInput));
258:     const reservationId = id(reservationIdInput);
259:     if (!Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
260: 
261:     const prior = await Payments.findOne({ idempotencyKey: key }).exec();
262:     if (prior) return this.replayExisting(prior, reservationId, purpose, customerId);
```

[backend/src/services/payments/payos-payment.service.ts:78](C:/Users/laptop/Desktop/WDP/backend/src/services/payments/payos-payment.service.ts:78) — `customerPaymentUrls`

```text
77: 
78: function customerPaymentUrls(payment: any): { returnUrl: string; cancelUrl: string } {
79:   const reservationId = id(payment?.reservationId);
80:   if (!/^[a-f\d]{24}$/i.test(reservationId) || !Types.ObjectId.isValid(reservationId)) {
81:     throw new PayosPaymentError(503, 'PAYMENT_RESERVATION_ID_INVALID',
82:       'Payment intent has an invalid Reservation identity');
83:   }
84:   const destination = new URL(`/portal/payments/${reservationId}`, configuredCustomerOrigin()).toString();
85:   return { returnUrl: destination, cancelUrl: destination };
86: }
87: 
```

[backend/src/services/payments/payos-payment.service.ts:496](C:/Users/laptop/Desktop/WDP/backend/src/services/payments/payos-payment.service.ts:496) — `customerPaymentUrls`

```text
495:     const amount = payment.amount;
496:     const { returnUrl, cancelUrl } = customerPaymentUrls(payment);
497:     const claim = await Payments.findOneAndUpdate({ _id: payment._id, provider: PaymentProvider.PAYOS,
498:       status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' }, {
499:       $set: { checkoutState: 'CREATING' },
500:     }, { new: true }).exec();
501:     if (!claim) {
502:       const current = await Payments.findById(payment._id).exec();
503:       if (current?.checkoutState === 'READY' && current.checkoutUrl) {
504:         return { ...await this.customerStatusDto(current), outcome: 'REPLAYED', httpStatus: 200 };
505:       }
```

[backend/src/services/payments/payos-payment.service.ts:581](C:/Users/laptop/Desktop/WDP/backend/src/services/payments/payos-payment.service.ts:581) — `getCustomerStatus`

```text
580: 
581:   async getCustomerStatus(paymentIdInput: unknown, reservationIdInput: unknown, customerId: unknown) {
582:     const paymentId = id(paymentIdInput); const reservationId = id(reservationIdInput);
583:     if (!Types.ObjectId.isValid(paymentId) || !Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
584:     const payment = await Payments.findOne({ _id: paymentId, reservationId, customerId,
585:       serviceType: FacilityServiceType.SELF_STORAGE, provider: PaymentProvider.PAYOS }).exec();
586:     if (!payment) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
587:     const reservation = await Reservations.findOne({ _id: reservationId, customerId,
588:       serviceType: FacilityServiceType.SELF_STORAGE }).exec();
589:     // Payment history remains visible to its owner if Reservation Facility metadata
590:     // later changes; the immutable payment Facility is not an authorization key.
```

## R12 — NEW_AUDIT_FINDING


[frontend/src/lib/selfStoragePayosQr.js:1](C:/Users/laptop/Desktop/WDP/frontend/src/lib/selfStoragePayosQr.js:1) — `import`

```text
1: import QRCode from "qrcode";
2: import { canShowPayosQr } from "../api/payosPaymentClient.js";
3: 
4: export async function createPayosQrDataUrl(payment) {
5:   if (!canShowPayosQr(payment)) return null;
6:   return QRCode.toDataURL(payment.qrCode, {
7:     errorCorrectionLevel: "M",
8:     margin: 2,
9:     width: 320,
10:   });
```

[frontend/src/lib/selfStoragePayosQr.js:2](C:/Users/laptop/Desktop/WDP/frontend/src/lib/selfStoragePayosQr.js:2) — `import`

```text
1: import QRCode from "qrcode";
2: import { canShowPayosQr } from "../api/payosPaymentClient.js";
3: 
4: export async function createPayosQrDataUrl(payment) {
5:   if (!canShowPayosQr(payment)) return null;
6:   return QRCode.toDataURL(payment.qrCode, {
7:     errorCorrectionLevel: "M",
8:     margin: 2,
9:     width: 320,
10:   });
11: }
```

## R13 — NEW_AUDIT_FINDING


[frontend/src/api/confirmedContract.js:12](C:/Users/laptop/Desktop/WDP/frontend/src/api/confirmedContract.js:12) — `assertConfirmedRequest`

```text
11: }
12: export function assertConfirmedRequest(config) {
13:   const method = (config.method || "get").toUpperCase();
14:   const path = String(config.url || "")
15:     .replace(/^\//, "")
16:     .replace(/\/$/, "");
17:   const confirmed = {
18:     POST: [
19:       "auth/login",
20:       "auth/forgot-password",
21:       "auth/reset-password",
```

## R14 — NEW_AUDIT_FINDING


[backend/src/services/inventory-items/inventory-item.service.ts:229](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:229) — `lockReservationForRegistration`

```text
228:  */
229: async function lockReservationForRegistration(reservation: IReservation, session: ClientSession) {
230:   const expectedVersion = Number(reservation.inventoryVersion ?? 0);
231:   const versionPredicate = expectedVersion === 0
232:     ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] }
233:     : { inventoryVersion: expectedVersion };
234:   const eligibilityPredicate = reservation.status === ReservationStatus.DEPOSIT_PAID
235:     ? { status: ReservationStatus.DEPOSIT_PAID, bookingFlowVersion: 2, endDate: { $gt: new Date() } }
236:     : { status: ReservationStatus.ACTIVE };
237:   const filter: any = {
238:     _id: reservation._id,
```

[backend/src/services/inventory-items/inventory-item.service.ts:662](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:662) — `lockReservationForRegistration`

```text
661:         const eligible = await requireManagedInventoryReservationForRegistration(data.managedReservationId, actor._id, undefined, session) as IReservation;
662:         const reservation = await lockReservationForRegistration(eligible, session);
663:         // Revalidate owner, status and active Facility in the same transaction.
664:         const freshReservation = await requireManagedInventoryReservationForRegistration(
665:           reservation._id, actor._id, reservation.facilityId, session,
666:         );
667:         const facilityId = freshReservation.facilityId;
668:         const preferredCell = data.preferredCellId ? await validatePreferredCell(data.preferredCellId, facilityId, session) : undefined;
669:         const totals = deriveTotals(data);
670:         const item = new InventoryItemModel({
671:           ...data, facilityId, customerId: actor._id, managedReservationId: freshReservation._id,
```

[backend/src/services/inventory-items/inventory-item.service.ts:252](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:252) — `lockReservationLifecycle`

```text
251: 
252: async function lockReservationLifecycle(item: IInventoryItem, session: ClientSession, options: {
253:   now?: Date; requireActiveTerm?: boolean; rejectClosure?: boolean; message: string;
254: }) {
255:   const identity = { _id: item.managedReservationId, customerId: item.customerId,
256:     facilityId: item.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY };
257:   const current = await ReservationModel.findOne(identity).session(session).exec() as IReservation | null;
258:   const now = options.now ?? new Date();
259:   if (!current || (options.requireActiveTerm && (current.status !== ReservationStatus.ACTIVE ||
260:       current.startDate > now || current.endDate <= now))) throw new InventoryItemError(409, options.message);
261:   const version = Number(current.inventoryVersion ?? 0);
```

[backend/src/services/inventory-items/inventory-item.service.ts:279](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:279) — `lockReservationLifecycle`

```text
278:   // Outbound remains available during closure under the existing in-term rules.
279:   return lockReservationLifecycle(item, session, { now, requireActiveTerm: true,
280:     message: 'A current, in-term ACTIVE Managed Inventory rental is required for normal outbound; overdue rentals require an authorized controlled-outbound policy' });
281: }
282: 
283: async function lockReservationForOutboundResolution(item: IInventoryItem, session: ClientSession) {
284:   // Rejecting an existing outbound request is a safe resolution and keeps the
285:   // existing request/Item state rules without introducing an overdue policy.
286:   return lockReservationLifecycle(item, session, { message: 'Managed reservation is missing or outside item scope' });
287: }
288: 
```

[backend/src/services/inventory-items/inventory-item.service.ts:286](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:286) — `lockReservationLifecycle`

```text
285:   // existing request/Item state rules without introducing an overdue policy.
286:   return lockReservationLifecycle(item, session, { message: 'Managed reservation is missing or outside item scope' });
287: }
288: 
289: async function lockReservationForRelocation(item: IInventoryItem, session: ClientSession, now: Date) {
290:   return lockReservationLifecycle(item, session, { now, requireActiveTerm: true, rejectClosure: true,
291:     message: 'Relocation requires an in-term ACTIVE Managed Inventory rental' });
292: }
293: 
294: async function lockReservationForMetadata(item: IInventoryItem, session: ClientSession) {
295:   let eligible: IReservation;
```

[backend/src/services/inventory-items/inventory-item.service.ts:290](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:290) — `lockReservationLifecycle`

```text
289: async function lockReservationForRelocation(item: IInventoryItem, session: ClientSession, now: Date) {
290:   return lockReservationLifecycle(item, session, { now, requireActiveTerm: true, rejectClosure: true,
291:     message: 'Relocation requires an in-term ACTIVE Managed Inventory rental' });
292: }
293: 
294: async function lockReservationForMetadata(item: IInventoryItem, session: ClientSession) {
295:   let eligible: IReservation;
296:   try {
297:     eligible = await requireActiveManagedInventoryReservation(item.managedReservationId, item.customerId, item.facilityId, session);
298:   } catch (error) {
299:     if (!(error instanceof ManagedReservationGuardError) || item.receivingInspection?.decision !== 'REJECTED') throw error;
```

## R15 — R-NATIVE


[frontend/customer-mobile/src/api/client.ts:5](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/api/client.ts:5) — `apiClient`

```text
4: // transport, even when a caller supplies a custom adapter. Screens use fixtures.
5: export const apiClient=axios.create({timeout:10000});
6: apiClient.interceptors.request.use(config=>{
7:   throw new AxiosError('Kết nối máy chủ chưa được bật trong giai đoạn 1.','PHASE1_OFFLINE',config);
8: });
9: 
```

[frontend/customer-mobile/src/api/client.ts:6](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/api/client.ts:6) — `apiClient`

```text
5: export const apiClient=axios.create({timeout:10000});
6: apiClient.interceptors.request.use(config=>{
7:   throw new AxiosError('Kết nối máy chủ chưa được bật trong giai đoạn 1.','PHASE1_OFFLINE',config);
8: });
9: 
```

## R16 — R-DEPENDENCY


[frontend/customer-mobile/docs/PHASE6A_SECURITY_AND_OWNERSHIP.md:1](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/docs/PHASE6A_SECURITY_AND_OWNERSHIP.md:1) — `dependency`

```text
1: # Phase 6A — Customer Security, Roles & Ownership
2: 
3: Evidence IDs/precise source lines: PHASE6A_CONTRACT_EVIDENCE.md. Operation-level method/DTO/header/scope/error/retry details: CSV. This is source inspection, no unauthorized live experiment or Backend test execution.
4: 
5: ## Authentication conclusions
6: 
7: VERIFIED_FROM_BACKEND_SOURCE (E-AUTH/E-USER): login POST /api/v1/auth/login takes email/password, Backend executes Keycloak password grant using its server configuration, verifies issuer/JWKS and local User; missing/inactive users rejected. Response is JSON `{success,data:{accessToken,refreshToken,user}}`. Auth middleware only reads Authorization Bearer; cookieParser is mounted but no auth cookie/session handler was found. React Native can supply a bearer token without browser HttpOnly cookies at the source-contract level. Deployment/Keycloak networking and actual token acceptance are UNVERIFIED.
8: 
9: `requireAuth` verifies JWT signature/issuer and normal JWT time constraints via jose, then reloads local user by keycloakSub and checks isActive; `requireRole` uses Mongo User.role, not UI/Keycloak cached display role. Source roles: CUSTOMER, FACILITY_STAFF, FACILITY_MANAGER, BOM, ADMIN. Mobile must require CUSTOMER even when login API issues tokens to another active role. A Customer with unverified identity profile may read own data; Managed creation separately requires VERIFIED profile.
10: 
```

## R17 — S-SELF-OVERLAP


[backend/src/services/reservations/reservation.service.ts:44](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:44) — `buildOverlapFilter`

```text
43:    */
44:   static buildOverlapFilter(startDate: Date, endDate: Date, now = new Date()) {
45:     const committedStatuses = [
46:       ReservationStatus.DEPOSIT_PAID,
47:       ReservationStatus.CHECKIN_READY,
48:       ReservationStatus.PAID,
49:       ReservationStatus.ACTIVE,
50:       ReservationStatus.OVERDUE,
51:     ];
52:     const temporaryHoldStatuses = [
53:       ReservationStatus.RESERVED,
```

[backend/src/services/reservations/reservation.service.ts:88](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:88) — `buildOverlapFilter`

```text
87:       storageUnitId,
88:       ...this.buildOverlapFilter(startDate, endDate),
89:     };
90: 
91:     const overlappingBooking = await ReservationModel.exists(overlapQuery).session(session).exec();
92:     return overlappingBooking !== null;
93:   }
94: 
95:   /**
96:    * Tìm danh sách các kho khả thi khác (Alternative Units) trong cùng cơ sở
97:    * không bị trùng lịch trong khoảng thời gian [startDate, endDate].
```

[backend/src/services/reservations/reservation.service.ts:113](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:113) — `buildOverlapFilter`

```text
112:         serviceType: FacilityServiceType.SELF_STORAGE,
113:         ...this.buildOverlapFilter(startDate, endDate),
114:       };
115: 
116:       let resQuery: any = ReservationModel.find(overlapFilter);
117:       if (session && typeof resQuery?.session === 'function') {
118:         resQuery = resQuery.session(session);
119:       }
120:       if (typeof resQuery?.select === 'function') {
121:         resQuery = resQuery.select('storageUnitId');
122:       }
```

## R18 — B-UNIT-PERIOD


[backend/src/services/storage-units/storage-unit.service.ts:61](C:/Users/laptop/Desktop/WDP/backend/src/services/storage-units/storage-unit.service.ts:61) — `getUnitAvailability`

```text
60: export class StorageUnitService {
61:   static async getUnitAvailability(id: unknown, input: unknown, actor: Actor) {
62:     validateId(id);
63:     if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StorageUnitError(400, 'Invalid availability query');
64:     const query = input as Record<string, unknown>;
65:     const month = query.month;
66:     if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
67:       throw new StorageUnitError(400, 'month must use YYYY-MM');
68:     }
69:     const monthStart = new Date(`${month}-01T00:00:00.000Z`);
70:     if (!Number.isFinite(monthStart.getTime()) || monthStart.toISOString().slice(0, 7) !== month) {
```

[backend/src/services/storage-units/storage-unit.service.ts:1](C:/Users/laptop/Desktop/WDP/backend/src/services/storage-units/storage-unit.service.ts:1) — `list`

```text
1: import { Types } from 'mongoose';
2: import FacilityModel from '../../models/facilities/facility.model';
3: import StorageUnitModel from '../../models/storage-units/storage-unit.model';
4: import ReservationModel from '../../models/reservations/reservation.model';
5: import { ReservationService } from '../reservations/reservation.service';
6: import { FacilityServiceType, FacilityStatus, IFacility } from '../../types/facility.type';
7: import { IUser, UserRole } from '../../types/user.type';
8: import { StorageUnitStatus } from '../../types/storage-unit.type';
9: import { managementStatuses, parseList, parseStatusBody, parseUnit, StorageUnitError, validateId } from './storage-unit.validation';
10: 
```

## R19 — NEW_AUDIT_FINDING


[backend/src/services/reservations/reservation.service.ts:237](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:237) — `createReservation`

```text
236:    */
237:   static async createReservation(data: {
238:     customerId: string;
239:     facilityId: string;
240:     storageUnitId: string;
241:     startDate: Date;
242:     endDate: Date;
243:     pricingPolicyId: string;
244:   }): Promise<IReservation> {
245:     
246:     // 1. Kiểm tra Gate Verification (Bắt buộc KH phải VERIFIED)
```

[backend/src/services/reservations/reservation.service.ts:100](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:100) — `findAvailableAlternatives`

```text
99:    */
100:   static async findAvailableAlternatives(
101:     facilityId: string | Types.ObjectId,
102:     excludeUnitId: string | Types.ObjectId,
103:     preferredSize: string | undefined,
104:     startDate: Date,
105:     endDate: Date,
106:     session?: ClientSession
107:   ): Promise<SuggestedStorageUnit[]> {
108:     try {
109:       const facilityObjectId = typeof facilityId === 'string' ? new Types.ObjectId(facilityId) : facilityId;
```

[backend/src/services/reservations/reservation.service.ts:306](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:306) — `findAvailableAlternatives`

```text
305:         if (isOverlapping) {
306:           const suggestedUnits = await this.findAvailableAlternatives(
307:             data.facilityId,
308:             unit._id as Types.ObjectId,
309:             unit.size,
310:             startDate,
311:             endDate,
312:             session
313:           );
314: 
315:           const formatDate = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
```

## R20 — NEW_AUDIT_FINDING


[backend/src/services/reservations/managed-closure-readiness.service.ts:60](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:60) — `get`

```text
59:   const result = new Map<string, T[]>();
60:   for (const row of rows) { const id = key(row); const bucket = result.get(id) ?? []; bucket.push(row); result.set(id, bucket); }
61:   return result;
62: }
63: async function rows<T>(query: any, session: mongoose.ClientSession, limit?: number): Promise<T[]> {
64:   let q = query.session(session).lean();
65:   if (limit !== undefined) q = q.limit(limit);
66:   return q.exec();
67: }
68: function balancesMatch(balance: any, ledger: any): boolean {
69:   if (balance.schemaVersion !== 1 || identity(balance.itemId) !== ledger.itemId ||
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:75](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:75) — `get`

```text
74:   return ledger.batches.every((batch: any) => {
75:     const actual: any = indexed.get(batch.batchId);
76:     return actual && identity(actual.receiptMovementId) === identity(batch.receiptMovementId) &&
77:       identity(actual.receiptRequestId) === identity(batch.receiptRequestId) &&
78:       identity(actual.receivingInspectionEvidenceId) === identity(batch.receivingInspectionEvidenceId) &&
79:       actual.quantity === batch.quantity && actual.quantityUnit === batch.quantityUnit &&
80:       actual.actualTotalWeightKg === batch.actualTotalWeightKg && actual.actualTotalVolumeM3 === batch.actualTotalVolumeM3 &&
81:       Number.isSafeInteger(actual.heldQuantity) && actual.heldQuantity >= 0 && actual.heldQuantity <= actual.quantity;
82:   });
83: }
84: 
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:87](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:87) — `get`

```text
86: export class ManagedClosureReadinessService {
87:   static async get(reservationIdInput: unknown, actor: Actor) {
88:     const reservationId = parseId(reservationIdInput);
89:     const session = await mongoose.startSession();
90:     try {
91:       let response: any;
92:       await session.withTransaction(async () => {
93:         const reservation: any = await ReservationModel.findOne({
94:           _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
95:         }).session(session).lean().exec();
96:         if (!reservation) fail(404, 'Managed reservation not found');
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:149](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:149) — `get`

```text
148:       }
149:       const itemMovements = movementByItem.get(key) ?? [];
150:       const balance = (balanceByItem.get(key) ?? [])[0] ?? null;
151:       const requests = outboundByItem.get(key) ?? [];
152:       try {
153:         const ledger = reconcileManagedItemStock(item, itemMovements);
154:         if (balance && !balancesMatch(balance, ledger)) {
155:           push(blockers, 'STOCK_BALANCE_MISMATCH', diagnosticScope, 'Persisted StockBalance differs from movement-derived quantity, placement or batch provenance.');
156:         }
157:         if (!balance && itemMovements.some(row => row.schemaVersion === 2)) {
158:           push(blockers, 'STOCK_LEDGER_UNKNOWN', diagnosticScope, 'Canonical movement history has no matching StockBalance projection.');
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:98](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:98) — `evaluate`

```text
97:         authorize(reservation, actor);
98:         response = await this.evaluate(reservation, session);
99:       }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
100:       return response;
101:     } finally { await session.endSession(); }
102:   }
103: 
104:   private static async evaluate(reservation: any, session: mongoose.ClientSession) {
105:     const blockers: Blocker[] = [];
106:     const reservationItems = await rows<any>(InventoryItemModel.find({ managedReservationId: reservation._id, ...LIVE }).sort({ _id: 1 }), session, MAX_SCAN_ITEMS + 1);
107:     if (reservationItems.length > MAX_SCAN_ITEMS) {
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:104](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:104) — `evaluate`

```text
103: 
104:   private static async evaluate(reservation: any, session: mongoose.ClientSession) {
105:     const blockers: Blocker[] = [];
106:     const reservationItems = await rows<any>(InventoryItemModel.find({ managedReservationId: reservation._id, ...LIVE }).sort({ _id: 1 }), session, MAX_SCAN_ITEMS + 1);
107:     if (reservationItems.length > MAX_SCAN_ITEMS) {
108:       push(blockers, 'SCAN_LIMIT_EXCEEDED', 'reservation', 'The complete Item set exceeds the safe scan limit; readiness is UNKNOWN.');
109:       return this.buildDto(reservation, blockers, {
110:         itemCount: null, currentQuantity: null, heldQuantity: null, availableQuantity: null, currentWeightKg: null, currentVolumeM3: null,
111:         items: [], requests: { inbound: null, outbound: null }, allocations: [], cells: [], contract: { status: 'UNKNOWN' }, payments: { status: 'UNKNOWN' },
112:       }, new Date());
113:     }
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:327](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:327) — `evaluate`

```text
326:       reservationId: identity(reservation._id), serviceType: reservation.serviceType, reservationStatus: reservation.status,
327:       startDate: reservation.startDate, endDate: reservation.endDate, evaluatedAt: new Date(), snapshotConsistency: 'MONGODB_SNAPSHOT',
328:       physicalReadiness, operationalReadiness, allocationReadiness, financialReadiness, dispositionReadiness, overallReadiness,
329:       stockSummary: { itemCount: reservationItems.length, currentQuantity, heldQuantity, availableQuantity, currentWeightKg: currentWeight,
330:         currentVolumeM3: currentVolume, allocatedCapacityM3: reservation.allocatedCapacity ?? null, usedCapacityM3: reservation.usedCapacityM3 ?? null,
331:         items: reservationItems.map(item => {
332:           const fact = facts.get(identity(item._id)!);
333:           return { itemId: identity(item._id), itemCode: item.itemCode, status: item.status,
334:             currentQuantity: fact?.ledger?.onHandQuantity ?? null, heldQuantity: fact?.held ?? null, availableQuantity: fact?.available ?? null,
335:             currentCellId: fact?.ledger?.currentCellId ?? null, stockSource: fact?.ledger?.source ?? 'UNKNOWN' };
336:         }) },
```

[backend/src/services/reservations/managed-closure-readiness.service.ts:348](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/managed-closure-readiness.service.ts:348) — `evaluate`

```text
347: 
348:   private static buildDto(reservation: any, blockers: Blocker[], stockSummary: any, evaluatedAt: Date) {
349:     return { reservationId: identity(reservation._id), serviceType: reservation.serviceType, reservationStatus: reservation.status,
350:       startDate: reservation.startDate, endDate: reservation.endDate, evaluatedAt, snapshotConsistency: 'MONGODB_SNAPSHOT',
351:       physicalReadiness: 'UNKNOWN' as Readiness, operationalReadiness: 'UNKNOWN' as Readiness, allocationReadiness: 'UNKNOWN' as Readiness,
352:       financialReadiness: 'UNKNOWN' as Readiness, dispositionReadiness: 'UNKNOWN' as Readiness, overallReadiness: 'UNKNOWN' as Readiness,
353:       stockSummary, outstandingRequestSummary: { inbound: { unresolvedCount: null }, outbound: { unresolvedCount: null }, custodyOrInspectionUnresolved: null },
354:       allocationSummary: { allocatedCellIds: [], allocations: [], cells: [] }, financialSummary: { contractStatus: 'UNKNOWN', additionalSettlementPolicy: 'UNKNOWN' },
355:       blockers, readonly: true, note: 'Diagnostic only. This endpoint does not close the Reservation or release any Cell allocation or Facility quota.' };
356:   }
357: }
```

## R21 — S-SUPPORT-REF


[backend/src/services/support-requests/support-request.service.ts:65](C:/Users/laptop/Desktop/WDP/backend/src/services/support-requests/support-request.service.ts:65) — `create`

```text
64: export class SupportRequestService {
65:   static async create(input: unknown, actor: Actor) {
66:     const data = parseCreate(input);
67:     if (actor.role === UserRole.CUSTOMER && data.customerId) throw new SupportError(400, 'customerId is derived from the authenticated user');
68:     if (!staffRoles.includes(actor.role) && actor.role !== UserRole.CUSTOMER) throw new SupportError(403, 'Bạn không có đủ quyền truy cập!');
69:     if (actor.role === UserRole.FACILITY_STAFF) throw new SupportError(403, 'Bạn không có đủ quyền truy cập!');
70:     if (actor.role === UserRole.FACILITY_MANAGER && (!data.facilityId || actor.assignedFacilityId?.toString() !== data.facilityId)) throw new SupportError(403, 'Bạn không có đủ quyền truy cập!');
71:     return execute(async () => {
72:       const customerId = actor.role === UserRole.CUSTOMER ? actor._id : data.customerId;
73:       if (!customerId) throw new SupportError(400, 'customerId is required when creating a request for a customer');
74:       const customer = await UserModel.findOne({ _id: customerId, role: UserRole.CUSTOMER, isActive: true }).exec();
```

[backend/src/services/support-requests/support-request.service.ts:89](C:/Users/laptop/Desktop/WDP/backend/src/services/support-requests/support-request.service.ts:89) — `create`

```text
88:       }
89:       const request = await SupportRequestModel.create({ ...data, customerId: new Types.ObjectId(customerId), ...(data.facilityId ? { facilityId: new Types.ObjectId(data.facilityId) } : {}) });
90:       audit(actor, request, ActionType.SUPPORT_CREATE, undefined, { status: request.status, category: request.category, priority: request.priority });
91:       return request;
92:     });
93:   }
94: 
95:   static async list(input: unknown, actor: Actor) {
96:     if (!staffRoles.includes(actor.role) && actor.role !== UserRole.CUSTOMER) throw new SupportError(403, 'Bạn không có đủ quyền truy cập!');
97:     const q = parseList(input);
98:     const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
```

[backend/src/services/support-requests/support-request.service.ts:120](C:/Users/laptop/Desktop/WDP/backend/src/services/support-requests/support-request.service.ts:120) — `create`

```text
119:       const [items, total] = await Promise.all([
120:         SupportRequestModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean().exec(),
121:         SupportRequestModel.countDocuments(filter).exec(),
122:       ]);
123:       return { data: items, pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
124:     });
125:   }
126: 
127:   static async get(idInput: unknown, actor: Actor) {
128:     const id = validateId(idInput, 'support request ID');
129:     return execute(async () => { const request = await activeRequest(id); assertCanAccess(actor, request); return request; });
```

[backend/src/services/support-requests/support-request.service.ts:193](C:/Users/laptop/Desktop/WDP/backend/src/services/support-requests/support-request.service.ts:193) — `create`

```text
192:       const request = await activeRequest(id); assertCanAccess(actor, request);
193:       const message = await SupportMessageModel.create({ supportRequestId: request._id, authorId: actor._id, authorRole: actor.role, ...data });
194:       audit(actor, request, ActionType.SUPPORT_MESSAGE_ADD, undefined, { isInternal: data.isInternal }); return message;
195:     });
196:   }
197: 
198:   static async listMessages(idInput: unknown, actor: Actor) {
199:     const id = validateId(idInput, 'support request ID');
200:     if (!staffRoles.includes(actor.role) && actor.role !== UserRole.CUSTOMER) throw new SupportError(403, 'Bạn không có đủ quyền truy cập!');
201:     return execute(async () => {
202:       const request = await activeRequest(id); assertCanAccess(actor, request);
```

## R22 — B-NOTIF-TARGET


[backend/src/controllers/notifications/notification.controller.ts:4](C:/Users/laptop/Desktop/WDP/backend/src/controllers/notifications/notification.controller.ts:4) — `getMyNotifications`

```text
3: 
4: export const getMyNotifications = async (req: Request, res: Response) => {
5:   try {
6:     const notifications = await NotificationModel.find({ userId: req.user!._id }).sort({ createdAt: -1 });
7:     return res.json({ success: true, data: notifications });
8:   } catch (error: any) {
9:     return res.status(500).json({ success: false, message: error.message });
10:   }
11: };
12: 
13: export const markAsRead = async (req: Request, res: Response) => {
```

[backend/src/controllers/notifications/notification.controller.ts:13](C:/Users/laptop/Desktop/WDP/backend/src/controllers/notifications/notification.controller.ts:13) — `markAsRead`

```text
12: 
13: export const markAsRead = async (req: Request, res: Response) => {
14:   try {
15:     const notification = await NotificationModel.findOneAndUpdate(
16:       { _id: req.params.id, userId: req.user!._id } as any,
17:       { isRead: true },
18:       { new: true }
19:     );
20:     if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
21:     return res.json({ success: true, data: notification });
22:   } catch (error: any) {
```

## R23 — M-ITEM-CODE


[frontend/customer-mobile/src/forms/inventory.ts:7](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/inventory.ts:7) — `InventoryFormValues`

```text
6: export const inventoryUnits = ['túi', 'kiện', 'thùng', 'hộp'] as const;
7: export interface InventoryFormValues {
8:   name: string; description: string; category: string; quantity: string; unit: string;
9:   widthM: string; depthM: string; heightM: string; weightKg: string;
10:   rentalId: string; preferredCell: string; images: Illustration[];
11: }
12: export const emptyInventoryForm = (): InventoryFormValues => ({name: '', description: '', category: '', quantity: '', unit: '', widthM: '', depthM: '', heightM: '', weightKg: '', rentalId: '', preferredCell: '', images: []});
13: const positiveDecimal = z.string().trim().refine(v => /^\d+(?:[.,]\d{1,3})?$/.test(v) && Number.isFinite(Number(v.replace(',', '.'))) && Number(v.replace(',', '.')) > 0, 'Nhập số dương, tối đa 3 chữ số thập phân.');
14: export function inventoryFormSchema(ownerId: string, rentals: InventoryRental[]) {
15:   return z.object({
16:     name: z.string().trim().min(2, 'Nhập tên hàng ít nhất 2 ký tự.').max(120, 'Tên tối đa 120 ký tự.'),
```

[frontend/customer-mobile/src/forms/inventory.ts:12](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/inventory.ts:12) — `InventoryFormValues`

```text
11: }
12: export const emptyInventoryForm = (): InventoryFormValues => ({name: '', description: '', category: '', quantity: '', unit: '', widthM: '', depthM: '', heightM: '', weightKg: '', rentalId: '', preferredCell: '', images: []});
13: const positiveDecimal = z.string().trim().refine(v => /^\d+(?:[.,]\d{1,3})?$/.test(v) && Number.isFinite(Number(v.replace(',', '.'))) && Number(v.replace(',', '.')) > 0, 'Nhập số dương, tối đa 3 chữ số thập phân.');
14: export function inventoryFormSchema(ownerId: string, rentals: InventoryRental[]) {
15:   return z.object({
16:     name: z.string().trim().min(2, 'Nhập tên hàng ít nhất 2 ký tự.').max(120, 'Tên tối đa 120 ký tự.'),
17:     description: z.string().trim().max(1000, 'Mô tả tối đa 1.000 ký tự.'),
18:     category: z.string().refine(v => (inventoryCategories as readonly string[]).includes(v), 'Chọn danh mục hàng.'),
19:     quantity: z.string().trim().refine(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0, 'Nhập số lượng nguyên dương hợp lệ.'),
20:     unit: z.string().refine(v => (inventoryUnits as readonly string[]).includes(v), 'Chọn đơn vị tính.'),
21:     widthM: positiveDecimal, depthM: positiveDecimal, heightM: positiveDecimal, weightKg: positiveDecimal,
```

[frontend/customer-mobile/src/forms/inventory.ts:30](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/inventory.ts:30) — `InventoryFormValues`

```text
29: }
30: export function initialInventoryForm(item: InventoryItem, detail: InventoryDetail): InventoryFormValues {
31:   const m = detail.declaredMeasurements;
32:   return {name: item.name, description: detail.description, category: item.category, quantity: String(item.registeredQuantity), unit: item.unit,
33:     widthM: m?.widthM == null ? '' : String(m.widthM), depthM: m?.depthM == null ? '' : String(m.depthM), heightM: m?.heightM == null ? '' : String(m.heightM), weightKg: m?.weightKg == null ? '' : String(m.weightKg),
34:     rentalId: detail.rentalId ?? '', preferredCell: detail.preferredCell ?? '', images: [...detail.images]};
35: }
36: 
```

[frontend/customer-mobile/src/forms/inventory.ts:14](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/src/forms/inventory.ts:14) — `inventoryFormSchema`

```text
13: const positiveDecimal = z.string().trim().refine(v => /^\d+(?:[.,]\d{1,3})?$/.test(v) && Number.isFinite(Number(v.replace(',', '.'))) && Number(v.replace(',', '.')) > 0, 'Nhập số dương, tối đa 3 chữ số thập phân.');
14: export function inventoryFormSchema(ownerId: string, rentals: InventoryRental[]) {
15:   return z.object({
16:     name: z.string().trim().min(2, 'Nhập tên hàng ít nhất 2 ký tự.').max(120, 'Tên tối đa 120 ký tự.'),
17:     description: z.string().trim().max(1000, 'Mô tả tối đa 1.000 ký tự.'),
18:     category: z.string().refine(v => (inventoryCategories as readonly string[]).includes(v), 'Chọn danh mục hàng.'),
19:     quantity: z.string().trim().refine(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0, 'Nhập số lượng nguyên dương hợp lệ.'),
20:     unit: z.string().refine(v => (inventoryUnits as readonly string[]).includes(v), 'Chọn đơn vị tính.'),
21:     widthM: positiveDecimal, depthM: positiveDecimal, heightM: positiveDecimal, weightKg: positiveDecimal,
22:     rentalId: z.string().min(1, 'Chọn kỳ thuê kho ký gửi mẫu.'), preferredCell: z.string(),
23:     images: z.array(z.enum(['box', 'stack', 'label'])).max(3, 'Tối đa 3 hình minh họa.').refine(v => new Set(v).size === v.length, 'Hình minh họa không được trùng.'),
```

## R24 — M-DTO-STOCK


[backend/src/services/inventory-items/managed-stock-ledger.service.ts:261](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-stock-ledger.service.ts:261) — `reconcileManagedItemStock`

```text
260: /** Read-only fold of both the MI-03B/04/05 movement format and version 2 batch-line events. */
261: export function reconcileManagedItemStock(item: AnyRecord, inputMovements: AnyRecord[]) {
262:   const movements = [...inputMovements].sort((a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime() || (identity(a) ?? '').localeCompare(identity(b) ?? ''));
263:   const batches = new Map<string, StockBatchBalance>();
264:   let currentCellId: string | null = null;
265:   let latestPlacementMovementId: string | null = null;
266:   let source: 'LEDGER_V2' | 'LEGACY_RECONCILED' = 'LEGACY_RECONCILED';
267:   let lastMovement: AnyRecord | null = null;
268:   for (const movement of movements) {
269:     if (!identity(movement) || !Number.isFinite(new Date(movement.performedAt).getTime()) ||
270:         identity(movement.itemId) !== identity(item._id) || identity(movement.customerId) !== identity(item.customerId) ||
```

## R25 — M-INBOUND-DTO


[backend/src/services/inventory-items/managed-inbound-request.service.ts:152](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:152) — `create`

```text
151:     ...(value.confirmedMovementId ? { confirmedMovementId: String(value.confirmedMovementId) } : {}),
152:     version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt,
153:   };
154: }
155: 
156: type RequestEventView = InventoryInboundRequestEventFields & { _id: Types.ObjectId };
157: 
158: function eventDto(event: RequestEventView): Record<string, unknown> {
159:   return (event as any).resultSnapshot as Record<string, unknown>;
160: }
161: 
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:187](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:187) — `create`

```text
186:   unresolvedItemId?: Types.ObjectId,
187:   createPayloadHash?: string): Promise<T> {
188:   if (error instanceof ReplayAbort) return onReplay(error.snapshot);
189:   if (error instanceof InventoryInboundRequestError) throw error;
190:   const e = error as any;
191:   const unknownCommit = e?.hasErrorLabel?.('UnknownTransactionCommitResult') || e?.errorLabels?.includes?.('UnknownTransactionCommitResult');
192:   const transient = e?.name === 'VersionError' || e?.code === 112 || e?.codeName === 'WriteConflict' ||
193:     e?.hasErrorLabel?.('TransientTransactionError') || e?.errorLabels?.includes?.('TransientTransactionError');
194:   const duplicate = e?.code === 11000;
195:   if (unknownCommit || transient || duplicate) {
196:     let event: RequestEventView | null = null;
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:219](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:219) — `create`

```text
218:         if (sameKeyRequest) {
219:           if (createPayloadHash && sameKeyRequest.creationPayloadHash !== createPayloadHash) {
220:             fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with a different payload');
221:           }
222:           // Request exists without its atomic event visible; never claim success or mislabel this as another-key conflict.
223:           fail(503, ManagedStockErrorCode.INBOUND_REQUEST_OUTCOME_UNKNOWN, 'Receipt request outcome is not yet confirmed; retry with the same Idempotency-Key');
224:         }
225:       }
226:       const unresolved = await InventoryInboundRequestModel.findOne({ itemId: unresolvedItemId,
227:         state: { $in: inventoryInboundRequestUnresolvedStates } }).lean().exec();
228:       if (unresolved) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_UNRESOLVED_EXISTS, 'An unresolved receipt request already exists for this Item');
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:342](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:342) — `create`

```text
341: export class ManagedInboundRequestService {
342:   static async create(itemIdInput: unknown, input: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<ReceiptCreateResult> {
343:     assertEnabled(); assertCustomer(actor);
344:     const itemId = parseId(itemIdInput, 'item ID');
345:     const key = parseKey(idempotencyKeyInput);
346:     const replayScope = { scopeType: ScopeType.ITEM, scopeId: itemId };
347:     const existing = await findReplay(replayScope.scopeType, replayScope.scopeId, Operation.CREATE, key, actor._id);
348:     let payload: ReceiptPayload;
349:     try { payload = parsePayload(input); }
350:     catch (error) {
351:       if (existing) fail(409, ManagedStockErrorCode.INBOUND_REQUEST_IDEMPOTENCY_CONFLICT, 'Idempotency key was already used with a different payload');
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:122](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:122) — `amend`

```text
121: function parsePayloadPatch(input: unknown): ReceiptPayloadPatch {
122:   const value = plainObject(input, ['requestedQuantity', 'quantityUnit', 'declaredUnitWeightKg', 'declaredUnitDimensionsM'], 'receipt request amendment');
123:   if (!Object.keys(value).length) fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'At least one receipt field must be amended');
124:   const patch: ReceiptPayloadPatch = {};
125:   if (Object.hasOwn(value, 'requestedQuantity')) patch.requestedQuantity = value.requestedQuantity as number;
126:   if (Object.hasOwn(value, 'quantityUnit')) patch.quantityUnit = typeof value.quantityUnit === 'string' ? value.quantityUnit.trim() : value.quantityUnit as string;
127:   if (Object.hasOwn(value, 'declaredUnitWeightKg')) patch.declaredUnitWeightKg = value.declaredUnitWeightKg as number;
128:   if (Object.hasOwn(value, 'declaredUnitDimensionsM')) patch.declaredUnitDimensionsM = parseDimensions(value.declaredUnitDimensionsM, 'declaredUnitDimensionsM');
129:   return patch;
130: }
131: 
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:123](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:123) — `amend`

```text
122:   const value = plainObject(input, ['requestedQuantity', 'quantityUnit', 'declaredUnitWeightKg', 'declaredUnitDimensionsM'], 'receipt request amendment');
123:   if (!Object.keys(value).length) fail(400, ManagedStockErrorCode.INBOUND_REQUEST_INVALID, 'At least one receipt field must be amended');
124:   const patch: ReceiptPayloadPatch = {};
125:   if (Object.hasOwn(value, 'requestedQuantity')) patch.requestedQuantity = value.requestedQuantity as number;
126:   if (Object.hasOwn(value, 'quantityUnit')) patch.quantityUnit = typeof value.quantityUnit === 'string' ? value.quantityUnit.trim() : value.quantityUnit as string;
127:   if (Object.hasOwn(value, 'declaredUnitWeightKg')) patch.declaredUnitWeightKg = value.declaredUnitWeightKg as number;
128:   if (Object.hasOwn(value, 'declaredUnitDimensionsM')) patch.declaredUnitDimensionsM = parseDimensions(value.declaredUnitDimensionsM, 'declaredUnitDimensionsM');
129:   return patch;
130: }
131: 
132: function validateMergedPayload(payload: ReceiptPayload): void {
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:413](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:413) — `amend`

```text
412: 
413:   static async amend(requestIdInput: unknown, input: unknown, ifMatch: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<Record<string, unknown>> {
414:     assertEnabled(); assertCustomer(actor);
415:     const requestId = parseId(requestIdInput, 'request ID');
416:     const key = parseKey(idempotencyKeyInput);
417:     const expectedVersion = parseIfMatch(ifMatch);
418:     const replayScope = { scopeType: ScopeType.REQUEST, scopeId: requestId };
419:     const existing = await findReplay(replayScope.scopeType, requestId, Operation.AMEND, key, actor._id);
420:     let patch: ReceiptPayloadPatch;
421:     try { patch = parsePayloadPatch(input); }
422:     catch (error) {
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:445](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:445) — `amend`

```text
444:         if (!canAmendReceiptRequest(request.state, request.custodyState, request.currentInspectionAttemptId !== null)) {
445:           fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Only an uninspected request without Facility custody can be amended');
446:         }
447:         const mergedPayload: ReceiptPayload = {
448:           requestedQuantity: patch.requestedQuantity ?? request.requestedQuantity,
449:           quantityUnit: patch.quantityUnit ?? request.quantityUnit,
450:           declaredUnitWeightKg: patch.declaredUnitWeightKg ?? request.declaredUnitWeightKg,
451:           declaredUnitDimensionsM: patch.declaredUnitDimensionsM ?? {
452:             widthM: request.declaredUnitDimensionsM.widthM,
453:             depthM: request.declaredUnitDimensionsM.depthM,
454:             heightM: request.declaredUnitDimensionsM.heightM,
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:472](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:472) — `cancel`

```text
471: 
472:   static async cancel(requestIdInput: unknown, ifMatch: unknown, idempotencyKeyInput: unknown, actor: Actor): Promise<Record<string, unknown>> {
473:     assertCustomer(actor);
474:     const requestId = parseId(requestIdInput, 'request ID');
475:     const key = parseKey(idempotencyKeyInput);
476:     const expectedVersion = parseIfMatch(ifMatch);
477:     const payloadHash = canonicalReceiptPayloadHash({ operation: Operation.CANCEL, requestId, expectedVersion });
478:     const replayScope = { scopeType: ScopeType.REQUEST, scopeId: requestId };
479:     const existing = await findReplay(replayScope.scopeType, requestId, Operation.CANCEL, key, actor._id);
480:     if (existing) return sameHash(existing, payloadHash);
481:     const current = await InventoryInboundRequestModel.findOne({ _id: requestId, customerId: actor._id })
```

[backend/src/services/inventory-items/managed-inbound-request.service.ts:498](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/managed-inbound-request.service.ts:498) — `cancel`

```text
497:         if (!canAmendReceiptRequest(request.state, request.custodyState, request.currentInspectionAttemptId !== null)) {
498:           fail(409, ManagedStockErrorCode.INBOUND_REQUEST_INELIGIBLE, 'Only an uninspected request without Facility custody can be cancelled');
499:         }
500:         request.state = InventoryInboundRequestState.CANCELLED;
501:         await request.save({ session });
502:         const snapshot = requestDto(request);
503:         await makeEvent(request, actor._id, Operation.CANCEL, ScopeType.REQUEST, requestId, key, payloadHash,
504:           { requestId: String(requestId), expectedVersion }, snapshot).save({ session });
505:         return snapshot;
506:       });
507:     } catch (error) {
```

## R26 — M-CONTRACT


[backend/src/types/contract.type.ts:3](C:/Users/laptop/Desktop/WDP/backend/src/types/contract.type.ts:3) — `ContractStatus`

```text
2: 
3: export enum ContractStatus {
4:   DRAFT = 'DRAFT',
5:   SIGNED = 'SIGNED',
6:   TERMINATED = 'TERMINATED',
7:   EXPIRED = 'EXPIRED'
8: }
9: 
10: export interface IContract extends Document {
11:   contractCode: string;
12:   reservationId: Types.ObjectId;
```

[backend/src/types/contract.type.ts:15](C:/Users/laptop/Desktop/WDP/backend/src/types/contract.type.ts:15) — `ContractStatus`

```text
14:   
15:   status: ContractStatus;
16:   
17:   customerSnapshot: any; // { identityCard, fullName, phone, address }
18:   pricingSnapshot: any;  // { estimatedRent, depositAmount, taxAmount... }
19:   
20:   signedByCustomerAt?: Date;
21:   signedByFMAt?: Date;
22:   fmId?: Types.ObjectId;
23:   
24:   pdfUrl?: string;
```

## R27 — M-MAP-GEO


[backend/src/services/warehouse-map/warehouse-map.service.ts:229](C:/Users/laptop/Desktop/WDP/backend/src/services/warehouse-map/warehouse-map.service.ts:229) — `cellBookingDto`

```text
228: 
229: function cellBookingDto(cell: IWarehouseCell, allocations: any[], hasMyInventory: boolean, actor: Actor, range?: { startDate: Date; endDate: Date }, rackAvailable = true) {
230:   const physicalUsageKnown = typeof cell.usedWeightKg === 'number' && Number.isFinite(cell.usedWeightKg) && cell.usedWeightKg >= 0 &&
231:     typeof cell.usedVolumeM3 === 'number' && Number.isFinite(cell.usedVolumeM3) && cell.usedVolumeM3 >= 0;
232:   const usedWeightKg = Number(cell.usedWeightKg ?? 0), usedVolumeM3 = Number(cell.usedVolumeM3 ?? 0);
233:   const now = new Date();
234:   const occupied = allocations.some(allocation => allocation.status === CellAllocationStatus.OCCUPIED);
235:   const activeNow = allocations.find(allocation => allocation.status === CellAllocationStatus.RESERVED && allocation.startDate <= now && allocation.endDate > now || allocation.status === CellAllocationStatus.HOLD && allocation.holdExpiresAt > now && allocation.startDate <= now && allocation.endDate > now);
236:   const activePeriod = allocations.find(allocation => allocation.status === CellAllocationStatus.RESERVED && allocation.startDate < (range?.endDate ?? now) && allocation.endDate > (range?.startDate ?? now) || allocation.status === CellAllocationStatus.HOLD && allocation.holdExpiresAt > now && allocation.startDate < (range?.endDate ?? now) && allocation.endDate > (range?.startDate ?? now));
237:   const isMine = Boolean(actor?.role === UserRole.CUSTOMER && allocations.some(allocation => String(allocation.customerId) === actor._id.toString()));
238:   const physicallyOccupied = !Number.isFinite(usedWeightKg) || !Number.isFinite(usedVolumeM3) || usedWeightKg !== 0 || usedVolumeM3 !== 0 || occupied;
```

[backend/src/services/warehouse-map/warehouse-map.service.ts:691](C:/Users/laptop/Desktop/WDP/backend/src/services/warehouse-map/warehouse-map.service.ts:691) — `cellBookingDto`

```text
690:             const usage = await usageForRack(rack as IWarehouseRack, rackCells);
691:             const statuses = rackCells.map(cell => cellBookingDto(cell, bookingData.rows.get(cell._id.toString()) ?? [], bookingData.myInventoryCells.has(cell._id.toString()), actor, range, rack.operationalStatus === WarehouseOperationalStatus.AVAILABLE));
692:             return {
693:               _id: rack._id,
694:               rackCode: rack.rackCode,
695:               mapX: rack.mapX,
696:               mapY: rack.mapY,
697:               orientation: rack.orientation,
698:               dimensions: rack.dimensions,
699:               operationalStatus: rack.operationalStatus,
700:               utilization: {
```

[backend/src/services/warehouse-map/warehouse-map.service.ts:767](C:/Users/laptop/Desktop/WDP/backend/src/services/warehouse-map/warehouse-map.service.ts:767) — `cellBookingDto`

```text
766:             utilizationStatus: utilizationStatus(Number(cell.usedWeightKg ?? 0), cell.maxWeightKg),
767:             ...cellBookingDto(cell as IWarehouseCell, bookingData.rows.get(cell._id.toString()) ?? [], bookingData.myInventoryCells.has(cell._id.toString()), actor, range, rack.operationalStatus === WarehouseOperationalStatus.AVAILABLE),
768:           })),
769:         });
770:       }
771:       const capacityKg = rack.levelCount * rack.maxWeightKgPerLevel;
772:       const allocatableCapacityKg = cells.reduce((sum, cell) => sum + cell.maxWeightKg, 0);
773:       return {
774:         ...(range ? { requestedInterval: { startDate: range.startDate, endDate: range.endDate } } : {}),
775:         rack: {
776:           _id: rack._id,
```

## R28 — M-PAGING


[backend/src/services/inventory-items/inventory-item.service.ts:684](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:684) — `listMine`

```text
683: 
684:   static async listMine(query: unknown, actor: Actor) {
685:     if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Customer role required');
686:     const parsed = parseList(query);
687:     if (parsed.facilityId || parsed.customerId) throw new InventoryItemError(400, 'Customer list scope is derived from the authenticated user');
688:     return execute(async () => {
689:       // Registration history remains visible to its owner after a reservation closes.
690:       const filter = { customerId: actor._id, ...live };
691:       const [items, total] = await Promise.all([
692:         InventoryItemModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((parsed.page - 1) * parsed.limit).limit(parsed.limit).lean().exec(),
693:         InventoryItemModel.countDocuments(filter).exec(),
```

## R29 — M-PROFILE


[backend/src/controllers/users/customer-profile.controller.ts:7](C:/Users/laptop/Desktop/WDP/backend/src/controllers/users/customer-profile.controller.ts:7) — `getMyProfile`

```text
6: 
7: export const getMyProfile = async (req: Request, res: Response) => {
8:   try {
9:     const userId = req.user!._id;
10:     let profile = await CustomerProfileModel.findOne({ userId }).populate('userId', 'email phone fullName').exec();
11:     if (!profile) {
12:       profile = await CustomerProfileModel.create({ userId });
13:     }
14:     return res.json({ success: true, data: profile });
15:   } catch (error: any) {
16:     return res.status(500).json({ success: false, message: error.message });
```

[backend/src/controllers/users/customer-profile.controller.ts:20](C:/Users/laptop/Desktop/WDP/backend/src/controllers/users/customer-profile.controller.ts:20) — `updateMyProfile`

```text
19: 
20: export const updateMyProfile = async (req: Request, res: Response) => {
21:   try {
22:     const userId = req.user!._id;
23:     const { identityCard, address, taxCode } = req.body;
24:     
25:     // SAFEGUARD: Khóa CCCD nếu đã có hợp đồng đang chạy
26:     if (identityCard) {
27:       const activeBookings = await ReservationModel.exists({
28:         customerId: userId,
29:         status: { $in: [ReservationStatus.CONTRACTED, ReservationStatus.PAID, ReservationStatus.ACTIVE] }
```

## R30 — M-SELF-DETAIL


[backend/src/controllers/reservations/reservation.controller.ts:303](C:/Users/laptop/Desktop/WDP/backend/src/controllers/reservations/reservation.controller.ts:303) — `getReservationById`

```text
302: 
303: export const getReservationById = async (req: Request, res: Response) => {
304:   try {
305:     const reservation = await ReservationModel.findOne({ _id: req.params.id, serviceType: FacilityServiceType.SELF_STORAGE } as any)
306:       .populate('customerId', 'fullName email phone')
307:       .populate('facilityId', 'name address')
308:       .populate('storageUnitId', 'unitCode size dimensions status');
309:     if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
310:     if (req.user!.role === UserRole.CUSTOMER && String(reservation.customerId) !== String(req.user!._id)) {
311:       return res.status(403).json({ success: false, message: 'Bạn không có đủ quyền truy cập!' });
312:     }
```

## R31 — B-CREATE-RETRY


[backend/src/services/reservations/reservation.service.ts:237](C:/Users/laptop/Desktop/WDP/backend/src/services/reservations/reservation.service.ts:237) — `createReservation`

```text
236:    */
237:   static async createReservation(data: {
238:     customerId: string;
239:     facilityId: string;
240:     storageUnitId: string;
241:     startDate: Date;
242:     endDate: Date;
243:     pricingPolicyId: string;
244:   }): Promise<IReservation> {
245:     
246:     // 1. Kiểm tra Gate Verification (Bắt buộc KH phải VERIFIED)
```

## R32 — D-SOURCE


[frontend/customer-mobile/docs/PHASE6AR/REVISION_METADATA.json:2](C:/Users/laptop/Desktop/WDP/frontend/customer-mobile/docs/PHASE6AR/REVISION_METADATA.json:2) — `head`

```text
1: {
2:   "head": "b7f09b48299882075d6c16511f8419fdb040488a",
3:   "oldCandidate": "7a5cd84",
4:   "historicalMatch": 221,
5:   "historicalDifferent": [],
6:   "worktreeCompared": 1523,
7:   "worktreeDifferent": [],
8:   "referenceDifferent": [],
9:   "note": "Git status unavailable (parent chdir permission); tracked content compared with HEAD, excluding .env. Historical hashes compared raw and CRLF-normalized."
10: }
```

## R33 — NEW_AUDIT_FINDING


[backend/src/controllers/reservations/reservation.controller.ts:796](C:/Users/laptop/Desktop/WDP/backend/src/controllers/reservations/reservation.controller.ts:796) — `handoverReservation`

```text
795:  */
796: export const handoverReservation = async (req: Request, res: Response) => {
797:   try {
798:     if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
799:       return res.status(404).json({ success: false, message: 'Self-Storage handover is disabled in this environment pending payment verification.' });
800:     }
801:     const reservationId = req.params.id;
802:     const reservation = await ReservationModel.findById(reservationId);
803:     if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
804: 
805:     if (reservation.serviceType !== FacilityServiceType.SELF_STORAGE) {
```

## R34 — M-SUPPORT


[backend/src/services/support-requests/support-request.service.ts:1](C:/Users/laptop/Desktop/WDP/backend/src/services/support-requests/support-request.service.ts:1) — `messages`

```text
1: import { Types } from 'mongoose';
2: import FacilityModel from '../../models/facilities/facility.model';
3: import StorageUnitModel from '../../models/storage-units/storage-unit.model';
4: import UserModel from '../../models/users/user.model';
5: import SupportRequestModel from '../../models/support-requests/support-request.model';
6: import SupportMessageModel from '../../models/support-requests/support-message.model';
7: import { ActionType, IAuditLog } from '../../types/audit.type';
8: import { ISupportRequest, SupportStatus } from '../../types/support-request.type';
9: import { IUser, UserRole } from '../../types/user.type';
10: import { AuditService } from '../audit/audit.service';
```

[backend/src/services/support-requests/support-request.service.ts:1](C:/Users/laptop/Desktop/WDP/backend/src/services/support-requests/support-request.service.ts:1) — `reply`

```text
1: import { Types } from 'mongoose';
2: import FacilityModel from '../../models/facilities/facility.model';
3: import StorageUnitModel from '../../models/storage-units/storage-unit.model';
4: import UserModel from '../../models/users/user.model';
5: import SupportRequestModel from '../../models/support-requests/support-request.model';
6: import SupportMessageModel from '../../models/support-requests/support-message.model';
7: import { ActionType, IAuditLog } from '../../types/audit.type';
8: import { ISupportRequest, SupportStatus } from '../../types/support-request.type';
9: import { IUser, UserRole } from '../../types/user.type';
10: import { AuditService } from '../audit/audit.service';
```

## R35 — M-INVENTORY-EDIT


[backend/src/services/inventory-items/inventory-item.service.ts:134](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:134) — `update`

```text
133:     createdAt: item.createdAt,
134:     updatedAt: item.updatedAt,
135:   };
136: }
137: 
138: function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
139: 
140: function deriveTotals(value: {
141:   quantity: number;
142:   unitWeightKg: number;
143:   unitDimensionsM: { widthM: number; depthM: number; heightM: number };
```

[backend/src/services/inventory-items/inventory-item.service.ts:318](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:318) — `update`

```text
317:     ? 'Reservation closure is pending; Item metadata changes are blocked'
318:     : 'Reservation lifecycle changed; reload and retry Item metadata update');
319:   return locked;
320: }
321: 
322: function signedByBothCurrentVersion(contract: IContract) {
323:   const version = contract.currentContentVersion;
324:   const active = contract.contentVersions?.find(entry => entry.version === version);
325:   if (!version || !active || contract.status !== ContractStatus.SIGNED) return false;
326:   const signatures = contract.signatures?.filter(signature => signature.version === version && signature.contentHash === active.contentHash) ?? [];
327:   return signatures.some(signature => signature.signerRole === UserRole.CUSTOMER) && signatures.some(signature => signature.signerRole !== UserRole.CUSTOMER);
```

[backend/src/services/inventory-items/inventory-item.service.ts:734](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:734) — `update`

```text
733: 
734:   static async update(idInput: unknown, input: unknown, actor: Actor) {
735:     if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Only the owning customer may update registered item metadata');
736:     const itemId = parseId(idInput, 'item ID');
737:     const changes = parseUpdate(input);
738:     return execute(async () => withTransaction(async session => {
739:       const current = await InventoryItemModel.findOne({ _id: itemId, customerId: actor._id, ...live }).session(session).exec();
740:       if (!current) throw new InventoryItemError(404, 'Inventory item not found');
741:       await assertItemReadAccess(current, actor);
742:       if (current.status !== InventoryItemStatus.REGISTERED || current.currentCellId !== null) {
743:         throw new InventoryItemError(409, 'Only unplaced REGISTERED item metadata can be edited');
```

[backend/src/services/inventory-items/inventory-item.service.ts:735](C:/Users/laptop/Desktop/WDP/backend/src/services/inventory-items/inventory-item.service.ts:735) — `update`

```text
734:   static async update(idInput: unknown, input: unknown, actor: Actor) {
735:     if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Only the owning customer may update registered item metadata');
736:     const itemId = parseId(idInput, 'item ID');
737:     const changes = parseUpdate(input);
738:     return execute(async () => withTransaction(async session => {
739:       const current = await InventoryItemModel.findOne({ _id: itemId, customerId: actor._id, ...live }).session(session).exec();
740:       if (!current) throw new InventoryItemError(404, 'Inventory item not found');
741:       await assertItemReadAccess(current, actor);
742:       if (current.status !== InventoryItemStatus.REGISTERED || current.currentCellId !== null) {
743:         throw new InventoryItemError(409, 'Only unplaced REGISTERED item metadata can be edited');
744:       }
```

## Supplement — Self sign fallback eligibility

backend/src/controllers/contracts/contract.controller.ts:128–140; signContract begins88. Owned DRAFT filter does not include Reservation deposit eligibility.

```text
128:       { 
129:         status: ContractStatus.SIGNED, 
130:         signedByCustomerAt: new Date() 
131:       },
132:       { new: true }
133:     );
134:     if (!contract) return res.status(400).json({ success: false, message: 'Contract cannot be signed (not found or already signed).' });
135:     return res.json({ success: true, data: contract });
136:   } catch (error: any) {
137:     if (error instanceof ManagedCheckinError) return res.status(error.status).json({ success: false, message: error.message });
138:     return res.status(500).json({ success: false, message: error.message });
139:   }
140: };
141: 
```
