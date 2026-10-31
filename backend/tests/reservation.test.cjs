const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  try {
    return originalLoad.apply(this, arguments);
  } catch (err) {
    if (request === 'sharp' && err && err.code === 'MODULE_NOT_FOUND') {
      return () => ({
        metadata: async () => ({ format: 'jpeg', width: 100, height: 100, pages: 1 }),
        stats: async () => ({}),
      });
    }
    throw err;
  }
};
require('dotenv').config = () => ({});

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URL: 'mongodb://localhost:27017/wdp-test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});

const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);

// Dynamic module loader (supports both dist and src environments)
let ReservationService, ReservationError;
let ReservationController;
let ReservationModel;
let PricingRuleModel;
let PolicyModel;
let CustomerProfileModel;
let StorageUnitModel;
let ContractModel;
let ContractController;
let ReservationPaymentModel;
let CloudinaryService;
let requireRole;
let UserRole;
let ReservationStatus;
let VerificationStatus;
let InspectionController;
let InspectionModel;
let FacilityModel;
let StorageUnitService;
let parseStorageUnitList;

try {
  const serviceMod = require('../dist/services/reservations/reservation.service');
  ReservationService = serviceMod.ReservationService;
  ReservationError = serviceMod.ReservationError;

  ReservationController = require('../dist/controllers/reservations/reservation.controller');
  ReservationModel = require('../dist/models/reservations/reservation.model').default;
  PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;
  PolicyModel = require('../dist/models/pricing-policy/policy.model').default;
  CustomerProfileModel = require('../dist/models/users/customer-profile.model').default;
  StorageUnitModel = require('../dist/models/storage-units/storage-unit.model').default;
  ContractModel = require('../dist/models/contracts/contract.model').default;
  ContractController = require('../dist/controllers/contracts/contract.controller');
  ReservationPaymentModel = require('../dist/models/payments/reservation-payment.model').default;
  CloudinaryService = require('../dist/services/upload/cloudinary.service').CloudinaryService;
  requireRole = require('../dist/middlewares/auth/requireRole').requireRole;
  UserRole = require('../dist/types/user.type').UserRole;
  ReservationStatus = require('../dist/types/reservation.type').ReservationStatus;
  VerificationStatus = require('../dist/types/customer-profile.type').VerificationStatus;
  InspectionController = require('../dist/controllers/inspections/inspection.controller');
  InspectionModel = require('../dist/models/inspections/inspection.model').default;
  FacilityModel = require('../dist/models/facilities/facility.model').default;
  StorageUnitService = require('../dist/services/storage-units/storage-unit.service').StorageUnitService;
  parseStorageUnitList = require('../dist/services/storage-units/storage-unit.validation').parseList;
} catch {
  // Direct TS fallback if tsx/ts-node runner is used
  const serviceMod = require('../src/services/reservations/reservation.service');
  ReservationService = serviceMod.ReservationService;
  ReservationError = serviceMod.ReservationError;

  ReservationController = require('../src/controllers/reservations/reservation.controller');
  ReservationModel = require('../src/models/reservations/reservation.model').default;
  PricingRuleModel = require('../src/models/pricing-policy/pricing-rule.model').default;
  PolicyModel = require('../src/models/pricing-policy/policy.model').default;
  CustomerProfileModel = require('../src/models/users/customer-profile.model').default;
  StorageUnitModel = require('../src/models/storage-units/storage-unit.model').default;
  ContractModel = require('../src/models/contracts/contract.model').default;
  ContractController = require('../src/controllers/contracts/contract.controller');
  ReservationPaymentModel = require('../src/models/payments/reservation-payment.model').default;
  CloudinaryService = require('../src/services/upload/cloudinary.service').CloudinaryService;
  requireRole = require('../src/middlewares/auth/requireRole').requireRole;
  UserRole = require('../src/types/user.type').UserRole;
  ReservationStatus = require('../src/types/reservation.type').ReservationStatus;
  VerificationStatus = require('../src/types/customer-profile.type').VerificationStatus;
  InspectionController = require('../src/controllers/inspections/inspection.controller');
  InspectionModel = require('../src/models/inspections/inspection.model').default;
  FacilityModel = require('../src/models/facilities/facility.model').default;
  StorageUnitService = require('../src/services/storage-units/storage-unit.service').StorageUnitService;
  parseStorageUnitList = require('../src/services/storage-units/storage-unit.validation').parseList;
}

// Helpers for mock Express req/res
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

const facilityId = new mongoose.Types.ObjectId();
const storageUnitId = new mongoose.Types.ObjectId();
const pricingPolicyId = new mongoose.Types.ObjectId();
const customerAId = new mongoose.Types.ObjectId();
const customerBId = new mongoose.Types.ObjectId();
const fmId = new mongoose.Types.ObjectId();

// =========================================================================
// SUITE 1: THUẬT TOÁN TÍNH GIÁ THUÊ & TIỀN CỌC (PRICING ENGINE)
// =========================================================================

test('Suite 1.1: calculatePricing tính chuẩn xác cho kỳ thuê 30 ngày (1 tháng)', async t => {
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  const startDate = new Date('2026-11-01T00:00:00.000Z');
  const endDate = new Date('2026-12-01T00:00:00.000Z'); // 30 ngày

  const result = await ReservationService.calculatePricing(pricingPolicyId.toString(), startDate, endDate);
  assert.equal(result.durationDays, 30);
  assert.equal(result.basePrice, 1500000);
  assert.equal(result.estimatedRent, 1500000); // (30/30) * 1.5tr
  assert.equal(result.depositAmount, 1500000); // Đủ 30 ngày -> cọc 100%
});

test('Suite 1.2: calculatePricing tính chuẩn cho kỳ thuê 15 ngày (< 30 ngày cọc 50%)', async t => {
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  const startDate = new Date('2026-11-01T00:00:00.000Z');
  const endDate = new Date('2026-11-16T00:00:00.000Z'); // 15 ngày

  const result = await ReservationService.calculatePricing(pricingPolicyId.toString(), startDate, endDate);
  assert.equal(result.durationDays, 15);
  assert.equal(result.estimatedRent, 750000); // (15/30) * 1.5tr = 750k
  assert.equal(result.depositAmount, 750000); // Dưới 30 ngày -> cọc 50% = 750k
});

test('Suite 1.3: calculatePricing tính chuẩn cho kỳ thuê 45 ngày (1.5 tháng)', async t => {
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  const startDate = new Date('2026-11-01T00:00:00.000Z');
  const endDate = new Date('2026-12-16T00:00:00.000Z'); // 45 ngày

  const result = await ReservationService.calculatePricing(pricingPolicyId.toString(), startDate, endDate);
  assert.equal(result.durationDays, 45);
  assert.equal(result.estimatedRent, 2250000); // (45/30) * 1.5tr = 2.25tr
  assert.equal(result.depositAmount, 1500000); // >= 30 ngày -> cọc 1 tháng = 1.5tr
});

test('Suite 1.4: calculatePricing chặn ngày không hợp lệ (endDate <= startDate)', async () => {
  const startDate = new Date('2026-11-10T00:00:00.000Z');
  const endDate = new Date('2026-11-05T00:00:00.000Z');

  await assert.rejects(
    () => ReservationService.calculatePricing(pricingPolicyId.toString(), startDate, endDate),
    err => err instanceof ReservationError && err.code === 400
  );
});

test('Suite 1.5: Controller estimateRent trả về cấu trúc response thực tế (không mock cứng)', async t => {
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  const req = {
    body: {
      pricingPolicyId: pricingPolicyId.toString(),
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2026-12-01T00:00:00.000Z'
    }
  };
  const res = mockResponse();

  await ReservationController.estimateRent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.estimatedRent, 1500000);
  assert.equal(res.body.data.depositAmount, 1500000);
  assert.equal(res.body.data.taxAmount, 0);
  assert.equal(res.body.data.durationDays, 30);
});

// =========================================================================
// SUITE 2: CỔNG XÁC MINH CCCD (CUSTOMER VERIFICATION GATE)
// =========================================================================

test('Suite 2.1: Chặn khách hàng chưa có CCCD (UNVERIFIED) tạo đơn đặt kho', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'UNVERIFIED' })
  }));

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31);

  await assert.rejects(
    () => ReservationService.createReservation({
      customerId: customerAId.toString(),
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart,
      endDate: futureEnd,
      pricingPolicyId: pricingPolicyId.toString()
    }),
    err => err instanceof ReservationError && err.code === 403 && err.message.includes('CCCD')
  );
});

test('Suite 2.2: Chặn khách hàng đang chờ duyệt CCCD (PENDING) tạo đơn đặt kho', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'PENDING' })
  }));

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31);

  await assert.rejects(
    () => ReservationService.createReservation({
      customerId: customerAId.toString(),
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart,
      endDate: futureEnd,
      pricingPolicyId: pricingPolicyId.toString()
    }),
    err => err instanceof ReservationError && err.code === 403
  );
});

// =========================================================================
// SUITE 3: CHỐNG GIAN LẬN GIÁ & TẠO ĐƠN (ANTI-TAMPERING)
// =========================================================================

test('Suite 3.1: createReservation bỏ qua số tiền Client gửi lên, tự tính đúng giá theo Pricing Rule', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, size: 'SMALL', status: 'AVAILABLE' })
  }));

  t.mock.method(ReservationModel, 'exists', () => ({
    session: () => ({
      exec: async () => null // Không bị overlap
    })
  }));

  let savedReservation = null;
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  t.mock.method(ReservationModel.prototype, 'save', async function() {
    savedReservation = this;
    return this;
  });

  const fixtureNow = Date.now();
  const futureStart = new Date(fixtureNow + 86400000);
  const futureEnd = new Date(fixtureNow + 86400000 * 31); // exactly 30 days between start and end

  // Hacker gửi estimatedRent = 1 VNĐ, depositAmount = 1 VNĐ
  const req = {
    user: { _id: customerAId, role: 'CUSTOMER' },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
      estimatedRent: 1,     // Cố tình gian lận
      depositAmount: 1      // Cố tình gian lận
    }
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);

  // Số tiền lưu phải là 1,500,000 VNĐ, không bao giờ nhận 1 VNĐ
  assert.equal(savedReservation.estimatedRent, 1500000);
  assert.equal(savedReservation.depositAmount, 1500000);
  assert.ok(savedReservation.reservationCode.startsWith('BKG-'));
  assert.ok(savedReservation.expiresAt instanceof Date);
});

// =========================================================================
// SUITE 4: CHỐNG TRÙNG LỊCH THUÊ KHO & GỢI Ý KHO THAY THẾ (OVERLAP & SUGGESTIONS)
// =========================================================================

test('Suite 4.1: Chặn đặt trùng kho nếu đã có đơn khác chiếm dụng trong kỳ thuê (HTTP 409)', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' })
  }));

  // Giả lập phát hiện có đơn trùng
  t.mock.method(ReservationModel, 'exists', () => ({
    session: () => ({
      exec: async () => ({ _id: new mongoose.Types.ObjectId() })
    })
  }));

  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31);

  await assert.rejects(
    () => ReservationService.createReservation({
      customerId: customerAId.toString(),
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart,
      endDate: futureEnd,
      pricingPolicyId: pricingPolicyId.toString()
    }),
    err => err instanceof ReservationError && err.code === 409 && err.message.includes('đã có người đặt')
  );
});

test('Suite 4.2: Customer B đặt cùng kho A-01 sau thời gian thuê của Customer A (không trùng ngày) -> Thành công (HTTP 201)', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' })
  }));

  // Đơn của Customer A thuê từ ngày +5 đến ngày +15 (đang ACTIVE hoặc DEPOSIT_PAID)
  const existingBookings = [
    {
      _id: new mongoose.Types.ObjectId(),
      storageUnitId,
      startDate: new Date(Date.now() + 86400000 * 5),
      endDate: new Date(Date.now() + 86400000 * 15),
      status: ReservationStatus.ACTIVE,
    }
  ];

  // Kiểm tra thực tế điều kiện toán học startDate < endDate_B && endDate > startDate_B
  t.mock.method(ReservationModel, 'exists', (query) => ({
    session: () => ({
      exec: async () => {
        const reqEnd = query.startDate.$lt;
        const reqStart = query.endDate.$gt;
        const match = existingBookings.find(
          b => b.storageUnitId.equals(query.storageUnitId) && b.startDate < reqEnd && b.endDate > reqStart
        );
        return match ? { _id: match._id } : null;
      }
    })
  }));

  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  t.mock.method(ReservationModel.prototype, 'save', async function() {
    return this;
  });

  // Customer B đặt từ ngày +16 đến ngày +46 (sau khi phiên thuê của Customer A kết thúc)
  const bStart = new Date(Date.now() + 86400000 * 16);
  const bEnd = new Date(Date.now() + 86400000 * 46);

  const req = {
    user: { _id: customerBId, role: 'CUSTOMER' },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: bStart.toISOString(),
      endDate: bEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    }
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.storageUnitId.toString(), storageUnitId.toString());
});

test('Suite 4.3: Khi trùng lịch thuê, trả về HTTP 409 kèm message chi tiết và danh sách kho gợi ý (ưu tiên cùng size)', async t => {
  const unitA01 = storageUnitId;
  const unitA02 = new mongoose.Types.ObjectId(); // Cùng size SMALL, đang trống
  const unitA03 = new mongoose.Types.ObjectId(); // Cùng size SMALL, nhưng cũng đã có người đặt trùng ngày
  const unitB01 = new mongoose.Types.ObjectId(); // Khác size MEDIUM, đang trống
  const unitM01 = new mongoose.Types.ObjectId(); // Đang bảo trì MAINTENANCE

  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: unitA01, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' })
  }));

  // Phát hiện A-01 bị trùng lịch
  t.mock.method(ReservationModel, 'exists', () => ({
    session: () => ({
      exec: async () => ({ _id: new mongoose.Types.ObjectId() })
    })
  }));

  // Trong khoảng thời gian này, A-01 và A-03 đang có đơn đặt chiếm chỗ
  t.mock.method(ReservationModel, 'find', () => ({
    session() { return this; },
    select() { return this; },
    lean() { return this; },
    exec: async () => [
      { storageUnitId: unitA01 },
      { storageUnitId: unitA03 },
    ]
  }));

  // Danh sách các kho trong cơ sở
  t.mock.method(StorageUnitModel, 'find', () => ({
    session() { return this; },
    select() { return this; },
    lean() { return this; },
    exec: async () => [
      { _id: unitB01, unitCode: 'B-01', size: 'MEDIUM', volumeM3: 48, status: 'AVAILABLE' },
      { _id: unitA02, unitCode: 'A-02', size: 'SMALL', volumeM3: 24, status: 'AVAILABLE' },
      { _id: unitA03, unitCode: 'A-03', size: 'SMALL', volumeM3: 24, status: 'AVAILABLE' }, // Bị trùng lịch -> phải bị lọc bỏ
      { _id: unitM01, unitCode: 'M-01', size: 'SMALL', volumeM3: 24, status: 'MAINTENANCE' }, // Bảo trì -> phải bị lọc bỏ
    ]
  }));

  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  const futureStart = new Date(Date.now() + 86400000 * 5);
  const futureEnd = new Date(Date.now() + 86400000 * 20);

  const req = {
    user: { _id: customerBId, role: 'CUSTOMER' },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: unitA01.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    }
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('Kho A-01 đã có người đặt'));
  assert.ok(res.body.message.includes('Gợi ý các kho khả dụng khác'));
  assert.ok(res.body.message.includes('A-02 (SMALL)'));
  assert.ok(res.body.message.includes('B-01 (MEDIUM)'));

  // Kiểm tra mảng suggestedUnits: chỉ chứa A-02 và B-01 (đã loại A-03 và M-01), A-02 (cùng size SMALL) đứng đầu
  assert.ok(Array.isArray(res.body.suggestedUnits));
  assert.equal(res.body.suggestedUnits.length, 2);
  assert.equal(res.body.suggestedUnits[0].unitCode, 'A-02');
  assert.equal(res.body.suggestedUnits[0].sameSize, true);
  assert.equal(res.body.suggestedUnits[1].unitCode, 'B-01');
  assert.equal(res.body.suggestedUnits[1].sameSize, false);
});

test('Suite 4.4: buildOverlapFilter bao gồm cả DEPOSIT_PAID và CHECKIN_READY trong các trạng thái giữ lịch cứng', () => {
  const start = new Date('2026-11-01T00:00:00.000Z');
  const end = new Date('2026-11-15T00:00:00.000Z');
  const filter = ReservationService.buildOverlapFilter(start, end);

  assert.ok(filter.status.$in.includes(ReservationStatus.DEPOSIT_PAID));
  assert.ok(filter.status.$in.includes(ReservationStatus.CHECKIN_READY));
  assert.ok(filter.status.$in.includes(ReservationStatus.PAID));
  assert.ok(filter.status.$in.includes(ReservationStatus.ACTIVE));
  assert.ok(filter.$or[0].status.$in.includes(ReservationStatus.DEPOSIT_PAID));
  assert.ok(filter.$or[0].status.$in.includes(ReservationStatus.CHECKIN_READY));
});

test('Suite 4.5: Customer B đặt cùng kho A-01 TRƯỚC kỳ thuê của Customer A (hoặc sát biên liền kề endDate_B === startDate_A) -> Thành công (HTTP 201)', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' })
  }));

  // Customer A đã đặt trước cho tương lai từ ngày +20 đến ngày +50
  const baseTime = Date.now();
  const aStart = new Date(baseTime + 86400000 * 20);
  const aEnd = new Date(baseTime + 86400000 * 50);

  t.mock.method(ReservationModel, 'exists', (query) => ({
    session: () => ({
      exec: async () => {
        const reqEnd = query.startDate.$lt;
        const reqStart = query.endDate.$gt;
        const isOverlap = aStart < reqEnd && aEnd > reqStart;
        return isOverlap ? { _id: new mongoose.Types.ObjectId() } : null;
      }
    })
  }));

  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  t.mock.method(ReservationModel.prototype, 'save', async function() {
    return this;
  });

  // Customer B đặt từ ngày +5 đến đúng thời điểm ngày +20 (endDate_B === startDate_A -> không giao cắt)
  const bStart = new Date(baseTime + 86400000 * 5);
  const bEnd = aStart;

  const req = {
    user: { _id: customerBId, role: 'CUSTOMER' },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: bStart.toISOString(),
      endDate: bEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    }
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
});

test('Suite 4.6: Khi trùng lịch và toàn bộ các kho khác trong cơ sở cũng đã hết chỗ trong khoảng ngày đó -> Trả về HTTP 409 với suggestedUnits rỗng', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' })
  }));

  t.mock.method(ReservationModel, 'exists', () => ({
    session: () => ({
      exec: async () => ({ _id: new mongoose.Types.ObjectId() })
    })
  }));

  t.mock.method(ReservationModel, 'find', () => ({
    session() { return this; },
    select() { return this; },
    lean() { return this; },
    exec: async () => [{ storageUnitId }]
  }));

  // Cơ sở không còn kho trống nào khác
  t.mock.method(StorageUnitModel, 'find', () => ({
    session() { return this; },
    select() { return this; },
    lean() { return this; },
    exec: async () => []
  }));

  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  const futureStart = new Date(Date.now() + 86400000 * 5);
  const futureEnd = new Date(Date.now() + 86400000 * 20);

  const req = {
    user: { _id: customerBId, role: 'CUSTOMER' },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    }
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('không còn kho trống nào khác'));
  assert.deepEqual(res.body.suggestedUnits, []);
});

test('Suite 4.7: Đơn RESERVED đã quá hạn (expiresAt <= now) không chặn khách sau, nhưng đơn DEPOSIT_PAID thì chặn cứng', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' })
  }));

  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {}
  }));

  t.mock.method(ReservationModel.prototype, 'save', async function() {
    return this;
  });

  // Giả lập DB có 1 đơn RESERVED đã hết hạn 1 tiếng trước
  const expiredReservation = {
    _id: new mongoose.Types.ObjectId(),
    storageUnitId,
    startDate: new Date(Date.now() + 86400000 * 5),
    endDate: new Date(Date.now() + 86400000 * 20),
    status: ReservationStatus.RESERVED,
    expiresAt: new Date(Date.now() - 3600000), // Đã hết hạn
  };

  let dbRecords = [expiredReservation];

  t.mock.method(ReservationModel, 'exists', (query) => ({
    session: () => ({
      exec: async () => {
        const reqEnd = query.startDate.$lt;
        const reqStart = query.endDate.$gt;
        const committedStatuses = query.$or[0].status.$in;
        const tempStatuses = query.$or[1].status.$in;
        const minExpiresAt = query.$or[1].expiresAt.$gt;

        const found = dbRecords.find(r => {
          const timeOverlap = r.startDate < reqEnd && r.endDate > reqStart;
          if (!timeOverlap) return false;
          if (committedStatuses.includes(r.status)) return true;
          if (tempStatuses.includes(r.status) && r.expiresAt && r.expiresAt > minExpiresAt) return true;
          return false;
        });
        return found ? { _id: found._id } : null;
      }
    })
  }));

  const futureStart = new Date(Date.now() + 86400000 * 5);
  const futureEnd = new Date(Date.now() + 86400000 * 20);

  // Trường hợp 1: Đơn cũ là RESERVED nhưng đã hết hạn -> Customer B đặt trùng ngày vẫn THÀNH CÔNG (201)
  const req1 = {
    user: { _id: customerBId, role: 'CUSTOMER' },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    }
  };
  const res1 = mockResponse();
  await ReservationController.createReservation(req1, res1);
  assert.equal(res1.statusCode, 201);

  // Trường hợp 2: Đơn cũ đã chuyển sang DEPOSIT_PAID (không còn expiresAt) -> Customer B bị CHẶN (409)
  dbRecords = [
    {
      _id: new mongoose.Types.ObjectId(),
      storageUnitId,
      startDate: futureStart,
      endDate: futureEnd,
      status: ReservationStatus.DEPOSIT_PAID,
      expiresAt: undefined,
    }
  ];
  const res2 = mockResponse();
  await ReservationController.createReservation(req1, res2);
  assert.equal(res2.statusCode, 409);
});

// =========================================================================
// SUITE 5: PHÂN QUYỀN CHÉO XEM ĐƠN & THANH TOÁN (AUTHORIZATION & PRIVACY)
// =========================================================================

test('Suite 5.1: Khách hàng A xem chi tiết đơn của chính mình -> Thành công (HTTP 200)', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    storageUnitId,
    status: 'RESERVED'
  };

  t.mock.method(ReservationModel, 'findOne', () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData
      })
    })
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: 'CUSTOMER' }
  };
  const res = mockResponse();

  await ReservationController.getReservationById(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data._id.toString(), reservationData._id.toString());
});

test('Suite 5.2: Khách hàng B xem trộm đơn của Khách hàng A -> Bị chặn 403 "Bạn không có đủ quyền truy cập!"', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId, // Đơn thuộc về Khách A
    facilityId,
    storageUnitId
  };

  t.mock.method(ReservationModel, 'findOne', () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData
      })
    })
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerBId, role: 'CUSTOMER' } // Khách B xem trộm
  };
  const res = mockResponse();

  await ReservationController.getReservationById(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Bạn không có đủ quyền truy cập!');
});

test('Suite 5.3: Khách hàng B cố tình thanh toán đơn của Khách hàng A -> Bị chặn 403 "Bạn không có đủ quyền truy cập!"', async t => {
  const reservationId = new mongoose.Types.ObjectId();

  // Đơn thuộc về Khách A
  t.mock.method(ReservationModel, 'findOneAndUpdate', async () => null);
  t.mock.method(ReservationModel, 'findById', async () => ({
    _id: reservationId,
    customerId: customerAId,
    status: 'CONTRACTED'
  }));

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: customerBId, role: 'CUSTOMER' } // Khách B gọi mock-pay
  };
  const res = mockResponse();

  await ReservationController.mockPayReservation(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Bạn không có đủ quyền truy cập!');
});

test('Suite 5.4: Quản lý (FM) xem đơn của Khách hàng bất kỳ -> Thành công (HTTP 200)', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    storageUnitId
  };

  t.mock.method(ReservationModel, 'findOne', () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData
      })
    })
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: fmId, role: 'FACILITY_MANAGER', assignedFacilityId: facilityId }
  };
  const res = mockResponse();

  await ReservationController.getReservationById(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

// =========================================================================
// SUITE 6: PHÂN QUYỀN MIDDLEWARE requireRole TOÀN HỆ THỐNG
// =========================================================================

test('Suite 6.1: requireRole chặn Customer gọi API Quản lý với thông báo "Bạn không có đủ quyền truy cập!"', () => {
  const guard = requireRole(['FACILITY_MANAGER', 'ADMIN']);
  const req = { user: { _id: customerAId, role: 'CUSTOMER' } };
  const res = mockResponse();
  let nextCalled = false;

  guard(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Bạn không có đủ quyền truy cập!');
});

test('Suite 6.2: requireRole cho phép đúng role vượt qua', () => {
  const guard = requireRole(['CUSTOMER']);
  const req = { user: { _id: customerAId, role: 'CUSTOMER' } };
  const res = mockResponse();
  let nextCalled = false;

  guard(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

// =========================================================================
// SUITE 7: LUỒNG THỐNG NHẤT (2 ĐỢT THANH TOÁN + BẰNG CHỨNG HỢP ĐỒNG CLOUDINARY)
// =========================================================================

test('Suite 7.1: initiateDeposit tính toán số tiền cọc chuẩn xác từ breakdown', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    status: ReservationStatus.RESERVED,
    estimatedRent: 1500000,
    depositAmount: 1500000,
    taxAmount: 0,
    discountAmount: 0,
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationData);

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: 'CUSTOMER' }
  };
  const res = mockResponse();

  await ReservationController.initiateDeposit(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.purpose, 'DEPOSIT');
  assert.equal(res.body.data.amount, 1500000);
  assert.equal(res.body.data.breakdown.depositCredit, 1500000);
  assert.equal(res.body.data.breakdown.balanceDue, 0);
});

test('Suite 7.2: confirmMockDeposit chuyển sang DEPOSIT_PAID, tạo payment DEPOSIT và tự động sinh Contract DRAFT', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-TEST-1234',
    customerId: customerAId,
    facilityId,
    serviceType: 'SELF_STORAGE',
    status: ReservationStatus.RESERVED,
    estimatedRent: 1500000,
    depositAmount: 1500000,
    taxAmount: 0,
    discountAmount: 0,
    pricingPolicyId,
    statusHistory: [],
    save: async () => reservationData,
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(ReservationPaymentModel, 'create', async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
  t.mock.method(ContractModel, 'findOne', async () => null);
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    populate: async () => ({
      identityCard: '012345678901',
      address: 'Hà Nội',
      userId: { fullName: 'Nguyễn Văn A', email: 'a@test.com', phone: '0901234567' }
    })
  }));
  let createdContract = null;
  t.mock.method(ContractModel, 'create', async (doc) => {
    createdContract = doc;
    return doc;
  });

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: 'CUSTOMER' }
  };
  const res = mockResponse();

  await ReservationController.confirmMockDeposit(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationData.status, ReservationStatus.DEPOSIT_PAID);
  assert.ok(createdContract !== null);
  assert.equal(createdContract.status, 'DRAFT');
  assert.equal(createdContract.customerSnapshot.identityCard, '012345678901');
});

test('Suite 7.3: Khách hàng gọi initiateBalance khi Staff chưa upload ảnh bằng chứng hợp đồng giấy -> Bị chặn 409', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    status: ReservationStatus.DEPOSIT_PAID,
    estimatedRent: 3000000,
    depositAmount: 1500000,
    taxAmount: 0,
    discountAmount: 0,
  };

  const draftContract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservationData._id,
    status: 'DRAFT',
    signedProofUrl: undefined // Chưa có ảnh bằng chứng
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(ContractModel, 'findOne', async () => draftContract);

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: 'CUSTOMER' }
  };
  const res = mockResponse();

  await ReservationController.initiateBalance(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('Staff xác nhận'));
});

test('Suite 7.4: Staff upload ảnh chụp hợp đồng giấy lên Cloudinary thành công -> Hợp đồng chuyển SIGNED, đơn sang CHECKIN_READY', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    status: ReservationStatus.DEPOSIT_PAID,
    statusHistory: [],
    save: async () => reservationData,
  };

  const contractData = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservationData._id,
    status: 'DRAFT',
    save: async () => contractData,
  };

  t.mock.method(ContractModel, 'findById', async () => contractData);
  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(CloudinaryService, 'uploadBuffer', async () => ({
    secureUrl: 'https://res.cloudinary.com/test/image/upload/v1/wdp/signed-contracts/sample.jpg',
    publicId: 'wdp/signed-contracts/sample',
    format: 'jpg'
  }));

  const req = {
    params: { id: contractData._id.toString() },
    user: { _id: fmId, role: 'FACILITY_STAFF' },
    file: { buffer: Buffer.from('fake image data') },
    body: { paperContractNumber: 'HĐ-2026-001' }
  };
  const res = mockResponse();

  await ContractController.confirmSignedPaper(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(contractData.status, 'SIGNED');
  assert.equal(contractData.signedProofUrl, 'https://res.cloudinary.com/test/image/upload/v1/wdp/signed-contracts/sample.jpg');
  assert.equal(reservationData.status, ReservationStatus.CHECKIN_READY);
});

test('Suite 7.5: Khách hàng nộp Balance thành công sau khi có bằng chứng -> Trừ cọc chuẩn xác, đơn sang PAID', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: 'SELF_STORAGE',
    status: ReservationStatus.CHECKIN_READY,
    estimatedRent: 3000000,
    depositAmount: 1500000, // Cọc 1.5tr
    taxAmount: 0,
    discountAmount: 0,
    statusHistory: [],
    save: async () => reservationData,
  };

  const signedContract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservationData._id,
    status: 'SIGNED',
    signedProofUrl: 'https://res.cloudinary.com/test/image/upload/v1/wdp/signed-contracts/sample.jpg'
  };

  let createdPayment = null;
  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(ContractModel, 'findOne', async () => signedContract);
  t.mock.method(ReservationPaymentModel, 'create', async (doc) => {
    createdPayment = doc;
    return doc;
  });

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: 'CUSTOMER' }
  };
  const res = mockResponse();

  await ReservationController.confirmMockBalance(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationData.status, ReservationStatus.PAID);
  assert.equal(createdPayment.purpose, 'BALANCE');
  assert.equal(createdPayment.amount, 1500000); // 3tr - 1.5tr cọc = 1.5tr
});

test('Suite 7.6: Staff thực hiện Handover sau khi đã thanh toán Balance (PAID) -> Đơn sang ACTIVE, không khóa cứng Unit sang OCCUPIED, trả về PIN 1234', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    storageUnitId,
    status: ReservationStatus.PAID,
    statusHistory: [],
    save: async () => reservationData,
  };

  let unitStatusOverwritten = false;
  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', async () => {
    unitStatusOverwritten = true;
    return {};
  });

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: fmId, role: 'FACILITY_STAFF' }
  };
  const res = mockResponse();

  await ReservationController.handoverReservation(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationData.status, ReservationStatus.ACTIVE);
  assert.equal(unitStatusOverwritten, false);
  assert.equal(res.body.data.pinCode, '1234');
});

test('Suite 7.7: Chặn Handover nếu đơn chưa hoàn tất thanh toán Balance (chưa PAID)', async t => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    status: ReservationStatus.DEPOSIT_PAID, // Chưa trả Balance
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationData);

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: fmId, role: 'FACILITY_STAFF' }
  };
  const res = mockResponse();

  await ReservationController.handoverReservation(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes('PAID'));
});

test('Suite 7.8: Nghiệm thu completeInspection (CHECK_IN không khóa cứng StorageUnit sang OCCUPIED; CHECK_OUT DAMAGED chuyển sang MAINTENANCE)', async t => {
  const inspectionId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  // 1. Kịch bản CHECK_IN
  t.mock.method(InspectionModel, 'findById', async () => ({
    _id: inspectionId,
    reservationId,
  }));
  t.mock.method(ReservationModel, 'findById', () => ({
    select: () => ({
      exec: async () => ({ serviceType: 'SELF_STORAGE' })
    })
  }));
  t.mock.method(InspectionModel, 'findOneAndUpdate', async () => ({
    _id: inspectionId,
    reservationId,
    storageUnitId,
    type: 'CHECK_IN',
    status: 'COMPLETED',
  }));

  let reservationUpdatedStatus = null;
  let unitUpdatedPayload = null;
  t.mock.method(ReservationModel, 'findByIdAndUpdate', async (_id, update) => {
    reservationUpdatedStatus = update.status;
    return {};
  });
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', async (_id, update) => {
    unitUpdatedPayload = update;
    return {};
  });

  const reqCheckIn = {
    params: { id: inspectionId.toString() },
    user: { _id: fmId, role: 'FACILITY_STAFF' }
  };
  const resCheckIn = mockResponse();

  await InspectionController.completeInspection(reqCheckIn, resCheckIn);
  assert.equal(resCheckIn.statusCode, 200);
  assert.equal(reservationUpdatedStatus, ReservationStatus.ACTIVE);
  // Tuyệt đối không ghi đè StorageUnit.status = 'OCCUPIED' khi CHECK_IN
  assert.equal(unitUpdatedPayload, null);

  // 2. Kịch bản CHECK_OUT với condition = DAMAGED -> chuyển StorageUnit sang MAINTENANCE
  t.mock.method(InspectionModel, 'findOneAndUpdate', async () => ({
    _id: inspectionId,
    reservationId,
    storageUnitId,
    type: 'CHECK_OUT',
    condition: 'DAMAGED',
    status: 'COMPLETED',
  }));

  const resCheckOut = mockResponse();
  await InspectionController.completeInspection(reqCheckIn, resCheckOut);
  assert.equal(resCheckOut.statusCode, 200);
  assert.equal(reservationUpdatedStatus, ReservationStatus.CHECKED_OUT);
  assert.equal(unitUpdatedPayload.status, 'MAINTENANCE');
});

// =========================================================================
// SUITE 8: TRA CỨU DANH SÁCH KHO TỰ QUẢN THEO KHOẢNG THỜI GIAN (STORAGE UNIT DATE RANGE)
// =========================================================================

test('Suite 8.1: StorageUnitService.getStorageUnits truyền startDate & endDate đánh dấu đúng isAvailableInRange và lọc availableOnly', async t => {
  const facId = facilityId.toString();
  const unit1 = new mongoose.Types.ObjectId(); // Đang bị đặt trong khoảng ngày
  const unit2 = new mongoose.Types.ObjectId(); // Đang trống trong khoảng ngày

  t.mock.method(FacilityModel, 'findOne', () => ({
    exec: async () => ({ _id: facilityId, status: 'ACTIVE', serviceTypes: ['SELF_STORAGE'] })
  }));

  // Giả lập unit1 đang có đơn thuê trong khoảng ngày查询
  t.mock.method(ReservationModel, 'find', () => ({
    select() { return this; },
    lean() { return this; },
    exec: async () => [{ storageUnitId: unit1 }]
  }));

  let capturedUnitFilter = null;
  t.mock.method(StorageUnitModel, 'find', (filter) => {
    capturedUnitFilter = filter;
    return {
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean() { return this; },
      exec: async () => [
        { _id: unit1, unitCode: 'A-01', size: 'SMALL', status: 'AVAILABLE' },
        { _id: unit2, unitCode: 'A-02', size: 'SMALL', status: 'AVAILABLE' },
      ].filter(u => !filter._id?.$nin || !filter._id.$nin.some(id => id.equals(u._id)))
    };
  });
  t.mock.method(StorageUnitModel, 'countDocuments', () => ({
    exec: async () => 2
  }));

  // 1. Khi không bật availableOnly -> Trả về cả 2 kho kèm cờ isAvailableInRange
  const listAll = await StorageUnitService.getStorageUnits(
    facId,
    { startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-15T00:00:00.000Z' },
    { role: 'CUSTOMER', _id: customerBId }
  );
  assert.equal(listAll.data.length, 2);
  assert.equal(listAll.data[0].unitCode, 'A-01');
  assert.equal(listAll.data[0].isAvailableInRange, false);
  assert.equal(listAll.data[1].unitCode, 'A-02');
  assert.equal(listAll.data[1].isAvailableInRange, true);

  // 2. Khi bật availableOnly = 'true' -> Chỉ trả về kho A-02 còn trống
  const listAvailableOnly = await StorageUnitService.getStorageUnits(
    facId,
    { startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-15T00:00:00.000Z', availableOnly: 'true' },
    { role: 'CUSTOMER', _id: customerBId }
  );
  assert.equal(capturedUnitFilter.status, 'AVAILABLE');
  assert.equal(listAvailableOnly.data.length, 1);
  assert.equal(listAvailableOnly.data[0].unitCode, 'A-02');
  assert.equal(listAvailableOnly.data[0].isAvailableInRange, true);
});

test('Suite 8.2: parseList của StorageUnit chặn khoảng ngày không hợp lệ (thiếu endDate hoặc endDate <= startDate)', () => {
  assert.throws(
    () => parseStorageUnitList({ startDate: '2026-11-01T00:00:00.000Z' }),
    err => err.status === 400
  );
  assert.throws(
    () => parseStorageUnitList({ startDate: '2026-11-15T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z' }),
    err => err.status === 400
  );
});
