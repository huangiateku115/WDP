/* Read-only retained-fixture correlation audit. It never mutates MongoDB. */
require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');

const scenarioIds = Array.from({ length: 10 }, (_, index) => `IT${String(index + 1).padStart(2, '0')}`);
const expectedPerScenario = {
  users: 3, facilities: 1, warehousezones: 1, warehouseracks: 1, warehousecells: 3,
  reservations: 2, reservationpayments: 2, contracts: 2, cellallocations: 3,
  managedinventorycategories: 1, managedinventoryquantityunits: 1, inventoryitems: 1, itemspecifications: 1,
};
// IT01-05/07/10 call accessFor before their observed failure; IT06/08/09 fail before accessFor.
const expectedAccessDocsByScenario = Object.fromEntries(scenarioIds.map(id => [id,
  ['IT01', 'IT02', 'IT03', 'IT04', 'IT05', 'IT07', 'IT10'].includes(id) ? 1 : 0]));
const expectedAccessDocs = (scenario, caseId) => caseId === 'IT03' && scenario === 'IT03' ? 3 : expectedAccessDocsByScenario[scenario];

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function markerRegex(runId, caseId = null) { return new RegExp(`^MI3-${escapeRegex(runId)}-${caseId ? `${escapeRegex(caseId)}-` : ''}`, 'i'); }
function parseScenarioMarker(value, runId) {
  if (typeof value !== 'string') return null;
  const match = value.match(new RegExp(`^MI3-${escapeRegex(runId)}-(IT(?:0[1-9]|10))-([a-f\\d]{8})-([a-f\\d]{16})`, 'i'));
  return match ? { scenario: match[1].toUpperCase(), suffix: match[3].toUpperCase() } : null;
}
function refValues(ids) {
  const values = [];
  for (const id of ids ?? []) if (id !== undefined && id !== null) {
    values.push(id);
    const text = String(id);
    if (!values.some(value => typeof value === 'string' && value === text)) values.push(text);
  }
  return values;
}
function referenceClause(field, ids) {
  const values = refValues(ids);
  return values.length ? { [field]: { $in: values } } : null;
}
function markerClause(field, regex) { return { [field]: regex }; }
function anyOf(...clauses) { const present = clauses.filter(Boolean); return present.length === 0 ? null : present.length === 1 ? present[0] : { $or: present }; }
async function rows(db, collectionName, filter, projection) {
  if (!filter) return [];
  return db.collection(collectionName).find(filter, { projection }).toArray();
}
const idText = value => value == null ? '' : String(value?._id ?? value);
const idSet = values => new Set(values.map(idText));
function addIssue(issues, code, count) { if (count > 0) issues.push({ code, count }); }

async function auditRun({ client, runId, caseId = null }) {
  if (!runId || !/^[a-zA-Z0-9-]{8,80}$/.test(runId)) throw new Error('A valid RunId is required.');
  if (caseId && !/^IT(?:0[1-9]|10)$/.test(caseId)) throw new Error('CaseId must be one of IT01 through IT10.');
  const db = client.db();
  if (db.databaseName !== 'test') throw new Error(`Read-only audit only targets database test; selected database is ${db.databaseName}.`);
  const selectedScenarioIds = caseId ? [caseId] : scenarioIds;
  const marker = markerRegex(runId, caseId), scenarioBySuffix = new Map(), scenarioByFacility = new Map(), scenarioByReservation = new Map(), scenarioBySku = new Map(), scenarioByPhysicalUnit = new Map();

  // The harness marker is present in User.keycloakSub/email and uppercase-normalized Facility.code/SKU.itemCode.
  // Facility IDs can also be recovered from staff/manager User.assignedFacilityId.
  const users = await rows(db, 'users', anyOf(markerClause('keycloakSub', marker), markerClause('email', marker)),
    { _id: 1, keycloakSub: 1, assignedFacilityId: 1 });
  const staffFacilityRefs = users.map(user => user.assignedFacilityId).filter(Boolean);
  const facilities = await rows(db, 'facilities', anyOf(markerClause('code', marker), referenceClause('_id', staffFacilityRefs)),
    { _id: 1, code: 1, managedAccessRevision: 1 });
  for (const user of users) {
    const parsed = parseScenarioMarker(user.keycloakSub, runId);
    if (parsed) scenarioBySuffix.set(parsed.suffix, parsed.scenario);
  }
  for (const facility of facilities) {
    const parsed = parseScenarioMarker(facility.code, runId);
    if (parsed) { scenarioBySuffix.set(parsed.suffix, parsed.scenario); scenarioByFacility.set(idText(facility._id), parsed.scenario); }
  }
  // If a Facility record is absent, a marker-matched staff/manager row still identifies the Facility ID.
  for (const user of users) {
    const parsed = parseScenarioMarker(user.keycloakSub, runId);
    if (parsed && user.assignedFacilityId) scenarioByFacility.set(idText(user.assignedFacilityId), parsed.scenario);
  }
  const facilityIds = [...new Map([...facilities.map(row => row._id), ...staffFacilityRefs].map(id => [idText(id), id])).values()];

  const reservations = await rows(db, 'reservations', anyOf(markerClause('reservationCode', marker), referenceClause('facilityId', facilityIds)),
    { _id: 1, facilityId: 1, reservationCode: 1, fullPaymentId: 1, usedCapacityM3: 1, allocatedCapacity: 1, inventoryVersion: 1, managedAccessRevision: 1 });
  for (const reservation of reservations) {
    const parsed = parseScenarioMarker(reservation.reservationCode, runId);
    const scenario = parsed?.scenario ?? scenarioByFacility.get(idText(reservation.facilityId));
    if (scenario) scenarioByReservation.set(idText(reservation._id), scenario);
  }
  const reservationIds = reservations.map(row => row._id);
  const skus = await rows(db, 'inventoryitems', anyOf(markerClause('itemCode', marker), referenceClause('facilityId', facilityIds)),
    { _id: 1, facilityId: 1, reservationId: 1, itemCode: 1, managedV3Revision: 1 });
  for (const sku of skus) {
    const parsed = parseScenarioMarker(sku.itemCode, runId);
    const scenario = parsed?.scenario ?? scenarioByFacility.get(idText(sku.facilityId)) ?? scenarioByReservation.get(idText(sku.reservationId));
    if (scenario) scenarioBySku.set(idText(sku._id), scenario);
  }
  const skuIds = skus.map(row => row._id);
  const suffixScenarios = [...scenarioBySuffix.entries()];
  const suffixCodeFilters = (prefix, field) => suffixScenarios.map(([suffix]) => ({ [field]: new RegExp(`^${prefix}-${suffix}$`, 'i') }));

  const [zones, racks, cells, payments, contracts, allocations, categories, quantityUnits, specifications, visits, sessions] = await Promise.all([
    rows(db, 'warehousezones', anyOf(referenceClause('facilityId', facilityIds), ...suffixCodeFilters('Z', 'code')), { _id: 1, facilityId: 1, code: 1 }),
    rows(db, 'warehouseracks', anyOf(referenceClause('facilityId', facilityIds), ...suffixCodeFilters('R', 'rackCode')), { _id: 1, facilityId: 1, rackCode: 1, managedInventoryRevision: 1 }),
    rows(db, 'warehousecells', anyOf(referenceClause('facilityId', facilityIds), ...suffixScenarios.map(([suffix]) => ({ code: new RegExp(`^C-${suffix}-`, 'i') }))),
      { _id: 1, facilityId: 1, code: 1, usedWeightKg: 1, usedVolumeM3: 1, managedInventoryRevision: 1 }),
    rows(db, 'reservationpayments', anyOf(referenceClause('reservationId', reservationIds), referenceClause('_id', reservations.map(row => row.fullPaymentId)), markerClause('idempotencyKey', marker)),
      { _id: 1, reservationId: 1, idempotencyKey: 1 }),
    rows(db, 'contracts', anyOf(referenceClause('reservationId', reservationIds), markerClause('contractCode', marker)), { _id: 1, reservationId: 1, contractCode: 1 }),
    rows(db, 'cellallocations', anyOf(referenceClause('reservationId', reservationIds), referenceClause('facilityId', facilityIds)), { _id: 1, reservationId: 1, facilityId: 1, cellId: 1 }),
    rows(db, 'managedinventorycategories', anyOf(referenceClause('createdBy', users.map(row => row._id)), ...suffixCodeFilters('CAT', 'code')), { _id: 1, code: 1, createdBy: 1 }),
    rows(db, 'managedinventoryquantityunits', anyOf(referenceClause('createdBy', users.map(row => row._id)), ...suffixCodeFilters('UNIT', 'code')), { _id: 1, code: 1, createdBy: 1 }),
    rows(db, 'itemspecifications', anyOf(referenceClause('skuId', skuIds), ...suffixCodeFilters('SPEC', 'code')), { _id: 1, skuId: 1, reservationId: 1, code: 1, revision: 1, inboundRevision: 1 }),
    rows(db, 'managedaccessvisits', anyOf(referenceClause('reservationId', reservationIds), markerClause('idempotencyKey', marker)), { _id: 1, reservationId: 1, facilityId: 1, idempotencyKey: 1 }),
    rows(db, 'managedaccesssessions', anyOf(referenceClause('reservationId', reservationIds), markerClause('checkInIdempotencyKey', marker)), { _id: 1, reservationId: 1, facilityId: 1, checkInIdempotencyKey: 1, revision: 1, status: 1 }),
  ]);
  for (const row of [...zones, ...racks, ...cells]) {
    const match = row.code?.match(/^(?:Z|C)-([A-F\d]{16})(?:-\d+)?$/i) ?? row.rackCode?.match(/^R-([A-F\d]{16})$/i);
    if (match && scenarioBySuffix.has(match[1].toUpperCase())) {
      const scenario = scenarioBySuffix.get(match[1].toUpperCase());
      if (row.facilityId) scenarioByFacility.set(idText(row.facilityId), scenario);
    }
  }
  // Assign related records by their ObjectId or string reference after root discovery.
  for (const reservation of reservations) if (!scenarioByReservation.has(idText(reservation._id))) {
    const scenario = scenarioByFacility.get(idText(reservation.facilityId)); if (scenario) scenarioByReservation.set(idText(reservation._id), scenario);
  }
  for (const sku of skus) if (!scenarioBySku.has(idText(sku._id))) {
    const scenario = scenarioByFacility.get(idText(sku.facilityId)) ?? scenarioByReservation.get(idText(sku.reservationId)); if (scenario) scenarioBySku.set(idText(sku._id), scenario);
  }
  const physicalUnits = await rows(db, 'managedv3physicalunits', anyOf(referenceClause('skuId', skuIds), referenceClause('facilityId', facilityIds)),
    { _id: 1, skuId: 1, facilityId: 1, reservationId: 1 });
  for (const unit of physicalUnits) {
    const scenario = scenarioBySku.get(idText(unit.skuId)) ?? scenarioByFacility.get(idText(unit.facilityId));
    if (scenario) scenarioByPhysicalUnit.set(idText(unit._id), scenario);
  }
  const [movements, stockRows, instances, projections, placements, footprints] = await Promise.all([
    rows(db, 'itemmovements', anyOf(referenceClause('itemId', skuIds), referenceClause('facilityId', facilityIds)),
      { _id: 1, itemId: 1, facilityId: 1, managedReservationId: 1, schemaVersion: 1, quantity: 1,
        performedAt: 1, 'stockEffect.action': 1, 'stockEffect.ledgerRevision': 1, 'stockEffect.destination': 1, 'stockEffect.source': 1 }),
    rows(db, 'managedcellstocks', anyOf(referenceClause('skuId', skuIds), referenceClause('facilityId', facilityIds)),
      { _id: 1, skuId: 1, facilityId: 1, reservationId: 1, itemSpecId: 1, cellId: 1, receiptId: 1, quantityOnHand: 1,
        quantityHeld: 1, quantityAvailable: 1, totalWeightKg: 1, totalVolumeM3: 1, ledgerRevision: 1, revision: 1 }),
    rows(db, 'managediteminstances', anyOf(referenceClause('skuId', skuIds), referenceClause('facilityId', facilityIds)),
      { _id: 1, skuId: 1, facilityId: 1, reservationId: 1, itemInstanceId: 1, status: 1, quantity: 1, unitWeightKgSnapshot: 1, unitVolumeM3Snapshot: 1, allocations: 1 }),
    rows(db, 'managedv3stockprojections', anyOf(referenceClause('skuId', skuIds), referenceClause('facilityId', facilityIds)),
      { _id: 1, skuId: 1, facilityId: 1, reservationId: 1, onHandQuantity: 1, heldQuantity: 1, totalWeightKg: 1, totalVolumeM3: 1 }),
    rows(db, 'managedv3batchplacements', anyOf(referenceClause('skuId', skuIds), referenceClause('facilityId', facilityIds)), { _id: 1, skuId: 1, facilityId: 1, reservationId: 1 }),
    rows(db, 'managedv3footprints', anyOf(referenceClause('physicalUnitId', physicalUnits.map(row => row._id)), referenceClause('facilityId', facilityIds)),
      { _id: 1, physicalUnitId: 1, facilityId: 1, reservationId: 1 }),
  ]);

  const scenarioRows = Object.fromEntries(selectedScenarioIds.map(id => [id, {}]));
  const assignRows = (name, documents, getScenario) => {
    for (const doc of documents) {
      const scenario = getScenario(doc);
      if (scenario && scenarioRows[scenario]) scenarioRows[scenario][name] = (scenarioRows[scenario][name] ?? 0) + 1;
    }
  };
  const userScenario = user => parseScenarioMarker(user.keycloakSub, runId)?.scenario ?? parseScenarioMarker(user.email, runId)?.scenario;
  const facilityScenario = facility => scenarioByFacility.get(idText(facility._id)) ?? parseScenarioMarker(facility.code, runId)?.scenario;
  const reservationScenario = row => scenarioByReservation.get(idText(row._id)) ?? scenarioByFacility.get(idText(row.facilityId)) ?? parseScenarioMarker(row.reservationCode, runId)?.scenario;
  const skuScenario = row => scenarioBySku.get(idText(row._id)) ?? scenarioByFacility.get(idText(row.facilityId)) ?? parseScenarioMarker(row.itemCode, runId)?.scenario;
  assignRows('users', users, userScenario); assignRows('facilities', facilities, facilityScenario);
  assignRows('reservations', reservations, reservationScenario); assignRows('inventoryitems', skus, skuScenario);
  assignRows('warehousezones', zones, row => scenarioByFacility.get(idText(row.facilityId)) ?? scenarioBySuffix.get(row.code?.slice(2).toUpperCase()));
  assignRows('warehouseracks', racks, row => scenarioByFacility.get(idText(row.facilityId)) ?? scenarioBySuffix.get(row.rackCode?.slice(2).toUpperCase()));
  assignRows('warehousecells', cells, row => scenarioByFacility.get(idText(row.facilityId)) ?? scenarioBySuffix.get(row.code?.match(/^C-([A-F\d]{16})/i)?.[1]?.toUpperCase()));
  for (const [name, docs, getParentScenario] of [
    ['reservationpayments', payments, row => scenarioByReservation.get(idText(row.reservationId)) ?? reservationScenario(reservations.find(item => idText(item.fullPaymentId) === idText(row._id)) ?? {})],
    ['contracts', contracts, row => scenarioByReservation.get(idText(row.reservationId)) ?? parseScenarioMarker(row.contractCode, runId)?.scenario],
    ['cellallocations', allocations, row => scenarioByReservation.get(idText(row.reservationId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managedaccessvisits', visits, row => scenarioByReservation.get(idText(row.reservationId)) ?? parseScenarioMarker(row.idempotencyKey, runId)?.scenario],
    ['managedaccesssessions', sessions, row => scenarioByReservation.get(idText(row.reservationId)) ?? parseScenarioMarker(row.checkInIdempotencyKey, runId)?.scenario],
    ['itemspecifications', specifications, row => scenarioBySku.get(idText(row.skuId)) ?? parseScenarioMarker(row.code, runId)?.scenario],
    ['itemmovements', movements, row => scenarioBySku.get(idText(row.itemId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managedcellstocks', stockRows, row => scenarioBySku.get(idText(row.skuId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managediteminstances', instances, row => scenarioBySku.get(idText(row.skuId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managedv3stockprojections', projections, row => scenarioBySku.get(idText(row.skuId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managedv3batchplacements', placements, row => scenarioBySku.get(idText(row.skuId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managedv3physicalunits', physicalUnits, row => scenarioBySku.get(idText(row.skuId)) ?? scenarioByFacility.get(idText(row.facilityId))],
    ['managedv3footprints', footprints, row => scenarioByPhysicalUnit.get(idText(row.physicalUnitId)) ?? scenarioByFacility.get(idText(row.facilityId))],
  ]) assignRows(name, docs, getParentScenario);
  const bySuffixScenario = suffix => scenarioBySuffix.get(String(suffix ?? '').toUpperCase());
  assignRows('managedinventorycategories', categories, row => scenarioBySuffix.get(row.code?.replace(/^CAT-/i, '').toUpperCase()) ?? userScenario(users.find(user => idText(user._id) === idText(row.createdBy)) ?? {}));
  assignRows('managedinventoryquantityunits', quantityUnits, row => scenarioBySuffix.get(row.code?.replace(/^UNIT-/i, '').toUpperCase()) ?? userScenario(users.find(user => idText(user._id) === idText(row.createdBy)) ?? {}));

  const countsByCollection = {};
  const collectionRows = { users, facilities, warehousezones: zones, warehouseracks: racks, warehousecells: cells, reservations, reservationpayments: payments,
    contracts, cellallocations: allocations, managedinventorycategories: categories, managedinventoryquantityunits: quantityUnits, inventoryitems: skus,
    itemspecifications: specifications, managedaccessvisits: visits, managedaccesssessions: sessions, itemmovements: movements, managedcellstocks: stockRows,
    managediteminstances: instances, managedv3stockprojections: projections, managedv3batchplacements: placements, managedv3physicalunits: physicalUnits, managedv3footprints: footprints };
  for (const [name, docs] of Object.entries(collectionRows)) countsByCollection[name] = docs.length;
  for (const scenario of selectedScenarioIds) {
    const counts = scenarioRows[scenario];
    counts.managedaccessvisits ??= 0; counts.managedaccesssessions ??= 0;
    counts.itemmovements ??= 0; counts.managedcellstocks ??= 0; counts.managediteminstances ??= 0;
    counts.managedv3stockprojections ??= 0; counts.managedv3batchplacements ??= 0; counts.managedv3physicalunits ??= 0; counts.managedv3footprints ??= 0;
  }

  const facilityIdSet = idSet(facilities.map(row => row._id));
  const reservationIdSet = idSet(reservations.map(row => row._id));
  const skuIdSet = idSet(skus.map(row => row._id));
  const cellIdSet = idSet(cells.map(row => row._id));
  const unresolved = [];
  const unresolvedCount = (docs, predicate) => docs.filter(predicate).length;
  addIssue(unresolved, 'reservation_facility_not_found', unresolvedCount(reservations, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'sku_facility_not_found', unresolvedCount(skus, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'sku_reservation_not_found', unresolvedCount(skus, row => row.reservationId && !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'contract_reservation_not_found', unresolvedCount(contracts, row => !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'payment_reservation_not_found', unresolvedCount(payments, row => row.reservationId && !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'cell_allocation_reservation_not_found', unresolvedCount(allocations, row => !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'cell_allocation_cell_not_found', unresolvedCount(allocations, row => !cellIdSet.has(idText(row.cellId))));
  addIssue(unresolved, 'specification_sku_not_found', unresolvedCount(specifications, row => !skuIdSet.has(idText(row.skuId))));
  addIssue(unresolved, 'movement_sku_not_found', unresolvedCount(movements, row => !skuIdSet.has(idText(row.itemId))));
  addIssue(unresolved, 'movement_facility_not_found', unresolvedCount(movements, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'stock_sku_not_found', unresolvedCount(stockRows, row => !skuIdSet.has(idText(row.skuId))));
  addIssue(unresolved, 'stock_facility_not_found', unresolvedCount(stockRows, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'stock_reservation_not_found', unresolvedCount(stockRows, row => row.reservationId && !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'stock_cell_not_found', unresolvedCount(stockRows, row => row.cellId && !cellIdSet.has(idText(row.cellId))));
  addIssue(unresolved, 'item_instance_sku_not_found', unresolvedCount(instances, row => !skuIdSet.has(idText(row.skuId))));
  addIssue(unresolved, 'item_instance_facility_not_found', unresolvedCount(instances, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'projection_sku_not_found', unresolvedCount(projections, row => !skuIdSet.has(idText(row.skuId))));
  addIssue(unresolved, 'projection_facility_not_found', unresolvedCount(projections, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'placement_sku_not_found', unresolvedCount(placements, row => !skuIdSet.has(idText(row.skuId))));
  addIssue(unresolved, 'physical_unit_sku_not_found', unresolvedCount(physicalUnits, row => !skuIdSet.has(idText(row.skuId))));
  addIssue(unresolved, 'footprint_physical_unit_not_found', unresolvedCount(footprints, row => !scenarioByPhysicalUnit.has(idText(row.physicalUnitId))));
  addIssue(unresolved, 'visit_reservation_not_found', unresolvedCount(visits, row => !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'visit_facility_not_found', unresolvedCount(visits, row => !facilityIdSet.has(idText(row.facilityId))));
  addIssue(unresolved, 'session_reservation_not_found', unresolvedCount(sessions, row => !reservationIdSet.has(idText(row.reservationId))));
  addIssue(unresolved, 'session_facility_not_found', unresolvedCount(sessions, row => !facilityIdSet.has(idText(row.facilityId))));

  const verifiedRootCounts = { users: users.length, facilities: facilities.length, reservations: reservations.length, inventoryitems: skus.length };
  const expectedRootCounts = { users: selectedScenarioIds.length * 3, facilities: selectedScenarioIds.length,
    reservations: selectedScenarioIds.length * 2, inventoryitems: selectedScenarioIds.length };
  const correlationIssues = [];
  for (const [collectionName, expected] of Object.entries(expectedRootCounts)) {
    if (verifiedRootCounts[collectionName] !== expected) correlationIssues.push({ code: 'ROOT_COUNT_MISMATCH', collection: collectionName,
      expected, found: verifiedRootCounts[collectionName] });
  }
  if (unresolved.length) correlationIssues.push(...unresolved);
  const globalMovementSummary = new Map();
  for (const row of movements) {
    const action = row.stockEffect?.action ?? 'UNKNOWN';
    const current = globalMovementSummary.get(action) ?? { action, count: 0, quantity: 0 };
    current.count += 1; current.quantity += Number(row.quantity ?? 0); globalMovementSummary.set(action, current);
  }
  const movementCount = movements.length;
  const stockTotals = stockRows.reduce((total, row) => ({ rows: total.rows + 1, quantityOnHand: total.quantityOnHand + Number(row.quantityOnHand ?? 0),
    quantityHeld: total.quantityHeld + Number(row.quantityHeld ?? 0), totalWeightKg: total.totalWeightKg + Number(row.totalWeightKg ?? 0),
    totalVolumeM3: total.totalVolumeM3 + Number(row.totalVolumeM3 ?? 0) }), { rows: 0, quantityOnHand: 0, quantityHeld: 0, totalWeightKg: 0, totalVolumeM3: 0 });
  const capacityRows = { facilities: facilities.map(row => ({ scenario: facilityScenario(row), managedAccessRevision: row.managedAccessRevision ?? null })),
    racks: racks.map(row => ({ scenario: scenarioByFacility.get(idText(row.facilityId)), managedInventoryRevision: row.managedInventoryRevision ?? null })),
    cells: cells.map(row => ({ scenario: scenarioByFacility.get(idText(row.facilityId)), usedWeightKg: row.usedWeightKg ?? null, usedVolumeM3: row.usedVolumeM3 ?? null, managedInventoryRevision: row.managedInventoryRevision ?? null })),
    reservations: reservations.map(row => ({ scenario: reservationScenario(row), usedCapacityM3: row.usedCapacityM3 ?? null, allocatedCapacity: row.allocatedCapacity ?? null, inventoryVersion: row.inventoryVersion ?? null })),
    skus: skus.map(row => ({ scenario: skuScenario(row), managedV3Revision: row.managedV3Revision ?? null })),
    specifications: specifications.map(row => ({ scenario: scenarioBySku.get(idText(row.skuId)), revision: row.revision ?? null, inboundRevision: row.inboundRevision ?? null })) };
  const inventoryStateNonzero = stockTotals.rows > 0 || instances.length > 0 || projections.some(row => Number(row.onHandQuantity ?? 0) !== 0 || Number(row.heldQuantity ?? 0) !== 0 || Number(row.totalWeightKg ?? 0) !== 0 || Number(row.totalVolumeM3 ?? 0) !== 0) ||
    placements.length > 0 || physicalUnits.length > 0 || footprints.length > 0 ||
    capacityRows.cells.some(row => Number(row.usedWeightKg) !== 0 || Number(row.usedVolumeM3) !== 0 || Number(row.managedInventoryRevision) !== 0) ||
    capacityRows.reservations.some(row => Number(row.usedCapacityM3) !== 0 || Number(row.inventoryVersion) !== 0) ||
    capacityRows.skus.some(row => Number(row.managedV3Revision) !== 0) || capacityRows.specifications.some(row => Number(row.inboundRevision) !== 0);
  const countDifferencesByScenario = {};
  for (const scenario of selectedScenarioIds) {
    const expectedAccess = expectedAccessDocs(scenario, caseId);
    const expected = { ...expectedPerScenario, managedaccessvisits: expectedAccess, managedaccesssessions: expectedAccess };
    const actual = scenarioRows[scenario];
    const differences = Object.entries(expected).filter(([name, value]) => (actual[name] ?? 0) !== value).map(([name, value]) => ({ collection: name, expected: value, actual: actual[name] ?? 0 }));
    if (differences.length) countDifferencesByScenario[scenario] = differences;
  }
  for (const [scenario, differences] of Object.entries(countDifferencesByScenario)) {
    for (const difference of differences) correlationIssues.push({ code: 'FIXTURE_COUNT_MISMATCH', scenario, ...difference });
  }
  const complete = correlationIssues.length === 0;
  const finalAuditCompleteness = complete ? 'COMPLETE' : 'INCOMPLETE';
  let caseVerification = null;
  if (['IT01', 'IT02', 'IT03'].includes(caseId) && finalAuditCompleteness === 'COMPLETE') {
    const sku = skus[0];
    const facility = facilities[0];
    const primaryReservation = reservations.find(row => idText(row._id) === idText(sku?.reservationId));
    const addMovements = movements.filter(row => row.stockEffect?.action === 'ADD');
    const skuSpecification = specifications.find(row => idText(row.skuId) === idText(sku?._id));
    const session = sessions.find(row => idText(row.reservationId) === idText(primaryReservation?._id));
    const rack = racks.find(row => idText(row.facilityId) === idText(sku?.facilityId));
    const close = (actual, expected, tolerance = 0.000001) => Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= tolerance;
    let checks, actual;
    if (caseId === 'IT01') {
      const instance = instances[0], instanceAllocations = instance?.allocations ?? [];
      const allocationWeightKg = instanceAllocations.reduce((sum, row) => sum + Number(row.weightKg ?? 0), 0);
      const allocationVolumeM3 = instanceAllocations.reduce((sum, row) => sum + Number(row.volumeM3 ?? 0), 0);
      const allocatedCells = instanceAllocations.map(row => cells.find(cell => idText(cell._id) === idText(row.cellId))).filter(Boolean);
      const cellWeightKg = allocatedCells.reduce((sum, row) => sum + Number(row.usedWeightKg ?? 0), 0);
      const cellVolumeM3 = allocatedCells.reduce((sum, row) => sum + Number(row.usedVolumeM3 ?? 0), 0);
      checks = [
        { name: 'one ADD Movement, quantity 1', pass: movements.length === 1 && addMovements.length === 1 && close(addMovements[0]?.quantity, 1, 0) },
        { name: 'one placed quantity-one Item Instance', pass: instances.length === 1 && instance?.status === 'PLACED' && close(instance?.quantity, 1, 0) },
        { name: 'A1 path has no A2 Cell Stock rows', pass: stockRows.length === 0 },
        { name: 'two-Cell instance load totals 10 kg / 0.008 m3', pass: instanceAllocations.length === 2 && close(allocationWeightKg, 10, 0.001) && close(allocationVolumeM3, 0.008) },
        { name: 'Cell counters match the instance allocation totals', pass: allocatedCells.length === 2 && close(cellWeightKg, 10, 0.001) && close(cellVolumeM3, 0.008) &&
          instanceAllocations.every(allocation => { const cell = cells.find(row => idText(row._id) === idText(allocation.cellId));
            return cell && close(cell.usedWeightKg, allocation.weightKg, 0.001) && close(cell.usedVolumeM3, allocation.volumeM3); }) },
        { name: 'Reservation capacity is 0.008 m3 and inventoryVersion is 1', pass: close(primaryReservation?.usedCapacityM3, 0.008) && close(primaryReservation?.inventoryVersion, 1, 0) &&
          Number(primaryReservation?.allocatedCapacity) >= 0.008 },
        { name: 'revision fences are at the expected post-confirm values', pass: close(sku?.managedV3Revision, 1, 0) && close(skuSpecification?.inboundRevision, 1, 0) &&
          close(session?.revision, 1, 0) && allocatedCells.every(cell => close(cell.managedInventoryRevision, 1, 0)) && close(rack?.managedInventoryRevision, 1, 0) },
      ];
      actual = { movements: { total: movements.length, ADD: addMovements.length, ADDQuantity: addMovements.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0) },
        itemInstances: instances.length, instanceQuantity: instance?.quantity ?? null,
        instanceLoad: { cells: instanceAllocations.length, weightKg: allocationWeightKg, volumeM3: allocationVolumeM3 },
        cellCounters: { cells: allocatedCells.length, weightKg: cellWeightKg, volumeM3: cellVolumeM3 },
        reservation: { usedCapacityM3: primaryReservation?.usedCapacityM3 ?? null, allocatedCapacity: primaryReservation?.allocatedCapacity ?? null,
          inventoryVersion: primaryReservation?.inventoryVersion ?? null },
        revisions: { sku: sku?.managedV3Revision ?? null, itemSpecificationInbound: skuSpecification?.inboundRevision ?? null,
          accessSession: session?.revision ?? null, cells: allocatedCells.map(cell => cell.managedInventoryRevision ?? null), rack: rack?.managedInventoryRevision ?? null } };
    } else if (caseId === 'IT02') {
      const stockByCell = new Map(stockRows.map(row => [idText(row.cellId), row]));
      const destination = addMovements[0]?.stockEffect?.destination ?? [];
      const cellLoads = stockRows.map(stock => {
        const cell = cells.find(row => idText(row._id) === idText(stock.cellId));
        const movementLine = destination.find(row => idText(row.cellId) === idText(stock.cellId));
        const cellNumber = Number(cell?.code?.match(/-(\d+)$/)?.[1]);
        return { cellNumber, quantity: Number(stock.quantityOnHand ?? 0), quantityAvailable: Number(stock.quantityAvailable ?? 0),
          quantityHeld: Number(stock.quantityHeld ?? 0), weightKg: Number(stock.totalWeightKg ?? 0), volumeM3: Number(stock.totalVolumeM3 ?? 0),
          cellWeightKg: Number(cell?.usedWeightKg ?? 0), cellVolumeM3: Number(cell?.usedVolumeM3 ?? 0), receiptMatchesMovement: !!movementLine &&
          idText(stock.receiptId) === idText(movementLine.receiptId) && close(stock.quantityOnHand, movementLine.quantity, 0) };
      }).sort((a, b) => a.cellNumber - b.cellNumber);
      const total = key => stockRows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
      const totalCellWeightKg = cellLoads.reduce((sum, row) => sum + row.cellWeightKg, 0);
      const totalCellVolumeM3 = cellLoads.reduce((sum, row) => sum + row.cellVolumeM3, 0);
      const receiptIds = new Set(stockRows.map(row => idText(row.receiptId)));
      checks = [
        { name: 'one ADD Movement, quantity 10, ledger revision 1', pass: movements.length === 1 && addMovements.length === 1 && close(addMovements[0]?.quantity, 10, 0) && close(addMovements[0]?.stockEffect?.ledgerRevision, 1, 0) },
        { name: 'two Cell Stock rows split 6 and 4 with full available quantity', pass: stockRows.length === 2 && cellLoads.map(row => row.quantity).join(',') === '6,4' &&
          cellLoads.every(row => row.quantityAvailable === row.quantity && row.quantityHeld === 0) && close(total('quantityOnHand'), 10, 0) },
        { name: 'A2 weight and volume totals are 100 kg / 0.08 m3', pass: close(total('totalWeightKg'), 100, 0.001) && close(total('totalVolumeM3'), 0.08) },
        { name: 'per-Cell weight and volume follow the 6/4 quantity split', pass: cellLoads.length === 2 && cellLoads.every(row =>
          close(row.weightKg, row.quantity * 10, 0.001) && close(row.volumeM3, row.quantity * 0.008)) },
        { name: 'two Cell counters match the 6/4 stock split', pass: cellLoads.length === 2 && cellLoads.every(row => close(row.cellWeightKg, row.weightKg, 0.001) && close(row.cellVolumeM3, row.volumeM3)) &&
          close(totalCellWeightKg, 100, 0.001) && close(totalCellVolumeM3, 0.08) },
        { name: 'receipt lineage matches both ADD destination lines', pass: destination.length === 2 && receiptIds.size === 1 && cellLoads.every(row => row.receiptMatchesMovement) &&
          destination.every(line => stockByCell.has(idText(line.cellId))) },
        { name: 'A2 path has no Item Instance rows', pass: instances.length === 0 },
        { name: 'Reservation capacity is 0.08 m3 and inventoryVersion is 1', pass: close(primaryReservation?.usedCapacityM3, 0.08) && close(primaryReservation?.inventoryVersion, 1, 0) &&
          Number(primaryReservation?.allocatedCapacity) >= 0.08 },
        { name: 'Facility/Reservation/SKU/spec/session/Cell/Rack revision fences are at expected values', pass: close(facility?.managedAccessRevision, 1, 0) &&
          close(primaryReservation?.managedAccessRevision, 1, 0) && close(sku?.managedV3Revision, 1, 0) && close(skuSpecification?.inboundRevision, 1, 0) &&
          close(session?.revision, 1, 0) && cellLoads.every(row => close(row.cellWeightKg, row.weightKg, 0.001)) &&
          cellLoads.every(row => close(cells.find(cell => Number(cell.code?.match(/-(\d+)$/)?.[1]) === row.cellNumber)?.managedInventoryRevision, 1, 0)) && close(rack?.managedInventoryRevision, 1, 0) &&
          stockRows.every(row => close(row.ledgerRevision, 1, 0)) },
      ];
      actual = { movements: { total: movements.length, ADD: addMovements.length, ADDQuantity: addMovements.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0),
          ledgerRevision: addMovements[0]?.stockEffect?.ledgerRevision ?? null },
        cellStock: { rows: stockRows.length, quantityOnHand: total('quantityOnHand'), quantityAvailable: total('quantityAvailable'),
          quantityHeld: total('quantityHeld'), weightKg: total('totalWeightKg'), volumeM3: total('totalVolumeM3'), ledgerRevisions: stockRows.map(row => row.ledgerRevision),
          distinctReceiptCount: receiptIds.size, receiptLineageMatchesMovement: cellLoads.every(row => row.receiptMatchesMovement) },
        cellLoads, itemInstances: instances.length,
        reservation: { usedCapacityM3: primaryReservation?.usedCapacityM3 ?? null, allocatedCapacity: primaryReservation?.allocatedCapacity ?? null,
          inventoryVersion: primaryReservation?.inventoryVersion ?? null },
        revisions: { facilityAccess: facility?.managedAccessRevision ?? null, reservationAccess: primaryReservation?.managedAccessRevision ?? null,
          sku: sku?.managedV3Revision ?? null, itemSpecificationInbound: skuSpecification?.inboundRevision ?? null,
          accessSession: session?.revision ?? null, cells: cells.filter(cell => stockByCell.has(idText(cell._id))).map(cell => cell.managedInventoryRevision ?? null), rack: rack?.managedInventoryRevision ?? null } };
    } else {
      const orderedMovements = [...movements].sort((a, b) => Number(a.stockEffect?.ledgerRevision ?? 0) - Number(b.stockEffect?.ledgerRevision ?? 0));
      const removes = orderedMovements.filter(row => row.stockEffect?.action === 'REMOVE');
      const add = orderedMovements.find(row => row.stockEffect?.action === 'ADD');
      const destination = add?.stockEffect?.destination ?? [];
      const receiptId = destination[0]?.receiptId;
      const fifoLots = [...destination].sort((a, b) => idText(a.cellId).localeCompare(idText(b.cellId)));
      const remainingByCell = new Map(fifoLots.map(line => [idText(line.cellId), Number(line.quantity)]));
      const expectedRemoveSources = [3, 7].map(quantity => {
        let needed = quantity; const expected = [];
        for (const lot of fifoLots) {
          const cellId = idText(lot.cellId), available = remainingByCell.get(cellId) ?? 0;
          const take = Math.min(available, needed);
          if (take > 0) { expected.push({ cellId, quantity: take }); remainingByCell.set(cellId, available - take); needed -= take; }
          if (!needed) break;
        }
        return { expected, complete: needed === 0 };
      });
      const actualRemoveSources = removes.map(row => (row.stockEffect?.source ?? []).map(line => ({ cellId: idText(line.cellId), quantity: Number(line.quantity ?? 0) }))
        .sort((a, b) => a.cellId.localeCompare(b.cellId)));
      const normalizedExpectedSources = expectedRemoveSources.map(row => [...row.expected].sort((a, b) => a.cellId.localeCompare(b.cellId)));
      const sourceReceiptValid = removes.every(row => (row.stockEffect?.source ?? []).length > 0 && row.stockEffect.source.every(line => idText(line.receiptId) === idText(receiptId)));
      const cellsById = new Map(cells.map(cell => [idText(cell._id), cell]));
      const touchedCells = destination.map(line => cellsById.get(idText(line.cellId))).filter(Boolean);
      const sessionRows = sessions.filter(row => idText(row.reservationId) === idText(primaryReservation?._id));
      const sessionRevisions = sessionRows.map(row => Number(row.revision)).sort((a, b) => a - b);
      checks = [
        { name: 'ADD 10 and REMOVE 3/7 persist as ledger revisions 1/2/3', pass: orderedMovements.length === 3 && orderedMovements.map(row => row.stockEffect?.ledgerRevision).join(',') === '1,2,3' &&
          orderedMovements[0]?.stockEffect?.action === 'ADD' && close(orderedMovements[0]?.quantity, 10, 0) && removes.length === 2 &&
          removes.map(row => Number(row.quantity)).sort((a, b) => a - b).join(',') === '3,7' && removes.every(row => row.stockEffect?.action === 'REMOVE') },
        { name: 'REMOVE receipt lineage and FIFO consumption match the ADD lots', pass: destination.length === 2 && new Set(destination.map(line => idText(line.receiptId))).size === 1 &&
          expectedRemoveSources.every(row => row.complete) && JSON.stringify(actualRemoveSources) === JSON.stringify(normalizedExpectedSources) && sourceReceiptValid },
        { name: 'full removal deletes zeroed Cell Stock lots and leaves on-hand zero', pass: stockRows.length === 0 && stockTotals.quantityOnHand === 0 &&
          stockTotals.quantityHeld === 0 && stockTotals.totalWeightKg === 0 && stockTotals.totalVolumeM3 === 0 },
        { name: 'both affected Cell counters are zero after removal', pass: touchedCells.length === 2 && touchedCells.every(cell => close(cell.usedWeightKg, 0) && close(cell.usedVolumeM3, 0)) },
        { name: 'Reservation capacity returns to zero with inventoryVersion 3', pass: close(primaryReservation?.usedCapacityM3, 0) && close(primaryReservation?.inventoryVersion, 3, 0) },
        { name: 'Facility/Rack/SKU/spec/Cell and Reservation revision fences match three operations', pass: close(facility?.managedAccessRevision, 3, 0) &&
          close(rack?.managedInventoryRevision, 3, 0) && close(sku?.managedV3Revision, 3, 0) && close(skuSpecification?.inboundRevision, 3, 0) &&
          touchedCells.map(cell => Number(cell.managedInventoryRevision)).sort((a, b) => a - b).join(',') === '2,3' && close(primaryReservation?.managedAccessRevision, 3, 0) },
        { name: 'three access sessions retain operation fences and two replacement revocations', pass: sessionRows.length === 3 &&
          sessionRevisions.join(',') === '1,2,2' && sessionRows.filter(row => row.status === 'ACTIVE').length === 1 },
        { name: 'A2 leaves no Item Instance rows', pass: instances.length === 0 },
      ];
      actual = { movements: { total: orderedMovements.length, actions: orderedMovements.map(row => row.stockEffect?.action),
            quantities: orderedMovements.map(row => Number(row.quantity)), ledgerRevisions: orderedMovements.map(row => row.stockEffect?.ledgerRevision) },
          cellStock: { rows: stockRows.length, quantityOnHand: stockTotals.quantityOnHand, quantityHeld: stockTotals.quantityHeld,
            totalWeightKg: stockTotals.totalWeightKg, totalVolumeM3: stockTotals.totalVolumeM3 },
          receiptLineage: { distinctAddReceipts: new Set(destination.map(line => idText(line.receiptId))).size,
            removeSourcesMatchFIFO: JSON.stringify(actualRemoveSources) === JSON.stringify(normalizedExpectedSources), sourceReceiptValid },
          cells: touchedCells.map(cell => ({ usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3, revision: cell.managedInventoryRevision })),
          reservation: { usedCapacityM3: primaryReservation?.usedCapacityM3 ?? null, allocatedCapacity: primaryReservation?.allocatedCapacity ?? null,
            inventoryVersion: primaryReservation?.inventoryVersion ?? null },
          revisions: { facilityAccess: facility?.managedAccessRevision ?? null, reservationAccess: primaryReservation?.managedAccessRevision ?? null,
            sku: sku?.managedV3Revision ?? null, itemSpecification: skuSpecification?.inboundRevision ?? null,
            sessions: sessionRows.map(row => ({ revision: row.revision, status: row.status })), rack: rack?.managedInventoryRevision ?? null } };
    }
    caseVerification = { status: checks.every(check => check.pass) ? 'PASS' : 'FAIL', checks, actual };
  }
  const finalInventoryConsistency = finalAuditCompleteness !== 'COMPLETE' ? 'NOT_VERIFIED' : ['IT01', 'IT02', 'IT03'].includes(caseId) ? caseVerification?.status ?? 'FAIL' : movementCount > 0 ? 'NOT_VERIFIED' : inventoryStateNonzero ? 'FAIL' : 'PASS';
  if (caseId) return { database: db.databaseName, runId, caseId, auditCompleteness: finalAuditCompleteness,
    fixtureCounts: { actual: scenarioRows[caseId], expected: { ...expectedPerScenario, managedaccessvisits: expectedAccessDocs(caseId, caseId), managedaccesssessions: expectedAccessDocs(caseId, caseId) },
      differences: countDifferencesByScenario[caseId] ?? [] }, verifiedRootCounts, expectedRootCounts, correlationIssues,
    inventoryConsistency: finalInventoryConsistency, inventoryCheck: caseVerification,
    readOnly: true, credentialsRedacted: true };
  return { database: db.databaseName, runId, auditCompleteness: finalAuditCompleteness, correlationIssues, verifiedRootCounts, expectedRootCounts,
    fixtureDocumentCounts: countsByCollection, fixtureCountsByScenario: scenarioRows, fixtureCountDifferencesByScenario: countDifferencesByScenario,
    orphanOrUnresolvedReferences: unresolved, movementActions: [...globalMovementSummary.values()], stockTotals,
    itemInstanceCount: instances.length, v3ProjectionCounts: { stockProjections: projections.length, batchPlacements: placements.length, physicalUnits: physicalUnits.length, footprints: footprints.length },
    capacityCounters: capacityRows, inventoryConsistency: finalInventoryConsistency, userDataRedacted: true, personalDataReturned: false, readOnly: true };
}

async function main() {
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL is not configured.');
  const { runId, caseId } = parseCliArgs(process.argv.slice(2));
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 6000 });
  try { await client.connect(); const result = await auditRun({ client, runId, caseId }); console.log(JSON.stringify(result, null, 2)); }
  finally { await client.close(); }
}

function parseCliArgs(args) {
  let runId = null, caseId = null;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--case') {
      if (caseId || !args[index + 1]) throw new Error('--case requires exactly one CaseId.');
      caseId = args[index + 1]; index += 1;
    } else if (value.startsWith('--')) throw new Error(`Unknown audit option: ${value}`);
    else if (!runId) runId = value;
    else throw new Error('Only one RunId may be supplied.');
  }
  if (!runId || !/^[a-zA-Z0-9-]{8,80}$/.test(runId)) throw new Error('A valid RunId is required.');
  if (caseId && !/^IT(?:0[1-9]|10)$/.test(caseId)) throw new Error('CaseId must be one of IT01 through IT10.');
  return { runId, caseId };
}

if (require.main === module) main().catch(error => {
  const message = String(error?.message ?? 'Unknown error').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI REDACTED]');
  console.error(JSON.stringify({ status: 'READ_ONLY_AUDIT_FAILED', name: error?.name ?? 'Error', code: error?.code ?? null, message, readOnly: true, credentialsRedacted: true }));
  process.exitCode = 1;
});

module.exports = { auditRun, escapeRegex, parseScenarioMarker, parseCliArgs, refValues, expectedPerScenario };
