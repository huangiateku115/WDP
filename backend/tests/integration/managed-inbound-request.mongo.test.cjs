'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const safety = require('./mi06b-mongo-safety.cjs');

// This file is inert during normal test discovery. It never loads dotenv or reads the app's .env.
// Real tests run only in a child process with both explicit opt-in variables supplied.
if (process.env.MI06B_IT_RUN !== '1') {
  test('MI-06B MongoDB integration suite requires explicit disposable local replica-set opt-in', { skip: true }, () => {});
} else {
  const config = safety.getValidatedConfig(process.env);
  safety.setNoAutomaticIndexes();
  const mongoose = require('mongoose');
  const Request = require('../../dist/models/inventory-items/inventory-inbound-request.model').default;
  const Event = require('../../dist/models/inventory-items/inventory-inbound-request-event.model').default;
  const Item = require('../../dist/models/inventory-items/inventory-item.model').default;
  const Movement = require('../../dist/models/inventory-items/item-movement.model').default;
  const Facility = require('../../dist/models/facilities/facility.model').default;
  const Reservation = require('../../dist/models/reservations/reservation.model').default;
  const Cell = require('../../dist/models/warehouse-map/warehouse-cell.model').default;
  const Rack = require('../../dist/models/warehouse-map/warehouse-rack.model').default;
  const Zone = require('../../dist/models/warehouse-map/warehouse-zone.model').default;
  const Allocation = require('../../dist/models/warehouse-map/cell-allocation.model').default;
  const Policy = require('../../dist/models/pricing-policy/policy.model').default;
  const { ManagedInboundRequestService: receipts } = require('../../dist/services/inventory-items/managed-inbound-request.service');
  const { InventoryItemService: inventory } = require('../../dist/services/inventory-items/inventory-item.service');

  const ids = () => ({
    customer: new mongoose.Types.ObjectId(), staff: new mongoose.Types.ObjectId(),
    facility: new mongoose.Types.ObjectId(), reservation: new mongoose.Types.ObjectId(),
    zone: new mongoose.Types.ObjectId(), rack: new mongoose.Types.ObjectId(),
    cell: new mongoose.Types.ObjectId(), item: new mongoose.Types.ObjectId(), inbound: new mongoose.Types.ObjectId(),
  });
  const payload = (overrides = {}) => ({ requestedQuantity: 2, quantityUnit: 'box', declaredUnitWeightKg: 2.5,
    declaredUnitDimensionsM: { widthM: .2, depthM: .3, heightM: .4 }, ...overrides });
  const customerActor = id => ({ _id: id, role: 'CUSTOMER' });
  const staffActor = (id, facilityId) => ({ _id: id, role: 'FACILITY_STAFF', assignedFacilityId: facilityId });
  let fixtureNumber = 0;

  async function makeFixture(options = {}) {
    const key = ids();
    fixtureNumber += 1;
    const now = new Date();
    const startDate = new Date(now.getTime() - 60_000);
    const endDate = new Date(now.getTime() + 24 * 60 * 60_000);
    const facility = await Facility.create({ _id: key.facility, code: `IT${fixtureNumber}`, name: 'MI06B disposable test facility',
      address: { line1: 'Test only', city: 'Test', country: 'Test' }, serviceTypes: ['MANAGED_INVENTORY'], status: 'ACTIVE' });
    const zone = await Zone.create({ _id: key.zone, facilityId: key.facility, code: `Z${fixtureNumber}`, name: 'Test zone' });
    const rack = await Rack.create({ _id: key.rack, facilityId: key.facility, zoneId: key.zone, aisleCode: 'A', rackCode: `R${fixtureNumber}`,
      dimensions: { widthM: 2, depthM: 2, heightM: 2 }, levelCount: 1, cellsPerLevel: 2, maxWeightKgPerLevel: 1000, mapX: 0, mapY: 0 });
    const cell = await Cell.create({ _id: key.cell, facilityId: key.facility, zoneId: key.zone, rackId: key.rack,
      levelNumber: 1, cellNumber: 1, code: `C${fixtureNumber}`, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 },
      maxWeightKg: 100, usedWeightKg: options.empty ? 0 : 5, usedVolumeM3: options.empty ? 0 : .048 });
    const reservation = await Reservation.create({ _id: key.reservation, reservationCode: `IT-${fixtureNumber}`,
      customerId: key.customer, facilityId: key.facility, serviceType: 'MANAGED_INVENTORY', status: options.reservationStatus ?? 'ACTIVE',
      startDate, endDate, pricingPolicyId: new mongoose.Types.ObjectId(), estimatedRent: 10, depositAmount: 1,
      allocatedCellIds: [key.cell], allocatedCapacity: 10, usedCapacityM3: options.empty ? 0 : .048, inventoryVersion: 0 });
    await Allocation.create({ facilityId: key.facility, cellId: key.cell, reservationId: key.reservation, customerId: key.customer,
      startDate, endDate, status: 'OCCUPIED' });
    const item = await Item.create({ _id: key.item, facilityId: key.facility, customerId: key.customer, managedReservationId: key.reservation,
      itemCode: `IT${fixtureNumber}`, name: 'Test goods', category: 'Test', quantity: 2, quantityUnit: 'box', unitWeightKg: 2.5,
      unitDimensionsM: { widthM: .2, depthM: .3, heightM: .4 }, unitVolumeM3: .024, totalWeightKg: 5, totalVolumeM3: .048,
      currentCellId: options.status === 'CHECKED_OUT' ? null : key.cell, status: options.status ?? 'IN_STORAGE',
      inboundMovementId: options.empty ? undefined : key.inbound,
      currentPlacementMovementId: options.empty ? null : key.inbound,
      outboundMovementId: options.outboundMovementId, createdBy: key.customer });
    if (!options.empty) {
      await Movement.create({ _id: key.inbound, itemId: key.item, managedReservationId: key.reservation, facilityId: key.facility, customerId: key.customer,
        type: 'INBOUND', sourceCellId: null, destinationCellId: key.cell, quantity: 2, quantityUnit: 'box', actualUnitWeightKg: 2.5,
        actualTotalWeightKg: 5, actualUnitDimensionsM: { widthM: .2, depthM: .3, heightM: .4 }, actualTotalVolumeM3: .048,
        performedBy: key.staff, performedAt: startDate, inspectionNote: 'Isolated test fixture', idempotencyKey: `it-in-${fixtureNumber}` });
    }
    return { ...key, facility, zone, rack, cell, reservation, item, customer: customerActor(key.customer), staff: staffActor(key.staff, key.facility) };
  }

  async function enableGate(value) { process.env.MI06_REPEATED_INBOUND_ENABLED = value ? 'true' : 'false'; }

  test('real MI-06B request/event integration suite', async t => {
    await safety.connectAndVerify(config);
    t.after(async () => {
      try { await safety.dropOnlyGeneratedTestDatabase(config); }
      finally { await mongoose.disconnect(); }
    });
    await safety.createAndVerifyRequestEventIndexes(Request, Event);

    await t.test('A partial unique unresolved-request index is installed and enforced', async () => {
      const f = await makeFixture();
      const first = await receipts.create(f.item.id, payload(), `index-create-${fixtureNumber}`, f.customer);
      assert.equal(first.data.state, 'PENDING_INSPECTION');
      const duplicate = new Request({ itemId: f.item, reservationId: f.reservation, facilityId: f.facility, customerId: f.customer._id,
        createdBy: f.customer._id, ...payload(), state: 'PENDING_INSPECTION', custodyState: 'NOT_TAKEN',
        requestIdempotencyKey: `index-other-${fixtureNumber}`, creationPayloadHash: 'a'.repeat(64), currentPayloadHash: 'a'.repeat(64) });
      await assert.rejects(duplicate.save(), error => error?.code === 11000);
    });

    await t.test('B identical concurrent CREATE keys return one committed event snapshot', async () => {
      const f = await makeFixture(); const key = `same-key-${fixtureNumber}`;
      const results = await Promise.all([
        receipts.create(f.item.id, payload(), key, f.customer),
        receipts.create(f.item.id, payload(), key, f.customer),
      ]);
      assert.equal(results.filter(value => value.replayed).length, 1);
      assert.equal(await Request.countDocuments({ itemId: f.item }), 1);
      assert.equal(await Event.countDocuments({ itemId: f.item, operation: 'CREATE' }), 1);
      assert.deepEqual(results[0].data, results[1].data);
    });

    await t.test('C different concurrent CREATE keys yield one request and a stable conflict', async () => {
      const f = await makeFixture();
      const results = await Promise.allSettled([
        receipts.create(f.item.id, payload(), `diff-a-${fixtureNumber}`, f.customer),
        receipts.create(f.item.id, payload({ requestedQuantity: 3 }), `diff-b-${fixtureNumber}`, f.customer),
      ]);
      assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
      const rejected = results.find(value => value.status === 'rejected');
      assert.equal(rejected.reason.code, 'INBOUND_REQUEST_UNRESOLVED_EXISTS');
      assert.equal(await Request.countDocuments({ itemId: f.item }), 1);
      assert.equal(await Event.countDocuments({ itemId: f.item, operation: 'CREATE' }), 1);
    });

    await t.test('D CREATE and requestOutbound serialize on Item', async () => {
      const f = await makeFixture();
      const outcomes = await Promise.allSettled([
        receipts.create(f.item.id, payload(), `create-out-${fixtureNumber}`, f.customer),
        inventory.requestOutbound(f.item.id, f.customer),
      ]);
      assert.ok(outcomes.some(value => value.status === 'fulfilled'));
      assert.ok(outcomes.some(value => value.status === 'rejected'));
      const item = await Item.findById(f.item);
      const request = await Request.findOne({ itemId: f.item, state: { $in: safetyUnresolvedStates } });
      assert.equal(Boolean(request) && item.status === 'PENDING_OUTBOUND', false);
    });

    await t.test('E CREATE racing confirmOutbound cannot revive an Item already pending outbound', async () => {
      const f = await makeFixture({ status: 'PENDING_OUTBOUND' });
      const outcomes = await Promise.allSettled([
        receipts.create(f.item.id, payload(), `create-confirm-${fixtureNumber}`, f.customer),
        inventory.confirmOutbound(f.item.id, { verifiedQuantity: 2, handoverConfirmed: true,
          handoverNote: 'whole lot handed over', idempotencyKey: `confirm-${fixtureNumber}` }, f.staff),
      ]);
      assert.equal(outcomes[1].status, 'fulfilled');
      assert.equal(outcomes[0].status, 'rejected');
      assert.equal((await Item.findById(f.item)).status, 'CHECKED_OUT');
      assert.equal(await Request.countDocuments({ itemId: f.item }), 0);
      assert.equal(await Movement.countDocuments({ itemId: f.item, type: 'OUTBOUND' }), 1);
    });

    await t.test('E2 unresolved receipt blocks confirmOutbound after its Item token', async () => {
      const f = await makeFixture();
      await receipts.create(f.item.id, payload(), `confirm-block-${fixtureNumber}`, f.customer);
      await Item.updateOne({ _id: f.item }, { $set: { status: 'PENDING_OUTBOUND' } });
      await assert.rejects(inventory.confirmOutbound(f.item.id, { verifiedQuantity: 2, handoverConfirmed: true,
        handoverNote: 'test', idempotencyKey: `out-${fixtureNumber}` }, f.staff),
        error => error?.status === 409);
      assert.equal(await Movement.countDocuments({ itemId: f.item, type: 'OUTBOUND' }), 0);
    });

    await t.test('F unresolved receipt blocks relocation after its Item token', async () => {
      const f = await makeFixture();
      await receipts.create(f.item.id, payload(), `relocate-block-${fixtureNumber}`, f.customer);
      const destination = await Cell.create({ facilityId: f.facility, zoneId: f.zone, rackId: f.rack, levelNumber: 1, cellNumber: 2,
        code: `D${fixtureNumber}`, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 });
      await assert.rejects(inventory.relocate(f.item.id, { sourceCellId: String(f.cell._id), destinationCellId: String(destination._id),
        verifiedQuantity: 2, relocationNote: 'test move', physicalPackingConfirmed: true, idempotencyKey: `move-${fixtureNumber}` }, f.staff), error => error?.status === 409);
      assert.equal(await Movement.countDocuments({ itemId: f.item, type: 'RELOCATION' }), 0);
    });

    await t.test('F2 CREATE racing relocation leaves only a committed placement and at most one relocation movement', async () => {
      const f = await makeFixture();
      const destination = await Cell.create({ facilityId: f.facility, zoneId: f.zone, rackId: f.rack, levelNumber: 1, cellNumber: 2,
        code: `R${fixtureNumber}`, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 });
      await Allocation.create({ facilityId: f.facility, cellId: destination._id, reservationId: f.reservation, customerId: f.customer._id,
        startDate: f.reservation.startDate, endDate: f.reservation.endDate, status: 'RESERVED' });
      await Reservation.updateOne({ _id: f.reservation }, { $addToSet: { allocatedCellIds: destination._id } });
      await Policy.create({ facilityId: f.facility, serviceType: 'MANAGED_INVENTORY', type: 'CATEGORY', isActive: true,
        effectiveFrom: new Date(Date.now() - 60_000), version: 1, config: { allowedCategories: ['TEST'], blockedCategories: [] } });
      const outcomes = await Promise.allSettled([
        receipts.create(f.item.id, payload(), `create-relocate-${fixtureNumber}`, f.customer),
        inventory.relocate(f.item.id, { sourceCellId: String(f.cell._id), destinationCellId: String(destination._id), verifiedQuantity: 2,
          relocationNote: 'race test', physicalPackingConfirmed: true, idempotencyKey: `move-${fixtureNumber}` }, f.staff),
      ]);
      assert.ok(outcomes.some(value => value.status === 'fulfilled'));
      const latest = await Item.findById(f.item);
      assert.ok(latest.currentCellId.equals(f.cell._id) || latest.currentCellId.equals(destination._id));
      const request = await Request.findOne({ itemId: f.item, state: { $in: safetyUnresolvedStates } });
      const relocation = await Movement.findOne({ itemId: f.item, type: 'RELOCATION' });
      if (request && relocation) assert.ok(latest.currentCellId.equals(destination._id));
      assert.ok((await Movement.countDocuments({ itemId: f.item, type: 'RELOCATION' })) <= 1);
    });

    await t.test('G concurrent AMEND and CANCEL commit at most one mutation of the same version', async () => {
      const f = await makeFixture();
      const created = await receipts.create(f.item.id, payload(), `amend-cancel-create-${fixtureNumber}`, f.customer);
      const result = await Promise.allSettled([
        receipts.amend(created.data._id, { requestedQuantity: 3 }, '"0"', `amend-${fixtureNumber}`, f.customer),
        receipts.cancel(created.data._id, '"0"', `cancel-${fixtureNumber}`, f.customer),
      ]);
      assert.equal(result.filter(value => value.status === 'fulfilled').length, 1);
      assert.equal(await Event.countDocuments({ requestId: created.data._id }), 2);
      const request = await Request.findById(created.data._id);
      assert.equal(request.version, 1);
    });

    await t.test('H Reservation status change racing CREATE/AMEND never creates an ineligible receipt', async () => {
      const f = await makeFixture();
      const outcomes = await Promise.allSettled([
        receipts.create(f.item.id, payload(), `reservation-race-${fixtureNumber}`, f.customer),
        Reservation.updateOne({ _id: f.reservation, status: 'ACTIVE' }, { $set: { status: 'OVERDUE' } }),
      ]);
      const request = await Request.findOne({ itemId: f.item });
      const reservation = await Reservation.findById(f.reservation);
      if (request) assert.equal(outcomes[0].status, 'fulfilled');
      else assert.equal(reservation.status, 'OVERDUE');

      const amendFixture = await makeFixture();
      const created = await receipts.create(amendFixture.item.id, payload(), `reservation-amend-create-${fixtureNumber}`, amendFixture.customer);
      const amendment = await Promise.allSettled([
        receipts.amend(created.data._id, { requestedQuantity: 3 }, '"0"', `reservation-amend-${fixtureNumber}`, amendFixture.customer),
        Reservation.updateOne({ _id: amendFixture.reservation, status: 'ACTIVE' }, { $set: { status: 'OVERDUE' } }),
      ]);
      const amendedRequest = await Request.findById(created.data._id);
      assert.ok(amendedRequest.version === 0 || amendedRequest.version === 1);
      if (amendedRequest.version === 1) assert.equal(amendment[0].status, 'fulfilled');
    });

    await t.test('I a late Event write failure rolls back both Request and Event', async () => {
      const f = await makeFixture();
      const originalSave = Event.prototype.save;
      Event.prototype.save = async function (...args) {
        await originalSave.apply(this, args);
        throw new Error('injected late event write failure');
      };
      try {
        await assert.rejects(receipts.create(f.item.id, payload(), `rollback-${fixtureNumber}`, f.customer), /injected late event write failure/);
      } finally { Event.prototype.save = originalSave; }
      assert.equal(await Request.countDocuments({ itemId: f.item }), 0);
      assert.equal(await Event.countDocuments({ itemId: f.item }), 0);
    });

    await t.test('J Event snapshots record the exact resulting Request version', async () => {
      const f = await makeFixture();
      const created = await receipts.create(f.item.id, payload(), `version-create-${fixtureNumber}`, f.customer);
      const amended = await receipts.amend(created.data._id, { requestedQuantity: 4 }, '"0"', `version-amend-${fixtureNumber}`, f.customer);
      const events = await Event.find({ requestId: created.data._id }).sort({ resultingVersion: 1 }).lean();
      assert.deepEqual(events.map(event => event.resultingVersion), [0, 1]);
      assert.deepEqual(events.map(event => event.resultSnapshot.version), [0, 1]);
      assert.equal(amended.version, 1);
    });

    await t.test('K unknown commit outcome retries to one committed event (requires failpoint capability)', async t => {
      if (process.env.MI06B_IT_UNKNOWN_COMMIT_FAILPOINT !== '1') {
        t.skip('UNVERIFIED: explicit local failpoint opt-in required; start mongod with enableTestCommands=1');
        return;
      }
      const f = await makeFixture();
      const admin = mongoose.connection.db.admin();
      await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: {
        failCommands: ['commitTransaction'], errorCode: 91, errorLabels: ['UnknownTransactionCommitResult'],
      } });
      try {
        await receipts.create(f.item.id, payload(), `unknown-commit-${fixtureNumber}`, f.customer);
      } finally {
        await admin.command({ configureFailPoint: 'failCommand', mode: 'off' });
      }
      assert.equal(await Request.countDocuments({ itemId: f.item }), 1);
      assert.equal(await Event.countDocuments({ itemId: f.item, operation: 'CREATE' }), 1);
    });

    await t.test('L gate OFF preserves owner GET/CANCEL and still blocks operational actions', async () => {
      const f = await makeFixture();
      const created = await receipts.create(f.item.id, payload(), `gate-off-${fixtureNumber}`, f.customer);
      await enableGate(false);
      try {
        assert.equal((await receipts.get(created.data._id, f.customer))._id, String(created.data._id));
        await assert.rejects(receipts.create(f.item.id, payload(), `gate-off-new-${fixtureNumber}`, f.customer), error => error?.status === 404);
        await assert.rejects(receipts.amend(created.data._id, { requestedQuantity: 3 }, '"0"', `gate-off-amend-${fixtureNumber}`, f.customer), error => error?.status === 404);
        const cancelled = await receipts.cancel(created.data._id, '"0"', `gate-off-cancel-${fixtureNumber}`, f.customer);
        assert.equal(cancelled.state, 'CANCELLED');

        const protectedFixture = await makeFixture();
        await enableGate(true);
        await receipts.create(protectedFixture.item.id, payload(), `gate-off-protected-${fixtureNumber}`, protectedFixture.customer);
        await enableGate(false);
        await assert.rejects(inventory.requestOutbound(protectedFixture.item.id, protectedFixture.customer), error => error?.status === 409);
        const destination = await Cell.create({ facilityId: protectedFixture.facility, zoneId: protectedFixture.zone, rackId: protectedFixture.rack,
          levelNumber: 1, cellNumber: 2, code: `G${fixtureNumber}`, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 },
          maxWeightKg: 100, usedWeightKg: 0, usedVolumeM3: 0 });
        await assert.rejects(inventory.relocate(protectedFixture.item.id, {
          sourceCellId: String(protectedFixture.cell._id), destinationCellId: String(destination._id), verifiedQuantity: 2,
          physicalPackingConfirmed: true, relocationNote: 'gate off guard', idempotencyKey: `gate-off-move-${fixtureNumber}`,
        }, protectedFixture.staff), error => error?.status === 409);
      } finally { await enableGate(true); }
    });
  });

  const safetyUnresolvedStates = ['PENDING_INSPECTION', 'DISCREPANCY', 'ACCEPTED_PENDING_CONFIRMATION', 'RETURN_PENDING'];
}
