'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStatisticsQuery, StatisticsQueryError } = require('../dist/services/statistics/statistics.validation');
const { summarizeStorageRows, summarizeManagedCellRows, summarizeReservationRows, summarizeContractRows } = require('../dist/services/statistics/statistics-phase2.service');
const { StorageUnitStatus } = require('../dist/types/storage-unit.type');
const { ReservationStatus } = require('../dist/types/reservation.type');
const { ContractStatus } = require('../dist/types/contract.type');

test('Phase 2 query filters validate unit size, endpoint status values, and expiring window', () => {
  assert.equal(parseStatisticsQuery({ unitSize: 'SMALL' }).unitSize, 'SMALL');
  assert.equal(parseStatisticsQuery({ status: ReservationStatus.ACTIVE }).status, ReservationStatus.ACTIVE);
  assert.equal(parseStatisticsQuery({ expiringWithinDays: '365' }).expiringWithinDays, 365);
  assert.throws(() => parseStatisticsQuery({ unitSize: 'HUGE' }), error => error instanceof StatisticsQueryError && error.code === 'INVALID_UNIT_SIZE');
  assert.throws(() => parseStatisticsQuery({ expiringWithinDays: '0' }), error => error instanceof StatisticsQueryError && error.code === 'INVALID_PAGINATION');
  assert.throws(() => parseStatisticsQuery({ expiringWithinDays: '366' }), error => error instanceof StatisticsQueryError && error.code === 'INVALID_PAGINATION');
});

test('storage capacity counts current unit rows once and keeps maintenance out of rentable denominator', () => {
  const summary = summarizeStorageRows([
    { facilityId: 'F1', size: 'SMALL', status: StorageUnitStatus.OCCUPIED, unitCount: 2 },
    { facilityId: 'F1', size: 'SMALL', status: StorageUnitStatus.AVAILABLE, unitCount: 3 },
    { facilityId: 'F2', size: 'LARGE', status: StorageUnitStatus.MAINTENANCE, unitCount: 1 },
    { facilityId: 'F2', size: 'LARGE', status: StorageUnitStatus.INACTIVE, unitCount: 1 },
  ]);
  assert.equal(summary.totalUnits, 7);
  assert.equal(summary.rentableUnits, 5);
  assert.equal(summary.occupancyRate, 40);
  assert.equal(summary.availabilityRate, 60);
  assert.equal(summary.capacityByFacility.length, 2);
});

test('storage empty source returns null ratios and unknown status is unavailable', () => {
  const empty = summarizeStorageRows([]);
  assert.equal(empty.totalUnits, 0);
  assert.equal(empty.occupancyRate, null);
  const unknown = summarizeStorageRows([{ facilityId: 'F', size: 'SMALL', status: 'LEGACY_UNKNOWN', unitCount: 1 }]);
  assert.equal(unknown.unavailableUnits, 1);
  assert.equal(unknown.occupancyRate, null);
});

test('managed capacity treats A1 multi-Cell load per Cell without exposing duplicate physical item counts', () => {
  const summary = summarizeManagedCellRows([
    { totalCells: 1, availableCells: 0, allocatedCells: 1, nonAvailableCells: 0, volumeCapacityKnownM3: 1, usedVolumeM3: 0.2, capacityWeightKg: 100, usedWeightKg: 10, missingVolumeCells: 0 },
    { totalCells: 1, availableCells: 0, allocatedCells: 1, nonAvailableCells: 0, volumeCapacityKnownM3: 1, usedVolumeM3: 0.3, capacityWeightKg: 100, usedWeightKg: 15, missingVolumeCells: 0 },
  ], true);
  assert.equal(summary.totalCells, 2);
  assert.equal(summary.allocatedCells, 2);
  assert.equal(summary.usedVolumeM3, 0.5);
  assert.equal(summary.usedWeightKg, 25);
  assert.equal(Object.hasOwn(summary, 'physicalUnitCount'), false);
  assert.equal(summary.volumeUtilizationRate, 25);
});

test('managed capacity does not invent volume capacity when usable height is missing or stock is stale', () => {
  const unknownHeight = summarizeManagedCellRows([{ totalCells: 1, volumeCapacityKnownM3: 0, missingVolumeCells: 1, capacityWeightKg: 100 }], true);
  assert.equal(unknownHeight.capacityVolumeM3, null);
  assert.equal(unknownHeight.volumeUtilizationRate, null);
  const stale = summarizeManagedCellRows([{ totalCells: 1, availableCells: 1, allocatedCells: 0, capacityVolumeKnownM3: 2, usedVolumeM3: 0, capacityWeightKg: 100, usedWeightKg: 0 }], false);
  assert.equal(stale.availableCells, null);
  assert.equal(stale.usedVolumeM3, null);
  assert.equal(stale.weightUtilizationRate, null);
});

test('reservation cohort counts verified payments once and does not treat renewals as new reservations', () => {
  const rows = [
    { facilityId: 'F1', serviceType: 'SELF_STORAGE', status: ReservationStatus.ACTIVE, verifiedPaid: true, signedContract: true },
    { facilityId: 'F1', serviceType: 'SELF_STORAGE', status: ReservationStatus.CANCELLED, verifiedPaid: false },
    { facilityId: 'F2', serviceType: 'MANAGED_INVENTORY', status: ReservationStatus.DEPOSIT_PAID, verifiedPaid: false },
    { facilityId: 'F2', serviceType: 'MANAGED_INVENTORY', status: ReservationStatus.OVERDUE, verifiedPaid: true },
  ];
  const summary = summarizeReservationRows(rows);
  assert.equal(summary.totalReservations, 4);
  assert.equal(summary.paidReservations, 2);
  assert.equal(summary.pendingPaymentReservations, 1);
  assert.equal(summary.cancelledReservations, 1);
  assert.equal(summary.overdueReservations, 1);
  assert.equal(summary.cancellationRate, 25);
});

test('contract lifecycle requires signed evidence and returns only observed renewal counts', () => {
  const now = new Date('2026-11-17T00:00:00.000Z');
  const rows = [
    { status: ContractStatus.SIGNED, isSigned: true, reservationStatus: ReservationStatus.ACTIVE, reservationEndDate: '2026-12-01T00:00:00.000Z', renewalPairs: ['a|b', 'a|b'] },
    { status: ContractStatus.SIGNED, isSigned: false, reservationStatus: ReservationStatus.ACTIVE, reservationEndDate: '2026-11-20T00:00:00.000Z', renewalPairs: [] },
    { status: ContractStatus.DRAFT, isSigned: false, reservationStatus: ReservationStatus.CHECKED_OUT, renewalPairs: [] },
  ];
  const summary = summarizeContractRows(rows, 30, now);
  assert.equal(summary.totalContracts, 3);
  assert.equal(summary.signedContracts, 1);
  assert.equal(summary.unsignedContracts, 1);
  assert.equal(summary.activeContracts, 1);
  assert.equal(summary.expiringSoonContracts, 1);
  assert.equal(summary.renewedContracts, 1);
  assert.equal(summary.renewalCount, 1);
});
