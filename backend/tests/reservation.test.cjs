const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  try {
    return originalLoad.apply(this, arguments);
  } catch (err) {
    if (request === "sharp" && err && err.code === "MODULE_NOT_FOUND") {
      return () => ({
        metadata: async () => ({
          format: "jpeg",
          width: 100,
          height: 100,
          pages: 1,
        }),
        stats: async () => ({}),
      });
    }
    throw err;
  }
};
require("dotenv").config = () => ({});

Object.assign(process.env, {
  NODE_ENV: "test",
  MONGO_URL: "mongodb://localhost:27017/wdp-test",
  KEYCLOAK_BASE_URL: "http://localhost:8081",
  KEYCLOAK_REALM: "wdp-realm",
  KEYCLOAK_CLIENT_ID: "wdp-backend",
  KEYCLOAK_CLIENT_SECRET: "test-only",
  KEYCLOAK_ISSUER: "http://localhost:8081/realms/wdp-realm",
  KEYCLOAK_JWKS_URI:
    "http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs",
});

const mongoose = require("mongoose");
mongoose.set("bufferCommands", false);

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
let ManagedReservationAuditModel;
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
  const serviceMod = require("../dist/services/reservations/reservation.service");
  ReservationService = serviceMod.ReservationService;
  ReservationError = serviceMod.ReservationError;

  ReservationController = require("../dist/controllers/reservations/reservation.controller");
  ReservationModel =
    require("../dist/models/reservations/reservation.model").default;
  PricingRuleModel =
    require("../dist/models/pricing-policy/pricing-rule.model").default;
  PolicyModel = require("../dist/models/pricing-policy/policy.model").default;
  CustomerProfileModel =
    require("../dist/models/users/customer-profile.model").default;
  StorageUnitModel =
    require("../dist/models/storage-units/storage-unit.model").default;
  ContractModel = require("../dist/models/contracts/contract.model").default;
  ContractController = require("../dist/controllers/contracts/contract.controller");
  ReservationPaymentModel =
    require("../dist/models/payments/reservation-payment.model").default;
  ManagedReservationAuditModel =
    require("../dist/models/reservations/managed-reservation-audit.model").default;
  CloudinaryService =
    require("../dist/services/upload/cloudinary.service").CloudinaryService;
  requireRole = require("../dist/middlewares/auth/requireRole").requireRole;
  UserRole = require("../dist/types/user.type").UserRole;
  ReservationStatus =
    require("../dist/types/reservation.type").ReservationStatus;
  VerificationStatus =
    require("../dist/types/customer-profile.type").VerificationStatus;
  InspectionController = require("../dist/controllers/inspections/inspection.controller");
  InspectionModel =
    require("../dist/models/inspections/inspection.model").default;
  FacilityModel = require("../dist/models/facilities/facility.model").default;
  StorageUnitService =
    require("../dist/services/storage-units/storage-unit.service").StorageUnitService;
  parseStorageUnitList =
    require("../dist/services/storage-units/storage-unit.validation").parseList;
} catch {
  // Direct TS fallback if tsx/ts-node runner is used
  const serviceMod = require("../src/services/reservations/reservation.service");
  ReservationService = serviceMod.ReservationService;
  ReservationError = serviceMod.ReservationError;

  ReservationController = require("../src/controllers/reservations/reservation.controller");
  ReservationModel =
    require("../src/models/reservations/reservation.model").default;
  PricingRuleModel =
    require("../src/models/pricing-policy/pricing-rule.model").default;
  PolicyModel = require("../src/models/pricing-policy/policy.model").default;
  CustomerProfileModel =
    require("../src/models/users/customer-profile.model").default;
  StorageUnitModel =
    require("../src/models/storage-units/storage-unit.model").default;
  ContractModel = require("../src/models/contracts/contract.model").default;
  ContractController = require("../src/controllers/contracts/contract.controller");
  ReservationPaymentModel =
    require("../src/models/payments/reservation-payment.model").default;
  ManagedReservationAuditModel =
    require("../src/models/reservations/managed-reservation-audit.model").default;
  CloudinaryService =
    require("../src/services/upload/cloudinary.service").CloudinaryService;
  requireRole = require("../src/middlewares/auth/requireRole").requireRole;
  UserRole = require("../src/types/user.type").UserRole;
  ReservationStatus =
    require("../src/types/reservation.type").ReservationStatus;
  VerificationStatus =
    require("../src/types/customer-profile.type").VerificationStatus;
  InspectionController = require("../src/controllers/inspections/inspection.controller");
  InspectionModel =
    require("../src/models/inspections/inspection.model").default;
  FacilityModel = require("../src/models/facilities/facility.model").default;
  StorageUnitService =
    require("../src/services/storage-units/storage-unit.service").StorageUnitService;
  parseStorageUnitList =
    require("../src/services/storage-units/storage-unit.validation").parseList;
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
    },
  };
  return res;
}

function sessionQuery(value) {
  return {
    session() {
      return this;
    },
    exec: async () => value,
  };
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

test("Suite 1.1: calculatePricing tính chuẩn xác cho kỳ thuê 30 ngày (1 tháng)", async (t) => {
  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  const startDate = new Date("2026-11-01T00:00:00.000Z");
  const endDate = new Date("2026-12-01T00:00:00.000Z"); // 30 ngày

  const result = await ReservationService.calculatePricing(
    pricingPolicyId.toString(),
    startDate,
    endDate,
  );
  assert.equal(result.durationDays, 30);
  assert.equal(result.basePrice, 1500000);
  assert.equal(result.estimatedRent, 1500000); // (30/30) * 1.5tr
  assert.equal(result.depositAmount, 1500000); // Đủ 30 ngày -> cọc 100%
});

test("Suite 1.2: calculatePricing tính chuẩn cho kỳ thuê 15 ngày (< 30 ngày cọc 50%)", async (t) => {
  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  const startDate = new Date("2026-11-01T00:00:00.000Z");
  const endDate = new Date("2026-11-16T00:00:00.000Z"); // 15 ngày

  const result = await ReservationService.calculatePricing(
    pricingPolicyId.toString(),
    startDate,
    endDate,
  );
  assert.equal(result.durationDays, 15);
  assert.equal(result.estimatedRent, 750000); // (15/30) * 1.5tr = 750k
  assert.equal(result.depositAmount, 750000); // Dưới 30 ngày -> cọc 50% = 750k
});

test("Suite 1.3: calculatePricing tính chuẩn cho kỳ thuê 45 ngày (1.5 tháng)", async (t) => {
  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  const startDate = new Date("2026-11-01T00:00:00.000Z");
  const endDate = new Date("2026-12-16T00:00:00.000Z"); // 45 ngày

  const result = await ReservationService.calculatePricing(
    pricingPolicyId.toString(),
    startDate,
    endDate,
  );
  assert.equal(result.durationDays, 45);
  assert.equal(result.estimatedRent, 2250000); // (45/30) * 1.5tr = 2.25tr
  assert.equal(result.depositAmount, 1500000); // >= 30 ngày -> cọc 1 tháng = 1.5tr
});

test("Suite 1.4: calculatePricing chặn ngày không hợp lệ (endDate <= startDate)", async () => {
  const startDate = new Date("2026-11-10T00:00:00.000Z");
  const endDate = new Date("2026-11-05T00:00:00.000Z");

  await assert.rejects(
    () =>
      ReservationService.calculatePricing(
        pricingPolicyId.toString(),
        startDate,
        endDate,
      ),
    (err) => err instanceof ReservationError && err.code === 400,
  );
});

test("Suite 1.5: Controller estimateRent trả về cấu trúc response thực tế (không mock cứng)", async (t) => {
  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  const req = {
    body: {
      pricingPolicyId: pricingPolicyId.toString(),
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-12-01T00:00:00.000Z",
    },
  };
  const res = mockResponse();

  await ReservationController.estimateRent(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.estimatedRent, 1500000);
  assert.equal(res.body.data.depositAmount, 1500000);
  assert.equal(res.body.data.taxAmount, 0);
  assert.equal(res.body.data.durationDays, 30);
});

// =========================================================================
// SUITE 2: CỔNG XÁC MINH CCCD (CUSTOMER VERIFICATION GATE)
// =========================================================================

test("Suite 2.1: Chặn khách hàng chưa có CCCD (UNVERIFIED) tạo đơn đặt kho", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "UNVERIFIED" }),
  }));

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31);

  await assert.rejects(
    () =>
      ReservationService.createReservation({
        customerId: customerAId.toString(),
        facilityId: facilityId.toString(),
        storageUnitId: storageUnitId.toString(),
        startDate: futureStart,
        endDate: futureEnd,
        pricingPolicyId: pricingPolicyId.toString(),
      }),
    (err) =>
      err instanceof ReservationError &&
      err.code === 403 &&
      err.message.includes("CCCD"),
  );
});

test("Suite 2.2: Chặn khách hàng đang chờ duyệt CCCD (PENDING) tạo đơn đặt kho", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "PENDING" }),
  }));

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31);

  await assert.rejects(
    () =>
      ReservationService.createReservation({
        customerId: customerAId.toString(),
        facilityId: facilityId.toString(),
        storageUnitId: storageUnitId.toString(),
        startDate: futureStart,
        endDate: futureEnd,
        pricingPolicyId: pricingPolicyId.toString(),
      }),
    (err) => err instanceof ReservationError && err.code === 403,
  );
});

// =========================================================================
// SUITE 3: CHỐNG GIAN LẬN GIÁ & TẠO ĐƠN (ANTI-TAMPERING)
// =========================================================================

test("Suite 3.1: createReservation bỏ qua số tiền Client gửi lên, tự tính đúng giá theo Pricing Rule", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED", identityCard: "012345678901", address: "Verified address", taxCode: "TAX-1", userId: { displayName: "Verified Customer", email: "customer@example.test", phone: "0900000000" } }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: storageUnitId,
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  t.mock.method(ReservationModel, "exists", () => ({
    session: () => ({
      exec: async () => null, // Không bị overlap
    }),
  }));

  let savedReservation = null;
  let savedContract = null;
  const session = { withTransaction: async (fn) => await fn(), endSession: async () => {} };
  t.mock.method(mongoose, "startSession", async () => ({
    ...session,
  }));

  t.mock.method(ReservationModel.prototype, "save", async function (options) {
    savedReservation = this;
    savedReservation.transactionSession = options?.session;
    return this;
  });
  t.mock.method(ContractModel.prototype, "save", async function (options) {
    savedContract = { document: this, session: options?.session };
    return this;
  });

  const fixtureNow = Date.now();
  const futureStart = new Date(fixtureNow + 86400000);
  const futureEnd = new Date(fixtureNow + 86400000 * 31); // exactly 30 days between start and end

  // Hacker gửi estimatedRent = 1 VNĐ, depositAmount = 1 VNĐ
  const req = {
    user: { _id: customerAId, role: "CUSTOMER" },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
      estimatedRent: 1, // Cố tình gian lận
      depositAmount: 1, // Cố tình gian lận
    },
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.success, true);

  // Số tiền lưu phải là 1,500,000 VNĐ, không bao giờ nhận 1 VNĐ
  assert.equal(savedReservation.estimatedRent, 1500000);
  assert.equal(savedReservation.depositAmount, 1500000);
  assert.equal(savedReservation.status, ReservationStatus.CONTRACTED);
  assert.ok(savedReservation.reservationCode.startsWith("BKG-"));
  assert.ok(savedReservation.expiresAt instanceof Date);
  assert.equal(savedReservation.approvedBy, undefined);
  assert.equal(savedReservation.approvedAt, undefined);
  assert.equal(savedReservation.statusHistory[0].status, ReservationStatus.CONTRACTED);
  assert.match(savedReservation.statusHistory[0].reason, /automatically contracted/i);
  assert.equal(savedContract.document.status, "DRAFT");
  assert.equal(savedContract.document.contractCode, `CTR-${savedReservation.reservationCode}`);
  assert.equal(savedContract.document.customerSnapshot.identityCard, "012345678901");
  assert.ok(savedReservation.transactionSession);
  assert.equal(savedContract.session, savedReservation.transactionSession);
});

test("createReservation aborts the unit transaction if automatic DRAFT Contract creation fails", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({ exec: async () => ({ verificationStatus: "VERIFIED" }) }));
  t.mock.method(PricingRuleModel, "findById", () => ({ exec: async () => ({ price: 1500000 }) }));
  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({ exec: async () => ({ _id: storageUnitId, size: "SMALL", status: "AVAILABLE" }) }));
  t.mock.method(ReservationModel, "exists", () => ({ session: () => ({ exec: async () => null }) }));
  let reservationWasSaved = false;
  let transactionAborted = false;
  t.mock.method(ReservationModel.prototype, "save", async function () { reservationWasSaved = true; return this; });
  t.mock.method(ContractModel.prototype, "save", async function () { throw new Error("contract write failed"); });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (work) => { try { return await work(); } catch (error) { transactionAborted = true; throw error; } },
    endSession: async () => {},
  }));
  const now = Date.now();
  await assert.rejects(() => ReservationService.createReservation({
    customerId: customerAId.toString(), facilityId: facilityId.toString(), storageUnitId: storageUnitId.toString(),
    startDate: new Date(now + 86400000), endDate: new Date(now + 86400000 * 31), pricingPolicyId: pricingPolicyId.toString(),
  }), /contract write failed/);
  assert.equal(reservationWasSaved, true);
  assert.equal(transactionAborted, true);
});

test("Self-Storage Reservation controller returns 201 for a new booking and 200 for an idempotent replay", async (t) => {
  const reservation = { _id: new mongoose.Types.ObjectId(), serviceType: "SELF_STORAGE", status: "CONTRACTED" };
  const calls = [];
  t.mock.method(ReservationService, "createReservationWithOutcome", async (input) => {
    calls.push(input);
    return { reservation, replayed: calls.length > 1 };
  });
  const key = "wdp-booking-same-request-key";
  const req = {
    user: { _id: customerAId, role: "CUSTOMER" },
    get: name => name === "Idempotency-Key" ? key : undefined,
    body: {
      facilityId: facilityId.toString(), storageUnitId: storageUnitId.toString(),
      startDate: new Date(Date.now() + 86400000).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 31).toISOString(), pricingPolicyId: pricingPolicyId.toString(),
    },
  };
  const first = mockResponse();
  await ReservationController.createReservation(req, first);
  const replay = mockResponse();
  await ReservationController.createReservation(req, replay);
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.equal(first.body.data, reservation);
  assert.equal(replay.body.data, reservation);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, key);
  assert.equal(calls[1].idempotencyKey, key);
  assert.equal(calls[0].customerId, calls[1].customerId);
});

test("Reservation schema declares a customer-scoped partial unique booking idempotency index", () => {
  const index = ReservationModel.schema.indexes().find(([fields]) =>
    fields.customerId === 1 && fields.bookingIdempotencyKey === 1,
  );
  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { bookingIdempotencyKey: { $type: "string" } });
});

// =========================================================================
// SUITE 4: CHỐNG TRÙNG LỊCH THUÊ KHO & GỢI Ý KHO THAY THẾ (OVERLAP & SUGGESTIONS)
// =========================================================================

test("Suite 4.1: Chặn đặt trùng kho nếu đã có đơn khác chiếm dụng trong kỳ thuê (HTTP 409)", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED" }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: storageUnitId,
      unitCode: "A-01",
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  // Giả lập phát hiện có đơn trùng
  t.mock.method(ReservationModel, "exists", () => ({
    session: () => ({
      exec: async () => ({ _id: new mongoose.Types.ObjectId() }),
    }),
  }));

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {},
  }));

  const futureStart = new Date(Date.now() + 86400000);
  const futureEnd = new Date(Date.now() + 86400000 * 31);

  await assert.rejects(
    () =>
      ReservationService.createReservation({
        customerId: customerAId.toString(),
        facilityId: facilityId.toString(),
        storageUnitId: storageUnitId.toString(),
        startDate: futureStart,
        endDate: futureEnd,
        pricingPolicyId: pricingPolicyId.toString(),
      }),
    (err) =>
      err instanceof ReservationError &&
      err.code === 409 &&
      err.message.includes("đã có người đặt"),
  );
});

test("Suite 4.2: Customer B đặt cùng kho A-01 sau thời gian thuê của Customer A (không trùng ngày) -> Thành công (HTTP 201)", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED" }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: storageUnitId,
      unitCode: "A-01",
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  // Đơn của Customer A thuê từ ngày +5 đến ngày +15 (đang ACTIVE hoặc DEPOSIT_PAID)
  const existingBookings = [
    {
      _id: new mongoose.Types.ObjectId(),
      storageUnitId,
      startDate: new Date(Date.now() + 86400000 * 5),
      endDate: new Date(Date.now() + 86400000 * 15),
      status: ReservationStatus.ACTIVE,
    },
  ];

  // Kiểm tra thực tế điều kiện toán học startDate < endDate_B && endDate > startDate_B
  t.mock.method(ReservationModel, "exists", (query) => ({
    session: () => ({
      exec: async () => {
        const reqEnd = query.startDate.$lt;
        const reqStart = query.endDate.$gt;
        const match = existingBookings.find(
          (b) =>
            b.storageUnitId.equals(query.storageUnitId) &&
            b.startDate < reqEnd &&
            b.endDate > reqStart,
        );
        return match ? { _id: match._id } : null;
      },
    }),
  }));

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {},
  }));

  t.mock.method(ReservationModel.prototype, "save", async function () {
    return this;
  });
  t.mock.method(ContractModel.prototype, "save", async function () { return this; });

  // Customer B đặt từ ngày +16 đến ngày +46 (sau khi phiên thuê của Customer A kết thúc)
  const bStart = new Date(Date.now() + 86400000 * 16);
  const bEnd = new Date(Date.now() + 86400000 * 46);

  const req = {
    user: { _id: customerBId, role: "CUSTOMER" },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: bStart.toISOString(),
      endDate: bEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    },
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(
    res.body.data.storageUnitId.toString(),
    storageUnitId.toString(),
  );
});

test("Suite 4.3: Khi trùng lịch thuê, trả về HTTP 409 kèm message chi tiết và danh sách kho gợi ý (ưu tiên cùng size)", async (t) => {
  const unitA01 = storageUnitId;
  const unitA02 = new mongoose.Types.ObjectId(); // Cùng size SMALL, đang trống
  const unitA03 = new mongoose.Types.ObjectId(); // Cùng size SMALL, nhưng cũng đã có người đặt trùng ngày
  const unitB01 = new mongoose.Types.ObjectId(); // Khác size MEDIUM, đang trống
  const unitM01 = new mongoose.Types.ObjectId(); // Đang bảo trì MAINTENANCE

  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED" }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: unitA01,
      unitCode: "A-01",
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  // Phát hiện A-01 bị trùng lịch
  t.mock.method(ReservationModel, "exists", () => ({
    session: () => ({
      exec: async () => ({ _id: new mongoose.Types.ObjectId() }),
    }),
  }));

  // Trong khoảng thời gian này, A-01 và A-03 đang có đơn đặt chiếm chỗ
  t.mock.method(ReservationModel, "find", () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => [{ storageUnitId: unitA01 }, { storageUnitId: unitA03 }],
  }));

  // Danh sách các kho trong cơ sở
  t.mock.method(StorageUnitModel, "find", () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => [
      {
        _id: unitB01,
        unitCode: "B-01",
        size: "MEDIUM",
        volumeM3: 48,
        status: "AVAILABLE",
      },
      {
        _id: unitA02,
        unitCode: "A-02",
        size: "SMALL",
        volumeM3: 24,
        status: "AVAILABLE",
      },
      {
        _id: unitA03,
        unitCode: "A-03",
        size: "SMALL",
        volumeM3: 24,
        status: "AVAILABLE",
      }, // Bị trùng lịch -> phải bị lọc bỏ
      {
        _id: unitM01,
        unitCode: "M-01",
        size: "SMALL",
        volumeM3: 24,
        status: "MAINTENANCE",
      }, // Bảo trì -> phải bị lọc bỏ
    ],
  }));

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {},
  }));

  const futureStart = new Date(Date.now() + 86400000 * 5);
  const futureEnd = new Date(Date.now() + 86400000 * 20);

  const req = {
    user: { _id: customerBId, role: "CUSTOMER" },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: unitA01.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    },
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes("Kho A-01 đã có người đặt"));
  assert.ok(res.body.message.includes("Gợi ý các kho khả dụng khác"));
  assert.ok(res.body.message.includes("A-02 (SMALL)"));
  assert.ok(res.body.message.includes("B-01 (MEDIUM)"));

  // Kiểm tra mảng suggestedUnits: chỉ chứa A-02 và B-01 (đã loại A-03 và M-01), A-02 (cùng size SMALL) đứng đầu
  assert.ok(Array.isArray(res.body.suggestedUnits));
  assert.equal(res.body.suggestedUnits.length, 2);
  assert.equal(res.body.suggestedUnits[0].unitCode, "A-02");
  assert.equal(res.body.suggestedUnits[0].sameSize, true);
  assert.equal(res.body.suggestedUnits[1].unitCode, "B-01");
  assert.equal(res.body.suggestedUnits[1].sameSize, false);
});

test("Suite 4.4: buildOverlapFilter bao gồm cả DEPOSIT_PAID và CHECKIN_READY trong các trạng thái giữ lịch cứng", () => {
  const start = new Date("2026-11-01T00:00:00.000Z");
  const end = new Date("2026-11-15T00:00:00.000Z");
  const filter = ReservationService.buildOverlapFilter(start, end);

  assert.ok(filter.status.$in.includes(ReservationStatus.DEPOSIT_PAID));
  assert.ok(filter.status.$in.includes(ReservationStatus.CHECKIN_READY));
  assert.ok(filter.status.$in.includes(ReservationStatus.PAID));
  assert.ok(filter.status.$in.includes(ReservationStatus.ACTIVE));
  assert.ok(filter.$or[0].status.$in.includes(ReservationStatus.DEPOSIT_PAID));
  assert.ok(filter.$or[0].status.$in.includes(ReservationStatus.CHECKIN_READY));
});

test("Suite 4.5: Customer B đặt cùng kho A-01 TRƯỚC kỳ thuê của Customer A (hoặc sát biên liền kề endDate_B === startDate_A) -> Thành công (HTTP 201)", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED" }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: storageUnitId,
      unitCode: "A-01",
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  // Customer A đã đặt trước cho tương lai từ ngày +20 đến ngày +50
  const baseTime = Date.now();
  const aStart = new Date(baseTime + 86400000 * 20);
  const aEnd = new Date(baseTime + 86400000 * 50);

  t.mock.method(ReservationModel, "exists", (query) => ({
    session: () => ({
      exec: async () => {
        const reqEnd = query.startDate.$lt;
        const reqStart = query.endDate.$gt;
        const isOverlap = aStart < reqEnd && aEnd > reqStart;
        return isOverlap ? { _id: new mongoose.Types.ObjectId() } : null;
      },
    }),
  }));

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {},
  }));

  t.mock.method(ReservationModel.prototype, "save", async function () {
    return this;
  });
  t.mock.method(ContractModel.prototype, "save", async function () { return this; });

  // Customer B đặt từ ngày +5 đến đúng thời điểm ngày +20 (endDate_B === startDate_A -> không giao cắt)
  const bStart = new Date(baseTime + 86400000 * 5);
  const bEnd = aStart;

  const req = {
    user: { _id: customerBId, role: "CUSTOMER" },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: bStart.toISOString(),
      endDate: bEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    },
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
});

test("Suite 4.6: Khi trùng lịch và toàn bộ các kho khác trong cơ sở cũng đã hết chỗ trong khoảng ngày đó -> Trả về HTTP 409 với suggestedUnits rỗng", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED" }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: storageUnitId,
      unitCode: "A-01",
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  t.mock.method(ReservationModel, "exists", () => ({
    session: () => ({
      exec: async () => ({ _id: new mongoose.Types.ObjectId() }),
    }),
  }));

  t.mock.method(ReservationModel, "find", () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => [{ storageUnitId }],
  }));

  // Cơ sở không còn kho trống nào khác
  t.mock.method(StorageUnitModel, "find", () => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => [],
  }));

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {},
  }));

  const futureStart = new Date(Date.now() + 86400000 * 5);
  const futureEnd = new Date(Date.now() + 86400000 * 20);

  const req = {
    user: { _id: customerBId, role: "CUSTOMER" },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    },
  };
  const res = mockResponse();

  await ReservationController.createReservation(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes("không còn kho trống nào khác"));
  assert.deepEqual(res.body.suggestedUnits, []);
});

test("Suite 4.7: Đơn RESERVED đã quá hạn (expiresAt <= now) không chặn khách sau, nhưng đơn DEPOSIT_PAID thì chặn cứng", async (t) => {
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    exec: async () => ({ verificationStatus: "VERIFIED" }),
  }));

  t.mock.method(PricingRuleModel, "findById", () => ({
    exec: async () => ({ price: 1500000 }),
  }));

  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({
      _id: storageUnitId,
      unitCode: "A-01",
      size: "SMALL",
      status: "AVAILABLE",
    }),
  }));

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => await fn(),
    endSession: async () => {},
  }));

  t.mock.method(ReservationModel.prototype, "save", async function () {
    return this;
  });
  t.mock.method(ContractModel.prototype, "save", async function () { return this; });

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

  t.mock.method(ReservationModel, "exists", (query) => ({
    session: () => ({
      exec: async () => {
        const reqEnd = query.startDate.$lt;
        const reqStart = query.endDate.$gt;
        const committedStatuses = query.$or[0].status.$in;
        const tempStatuses = query.$or[1].status.$in;
        const minExpiresAt = query.$or[1].expiresAt.$gt;

        const found = dbRecords.find((r) => {
          const timeOverlap = r.startDate < reqEnd && r.endDate > reqStart;
          if (!timeOverlap) return false;
          if (committedStatuses.includes(r.status)) return true;
          if (
            tempStatuses.includes(r.status) &&
            r.expiresAt &&
            r.expiresAt > minExpiresAt
          )
            return true;
          return false;
        });
        return found ? { _id: found._id } : null;
      },
    }),
  }));

  const futureStart = new Date(Date.now() + 86400000 * 5);
  const futureEnd = new Date(Date.now() + 86400000 * 20);

  // Trường hợp 1: Đơn cũ là RESERVED nhưng đã hết hạn -> Customer B đặt trùng ngày vẫn THÀNH CÔNG (201)
  const req1 = {
    user: { _id: customerBId, role: "CUSTOMER" },
    body: {
      facilityId: facilityId.toString(),
      storageUnitId: storageUnitId.toString(),
      startDate: futureStart.toISOString(),
      endDate: futureEnd.toISOString(),
      pricingPolicyId: pricingPolicyId.toString(),
    },
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
    },
  ];
  const res2 = mockResponse();
  await ReservationController.createReservation(req1, res2);
  assert.equal(res2.statusCode, 409);
});

// =========================================================================
// SUITE 5: PHÂN QUYỀN CHÉO XEM ĐƠN & THANH TOÁN (AUTHORIZATION & PRIVACY)
// =========================================================================

test("Suite 5.1: Khách hàng A xem chi tiết đơn của chính mình -> Thành công (HTTP 200)", async (t) => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    storageUnitId,
    status: "RESERVED",
  };

  t.mock.method(ReservationModel, "findOne", () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData,
      }),
    }),
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: "CUSTOMER" },
  };
  const res = mockResponse();

  await ReservationController.getReservationById(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data._id.toString(), reservationData._id.toString());
});

test('Suite 5.2: Khách hàng B xem trộm đơn của Khách hàng A -> Bị chặn 403 "Bạn không có đủ quyền truy cập!"', async (t) => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId, // Đơn thuộc về Khách A
    facilityId,
    storageUnitId,
  };

  t.mock.method(ReservationModel, "findOne", () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData,
      }),
    }),
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerBId, role: "CUSTOMER" }, // Khách B xem trộm
  };
  const res = mockResponse();

  await ReservationController.getReservationById(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Bạn không có đủ quyền truy cập!");
});

test('Suite 5.3: Khách hàng B cố tình thanh toán đơn của Khách hàng A -> Bị chặn 403 "Bạn không có đủ quyền truy cập!"', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();

  // Đơn thuộc về Khách A
  t.mock.method(ReservationModel, "findOneAndUpdate", async () => null);
  t.mock.method(ReservationModel, "findById", async () => ({
    _id: reservationId,
    customerId: customerAId,
    status: "CONTRACTED",
  }));

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: customerBId, role: "CUSTOMER" }, // Khách B gọi mock-pay
  };
  const res = mockResponse();

  await ReservationController.mockPayReservation(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Bạn không có đủ quyền truy cập!");
});

test("Self-Storage legacy mock-pay rejects production and unknown environments before Reservation reads or writes", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  let reservationWrites = 0;
  let reservationReads = 0;
  let paymentWrites = 0;
  let contractWrites = 0;
  t.mock.method(ReservationModel, "findOneAndUpdate", async () => {
    reservationWrites++;
    return null;
  });
  t.mock.method(ReservationModel, "findById", async () => {
    reservationReads++;
    return null;
  });
  t.mock.method(ReservationPaymentModel, "create", async () => {
    paymentWrites++;
    return {};
  });
  t.mock.method(ContractModel, "create", async () => {
    contractWrites++;
    return {};
  });

  for (const env of ["production", "staging", undefined]) {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    const res = mockResponse();
    await ReservationController.mockPayReservation(
      {
        params: { id: "mock-pay-denied" },
        user: { _id: customerAId, role: "CUSTOMER" },
      },
      res,
    );
    assert.equal(res.statusCode, 404, `NODE_ENV=${env}`);
    assert.match(res.body.message, /disabled in this environment/i);
  }

  assert.equal(reservationWrites, 0);
  assert.equal(reservationReads, 0);
  assert.equal(paymentWrites, 0);
  assert.equal(contractWrites, 0);
});

test("Self-Storage legacy mock-pay only advances an owned CONTRACTED Self-Storage Reservation once", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservation = {
    _id: "mock-pay-once",
    customerId: customerAId,
    serviceType: "SELF_STORAGE",
    status: "CONTRACTED",
    statusHistory: [],
  };
  const filters = [];
  t.mock.method(ReservationModel, "findOneAndUpdate", async (filter) => {
    filters.push(filter);
    if (
      reservation.status !== "CONTRACTED" ||
      filter.serviceType !== "SELF_STORAGE" ||
      filter.customerId !== customerAId ||
      filter.status !== "CONTRACTED"
    )
      return null;
    reservation.status = "PAID";
    reservation.statusHistory.push({ status: "PAID" });
    return reservation;
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);

  const first = mockResponse();
  await ReservationController.mockPayReservation(
    {
      params: { id: reservation._id },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    first,
  );
  assert.equal(first.statusCode, 200);
  assert.equal(reservation.status, "PAID");
  assert.equal(reservation.statusHistory.length, 1);

  const replay = mockResponse();
  await ReservationController.mockPayReservation(
    {
      params: { id: reservation._id },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    replay,
  );
  assert.equal(replay.statusCode, 409);
  assert.equal(reservation.status, "PAID");
  assert.equal(reservation.statusHistory.length, 1);
  assert.deepEqual(
    filters.map((filter) => ({
      customerId: filter.customerId,
      serviceType: filter.serviceType,
      status: filter.status,
    })),
    [
      {
        customerId: customerAId,
        serviceType: "SELF_STORAGE",
        status: "CONTRACTED",
      },
      {
        customerId: customerAId,
        serviceType: "SELF_STORAGE",
        status: "CONTRACTED",
      },
    ],
  );
});

test("Suite 5.4: Quản lý (FM) xem đơn của Khách hàng bất kỳ -> Thành công (HTTP 200)", async (t) => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    storageUnitId,
  };

  t.mock.method(ReservationModel, "findOne", () => ({
    populate: () => ({
      populate: () => ({
        populate: async () => reservationData,
      }),
    }),
  }));

  const req = {
    params: { id: reservationData._id.toString() },
    user: {
      _id: fmId,
      role: "FACILITY_MANAGER",
      assignedFacilityId: facilityId,
    },
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
  const guard = requireRole(["FACILITY_MANAGER", "ADMIN"]);
  const req = { user: { _id: customerAId, role: "CUSTOMER" } };
  const res = mockResponse();
  let nextCalled = false;

  guard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Bạn không có đủ quyền truy cập!");
});

test("Suite 6.2: requireRole cho phép đúng role vượt qua", () => {
  const guard = requireRole(["CUSTOMER"]);
  const req = { user: { _id: customerAId, role: "CUSTOMER" } };
  const res = mockResponse();
  let nextCalled = false;

  guard(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

// =========================================================================
// SUITE 7: LUỒNG THỐNG NHẤT (2 ĐỢT THANH TOÁN + BẰNG CHỨNG HỢP ĐỒNG CLOUDINARY)
// =========================================================================

test("Suite 7.1: initiateDeposit tính toán số tiền cọc chuẩn xác từ breakdown", async (t) => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    status: ReservationStatus.RESERVED,
    estimatedRent: 1500000,
    depositAmount: 1500000,
    taxAmount: 0,
    discountAmount: 0,
  };

  t.mock.method(ReservationModel, "findById", async () => reservationData);

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: "CUSTOMER" },
  };
  const res = mockResponse();

  await ReservationController.initiateDeposit(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.purpose, "DEPOSIT");
  assert.equal(res.body.data.amount, 1500000);
  assert.equal(res.body.data.breakdown.depositCredit, 1500000);
  assert.equal(res.body.data.breakdown.balanceDue, 0);
});

test("Suite 7.2: confirmMockDeposit chuyển sang DEPOSIT_PAID, tạo payment DEPOSIT và tự động sinh Contract DRAFT", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: "BKG-TEST-1234",
    customerId: customerAId,
    facilityId,
    serviceType: "SELF_STORAGE",
    status: ReservationStatus.RESERVED,
    estimatedRent: 1500000,
    depositAmount: 1500000,
    taxAmount: 0,
    discountAmount: 0,
    pricingPolicyId,
    statusHistory: [],
    save: async () => reservationData,
  };

  t.mock.method(ReservationModel, "findById", async () => reservationData);
  let createdPayment = null;
  t.mock.method(ReservationPaymentModel, "create", async (doc) => {
    createdPayment = { _id: new mongoose.Types.ObjectId(), ...doc };
    return createdPayment;
  });
  t.mock.method(ContractModel, "findOne", async () => null);
  t.mock.method(CustomerProfileModel, "findOne", () => ({
    populate: async () => ({
      identityCard: "012345678901",
      address: "Hà Nội",
      userId: {
        fullName: "Nguyễn Văn A",
        email: "a@test.com",
        phone: "0901234567",
      },
    }),
  }));
  let createdContract = null;
  t.mock.method(ContractModel, "create", async (doc) => {
    createdContract = doc;
    return doc;
  });

  const req = {
    params: { id: reservationData._id.toString() },
    // The generic simulation endpoint accepts no client-selected settlement fields.
    body: { provider: "PAYOS", status: "PENDING", amount: -1 },
    user: { _id: customerAId, role: "CUSTOMER" },
  };
  const res = mockResponse();

  await ReservationController.confirmMockDeposit(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationData.status, ReservationStatus.DEPOSIT_PAID);
  assert.equal(createdPayment.provider, "MOCK");
  assert.equal(createdPayment.status, "SUCCEEDED");
  assert.ok(createdContract !== null);
  assert.equal(createdContract.status, "DRAFT");
  assert.equal(createdContract.customerSnapshot.identityCard, "012345678901");
});

test("Self-Storage generic mock deposit is rejected in production before any payment or reservation write", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "SELF_STORAGE",
    status: ReservationStatus.RESERVED,
    estimatedRent: 1000,
    depositAmount: 100,
    statusHistory: [],
    save: async () => {
      throw new Error("must reject before Reservation save");
    },
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("must reject before payment write");
  });
  t.mock.method(ContractModel, "create", async () => {
    throw new Error("must reject before Contract write");
  });

  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /disabled in production/i);
  assert.equal(reservation.status, ReservationStatus.RESERVED);
});

test("Self-Storage generic mock deposit keeps owner authorization in development/test", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    serviceType: "SELF_STORAGE",
    status: ReservationStatus.RESERVED,
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("non-owner must not create payment");
  });
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerBId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 403);
});

test("Self-Storage generic mock deposit rejects ineligible Reservation state before writes", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    serviceType: "SELF_STORAGE",
    status: ReservationStatus.CONTRACTED,
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("ineligible state must not create payment");
  });
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
      body: null,
    },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /chờ thanh toán cọc/i);
});

test("Managed generic mock deposit is rejected in production before creating a payment", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "production";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: 1,
    status: ReservationStatus.RESERVED,
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("must reject before payment write");
  });
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /disabled in production/i);
});

test("Managed v2 generic mock deposit cannot bypass the dedicated versioned route", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "development";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: 2,
    status: ReservationStatus.RESERVED,
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("must reject before payment write");
  });
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(
    res.body.message,
    /versioned Managed deposit confirmation endpoint/i,
  );
});

test("Managed v1 generic mock deposit requires an explicit development/test simulation gate", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  delete process.env.MI_MOCK_PAYMENT_ENABLED;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: undefined,
    status: ReservationStatus.RESERVED,
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("must reject while gate is off");
  });
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.match(
    res.body.message,
    /Managed mock deposit confirmation is disabled/i,
  );
});

test("Managed generic mock deposit preserves customer ownership validation", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "development";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: undefined,
    status: ReservationStatus.RESERVED,
  };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationPaymentModel, "create", async () => {
    throw new Error("unauthorized customer must not write");
  });
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerBId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 403);
});

test("Managed v1 deposit uses lifecycle CAS before atomic payment/contract writes and replays historical payment identity", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "development";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: "MIR-LEGACY-1",
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: undefined,
    status: ReservationStatus.RESERVED,
    inventoryVersion: undefined,
    estimatedRent: 300,
    depositAmount: 100,
    taxAmount: 0,
    discountAmount: 0,
    pricingPolicyId,
    statusHistory: [],
  };
  const operations = [];
  const query = (value) => ({
    session() {
      return this;
    },
    populate() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", (filter) =>
    query(String(filter._id) === String(reservation._id) ? reservation : null),
  );
  t.mock.method(ReservationModel, "findOneAndUpdate", (filter, update) => {
    operations.push("reservation-cas");
    assert.equal(filter.customerId, customerAId);
    assert.equal(filter.facilityId, facilityId);
    assert.equal(filter.serviceType, "MANAGED_INVENTORY");
    assert.equal(filter.activeClosureRequestId, null);
    assert.deepEqual(filter.$and[0].$or, [
      { inventoryVersion: 0 },
      { inventoryVersion: { $exists: false } },
    ]);
    assert.equal(update.$inc.inventoryVersion, 1);
    reservation.status = update.$set.status;
    reservation.depositPaymentId = update.$set.depositPaymentId;
    reservation.paymentSimulation = update.$set.paymentSimulation;
    reservation.inventoryVersion = 1;
    reservation.statusHistory.push(update.$push.statusHistory);
    return query(reservation);
  });
  let payment, contract;
  t.mock.method(ReservationPaymentModel, "findOne", (filter) =>
    query(filter._id ? payment : null),
  );
  t.mock.method(ReservationPaymentModel, "findById", (id) =>
    query(payment && String(payment._id) === String(id) ? payment : null),
  );
  t.mock.method(ReservationPaymentModel.prototype, "save", async function () {
    operations.push("payment-save");
    payment = this;
    return this;
  });
  t.mock.method(ContractModel, "findOne", () => query(contract || null));
  t.mock.method(ContractModel.prototype, "save", async function () {
    operations.push("contract-save");
    contract = this;
    return this;
  });
  t.mock.method(CustomerProfileModel, "findOne", () =>
    query({
      identityCard: "ID-1",
      address: "Address",
      taxCode: "TAX",
      userId: {
        fullName: "Customer",
        email: "customer@example.test",
        phone: "0900000000",
      },
    }),
  );
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  }));

  const firstResponse = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    firstResponse,
  );
  assert.equal(firstResponse.statusCode, 200);
  assert.deepEqual(operations, [
    "reservation-cas",
    "payment-save",
    "contract-save",
  ]);
  assert.equal(
    payment.idempotencyKey,
    `managed-legacy-deposit-${reservation._id}`,
  );
  assert.equal(payment.status, "SUCCEEDED");
  assert.equal(reservation.depositPaymentId, payment._id);
  assert.equal(reservation.status, "DEPOSIT_PAID");
  assert.equal(reservation.inventoryVersion, 1);
  assert.equal(reservation.paymentSimulation.simulated, true);
  assert.equal(reservation.paymentSimulation.provider, "MOCK");

  t.mock.restoreAll();
  // Existing successful legacy payment references may have timestamp keys; replay follows depositPaymentId.
  payment.idempotencyKey = `deposit-${reservation._id}-1700000000000`;
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", (filter) => query(reservation));
  t.mock.method(ReservationPaymentModel, "findById", (id) =>
    query(payment && String(payment._id) === String(id) ? payment : null),
  );
  t.mock.method(ContractModel, "findOne", () => query(contract));
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  }));
  const replayResponse = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    replayResponse,
  );
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replayResponse.body.data.payment._id, payment._id);

  // Compatibility replay also recognizes historical timestamp-derived payment keys by the Reservation reference.
  payment.idempotencyKey = `deposit-${reservation._id}-1700000000000`;
  const historicalReplay = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    historicalReplay,
  );
  assert.equal(historicalReplay.statusCode, 200);
  assert.equal(historicalReplay.body.data.payment._id, payment._id);
});

test("Managed v1 deposit fails closed when the lifecycle CAS loses a marker or version race", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.RESERVED,
    inventoryVersion: 9,
    estimatedRent: 100,
    depositAmount: 30,
    taxAmount: 0,
    discountAmount: 0,
  };
  const query = (value) => ({
    session() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => query(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () => query(null));
  let updateFilter;
  t.mock.method(ReservationModel, "findOneAndUpdate", (filter) => {
    updateFilter = filter;
    return query(null);
  });
  t.mock.method(ReservationPaymentModel.prototype, "save", async () => {
    throw new Error("payment must not be written");
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  }));
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 409, res.body?.message);
  assert.equal(updateFilter.activeClosureRequestId, null);
  assert.ok(updateFilter.$and.some((part) => part.inventoryVersion === 9));
});

test("Managed v1 deposit aborts all transaction writes when payment persistence fails", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: "MIR-LEGACY-ROLLBACK",
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.RESERVED,
    inventoryVersion: 0,
    estimatedRent: 100,
    depositAmount: 30,
    taxAmount: 0,
    discountAmount: 0,
    statusHistory: [],
  };
  const query = (value) => ({
    session() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => query(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () => query(null));
  t.mock.method(ReservationModel, "findOneAndUpdate", (_filter, update) => {
    reservation.status = update.$set.status;
    reservation.inventoryVersion = 1;
    reservation.depositPaymentId = update.$set.depositPaymentId;
    reservation.paymentSimulation = update.$set.paymentSimulation;
    return query(reservation);
  });
  t.mock.method(ReservationPaymentModel.prototype, "save", async () => {
    throw new Error("payment write failed");
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => {
      const before = {
        ...reservation,
        statusHistory: [...reservation.statusHistory],
      };
      try {
        return await fn();
      } catch (error) {
        Object.assign(reservation, before);
        reservation.depositPaymentId = before.depositPaymentId;
        reservation.paymentSimulation = before.paymentSimulation;
        throw error;
      }
    },
    endSession: async () => {},
  }));
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 500);
  assert.equal(reservation.status, "RESERVED");
  assert.equal(reservation.inventoryVersion, 0);
  assert.equal(reservation.depositPaymentId, undefined);
  assert.equal(reservation.paymentSimulation, undefined);
});

test("Managed v1 deposit rejects an ineligible Reservation state before CAS or payment write", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.CONTRACTED,
    estimatedRent: 100,
    depositAmount: 30,
    taxAmount: 0,
    discountAmount: 0,
  };
  const query = (value) => ({
    session() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => query(reservation));
  t.mock.method(ReservationModel, "findOneAndUpdate", () => {
    throw new Error("CAS must not run for ineligible status");
  });
  t.mock.method(ReservationPaymentModel, "findOne", () => query(null));
  t.mock.method(ReservationPaymentModel.prototype, "save", async () => {
    throw new Error("payment must not be written");
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  }));
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /requires RESERVED/i);
});

test("Managed v1 Reservation write failure prevents the payment write", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.RESERVED,
    inventoryVersion: 4,
    estimatedRent: 100,
    depositAmount: 30,
    taxAmount: 0,
    discountAmount: 0,
  };
  const query = (value) => ({
    session() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => query(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () => query(null));
  t.mock.method(ReservationModel, "findOneAndUpdate", () => ({
    exec: async () => {
      throw new Error("reservation write failed");
    },
  }));
  let paymentWrites = 0;
  t.mock.method(ReservationPaymentModel.prototype, "save", async function () {
    paymentWrites++;
    return this;
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => fn(),
    endSession: async () => {},
  }));
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 500);
  assert.equal(paymentWrites, 0);
  assert.equal(reservation.status, "RESERVED");
  assert.equal(reservation.inventoryVersion, 4);
});

test("Managed v1 Contract creation failure is contained by the transaction mock after CAS and payment writes", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: "MIR-CONTRACT-ROLLBACK",
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.RESERVED,
    inventoryVersion: 2,
    estimatedRent: 100,
    depositAmount: 30,
    taxAmount: 0,
    discountAmount: 0,
    statusHistory: [],
  };
  const query = (value) => ({
    session() {
      return this;
    },
    populate() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => query(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () => query(null));
  t.mock.method(ReservationModel, "findOneAndUpdate", (_filter, update) => {
    reservation.status = update.$set.status;
    reservation.inventoryVersion += update.$inc.inventoryVersion;
    reservation.depositPaymentId = update.$set.depositPaymentId;
    reservation.paymentSimulation = update.$set.paymentSimulation;
    return query(reservation);
  });
  let paymentWrites = 0;
  t.mock.method(ReservationPaymentModel.prototype, "save", async function () {
    paymentWrites++;
    return this;
  });
  t.mock.method(ContractModel, "findOne", () => query(null));
  t.mock.method(CustomerProfileModel, "findOne", () => query({ userId: {} }));
  t.mock.method(ContractModel.prototype, "save", async () => {
    throw new Error("contract write failed");
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => {
      const before = {
        status: reservation.status,
        inventoryVersion: reservation.inventoryVersion,
        depositPaymentId: reservation.depositPaymentId,
        paymentSimulation: reservation.paymentSimulation,
      };
      try {
        return await fn();
      } catch (error) {
        Object.assign(reservation, before);
        throw error;
      }
    },
    endSession: async () => {},
  }));
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 500);
  assert.equal(paymentWrites, 1);
  assert.equal(reservation.status, "RESERVED");
  assert.equal(reservation.inventoryVersion, 2);
  assert.equal(reservation.depositPaymentId, undefined);
  assert.equal(reservation.paymentSimulation, undefined);
});

test("Managed v1 deposit does not report success when commit outcome is unknown and no durable result can be read", async (t) => {
  const oldEnv = process.env.NODE_ENV,
    oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  process.env.NODE_ENV = "test";
  process.env.MI_MOCK_PAYMENT_ENABLED = "true";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: "MIR-LEGACY-UNKNOWN",
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.RESERVED,
    inventoryVersion: 0,
    estimatedRent: 100,
    depositAmount: 30,
    taxAmount: 0,
    discountAmount: 0,
    statusHistory: [],
  };
  const query = (value) => ({
    session() {
      return this;
    },
    populate() {
      return this;
    },
    exec: async () => value,
  });
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => query(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () => query(null));
  t.mock.method(ReservationPaymentModel.prototype, "save", async function () {
    return this;
  });
  t.mock.method(ContractModel, "findOne", () => query(null));
  t.mock.method(ContractModel.prototype, "save", async function () {
    return this;
  });
  t.mock.method(CustomerProfileModel, "findOne", () => query({ userId: {} }));
  t.mock.method(ReservationModel, "findOneAndUpdate", (_filter, update) =>
    query({
      ...reservation,
      status: update.$set.status,
      depositPaymentId: update.$set.depositPaymentId,
      inventoryVersion: 1,
    }),
  );
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (fn) => {
      await fn();
      throw Object.assign(new Error("commit result unknown"), {
        errorLabels: ["UnknownTransactionCommitResult"],
      });
    },
    endSession: async () => {},
  }));
  const res = mockResponse();
  await ReservationController.confirmMockDeposit(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /outcome is uncertain/i);
});

test("Suite 7.3: Khách hàng gọi initiateBalance khi Staff chưa upload ảnh bằng chứng hợp đồng giấy -> Bị chặn 409", async (t) => {
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
    status: "DRAFT",
    signedProofUrl: undefined, // Chưa có ảnh bằng chứng
  };

  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(ContractModel, "findOne", async () => draftContract);

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: "CUSTOMER" },
  };
  const res = mockResponse();

  await ReservationController.initiateBalance(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes("Staff xác nhận"));
});

test("Suite 7.4: Staff upload ảnh chụp hợp đồng giấy lên Cloudinary thành công -> Hợp đồng chuyển SIGNED, đơn sang CHECKIN_READY", async (t) => {
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
    status: "DRAFT",
    save: async () => contractData,
  };

  t.mock.method(ContractModel, "findById", async () => contractData);
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(CloudinaryService, "uploadBuffer", async () => ({
    secureUrl:
      "https://res.cloudinary.com/test/image/upload/v1/wdp/signed-contracts/sample.jpg",
    publicId: "wdp/signed-contracts/sample",
    format: "jpg",
  }));

  const req = {
    params: { id: contractData._id.toString() },
    user: { _id: fmId, role: "FACILITY_STAFF" },
    file: { buffer: Buffer.from("fake image data") },
    body: { paperContractNumber: "HĐ-2026-001" },
  };
  const res = mockResponse();

  await ContractController.confirmSignedPaper(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(contractData.status, "SIGNED");
  assert.equal(
    contractData.signedProofUrl,
    "https://res.cloudinary.com/test/image/upload/v1/wdp/signed-contracts/sample.jpg",
  );
  assert.equal(reservationData.status, ReservationStatus.CHECKIN_READY);
});

test("Managed signed-paper confirmation uses Reservation CAS and atomically preserves proof and signature history", async (t) => {
  const staff = {
    _id: fmId,
    role: "FACILITY_STAFF",
    assignedFacilityId: facilityId,
  };
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.CONTRACTED,
    inventoryVersion: 4,
    activeClosureRequestId: null,
    statusHistory: [],
  };
  const signatures = [
    {
      signerRole: "CUSTOMER",
      version: 1,
      contentHash: "hash",
      signerId: customerAId,
    },
  ];
  const operations = [];
  const session = {
    withTransaction: async (work, options) => {
      assert.equal(options.writeConcern.w, "majority");
      return work();
    },
    endSession: async () => {},
  };
  const contract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservation._id,
    status: "SIGNED",
    signatures,
    save: async (options) => {
      assert.equal(options.session, session);
      operations.push("contract-save");
      return contract;
    },
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(ContractModel, "findById", async () => contract);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => sessionQuery(reservation));
  t.mock.method(ContractModel, "findOne", () => sessionQuery(contract));
  t.mock.method(
    ReservationModel,
    "findOneAndUpdate",
    (filter, update, options) => {
      operations.push("reservation-cas");
      assert.equal(filter.serviceType, "MANAGED_INVENTORY");
      assert.equal(filter.activeClosureRequestId, null);
      assert.ok(filter.$and.some((part) => part.inventoryVersion === 4));
      assert.equal(update.$set.status, "CHECKIN_READY");
      assert.equal(options.session, session);
      reservation.status = "CHECKIN_READY";
      reservation.inventoryVersion += 1;
      reservation.statusHistory.push(update.$push.statusHistory);
      return sessionQuery(reservation);
    },
  );
  t.mock.method(
    ManagedReservationAuditModel.prototype,
    "save",
    async function (options) {
      operations.push("audit-save");
      assert.equal(options.session, session);
      return this;
    },
  );
  t.mock.method(CloudinaryService, "uploadBuffer", async () => ({
    secureUrl: "https://example.test/proof.jpg",
    publicId: "wdp/signed-contracts/managed-proof",
    format: "jpg",
  }));

  const res = mockResponse();
  await ContractController.confirmSignedPaper(
    {
      params: { id: String(contract._id) },
      user: staff,
      file: { buffer: Buffer.from("test") },
      body: { paperContractNumber: "PAPER-01" },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(operations, [
    "reservation-cas",
    "contract-save",
    "audit-save",
  ]);
  assert.equal(contract.status, "SIGNED");
  assert.equal(
    contract.signedProofPublicId,
    "wdp/signed-contracts/managed-proof",
  );
  assert.equal(contract.signatures, signatures);
  assert.equal(reservation.inventoryVersion, 5);
});

test("Managed signed-paper confirmation rejects active closure before Cloudinary upload", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.ACTIVE,
    activeClosureRequestId: new mongoose.Types.ObjectId(),
  };
  const contract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservation._id,
    status: "SIGNED",
  };
  t.mock.method(ContractModel, "findById", async () => contract);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(CloudinaryService, "uploadBuffer", async () => {
    throw new Error("upload must not happen");
  });
  const res = mockResponse();
  await ContractController.confirmSignedPaper(
    {
      params: { id: String(contract._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
      file: { buffer: Buffer.from("test") },
      body: {},
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /pending closure/);
});

test("Managed signed-paper CAS conflict aborts Contract/audit writes and best-effort deletes the unattached proof", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.CONTRACTED,
    inventoryVersion: 3,
    activeClosureRequestId: null,
  };
  const contract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservation._id,
    status: "SIGNED",
    save: async () => {
      throw new Error("must not save Contract");
    },
  };
  const session = {
    withTransaction: async (work) => work(),
    endSession: async () => {},
  };
  let deletes = 0;
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(ContractModel, "findById", async () => contract);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => sessionQuery(reservation));
  t.mock.method(ContractModel, "findOne", () => sessionQuery(contract));
  t.mock.method(ReservationModel, "findOneAndUpdate", () => sessionQuery(null));
  t.mock.method(CloudinaryService, "uploadBuffer", async () => ({
    secureUrl: "https://example.test/proof.jpg",
    publicId: "wdp/signed-contracts/unattached-proof",
    format: "jpg",
  }));
  t.mock.method(CloudinaryService, "deleteAsset", async (publicId) => {
    assert.equal(publicId, "wdp/signed-contracts/unattached-proof");
    deletes += 1;
  });
  const res = mockResponse();
  await ContractController.confirmSignedPaper(
    {
      params: { id: String(contract._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
      file: { buffer: Buffer.from("test") },
      body: {},
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(deletes, 1);
});

test("Managed v2 signed-paper route cannot bypass versioned balance settlement", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: 2,
    status: ReservationStatus.DEPOSIT_PAID,
    activeClosureRequestId: null,
  };
  const contract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservation._id,
    status: "SIGNED",
  };
  t.mock.method(ContractModel, "findById", async () => contract);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(CloudinaryService, "uploadBuffer", async () => {
    throw new Error("upload must not happen");
  });
  const res = mockResponse();
  await ContractController.confirmSignedPaper(
    {
      params: { id: String(contract._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
      file: { buffer: Buffer.from("test") },
      body: {},
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(
    res.body.message,
    /versioned digital-signature and balance flow/,
  );
});

test("legacy generic mock confirmations refuse Managed V3 before starting a transaction", async t => {
  const reservation = { _id: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId(),
    serviceType: "MANAGED_INVENTORY", bookingFlowVersion: 3 };
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(mongoose, "startSession", async () => { throw new Error("legacy transaction must not run"); });
  const req = { params: { id: String(reservation._id) }, user: { _id: reservation.customerId, role: "CUSTOMER" } };
  for (const confirm of [ReservationController.confirmMockDeposit, ReservationController.confirmMockBalance]) {
    const res = mockResponse();
    await confirm(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /dedicated PayOS flow/);
  }
});

test("Managed V3 signed-paper route cannot bypass digital signatures or enter CHECKIN_READY", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: 3,
    status: ReservationStatus.DEPOSIT_PAID,
    activeClosureRequestId: null,
  };
  const contract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId: reservation._id,
    status: "SIGNED",
  };
  t.mock.method(ContractModel, "findById", async () => contract);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(CloudinaryService, "uploadBuffer", async () => {
    throw new Error("upload must not happen");
  });
  const res = mockResponse();
  await ContractController.confirmSignedPaper(
    {
      params: { id: String(contract._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
      file: { buffer: Buffer.from("test") },
      body: {},
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(
    res.body.message,
    /Managed V3 contracts require the versioned digital-signature flow/,
  );
});

test("Suite 7.5: Khách hàng nộp Balance thành công sau khi có bằng chứng -> Trừ cọc chuẩn xác, đơn sang PAID", async (t) => {
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "SELF_STORAGE",
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
    status: "SIGNED",
    signedProofUrl:
      "https://res.cloudinary.com/test/image/upload/v1/wdp/signed-contracts/sample.jpg",
  };

  let createdPayment = null;
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(ContractModel, "findOne", async () => signedContract);
  t.mock.method(ReservationPaymentModel, "create", async (doc) => {
    createdPayment = doc;
    return doc;
  });

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: customerAId, role: "CUSTOMER" },
  };
  const res = mockResponse();

  await ReservationController.confirmMockBalance(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationData.status, ReservationStatus.PAID);
  assert.equal(createdPayment.purpose, "BALANCE");
  assert.equal(createdPayment.amount, 1500000); // 3tr - 1.5tr cọc = 1.5tr
});

test("Managed legacy mock balance uses Reservation CAS before atomically saving a MOCK payment", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: 1,
    status: ReservationStatus.CHECKIN_READY,
    inventoryVersion: 7,
    activeClosureRequestId: null,
    estimatedRent: 3000000,
    depositAmount: 1500000,
    taxAmount: 0,
    discountAmount: 0,
    statusHistory: [],
  };
  const signedContract = {
    status: "SIGNED",
    signedProofUrl: "https://example.test/proof.jpg",
  };
  const operations = [];
  const session = {
    withTransaction: async (work, options) => {
      assert.equal(options.writeConcern.w, "majority");
      return work();
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => sessionQuery(reservation));
  t.mock.method(
    ReservationModel,
    "findOneAndUpdate",
    (filter, update, options) => {
      operations.push("reservation-cas");
      assert.equal(filter.activeClosureRequestId, null);
      assert.equal(filter.status, ReservationStatus.CHECKIN_READY);
      assert.ok(filter.$and.some((part) => part.inventoryVersion === 7));
      assert.equal(update.$inc.inventoryVersion, 1);
      assert.equal(update.$set.status, ReservationStatus.PAID);
      assert.equal(options.session, session);
      reservation.status = ReservationStatus.PAID;
      reservation.inventoryVersion += 1;
      reservation.balancePaymentId = update.$set.balancePaymentId;
      reservation.statusHistory.push(update.$push.statusHistory);
      return sessionQuery(reservation);
    },
  );
  t.mock.method(ContractModel, "findOne", () => sessionQuery(signedContract));
  t.mock.method(ReservationPaymentModel, "findOne", () => sessionQuery(null));
  t.mock.method(
    ReservationPaymentModel.prototype,
    "save",
    async function (options) {
      operations.push("payment-save");
      assert.equal(options.session, session);
      assert.equal(this.provider, "MOCK");
      assert.equal(this.status, "SUCCEEDED");
      return this;
    },
  );

  const res = mockResponse();
  await ReservationController.confirmMockBalance(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.deepEqual(operations, ["reservation-cas", "payment-save"]);
  assert.equal(res.body.data.reservation.inventoryVersion, 8);
});

test("Managed legacy mock balance fails closed when closure marker wins the Reservation CAS", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.CHECKIN_READY,
    inventoryVersion: 3,
    activeClosureRequestId: new mongoose.Types.ObjectId(),
    estimatedRent: 100,
    depositAmount: 10,
    statusHistory: [],
  };
  const session = {
    withTransaction: async (work) => work(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => sessionQuery(reservation));
  t.mock.method(ReservationModel, "findOneAndUpdate", (filter) => {
    assert.equal(filter.activeClosureRequestId, null);
    return sessionQuery(null);
  });
  t.mock.method(ContractModel, "findOne", () =>
    sessionQuery({
      status: "SIGNED",
      signedProofUrl: "https://example.test/proof.jpg",
    }),
  );
  t.mock.method(ReservationPaymentModel, "findOne", () => sessionQuery(null));
  t.mock.method(ReservationPaymentModel.prototype, "save", async () => {
    throw new Error("must not save payment");
  });

  const res = mockResponse();
  await ReservationController.confirmMockBalance(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /closure is pending/);
});

test("Managed legacy mock balance retry replays the committed payment without another CAS or payment write", async (t) => {
  const payment = {
    _id: new mongoose.Types.ObjectId(),
    status: "SUCCEEDED",
    purpose: "BALANCE",
  };
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.PAID,
    inventoryVersion: 8,
    balancePaymentId: payment._id,
  };
  const session = {
    withTransaction: async (work) => work(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => sessionQuery(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () =>
    sessionQuery(payment),
  );
  t.mock.method(ReservationModel, "findOneAndUpdate", async () => {
    throw new Error("replay must not acquire a new CAS");
  });
  t.mock.method(ReservationPaymentModel.prototype, "save", async () => {
    throw new Error("replay must not create a payment");
  });
  const res = mockResponse();
  await ReservationController.confirmMockBalance(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.payment, payment);
});

test("Managed legacy mock balance returns 503 for unresolved commit outcome instead of false success", async (t) => {
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: ReservationStatus.CHECKIN_READY,
    inventoryVersion: 0,
    estimatedRent: 100,
    depositAmount: 10,
    statusHistory: [],
  };
  const unknownCommit = Object.assign(new Error("commit status unknown"), {
    errorLabels: ["UnknownTransactionCommitResult"],
  });
  const session = {
    withTransaction: async () => {
      throw unknownCommit;
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(ReservationModel, "findOne", () => sessionQuery(reservation));
  t.mock.method(ReservationPaymentModel, "findOne", () => sessionQuery(null));
  t.mock.method(ContractModel, "findOne", () =>
    sessionQuery({ status: "SIGNED", signedProofUrl: "proof" }),
  );
  const res = mockResponse();
  await ReservationController.confirmMockBalance(
    {
      params: { id: String(reservation._id) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /outcome is uncertain/);
});

test("mock balance confirmation is disabled in production", async (t) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  t.after(() => {
    process.env.NODE_ENV = original;
  });
  const res = mockResponse();
  await ReservationController.confirmMockBalance(
    {
      params: { id: String(new mongoose.Types.ObjectId()) },
      user: { _id: customerAId, role: "CUSTOMER" },
    },
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /disabled in production/);
});

test("Suite 7.6: Staff thực hiện Handover sau khi đã thanh toán Balance (PAID) -> Đơn sang ACTIVE, Unit sang OCCUPIED, trả về PIN 1234", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: ReservationStatus.PAID,
    statusHistory: [],
    save: async () => reservationData,
  };

  let updatedUnit = null;
  const transactionSession = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => transactionSession);
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(StorageUnitModel, "findOne", (filter) => ({
    exec: async () => {
      assert.equal(String(filter._id), String(storageUnitId));
      assert.equal(String(filter.facilityId), String(facilityId));
      return {
        _id: storageUnitId,
        facilityId,
        status: "RESERVED",
        bookingVersion: 0,
      };
    },
  }));
  const writeOrder = [];
  t.mock.method(
    ReservationModel,
    "findOneAndUpdate",
    (filter, update, options) => ({
      exec: async () => {
        writeOrder.push("reservation");
        assert.equal(options.session, transactionSession);
        assert.ok(
          filter.$or.some((entry) => entry.__v === 0) &&
            filter.$or.some((entry) => entry.__v?.$exists === false),
          "legacy missing __v remains compatible",
        );
        assert.deepEqual(update.$inc, { __v: 1 });
        assert.equal(filter.serviceType, "SELF_STORAGE");
        assert.equal(filter.status, "PAID");
        assert.equal(String(filter.facilityId), String(facilityId));
        assert.equal(String(filter.storageUnitId), String(storageUnitId));
        reservationData.status = update.$set.status;
        reservationData.handoverByStaffId = update.$set.handoverByStaffId;
        reservationData.handoverAt = update.$set.handoverAt;
        reservationData.statusHistory.push(update.$push.statusHistory);
        return reservationData;
      },
    }),
  );
  let unitWrites = 0;
  t.mock.method(
    StorageUnitModel,
    "findOneAndUpdate",
    (filter, update, options) => ({
      exec: async () => {
        unitWrites++;
        writeOrder.push(
          unitWrites === 1 ? "storageUnit-token" : "storageUnit-status",
        );
        assert.equal(options.session, transactionSession);
        assert.equal(String(filter._id), String(storageUnitId));
        assert.equal(String(filter.facilityId), String(facilityId));
        if (unitWrites === 1) {
          assert.ok(filter.$or.some((entry) => entry.bookingVersion === 0));
          assert.deepEqual(update, { $inc: { bookingVersion: 1 } });
        } else {
          assert.equal(filter.bookingVersion, 1);
          assert.deepEqual(update, { $set: { status: "OCCUPIED" } });
          updatedUnit = update.$set;
        }
        return { _id: storageUnitId, facilityId, status: "OCCUPIED" };
      },
    }),
  );
  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: fmId, role: "FACILITY_STAFF", assignedFacilityId: facilityId },
  };
  const res = mockResponse();

  await ReservationController.handoverReservation(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationData.status, ReservationStatus.ACTIVE);
  assert.equal(updatedUnit.status, "OCCUPIED");
  assert.deepEqual(writeOrder, [
    "storageUnit-token",
    "reservation",
    "storageUnit-status",
  ]);
  assert.equal(res.body.data.pinCode, "1234");
});

test("handover is idempotent after a committed activation and does not write twice", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: "ACTIVE",
    handoverByStaffId: fmId,
    handoverAt: new Date(),
    statusHistory: [],
  };
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(StorageUnitModel, "findOne", () => ({
    exec: async () => ({ _id: storageUnitId, facilityId, status: "OCCUPIED" }),
  }));
  let sessions = 0,
    writes = 0;
  t.mock.method(mongoose, "startSession", async () => {
    sessions++;
    throw new Error("should not open transaction");
  });
  t.mock.method(ReservationModel, "findOneAndUpdate", () => {
    writes++;
    return { exec: async () => reservationData };
  });
  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => {
    writes++;
    return { exec: async () => ({}) };
  });
  const res = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(reservationData._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(sessions, 0);
  assert.equal(writes, 0);
});

test("handover rolls back StorageUnit write when Reservation CAS loses", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: "PAID",
  };
  const unitState = { status: "RESERVED", bookingVersion: 4 };
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(StorageUnitModel, "findOne", () => ({
    exec: async () => ({
      _id: storageUnitId,
      facilityId,
      status: unitState.status,
    }),
  }));
  const session = {
    withTransaction: async (callback) => {
      const before = { ...unitState };
      try {
        await callback();
      } catch (error) {
        Object.assign(unitState, before);
        throw error;
      }
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => {
      unitState.bookingVersion++;
      return {
        _id: storageUnitId,
        status: unitState.status,
        bookingVersion: unitState.bookingVersion,
      };
    },
  }));
  t.mock.method(ReservationModel, "findOneAndUpdate", () => ({
    exec: async () => null,
  }));
  const res = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(reservationData._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.deepEqual(unitState, { status: "RESERVED", bookingVersion: 4 });
});

test("handover StorageUnit CAS failure does not attempt Reservation activation", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: "PAID",
  };
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(StorageUnitModel, "findOne", () => ({
    exec: async () => ({
      _id: storageUnitId,
      facilityId,
      status: "RESERVED",
      bookingVersion: 3,
    }),
  }));
  const session = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => null,
  }));
  let reservationWrites = 0;
  t.mock.method(ReservationModel, "findOneAndUpdate", () => {
    reservationWrites++;
    return { exec: async () => reservationData };
  });
  const res = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(reservationData._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(reservationWrites, 0);
  assert.equal(reservationData.status, "PAID");
});

test("handover final StorageUnit write failure rolls back Reservation activation", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: "PAID",
    __v: 0,
    statusHistory: [],
  };
  const state = {
    unitStatus: "RESERVED",
    bookingVersion: 0,
    reservationStatus: "PAID",
    version: 0,
    history: [],
  };
  t.mock.method(ReservationModel, "findById", async () => ({
    ...reservationData,
    status: state.reservationStatus,
    __v: state.version,
    statusHistory: [...state.history],
  }));
  t.mock.method(StorageUnitModel, "findOne", () => ({
    exec: async () => ({
      _id: storageUnitId,
      facilityId,
      status: state.unitStatus,
      bookingVersion: state.bookingVersion,
    }),
  }));
  const session = {
    withTransaction: async (callback) => {
      const before = { ...state, history: [...state.history] };
      try {
        await callback();
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", async () => session);
  let unitWrites = 0;
  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => {
      unitWrites++;
      if (unitWrites === 1) {
        state.bookingVersion++;
        return { _id: storageUnitId };
      }
      return null;
    },
  }));
  t.mock.method(ReservationModel, "findOneAndUpdate", (_filter, update) => ({
    exec: async () => {
      state.reservationStatus = update.$set.status;
      state.version++;
      state.history.push(update.$push.statusHistory);
      return { ...reservationData, status: state.reservationStatus };
    },
  }));
  const res = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(reservationData._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(unitWrites, 2);
  assert.deepEqual(state, {
    unitStatus: "RESERVED",
    bookingVersion: 0,
    reservationStatus: "PAID",
    version: 0,
    history: [],
  });
});

test("handover returns 503 for unresolved unknown commit outcome", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: "PAID",
  };
  t.mock.method(ReservationModel, "findById", async () => reservationData);
  t.mock.method(StorageUnitModel, "findOne", (filter) => ({
    exec: async () =>
      filter.status === "OCCUPIED"
        ? null
        : {
            _id: storageUnitId,
            facilityId,
            status: "RESERVED",
            bookingVersion: 0,
          },
  }));
  const error = Object.assign(new Error("commit outcome unknown"), {
    errorLabels: ["UnknownTransactionCommitResult"],
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async () => {
      throw error;
    },
    endSession: async () => {},
  }));
  t.mock.method(StorageUnitModel, "findOneAndUpdate", () => ({
    exec: async () => ({}),
  }));
  t.mock.method(ReservationModel, "findOneAndUpdate", () => ({
    exec: async () => ({}),
  }));
  const res = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(reservationData._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 503);
});

test("Suite 7.7: Chặn Handover nếu đơn chưa hoàn tất thanh toán Balance (chưa PAID)", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservationData = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customerAId,
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: ReservationStatus.DEPOSIT_PAID, // Chưa trả Balance
  };

  t.mock.method(ReservationModel, "findById", async () => reservationData);

  const req = {
    params: { id: reservationData._id.toString() },
    user: { _id: fmId, role: "FACILITY_STAFF", assignedFacilityId: facilityId },
  };
  const res = mockResponse();

  await ReservationController.handoverReservation(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes("PAID"));
});

test("handover fails closed in production and unknown environments before Reservation access", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  let reads = 0;
  t.mock.method(ReservationModel, "findById", async () => {
    reads++;
    return null;
  });
  for (const env of ["production", undefined]) {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    const res = mockResponse();
    await ReservationController.handoverReservation(
      {
        params: { id: "handover-blocked" },
        user: {
          _id: fmId,
          role: "FACILITY_STAFF",
          assignedFacilityId: facilityId,
        },
      },
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /disabled in this environment/i);
  }
  assert.equal(reads, 0);
});

test("handover rejects Managed Inventory and cross-Facility actors before mutation", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const managed = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "MANAGED_INVENTORY",
    status: "PAID",
  };
  t.mock.method(ReservationModel, "findById", async () => managed);
  let saves = 0;
  managed.save = async () => {
    saves++;
  };
  const managedResponse = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(managed._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: facilityId,
      },
    },
    managedResponse,
  );
  assert.equal(managedResponse.statusCode, 409);
  assert.equal(saves, 0);

  managed.serviceType = "SELF_STORAGE";
  const wrongFacility = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(managed._id) },
      user: {
        _id: fmId,
        role: "FACILITY_STAFF",
        assignedFacilityId: new mongoose.Types.ObjectId(),
      },
    },
    wrongFacility,
  );
  assert.equal(wrongFacility.statusCode, 404);
  assert.equal(saves, 0);
});

test("handover rejects missing or cross-Facility StorageUnit before Reservation activation", async (t) => {
  const oldEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnv;
  });
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: "SELF_STORAGE",
    storageUnitId,
    status: "PAID",
  };
  let reservationWrites = 0;
  t.mock.method(ReservationModel, "findById", async () => reservation);
  t.mock.method(StorageUnitModel, "findOne", () => ({
    exec: async () => null,
  }));
  t.mock.method(ReservationModel, "findOneAndUpdate", () => {
    reservationWrites++;
    return { exec: async () => reservation };
  });
  const res = mockResponse();
  await ReservationController.handoverReservation(
    {
      params: { id: String(reservation._id) },
      user: {
        _id: fmId,
        role: "FACILITY_MANAGER",
        assignedFacilityId: facilityId,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(reservationWrites, 0);
  assert.equal(reservation.status, "PAID");
});
