/* Test-only Managed V3 fixture builder. It only creates uniquely identified records. */
const { randomUUID, createHash } = require('node:crypto');
const mongoose = require('mongoose');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../dist');
const model = path => require(`${root}/${path}`).default;

const User = model('models/users/user.model');
const Facility = model('models/facilities/facility.model');
const Zone = model('models/warehouse-map/warehouse-zone.model');
const Rack = model('models/warehouse-map/warehouse-rack.model');
const Cell = model('models/warehouse-map/warehouse-cell.model');
const Allocation = model('models/warehouse-map/cell-allocation.model');
const Reservation = model('models/reservations/reservation.model');
const Item = model('models/inventory-items/inventory-item.model');
const Spec = model('models/inventory-items/item-specification.model');
const ItemInstance = model('models/inventory-items/managed-item-instance.model');
const Category = model('models/inventory-items/managed-inventory-category.model');
const QuantityUnit = model('models/inventory-items/managed-inventory-quantity-unit.model');
const Payment = model('models/payments/reservation-payment.model');
const Contract = model('models/contracts/contract.model');
const Visit = model('models/access/managed-access-visit.model');
const Session = model('models/access/managed-access-session.model');

const oid = () => new mongoose.Types.ObjectId();
const now = () => new Date();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function createManagedV3Fixture({ runId, label = 'case', persist = true, onStage = () => {} } = {}) {
  if (!runId || !/^[a-zA-Z0-9-]{8,80}$/.test(runId)) throw new Error('A unique approved test runId is required.');
  const create = async (Model, data) => {
    onStage('fixture_setup');
    const document = new Model(data);
    if (persist) return Model.create(document);
    await document.validate();
    return document;
  };
  const insertMany = async (Model, rows) => {
    onStage('fixture_setup');
    const documents = rows.map(row => new Model(row));
    if (persist) return Model.insertMany(documents);
    await Promise.all(documents.map(document => document.validate()));
    return documents;
  };
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const prefix = `MI3-${runId}-${label}-${suffix}`;
  const customer = await create(User, { keycloakSub: `${prefix}-customer`, email: `${prefix}@example.invalid`, displayName: `${prefix} customer`, role: 'CUSTOMER' });
  const facility = await create(Facility, { code: prefix, name: `${prefix} isolated integration facility`, address: { line1: 'Test-only address', city: 'Test City', country: 'VN' }, serviceTypes: ['MANAGED_INVENTORY'], status: 'ACTIVE' });
  const staff = await create(User, { keycloakSub: `${prefix}-staff`, email: `${prefix}-staff@example.invalid`, displayName: `${prefix} staff`, role: 'FACILITY_STAFF', assignedFacilityId: facility._id });
  const manager = await create(User, { keycloakSub: `${prefix}-manager`, email: `${prefix}-manager@example.invalid`, displayName: `${prefix} manager`, role: 'FACILITY_MANAGER', assignedFacilityId: facility._id });
  const zone = await create(Zone, { facilityId: facility._id, code: `Z-${suffix}`, name: 'Integration zone', isActive: true });
  const rack = await create(Rack, { facilityId: facility._id, zoneId: zone._id, aisleCode: `A-${suffix}`, rackCode: `R-${suffix}`,
    dimensions: { widthM: 3, depthM: 1, heightM: 2 }, levelCount: 1, cellsPerLevel: 3, maxWeightKgPerLevel: 5000, mapX: 1, mapY: 1, operationalStatus: 'AVAILABLE' });
  const cells = [];
  for (let index = 1; index <= 3; index += 1) cells.push(await create(Cell, { facilityId: facility._id, zoneId: zone._id, rackId: rack._id,
    levelNumber: 1, cellNumber: index, code: `C-${suffix}-${index}`, dimensions: { widthM: 1, depthM: 1, usableHeightM: 2 }, maxWeightKg: 1000,
    usedWeightKg: 0, usedVolumeM3: 0, operationalStatus: 'AVAILABLE' }));

  const startDate = new Date(Date.now() - 60 * 60 * 1000), endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const reservations = [];
  for (let index = 0; index < 2; index += 1) reservations.push(new Reservation({ reservationCode: `${prefix}-RES-${index + 1}`,
    customerId: customer._id, facilityId: facility._id, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, rentalPaymentFlow: 'FULL_UPFRONT_V1',
    status: 'ACTIVE', startDate, endDate, pricingPolicyId: oid(), estimatedRent: 100000, depositAmount: 0,
    fullPaymentId: oid(), allocatedCellIds: index === 0 ? [cells[0]._id, cells[1]._id] : [cells[2]._id], allocatedCapacity: 1,
    usedCapacityM3: 0, inventoryVersion: 0, handoverAt: startDate, handoverByStaffId: staff._id }));
  const payments = reservations.map((reservation, index) => new Payment({ _id: reservation.fullPaymentId, reservationId: reservation._id,
    customerId: customer._id, facilityId: facility._id, serviceType: 'MANAGED_INVENTORY', purpose: 'FULL_RENT', amount: 100000, currency: 'VND',
    idempotencyKey: `${prefix}-full-rent-${index + 1}`, provider: 'PAYOS', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED',
    applicationStatus: 'APPLIED', succeededAt: startDate }));
  await insertMany(Payment, payments);
  await insertMany(Reservation, reservations);
  const contracts = reservations.map((reservation, index) => {
    const content = { testRun: runId, reservation: String(reservation._id), version: 1 };
    const contentHash = hash(content), signedAt = startDate;
    return new Contract({ contractCode: `${prefix}-CONTRACT-${index + 1}`, reservationId: reservation._id, customerId: customer._id,
      status: 'SIGNED', customerSnapshot: { displayName: customer.displayName, email: customer.email }, pricingSnapshot: { currency: 'VND', rent: 100000 },
      paymentSnapshot: { paymentId: reservation.fullPaymentId, purpose: 'FULL_RENT', amount: 100000, currency: 'VND', status: 'SUCCEEDED',
        providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED', verifiedAt: signedAt, appliedAt: signedAt },
      signedByCustomerAt: signedAt, signedByFMAt: signedAt, fmId: manager._id, currentContentVersion: 1,
      contentVersions: [{ version: 1, contentHash, content, createdBy: customer._id, createdAt: signedAt }],
      signatures: [{ version: 1, contentHash, signerId: customer._id, signerRole: 'CUSTOMER', signedAt },
        { version: 1, contentHash, signerId: manager._id, signerRole: 'FACILITY_MANAGER', signedAt }],
      signedProofPublicId: `${prefix}-test-precondition-proof`, verifiedAt: signedAt });
  });
  await insertMany(Contract, contracts);
  const allocations = [
    ...reservations[0].allocatedCellIds.map(cellId => ({ facilityId: facility._id, cellId, reservationId: reservations[0]._id, customerId: customer._id, startDate, endDate, status: 'OCCUPIED' })),
    { facilityId: facility._id, cellId: cells[2]._id, reservationId: reservations[1]._id, customerId: customer._id, startDate, endDate, status: 'OCCUPIED' },
  ];
  await insertMany(Allocation, allocations);
  const category = await create(Category, { code: `CAT-${suffix}`, name: 'Integration fixtures', sortOrder: 0, isActive: true, createdBy: manager._id, updatedBy: manager._id });
  const quantityUnit = await create(QuantityUnit, { code: `UNIT-${suffix}`, name: 'box', sortOrder: 0, isActive: true, createdBy: manager._id, updatedBy: manager._id });
  const sku = await create(Item, { inventorySchemaVersion: 3, skuStatus: 'ACTIVE', managedV3Revision: 0, facilityId: facility._id,
    customerId: customer._id, reservationId: reservations[0]._id, managedReservationId: reservations[0]._id,
    itemCode: `${prefix}-SKU`, name: 'Managed V3 integration item', categoryId: category._id, images: [], createdBy: customer._id });
  const dimensionsM = { widthM: 0.2, depthM: 0.2, heightM: 0.2 };
  const spec = await create(Spec, { skuId: sku._id, customerId: customer._id, reservationId: reservations[0]._id, facilityId: facility._id,
    code: `SPEC-${suffix}`, name: 'Integration box', quantityUnitId: quantityUnit._id, dimensionsM, unitWeightKg: 10, unitVolumeM3: 0.008,
    revision: 0, inboundRevision: 0, status: 'ACTIVE', createdBy: customer._id });
  const actor = { _id: customer._id, role: 'CUSTOMER' };
  const activeSessions = new Map();

  async function accessFor(purpose, { reservation = reservations[0], reservationIds = [reservation._id], allowedCellIds = reservationIds.flatMap(resId => {
    const found = reservations.find(row => String(row._id) === String(resId)); return found?.allocatedCellIds ?? [];
  }) } = {}) {
    onStage('fixture_setup');
    const previous = activeSessions.get(String(reservation._id));
    if (previous && persist) {
      await Session.updateOne({ _id: previous._id, status: 'ACTIVE' }, { $set: { status: 'REVOKED', revokedAt: now(), revokedBy: staff._id, revokeReason: 'replaced by next integration operation' }, $inc: { revision: 1 } });
    }
    const visit = await create(Visit, { reservationId: reservation._id, scopedReservationIds: reservationIds, customerId: customer._id, facilityId: facility._id,
      purpose, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60 * 60 * 1000), status: 'CHECKED_IN', assignedStaffId: staff._id,
      checkedInAt: now(), checkedInByStaffId: staff._id, idempotencyKey: `${prefix}-visit-${randomUUID()}`, requestHash: 'a'.repeat(64), revision: 1,
      presenceAttestation: { identityVerified: true, customerPresent: true, safetyReviewed: true, actorId: staff._id, recordedAt: now(), method: 'MANUAL_STAFF_ATTESTATION' } });
    const session = await create(Session, { visitId: visit._id, reservationId: reservation._id, scopedReservationIds: reservationIds,
      customerId: customer._id, facilityId: facility._id, assignedStaffId: staff._id, allowedCellIds, allowedPurposes: [purpose],
      startedAt: new Date(Date.now() - 30_000), expiresAt: new Date(Date.now() + 30 * 60 * 1000), status: 'ACTIVE', revision: 0,
      checkInIdempotencyKey: `${prefix}-session-${randomUUID()}` });
    activeSessions.set(String(reservation._id), session);
    return session;
  }

  async function inboundRequest({ quantity = 10, allocations: cellAllocations = [{ cellId: cells[0]._id, quantity: 6 }, { cellId: cells[1]._id, quantity: quantity - 6 }],
    instanceAllocations, idempotencyKey = `${prefix}-in-${randomUUID()}` } = {}) {
    const session = await accessFor('INBOUND');
    const line = { lineId: `in-${randomUUID().slice(0, 8)}`, itemSpecId: String(spec._id), itemSpecRevision: spec.revision, quantity,
      measurementMode: 'SPECIFICATION', cellAllocations: cellAllocations.map(row => ({ cellId: String(row.cellId), quantity: row.quantity })),
      ...(instanceAllocations ? { instanceAllocations: instanceAllocations.map(row => ({ ...row, cellId: String(row.cellId) })) } : {}) };
    const currentSku = persist ? await Item.findById(sku._id).lean() : sku;
    const body = { accessSessionId: String(session._id), sessionRevision: session.revision, skuRevision: Number(currentSku.managedV3Revision), lines: [line] };
    const { ManagedUnifiedInboundService } = require(`${root}/services/inventory-items/managed-unified-inbound.service`);
    return { body, key: idempotencyKey };
  }

  async function inbound(options = {}) {
    const request = await inboundRequest(options);
    const { ManagedUnifiedInboundService } = require(`${root}/services/inventory-items/managed-unified-inbound.service`);
    onStage('service_operation');
    const result = await ManagedUnifiedInboundService.confirm(String(sku._id), request.body, actor, request.key);
    onStage('assertion');
    return { ...request, result };
  }

  async function outbound(quantity, { reservation = reservations[0], cellId, idempotencyKey = `${prefix}-out-${randomUUID()}` } = {}) {
    const session = await accessFor('OUTBOUND', { reservation });
    const skuDoc = await Item.findById(sku._id).lean();
    const input = { accessSessionId: String(session._id), sessionRevision: session.revision, skuRevision: skuDoc.managedV3Revision, reservationId: String(reservation._id),
      lines: [{ lineId: `out-${randomUUID().slice(0, 8)}`, itemSpecId: String(spec._id), itemSpecRevision: spec.revision, quantity,
        ...(cellId ? { cellAllocations: [{ cellId: String(cellId), quantity }] } : {}) }], physicalRemovalConfirmed: true,
      customerAttestation: 'Integration fixture confirms physical removal for the test.' };
    const { ManagedInventoryV3OutboundService } = require(`${root}/services/inventory-items/managed-inventory-v3-outbound.service`);
    onStage('service_operation');
    const result = await ManagedInventoryV3OutboundService.confirm(String(sku._id), input, idempotencyKey, `"${skuDoc.managedV3Revision}"`, actor);
    onStage('assertion');
    return { input, key: idempotencyKey, result };
  }

  async function relocate(quantity, { sourceCell = cells[0], destinationCell = cells[2], sourceReservation = reservations[0], destinationReservation = reservations[1], cross = true,
    idempotencyKey = `${prefix}-move-${randomUUID()}` } = {}) {
    const scopeReservations = cross ? [sourceReservation._id, destinationReservation._id] : [sourceReservation._id];
    const session = await accessFor('RELOCATION', { reservation: sourceReservation, reservationIds: scopeReservations,
      allowedCellIds: cross ? [sourceCell._id, destinationCell._id] : [sourceCell._id, destinationCell._id] });
    const skuDoc = await Item.findById(sku._id).lean();
    const input = { accessSessionId: String(session._id), sessionRevision: session.revision, skuRevision: skuDoc.managedV3Revision,
      customerAttestation: 'CONFIRMED', reason: 'integration test relocation', lines: [{ lineId: `move-${randomUUID().slice(0, 8)}`,
        itemSpecId: String(spec._id), itemSpecRevision: spec.revision, sourceCellId: String(sourceCell._id), destinationCellId: String(destinationCell._id),
        sourceReservationId: String(sourceReservation._id), destinationReservationId: String(cross ? destinationReservation._id : sourceReservation._id), quantity }] };
    const { ManagedInventoryV3RelocationService } = require(`${root}/services/inventory-items/managed-inventory-v3-relocation.service`);
    onStage('service_operation');
    const result = await ManagedInventoryV3RelocationService.confirm(String(sku._id), input, idempotencyKey, `"${skuDoc.managedV3Revision}"`, actor);
    onStage('assertion');
    return { input, key: idempotencyKey, result };
  }

  return { runId, prefix, persist, customer, staff, manager, actor, facility, zone, rack, cells, reservations, category, quantityUnit, sku, spec,
    accessFor, inboundRequest, inbound, outbound, relocate,
    models: { User, Facility, Zone, Rack, Cell, Allocation, Reservation, Item, Spec, ItemInstance, Category, QuantityUnit, Payment, Contract, Visit, Session } };
}

async function validateManagedV3FixtureSchemas({ runId = `MI3-VALIDATE-${randomUUID()}` } = {}) {
  const fixture = await createManagedV3Fixture({ runId, label: 'schema-validation', persist: false });
  const instance = new ItemInstance({ itemInstanceId: `${fixture.prefix}-offline-unit`, skuId: fixture.sku._id,
    itemSpecId: fixture.spec._id, reservationId: fixture.reservations[0]._id, facilityId: fixture.facility._id,
    customerId: fixture.customer._id, sourceReceiptId: `${fixture.prefix}-offline-receipt`, quantity: 1,
    unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: 0.008, unitDimensionsSnapshot: { widthM: 0.2, depthM: 0.2, heightM: 0.2 },
    allocations: [{ cellId: fixture.cells[0]._id, weightKg: 4, volumeM3: 0.003 }, { cellId: fixture.cells[1]._id, weightKg: 6, volumeM3: 0.005 }],
    status: 'PLACED', revision: 0 });
  await instance.validate();
  await fixture.accessFor('INBOUND');
  await fixture.accessFor('OUTBOUND');
  await fixture.accessFor('RELOCATION', { reservation: fixture.reservations[0],
    reservationIds: [fixture.reservations[0]._id, fixture.reservations[1]._id],
    allowedCellIds: [fixture.cells[0]._id, fixture.cells[2]._id] });
  return { validated: true, noDatabaseWrites: true, fixtureDocumentCount: 28, additionalA1InstanceSchemaValidated: true,
    models: ['User', 'Facility', 'WarehouseZone', 'WarehouseRack', 'WarehouseCell', 'Reservation', 'ReservationPayment', 'Contract',
      'CellAllocation', 'ManagedInventoryCategory', 'ManagedInventoryQuantityUnit', 'InventoryItem', 'ItemSpecification',
      'ManagedItemInstance', 'ManagedAccessVisit', 'ManagedAccessSession'] };
}

module.exports = { createManagedV3Fixture, validateManagedV3FixtureSchemas };
