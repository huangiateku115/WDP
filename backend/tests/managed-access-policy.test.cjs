const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sessionExpiry, sessionIsCurrent, isAccessSessionAllowed } = require('../dist/services/access/managed-access-policy');
const base = { status:'ACTIVE', startedAt:new Date('2026-11-12T10:00:00.000Z'), expiresAt:new Date('2026-11-12T11:00:00.000Z'), revision:4,
  customerId:'customer-1', reservationId:'reservation-1', facilityId:'facility-1', allowedPurposes:['INBOUND','INSPECTION'], allowedCellIds:['cell-1','cell-2'],
  expected:{now:new Date('2026-11-12T10:30:00.000Z'),revision:4,customerId:'customer-1',reservationId:'reservation-1',facilityId:'facility-1',purpose:'INBOUND',cellId:'cell-2'} };

test('access session duration is exactly 60 minutes from server start',()=>{
 const start=new Date('2026-11-12T10:00:00.000Z');
 assert.equal(sessionExpiry(start).toISOString(),'2026-11-12T11:00:00.000Z');
});
test('session expiry is capped by Rental and Visit boundaries and rejects a boundary at or before check-in',()=>{
 const start=new Date('2026-11-12T10:00:00.000Z');
 assert.equal(sessionExpiry(start,[new Date('2026-11-12T10:20:00.000Z'),new Date('2026-11-12T10:30:00.000Z')]).toISOString(),'2026-11-12T10:20:00.000Z');
 assert.equal(sessionExpiry(start,[new Date('2026-11-12T11:00:00.000Z')]).toISOString(),'2026-11-12T11:00:00.000Z');
 assert.throws(()=>sessionExpiry(start,[start]));
});
test('session expiry boundary is exclusive and issued sessions cannot start in the future',()=>{
 const startedAt=new Date('2026-11-12T10:00:00.000Z'),expiresAt=new Date('2026-11-12T11:00:00.000Z');
 assert.equal(sessionIsCurrent({status:'ACTIVE',startedAt,expiresAt,now:new Date('2026-11-12T10:59:59.999Z')}),true);
 assert.equal(sessionIsCurrent({status:'ACTIVE',startedAt,expiresAt,now:expiresAt}),false);
 assert.equal(sessionIsCurrent({status:'ACTIVE',startedAt:new Date('2026-11-12T10:01:00.000Z'),expiresAt,now:startedAt}),false);
});
test('access scope accepts only active, unexpired session with matching customer, reservation, facility, purpose, Cell and revision',()=>{
 assert.equal(isAccessSessionAllowed(base),true);
 for(const changed of [
  {...base,status:'REVOKED'},
  {...base,expected:{...base.expected,now:new Date('2026-11-12T11:00:00.000Z')}},
  {...base,startedAt:new Date('2026-11-12T10:31:00.000Z')},
  {...base,expected:{...base.expected,customerId:'other'}},
  {...base,expected:{...base.expected,reservationId:'other'}},
  {...base,expected:{...base.expected,facilityId:'other'}},
  {...base,expected:{...base.expected,purpose:'OUTBOUND'}},
  {...base,expected:{...base.expected,cellId:'cell-3'}},
  {...base,expected:{...base.expected,revision:3}},
 ]) assert.equal(isAccessSessionAllowed(changed),false);
});
