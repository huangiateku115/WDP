const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Set test environment
process.env.NODE_ENV = 'test';

const { PaymentPurpose, PaymentStatus, PaymentProvider } = require('../dist/types/payment.type');
const { ReservationStatus } = require('../dist/types/reservation.type');
const { ContractStatus } = require('../dist/types/contract.type');
const { UserRole } = require('../dist/types/user.type');
const { FacilityServiceType } = require('../dist/types/facility.type');

const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const ContractModel = require('../dist/models/contracts/contract.model').default;
const ReservationPaymentModel = require('../dist/models/payments/reservation-payment.model').default;
const PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;

const { calculateRentalPaymentBreakdown, paymentAmountForPurpose } = require('../dist/services/payments/payment-accounting');
const { ReservationService, ReservationError } = require('../dist/services/reservations/reservation.service');
const ReservationController = require('../dist/controllers/reservations/reservation.controller');
const PayosPaymentService = require('../dist/services/payments/payos-payment.service').PayosPaymentService;

function mockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

// ============================================================================
// PHASE 1: CORE SCHEMAS, PRICING & PAYMENT PURPOSE VERIFICATION
// ============================================================================

test('Phase 1.1: Reservation schema includes 3-day SLA, paper proof, access PIN and renewal fields', () => {
  const paths = ReservationModel.schema.paths;
  
  assert.ok(paths['signingDeadline'], 'signingDeadline must be defined');
  assert.ok(paths['paperContractProofUrl'], 'paperContractProofUrl must be defined');
  assert.ok(paths['paperContractVerifiedBy'], 'paperContractVerifiedBy must be defined');
  assert.ok(paths['paperContractVerifiedAt'], 'paperContractVerifiedAt must be defined');
  assert.ok(paths['accessPinCode'], 'accessPinCode must be defined');
  assert.ok(paths['cancellationReason'], 'cancellationReason must be defined');
  assert.ok(paths['refundPenaltyPercent'], 'refundPenaltyPercent must be defined');
  assert.ok(paths['fullPaymentId'], 'fullPaymentId must be defined');
  assert.ok(paths['actualCheckoutDate'], 'actualCheckoutDate must be defined');
  assert.ok(paths['renewals'], 'renewals array must be defined');
});

test('Phase 1.2: Contract schema includes verifiedByStaff and signedProofUrl fields', () => {
  const paths = ContractModel.schema.paths;
  assert.ok(paths['signedProofUrl'], 'signedProofUrl must be defined');
  assert.ok(paths['verifiedByStaff'], 'verifiedByStaff must be defined');
  assert.ok(paths['verifiedAt'], 'verifiedAt must be defined');
});

test('Phase 1.3: PaymentPurpose includes FULL_RENT and paymentAmountForPurpose returns 100% totalDue', () => {
  assert.ok(Object.values(PaymentPurpose).includes(PaymentPurpose.FULL_RENT));
  assert.ok(Object.values(PaymentPurpose).includes(PaymentPurpose.RENEWAL));

  const breakdown = calculateRentalPaymentBreakdown({
    rentAmount: 3_000_000,
    depositAmount: 1_000_000,
    taxAmount: 0,
    discountAmount: 0
  });

  assert.equal(breakdown.totalDue, 3_000_000);
  assert.equal(paymentAmountForPurpose(breakdown, PaymentPurpose.FULL_RENT), 3_000_000);
});

test('Phase 1.4: calculatePricing resolves basePrice from PricingRuleModel first', async (t) => {
  const fakePolicyId = new mongoose.Types.ObjectId();
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 2_000_000 })
  }));

  const start = new Date('2026-12-01T00:00:00.000Z');
  const end = new Date('2027-02-01T00:00:00.000Z'); // 62 days (~2 months)

  const result = await ReservationService.calculatePricing(fakePolicyId.toString(), start, end);
  assert.equal(result.basePrice, 2_000_000);
  assert.equal(result.durationDays, 62);
  assert.equal(result.estimatedRent, Math.round((62 / 30) * 2_000_000));
});

// ============================================================================
// PHASE 2: BOOKING DATE VALIDATION (START_DATE = TODAY, S-LA 3 DAYS)
// ============================================================================

test('Phase 2.1: calculatePricing rejects past or inverted dates', async () => {
  const fakePolicyId = new mongoose.Types.ObjectId();
  const start = new Date('2026-11-10T00:00:00.000Z');
  const end = new Date('2026-11-05T00:00:00.000Z');

  await assert.rejects(
    () => ReservationService.calculatePricing(fakePolicyId.toString(), start, end),
    (err) => err instanceof ReservationError && err.code === 400
  );
});

test('Phase 2.2: createReservationWithOutcome rejects start date in the past', async (t) => {
  const fakeCustomerId = new mongoose.Types.ObjectId();
  const fakeFacilityId = new mongoose.Types.ObjectId();
  const fakeStorageUnitId = new mongoose.Types.ObjectId();
  const fakePricingRuleId = new mongoose.Types.ObjectId();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2);

  const end = new Date();
  end.setMonth(end.getMonth() + 1);

  // Mock verified profile
  const CustomerProfileModel = require('../dist/models/users/customer-profile.model').default;
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  await assert.rejects(
    () => ReservationService.createReservationWithOutcome({
      customerId: fakeCustomerId.toString(),
      facilityId: fakeFacilityId.toString(),
      storageUnitId: fakeStorageUnitId.toString(),
      pricingPolicyId: fakePricingRuleId.toString(),
      startDate: yesterday,
      endDate: end
    }),
    (err) => err instanceof ReservationError && err.code === 400 && err.message.includes('quá khứ')
  );
});

// ============================================================================
// PHASE 2: LOCAL DEV MOCK PAYMENT (100% FULL_RENT SETTLEMENT)
// ============================================================================

test('Phase 2.3: mockPayReservation transitions status to PAID, sets signingDeadline, and creates FULL_RENT payment', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId();

  const mockResDoc = {
    _id: reservationId,
    reservationCode: 'BKG-TEST-001',
    customerId,
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.PAID,
    estimatedRent: 1_500_000,
    depositAmount: 1_500_000,
    signingDeadline: new Date(Date.now() + 3 * 24 * 3600 * 1000),
    save: async () => mockResDoc
  };

  t.mock.method(ReservationModel, 'findOneAndUpdate', async () => mockResDoc);
  t.mock.method(ReservationPaymentModel, 'create', async (paymentData) => {
    assert.equal(paymentData.purpose, PaymentPurpose.FULL_RENT);
    assert.equal(paymentData.amount, 1_500_000);
    assert.equal(paymentData.status, PaymentStatus.SUCCEEDED);
    return { _id: new mongoose.Types.ObjectId(), ...paymentData };
  });

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.mockPayReservation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, ReservationStatus.PAID);
  assert.ok(res.body.data.signingDeadline);
});

test('Phase 2.4: mockPayReservation rejects non-customer roles from calling customer mock payment', async () => {
  const staffId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF }
  };
  const res = mockResponse();

  await ReservationController.mockPayReservation(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Only the reservation owner/i);
});

test('Phase 2.5: mockPayReservation rejects another customer trying to pay someone elses reservation', async (t) => {
  const customerA = new mongoose.Types.ObjectId();
  const customerB = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  // findOneAndUpdate returns null because filter has customerId
  t.mock.method(ReservationModel, 'findOneAndUpdate', async () => null);
  t.mock.method(ReservationModel, 'findById', async () => ({
    _id: reservationId,
    customerId: customerA,
    status: ReservationStatus.CONTRACTED
  }));

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: customerB, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.mockPayReservation(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

// ============================================================================
// PHASE 2: CLI SCRIPT INTEGRITY
// ============================================================================

test('Phase 2.6: local-mock-pay.cjs script file exists and is valid Node.js script', () => {
  const fs = require('fs');
  const path = require('path');
  const scriptPath = path.resolve(__dirname, '../scripts/local-mock-pay.cjs');
  assert.ok(fs.existsSync(scriptPath), 'scripts/local-mock-pay.cjs must exist');

  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.ok(content.includes('LOCAL-CLI-PAYOS-FULL-'));
  assert.ok(content.includes('FULL_RENT'));
  assert.ok(content.includes('signingDeadline'));
});
