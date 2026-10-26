const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Request = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const Event = require('../dist/models/inventory-items/inventory-inbound-request-event.model').default;
const { RepeatedInboundOperationsService: service, RepeatedInboundError } = require('../dist/services/inventory-items/repeated-inbound-operations.service');

class Query {
  session() { return this; }
  lean() { return this; }
  exec() { return Promise.resolve(null); }
}

test('Staff idempotent replays first revalidate current Facility scope for inspect, return and confirm', async t => {
  const previous = { nodeEnv: process.env.NODE_ENV, repeated: process.env.MI06_REPEATED_INBOUND_ENABLED, ledger: process.env.MI06_STOCK_LEDGER_WRITES_ENABLED };
  process.env.NODE_ENV = 'test';
  process.env.MI06_REPEATED_INBOUND_ENABLED = 'true';
  process.env.MI06_STOCK_LEDGER_WRITES_ENABLED = 'true';
  t.after(() => {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.repeated === undefined) delete process.env.MI06_REPEATED_INBOUND_ENABLED; else process.env.MI06_REPEATED_INBOUND_ENABLED = previous.repeated;
    if (previous.ledger === undefined) delete process.env.MI06_STOCK_LEDGER_WRITES_ENABLED; else process.env.MI06_STOCK_LEDGER_WRITES_ENABLED = previous.ledger;
  });
  const requestId = new mongoose.Types.ObjectId().toString();
  const actor = { _id: new mongoose.Types.ObjectId(), role: 'FACILITY_STAFF', assignedFacilityId: new mongoose.Types.ObjectId() };
  let eventLookups = 0;
  t.mock.method(Request, 'findOne', () => new Query());
  t.mock.method(Event, 'findOne', () => { eventLookups += 1; return new Query(); });
  const cases = [
    () => service.inspect(requestId, { decision: 'REJECTED', receivedQuantity: 1, actualUnitWeightKg: 1,
      actualUnitDimensionsM: { widthM: 1, depthM: 1, heightM: 1 }, compatibleCellIds: [], packingLayoutVerified: false,
      custodyTaken: false, note: 'Rejected', evidenceUploadIds: [], inspectionKey: 'inspection-key-01' }, '"0"', actor),
    () => service.completeReturn(requestId, { returnNote: 'Returned' }, '"0"', 'return-key-0001', actor),
    () => service.confirm(requestId, { destinationCellId: new mongoose.Types.ObjectId().toString(), inspectionNote: 'Received',
      idempotencyKey: 'confirm-key-001' }, '"0"', actor),
  ];
  for (const run of cases) await assert.rejects(run(), error => error instanceof RepeatedInboundError && error.status === 404);
  assert.equal(eventLookups, 0, 'an event snapshot must not be disclosed before current request Facility authorization');
});
