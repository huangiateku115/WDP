const { test } = require('node:test');
const assert = require('node:assert/strict');
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
let requireRole;
let UserRole;
let ReservationStatus;
let VerificationStatus;

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
  requireRole = require('../dist/middlewares/auth/requireRole').requireRole;
  UserRole = require('../dist/types/user.type').UserRole;
  ReservationStatus = require('../dist/types/reservation.type').ReservationStatus;
  VerificationStatus = require('../dist/types/customer-profile.type').VerificationStatus;
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
  requireRole = require('../src/middlewares/auth/requireRole').requireRole;
  UserRole = require('../src/types/user.type').UserRole;
  ReservationStatus = require('../src/types/reservation.type').ReservationStatus;
  VerificationStatus = require('../src/types/customer-profile.type').VerificationStatus;
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

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31); // 30 ngày

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
// SUITE 4: CHỐNG TRÙNG LỊCH THUÊ KHO (OVERLAP BOOKING PROTECTION)
// =========================================================================

test('Suite 4.1: Chặn đặt trùng kho nếu đã có đơn khác chiếm dụng trong kỳ thuê (HTTP 409)', async t => {
  t.mock.method(CustomerProfileModel, 'findOne', () => ({
    exec: async () => ({ verificationStatus: 'VERIFIED' })
  }));

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1500000 })
  }));

  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => ({ _id: storageUnitId, size: 'SMALL', status: 'AVAILABLE' })
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

  t.mock.method(ReservationModel, 'findById', () => ({
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

  t.mock.method(ReservationModel, 'findById', () => ({
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

  t.mock.method(ReservationModel, 'findById', () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData
      })
    })
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: fmId, role: 'FACILITY_MANAGER' }
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
