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

test('legacy signing SLA processes only expired unsigned legacy Self Storage and excludes Full Upfront', async () => {
  const ReservationModel = require('../dist/models/reservations/reservation.model').default;
  const ContractModel = require('../dist/models/contracts/contract.model').default;
  const { EmailService } = require('../dist/services/email/email.service');
  const { checkSigningSla } = require('../dist/jobs/signing-sla-checker.job');
  const originalFind = ReservationModel.find;
  const originalContractFind = ContractModel.find;
  const originalContractUpdate = ContractModel.findOneAndUpdate;
  const originalSlaEmail = EmailService.sendSigningSlaExpiredRentalEmail;
  const queries = [];
  const checkTime = new Date('2026-11-15T17:00:00.000Z');
  const pastDeadline = new Date(checkTime.getTime() - 1000);
  const futureDeadline = new Date(checkTime.getTime() + 60_000);
  const legacy = { _id: 'legacy', reservationCode: 'LEGACY-SLA', serviceType: 'SELF_STORAGE', status: 'PAID',
    signingDeadline: pastDeadline, paperContractProofUrl: undefined, statusHistory: [], async save() { return this; } };
  const fullUpfront = { _id: 'full-upfront', reservationCode: 'FULL-UPFRONT', serviceType: 'SELF_STORAGE', status: 'PAID',
    rentalPaymentFlow: 'FULL_UPFRONT_V1', signingDeadline: pastDeadline, paperContractProofUrl: undefined, statusHistory: [], async save() { throw Error('must not be processed'); } };
  const signed = { _id: 'signed', reservationCode: 'SIGNED', serviceType: 'SELF_STORAGE', status: 'PAID',
    signingDeadline: pastDeadline, paperContractProofUrl: 'signed-evidence', statusHistory: [], async save() { throw Error('must not be processed'); } };
  const digitallySignedContractReservation = { _id: 'contract-signed', reservationCode: 'CONTRACT-SIGNED', serviceType: 'SELF_STORAGE', status: 'PAID',
    signingDeadline: pastDeadline, paperContractProofUrl: undefined, statusHistory: [], async save() { throw Error('signed Contract must not be processed'); } };
  const notExpired = { _id: 'not-expired', serviceType: 'SELF_STORAGE', status: 'PAID', signingDeadline: futureDeadline,
    paperContractProofUrl: undefined, statusHistory: [], async save() { throw Error('must not be processed'); } };
  const wrongStatus = { _id: 'wrong-status', serviceType: 'SELF_STORAGE', status: 'CONTRACTED', signingDeadline: pastDeadline,
    paperContractProofUrl: undefined, statusHistory: [], async save() { throw Error('must not be processed'); } };
  const managedLegacy = { _id: 'managed', serviceType: 'MANAGED_INVENTORY', status: 'PAID', signingDeadline: pastDeadline,
    paperContractProofUrl: undefined, statusHistory: [], async save() { throw Error('must not be processed'); } };
  const candidates = [legacy, fullUpfront, signed, digitallySignedContractReservation, notExpired, wrongStatus, managedLegacy];
  try {
    ReservationModel.find = query => {
      queries.push(query);
      if (!query.serviceType) return { exec: async () => [] }; // The separate extension scan has its own lifecycle.
      const selected = candidates.filter(row => row.serviceType === query.serviceType && row.status === query.status &&
        (!query.rentalPaymentFlow?.$ne || row.rentalPaymentFlow !== query.rentalPaymentFlow.$ne) &&
        row.signingDeadline <= query.signingDeadline.$lte &&
        (query.paperContractProofUrl.$in.includes(row.paperContractProofUrl) || row.paperContractProofUrl == null));
      return { exec: async () => selected };
    };
    ContractModel.find = query => ({
      select(fields) { assert.equal(fields, 'reservationId'); return this; },
      lean() { return this; },
      exec: async () => {
        assert.equal(query.status, 'SIGNED');
        assert.ok(query.reservationId.$in.includes(digitallySignedContractReservation._id));
        return [{ reservationId: digitallySignedContractReservation._id }];
      },
    });
    ContractModel.findOneAndUpdate = async () => ({});
    EmailService.sendSigningSlaExpiredRentalEmail = async () => true;
    const result = await checkSigningSla(checkTime);
    assert.deepEqual(queries[0].rentalPaymentFlow, { $ne: 'FULL_UPFRONT_V1' });
    assert.equal(queries[0].serviceType, 'SELF_STORAGE');
    assert.equal(queries.length, 2);
    assert.equal(result.processedCount, 1);
    assert.equal(legacy.status, 'CANCELLED'); // Historical records without rentalPaymentFlow remain legacy-compatible.
    assert.equal(fullUpfront.status, 'PAID');
    assert.equal(signed.status, 'PAID');
    assert.equal(signed.paperContractProofUrl, 'signed-evidence');
    assert.equal(digitallySignedContractReservation.status, 'PAID');
    assert.equal(notExpired.status, 'PAID');
    assert.equal(wrongStatus.status, 'CONTRACTED');
    assert.equal(managedLegacy.status, 'PAID'); // Managed lifecycle is outside this Self Storage job.
    const replay = await checkSigningSla(checkTime);
    assert.equal(replay.processedCount, 0); // A completed legacy transition is not selected again on a later run.
  } finally {
    ReservationModel.find = originalFind;
    ContractModel.find = originalContractFind;
    ContractModel.findOneAndUpdate = originalContractUpdate;
    EmailService.sendSigningSlaExpiredRentalEmail = originalSlaEmail;
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
