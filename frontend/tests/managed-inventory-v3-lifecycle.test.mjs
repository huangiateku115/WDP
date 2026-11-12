import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleInventoryRegistration } from '../src/lib/inventoryRegistration.js';
import { reservationLifecycle } from '../src/lib/customerReservationService.js';

const id = '507f1f77bcf86cd799439011';
const base = { _id: id, facilityId: id, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3,
  allocatedCapacity: 2, startDate: '2026-11-10T00:00:00Z', endDate: '2026-12-10T00:00:00Z' };

test('Customer may prepare a V3 SKU at CHECKIN_READY and during an in-term ACTIVE rental only', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(eligibleInventoryRegistration({ ...base, status: 'CHECKIN_READY' }, now), true);
  assert.equal(eligibleInventoryRegistration({ ...base, status: 'ACTIVE' }, now), true);
  for (const status of ['RESERVED', 'PAID', 'DEPOSIT_PAID', 'CANCELLED']) assert.equal(eligibleInventoryRegistration({ ...base, status }, now), false);
  assert.equal(eligibleInventoryRegistration({ ...base, status: 'ACTIVE', endDate: '2026-11-11T00:00:00Z' }, now), false);
  assert.equal(eligibleInventoryRegistration({ ...base, bookingFlowVersion: 2, status: 'DEPOSIT_PAID' }, now), false);
});

test('V3 lifecycle labels reflect full rent, paper contract, handover, and SKU preparation stages', () => {
  assert.match(reservationLifecycle({ ...base, status: 'RESERVED', rentalPaymentFlow: 'FULL_UPFRONT_V1' }).description, /100%/);
  assert.match(reservationLifecycle({ ...base, status: 'PAID', rentalPaymentFlow: 'FULL_UPFRONT_V1' }).description, /hợp đồng giấy/);
  assert.match(reservationLifecycle({ ...base, status: 'CHECKIN_READY' }).description, /chuẩn bị SKU/);
  assert.match(reservationLifecycle({ ...base, status: 'ACTIVE' }).description, /Access Session|quy trình V3/);
  assert.doesNotMatch(reservationLifecycle({ ...base, status: 'RESERVED' }).description, /Deposit|Balance|Manager approval/i);
});
