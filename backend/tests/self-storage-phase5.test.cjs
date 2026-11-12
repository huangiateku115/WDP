const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';

const { ReservationStatus } = require('../dist/types/reservation.type');
const { ContractStatus } = require('../dist/types/contract.type');
const { StorageUnitStatus } = require('../dist/types/storage-unit.type');
const { UserRole } = require('../dist/types/user.type');
const { FacilityServiceType } = require('../dist/types/facility.type');

const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const ContractModel = require('../dist/models/contracts/contract.model').default;
const StorageUnitModel = require('../dist/models/storage-units/storage-unit.model').default;
const PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;
const AccessLogModel = require('../dist/models/access/access-log.model').default;

const ReservationController = require('../dist/controllers/reservations/reservation.controller');
const AccessController = require('../dist/controllers/access/access.controller');

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
// TASK T5.1: CHECKOUT REQUEST & QUEUE
// ============================================================================

test('Phase 5.1: Customer gửi yêu cầu trả kho thành công khi đơn đang ACTIVE', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const reservationDoc = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    statusHistory: [],
    save: async function () { return this; }
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);

  const req = {
    params: { id: reservationId.toString() },
    body: { note: 'Đã dọn sạch đồ' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.requestCheckout(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationDoc.checkoutRequest?.status, 'PENDING');
  assert.equal(reservationDoc.checkoutRequest?.note, 'Đã dọn sạch đồ');
});

test('Phase 5.1: Chặn Customer khác gửi yêu cầu trả kho cho đơn không thuộc sở hữu (HTTP 403)', async (t) => {
  const ownerId = new mongoose.Types.ObjectId();
  const otherCustomerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const reservationDoc = {
    _id: reservationId,
    customerId: ownerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    statusHistory: [],
    save: async function () { return this; }
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);

  const req = {
    params: { id: reservationId.toString() },
    body: {},
    user: { _id: otherCustomerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.requestCheckout(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test('Phase 5.1: Chặn yêu cầu trả kho khi đơn chưa ACTIVE (ví dụ còn ở PAID hoặc RESERVED)', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const reservationDoc = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.PAID,
    statusHistory: [],
    save: async function () { return this; }
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);

  const req = {
    params: { id: reservationId.toString() },
    body: {},
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.requestCheckout(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test('Phase 5.1: Staff tra cứu danh sách đơn chờ trả kho (Checkout Queue)', async (t) => {
  const facilityId = new mongoose.Types.ObjectId();
  const queueData = [
    { _id: new mongoose.Types.ObjectId(), status: ReservationStatus.ACTIVE, checkoutRequest: { status: 'PENDING' } }
  ];

  t.mock.method(ReservationModel, 'find', () => ({
    populate: () => ({
      populate: () => ({
        populate: () => ({
          sort: async () => queueData
        })
      })
    })
  }));

  const req = {
    query: {},
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF, assignedFacilityId: facilityId }
  };
  const res = mockResponse();

  await ReservationController.getCheckoutQueue(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
});

test('Phase 5.1: Staff từ chối yêu cầu trả kho khi kho còn đồ (yêu cầu bắt buộc lý do)', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const reservationDoc = {
    _id: reservationId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    checkoutRequest: { status: 'PENDING' },
    statusHistory: [],
    save: async function () { return this; }
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);

  const reqWithoutReason = {
    params: { id: reservationId.toString() },
    body: { reason: '   ' },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF }
  };
  const resWithoutReason = mockResponse();
  await ReservationController.rejectCheckout(reqWithoutReason, resWithoutReason);
  assert.equal(resWithoutReason.statusCode, 400);

  const req = {
    params: { id: reservationId.toString() },
    body: { reason: 'Kho còn nhiều thùng carton chưa dọn sạch' },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF }
  };
  const res = mockResponse();
  await ReservationController.rejectCheckout(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationDoc.checkoutRequest.status, 'CANCELLED');
});

test('Phase 5.1: Chặn duyệt checkout khi đơn chưa có yêu cầu trả kho PENDING (HTTP 400)', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservationDoc = {
    _id: reservationId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    checkoutRequest: null, // Chưa có yêu cầu
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);

  const req = {
    params: { id: reservationId.toString() },
    body: { condition: 'GOOD' },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF }
  };
  const res = mockResponse();
  await ReservationController.completeCheckout(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /chưa có yêu cầu trả kho/i);
});

// ============================================================================
// TASK T5.1: DUYỆT CHECKOUT ĐÚNG HẠN, SỚM HẠN & HƯ HẠI
// ============================================================================

test('Phase 5.1: Duyệt checkout ĐÚNG HẠN -> Contract EXPIRED, Unit AVAILABLE, thu hồi mã PIN', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  // Đơn hết hạn hôm nay (đúng hạn)
  const now = new Date();
  const reservationDoc = {
    _id: reservationId,
    reservationCode: 'BKG-ONTIME-01',
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    endDate: now,
    accessPinCode: '654321',
    checkoutRequest: { status: 'PENDING' },
    statusHistory: []
  };

  let updatedReservationStatus = null;
  let updatedContractStatus = null;
  let updatedUnitStatus = null;

  t.mock.method(ReservationModel, 'findById', (id) => {
    // Gọi lần 1 trong controller, lần 2 để populate return
    return {
      ...reservationDoc,
      populate: () => ({ populate: () => ({ exec: async () => reservationDoc }) })
    };
  });

  const transactionSession = {
    withTransaction: async (cb) => cb(),
    endSession: async () => {}
  };
  t.mock.method(mongoose, 'startSession', async () => transactionSession);

  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', (id, update) => ({
    exec: async () => {
      updatedUnitStatus = update.$set?.status;
      return { _id: id, status: updatedUnitStatus };
    }
  }));

  t.mock.method(ReservationModel, 'findByIdAndUpdate', (id, update) => ({
    exec: async () => {
      updatedReservationStatus = update.$set?.status;
      reservationDoc.status = updatedReservationStatus;
      return reservationDoc;
    }
  }));

  t.mock.method(ContractModel, 'findOneAndUpdate', (filter, update) => ({
    exec: async () => {
      updatedContractStatus = update.$set?.status;
      return { status: updatedContractStatus };
    }
  }));

  const req = {
    params: { id: reservationId.toString() },
    body: { condition: 'GOOD' },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF }
  };
  const res = mockResponse();

  await ReservationController.completeCheckout(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.isEarly, false, 'Phải xác định đúng hạn');
  assert.equal(res.body.data.contractStatus, ContractStatus.EXPIRED, 'Contract phải chuyển sang EXPIRED');
  assert.equal(res.body.data.unitStatus, StorageUnitStatus.AVAILABLE, 'Kho phải giải phóng về AVAILABLE');
  assert.equal(updatedReservationStatus, ReservationStatus.CHECKED_OUT);

  // Kiểm tra mã PIN bị vô hiệu hóa
  t.mock.method(ReservationModel, 'findOne', async () => reservationDoc);
  const unlockReq = {
    body: { reservationId: reservationId.toString(), pinCode: '654321' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const unlockRes = mockResponse();
  await AccessController.simulateUnlock(unlockReq, unlockRes);

  assert.equal(unlockRes.statusCode, 403, 'Đơn CHECKED_OUT phải bị từ chối mở cửa (403)');
});

test('Phase 5.1: Duyệt checkout SỚM HẠN -> Contract TERMINATED (không hoàn tiền), Unit AVAILABLE', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();

  // Còn 2 tháng nữa mới hết hạn (trả sớm)
  const futureEndDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const reservationDoc = {
    _id: reservationId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    endDate: futureEndDate,
    checkoutRequest: { status: 'PENDING' },
    statusHistory: []
  };

  t.mock.method(ReservationModel, 'findById', () => ({
    ...reservationDoc,
    populate: () => ({ populate: () => ({ exec: async () => reservationDoc }) })
  }));

  const transactionSession = {
    withTransaction: async (cb) => cb(),
    endSession: async () => {}
  };
  t.mock.method(mongoose, 'startSession', async () => transactionSession);
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(ReservationModel, 'findByIdAndUpdate', () => ({ exec: async () => ({}) }));

  let savedContractStatus = null;
  t.mock.method(ContractModel, 'findOneAndUpdate', (filter, update) => ({
    exec: async () => {
      savedContractStatus = update.$set?.status;
      return { status: savedContractStatus };
    }
  }));

  const req = {
    params: { id: reservationId.toString() },
    body: { condition: 'EXCELLENT' },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF }
  };
  const res = mockResponse();

  await ReservationController.completeCheckout(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.isEarly, true, 'Phải xác định là trả sớm (Early Checkout)');
  assert.equal(res.body.data.contractStatus, ContractStatus.TERMINATED, 'Hợp đồng trả sớm phải là TERMINATED');
  assert.equal(savedContractStatus, ContractStatus.TERMINATED);
  assert.equal(res.body.data.unitStatus, StorageUnitStatus.AVAILABLE);
});

test('Phase 5.1: Duyệt checkout ô kho BẨN/HƯ HẠI -> Unit chuyển sang MAINTENANCE', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();

  const reservationDoc = {
    _id: reservationId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    endDate: new Date(),
    checkoutRequest: { status: 'PENDING' },
    statusHistory: []
  };

  t.mock.method(ReservationModel, 'findById', () => ({
    ...reservationDoc,
    populate: () => ({ populate: () => ({ exec: async () => reservationDoc }) })
  }));

  const transactionSession = {
    withTransaction: async (cb) => cb(),
    endSession: async () => {}
  };
  t.mock.method(mongoose, 'startSession', async () => transactionSession);
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(ReservationModel, 'findByIdAndUpdate', () => ({ exec: async () => ({}) }));
  t.mock.method(ContractModel, 'findOneAndUpdate', () => ({ exec: async () => ({}) }));

  const req = {
    params: { id: reservationId.toString() },
    body: { condition: 'DAMAGED', damageFee: 200000 },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.FACILITY_STAFF }
  };
  const res = mockResponse();

  await ReservationController.completeCheckout(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.unitStatus, StorageUnitStatus.MAINTENANCE, 'Kho hư hại phải chuyển sang MAINTENANCE');
});

// ============================================================================
// TASK T5.2: GIA HẠN HỢP ĐỒNG (RENEWAL)
// ============================================================================

test('Phase 5.2: Báo giá gia hạn (Renew Quote) tính đúng tiền = monthlyPrice * số tháng', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const pricingPolicyId = new mongoose.Types.ObjectId();
  const currentEndDate = new Date('2026-12-11T00:00:00Z');

  const reservationDoc = {
    _id: reservationId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    pricingPolicyId,
    startDate: new Date('2026-11-11T00:00:00Z'),
    endDate: currentEndDate,
    estimatedRent: 1000000
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1000000 })
  }));

  // Thử báo giá 2 tháng
  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 2 },
    user: { _id: new mongoose.Types.ObjectId(), role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.renewQuote(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.durationMonths, 2);
  assert.equal(res.body.data.totalAmount, 2000000, '2 tháng phải có tổng tiền là 2.000.000 VND');
  const expectedNewEnd = new Date(currentEndDate);
  expectedNewEnd.setUTCMonth(expectedNewEnd.getUTCMonth() + 2);
  assert.equal(new Date(res.body.data.newEndDate).toISOString(), expectedNewEnd.toISOString());
});

test('Phase 5.2: Khách hàng thực hiện gia hạn (Renew) cộng dồn endDate, giữ nguyên hợp đồng và PIN', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const initialEndDate = new Date('2026-12-11T00:00:00Z');

  const reservationDoc = {
    _id: reservationId,
    reservationCode: 'BKG-RENEW-01',
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    startDate: new Date('2026-11-11T00:00:00Z'),
    endDate: initialEndDate,
    estimatedRent: 1000000,
    accessPinCode: '987654',
    renewals: [],
    statusHistory: [],
    save: async function () { return this; }
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationDoc);
  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({ price: 1000000 })
  }));

  let updatedContractSnapshotEndDate = null;
  t.mock.method(ContractModel, 'findOneAndUpdate', (filter, update) => ({
    exec: async () => {
      updatedContractSnapshotEndDate = update.$set?.['pricingSnapshot.endDate'];
      return { status: ContractStatus.SIGNED };
    }
  }));

  const req = {
    params: { id: reservationId.toString() },
    body: { durationMonths: 1 },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await ReservationController.renewReservation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(reservationDoc.renewals.length, 1, 'Phải lưu 1 bản ghi gia hạn');
  assert.equal(reservationDoc.renewals[0].durationMonths, 1);
  assert.equal(reservationDoc.renewals[0].amount, 1000000);

  const expectedNewEndDate = new Date(initialEndDate);
  expectedNewEndDate.setUTCMonth(expectedNewEndDate.getUTCMonth() + 1);
  assert.equal(new Date(reservationDoc.endDate).toISOString(), expectedNewEndDate.toISOString());
  assert.equal(new Date(updatedContractSnapshotEndDate).toISOString(), expectedNewEndDate.toISOString());

  // Kiểm tra mã PIN vẫn mở khóa được bình thường sau gia hạn
  t.mock.method(ReservationModel, 'findOne', async () => reservationDoc);
  t.mock.method(ContractModel, 'findOne', async () => ({ status: ContractStatus.SIGNED }));
  t.mock.method(StorageUnitModel, 'findById', async () => ({ status: StorageUnitStatus.OCCUPIED }));
  t.mock.method(AccessLogModel, 'create', async (logData) => ({ ...logData, _id: new mongoose.Types.ObjectId() }));

  const unlockReq = {
    body: { reservationId: reservationId.toString(), pinCode: '987654' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const unlockRes = mockResponse();
  await AccessController.simulateUnlock(unlockReq, unlockRes);

  assert.equal(unlockRes.statusCode, 200, 'Sau khi gia hạn, mã PIN vẫn mở cửa bình thường (200)');
  assert.equal(unlockRes.body.success, true);
});
