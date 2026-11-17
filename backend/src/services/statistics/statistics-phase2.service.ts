import { Document, Model, PipelineStage, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import { FacilityServiceType } from '../../types/facility.type';
import { CellAllocationStatus, WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { ReservationStatus } from '../../types/reservation.type';
import { ContractStatus } from '../../types/contract.type';
import { StorageUnitSize, StorageUnitStatus } from '../../types/storage-unit.type';
import { UserRole } from '../../types/user.type';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ManagedCellStockModel from '../../models/inventory-items/managed-cell-stock.model';
import ManagedItemInstanceModel from '../../models/inventory-items/managed-item-instance.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import { aggregateCellStock } from '../inventory-items/managed-cell-stock.domain';
import { ManagedCellStockReadService } from '../inventory-items/managed-cell-stock-read.service';
import { StatisticsQuery, StatisticsQueryError, STATISTICS_TIME_ZONE } from './statistics.validation';

type JsonRecord = Record<string, unknown>;
type LooseRecord = Record<string, any>;
type Scope = { type: 'ALL' } | { type: 'FACILITY'; facilityId: Types.ObjectId };
const DRAFT_AND_PENDING_RESERVATION_STATES = [ReservationStatus.RESERVED, ReservationStatus.CONTRACTED, ReservationStatus.DEPOSIT_PAID];
const QUALIFYING_PAYMENT_PURPOSES = [PaymentPurpose.FULL_RENT, PaymentPurpose.BALANCE, PaymentPurpose.DEPOSIT];
const LIVE = { deletedAt: { $exists: false } };

function runAggregate<T extends Document>(model: Model<T>, pipeline: PipelineStage[]): Promise<JsonRecord[]> {
  return model.aggregate<JsonRecord>(pipeline).option({ maxTimeMS: 15_000, allowDiskUse: true }).exec();
}

function value(row: JsonRecord, key: string): number { const v = row[key]; return typeof v === 'number' && Number.isFinite(v) ? v : 0; }
function asRecord(input: unknown): JsonRecord { return input && typeof input === 'object' ? input as JsonRecord : {}; }
function id(value: unknown): string { return value == null ? '' : String(value); }
function rounded(value: number): number { return Math.round(value * 100) / 100; }
function percentage(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return rounded(numerator / denominator * 100);
}
function scopeMatch(scope: Scope): JsonRecord { return scope.type === 'FACILITY' ? { facilityId: scope.facilityId } : {}; }
function snapshotMeta(query: StatisticsQuery, scope: Scope, snapshotAt: Date, completeness: JsonRecord, limitations: string[] = []): JsonRecord {
  return {
    facilityScope: scope.type === 'ALL' ? { type: 'ALL' } : { type: 'FACILITY', facilityId: scope.facilityId.toString() },
    timezone: STATISTICS_TIME_ZONE,
    requestedPeriod: { fromDate: query.from.toISOString(), toDateExclusive: query.toExclusive.toISOString(), applied: false },
    snapshotAt: snapshotAt.toISOString(), generatedAt: snapshotAt.toISOString(), dataCompleteness: completeness, limitations,
  };
}
function periodMeta(query: StatisticsQuery, scope: Scope, generatedAt: Date, completeness: JsonRecord, limitations: string[] = []): JsonRecord {
  return {
    facilityScope: scope.type === 'ALL' ? { type: 'ALL' } : { type: 'FACILITY', facilityId: scope.facilityId.toString() },
    timezone: STATISTICS_TIME_ZONE,
    fromDate: query.from.toISOString(), toDateExclusive: query.toExclusive.toISOString(),
    timeBasis: { reservationCohort: 'Reservation.createdAt', contractCohort: 'Contract.createdAt', currentStatus: 'current persisted document state' },
    generatedAt: generatedAt.toISOString(), dataCompleteness: completeness, limitations,
  };
}
function requireStatus<T extends string>(status: string | undefined, values: readonly T[], field: string): T | undefined {
  if (status === undefined) return undefined;
  if (!(values as readonly string[]).includes(status)) throw new StatisticsQueryError(400, 'INVALID_STATUS', `status is not supported for ${field}`);
  return status as T;
}
function emptyStatusCounts(): Record<string, number> {
  return Object.fromEntries(Object.values(StorageUnitStatus).map(status => [status, 0]));
}

export function summarizeStorageRows(rows: JsonRecord[]) {
  const byStatus = emptyStatusCounts();
  const byFacility = new Map<string, JsonRecord>();
  const bySize = new Map<string, JsonRecord>();
  let unknownStatusUnits = 0;
  let totalUnits = 0;
  for (const row of rows) {
    const count = value(row, 'unitCount');
    totalUnits += count;
    const status = String(row.status ?? 'UNKNOWN');
    if (Object.hasOwn(byStatus, status)) byStatus[status] = (byStatus[status] ?? 0) + count;
    else unknownStatusUnits += count;
    const facilityId = id(row.facilityId);
    const facility = byFacility.get(facilityId) ?? { facilityId, totalUnits: 0, occupiedUnits: 0, reservedUnits: 0, availableUnits: 0, maintenanceUnits: 0, unavailableUnits: 0 };
    facility.totalUnits = value(facility, 'totalUnits') + count;
    const size = String(row.size ?? 'UNKNOWN');
    const sizeRow = bySize.get(size) ?? { unitSize: size, totalUnits: 0, occupiedUnits: 0, reservedUnits: 0, availableUnits: 0, maintenanceUnits: 0, unavailableUnits: 0 };
    sizeRow.totalUnits = value(sizeRow, 'totalUnits') + count;
    const key = status === StorageUnitStatus.OCCUPIED ? 'occupiedUnits' : status === StorageUnitStatus.HELD ? 'reservedUnits' : status === StorageUnitStatus.AVAILABLE ? 'availableUnits' : status === StorageUnitStatus.MAINTENANCE ? 'maintenanceUnits' : 'unavailableUnits';
    facility[key] = value(facility, key) + count;
    sizeRow[key] = value(sizeRow, key) + count;
    byFacility.set(facilityId, facility);
    bySize.set(size, sizeRow);
  }
  const occupiedUnits = byStatus[StorageUnitStatus.OCCUPIED] ?? 0;
  const reservedUnits = byStatus[StorageUnitStatus.HELD] ?? 0;
  const availableUnits = byStatus[StorageUnitStatus.AVAILABLE] ?? 0;
  const maintenanceUnits = byStatus[StorageUnitStatus.MAINTENANCE] ?? 0;
  const unavailableUnits = (byStatus[StorageUnitStatus.INACTIVE] ?? 0) + unknownStatusUnits;
  const rentableUnits = totalUnits - maintenanceUnits - unavailableUnits;
  return {
    totalUnits, occupiedUnits, reservedUnits, availableUnits, maintenanceUnits, unavailableUnits,
    occupancyRate: percentage(occupiedUnits, rentableUnits), availabilityRate: percentage(availableUnits, rentableUnits),
    rentableUnits, unitStatusCounts: { ...byStatus, UNKNOWN: unknownStatusUnits },
    capacityByFacility: [...byFacility.values()].sort((a, b) => id(a.facilityId).localeCompare(id(b.facilityId))),
    capacityByUnitSize: [...bySize.values()].sort((a, b) => id(a.unitSize).localeCompare(id(b.unitSize))),
  };
}

export function summarizeManagedCellRows(rows: JsonRecord[], stockUsageKnown: boolean) {
  const totals = { totalCells: 0, availableCells: 0, allocatedCells: 0, nonAvailableCells: 0, capacityVolumeM3: 0, usedVolumeM3: 0,
    capacityWeightKg: 0, usedWeightKg: 0, missingUsableHeightCells: 0 };
  for (const row of rows) {
    totals.totalCells += value(row, 'totalCells');
    totals.availableCells += value(row, 'availableCells');
    totals.allocatedCells += value(row, 'allocatedCells');
    totals.nonAvailableCells += value(row, 'nonAvailableCells');
    totals.capacityVolumeM3 += value(row, 'volumeCapacityKnownM3');
    totals.usedVolumeM3 += value(row, 'usedVolumeM3');
    totals.capacityWeightKg += value(row, 'capacityWeightKg');
    totals.usedWeightKg += value(row, 'usedWeightKg');
    totals.missingUsableHeightCells += value(row, 'missingVolumeCells');
  }
  const volumeKnown = totals.missingUsableHeightCells === 0;
  return {
    ...totals,
    availableCells: stockUsageKnown ? totals.availableCells : null,
    allocatedCells: stockUsageKnown ? totals.allocatedCells : null,
    capacityVolumeM3: volumeKnown ? rounded(totals.capacityVolumeM3) : null,
    usedVolumeM3: stockUsageKnown ? rounded(totals.usedVolumeM3) : null,
    volumeUtilizationRate: stockUsageKnown && volumeKnown ? percentage(totals.usedVolumeM3, totals.capacityVolumeM3) : null,
    usedWeightKg: stockUsageKnown ? rounded(totals.usedWeightKg) : null,
    weightUtilizationRate: stockUsageKnown ? percentage(totals.usedWeightKg, totals.capacityWeightKg) : null,
  };
}

const CAPACITY_USAGE_LIMIT = 10_000;
const V4_CONFIRMED = new Set(['REPLAYED', 'NOT_REQUIRED']);
export function resolveSkuStockUsageStatus(ledgerStatus: string | undefined, reconciliationStatus: string | undefined) {
  if (ledgerStatus === 'MISMATCH' || reconciliationStatus === 'MISMATCH') return 'MISMATCH';
  if (ledgerStatus === 'NOT_REQUIRED' && reconciliationStatus === 'NOT_REQUIRED') return 'NOT_REQUIRED';
  // skuStock sets ledgerStatus=REPLAYED only after schema-v4 replay, scope checks, and exact
  // ManagedCellStock/ManagedItemInstance projection comparison. Its reconciliationStatus
  // currently remains UNKNOWN for replayed stock, so Statistics uses the stronger evidence.
  if (ledgerStatus === 'REPLAYED') return 'REPLAYED';
  return 'UNKNOWN';
}

export function mergeFacilityUsageStatus(current: string, next: string) {
  const rank: Record<string, number> = { NOT_REQUIRED: 0, REPLAYED: 1, UNKNOWN: 2, MISMATCH: 3 };
  return (rank[next] ?? rank.UNKNOWN!) > (rank[current] ?? rank.UNKNOWN!) ? (rank[next] === undefined ? 'UNKNOWN' : next) : current;
}

export function mergeSkuCellUsage(usageByCell: Map<string, JsonRecord>, facilityId: string, rows: JsonRecord[]) {
  const conflicts = new Set<string>();
  for (const row of rows) {
    const cellId = id(row.cellId);
    if (!cellId) { conflicts.add(facilityId); continue; }
    const current = usageByCell.get(cellId) ?? { facilityId, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0 };
    if (id(current.facilityId) !== facilityId) { conflicts.add(facilityId); conflicts.add(id(current.facilityId)); }
    for (const field of ['quantityOnHand','quantityHeld','quantityAvailable','weightKg','volumeM3']) current[field] = value(current, field) + value(row, field);
    usageByCell.set(cellId, current);
  }
  return conflicts;
}

export function resolveV4ReconciliationStatus(statuses: string[], sourceComplete = true) {
  if (!sourceComplete || statuses.some(status => !V4_CONFIRMED.has(status))) {
    return { status: statuses.includes('MISMATCH') ? 'MISMATCH' : 'UNKNOWN', complete: false };
  }
  return { status: statuses.includes('REPLAYED') ? 'RECONCILED' : 'NOT_REQUIRED', complete: true };
}

export function summarizeManagedCapacityV4Fixture(input: { cells: JsonRecord[]; facilityIds?: string[]; usageByCell: Map<string, JsonRecord>; activeAllocationCellIds?: Set<string>; reconciliationByFacility: Map<string, string> }) {
  const byFacility = new Map<string, LooseRecord>();
  const byZone = new Map<string, LooseRecord>();
  const byRack = new Map<string, LooseRecord>();
  const cellIdsByFacility = new Map<string, Set<string>>();
  for (const cell of input.cells) {
    const facilityId = id(cell.facilityId), cellId = id(cell._id);
    const cellSet = cellIdsByFacility.get(facilityId) ?? new Set<string>(); cellSet.add(cellId); cellIdsByFacility.set(facilityId, cellSet);
    const operational = cell.parentOperational !== false && cell.operationalStatus === WarehouseOperationalStatus.AVAILABLE;
    const usage = input.usageByCell.get(cellId) ?? {};
    const usedWeightKg = value(usage, 'weightKg'), usedVolumeM3 = value(usage, 'volumeM3');
    const hasUsage = value(usage, 'quantityOnHand') > 0 || usedWeightKg > 0 || usedVolumeM3 > 0;
    const activeAllocation = input.activeAllocationCellIds?.has(cellId) ?? false;
    const dimensions = asRecord(cell.dimensions);
    const usableVolume = typeof dimensions.usableHeightM === 'number' && dimensions.usableHeightM > 0 &&
      typeof dimensions.widthM === 'number' && dimensions.widthM > 0 && typeof dimensions.depthM === 'number' && dimensions.depthM > 0;
    const cellVolume = usableVolume ? Number(dimensions.widthM) * Number(dimensions.depthM) * Number(dimensions.usableHeightM) : 0;
    const validWeightCapacity = typeof cell.maxWeightKg === 'number' && Number.isFinite(cell.maxWeightKg) && cell.maxWeightKg > 0;
    const facility = byFacility.get(facilityId) ?? { facilityId, totalCells: 0, availableCells: 0, reservedCells: 0, allocatedCells: 0, nonAvailableCells: 0,
      capacityWeightKg: 0, usedWeightKg: 0, capacityVolumeM3: 0, usedVolumeM3: 0, missingUsableHeightCells: 0, capacityKnown: true, usageKnown: true };
    facility.totalCells += 1;
    if (!validWeightCapacity && operational) facility.capacityKnown = false;
    if (operational && validWeightCapacity) facility.capacityWeightKg += cell.maxWeightKg as number;
    if (operational && usableVolume) facility.capacityVolumeM3 += cellVolume;
    if (operational && !usableVolume) facility.missingUsableHeightCells += 1;
    if (operational && !activeAllocation && !hasUsage) facility.availableCells += 1;
    if (operational && activeAllocation && !hasUsage) facility.reservedCells += 1;
    if (activeAllocation || hasUsage) facility.allocatedCells += 1;
    if (!operational) facility.nonAvailableCells += 1;
    facility.usedWeightKg += usedWeightKg; facility.usedVolumeM3 += usedVolumeM3;
    byFacility.set(facilityId, facility);
    const zoneId = id(cell.zoneId), rackId = id(cell.rackId), zoneKey = `${facilityId}:${zoneId}`, rackKey = `${zoneKey}:${rackId}`;
    for (const [map, key, fields] of [
      [byZone, zoneKey, { facilityId, zoneId }], [byRack, rackKey, { facilityId, zoneId, rackId }],
    ] as const) {
      const row = map.get(key) ?? { ...fields, totalCells: 0, availableCells: 0, reservedCells: 0, allocatedCells: 0, nonAvailableCells: 0,
        capacityWeightKg: 0, usedWeightKg: 0, capacityVolumeM3: 0, usedVolumeM3: 0, missingUsableHeightCells: 0, capacityKnown: true };
      row.totalCells += 1;
      if (operational && !validWeightCapacity) row.capacityKnown = false;
      if (operational && validWeightCapacity) row.capacityWeightKg += cell.maxWeightKg as number;
      if (operational && usableVolume) row.capacityVolumeM3 += cellVolume;
      if (operational && !usableVolume) row.missingUsableHeightCells += 1;
      if (operational && !activeAllocation && !hasUsage) row.availableCells += 1;
      if (operational && activeAllocation && !hasUsage) row.reservedCells += 1;
      if (activeAllocation || hasUsage) row.allocatedCells += 1;
      if (!operational) row.nonAvailableCells += 1;
      row.usedWeightKg += usedWeightKg; row.usedVolumeM3 += usedVolumeM3; map.set(key, row);
    }
  }
  const orphanCellsByFacility = new Set<string>();
  for (const [cellId, usage] of input.usageByCell) if (!cellIdsByFacility.get(id(usage.facilityId))?.has(cellId)) orphanCellsByFacility.add(id(usage.facilityId));
  for (const [facilityId, row] of byFacility) {
    const status = input.reconciliationByFacility.get(facilityId) ?? 'UNKNOWN';
    row.reconciliationStatus = status;
    row.usageKnown = V4_CONFIRMED.has(status) && !orphanCellsByFacility.has(facilityId);
    if (!row.usageKnown) { row.usedWeightKg = null; row.usedVolumeM3 = null; }
    if (!row.capacityKnown) row.capacityWeightKg = null;
    row.capacityVolumeM3 = row.missingUsableHeightCells > 0 ? null : row.capacityVolumeM3;
    row.weightUtilizationRate = row.usageKnown && row.capacityKnown ? percentage(row.usedWeightKg as number, row.capacityWeightKg as number) : null;
    row.volumeUtilizationRate = row.usageKnown && row.capacityVolumeM3 !== null ? percentage(row.usedVolumeM3 as number, row.capacityVolumeM3 as number) : null;
    row.availableWeightCapacityKg = row.usageKnown && row.capacityKnown ? Math.max(0, (row.capacityWeightKg as number) - (row.usedWeightKg as number)) : null;
    row.availableVolumeCapacityM3 = row.usageKnown && row.capacityVolumeM3 !== null ? Math.max(0, (row.capacityVolumeM3 as number) - (row.usedVolumeM3 as number)) : null;
  }
  for (const facilityId of input.facilityIds ?? []) if (!byFacility.has(facilityId)) {
    const status = input.reconciliationByFacility.get(facilityId) ?? 'UNKNOWN';
    byFacility.set(facilityId, { facilityId, totalCells: 0, availableCells: V4_CONFIRMED.has(status) ? 0 : null, reservedCells: V4_CONFIRMED.has(status) ? 0 : null,
      allocatedCells: V4_CONFIRMED.has(status) ? 0 : null, nonAvailableCells: 0, capacityWeightKg: 0,
      usedWeightKg: V4_CONFIRMED.has(status) ? 0 : null, capacityVolumeM3: 0, usedVolumeM3: V4_CONFIRMED.has(status) ? 0 : null,
      missingUsableHeightCells: 0, capacityKnown: true, usageKnown: V4_CONFIRMED.has(status), reconciliationStatus: status,
      weightUtilizationRate: V4_CONFIRMED.has(status) ? null : null, volumeUtilizationRate: V4_CONFIRMED.has(status) ? null : null,
      availableWeightCapacityKg: V4_CONFIRMED.has(status) ? 0 : null, availableVolumeCapacityM3: V4_CONFIRMED.has(status) ? 0 : null });
  }
  const facilityRows = [...byFacility.values()];
  const unknownFacilityRows = [...byFacility.keys()].some(facilityId => !input.reconciliationByFacility.has(facilityId));
  const allReconciliation = resolveV4ReconciliationStatus([...input.reconciliationByFacility.values()], orphanCellsByFacility.size === 0 && !unknownFacilityRows);
  const global = facilityRows.reduce((acc: JsonRecord, row: JsonRecord) => {
    for (const field of ['totalCells','availableCells','reservedCells','allocatedCells','nonAvailableCells','capacityWeightKg','usedWeightKg','capacityVolumeM3','usedVolumeM3','missingUsableHeightCells']) {
      if (typeof row[field] === 'number') acc[field] = value(acc, field) + value(row, field);
      else if (row[field] === null) acc[field] = null;
    }
    return acc;
  }, { totalCells: 0, availableCells: 0, reservedCells: 0, allocatedCells: 0, nonAvailableCells: 0, capacityWeightKg: 0, usedWeightKg: 0, capacityVolumeM3: 0, usedVolumeM3: 0, missingUsableHeightCells: 0 });
  if (!allReconciliation.complete) { global.usedWeightKg = null; global.usedVolumeM3 = null; }
  if (orphanCellsByFacility.size > 0) { global.availableCells = null; global.reservedCells = null; global.allocatedCells = null; }
  if (facilityRows.some(row => row.capacityKnown === false)) global.capacityWeightKg = null;
  if (facilityRows.some(row => row.missingUsableHeightCells > 0)) global.capacityVolumeM3 = null;
  for (const row of [...byZone.values(), ...byRack.values()]) {
    const status = input.reconciliationByFacility.get(id(row.facilityId)) ?? 'UNKNOWN';
    row.reconciliationStatus = status;
    if (!V4_CONFIRMED.has(status)) { row.usedWeightKg = null; row.usedVolumeM3 = null; }
    if (row.capacityKnown === false) row.capacityWeightKg = null;
    if (row.missingUsableHeightCells > 0) row.capacityVolumeM3 = null;
  }
  return { facilityRows, zoneRows: [...byZone.values()], rackRows: [...byRack.values()], reconciliationStatus: allReconciliation.status,
    dataComplete: allReconciliation.complete && orphanCellsByFacility.size === 0 && !unknownFacilityRows, global };
}

function validStorageFilters(query: StatisticsQuery) {
  const unitSize = query.unitSize;
  const status = requireStatus(query.status, Object.values(StorageUnitStatus), 'storage-capacity');
  return { ...(unitSize ? { size: unitSize } : {}), ...(status ? { status } : {}) };
}

export function summarizeReservationRows(rows: JsonRecord[]) {
  const byStatus: Record<string, number> = {};
  const byService = new Map<string, number>();
  const byFacility = new Map<string, number>();
  let totalReservations = 0, paidReservations = 0, pendingPaymentReservations = 0;
  let awaitingContractReservations = 0, activeReservations = 0, cancelledReservations = 0;
  let completedReservations = 0, overdueReservations = 0;
  for (const row of rows) {
    const status = String(row.status ?? 'UNKNOWN');
    const service = String(row.serviceType ?? 'UNKNOWN');
    const facility = id(row.facilityId);
    totalReservations += 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byService.set(service, (byService.get(service) ?? 0) + 1);
    byFacility.set(facility, (byFacility.get(facility) ?? 0) + 1);
    if (row.verifiedPaid === true) paidReservations += 1;
    if (row.verifiedPaid !== true && DRAFT_AND_PENDING_RESERVATION_STATES.includes(status as ReservationStatus)) pendingPaymentReservations += 1;
    if (row.verifiedPaid === true && row.signedContract !== true) awaitingContractReservations += 1;
    if (status === ReservationStatus.ACTIVE) activeReservations += 1;
    if (status === ReservationStatus.CANCELLED) cancelledReservations += 1;
    if (status === ReservationStatus.CHECKED_OUT || status === ReservationStatus.CLOSED) completedReservations += 1;
    if (status === ReservationStatus.OVERDUE) overdueReservations += 1;
  }
  return { totalReservations, paidReservations, pendingPaymentReservations, awaitingContractReservations, activeReservations, cancelledReservations,
    completedReservations, overdueReservations, cancellationRate: percentage(cancelledReservations, totalReservations), byStatus,
    byService: [...byService.entries()].map(([serviceType, count]) => ({ serviceType, total: count })),
    byFacility: [...byFacility.entries()].map(([facilityId, count]) => ({ facilityId, total: count })) };
}

export function summarizeContractRows(rows: JsonRecord[], expiringWithinDays: number, now: Date) {
  const result = { totalContracts: rows.length, signedContracts: 0, unsignedContracts: 0, activeContracts: 0, expiringSoonContracts: 0,
    expiredContracts: 0, completedContracts: 0, renewedContracts: 0, renewalCount: 0 };
  const expirationLimit = now.getTime() + expiringWithinDays * 86_400_000;
  for (const row of rows) {
    const reservationStatus = String(row.reservationStatus ?? '');
    const signed = row.isSigned === true;
    if (signed) result.signedContracts += 1;
    if (row.status === ContractStatus.DRAFT) result.unsignedContracts += 1;
    if (signed && [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE].includes(reservationStatus as ReservationStatus)) result.activeContracts += 1;
    const endDate = parseStoredDate(row.reservationEndDate);
    if (signed && [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE].includes(reservationStatus as ReservationStatus) && endDate && endDate >= now && endDate.getTime() <= expirationLimit) result.expiringSoonContracts += 1;
    if (row.status === ContractStatus.EXPIRED) result.expiredContracts += 1;
    if (signed && [ReservationStatus.CHECKED_OUT, ReservationStatus.CLOSED].includes(reservationStatus as ReservationStatus)) result.completedContracts += 1;
    const pairs = Array.isArray(row.renewalPairs) ? [...new Set(row.renewalPairs.map(String))] : [];
    result.renewalCount += pairs.length;
    if (pairs.length) result.renewedContracts += 1;
  }
  return result;
}

const unitGroups = (query: StatisticsQuery, scope: Scope): PipelineStage[] => [
  { $match: { ...LIVE, ...scopeMatch(scope), ...validStorageFilters(query) } },
  { $group: { _id: { facilityId: '$facilityId', size: '$size', status: '$status' }, unitCount: { $sum: 1 } } },
  { $project: { _id: 0, facilityId: '$_id.facilityId', size: '$_id.size', status: '$_id.status', unitCount: 1 } },
];

function parseStoredDate(value: unknown): Date | null { const date = value instanceof Date ? value : new Date(String(value ?? '')); return Number.isFinite(date.getTime()) ? date : null; }
function localBucketExpression(dateField: string, granularity: 'day' | 'week' | 'month'): JsonRecord {
  return { $dateTrunc: { date: dateField, unit: granularity, ...(granularity === 'week' ? { startOfWeek: 'monday' } : {}), timezone: STATISTICS_TIME_ZONE } };
}

export class StatisticsPhase2Service {
  static async storageCapacity(query: StatisticsQuery, scope: Scope) {
    const status = requireStatus(query.status, Object.values(StorageUnitStatus), 'storage-capacity');
    const pipeline = unitGroups(query, scope);
    const rows = await runAggregate(StorageUnitModel, pipeline);
    const totals = summarizeStorageRows(rows);
    const snapshotAt = new Date();
    return {
      success: true,
      data: {
        totalUnits: totals.totalUnits, occupiedUnits: totals.occupiedUnits, reservedUnits: totals.reservedUnits,
        availableUnits: totals.availableUnits, maintenanceUnits: totals.maintenanceUnits, unavailableUnits: totals.unavailableUnits,
        occupancyRate: totals.occupancyRate, availabilityRate: totals.availabilityRate, rentableUnits: totals.rentableUnits,
        capacityByFacility: totals.capacityByFacility, capacityByUnitSize: totals.capacityByUnitSize,
      },
      meta: snapshotMeta(query, scope, snapshotAt, { unknownStorageUnitStatusCount: totals.unitStatusCounts.UNKNOWN, snapshotBasis: 'current StorageUnit.status; current document size; soft-deleted units excluded' }, [
        'Current snapshot only. fromDate/toDate are reported as requested filters but are not used to reconstruct historical unit status.',
        ...(status ? [`Storage units filtered to status ${status}.`] : []),
      ]),
    };
  }

  private static async managedCellGroups(query: StatisticsQuery, scope: Scope) {
    const now = new Date();
    const pipeline: PipelineStage[] = [
      { $match: { ...LIVE, ...scopeMatch(scope) } },
      { $lookup: { from: WarehouseZoneModel.collection.name, localField: 'zoneId', foreignField: '_id', as: '_zone' } },
      { $unwind: { path: '$_zone', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: WarehouseRackModel.collection.name, localField: 'rackId', foreignField: '_id', as: '_rack' } },
      { $unwind: { path: '$_rack', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: CellAllocationModel.collection.name, let: { cellId: '$_id', facilityId: '$facilityId' }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$cellId', '$$cellId'] }, { $eq: ['$facilityId', '$$facilityId'] }] } } },
        { $match: { $or: [
          { status: CellAllocationStatus.OCCUPIED },
          { status: CellAllocationStatus.RESERVED, startDate: { $lte: now }, endDate: { $gt: now } },
          { status: CellAllocationStatus.HOLD, startDate: { $lte: now }, endDate: { $gt: now }, holdExpiresAt: { $gt: now } },
        ] } },
        { $group: { _id: '$cellId' } },
      ], as: '_activeAllocation' } },
      { $set: {
        parentOperational: { $and: [ { $eq: ['$_zone.facilityId', '$facilityId'] }, { $eq: ['$_zone.isActive', true] }, { $eq: [{ $type: '$_zone.deletedAt' }, 'missing'] },
          { $eq: ['$_rack.facilityId', '$facilityId'] }, { $eq: ['$_rack.zoneId', '$zoneId'] }, { $eq: ['$_rack.operationalStatus', WarehouseOperationalStatus.AVAILABLE] }, { $eq: [{ $type: '$_rack.deletedAt' }, 'missing'] } ] },
        activeAllocation: { $gt: [{ $size: '$_activeAllocation' }, 0] },
      } },
      { $project: { _id: 1, facilityId: 1, zoneId: 1, rackId: 1, operationalStatus: 1, parentOperational: 1, maxWeightKg: 1, dimensions: 1, activeAllocation: 1 } },
    ];
    const rows = await runAggregate(WarehouseCellModel, pipeline);
    return { rows };
  }

  private static async topologyCounts(query: StatisticsQuery, scope: Scope) {
    const zoneRows = await runAggregate(WarehouseZoneModel, [ { $match: { ...LIVE, ...scopeMatch(scope) } }, { $group: { _id: '$facilityId', count: { $sum: 1 } } } ]);
    const rackRows = await runAggregate(WarehouseRackModel, [ { $match: { ...LIVE, ...scopeMatch(scope) } }, { $group: { _id: '$facilityId', count: { $sum: 1 } } } ]);
    return { zoneRows, rackRows };
  }

  private static async managedV4Usage(scope: Scope, facilityIds: string[]) {
    const matchScope = scopeMatch(scope);
    const [skus, legacyStock] = await Promise.all([
      InventoryItemModel.find({ ...LIVE, ...matchScope, inventorySchemaVersion: 3 } as any).select('_id facilityId').sort({ facilityId: 1, _id: 1 }).limit(CAPACITY_USAGE_LIMIT + 1).lean().exec(),
      InventoryItemModel.find({ ...LIVE, ...matchScope, inventorySchemaVersion: { $ne: 3 }, $or: [
        { currentCellId: { $exists: true, $ne: null } }, { status: { $in: ['IN_STORAGE', 'PENDING_OUTBOUND'] } },
      ] } as any).select('_id facilityId').limit(CAPACITY_USAGE_LIMIT + 1).lean().exec(),
    ]);
    const byFacility = new Map<string, { status: string; reasons: string[] }>(facilityIds.map(facilityId => [facilityId, { status: 'NOT_REQUIRED', reasons: [] }]));
    const mark = (facilityId: string, status: string, reason: string) => {
      const row = byFacility.get(facilityId) ?? { status: 'NOT_REQUIRED', reasons: [] };
      row.status = mergeFacilityUsageStatus(row.status, status);
      row.reasons.push(reason); byFacility.set(facilityId, row);
    };
    for (const row of legacyStock) mark(id(row.facilityId), 'UNKNOWN', 'Legacy non-V4 SKU stock is present; it is excluded from V4 capacity and makes Facility usage incomplete.');
    if (skus.length > CAPACITY_USAGE_LIMIT || legacyStock.length > CAPACITY_USAGE_LIMIT) {
      for (const facilityId of facilityIds) mark(facilityId, 'UNKNOWN', 'A reconciliation source exceeded its safe record bound; partial totals are suppressed.');
      return { usageByCell: new Map<string, JsonRecord>(), byFacility, sourceComplete: false };
    }
    const skuIds = skus.map(row => row._id);
    const idFilter = skuIds.length ? { $nin: skuIds } : { $exists: true };
    const [orphanStock, orphanInstances, orphanMovements] = await Promise.all([
      ManagedCellStockModel.findOne({ ...matchScope, skuId: idFilter }).select('facilityId').lean().exec(),
      ManagedItemInstanceModel.findOne({ ...matchScope, skuId: idFilter }).select('facilityId').lean().exec(),
      ItemMovementModel.findOne({ ...matchScope, itemId: idFilter }).select('facilityId').lean().exec(),
    ]);
    for (const row of [orphanStock, orphanInstances, orphanMovements]) if (row) mark(id(row.facilityId), 'UNKNOWN', 'Stock, Item Instance, or movement records refer to a SKU outside the live V4 SKU set.');

    const actor = { _id: new Types.ObjectId(), role: UserRole.ADMIN };
    const usageByCell = new Map<string, JsonRecord>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(8, skus.length) }, async () => {
      while (cursor < skus.length) {
        const sku = skus[cursor++];
        if (!sku) continue;
        try {
          const stock = await ManagedCellStockReadService.skuStock(String(sku._id), actor);
          const facilityId = id(sku.facilityId);
          if (id(stock.facilityId) !== facilityId) mark(facilityId, 'MISMATCH', 'Canonical SKU reconciliation returned a different Facility.');
          else {
            const skuUsageStatus = resolveSkuStockUsageStatus(stock.ledgerStatus, stock.reconciliationStatus);
            const reason = skuUsageStatus === 'REPLAYED' ? 'REPLAY_MATCHED' : stock.reasonCode ?? 'UNVERIFIED';
            mark(facilityId, skuUsageStatus, `${String(stock.ledgerStatus)}:${String(reason)}`);
          }
          for (const conflictedFacility of mergeSkuCellUsage(usageByCell, facilityId, Array.isArray(stock.byCell) ? stock.byCell : [])) {
            mark(conflictedFacility, 'MISMATCH', 'A stock Cell is associated with multiple Facility scopes or has no Cell identity.');
          }
        } catch (error) {
          mark(id(sku.facilityId), 'UNKNOWN', error instanceof Error ? `SKU reconciliation failed: ${error.message}` : 'SKU reconciliation failed.');
        }
      }
    });
    await Promise.all(workers);
    return { usageByCell, byFacility, sourceComplete: true };
  }

  static async managedCapacity(query: StatisticsQuery, scope: Scope) {
    const facilities = await FacilityModel.find({ ...LIVE, ...(scope.type === 'FACILITY' ? { _id: scope.facilityId } : {}) }).select('_id').sort({ _id: 1 }).lean().exec();
    const facilityIds = facilities.map(row => id(row._id));
    const [groups, topology, v4] = await Promise.all([this.managedCellGroups(query, scope), this.topologyCounts(query, scope), this.managedV4Usage(scope, facilityIds)]);
    const snapshotAt = new Date();
    const zoneCounts = new Map(topology.zoneRows.map(row => [id(row._id), value(row, 'count')]));
    const rackCounts = new Map(topology.rackRows.map(row => [id(row._id), value(row, 'count')]));
    const activeAllocationCellIds = new Set(groups.rows.filter(row => row.activeAllocation === true).map(row => id(row._id)));
    const reconciled = summarizeManagedCapacityV4Fixture({ cells: groups.rows, facilityIds, usageByCell: v4.usageByCell, activeAllocationCellIds,
      reconciliationByFacility: new Map([...v4.byFacility].map(([facilityId, status]) => [facilityId, status.status])) });
    const { global, facilityRows, zoneRows, rackRows } = reconciled;
    const capacityByFacility = facilityRows.map(row => ({ ...row,
      totalZones: zoneCounts.get(id(row.facilityId)) ?? 0, totalRacks: rackCounts.get(id(row.facilityId)) ?? 0,
      capacityWeightKg: typeof row.capacityWeightKg === 'number' ? rounded(row.capacityWeightKg) : null,
      usedWeightKg: typeof row.usedWeightKg === 'number' ? rounded(row.usedWeightKg) : null,
      capacityVolumeM3: typeof row.capacityVolumeM3 === 'number' ? rounded(row.capacityVolumeM3) : null,
      usedVolumeM3: typeof row.usedVolumeM3 === 'number' ? rounded(row.usedVolumeM3) : null,
    }));
    const capacityTotals = {
      totalCells: value(global, 'totalCells'), availableCells: reconciled.dataComplete ? value(global, 'availableCells') : null,
      reservedCells: reconciled.dataComplete ? value(global, 'reservedCells') : null,
      allocatedCells: reconciled.dataComplete ? value(global, 'allocatedCells') : null, nonAvailableCells: value(global, 'nonAvailableCells'),
      capacityWeightKg: global.capacityWeightKg, usedWeightKg: global.usedWeightKg, capacityVolumeM3: global.capacityVolumeM3, usedVolumeM3: global.usedVolumeM3,
      weightUtilizationRate: reconciled.dataComplete && typeof global.capacityWeightKg === 'number' && typeof global.usedWeightKg === 'number' ? percentage(global.usedWeightKg, global.capacityWeightKg) : null,
      volumeUtilizationRate: reconciled.dataComplete && typeof global.capacityVolumeM3 === 'number' && typeof global.usedVolumeM3 === 'number' ? percentage(global.usedVolumeM3, global.capacityVolumeM3) : null,
    };
    const roundRows = (rows: JsonRecord[]) => rows.map(row => ({ ...row, capacityWeightKg: row.capacityWeightKg === null ? null : rounded(value(row, 'capacityWeightKg')),
      usedWeightKg: V4_CONFIRMED.has(String(row.reconciliationStatus)) ? rounded(value(row, 'usedWeightKg')) : null,
      capacityVolumeM3: row.capacityVolumeM3 === null ? null : rounded(value(row, 'capacityVolumeM3')),
      usedVolumeM3: V4_CONFIRMED.has(String(row.reconciliationStatus)) ? rounded(value(row, 'usedVolumeM3')) : null,
      weightUtilizationRate: V4_CONFIRMED.has(String(row.reconciliationStatus)) && row.capacityWeightKg !== null ? percentage(value(row, 'usedWeightKg'), value(row, 'capacityWeightKg')) : null,
      volumeUtilizationRate: V4_CONFIRMED.has(String(row.reconciliationStatus)) && row.capacityVolumeM3 !== null ? percentage(value(row, 'usedVolumeM3'), value(row, 'capacityVolumeM3')) : null,
    }));
    const reasons = [...new Set([...v4.byFacility.values()].flatMap(row => row.reasons))];
    return {
      success: true,
      data: {
        totalZones: topology.zoneRows.reduce((sum, row) => sum + value(row, 'count'), 0),
        totalRacks: topology.rackRows.reduce((sum, row) => sum + value(row, 'count'), 0),
        ...capacityTotals, reconciliationStatus: reconciled.reconciliationStatus,
        capacityByFacility,
        capacityByZone: roundRows(zoneRows), capacityByRack: roundRows(rackRows),
      },
      meta: snapshotMeta(query, scope, snapshotAt, {
        usageSource: 'ManagedCellStock + ManagedItemInstance (V4), reconciled against the schema-v4 movement ledger per SKU',
        ledgerSchemaVersion: 4, reconciliationStatus: reconciled.reconciliationStatus, reconciliationRecordLimit: CAPACITY_USAGE_LIMIT,
        facilityReconciliation: Object.fromEntries([...v4.byFacility].map(([facilityId, row]) => [facilityId, { status: row.status, reasons: row.reasons }])),
        missingUsableHeightCells: value(global, 'missingUsableHeightCells'), capacityVolumeKnown: global.capacityVolumeM3 !== null,
        stockUsageKnown: reconciled.dataComplete, sourceComplete: v4.sourceComplete,
      }, [
        'Current snapshot only; fromDate/toDate do not reconstruct historical topology or inventory.',
        ...(reasons.length ? reasons : []),
        ...(value(global, 'missingUsableHeightCells') ? ['Some operational Cells lack measured usableHeightM; volume capacity and utilization are unavailable.'] : []),
        ...(!reconciled.dataComplete ? ['V4 reconciliation is incomplete or mismatched; dependent aggregate usage and availability are null, not assumed zero.'] : []),
      ]),
    };
  }

  static async utilization(query: StatisticsQuery, scope: Scope) {
    const [storage, managed, facilityCount] = await Promise.all([
      this.storageCapacity(query, scope), this.managedCapacity(query, scope),
      FacilityModel.countDocuments({ ...LIVE, ...(scope.type === 'FACILITY' ? { _id: scope.facilityId } : {}) }),
    ]);
    return {
      success: true,
      data: {
        totalFacilities: facilityCount,
        totalStorageUnits: storage.data.totalUnits,
        occupiedStorageUnits: storage.data.occupiedUnits,
        reservedStorageUnits: storage.data.reservedUnits,
        availableStorageUnits: storage.data.availableUnits,
        maintenanceStorageUnits: storage.data.maintenanceUnits,
        unavailableStorageUnits: storage.data.unavailableUnits,
        selfStorageUtilizationRate: storage.data.occupancyRate,
        managedInventoryVolumeUtilizationRate: managed.data.volumeUtilizationRate,
        managedInventoryWeightUtilizationRate: managed.data.weightUtilizationRate,
        utilizationByFacility: {
          selfStorage: storage.data.capacityByFacility,
          managedInventory: managed.data.capacityByFacility,
        },
        utilizationByService: {
          SELF_STORAGE: { utilizationRate: storage.data.occupancyRate, numerator: storage.data.occupiedUnits, denominator: storage.data.rentableUnits, denominatorUnit: 'rentable Storage Units' },
          MANAGED_INVENTORY: {
            volumeUtilizationRate: managed.data.volumeUtilizationRate, volumeUsedM3: managed.data.usedVolumeM3, volumeCapacityM3: managed.data.capacityVolumeM3,
            weightUtilizationRate: managed.data.weightUtilizationRate, weightUsedKg: managed.data.usedWeightKg, weightCapacityKg: managed.data.capacityWeightKg,
          },
        },
      },
      meta: snapshotMeta(query, scope, new Date(), { selfStorage: storage.meta.dataCompleteness, managedInventory: managed.meta.dataCompleteness }, [
        'Self Storage uses a unit-count ratio; Managed Inventory reports volume and weight ratios separately. Ratios are never averaged across services or Facilities.',
        'Current snapshot only; fromDate/toDate do not reconstruct historical capacity.',
      ]),
    };
  }

  private static reservationPipeline(query: StatisticsQuery, scope: Scope): PipelineStage[] {
    const status = requireStatus(query.status, Object.values(ReservationStatus), 'reservations');
    const match: JsonRecord = { ...scopeMatch(scope), createdAt: { $gte: query.from, $lt: query.toExclusive }, ...(query.serviceType ? { serviceType: query.serviceType } : {}), ...(status ? { status } : {}) };
    const pipeline: PipelineStage[] = [{ $match: match }];
    if (query.unitSize) {
      pipeline.push(
        { $lookup: { from: StorageUnitModel.collection.name, localField: 'storageUnitId', foreignField: '_id', as: '_unit' } },
        { $match: { '_unit.size': query.unitSize } },
      );
    }
    pipeline.push(
      { $lookup: { from: ReservationPaymentModel.collection.name, let: { reservationId: '$_id', facilityId: '$facilityId', serviceType: '$serviceType' }, pipeline: [
        { $match: { $expr: { $and: [ { $eq: ['$reservationId', '$$reservationId'] }, { $eq: ['$facilityId', '$$facilityId'] }, { $eq: ['$serviceType', '$$serviceType'] } ] } } },
        { $match: { provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED, providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: { $ne: PaymentApplicationStatus.MANUAL_REVIEW }, currency: 'VND', purpose: { $in: QUALIFYING_PAYMENT_PURPOSES } } },
        { $unwind: '$providerCaptures' },
        { $match: { 'providerCaptures.amount': { $gt: 0 }, 'providerCaptures.currency': 'VND', 'providerCaptures.eventHash': { $type: 'string' } } },
        { $group: { _id: '$providerCaptures.eventHash', purpose: { $first: '$purpose' } } },
        { $group: { _id: null, purposes: { $addToSet: '$purpose' } } },
      ], as: '_verifiedPayment' } },
      { $lookup: { from: ContractModel.collection.name, localField: '_id', foreignField: 'reservationId', pipeline: [ { $project: { status: 1, signedByCustomerAt: 1, signedByFMAt: 1, verifiedAt: 1, signedProofPublicId: 1, signatures: 1 } } ], as: '_contract' } },
      { $set: {
        _verifiedPurposes: { $ifNull: [{ $first: '$_verifiedPayment.purposes' }, []] },
        _hasSignedContract: { $anyElementTrue: { $map: { input: '$_contract', as: 'contract', in: { $and: [
          { $eq: ['$$contract.status', ContractStatus.SIGNED] },
          { $or: [
            { $and: [{ $type: '$$contract.signedByCustomerAt' }, { $type: '$$contract.signedByFMAt' }] },
            { $and: [{ $type: '$$contract.verifiedAt' }, { $type: '$$contract.signedProofPublicId' }] },
            { $and: [ { $in: [UserRole.CUSTOMER, { $map: { input: { $ifNull: ['$$contract.signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $or: [ { $in: [UserRole.FACILITY_STAFF, { $map: { input: { $ifNull: ['$$contract.signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $in: [UserRole.FACILITY_MANAGER, { $map: { input: { $ifNull: ['$$contract.signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] } ] },
          ] },
        ] } } } },
      } },
      { $set: { _isPaid: { $or: [
        { $in: [PaymentPurpose.FULL_RENT, '$_verifiedPurposes'] },
        { $in: [PaymentPurpose.BALANCE, '$_verifiedPurposes'] },
        { $and: [ { $eq: ['$serviceType', FacilityServiceType.MANAGED_INVENTORY] }, { $eq: ['$bookingFlowVersion', 3] }, { $eq: [{ $type: '$balanceSettledAt' }, 'date'] }, { $in: [PaymentPurpose.DEPOSIT, '$_verifiedPurposes'] } ] },
      ] } } },
    );
    return pipeline;
  }

  static async reservations(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const summaryPipeline: PipelineStage[] = [...this.reservationPipeline(query, scope), { $group: { _id: null,
      totalReservations: { $sum: 1 }, paidReservations: { $sum: { $cond: ['$_isPaid', 1, 0] } },
      pendingPaymentReservations: { $sum: { $cond: [{ $and: [{ $not: ['$_isPaid'] }, { $in: ['$status', DRAFT_AND_PENDING_RESERVATION_STATES] }] }, 1, 0] } },
      awaitingContractReservations: { $sum: { $cond: [{ $and: ['$_isPaid', { $not: ['$_hasSignedContract'] }] }, 1, 0] } },
      activeReservations: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.ACTIVE] }, 1, 0] } },
      cancelledReservations: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.CANCELLED] }, 1, 0] } },
      completedReservations: { $sum: { $cond: [{ $in: ['$status', [ReservationStatus.CHECKED_OUT, ReservationStatus.CLOSED]] }, 1, 0] } },
      overdueReservations: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.OVERDUE] }, 1, 0] } },
    } }];
    const [summary, byFacility, byService, byStatus, trend] = await Promise.all([
      runAggregate(ReservationModel, summaryPipeline),
      runAggregate(ReservationModel, [...this.reservationPipeline(query, scope), { $group: { _id: '$facilityId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.ACTIVE] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.CANCELLED] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
      runAggregate(ReservationModel, [...this.reservationPipeline(query, scope), { $group: { _id: '$serviceType', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.ACTIVE] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.CANCELLED] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
      runAggregate(ReservationModel, [...this.reservationPipeline(query, scope), { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      runAggregate(ReservationModel, [...this.reservationPipeline(query, scope), { $group: { _id: { bucket: localBucketExpression('$createdAt', query.granularity ?? 'day'), serviceType: '$serviceType' }, total: { $sum: 1 }, paid: { $sum: { $cond: ['$_isPaid', 1, 0] } }, active: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.ACTIVE] }, 1, 0] } }, cancelled: { $sum: { $cond: [{ $eq: ['$status', ReservationStatus.CANCELLED] }, 1, 0] } } } }, { $sort: { '_id.bucket': 1 } }]),
    ]);
    const summaryRow = summary[0] ?? {};
    const total = value(summaryRow, 'totalReservations');
    const cancelled = value(summaryRow, 'cancelledReservations');
    return {
      success: true,
      data: {
        totalReservations: total, paidReservations: value(summaryRow, 'paidReservations'),
        pendingPaymentReservations: value(summaryRow, 'pendingPaymentReservations'), awaitingContractReservations: value(summaryRow, 'awaitingContractReservations'),
        activeReservations: value(summaryRow, 'activeReservations'), cancelledReservations: cancelled,
        completedReservations: value(summaryRow, 'completedReservations'), overdueReservations: value(summaryRow, 'overdueReservations'),
        reservationsByService: byService.map(item => ({ serviceType: item._id, total: value(item, 'total'), active: value(item, 'active'), cancelled: value(item, 'cancelled') })),
        reservationsByFacility: byFacility.map(item => ({ facilityId: id(item._id), total: value(item, 'total'), active: value(item, 'active'), cancelled: value(item, 'cancelled') })),
        reservationsByStatus: Object.fromEntries(byStatus.map(item => [id(item._id), value(item, 'count')])),
        reservationTrend: trend.map(item => ({ bucketStart: parseStoredDate(asRecord(item._id).bucket)?.toISOString() ?? null, serviceType: asRecord(item._id).serviceType, total: value(item, 'total'), paid: value(item, 'paid'), active: value(item, 'active'), cancelled: value(item, 'cancelled') })),
        cancellationRate: percentage(cancelled, total),
      },
      meta: periodMeta(query, scope, generatedAt, { paidReservationBasis: 'verified PayOS capture; BALANCE/FULL_RENT or settled zero-balance Managed V3 deposit', statusBasis: 'current Reservation.status for Reservations created in requested period', contractBasis: 'SIGNED with two-party signature evidence, verified paper proof, or customer and facility signatures' }, [
        'Status metrics are a current-state view of the reservation cohort created in fromDate/toDate; statusHistory is not used to reconstruct historical transition counts.',
        'Gia hạn không được tính thành Reservation mới.',
      ]),
    };
  }

  private static contractPipeline(query: StatisticsQuery, scope: Scope): PipelineStage[] {
    const contractStatus = requireStatus(query.status, Object.values(ContractStatus), 'contracts-lifecycle');
    const pipeline: PipelineStage[] = [
      { $match: { createdAt: { $gte: query.from, $lt: query.toExclusive }, ...(contractStatus ? { status: contractStatus } : {}), ...(LIVE) } },
      { $lookup: { from: ReservationModel.collection.name, localField: 'reservationId', foreignField: '_id', as: '_reservation' } },
      { $unwind: '$_reservation' },
      { $match: { ...(scope.type === 'FACILITY' ? { '_reservation.facilityId': scope.facilityId } : {}), ...(query.serviceType ? { '_reservation.serviceType': query.serviceType } : {}) } },
    ];
    if (query.unitSize) {
      pipeline.push(
        { $lookup: { from: StorageUnitModel.collection.name, localField: '_reservation.storageUnitId', foreignField: '_id', as: '_unit' } },
        { $match: { '_unit.size': query.unitSize } },
      );
    }
    pipeline.push({ $set: {
      _customerSigned: { $or: [ { $eq: [{ $type: '$signedByCustomerAt' }, 'date'] }, { $in: [UserRole.CUSTOMER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] },
      _facilitySigned: { $or: [ { $eq: [{ $type: '$signedByFMAt' }, 'date'] }, { $eq: [{ $type: '$verifiedAt' }, 'date'] }, { $in: [UserRole.FACILITY_STAFF, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $in: [UserRole.FACILITY_MANAGER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] },
      _bothSignersPresent: { $and: [
        { $in: [UserRole.CUSTOMER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] },
        { $or: [ { $in: [UserRole.FACILITY_STAFF, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $in: [UserRole.FACILITY_MANAGER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] },
      ] },
    } });
    pipeline.push({ $set: {
      _isSigned: { $and: [{ $eq: ['$status', ContractStatus.SIGNED] }, { $or: [ '$_bothSignersPresent', { $and: [ '$_customerSigned', { $eq: [{ $type: '$verifiedAt' }, 'date'] }, { $eq: [{ $type: '$signedProofPublicId' }, 'string'] } ] } ] }] },
      _renewalPeriods: { $setUnion: [
        { $map: { input: { $ifNull: ['$_reservation.renewals', []] }, as: 'renewal', in: { $concat: [{ $toString: '$$renewal.oldEndDate' }, '|', { $toString: '$$renewal.newEndDate' }] } } },
        { $map: { input: { $filter: { input: { $ifNull: ['$_reservation.extendContract', []] }, as: 'extension', cond: { $in: ['$$extension.status', ['PAID', 'ACTIVE']] } } }, as: 'extension', in: { $concat: [{ $toString: '$$extension.oldEndDate' }, '|', { $toString: '$$extension.newEndDate' }] } } },
      ] },
      _expiringSoon: { $and: [ { $in: ['$_reservation.status', [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE]] }, { $gte: ['$_reservation.endDate', new Date()] }, { $lte: ['$_reservation.endDate', new Date(Date.now() + (query.expiringWithinDays ?? 30) * 86_400_000)] } ] },
    } });
    return pipeline;
  }

  static async contractsLifecycle(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const base = this.contractPipeline(query, scope);
    const summaryPipeline: PipelineStage[] = [...base, { $group: { _id: null,
      totalContracts: { $sum: 1 }, signedContracts: { $sum: { $cond: ['$_isSigned', 1, 0] } },
      unsignedContracts: { $sum: { $cond: [{ $eq: ['$status', ContractStatus.DRAFT] }, 1, 0] } },
      activeContracts: { $sum: { $cond: [{ $and: ['$_isSigned', { $in: ['$_reservation.status', [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE]] }] }, 1, 0] } },
      expiringSoonContracts: { $sum: { $cond: [{ $and: ['$_isSigned', '$_expiringSoon'] }, 1, 0] } },
      expiredContracts: { $sum: { $cond: [{ $eq: ['$status', ContractStatus.EXPIRED] }, 1, 0] } },
      completedContracts: { $sum: { $cond: [{ $and: ['$_isSigned', { $in: ['$_reservation.status', [ReservationStatus.CHECKED_OUT, ReservationStatus.CLOSED]] }] }, 1, 0] } },
      renewedContracts: { $sum: { $cond: [{ $gt: [{ $size: '$_renewalPeriods' }, 0] }, 1, 0] } },
      renewalCount: { $sum: { $size: '$_renewalPeriods' } },
    } }];
    const [summary, byFacility, byService, trend] = await Promise.all([
      runAggregate(ContractModel, summaryPipeline),
      runAggregate(ContractModel, [...base, { $group: { _id: '$_reservation.facilityId', totalContracts: { $sum: 1 }, signedContracts: { $sum: { $cond: ['$_isSigned', 1, 0] } }, activeContracts: { $sum: { $cond: [{ $and: ['$_isSigned', { $in: ['$_reservation.status', [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE]] }] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
      runAggregate(ContractModel, [...base, { $group: { _id: '$_reservation.serviceType', totalContracts: { $sum: 1 }, signedContracts: { $sum: { $cond: ['$_isSigned', 1, 0] } }, activeContracts: { $sum: { $cond: [{ $and: ['$_isSigned', { $in: ['$_reservation.status', [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE]] }] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
      runAggregate(ContractModel, [...base, { $group: { _id: localBucketExpression('$createdAt', query.granularity ?? 'day'), totalContracts: { $sum: 1 }, signedContracts: { $sum: { $cond: ['$_isSigned', 1, 0] } }, unsignedContracts: { $sum: { $cond: [{ $eq: ['$status', ContractStatus.DRAFT] }, 1, 0] } } } }, { $sort: { _id: 1 } }]),
    ]);
    const expiringWithinDays = query.expiringWithinDays ?? 30;
    const lifecycle = summary[0] ?? { totalContracts: 0, signedContracts: 0, unsignedContracts: 0, activeContracts: 0, expiringSoonContracts: 0, expiredContracts: 0, completedContracts: 0, renewedContracts: 0, renewalCount: 0 };
    return {
      success: true,
      data: {
        totalContracts: value(lifecycle, 'totalContracts'), signedContracts: value(lifecycle, 'signedContracts'), unsignedContracts: value(lifecycle, 'unsignedContracts'),
        activeContracts: value(lifecycle, 'activeContracts'), expiringSoonContracts: value(lifecycle, 'expiringSoonContracts'), expiredContracts: value(lifecycle, 'expiredContracts'),
        completedContracts: value(lifecycle, 'completedContracts'), renewedContracts: value(lifecycle, 'renewedContracts'), renewalCount: value(lifecycle, 'renewalCount'), renewalRate: null,
        renewalRateUnavailableReason: 'The source records successful renewal/extension entries but does not retain a complete eligible-contract cohort or all failed/declined renewal attempts.',
        contractsByFacility: byFacility.map(item => ({ facilityId: id(item._id), totalContracts: value(item, 'totalContracts'), signedContracts: value(item, 'signedContracts'), activeContracts: value(item, 'activeContracts') })),
        contractsByService: byService.map(item => ({ serviceType: item._id, totalContracts: value(item, 'totalContracts'), signedContracts: value(item, 'signedContracts'), activeContracts: value(item, 'activeContracts') })),
        contractTrend: trend.map(item => ({ bucketStart: parseStoredDate(item._id)?.toISOString() ?? null, totalContracts: value(item, 'totalContracts'), signedContracts: value(item, 'signedContracts'), unsignedContracts: value(item, 'unsignedContracts') })),
      },
      meta: periodMeta(query, scope, generatedAt, { signedContractBasis: 'Contract.status SIGNED plus customer and facility signature evidence', activeContractBasis: 'signed Contract linked to current Reservation ACTIVE/OVERDUE', renewalCountBasis: 'distinct successful reservation renewal/extension date pairs; not separate contracts' }, [
        `expiringSoonContracts uses a current snapshot window of the next ${expiringWithinDays} days.`,
        'Renewal rate is unavailable because the eligible renewal cohort and unsuccessful renewal attempts are not fully represented.',
        'Contract trend is by Contract.createdAt; current status counts are not historical status-transition counts.',
      ]),
    };
  }
}
