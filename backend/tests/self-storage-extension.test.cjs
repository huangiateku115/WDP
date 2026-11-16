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

  assert.equal(res.statusCode, 400);
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
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });

  const origStorageUnit = StorageUnitModel.findById;
  StorageUnitModel.findById = () => ({
    exec: async () => ({ _id: storageUnitId, status: 'OCCUPIED', facilityId }),
    then: (resolve) => resolve({ _id: storageUnitId, status: 'OCCUPIED', facilityId }),
  });

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
    PricingRuleModel.findById = origPricingRule;
    PricingRuleModel.findOne = origPricingRuleFindOne;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 2 },
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
});

test('Contract Extension: Dev Mock Pay Bypass thành công (PAID, SLA 3 ngày)', async (t) => {
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
  const origFindOne = ReservationModel.findOne;
  ReservationModel.findById = () => ({
    exec: async () => fakeReservation,
    then: (resolve) => resolve(fakeReservation),
  });
  ReservationModel.findOne = () => ({
    exec: async () => null,
    then: (resolve) => resolve(null),
  });

  const origPaymentCreate = ReservationPaymentModel.create;
  ReservationPaymentModel.create = async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc });

  t.after(() => {
    ReservationModel.findById = origFindById;
    ReservationPaymentModel.create = origPaymentCreate;
  });

  const req = {
    params: { id: reservationId.toString() },
    body: { extensionId: extensionId.toString() },
    user: { _id: customerId, role: 'CUSTOMER' },
  };
  const res = mockResponse();

  await ReservationController.mockPayExtension(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ext = fakeReservation.extendContract[0];
  assert.equal(ext.status, 'PAID');
  assert.ok(ext.signingDeadline instanceof Date);
  const diffDays = Math.round((ext.signingDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  assert.equal(diffDays, 3);
  // Đơn chính vẫn giữ nguyên ACTIVE
  assert.equal(fakeReservation.status, ReservationStatus.ACTIVE);
});

test('Contract Extension: Staff tải ảnh phụ lục & Xác nhận gia hạn thành công (cộng dồn endDate)', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const extensionId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const initialEndDate = new Date('2026-12-01T00:00:00.000Z');
  const targetNewEndDate = new Date('2027-02-01T00:00:00.000Z');

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
        extensionCode: 'EXT-20261116-0001',
        durationMonths: 2,
        amount: 2400000,
        status: 'PAID',
        newEndDate: targetNewEndDate,
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

  const origContractUpdate = ContractModel.findOneAndUpdate;
  ContractModel.findOneAndUpdate = () => ({
    exec: async () => ({ success: true })
  });

  t.after(() => {
    ReservationModel.findById = origFindById;
    ContractModel.findOneAndUpdate = origContractUpdate;
  });

  const req = {
    params: { id: reservationId.toString(), extensionId: extensionId.toString() },
    body: { paperProofUrl: 'https://res.cloudinary.com/test/image/upload/v1/extension_proof.jpg' },
    user: { _id: staffId, role: 'FACILITY_STAFF' },
  };
  const res = mockResponse();

  await ReservationController.confirmExtension(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ext = fakeReservation.extendContract[0];
  assert.equal(ext.status, 'ACTIVE');
  assert.equal(ext.paperProofUrl, 'https://res.cloudinary.com/test/image/upload/v1/extension_proof.jpg');
  assert.equal(ext.verifiedBy.toString(), staffId.toString());
  // Ngày kết thúc của đơn chính CHÍNH THỨC được cộng dồn sang ngày mới
  assert.equal(fakeReservation.endDate.toISOString(), targetNewEndDate.toISOString());
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
