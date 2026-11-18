const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ContractModel = require('../dist/models/contracts/contract.model').default;
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const { CloudinaryService } = require('../dist/services/upload/cloudinary.service');
const { confirmSignedPaper } = require('../dist/controllers/contracts/contract.controller');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('contract metadata save failure logs sanitized stage and preserves failure response without attaching reservation proof', async t => {
  const contractId = new mongoose.Types.ObjectId();
  const contract = { _id: contractId, reservationId: new mongoose.Types.ObjectId(), status: 'DRAFT', save: async () => { throw Object.assign(
    new Error('TEST_PRIVATE_CONTRACT TEST_SECRET_TOKEN TEST_OTP_123456 private-user@example.test'),
    { code: 'ETIMEDOUT', cause: { token: 'TEST_SECRET_TOKEN', document: { body: 'TEST_PRIVATE_CONTRACT' } } },
  ); } };
  let reservationSaveCalls = 0;
  const reservation = { _id: contract.reservationId, serviceType: 'SELF_STORAGE', status: 'PAID', statusHistory: [],
    save: async () => { reservationSaveCalls += 1; } };
  t.mock.method(ContractModel, 'findById', async () => contract);
  t.mock.method(ReservationModel, 'findById', async () => reservation);
  let correlationId;
  t.mock.method(CloudinaryService, 'uploadBuffer', async (_buffer, _folder, id) => {
    correlationId = id;
    return { secureUrl: 'https://cloudinary.test/proof.jpg', publicId: 'offline/proof', format: 'jpg' };
  });
  let line;
  t.mock.method(console, 'error', value => { line = value; });

  const res = response();
  await confirmSignedPaper({ params: { id: String(contractId) }, user: { _id: new mongoose.Types.ObjectId(), role: 'FACILITY_STAFF' },
    file: { buffer: Buffer.from('offline image') }, body: {} }, res);

  assert.equal(res.statusCode, 500);
  assert.match(res.body.message, /TEST_PRIVATE_CONTRACT/); // Existing response semantics are preserved.
  assert.equal(res.body.success, false);
  assert.equal(reservationSaveCalls, 0);
  const event = JSON.parse(line);
  assert.equal(event.operation, 'contract.confirm_signed_paper');
  assert.equal(event.stage, 'metadata_persistence');
  assert.equal(event.provider, 'mongodb');
  assert.equal(event.entityType, 'Contract');
  assert.equal(event.correlationId, correlationId);
  for (const secret of ['TEST_SECRET_TOKEN', 'TEST_PRIVATE_CONTRACT', 'TEST_OTP_123456', 'private-user@example.test']) {
    assert.equal(line.includes(secret), false);
  }
});

test('contract metadata save success returns existing response and does not emit failure log', async t => {
  const contract = { _id: new mongoose.Types.ObjectId(), reservationId: new mongoose.Types.ObjectId(), status: 'DRAFT', async save() { return this; } };
  const reservation = { _id: contract.reservationId, serviceType: 'SELF_STORAGE', status: 'PAID', statusHistory: [], async save() { return this; } };
  t.mock.method(ContractModel, 'findById', async () => contract);
  t.mock.method(ReservationModel, 'findById', async () => reservation);
  t.mock.method(CloudinaryService, 'uploadBuffer', async () => ({ secureUrl: 'https://cloudinary.test/proof.jpg', publicId: 'offline/proof', format: 'jpg' }));
  const lines = [];
  t.mock.method(console, 'error', value => lines.push(value));
  const res = response();
  await confirmSignedPaper({ params: { id: String(contract._id) }, user: { _id: new mongoose.Types.ObjectId(), role: 'FACILITY_STAFF' },
    file: { buffer: Buffer.from('offline image') }, body: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(lines.length, 0);
});
