const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const { AdminReservationListService, parseReservationListQuery, ReservationListError } = require('../dist/services/operations/admin-reservation-list.service');
const router = require('../dist/routes/reservation.routes').default;
const oid = n => new Types.ObjectId(String(n).padStart(24, '0'));
class Query {
  constructor(rows) { this.rows = rows; this.calls = {}; }
  select(v) { this.calls.select = v; return this; }
  populate(...v) { (this.calls.populate ??= []).push(v); return this; }
  sort(v) { this.calls.sort = v; return this; }
  skip(v) { this.calls.skip = v; return this; }
  limit(v) { this.calls.limit = v; return this; }
  lean() { return this; }
  exec() { return Promise.resolve(this.rows); }
}
test('Admin reservation listing validates filters and applies date, service, status and escaped code in DB query', () => {
  const parsed = parseReservationListQuery({ facilityId: String(oid(1)), serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', reservationCode: 'R.*', fromDate: '2026-11-01', toDate: '2026-11-02', page: '2', limit: '10' }, { role: 'ADMIN' });
  assert.equal(String(parsed.filter.facilityId), String(oid(1)));
  assert.equal(parsed.filter.serviceType, 'MANAGED_INVENTORY'); assert.equal(parsed.filter.status, 'ACTIVE');
  assert.equal(parsed.filter.reservationCode.source, 'R\\.\\*');
  assert.equal(parsed.filter.createdAt.$gte.toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(parsed.filter.createdAt.$lt.toISOString(), '2026-11-02T17:00:00.000Z');
  for (const query of [{ status: 'NOPE' }, { page: '0' }, { limit: '101' }, { customerId: 'x' }, { unsupported: 'x' }]) assert.throws(() => parseReservationListQuery(query, { role: 'ADMIN' }), ReservationListError);
});
test('Admin/BOM can query across Facilities; Manager/Staff are scoped before count and pagination', async t => {
  let filter, query;
  const facility = { _id: oid(2), name: 'F2', code: 'F2' };
  const row = { _id: oid(3), reservationCode: 'R-3', serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', customerId: { _id: oid(4), displayName: 'A' }, facilityId: facility, storageUnitId: null, allocatedCapacity: 10 };
  t.mock.method(ReservationModel, 'find', value => { filter = value; query = new Query([row]); return query; });
  t.mock.method(ReservationModel, 'countDocuments', value => { assert.equal(value, filter); return { exec: async () => 21 }; });
  const result = await AdminReservationListService.list({ page: '2', limit: '10' }, { role: 'BOM' });
  assert.deepEqual(filter, {}); assert.deepEqual(query.calls.sort, { createdAt: -1, _id: -1 }); assert.equal(query.calls.skip, 10);
  assert.equal(result.pagination.total, 21); assert.equal(result.items[0].serviceType, 'MANAGED_INVENTORY');
  assert.equal(Object.hasOwn(result.items[0], 'paymentSimulation'), false);
  const assigned = parseReservationListQuery({ facilityId: String(oid(2)) }, { role: 'FACILITY_MANAGER', assignedFacilityId: oid(2) });
  assert.equal(String(assigned.filter.facilityId), String(oid(2)));
  assert.throws(() => parseReservationListQuery({ facilityId: String(oid(5)) }, { role: 'FACILITY_STAFF', assignedFacilityId: oid(2) }), e => e.status === 403);
  assert.throws(() => parseReservationListQuery({}, { role: 'FACILITY_MANAGER' }), e => e.status === 403);
});
test('Reservation admin-list route is limited to operational roles and customer route remains separate', () => {
  const route = router.stack.find(layer => layer.route?.path === '/admin-list').route;
  const allowed = ['ADMIN','BOM','FACILITY_MANAGER','FACILITY_STAFF','CUSTOMER'].filter(role => { let pass=false; route.stack[0].handle({user:{role}}, {status(){return this},json(){}}, ()=>pass=true); return pass; });
  assert.deepEqual(allowed.sort(), ['ADMIN','BOM','FACILITY_MANAGER','FACILITY_STAFF']);
});
