const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Session = require('../dist/models/access/managed-access-session.model').default;
const Visit = require('../dist/models/access/managed-access-visit.model').default;
const { activeSessionScopeFilter, normalizedReservationScope, ManagedAccessError } = require('../dist/services/access/managed-access.service');

const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));
const id = value => String(value);
function matchesFilter(session, filter) {
  const scopeMatch = filter.$or.some(branch => {
    if (branch.reservationId) return branch.reservationId.$in.some(value => id(value) === id(session.reservationId));
    return branch.scopedReservationIds.$in.some(value => (session.scopedReservationIds || []).some(item => id(item) === id(value)));
  });
  return scopeMatch && session.status === filter.status && session.expiresAt > filter.expiresAt.$gt;
}

test('active session overlap filter catches primary-to-primary reservation collision', () => {
  const reservationA = oid(1), filter = activeSessionScopeFilter([reservationA], new Date('2026-11-17T10:00:00Z'));
  assert.equal(matchesFilter({ reservationId: reservationA, scopedReservationIds: [reservationA], status: 'ACTIVE', expiresAt: new Date('2026-11-17T11:00:00Z') }, filter), true);
});

test('active session overlap filter catches new primary matching old secondary scope', () => {
  const reservationA = oid(2), reservationB = oid(3), filter = activeSessionScopeFilter([reservationB], new Date());
  assert.equal(matchesFilter({ reservationId: reservationA, scopedReservationIds: [reservationA, reservationB], status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }, filter), true);
});

test('active session overlap filter catches new secondary matching old primary', () => {
  const reservationA = oid(4), reservationB = oid(5), filter = activeSessionScopeFilter([reservationA, reservationB], new Date());
  assert.equal(matchesFilter({ reservationId: reservationB, scopedReservationIds: [reservationB], status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }, filter), true);
});

test('active session overlap filter catches matching secondary scopes', () => {
  const shared = oid(6), filter = activeSessionScopeFilter([oid(7), shared], new Date());
  assert.equal(matchesFilter({ reservationId: oid(8), scopedReservationIds: [oid(8), shared], status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }, filter), true);
});

test('revoked and expired Sessions do not count as active scope conflicts', () => {
  const reservationId = oid(9), now = new Date(), filter = activeSessionScopeFilter([reservationId], now);
  assert.equal(matchesFilter({ reservationId, scopedReservationIds: [reservationId], status: 'REVOKED', expiresAt: new Date(now.getTime() + 60_000) }, filter), false);
  assert.equal(matchesFilter({ reservationId, scopedReservationIds: [reservationId], status: 'ACTIVE', expiresAt: new Date(now.getTime() - 1) }, filter), false);
});

test('independent Reservation scopes do not conflict even at the same Facility', () => {
  const filter = activeSessionScopeFilter([oid(10), oid(11)], new Date());
  assert.equal(matchesFilter({ reservationId: oid(12), scopedReservationIds: [oid(12)], status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }, filter), false);
});

test('Session schema declares unique partial indexes for primary and complete active scope', () => {
  const indexes = Session.schema.indexes();
  const primary = indexes.find(([keys, options]) => keys.reservationId === 1 && options.name === 'managed_access_session_active_reservation_unique');
  const scope = indexes.find(([keys, options]) => keys.scopedReservationIds === 1 && options.name === 'managed_access_session_active_scope_unique');
  for (const index of [primary, scope]) {
    assert.ok(index, 'required active Session uniqueness index is declared');
    assert.equal(index[1].unique, true);
    assert.deepEqual(index[1].partialFilterExpression, { status: 'ACTIVE' });
  }
});

test('scope normalization always includes primary once and sorts secondary IDs deterministically', () => {
  const primary = oid(13), secondaryB = oid(15), secondaryA = oid(14);
  assert.deepEqual(normalizedReservationScope(primary, [secondaryB, primary, secondaryA]).map(String), [primary, secondaryA, secondaryB].map(String));
  assert.deepEqual(normalizedReservationScope(primary, undefined, true).map(String), [String(primary)]);
});

test('scope normalization rejects empty, malformed, duplicate and primary-missing scopes', () => {
  const primary = oid(16), other = oid(17);
  for (const value of [[], ['not-an-object-id'], [primary, primary], [other]]) {
    assert.throws(() => normalizedReservationScope(primary, value), error => error instanceof ManagedAccessError && error.code === 'INVALID_RESERVATION_SCOPE');
  }
});

test('Visit and Session schema validators reject empty, duplicate or primary-missing persisted scopes', () => {
  const primary = oid(18), other = oid(19);
  for (const Model of [Visit, Session]) {
    const make = scopedReservationIds => new Model({ reservationId: primary, scopedReservationIds });
    assert.equal(make([primary, other]).validateSync()?.errors?.scopedReservationIds, undefined);
    assert.ok(make([]).validateSync()?.errors?.scopedReservationIds);
    assert.ok(make([other]).validateSync()?.errors?.scopedReservationIds);
    assert.ok(make([primary, primary]).validateSync()?.errors?.scopedReservationIds);
    assert.deepEqual(make(undefined).scopedReservationIds.map(String), [String(primary)]);
  }
});
