const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';

const { ReservationStatus } = require('../dist/types/reservation.type');
const { FacilityServiceType } = require('../dist/types/facility.type');
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const ContractModel = require('../dist/models/contracts/contract.model').default;
const StorageUnitModel = require('../dist/models/storage-units/storage-unit.model').default;
const PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;
const ReservationPaymentModel = require('../dist/models/payments/reservation-payment.model').default;
const ReservationController = require('../dist/controllers/reservations/reservation.controller');
const { checkSigningSla } = require('../dist/jobs/signing-sla-checker.job');

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

test('Contract Extension: Chặn tạo yêu cầu gia hạn nếu đơn không ở trạng thái ACTIVE', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  const fakeReservation = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.CONTRACTED, // Không phải ACTIVE
    extendContract: [],
  };

  const origFindById = ReservationModel.findById;
  const origFindOne = ReservationModel.findOne;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });
  t.after(() => {
    ReservationModel.findById = origFindById;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 1 },
    user: { _id: customerId, role: 'CUSTOMER' },
  };
  const res = mockResponse();

  await ReservationController.createExtensionRequest(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /không ở trạng thái ACTIVE/i);
});

test('Contract Extension: Customer cannot create an Extension for another Customer Reservation', async t => {
  const ownerId = new mongoose.Types.ObjectId(), callerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const originalFindById = ReservationModel.findById;
  ReservationModel.findById = () => ({ then: resolve => resolve({ _id: reservationId, customerId: ownerId }) });
  t.after(() => { ReservationModel.findById = originalFindById; });
  const res = mockResponse();
  await ReservationController.createExtensionRequest({ params: { id: String(reservationId) }, body: { durationMonths: 1 },
    get: () => undefined, user: { _id: callerId, role: 'CUSTOMER' } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /không có quyền gia hạn/i);
});

test('Contract Extension: Chặn tạo yêu cầu gia hạn nếu đơn đang có yêu cầu checkout PENDING', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  const fakeReservation = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    checkoutRequest: { status: 'PENDING' },
    extendContract: [],
  };

  const origFindById = ReservationModel.findById;
  const origFindOne = ReservationModel.findOne;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });

  t.after(() => {
    ReservationModel.findById = origFindById;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 1 },
    user: { _id: customerId, role: 'CUSTOMER' },
  };
  const res = mockResponse();

  await ReservationController.createExtensionRequest(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /đang có yêu cầu trả kho/i);
});

test('Contract Extension: Chặn tạo yêu cầu gia hạn nếu đang có 1 yêu cầu gia hạn khác dở dang', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  const fakeReservation = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    extendContract: [
      {
        _id: new mongoose.Types.ObjectId(),
        extensionCode: 'EXT-20261116-0001',
        status: 'PAID', // Đang chờ ký tại cơ sở
        amount: 1500000,
      }
    ],
  };

  const origFindById = ReservationModel.findById;
  const origFindOne = ReservationModel.findOne;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });

  t.after(() => {
    ReservationModel.findById = origFindById;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 2 },
    user: { _id: customerId, role: 'CUSTOMER' },
  };
  const res = mockResponse();

  await ReservationController.createExtensionRequest(req, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /đang có yêu cầu gia hạn/i);
});

test('Contract Extension: Tạo yêu cầu gia hạn thành công (PENDING_PAYMENT)', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId();
  const storageUnitId = new mongoose.Types.ObjectId();
  const pricingRuleId = new mongoose.Types.ObjectId();

  const initialEndDate = new Date('2026-12-01T00:00:00.000Z');

  const fakeReservation = {
    _id: reservationId,
    customerId,
    facilityId,
    storageUnitId,
    pricingRuleId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    startDate: new Date('2026-11-01T00:00:00.000Z'),
    endDate: initialEndDate,
    durationMonths: 1,
    estimatedRent: 1200000,
    paperContractProofUrl: 'https://res.cloudinary.com/test/image/upload/v1/contract_proof.jpg',
    statusHistory: [],
    extendContract: [],
    async save() { return this; }
  };

  const origFindById = ReservationModel.findById;
  const origFindOne = ReservationModel.findOne;
  const origExists = ReservationModel.exists;
  const origContractFindOne = ContractModel.findOne;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = (filter) => ({
    session: () => ({ exec: async () => filter.endDate ? fakeReservation : null }),
    exec: async () => null,
    then: (resolve) => resolve(null),
  });
  ReservationModel.exists = () => ({ session: () => ({ exec: async () => null }), exec: async () => null });
  ContractModel.findOne = () => ({ exec: async () => ({ status: 'SIGNED', signedProofUrl: 'https://proof.example/original', verifiedAt: new Date() }) });

  const origStorageUnit = StorageUnitModel.findById;
  const fakeUnit = { _id: storageUnitId, status: 'OCCUPIED', facilityId };
  StorageUnitModel.findById = () => ({
    exec: async () => fakeUnit,
    session: () => ({ exec: async () => fakeUnit }),
    then: (resolve) => resolve(fakeUnit),
  });
  const origUnitFindOneAndUpdate = StorageUnitModel.findOneAndUpdate;
  StorageUnitModel.findOneAndUpdate = () => ({ exec: async () => ({ _id: storageUnitId }) });
  const originalStartSession = mongoose.startSession;
  const transaction = { withTransaction: async callback => callback(), endSession: async () => {} };
  mongoose.startSession = async () => transaction;

  const origPricingRule = PricingRuleModel.findById;
  const origPricingRuleFindOne = PricingRuleModel.findOne;
  const mockRule = {
    _id: pricingRuleId,
    basePrice: 1200000,
    price: 1200000,
    currency: 'VND',
    isActive: true,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    priceRevisions: [{ version: 1, price: 1200000, currency: 'VND', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') }],
  };
  PricingRuleModel.findById = () => ({
    exec: async () => mockRule,
    then: (resolve) => resolve(mockRule),
  });
  PricingRuleModel.findOne = () => ({
    exec: async () => mockRule,
    then: (resolve) => resolve(mockRule),
  });

  t.after(() => {
    ReservationModel.findById = origFindById;
    StorageUnitModel.findById = origStorageUnit;
    StorageUnitModel.findOneAndUpdate = origUnitFindOneAndUpdate;
    ReservationModel.exists = origExists;
    ContractModel.findOne = origContractFindOne;
    mongoose.startSession = originalStartSession;
    PricingRuleModel.findById = origPricingRule;
    PricingRuleModel.findOne = origPricingRuleFindOne;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 2 },
    get: name => name === 'Idempotency-Key' ? 'extension-request-key-01' : undefined,
    user: { _id: customerId, role: 'CUSTOMER' },
  };
  const res = mockResponse();

  await ReservationController.createExtensionRequest(req, res);

  assert.equal(res.statusCode, 201, res.body?.message);
  assert.equal(res.body.success, true);
  const ext = res.body.data.extension;
  assert.equal(ext.durationMonths, 2);
  assert.equal(ext.status, 'PENDING_PAYMENT');
  assert.match(ext.extensionCode, /^EXT-/);
  // Ngày endDate của đơn chính vẫn giữ nguyên cho đến khi staff ký duyệt
  assert.equal(fakeReservation.endDate.toISOString(), initialEndDate.toISOString());
  assert.equal(fakeReservation.extendContract.length, 1);
  assert.equal(fakeReservation.extendContract[0].requestPayloadHash.length, 64);

  const replayRes = mockResponse();
  await ReservationController.createExtensionRequest(req, replayRes);
  assert.equal(replayRes.statusCode, 200);
  assert.equal(replayRes.body.outcome, 'REPLAYED');
  assert.equal(fakeReservation.extendContract.length, 1, 'same Idempotency-Key must not append another Extension');

  const mismatchRes = mockResponse();
  await ReservationController.createExtensionRequest({ ...req, body: { durationMonths: 3 } }, mismatchRes);
  assert.equal(mismatchRes.statusCode, 409);
  assert.equal(mismatchRes.body.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(fakeReservation.extendContract.length, 1);
});

test('Contract Extension: Dev Mock Pay Bypass fail-closed without changing Extension state', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId();
  const extensionId = new mongoose.Types.ObjectId();

  const fakeReservation = {
    _id: reservationId,
    customerId,
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    statusHistory: [],
    extendContract: [
      {
        _id: extensionId,
        extensionCode: 'EXT-20261116-0001',
        durationMonths: 2,
        amount: 2400000,
        status: 'PENDING_PAYMENT',
        newEndDate: new Date('2027-02-01T00:00:00.000Z'),
      }
    ],
    async save() { return this; }
  };

  const origFindById = ReservationModel.findById;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  t.after(() => {
    ReservationModel.findById = origFindById;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { extensionId: extensionId.toString() },
    user: { _id: customerId, role: 'CUSTOMER' },
  };
  const res = mockResponse();

  await ReservationController.mockPayExtension(req, res);

  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, 'RENEWAL_MOCK_PAYMENT_DISABLED');
  const ext = fakeReservation.extendContract[0];
  assert.equal(ext.status, 'PENDING_PAYMENT');
  assert.equal(ext.paymentId, undefined);
  // Đơn chính vẫn giữ nguyên ACTIVE
  assert.equal(fakeReservation.status, ReservationStatus.ACTIVE);
});

test('Contract Extension: Staff tải ảnh phụ lục & Xác nhận gia hạn thành công (cộng dồn endDate)', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const extensionId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const initialEndDate = new Date('2026-12-01T00:00:00.000Z');
  const targetNewEndDate = new Date('2027-02-01T00:00:00.000Z');

  const fakeReservation = {
    _id: reservationId,
    customerId,
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    endDate: initialEndDate,
    statusHistory: [],
    extendContract: [
      {
        _id: extensionId,
        extensionCode: 'EXT-20261116-0001',
        durationMonths: 2,
        amount: 2400000,
        status: 'PAID',
        paymentId,
        oldEndDate: initialEndDate,
        newEndDate: targetNewEndDate,
      }
    ],
    async save() { return this; }
  };

  const origFindById = ReservationModel.findById;
  const origFindOne = ReservationModel.findOne;
  const origPaymentFindById = ReservationPaymentModel.findById;
  const origStartSession = mongoose.startSession;
  const confirmSession = { withTransaction: async callback => callback(), endSession: async () => {} };
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    session: () => ({ exec: async () => fakeReservation }),
    then: (resolve) => resolve(fakeReservation),
  });
  mongoose.startSession = async () => confirmSession;
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });
  ReservationPaymentModel.findById = requestedPaymentId => ({ where: filter => ({ exec: async () => ({
    _id: requestedPaymentId, reservationId, customerId, facilityId, serviceType: FacilityServiceType.SELF_STORAGE,
    purpose: 'RENEWAL', extensionId: filter.extensionId, provider: 'PAYOS', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED',
    applicationStatus: 'APPLIED', amount: 2400000, currency: 'VND',
  }) }) });

  let contractUpdateCalls = 0;
  const origContractUpdate = ContractModel.findOneAndUpdate;
  ContractModel.findOneAndUpdate = () => { contractUpdateCalls++; return { exec: async () => ({ success: true }) }; };
  t.mock.method(ReservationPaymentModel, 'findOne', filter => ({ exec: async () => {
    assert.equal(String(filter._id), String(fakeReservation.extendContract[0].paymentId));
    assert.equal(filter.status, 'SUCCEEDED');
    assert.equal(filter.providerSettlementStatus, 'VERIFIED');
    assert.equal(filter.applicationStatus, 'APPLIED');
    return ({
    amount: 2400000, purpose: 'RENEWAL', status: 'SUCCEEDED', provider: 'PAYOS',
    providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED',
    });
  } }));

  t.after(() => {
    ReservationModel.findById = origFindById;
    ReservationPaymentModel.findById = origPaymentFindById;
    mongoose.startSession = origStartSession;
    ContractModel.findOneAndUpdate = origContractUpdate;
  });

  const req = {
    params: { id: reservationId.toString(), extensionId: extensionId.toString() },
    body: { paperProofUrl: 'https://res.cloudinary.com/test/image/upload/v1/extension_proof.jpg' },
    user: { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId },
  };
  const res = mockResponse();

  await ReservationController.confirmExtension(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ext = fakeReservation.extendContract[0];
  assert.equal(ext.status, 'ACTIVE');
  assert.equal(ext.paperProofUrl, 'https://res.cloudinary.com/test/image/upload/v1/extension_proof.jpg');
  assert.equal(ext.verifiedBy.toString(), staffId.toString());
  assert.equal(contractUpdateCalls, 0, 'Renewal confirmation must not mutate the original Contract snapshot');
  // Ngày kết thúc của đơn chính CHÍNH THỨC được cộng dồn sang ngày mới
  assert.equal(fakeReservation.endDate.toISOString(), targetNewEndDate.toISOString());

  const duplicateRes = mockResponse();
  await ReservationController.confirmExtension(req, duplicateRes);
  assert.equal(duplicateRes.statusCode, 400, 'an already ACTIVE Extension cannot be confirmed twice');
  assert.equal(fakeReservation.endDate.toISOString(), targetNewEndDate.toISOString(), 'duplicate confirm must not add the term again');

  assert.equal(fakeReservation.statusHistory.length, 1, 'replay must not append history');

  const secondExtensionId = new mongoose.Types.ObjectId(), secondPaymentId = new mongoose.Types.ObjectId();
  const secondEndDate = new Date('2027-05-01T00:00:00.000Z');
  fakeReservation.extendContract.push({ _id: secondExtensionId, extensionCode: 'EXT-SECOND-01', durationMonths: 3,
    amount: 2400000, status: 'PAID', paymentId: secondPaymentId, oldEndDate: targetNewEndDate, newEndDate: secondEndDate });
  const secondRes = mockResponse();
  await ReservationController.confirmExtension({ ...req, params: { id: String(reservationId), extensionId: String(secondExtensionId) } }, secondRes);
  assert.equal(secondRes.statusCode, 200);
  assert.equal(fakeReservation.extendContract[1].status, 'ACTIVE');
  assert.equal(fakeReservation.endDate.toISOString(), secondEndDate.toISOString(), 'a later Extension uses the prior activated end date');
});

test('Contract Extension: Staff cannot activate PAID state without verified and applied Renewal Payment', async t => {
  const reservationId = new mongoose.Types.ObjectId(), customerId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId(), extensionId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId(), staffId = new mongoose.Types.ObjectId();
  const initialEndDate = new Date('2027-01-01T00:00:00.000Z');
  const reservation = { _id: reservationId, customerId, facilityId, serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE, endDate: initialEndDate, statusHistory: [], extendContract: [{ _id: extensionId,
      paymentId, amount: 100000, status: 'PAID', oldEndDate: initialEndDate, newEndDate: new Date('2027-02-01T00:00:00.000Z') }] };
  const oldFind = ReservationModel.findById, oldPaymentFind = ReservationPaymentModel.findById;
  ReservationModel.findById = () => ({ then: resolve => resolve(reservation) });
  ReservationPaymentModel.findById = () => ({ where: () => ({ exec: async () => null }) });
  t.after(() => { ReservationModel.findById = oldFind; ReservationPaymentModel.findById = oldPaymentFind; });
  const res = mockResponse();
  await ReservationController.confirmExtension({ params: { id: String(reservationId), extensionId: String(extensionId) }, body: { paperProofUrl: 'https://proof.example/addendum' },
    user: { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: facilityId } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'VERIFIED_RENEWAL_PAYMENT_REQUIRED');
  assert.equal(reservation.extendContract[0].status, 'PAID');
  assert.equal(reservation.endDate.toISOString(), initialEndDate.toISOString());
});

test('Contract Extension: Staff assigned to another Facility cannot confirm the paper addendum', async t => {
  const reservationId = new mongoose.Types.ObjectId(), customerId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId(), otherFacilityId = new mongoose.Types.ObjectId();
  const extensionId = new mongoose.Types.ObjectId(), staffId = new mongoose.Types.ObjectId();
  const endDate = new Date('2027-01-01T00:00:00.000Z');
  const reservation = { _id: reservationId, customerId, facilityId, serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE, endDate, extendContract: [{ _id: extensionId, status: 'PAID', amount: 100000,
      oldEndDate: endDate, newEndDate: new Date('2027-02-01T00:00:00.000Z') }] };
  const originalFindById = ReservationModel.findById;
  ReservationModel.findById = () => ({ then: resolve => resolve(reservation) });
  t.after(() => { ReservationModel.findById = originalFindById; });
  const res = mockResponse();
  await ReservationController.confirmExtension({ params: { id: String(reservationId), extensionId: String(extensionId) },
    body: { paperProofUrl: 'https://proof.example/addendum' },
    user: { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: otherFacilityId } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(reservation.extendContract[0].status, 'PAID');
  assert.equal(reservation.endDate.toISOString(), endDate.toISOString());
});

test('Contract Extension: Staff từ chối gia hạn hợp đồng (REJECTED, giữ nguyên endDate cũ)', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const extensionId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const initialEndDate = new Date('2026-12-01T00:00:00.000Z');

  const fakeReservation = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    endDate: initialEndDate,
    statusHistory: [],
    extendContract: [
      {
        _id: extensionId,
        extensionCode: 'EXT-20261116-0002',
        durationMonths: 1,
        amount: 1200000,
        status: 'PAID',
        newEndDate: new Date('2027-01-01T00:00:00.000Z'),
      }
    ],
    async save() { return this; }
  };

  const origFindById = ReservationModel.findById;
  const origFindOne = ReservationModel.findOne;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });

  t.after(() => {
    ReservationModel.findById = origFindById;
  });

  const req = {
    params: { id: reservationId.toString(), extensionId: extensionId.toString() },
    body: { reason: 'Khách hàng đổi ý không muốn gia hạn tiếp' },
    user: { _id: staffId, role: 'FACILITY_STAFF' },
  };
  const res = mockResponse();

  await ReservationController.rejectExtension(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ext = fakeReservation.extendContract[0];
  assert.equal(ext.status, 'REJECTED');
  assert.equal(ext.rejectionReason, 'Khách hàng đổi ý không muốn gia hạn tiếp');
  // Ngày kết thúc vẫn giữ nguyên ngày cũ ban đầu
  assert.equal(fakeReservation.endDate.toISOString(), initialEndDate.toISOString());
});

test('Contract Extension: Quét SLA 3 ngày tự động hủy các yêu cầu gia hạn PAID quá hạn', async (t) => {
  const expiredExtensionId = new mongoose.Types.ObjectId();
  const fakeReservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'VS-999999',
    status: ReservationStatus.ACTIVE,
    serviceType: FacilityServiceType.SELF_STORAGE,
    statusHistory: [],
    extendContract: [
      {
        _id: expiredExtensionId,
        extensionCode: 'EXT-EXPIRED-001',
        status: 'PAID',
        amount: 1000000,
        signingDeadline: new Date(Date.now() - 24 * 60 * 60 * 1000), // Quá hạn 1 ngày
      }
    ],
    async save() { return this; }
  };

  const origFind = ReservationModel.find;
  ReservationModel.find = (filter) => {
    // Nếu tìm đơn chính (status: PAID) -> không có đơn nào
    if (filter && filter.status === ReservationStatus.PAID) {
      return {
        exec: async () => [],
        then: (resolve) => resolve([]),
      };
    }
    // Nếu tìm extension quá hạn
    return {
      exec: async () => [fakeReservation],
      then: (resolve) => resolve([fakeReservation]),
    };
  };

  const origContractUpdate = ContractModel.findOneAndUpdate;
  ContractModel.findOneAndUpdate = () => ({
    exec: async () => ({ success: true }),
    then: (resolve) => resolve({ success: true }),
  });

  t.after(() => {
    ReservationModel.find = origFind;
    ContractModel.findOneAndUpdate = origContractUpdate;
  });

  await checkSigningSla();

  const ext = fakeReservation.extendContract[0];
  assert.equal(ext.status, 'CANCELLED');
  assert.match(ext.rejectionReason, /SIGNING_SLA_EXPIRED/);
  // Đơn chính vẫn giữ nguyên ACTIVE
  assert.equal(fakeReservation.status, ReservationStatus.ACTIVE);
});
