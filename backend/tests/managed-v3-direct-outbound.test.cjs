const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { createHash } = require('node:crypto');
const { normalizeDirectOutbound, buildDirectOutboundPlan, directOutboundRequestHash, resolveDirectOutboundReplay, assertCurrentSignedContract,
  validateDirectOutboundReservationScope, validateDirectOutboundAccessScope,
  ManagedInventoryV3OutboundService, ManagedV3OutboundError } = require('../dist/services/inventory-items/managed-inventory-v3-outbound.service');

const oid = n => new Types.ObjectId(String(n).padStart(24, '0'));
const sku = { _id: oid(1), customerId: oid(2), managedV3Revision: 4 };
const reservation = { _id: oid(3), allocatedCellIds: [oid(4), oid(5)] };
const reservationB = { _id: oid(9), allocatedCellIds: [oid(10)], customerId: sku.customerId, facilityId: oid(11), serviceType: 'MANAGED_INVENTORY',
  bookingFlowVersion: 3, status: 'ACTIVE', startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z'),
  handoverAt: new Date('2026-01-01T00:00:00Z'), handoverByStaffId: oid(12), activeClosureRequestId: null, usedCapacityM3: 0.048 };
const spec = { _id: oid(6), skuId: sku._id, customerId: sku.customerId, reservationId: reservation._id, status: 'ACTIVE', revision: 2, name: 'Thùng hồ sơ', code: 'BOX' };
const candidate = (line = {}) => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4,
  lines: [{ lineId: 'line-1', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 3, ...line }] });
const candidateFor = (reservationId, line = {}) => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4,
  reservationId: reservationId.toHexString(), lines: [{ lineId: 'line-1', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 3, ...line }] });
const lot = (receiptId, cellId, quantity, weight, at, held = 0) => ({ skuId: sku._id, itemSpecId: spec._id, reservationId: reservation._id, cellId, receiptId,
  quantityOnHand: quantity, quantityHeld: held, quantityAvailable: quantity - held, unitWeightKgSnapshot: weight, unitVolumeM3Snapshot: 0.01,
  unitDimensionsSnapshot: { widthM: 0.2, depthM: 0.25, heightM: 0.2 }, quantityUnitSnapshot: 'thùng' });
const stateFor = (lots, cells, movements = []) => ({ replay: { lots, instances: [] }, cells, movements });
const cell = (id, weight, volume = 1) => ({ _id: id, code: String(id).slice(-2), usedWeightKg: weight, usedVolumeM3: volume });
const plan = (lots, cells, movements = [], candidateValue = candidate()) => buildDirectOutboundPlan({ sku, reservation, candidate: candidateValue, state: stateFor(lots, cells, movements), specifications: [spec], now: new Date('2026-11-16T12:00:00Z') });

test('normalizer accepts valid direct outbound and rejects duplicate lines, unsafe quantities and malformed allocation sums', () => {
  assert.equal(candidate().lines[0].quantity, 3);
  assert.throws(() => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4, lines: [
    { lineId: 'a', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 1 }, { lineId: 'b', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 1 },
  ] }), e => e.code === 'DUPLICATE_OUTBOUND_LINE');
  assert.throws(() => candidate({ quantity: Number.MAX_SAFE_INTEGER + 1 }), e => e.code === 'INVALID_OUTBOUND_LINE');
  assert.throws(() => candidate({ quantity: 2, cellAllocations: [{ cellId: oid(4).toHexString(), quantity: 1 }] }), e => e.code === 'INVALID_CELL_ALLOCATION');
});

test('A2 partial removal allocates FIFO across receipt Cells and conserves quantity, weight and volume', () => {
  const first = lot('receipt-1', oid(4), 2, 1.111, '2026-11-01T00:00:00Z');
  const second = lot('receipt-2', oid(5), 4, 2.222, '2026-11-02T00:00:00Z');
  const movements = [
    { _id: oid(12), itemId: sku._id, schemaVersion: 4, performedAt: new Date('2026-11-01T00:00:00Z'), stockEffect: { action: 'ADD', destination: [{ receiptId: 'receipt-1' }] } },
    { _id: oid(13), itemId: sku._id, schemaVersion: 4, performedAt: new Date('2026-11-02T00:00:00Z'), stockEffect: { action: 'ADD', destination: [{ receiptId: 'receipt-2' }] } },
  ];
  const selected = candidate();
  const result = plan([first, second], [cell(oid(4), 10), cell(oid(5), 10)], movements, selected);
  assert.deepEqual(result.effectLines.map(row => [row.receiptId, row.quantity]), [['receipt-1', 2], ['receipt-2', 1]]);
  assert.equal(result.quantity, 3);
  assert.equal(result.totalWeightKg, 4.444);
  assert.equal(result.totalVolumeM3, 0.03);
  assert.equal(result.capacity.find(row => String(row.cellId) === String(oid(4))).usedWeightAfterKg, 7.778);
});

test('A2 honors active holds and scoped Cell selections; insufficient or unknown source fails closed', () => {
  const held = lot('receipt-1', oid(4), 4, 1, '2026-11-01T00:00:00Z', 2);
  const one = candidate({ quantity: 3 });
  assert.throws(() => plan([held], [cell(oid(4), 4)], [], one), e => e.code === 'OUTBOUND_QUANTITY_UNAVAILABLE');
  const scoped = candidate({ quantity: 2, cellAllocations: [{ cellId: oid(5).toHexString(), quantity: 2 }] });
  assert.throws(() => plan([held], [cell(oid(4), 4)], [], scoped), e => e.code === 'OUTBOUND_QUANTITY_UNAVAILABLE');
  assert.throws(() => plan([held], [], [], candidate({ quantity: 1 })), e => e.code === 'CELL_CAPACITY_UNKNOWN');
});

test('A1 direct outbound selects complete quantity-one PhysicalUnits and releases the full multi-Cell footprint once', () => {
  const instance = { skuId: sku._id, itemSpecId: oid(8), reservationId: reservation._id, itemInstanceId: 'unit-1', sourceReceiptId: 'receipt-u', quantity: 1,
    status: 'PLACED', unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: 0.08, unitDimensionsSnapshot: { widthM: 0.4, depthM: 0.4, heightM: 0.5 },
    allocations: [{ cellId: oid(4), weightKg: 6, volumeM3: 0.05 }, { cellId: oid(5), weightKg: 4, volumeM3: 0.03 }] };
  const oneSpec = { ...spec, _id: oid(8) };
  const input = normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4, lines: [
    { lineId: 'unit', itemSpecId: oneSpec._id.toHexString(), itemSpecRevision: 2, quantity: 1, itemInstanceIds: ['unit-1'] },
  ] });
  const result = buildDirectOutboundPlan({ sku, reservation, candidate: input, state: { ...stateFor([], [cell(oid(4), 6, .05), cell(oid(5), 4, .03)], []), replay: { lots: [], instances: [instance] } }, specifications: [oneSpec], now: new Date() });
  assert.equal(result.quantity, 1);
  assert.equal(result.totalWeightKg, 10);
  assert.equal(result.totalVolumeM3, 0.08);
  assert.equal(result.effectLines.length, 2);
  assert.equal(result.capacity.reduce((sum, row) => sum + row.usedWeightAfterKg, 0), 0);
  assert.throws(() => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4, lines: [
    { lineId: 'unit', itemSpecId: oneSpec._id.toHexString(), itemSpecRevision: 2, quantity: 2, itemInstanceIds: ['unit-1'] },
  ] }), e => e.code === 'INVALID_ITEM_INSTANCE_SELECTION');
});

test('stale SKU/specification revisions and non-Customer writers are rejected', async () => {
  const stale = { ...candidate(), skuRevision: 3 };
  assert.throws(() => plan([], [], [], stale), e => e.code === 'STALE_SKU_REVISION');
  const staleSpec = normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4,
    lines: [{ lineId: 'line-1', itemSpecId: spec._id.toHexString(), itemSpecRevision: 1, quantity: 1 }] });
  assert.throws(() => plan([lot('r', oid(4), 1, 1, '2026-11-01')], [cell(oid(4), 1)], [], staleSpec), e => e.code === 'ITEM_SPECIFICATION_STALE');
  await assert.rejects(ManagedInventoryV3OutboundService.context(sku._id.toHexString(), { _id: sku.customerId, role: 'FACILITY_STAFF' }),
    e => e instanceof ManagedV3OutboundError && e.status === 403 && e.code === 'ROLE_DENIED');
});

test('outbound reservation selector is optional for the original Reservation, validated when supplied, and included in payload identity', () => {
  assert.equal(candidate().reservationId, undefined);
  const fromB = candidateFor(reservationB._id);
  assert.equal(fromB.reservationId, reservationB._id.toHexString());
  const originalHash = directOutboundRequestHash(candidate()), targetHash = directOutboundRequestHash(fromB);
  assert.notEqual(originalHash, targetHash, 'same idempotency key with a changed source Reservation must conflict');
  const priorMovement = { _id: oid(30), stockEffect: { requestHash: originalHash } };
  assert.deepEqual(resolveDirectOutboundReplay(priorMovement, originalHash), { status: 'COMMITTED', replayed: true, movement: priorMovement });
  assert.throws(() => resolveDirectOutboundReplay(priorMovement, targetHash), error => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(resolveDirectOutboundReplay(null, targetHash), null);
  assert.throws(() => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4,
    reservationId: 'not-an-object-id', lines: [{ lineId: 'line-1', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 1 }] }),
  error => error.code === 'INVALID_OUTBOUND_INPUT');
});

test('cross-Reservation MOVE stock is selected only from the explicitly selected Reservation and source Cell', () => {
  const skuValue = { ...sku, inventorySchemaVersion: 3, skuStatus: 'ACTIVE', facilityId: reservationB.facilityId, reservationId: reservation._id };
  const movedLot = { ...lot('receipt-moved', oid(10), 6, 2, '2026-11-02T00:00:00Z'), reservationId: reservationB._id,
    customerId: sku.customerId, facilityId: reservationB.facilityId };
  const originalLot = { ...lot('receipt-origin', oid(4), 4, 2, '2026-11-01T00:00:00Z'), quantityAvailable: 4 };
  const state = stateFor([originalLot, movedLot], [cell(oid(4), 8), cell(oid(10), 12)]);
  const partial = buildDirectOutboundPlan({ sku: skuValue, reservation: reservationB, candidate: candidateFor(reservationB._id, { cellAllocations: [{ cellId: oid(10).toHexString(), quantity: 3 }] }),
    state, specifications: [spec], now: new Date('2026-11-16T12:00:00Z') });
  assert.equal(partial.quantity, 3);
  assert.equal(partial.effectLines.length, 1);
  assert.equal(String(partial.effectLines[0].reservationId), String(reservationB._id));
  assert.equal(String(partial.effectLines[0].cellId), String(oid(10)));
  assert.equal(partial.effectLines[0].receiptId, 'receipt-moved');
  assert.equal(partial.effectLines[0].quantityAfter, 3);
  assert.equal(partial.capacity[0].usedWeightAfterKg, 6);
  assert.throws(() => buildDirectOutboundPlan({ sku: skuValue, reservation: reservationB, candidate: candidateFor(reservationB._id,
    { cellAllocations: [{ cellId: oid(4).toHexString(), quantity: 3 }] }), state, specifications: [spec], now: new Date('2026-11-16T12:00:00Z') }),
  error => error.code === 'CELL_NOT_ALLOCATED');
  const full = buildDirectOutboundPlan({ sku: skuValue, reservation: reservationB, candidate: candidateFor(reservationB._id,
    { quantity: 6, cellAllocations: [{ cellId: oid(10).toHexString(), quantity: 6 }] }), state, specifications: [spec], now: new Date('2026-11-16T12:00:00Z') });
  assert.equal(full.quantity, 6);
  assert.equal(full.effectLines[0].quantityAfter, 0);
  assert.throws(() => buildDirectOutboundPlan({ sku: skuValue, reservation, candidate: candidate({ cellAllocations: [{ cellId: oid(10).toHexString(), quantity: 3 }] }),
    state, specifications: [spec], now: new Date('2026-11-16T12:00:00Z') }), error => error.code === 'CELL_NOT_ALLOCATED');
});

test('selected Reservation must remain owned, same-Facility, active, current and handed over', () => {
  const skuValue = { ...sku, inventorySchemaVersion: 3, skuStatus: 'ACTIVE', facilityId: reservationB.facilityId };
  const actor = { _id: sku.customerId, role: 'CUSTOMER' };
  assert.doesNotThrow(() => validateDirectOutboundReservationScope(skuValue, reservationB, actor, new Date('2026-11-16T12:00:00Z')));
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, reservationB, actor, new Date('2026-11-16T12:00:00Z'), reservation._id.toHexString()),
    error => error.code === 'OUTBOUND_SCOPE_INVALID');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, { ...reservationB, customerId: oid(13) }, actor, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'OUTBOUND_SCOPE_INVALID');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, { ...reservationB, facilityId: oid(14) }, actor, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'OUTBOUND_SCOPE_INVALID');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, { ...reservationB, status: 'CANCELLED' }, actor, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'RENTAL_NOT_ACTIVE');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, { ...reservationB, endDate: new Date('2026-11-01T00:00:00Z') }, actor, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'RENTAL_NOT_ACTIVE');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, { ...reservationB, handoverAt: null }, actor, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'RENTAL_NOT_ACTIVE');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, { ...reservationB, activeClosureRequestId: oid(15) }, actor, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'RENTAL_NOT_ACTIVE');
  assert.throws(() => validateDirectOutboundReservationScope(skuValue, reservationB, { _id: oid(16), role: 'CUSTOMER' }, new Date('2026-11-16T12:00:00Z')),
    error => error.code === 'SKU_NOT_FOUND');
});

test('selected Reservation contract must be signed by both required parties for the current content version', () => {
  const content = { reservationCode: 'RES-TEST', termsVersion: 2 }, contentHash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const contract = { status: 'SIGNED', currentContentVersion: 2, contentVersions: [{ version: 1, contentHash: 'old' }, { version: 2, contentHash, content }],
    signedProofPublicId: 'test-proof', verifiedAt: new Date(),
    signatures: [{ version: 2, contentHash, signerRole: 'CUSTOMER' }, { version: 2, contentHash, signerRole: 'FACILITY_MANAGER' }] };
  assert.equal(assertCurrentSignedContract(contract), true);
  assert.equal(assertCurrentSignedContract({ ...contract, signatures: contract.signatures.slice(0, 1) }), false);
  assert.equal(assertCurrentSignedContract({ ...contract, status: 'DRAFT' }), false);
  assert.equal(assertCurrentSignedContract({ ...contract, signatures: [{ ...contract.signatures[0], contentHash: 'stale' }, contract.signatures[1]] }), false);
  assert.equal(assertCurrentSignedContract({ ...contract, contentVersions: [{ version: 2, contentHash, content: { changed: true } }] }), false);
  assert.equal(assertCurrentSignedContract({ ...contract, signedProofPublicId: null }), false);
});

test('Outbound Access Session must match the selected Reservation, Customer, Facility, purpose, revision, time and every source Cell', () => {
  const actor = { _id: sku.customerId, role: 'CUSTOMER' }, selected = candidateFor(reservationB._id);
  const session = { _id: selected.accessSessionId, visitId: oid(20), reservationId: reservationB._id, customerId: actor._id, facilityId: reservationB.facilityId,
    status: 'ACTIVE', allowedPurposes: ['OUTBOUND'], revision: 1, startedAt: new Date('2026-11-16T11:00:00Z'), expiresAt: new Date('2026-11-16T13:00:00Z'), allowedCellIds: [oid(10)] };
  const visit = { _id: session.visitId, reservationId: reservationB._id, customerId: actor._id, facilityId: reservationB.facilityId, purpose: 'OUTBOUND', status: 'CHECKED_IN' };
  assert.doesNotThrow(() => validateDirectOutboundAccessScope(session, visit, reservationB, actor, selected, [oid(10).toHexString()], new Date('2026-11-16T12:00:00Z')));
  for (const changed of [
    { access: { ...session, reservationId: reservation._id } },
    { access: { ...session, customerId: oid(21) } },
    { access: { ...session, facilityId: oid(22) } },
    { access: { ...session, allowedPurposes: ['RELOCATION'] } },
    { access: { ...session, revision: 0 } },
    { access: { ...session, expiresAt: new Date('2026-11-16T11:59:59Z') } },
    { access: session, cells: [oid(4).toHexString()] },
    { access: session, visit: { ...visit, reservationId: reservation._id } },
    { access: session, visit: { ...visit, status: 'CANCELLED' } },
  ]) assert.throws(() => validateDirectOutboundAccessScope(changed.access, changed.visit ?? visit, reservationB, actor, selected,
    changed.cells ?? [oid(10).toHexString()], new Date('2026-11-16T12:00:00Z')), error => error.code === 'ACCESS_SESSION_SCOPE_INVALID');
});
