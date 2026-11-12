const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';

const { ReservationStatus } = require('../dist/types/reservation.type');
const { ContractStatus } = require('../dist/types/contract.type');
const { StorageUnitStatus } = require('../dist/types/storage-unit.type');
const { UserRole } = require('../dist/types/user.type');
const { FacilityServiceType } = require('../dist/types/facility.type');
const { AccessAction, AccessMethod } = require('../dist/types/access-log.type');

const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const ContractModel = require('../dist/models/contracts/contract.model').default;
const StorageUnitModel = require('../dist/models/storage-units/storage-unit.model').default;
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
// TASK T4.1: SINH MÃ PIN ĐỘNG 6 SỐ KHI BÀN GIAO KHO (HANDOVER)
// ============================================================================

test('Phase 4.1: HandoverReservation sinh mã PIN ngẫu nhiên 6 chữ số và lưu vào accessPinCode', async (t) => {
  const facilityId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const reservationData = {
    _id: reservationId,
    reservationCode: 'BKG-PHASE4-TEST',
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.PAID,
    statusHistory: [],
    __v: 0
  };

  const unitData = {
    _id: unitId,
    facilityId,
    status: StorageUnitStatus.AVAILABLE,
    bookingVersion: 0
  };

  let savedPin = null;

  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(StorageUnitModel, 'findOne', () => ({
    exec: async () => unitData
  }));

  const transactionSession = {
    withTransaction: async (cb) => cb(),
    endSession: async () => {}
  };
  t.mock.method(mongoose, 'startSession', async () => transactionSession);

  let unitUpdateStep = 0;
  t.mock.method(StorageUnitModel, 'findOneAndUpdate', () => ({
    exec: async () => {
      unitUpdateStep++;
      if (unitUpdateStep === 2) {
        unitData.status = StorageUnitStatus.OCCUPIED;
      }
      return unitData;
    }
  }));

  t.mock.method(ReservationModel, 'findOneAndUpdate', (filter, update) => ({
    exec: async () => {
      reservationData.status = update.$set.status;
      reservationData.accessPinCode = update.$set.accessPinCode;
      savedPin = update.$set.accessPinCode;
      return reservationData;
    }
  }));

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF, assignedFacilityId: facilityId }
  };
  const res = mockResponse();

  await ReservationController.handoverReservation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.data.pinCode, /^\d{6}$/, 'Mã PIN trả về phải gồm đúng 6 chữ số');
  assert.equal(savedPin, res.body.data.pinCode, 'Mã PIN lưu trong DB phải khớp với mã PIN trả về');
  assert.equal(reservationData.status, ReservationStatus.ACTIVE);
  assert.equal(unitData.status, StorageUnitStatus.OCCUPIED);
});

test('Phase 4.1: Handover idempotent giữ nguyên mã PIN đã sinh trước đó', async (t) => {
  const facilityId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const existingPin = '789123';
  const reservationData = {
    _id: reservationId,
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    handoverByStaffId: staffId,
    handoverAt: new Date(),
    accessPinCode: existingPin
  };

  t.mock.method(ReservationModel, 'findById', async () => reservationData);
  t.mock.method(StorageUnitModel, 'findOne', () => ({
    exec: async () => ({ _id: unitId, facilityId, status: StorageUnitStatus.OCCUPIED })
  }));

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF, assignedFacilityId: facilityId }
  };
  const res = mockResponse();

  await ReservationController.handoverReservation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.pinCode, existingPin, 'Phải giữ nguyên mã PIN 6 số cũ');
});

// ============================================================================
// TASK T4.2: SIMULATE UNLOCK VỚI MÃ PIN ĐỘNG & KIỂM TRA ĐIỀU KIỆN HỢP ĐỒNG
// ============================================================================

test('Phase 4.2: simulateUnlock mở cửa thành công khi nhập đúng mã PIN 6 số và mọi điều kiện thỏa mãn', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const validPin = '839201';

  const reservation = {
    _id: reservationId,
    reservationCode: 'BKG-UNLOCK-OK',
    customerId,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    accessPinCode: validPin,
    endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000)
  };

  const contract = {
    _id: new mongoose.Types.ObjectId(),
    reservationId,
    status: ContractStatus.SIGNED
  };

  const storageUnit = {
    _id: unitId,
    status: StorageUnitStatus.OCCUPIED
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);
  t.mock.method(ContractModel, 'findOne', async () => contract);
  t.mock.method(StorageUnitModel, 'findById', async () => storageUnit);

  let createdLog = null;
  t.mock.method(AccessLogModel, 'create', async (logData) => {
    createdLog = logData;
    return logData;
  });

  const req = {
    body: { reservationCode: 'BKG-UNLOCK-OK', pinCode: validPin },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, 'Mở cửa thành công!');
  assert.equal(createdLog.action, AccessAction.UNLOCK_SUCCESS);
  assert.equal(createdLog.accessMethod, AccessMethod.PIN_CODE);
});

test('Phase 4.2: simulateUnlock từ chối với HTTP 401 khi nhập sai mã PIN (hoặc nhập mã tĩnh 1234)', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const validPin = '839201';

  const reservation = {
    _id: reservationId,
    reservationCode: 'BKG-WRONG-PIN',
    customerId,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    accessPinCode: validPin,
    endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000)
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);
  t.mock.method(ContractModel, 'findOne', async () => ({ status: ContractStatus.SIGNED }));
  t.mock.method(StorageUnitModel, 'findById', async () => ({ status: StorageUnitStatus.OCCUPIED }));

  let createdLog = null;
  t.mock.method(AccessLogModel, 'create', async (logData) => {
    createdLog = logData;
    return logData;
  });

  // Thử nhập mã tĩnh cũ 1234 thay vì mã PIN 6 số đã cấp
  const req = {
    body: { reservationCode: 'BKG-WRONG-PIN', pinCode: '1234' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, 'Sai mã PIN');
  assert.equal(createdLog.action, AccessAction.UNLOCK_FAILED);
});

test('Phase 4.2: simulateUnlock từ chối với HTTP 403 khi đơn quá hạn thanh toán (OVERDUE)', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const reservation = {
    _id: reservationId,
    reservationCode: 'BKG-OVERDUE',
    customerId,
    storageUnitId: unitId,
    status: ReservationStatus.OVERDUE,
    accessPinCode: '839201'
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);

  let createdLog = null;
  t.mock.method(AccessLogModel, 'create', async (logData) => {
    createdLog = logData;
    return logData;
  });

  const req = {
    body: { reservationCode: 'BKG-OVERDUE', pinCode: '839201' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(createdLog.action, AccessAction.DENIED_OVERDUE);
});

test('Phase 4.2: simulateUnlock từ chối với HTTP 403 khi đơn chưa được bàn giao (status: PAID)', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-NOT-ACTIVE',
    customerId,
    status: ReservationStatus.PAID,
    accessPinCode: '839201'
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);

  const req = {
    body: { reservationCode: 'BKG-NOT-ACTIVE', pinCode: '839201' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 403);
  assert.ok(res.body.message.includes('chưa được kích hoạt'));
});

test('Phase 4.2: simulateUnlock từ chối với HTTP 403 khi hợp đồng chưa SIGNED', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-CONTRACT-DRAFT',
    customerId,
    status: ReservationStatus.ACTIVE,
    accessPinCode: '839201',
    endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000)
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);
  t.mock.method(ContractModel, 'findOne', async () => ({ status: ContractStatus.DRAFT }));

  const req = {
    body: { reservationCode: 'BKG-CONTRACT-DRAFT', pinCode: '839201' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 403);
  assert.ok(res.body.message.includes('Hợp đồng chưa được ký'));
});

test('Phase 4.2: simulateUnlock từ chối với HTTP 403 khi kho StorageUnit không ở trạng thái OCCUPIED', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-UNIT-AVAILABLE',
    customerId,
    storageUnitId: unitId,
    status: ReservationStatus.ACTIVE,
    accessPinCode: '839201',
    endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000)
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);
  t.mock.method(ContractModel, 'findOne', async () => ({ status: ContractStatus.SIGNED }));
  t.mock.method(StorageUnitModel, 'findById', async () => ({ status: StorageUnitStatus.AVAILABLE }));

  const req = {
    body: { reservationCode: 'BKG-UNIT-AVAILABLE', pinCode: '839201' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 403);
  assert.ok(res.body.message.includes('OCCUPIED'));
});

test('Phase 4.2: simulateUnlock từ chối với HTTP 403 khi hợp đồng đã hết hạn (endDate trong quá khứ)', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-EXPIRED-TERM',
    customerId,
    status: ReservationStatus.ACTIVE,
    accessPinCode: '839201',
    endDate: new Date(Date.now() - 3600 * 1000) // Hết hạn 1 giờ trước
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);
  t.mock.method(ContractModel, 'findOne', async () => ({ status: ContractStatus.SIGNED }));

  const req = {
    body: { reservationCode: 'BKG-EXPIRED-TERM', pinCode: '839201' },
    user: { _id: customerId, role: UserRole.CUSTOMER }
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 403);
  assert.ok(res.body.message.includes('đã kết thúc'));
});

test('Phase 4.2: simulateUnlock chặn Customer khác mở khóa trộm kho (HTTP 403)', async (t) => {
  const customerA = new mongoose.Types.ObjectId();
  const customerB = new mongoose.Types.ObjectId();

  const reservation = {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-OWNER-CHECK',
    customerId: customerA,
    status: ReservationStatus.ACTIVE,
    accessPinCode: '839201'
  };

  t.mock.method(ReservationModel, 'findOne', async () => reservation);

  const req = {
    body: { reservationCode: 'BKG-OWNER-CHECK', pinCode: '839201' },
    user: { _id: customerB, role: UserRole.CUSTOMER } // Customer B gọi
  };
  const res = mockResponse();

  await AccessController.simulateUnlock(req, res);

  assert.equal(res.statusCode, 403);
  assert.ok(res.body.message.includes('không có quyền'));
});

// ============================================================================
// TASK T4.3: NGÀY BẮT ĐẦU CỐ ĐỊNH TỪ HÔM NAY (START_DATE = TODAY)
// ============================================================================

test('Phase 4.3: calculatePricing và createReservation chấp nhận ngày bắt đầu là hôm nay (startDate = TODAY)', async (t) => {
  const { ReservationService } = require('../dist/services/reservations/reservation.service');
  const PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;
  const pricingId = new mongoose.Types.ObjectId();

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({
      _id: pricingId,
      price: 1500000,
      version: 1,
      currency: 'VND',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      isActive: true,
      term: { value: 1, unit: 'MONTH' }
    })
  }));

  const today = new Date();
  const nextMonth = new Date(today.getTime() + 30 * 24 * 3600 * 1000);

  const pricing = await ReservationService.calculatePricing(
    pricingId.toString(),
    today,
    nextMonth
  );

  assert.equal(pricing.basePrice, 1500000);
  assert.equal(pricing.estimatedRent, 1500000);
  assert.equal(pricing.depositAmount, 1500000);
  assert.ok(pricing.durationDays >= 30);
});

// ============================================================================
// TASK T4.5: NHÂN LŨY TIẾN GIÁ TIỀN CHO CÁC KỲ HẠN 1, 2, 3, 4, 5, 6 THÁNG
// ============================================================================

test('Phase 4.5: calculatePricing nhân tiền thuê đúng theo số tháng (1, 2, 3, 4, 5, 6 tháng)', async (t) => {
  const { ReservationService } = require('../dist/services/reservations/reservation.service');
  const PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;
  const pricingId = new mongoose.Types.ObjectId();
  const baseMonthlyPrice = 1000000;

  t.mock.method(PricingRuleModel, 'findById', () => ({
    exec: async () => ({
      _id: pricingId,
      price: baseMonthlyPrice,
      version: 1,
      currency: 'VND',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      isActive: true,
      term: { value: 1, unit: 'MONTH' }
    })
  }));

  const start = new Date('2026-11-11T00:00:00.000Z');

  // Kiểm tra lần lượt các mốc 1, 2, 3, 4, 5, 6 tháng (mỗi tháng 30 ngày)
  for (let month = 1; month <= 6; month++) {
    const end = new Date(start.getTime() + (month * 30) * 24 * 3600 * 1000);
    const pricing = await ReservationService.calculatePricing(pricingId.toString(), start, end);

    const expectedRent = month * baseMonthlyPrice;
    assert.equal(
      pricing.estimatedRent,
      expectedRent,
      `Kỳ hạn ${month} tháng phải có tiền thuê là ${expectedRent} (nhân ${month} lần đơn giá cơ sở)`
    );
    assert.equal(pricing.durationDays, month * 30);
  }
});

test('Phase 4.5: RuleService.resolve lấy đúng theo policy, không tự fallback kỳ hạn không có trong policy', async (t) => {
  const { RuleService } = require('../dist/services/pricing-policy/rule.service');
  const PricingRuleModel = require('../dist/models/pricing-policy/pricing-rule.model').default;
  const facilityId = new mongoose.Types.ObjectId();
  const ruleService = new RuleService('pricing');

  const baseRule = {
    _id: new mongoose.Types.ObjectId(),
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    unitSize: 'SMALL',
    price: 1200000,
    currency: 'VND',
    term: { value: 1, unit: 'MONTH' },
    isActive: true,
    version: 1,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z')
  };

  t.mock.method(PricingRuleModel, 'find', (filter) => ({
    lean: () => ({
      exec: async () => {
        // Chỉ trả về baseRule khi term.value khớp với cấu hình trong policy (term.value = 1)
        if (filter['term.value'] === 1) return [baseRule];
        return [];
      }
    })
  }));

  const adminActor = { role: UserRole.ADMIN, _id: new mongoose.Types.ObjectId() };

  // Resolve đúng kỳ hạn 1 tháng đã cấu hình trong policy
  const resolved = await ruleService.resolve({
    facilityId: facilityId.toString(),
    serviceType: 'SELF_STORAGE',
    unitSize: 'SMALL',
    termValue: '1',
    termUnit: 'MONTH',
    at: '2026-11-11T00:00:00.000Z'
  }, adminActor);

  assert.equal(resolved._id.toString(), baseRule._id.toString());
  assert.equal(resolved.price, 1200000);
  assert.equal(resolved.term.value, 1);

  // Truy vấn kỳ hạn 3 tháng chưa có trong policy -> Không tự gán, ném lỗi 404 No effective rule
  await assert.rejects(
    () => ruleService.resolve({
      facilityId: facilityId.toString(),
      serviceType: 'SELF_STORAGE',
      unitSize: 'SMALL',
      termValue: '3',
      termUnit: 'MONTH',
      at: '2026-11-11T00:00:00.000Z'
    }, adminActor),
    { status: 404, message: 'No effective rule' }
  );
});

