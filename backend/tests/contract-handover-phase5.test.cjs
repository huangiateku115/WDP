const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Managed signing deadline uses Ho Chi Minh calendar days and an exclusive midnight', () => {
  const { managedSigningDeadline } = require('../dist/utils/managed-signing-deadline');
  const deadline = managedSigningDeadline(new Date('2026-11-11T17:00:00.000Z'));
  assert.equal(deadline.toISOString(), '2026-11-15T17:00:00.000Z');
  assert.ok(Date.parse('2026-11-15T16:59:59.999Z') < deadline.getTime());
  assert.equal(Date.parse('2026-11-15T17:00:00.000Z'), deadline.getTime());
  assert.throws(() => managedSigningDeadline(new Date('invalid')), /valid rental start date/);
});

test('Full-upfront signing SLA query is excluded from the legacy auto-cancel job', async () => {
  const ReservationModel = require('../dist/models/reservations/reservation.model').default;
  const { checkSigningSla } = require('../dist/jobs/signing-sla-checker.job');
  const originalFind = ReservationModel.find;
  let observed;
  try {
    ReservationModel.find = query => {
      observed = query;
      return { exec: async () => [] };
    };
    const result = await checkSigningSla(new Date('2026-11-15T17:00:00.000Z'));
    assert.deepEqual(observed.rentalPaymentFlow, { $ne: 'FULL_UPFRONT_V1' });
    assert.equal(result.processedCount, 0);
  } finally {
    ReservationModel.find = originalFind;
  }
});

test('Full-upfront paper verification requires a real uploaded evidence file', async () => {
  const ContractModel = require('../dist/models/contracts/contract.model').default;
  const ReservationModel = require('../dist/models/reservations/reservation.model').default;
  const { confirmSignedPaper } = require('../dist/controllers/contracts/contract.controller');
  const originalContractFind = ContractModel.findById;
  const originalReservationFind = ReservationModel.findById;
  const facilityId = '111111111111111111111111';
  try {
    ContractModel.findById = async () => ({ _id: '222222222222222222222222', reservationId: '333333333333333333333333' });
    ReservationModel.findById = async () => ({ rentalPaymentFlow: 'FULL_UPFRONT_V1', serviceType: 'SELF_STORAGE',
      termsAcceptance: { serviceType: 'SELF_STORAGE' }, facilityId });
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await confirmSignedPaper({ params: { id: '222222222222222222222222' }, user: { role: 'FACILITY_STAFF', _id: '444444444444444444444444', assignedFacilityId: facilityId }, body: {} }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /tải lên.*hợp đồng giấy/i);
  } finally {
    ContractModel.findById = originalContractFind;
    ReservationModel.findById = originalReservationFind;
  }
});
