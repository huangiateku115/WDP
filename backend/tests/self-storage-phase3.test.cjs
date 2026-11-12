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

const ReservationController = require('../dist/controllers/reservations/reservation.controller');
const ContractController = require('../dist/controllers/contracts/contract.controller');
const { checkSigningSla } = require('../dist/jobs/signing-sla-checker.job');
const { CloudinaryService } = require('../dist/services/upload/cloudinary.service');

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
// TASK T3.1: HỦY ĐƠN TRƯỚC KHI KÝ (KHÔNG ƯNG KHO) -> HOÀN 100% NGOÀI HỆ THỐNG
// ============================================================================

test('Phase 3.1: Chặn Customer tự hủy đơn PAID và bắt buộc Staff cung cấp lý do khi từ chối nhận kho', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const facilityId = new mongoose.Types.ObjectId();

  const mockRes = {
    _id: reservationId,
    reservationCode: 'BKG-TEST-REJECT',
    customerId,
    facilityId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.PAID,
    paperContractProofUrl: undefined
  };

  t.mock.method(ReservationModel, 'findById', async () => mockRes);

  let updatedStatus = null;
  let penalty = null;
  t.mock.method(ReservationModel, 'findByIdAndUpdate', async (id, update) => {
    updatedStatus = update.$set.status;
    penalty = update.$set.refundPenaltyPercent;
    return { ...mockRes, status: updatedStatus, refundPenaltyPercent: penalty };
  });

  let unitAvailable = false;
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', async (id, update) => {
    if (update.$set.status === StorageUnitStatus.AVAILABLE) unitAvailable = true;
    return {};
  });

  let contractTerminated = false;
  t.mock.method(ContractModel, 'findOneAndUpdate', async (filter, update) => {
    if (update.$set.status === ContractStatus.TERMINATED) contractTerminated = true;
    return {};
  });

  // 1. Customer tự gọi hủy đơn PAID -> Phải bị chặn với 403
  const reqCustomer = {
    params: { id: reservationId.toString() },
    user: { _id: customerId, role: UserRole.CUSTOMER },
    body: { reason: 'Khách đổi ý' }
  };
  const resCustomer = mockResponse();
  await ReservationController.cancelReservation(reqCustomer, resCustomer);
  assert.equal(resCustomer.statusCode, 403);
  assert.match(resCustomer.body.message, /Khách hàng không thể tự hủy/);

  // 2. Staff từ chối nhận kho nhưng KHÔNG nhập lý do -> Phải trả về 400
  const reqStaffNoReason = {
    params: { id: reservationId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF },
    body: { reason: '   ' }
  };
  const resStaffNoReason = mockResponse();
  await ReservationController.cancelReservation(reqStaffNoReason, resStaffNoReason);
  assert.equal(resStaffNoReason.statusCode, 400);
  assert.match(resStaffNoReason.body.message, /Vui lòng cung cấp lý do từ chối/);

  // 3. Staff từ chối nhận kho với lý do hợp lệ -> Thành công 200, kho về AVAILABLE, hợp đồng TERMINATED
  const reqStaff = {
    params: { id: reservationId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF },
    body: { reason: 'Khách hàng không ưng ý diện tích kho thực tế' }
  };
  const resStaff = mockResponse();
  await ReservationController.cancelReservation(reqStaff, resStaff);

  assert.equal(resStaff.statusCode, 200);
  assert.equal(resStaff.body.success, true);
  assert.equal(updatedStatus, ReservationStatus.CANCELLED);
  assert.equal(penalty, 0); // Hoàn 100% ngoài hệ thống
  assert.equal(unitAvailable, true);
  assert.equal(contractTerminated, true);
});

test('Phase 3.2: Chặn hủy đơn sau khi đã ký hợp đồng hoặc đã ACTIVE', async (t) => {
  const customerId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const activeRes = {
    _id: reservationId,
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    paperContractProofUrl: 'https://cloudinary.com/proof.jpg'
  };

  t.mock.method(ReservationModel, 'findById', async () => activeRes);

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: customerId, role: UserRole.CUSTOMER },
    body: {}
  };
  const res = mockResponse();

  await ReservationController.cancelReservation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Không thể hủy đơn sau khi đã ký/);
});

// ============================================================================
// TASK T3.2: CRON-JOB QUÉT ĐƠN QUÁ HẠN 3 NGÀY (SLA) -> PHẠT 10%, HOÀN 90%
// ============================================================================

test('Phase 3.3: checkSigningSla hủy đơn quá 3 ngày, phạt 10% và giải phóng kho', async (t) => {
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const pastDeadline = new Date(Date.now() - 3600 * 1000); // 1 hour ago

  const expiredReservation = {
    _id: reservationId,
    reservationCode: 'BKG-EXPIRED-SLA',
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.PAID,
    storageUnitId: unitId,
    signingDeadline: pastDeadline,
    paperContractProofUrl: undefined,
    statusHistory: [],
    save: async () => expiredReservation
  };

  t.mock.method(ReservationModel, 'find', () => ({
    exec: async () => [expiredReservation]
  }));

  let unitFreed = false;
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', async (id, update) => {
    if (update.$set.status === StorageUnitStatus.AVAILABLE) unitFreed = true;
    return {};
  });

  let contractCancelled = false;
  t.mock.method(ContractModel, 'findOneAndUpdate', async (filter, update) => {
    if (update.$set.status === ContractStatus.TERMINATED) contractCancelled = true;
    return {};
  });

  const result = await checkSigningSla();

  assert.equal(result.processedCount, 1);
  assert.equal(expiredReservation.status, ReservationStatus.CANCELLED);
  assert.equal(expiredReservation.cancellationReason, 'SIGNING_SLA_EXPIRED');
  assert.equal(expiredReservation.refundPenaltyPercent, 10); // Phạt 10% giữ kho
  assert.equal(unitFreed, true);
  assert.equal(contractCancelled, true);
});

// ============================================================================
// TASK T3.3: STAFF XÁC NHẬN HỢP ĐỒNG GIẤY CHO ĐƠN PAID (GIỮ NGUYÊN STATUS PAID)
// ============================================================================

test('Phase 3.4: confirmSignedPaper cho đơn PAID lưu ảnh HĐ giấy và giữ trạng thái PAID', async (t) => {
  const staffId = new mongoose.Types.ObjectId();
  const contractId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();

  const mockContract = {
    _id: contractId,
    reservationId,
    status: ContractStatus.DRAFT,
    save: async () => mockContract
  };

  const mockReservation = {
    _id: reservationId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.PAID,
    statusHistory: [],
    save: async () => mockReservation
  };

  t.mock.method(ContractModel, 'findById', async () => mockContract);
  t.mock.method(ReservationModel, 'findById', async () => mockReservation);
  t.mock.method(CloudinaryService, 'uploadBuffer', async () => ({
    secureUrl: 'https://cloudinary.com/test-signed.jpg',
    publicId: 'wdp/signed-contracts/test-signed',
    format: 'jpg'
  }));

  const req = {
    params: { id: contractId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF },
    file: { buffer: Buffer.from('fake image data') },
    body: { paperContractNumber: 'HĐ-SS-2026-001' }
  };
  const res = mockResponse();

  await ContractController.confirmSignedPaper(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(mockContract.status, ContractStatus.SIGNED);
  assert.equal(mockContract.signedProofUrl, 'https://cloudinary.com/test-signed.jpg');
  assert.equal(mockReservation.status, ReservationStatus.PAID); // Vẫn là PAID để sẵn sàng bàn giao
  assert.equal(mockReservation.paperContractProofUrl, 'https://cloudinary.com/test-signed.jpg');
});

test('Phase 3.5: cancelReservation giải phóng bookingIdempotencyKey và findBookingReplay bỏ qua đơn CANCELLED', async (t) => {
  const staffId = new mongoose.Types.ObjectId();
  const reservationId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  const mockRes = {
    _id: reservationId,
    reservationCode: 'BKG-TEST-CANCEL-IDEMP',
    customerId,
    serviceType: FacilityServiceType.SELF_STORAGE,
    storageUnitId: unitId,
    status: ReservationStatus.PAID,
    bookingIdempotencyKey: 'wdp-booking-test-key-12345678',
    bookingPayloadHash: 'hash123'
  };

  t.mock.method(ReservationModel, 'findById', async () => mockRes);

  let unsetFields = null;
  t.mock.method(ReservationModel, 'findByIdAndUpdate', async (id, update) => {
    unsetFields = update.$unset;
    return { ...mockRes, status: ReservationStatus.CANCELLED };
  });
  t.mock.method(StorageUnitModel, 'findByIdAndUpdate', async () => ({}));
  t.mock.method(ContractModel, 'findOneAndUpdate', async () => ({}));

  const req = {
    params: { id: reservationId.toString() },
    user: { _id: staffId, role: UserRole.FACILITY_STAFF },
    body: { reason: 'Khách không ưng ý kho' }
  };
  const res = mockResponse();

  await ReservationController.cancelReservation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(unsetFields?.bookingIdempotencyKey, 1, 'cancelReservation phải unset bookingIdempotencyKey');

  // Kiểm tra findBookingReplay bỏ qua đơn CANCELLED
  const { ReservationService } = require('../dist/services/reservations/reservation.service');
  t.mock.method(ReservationModel, 'findOne', () => ({
    session: () => ({
      exec: async () => ({ ...mockRes, status: ReservationStatus.CANCELLED, bookingPayloadHash: 'hash123' })
    }),
    exec: async () => ({ ...mockRes, status: ReservationStatus.CANCELLED, bookingPayloadHash: 'hash123' })
  }));

  const replay = await ReservationService.findBookingReplay(customerId.toString(), 'wdp-booking-test-key-12345678', 'hash123');
  assert.equal(replay, null, 'findBookingReplay phải trả về null khi đơn đã CANCELLED');
});
