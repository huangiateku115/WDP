import { createHash } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import ManagedFacilityCapacityModel from '../../models/reservations/managed-facility-capacity.model';
import ReservationModel from '../../models/reservations/reservation.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import UserModel from '../../models/users/user.model';
import PricingModel from '../../models/pricing-policy/pricing-rule.model';
import PolicyModel from '../../models/pricing-policy/policy.model';
import ContractModel from '../../models/contracts/contract.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import { ContractStatus } from '../../types/contract.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { PricingBasis, PolicyType, TermUnit } from '../../types/pricing-policy.type';
import { VerificationStatus } from '../../types/customer-profile.type';
import { IReservation, ReservationStatus } from '../../types/reservation.type';
import { IUser, UserRole } from '../../types/user.type';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { CellAllocationStatus, WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { assertIdempotentPaymentMatch, calculateRentalPaymentBreakdown, PaymentAccountingError, roundVndAmount, transitionPaymentStatus } from '../payments/payment-accounting';
import { pricingRevisionAt, projectPricingRevision } from '../pricing-policy/pricing-revision';
import { PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { captureTermsAcceptance } from '../terms/terms.catalog';
import { managedSigningDeadline } from '../../utils/managed-signing-deadline';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
const occupying = [ReservationStatus.RESERVED, ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY, ReservationStatus.CONTRACTED, ReservationStatus.PAID, ReservationStatus.ACTIVE, ReservationStatus.OVERDUE];
// Historical record operations remain development-only until their records are retired; new booking paths never call them.
const managedDepositFlowEnabled = () => process.env.NODE_ENV === 'development' && process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true';

export class ManagedReservationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new ManagedReservationError(status, message); }
function object(value: unknown, allowed: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !allowed.includes(k) || k.startsWith('$'))) fail(400, `Invalid ${label}`);
  return value as Record<string, unknown>;
}
function id(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, `Invalid ${label}`);
  return new Types.ObjectId(value);
}
function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(400, `${label} must be finite and positive`);
  return value as number;
}
function utc(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) fail(400, `${label} must be an ISO UTC timestamp`);
  const date = new Date(value);
  const expected = value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== expected) fail(400, `${label} is invalid`);
  return date;
}
function term(value: unknown) {
  const input = object(value, ['value', 'unit'], 'term');
  if (!Number.isSafeInteger(input.value) || Number(input.value) <= 0 || !Object.values(TermUnit).includes(input.unit as TermUnit)) fail(400, 'Invalid term');
  return { value: Number(input.value), unit: input.unit as TermUnit };
}
function parseRequest(value: unknown) {
  const input = object(value, ['facilityId', 'allocatedCapacityM3', 'startDate', 'term', 'cellIds', 'termsAccepted', 'termsVersionId'], 'request');
  const facilityId = id(input.facilityId, 'facilityId');
  // Capacity comes from selected Cells. Retain optional legacy input compatibility,
  // but never use it as authority for price or entitlement.
  const allocatedCapacityM3 = input.allocatedCapacityM3 === undefined ? 0 : positive(input.allocatedCapacityM3, 'allocatedCapacityM3');
  const startDate = utc(input.startDate, 'startDate');
  const duration = term(input.term);
  const endDate = new Date(startDate);
  if (duration.unit === TermUnit.DAY) endDate.setUTCDate(endDate.getUTCDate() + duration.value);
  else {
    const monthIndex = endDate.getUTCMonth() + duration.value * (duration.unit === TermUnit.YEAR ? 12 : 1);
    const targetYear = endDate.getUTCFullYear() + Math.floor(monthIndex / 12);
    const targetMonth = monthIndex % 12;
    const day = endDate.getUTCDate();
    endDate.setUTCDate(1); endDate.setUTCFullYear(targetYear); endDate.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    endDate.setUTCDate(Math.min(day, lastDay));
  }
  if (!Number.isFinite(endDate.getTime()) || endDate <= startDate) fail(400, 'Computed rental endDate is invalid');
  let cellIds: Types.ObjectId[] | undefined;
  if (input.cellIds !== undefined) {
    if (!Array.isArray(input.cellIds) || !input.cellIds.length || input.cellIds.length > 100) fail(400, 'cellIds must contain 1 to 100 Cells');
    cellIds = input.cellIds.map((value, index) => id(value, `cellIds[${index}]`));
    if (new Set(cellIds.map(String)).size !== cellIds.length) fail(400, 'cellIds must be unique');
  }
  if (input.termsAccepted !== undefined && typeof input.termsAccepted !== 'boolean') fail(400, 'termsAccepted must be a boolean');
  if (input.termsVersionId !== undefined && (typeof input.termsVersionId !== 'string' || input.termsVersionId.length > 120)) fail(400, 'Invalid termsVersionId');
  return { facilityId, allocatedCapacityM3, startDate, endDate, term: duration, cellIds, termsAccepted: input.termsAccepted, termsVersionId: input.termsVersionId as string | undefined };
}
function requireManagement(actor: Actor) {
  if (![UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Facility management role required');
}
function assertFacilityScope(actor: Actor, facilityId: Types.ObjectId) {
  if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role) &&
      (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(facilityId))) fail(403, 'Facility is outside assigned scope');
}
function committedQuery(now: Date) {
  return { $or: [
    { status: { $in: [ReservationStatus.DEPOSIT_PAID, ReservationStatus.CHECKIN_READY, ReservationStatus.PAID, ReservationStatus.ACTIVE, ReservationStatus.OVERDUE] } },
    { status: { $in: [ReservationStatus.RESERVED, ReservationStatus.CONTRACTED] }, expiresAt: { $gt: now } },
  ] };
}
function isUnresolvedOverdue(record: { startDate: Date; endDate: Date; status?: string }, now = new Date()) {
  return record.status === ReservationStatus.OVERDUE ||
    (record.status === ReservationStatus.ACTIVE && new Date(record.endDate).getTime() <= now.getTime());
}
function peakCapacity(records: Array<{ startDate: Date; endDate: Date; allocatedCapacity?: number; status?: string }>, start: Date, end: Date) {
  const events = new Map<number, number>();
  const add = (at: number, delta: number) => events.set(at, (events.get(at) ?? 0) + delta);
  for (const record of records) {
    const amount = Number(record.allocatedCapacity);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const from = Math.max(start.getTime(), new Date(record.startDate).getTime());
    // An OVERDUE Managed reservation is an unresolved physical-storage
    // obligation. Until outbound/disposition is confirmed, its contracted
    // quota remains conservatively unavailable beyond the contractual end.
    const openEndedOverdue = isUnresolvedOverdue(record);
    const to = openEndedOverdue ? end.getTime() : Math.min(end.getTime(), new Date(record.endDate).getTime());
    if (from < to) { add(from, amount); add(to, -amount); }
  }
  let used = 0, peak = 0;
  for (const [at, delta] of [...events].sort(([a], [b]) => a - b)) {
    used += delta;
    if (at < end.getTime()) peak = Math.max(peak, used);
  }
  return peak;
}
async function readCommitments(facilityId: Types.ObjectId, startDate: Date, endDate: Date, session?: ClientSession) {
  const now = new Date();
  let query = ReservationModel.find({
    facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
    status: { $in: occupying }, startDate: { $lt: endDate },
    $and: [
      { $or: [
        { status: ReservationStatus.OVERDUE },
        { endDate: { $gt: startDate } },
        { status: ReservationStatus.ACTIVE, endDate: { $lte: now } },
      ] },
      committedQuery(now),
    ],
  });
  if (session) query = query.session(session);
  return query.select('startDate endDate allocatedCapacity status expiresAt').lean().exec();
}
async function effectiveQuote(input: ReturnType<typeof parseRequest>, session?: ClientSession, strictV3 = false) {
  const facilityFilter = { _id: input.facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } };
  let facilityQuery = FacilityModel.findOne(facilityFilter); if (session) facilityQuery = facilityQuery.session(session);
  const facility = await facilityQuery.exec();
  if (!facility) fail(404, 'Active Managed Inventory Facility not found');
  let capacityQuery = ManagedFacilityCapacityModel.findOne({ facilityId: input.facilityId, isActive: true }); if (session) capacityQuery = capacityQuery.session(session);
  const capacity = await capacityQuery.exec();
  if (!capacity) fail(409, 'Managed sellable capacity is not configured or active');
  const commitments = await readCommitments(input.facilityId, input.startDate, input.endDate, session);
  const committedCapacityM3 = peakCapacity(commitments, input.startDate, input.endDate);
  const availableCapacityM3 = capacity.sellableCapacityM3 - committedCapacityM3;
  if (input.allocatedCapacityM3 > availableCapacityM3) fail(409, 'Requested quota exceeds available Managed capacity for this interval');

  const interval = { effectiveFrom: { $lte: input.startDate }, $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gt: input.startDate } }] };
  let pricingQuery = PricingModel.find({ facilityId: input.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, billingBasis: PricingBasis.PER_M3,
    'term.value': input.term.value, 'term.unit': input.term.unit, isActive: true });
  let depositQuery: any = strictV3 ? null : PolicyModel.find({ facilityId: input.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY, type: PolicyType.DEPOSIT, isActive: true, ...interval }).limit(2);
  if (session) { pricingQuery = pricingQuery.session(session); if (depositQuery) depositQuery = depositQuery.session(session); }
  const [priceCandidates, deposits] = await Promise.all([pricingQuery.exec(), depositQuery ? depositQuery.exec() : Promise.resolve([])]);
  const prices = priceCandidates.flatMap(candidate => {
    const revision = pricingRevisionAt(candidate, input.startDate);
    return revision ? [projectPricingRevision(candidate, revision)] : [];
  });
  const pricingRule = prices[0], depositPolicy = deposits[0];
  if (prices.length !== 1 || !pricingRule) fail(409, prices.length ? 'Managed pricing is ambiguous' : 'Effective per-m3 Managed pricing is not configured');
  if (!strictV3 && (deposits.length !== 1 || !depositPolicy)) fail(409, deposits.length ? 'Managed deposit policy is ambiguous' : 'Effective Managed deposit policy is not configured');
  let depositPercentage = 0;
  if (!strictV3) {
    const rawDepositConfig = depositPolicy!.config;
    if (!rawDepositConfig || typeof rawDepositConfig !== 'object' || Array.isArray(rawDepositConfig) ||
        Object.keys(rawDepositConfig).some(key => !['calculation', 'percentage'].includes(key))) fail(409, 'Managed deposit policy has an unsupported configuration');
    const depositConfig = rawDepositConfig as Record<string, unknown>;
    if (depositConfig.calculation !== 'PERCENT_OF_RENT' || typeof depositConfig.percentage !== 'number' || !Number.isFinite(depositConfig.percentage) || depositConfig.percentage < 0) fail(409, 'Managed deposit policy must explicitly configure PERCENT_OF_RENT and a non-negative percentage');
    depositPercentage = depositConfig.percentage;
  }
  let estimatedRent = input.allocatedCapacityM3 * pricingRule.price;
  let depositAmount = strictV3 ? 0 : estimatedRent * depositPercentage / 100;
  if (strictV3) {
    if (pricingRule.currency !== 'VND') fail(409, 'Managed Inventory V3 requires VND pricing');
    estimatedRent = roundVndAmount(estimatedRent);
    depositAmount = strictV3 ? 0 : roundVndAmount(estimatedRent * depositPercentage / 100);
    if (!strictV3 && depositAmount <= 0) fail(409, 'Managed deposit policy must produce a positive VND deposit');
  }
  if (![estimatedRent, depositAmount].every(Number.isFinite)) fail(409, 'Managed quote amount overflow');
  let paymentBreakdown;
  try {
    paymentBreakdown = calculateRentalPaymentBreakdown({ rentAmount: estimatedRent, depositAmount, taxAmount: 0, discountAmount: 0 });
  } catch (error) {
    if (error instanceof PaymentAccountingError) fail(error.status, error.message);
    throw error;
  }
  return { capacity, committedCapacityM3, availableCapacityM3, pricingRule, depositPolicy, estimatedRent, depositAmount, paymentBreakdown };
}
async function withTransaction<T>(operation: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try { let result!: T; await session.withTransaction(async () => { result = await operation(session); }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); return result; }
  catch (error) {
    if (error instanceof ManagedReservationError) throw error;
    const e = error as { code?: number; codeName?: string; name?: string };
    // withTransaction retries transient transaction failures internally; if it still rejects
    // with MongoDB's explicit WriteConflict code, the retry budget is exhausted.
    if (e.code === 112 || e.codeName === 'WriteConflict') fail(409, 'Concurrent Managed reservation change; retry');
    if (e.code === 11000 || e.name === 'VersionError') fail(409, 'Concurrent Managed reservation change; retry');
    if (e.name === 'ValidationError' || e.name === 'CastError') fail(400, 'Invalid Managed reservation data');
    throw error;
  } finally { await session.endSession(); }
}
async function lockCapacity(facilityId: Types.ObjectId, session: ClientSession, requireActive = true) {
  const capacity = await ManagedFacilityCapacityModel.findOneAndUpdate({ facilityId, ...(requireActive ? { isActive: true } : {}) }, { $inc: { bookingVersion: 1 } }, { new: true, session }).exec();
  if (!capacity) fail(409, 'Managed capacity configuration is missing or inactive');
  return capacity;
}
const allocationVolume = (cell: { dimensions: { widthM: number; depthM: number; usableHeightM?: number } }) => {
  if (!Number.isFinite(cell.dimensions.usableHeightM) || Number(cell.dimensions.usableHeightM) <= 0) fail(409, 'Selected Cell usable dimensions must be configured before booking');
  return cell.dimensions.widthM * cell.dimensions.depthM * Number(cell.dimensions.usableHeightM);
};
async function lockSelectedCells(cellIds: Types.ObjectId[], facilityId: Types.ObjectId, session: ClientSession) {
  const cells = [] as any[];
  for (const cellId of [...cellIds].sort((a, b) => a.toString().localeCompare(b.toString()))) {
    const cell = await WarehouseCellModel.findOne({ _id: cellId, facilityId, deletedAt: { $exists: false } }).session(session).exec();
    if (!cell) fail(409, 'Every selected Cell must be active in the selected Managed Facility');
    cells.push(cell);
  }
  const zoneIds = [...new Set(cells.map(cell => cell.zoneId.toString()))].sort();
  for (const zoneId of zoneIds) {
    const zone = await WarehouseZoneModel.findOneAndUpdate({ _id: zoneId, facilityId, isActive: true, deletedAt: { $exists: false } },
      { $inc: { structureVersion: 1 } }, { new: true, session }).exec();
    if (!zone) fail(409, 'Selected Cell parent Zone must be active');
  }
  const rackIds = [...new Set(cells.map(cell => cell.rackId.toString()))].sort();
  for (const rackId of rackIds) {
    const source = cells.find(cell => cell.rackId.toString() === rackId);
    const rack = await WarehouseRackModel.findOneAndUpdate({ _id: rackId, facilityId, zoneId: source.zoneId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, deletedAt: { $exists: false } },
      { $inc: { layoutVersion: 1 } }, { new: true, session }).exec();
    if (!rack) fail(409, 'Selected Cell parent Rack must be active');
  }
  const locked = [] as any[];
  for (const cell of cells) {
    const row = await WarehouseCellModel.findOneAndUpdate({ _id: cell._id, facilityId, operationalStatus: WarehouseOperationalStatus.AVAILABLE,
      deletedAt: { $exists: false }, usedWeightKg: { $eq: 0, $exists: true }, usedVolumeM3: { $eq: 0, $exists: true } },
      { $inc: { allocationVersion: 1 } }, { new: true, session }).exec();
    if (!row) fail(409, 'Selected Cell is not physically available for a new reservation');
    locked.push(row);
  }
  return locked;
}
async function assertCellIntervalsAvailable(cells: any[], startDate: Date, endDate: Date, now: Date, session: ClientSession, ownReservationId?: Types.ObjectId) {
  for (const cell of cells) {
    const conflict = await CellAllocationModel.findOne({
      ...(ownReservationId ? { reservationId: { $ne: ownReservationId } } : {}),
      $or: [
      { cellId: cell._id, status: CellAllocationStatus.OCCUPIED },
      { cellId: cell._id, status: CellAllocationStatus.RESERVED, startDate: { $lt: endDate }, endDate: { $gt: startDate } },
      { cellId: cell._id, status: CellAllocationStatus.HOLD, holdExpiresAt: { $gt: now }, startDate: { $lt: endDate }, endDate: { $gt: startDate } },
    ],
    }).session(session).exec();
    if (conflict) fail(409, `Cell ${cell.code} is already allocated for an overlapping rental period`);
  }
}
// Share the booking write locks so an overlapping booking cannot pass between
// validating the holds and promoting them. The caller owns the transaction.
export async function lockManagedDepositHolds(
  reservation: Pick<IReservation, '_id' | 'customerId' | 'facilityId' | 'allocatedCellIds' | 'startDate' | 'endDate' | 'expiresAt'>,
  now: Date, session: ClientSession,
) {
  const cellIds = reservation.allocatedCellIds ?? [];
  const expected = new Set(cellIds.map(String));
  const { startDate, endDate, expiresAt } = reservation;
  if (!cellIds.length || expected.size !== cellIds.length || !expiresAt || expiresAt <= now ||
      !(startDate instanceof Date) || !(endDate instanceof Date) || !(startDate < endDate)) {
    fail(409, 'Managed V3 reservation has an invalid Cell hold or rental interval');
  }

  await lockCapacity(reservation.facilityId, session);
  const cells = await lockSelectedCells(cellIds, reservation.facilityId, session);
  const holds = await CellAllocationModel.find({ reservationId: reservation._id }).session(session).exec();
  if (holds.length !== cellIds.length || holds.some(hold =>
    !expected.delete(String(hold.cellId)) || !hold.customerId.equals(reservation.customerId) ||
    !hold.facilityId.equals(reservation.facilityId) || hold.status !== CellAllocationStatus.HOLD ||
    hold.startDate?.getTime() !== startDate.getTime() || hold.endDate?.getTime() !== endDate.getTime() ||
    hold.holdExpiresAt?.getTime() !== expiresAt.getTime())) {
    fail(409, 'Managed V3 Cell holds no longer match the reservation');
  }
  await assertCellIntervalsAvailable(cells, startDate, endDate, now, session, reservation._id);

  return {
    _id: { $in: holds.map(hold => hold._id) }, reservationId: reservation._id,
    customerId: reservation.customerId, facilityId: reservation.facilityId, cellId: { $in: cellIds },
    startDate, endDate, status: CellAllocationStatus.HOLD, holdExpiresAt: { $eq: expiresAt, $gt: now },
  };
}
async function releaseReservationCells(reservationId: Types.ObjectId, session: ClientSession) {
  const allocations = await CellAllocationModel.find({ reservationId, status: { $in: [CellAllocationStatus.HOLD, CellAllocationStatus.RESERVED] } }).session(session).exec();
  for (const allocation of allocations) {
    const cell = await WarehouseCellModel.findOne({ _id: allocation.cellId }).session(session).exec();
    if (cell && (Number(cell.usedWeightKg ?? 0) > 0 || Number(cell.usedVolumeM3 ?? 0) > 0)) allocation.status = CellAllocationStatus.OCCUPIED;
    else allocation.status = CellAllocationStatus.RELEASED;
    await allocation.save({ session });
  }
}
async function audit(session: ClientSession, event: {
  facilityId: Types.ObjectId; reservationId?: Types.ObjectId; actorId: Types.ObjectId;
  action: ManagedReservationAction; fromStatus?: string; toStatus?: string; details?: Record<string, unknown>;
}) {
  await new ManagedReservationAuditModel(event).save({ session });
}
function publicQuote(input: ReturnType<typeof parseRequest>, result: Awaited<ReturnType<typeof effectiveQuote>>) {
  return {
    bookingFlowVersion: 3,
    facilityId: input.facilityId, cellIds: (input.cellIds ?? []).map(String),
    allocatedCapacityM3: input.allocatedCapacityM3, startDate: input.startDate, endDate: input.endDate, term: input.term,
    sellableCapacityM3: result.capacity.sellableCapacityM3, committedPeakCapacityM3: result.committedCapacityM3,
    availableCapacityM3: result.availableCapacityM3,
    pricing: { ruleId: result.pricingRule._id, version: result.pricingRule.version, billingBasis: result.pricingRule.billingBasis, ratePerM3: result.pricingRule.price, currency: result.pricingRule.currency, estimatedRent: result.estimatedRent },
    taxAmount: 0,
    ...(result.depositPolicy ? { deposit: { policyId: result.depositPolicy._id, version: result.depositPolicy.version,
      calculation: 'PERCENT_OF_RENT', percentage: (result.depositPolicy.config as any).percentage, amount: result.depositAmount },
      paymentBreakdown: { totalDue: result.paymentBreakdown.totalDue, depositCredit: result.paymentBreakdown.depositCredit,
        balanceDue: result.paymentBreakdown.balanceDue } } : { payment: { purpose: 'FULL_RENT', amount: result.paymentBreakdown.totalDue, currency: result.pricingRule.currency } }),
  };
}

export class ManagedReservationService {
  static async quote(body: unknown) {
    const input = parseRequest(body);
    if (input.startDate <= new Date()) fail(400, 'startDate must be in the future');
    // Service-level compatibility for historical quota-only tests and internal reads.
    // The V3 HTTP controller requires selected Cells.
    if (!input.cellIds?.length) return publicQuote(input, await effectiveQuote(input));
    if (input.cellIds) {
      const cells = await WarehouseCellModel.find({ _id: { $in: input.cellIds }, facilityId: input.facilityId, deletedAt: { $exists: false } }).exec();
      if (cells.length !== input.cellIds.length) fail(409, 'Selected Cells must belong to the selected Managed Facility');
      if (cells.some(cell => cell.operationalStatus !== WarehouseOperationalStatus.AVAILABLE ||
          typeof cell.usedWeightKg !== 'number' || !Number.isFinite(cell.usedWeightKg) || cell.usedWeightKg !== 0 ||
          typeof cell.usedVolumeM3 !== 'number' || !Number.isFinite(cell.usedVolumeM3) || cell.usedVolumeM3 !== 0)) {
        fail(409, 'Selected Cells must be operationally available with known empty physical counters');
      }
      const cellCapacity = cells.reduce((sum, cell) => sum + allocationVolume(cell), 0);
      if (input.allocatedCapacityM3 > 0 && Math.abs(cellCapacity - input.allocatedCapacityM3) > 0.000001) fail(400, 'allocatedCapacityM3 must match the selected Cells total configured volume');
      input.allocatedCapacityM3 = cellCapacity;
      const conflict = await CellAllocationModel.exists({ cellId: { $in: input.cellIds }, $or: [
        { status: CellAllocationStatus.OCCUPIED },
        { status: CellAllocationStatus.RESERVED, startDate: { $lt: input.endDate }, endDate: { $gt: input.startDate } },
        { status: CellAllocationStatus.HOLD, holdExpiresAt: { $gt: new Date() }, startDate: { $lt: input.endDate }, endDate: { $gt: input.startDate } },
      ] }).exec();
      if (conflict) fail(409, 'A selected Cell is already allocated for an overlapping rental period');
      const zoneIds = [...new Set(cells.map(cell => cell.zoneId.toString()))];
      const rackIds = [...new Set(cells.map(cell => cell.rackId.toString()))];
      const [zones, racks] = await Promise.all([
        WarehouseZoneModel.find({ _id: { $in: zoneIds }, facilityId: input.facilityId, isActive: true, deletedAt: { $exists: false } }).exec(),
        WarehouseRackModel.find({ _id: { $in: rackIds }, facilityId: input.facilityId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, deletedAt: { $exists: false } }).exec(),
      ]);
      if (zones.length !== zoneIds.length || racks.length !== rackIds.length) fail(409, 'Selected Cells must belong to active Zones and available Racks');
    }
    return publicQuote(input, await effectiveQuote(input, undefined, !!input.cellIds?.length));
  }
  static async create(body: unknown, actor: Actor, rawIdempotencyKey?: unknown) {
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Customer role required');
    const input = parseRequest(body);
    if (!input.cellIds?.length) fail(400, 'Select one or more Cells before creating a Managed reservation');
    const idempotencyKey = typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : '';
    if (!idempotencyKey || idempotencyKey.length > 120 || /[\r\n]/.test(idempotencyKey)) {
      fail(400, 'A valid Idempotency-Key header is required for a new Managed Inventory reservation');
    }
    // New reservations use the full-rent V3 contract. Historical V1/V2 records
    // remain readable and are handled by their existing compatibility paths.
    const bookingIdempotencyKey = `MI-V3-${idempotencyKey}`;
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      customerId: String(actor._id), facilityId: String(input.facilityId), cellIds: input.cellIds.map(String).sort(),
      allocatedCapacityM3: input.allocatedCapacityM3, startDate: input.startDate.toISOString(), term: input.term,
      termsVersionId: input.termsVersionId,
    })).digest('hex');
    return withTransaction(async session => {
      const replay: any = await (ReservationModel as any).findOne({ customerId: actor._id, bookingIdempotencyKey }).session(session).exec();
      if (replay) {
        if (replay.bookingPayloadHash !== requestFingerprint) fail(409, 'Idempotency-Key was already used with a different booking request');
        return { reservation: replay, quote: null, idempotent: true };
      }
      let termsAcceptance;
      try { termsAcceptance = captureTermsAcceptance(FacilityServiceType.MANAGED_INVENTORY, input.termsVersionId, input.termsAccepted); }
      catch (error) {
        const message = error instanceof Error ? error.message : '';
        fail(message === 'TERMS_VERSION_STALE' ? 409 : message === 'NO_EFFECTIVE_TERMS' ? 503 : 400,
          message === 'TERMS_VERSION_STALE' ? 'Terms have changed. Review and accept the current version before continuing' : message === 'NO_EFFECTIVE_TERMS' ? 'No effective Terms are configured for this service' : 'Customer acceptance of the current Terms is required');
      }
      const now = new Date();
      if (input.startDate <= now) fail(400, 'startDate must be in the future');
      const profile = await CustomerProfileModel.findOne({ userId: actor._id }).session(session).exec();
      if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) fail(403, 'Verified Customer Profile required');
      const capacity = await lockCapacity(input.facilityId, session);
      const selectedCells = await lockSelectedCells(input.cellIds!, input.facilityId, session);
      await assertCellIntervalsAvailable(selectedCells, input.startDate, input.endDate, now, session);
      const selectedVolumeM3 = selectedCells.reduce((sum, cell) => sum + allocationVolume(cell), 0);
      if (input.allocatedCapacityM3 > 0 && Math.abs(selectedVolumeM3 - input.allocatedCapacityM3) > 0.000001) fail(400, 'allocatedCapacityM3 must match the selected Cells total configured volume');
      input.allocatedCapacityM3 = selectedVolumeM3;
      const result = await effectiveQuote(input, session, true);
      const created = new ReservationModel({
        reservationCode: `MIR-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${new Types.ObjectId().toString().slice(-6).toUpperCase()}`,
        customerId: actor._id, facilityId: input.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
        allocatedCapacity: input.allocatedCapacityM3, allocatedCellIds: selectedCells.map(cell => cell._id), startDate: input.startDate, endDate: input.endDate,
        status: ReservationStatus.RESERVED, bookingFlowVersion: 3 as const, rentalPaymentFlow: 'FULL_UPFRONT_V1' as const,
        bookingIdempotencyKey, bookingPayloadHash: requestFingerprint, signingDeadline: managedSigningDeadline(input.startDate),
        estimatedRent: result.estimatedRent, depositAmount: 0, taxAmount: 0, discountAmount: 0,
        termsAcceptance,
        expiresAt: new Date(now.getTime() + capacity.holdDurationMinutes * 60_000),
        pricingPolicyId: result.pricingRule._id,
        managedPricingSnapshot: {
          quotaM3: input.allocatedCapacityM3, term: input.term, startDate: input.startDate, endDate: input.endDate,
          pricingRule: { id: result.pricingRule._id, version: result.pricingRule.version, billingBasis: PricingBasis.PER_M3, ratePerM3: result.pricingRule.price, currency: result.pricingRule.currency },
          ...(result.depositPolicy ? { depositPolicy: { id: result.depositPolicy._id, version: result.depositPolicy.version, calculation: 'PERCENT_OF_RENT', percentage: (result.depositPolicy.config as any).percentage } } : {}),
          amountBreakdown: {
            estimatedRent: result.estimatedRent, ...(result.depositPolicy ? { depositAmount: result.depositAmount } : {}), taxAmount: 0, discountAmount: 0,
            totalDue: result.paymentBreakdown.totalDue, ...(result.depositPolicy ? { depositCredit: result.paymentBreakdown.depositCredit, balanceDue: result.paymentBreakdown.balanceDue } : {}),
          },
          capacityBookingVersion: capacity.bookingVersion,
          selectedCells: selectedCells.map(cell => ({ cellId: cell._id, volumeM3: allocationVolume(cell) })),
        },
        statusHistory: [{ status: ReservationStatus.RESERVED, actorId: actor._id, reason: 'Customer created Managed Inventory quota reservation' }],
      });
      await created.save({ session });
      await CellAllocationModel.insertMany(selectedCells.map(cell => ({
        facilityId: input.facilityId, cellId: cell._id, reservationId: created._id, customerId: actor._id,
        startDate: input.startDate, endDate: input.endDate, status: CellAllocationStatus.HOLD,
        holdExpiresAt: created.expiresAt,
      })), { session });
      await audit(session, { facilityId: input.facilityId, reservationId: created._id, actorId: actor._id,
        action: ManagedReservationAction.CREATED, toStatus: ReservationStatus.RESERVED,
        details: { allocatedCapacityM3: input.allocatedCapacityM3, simulatedPayment: false } });
      return { reservation: created, quote: publicQuote(input, result) };
    });
  }
  static async configureCapacity(facilityIdInput: unknown, body: unknown, actor: Actor) {
    requireManagement(actor);
    const facilityId = id(facilityIdInput, 'facilityId'); assertFacilityScope(actor, facilityId);
    const input = object(body, ['sellableCapacityM3', 'holdDurationMinutes', 'isActive'], 'capacity config');
    if (!Object.keys(input).length || (input.sellableCapacityM3 !== undefined && (typeof input.sellableCapacityM3 !== 'number' || !Number.isFinite(input.sellableCapacityM3) || input.sellableCapacityM3 <= 0)) ||
        (input.holdDurationMinutes !== undefined && (!Number.isSafeInteger(input.holdDurationMinutes) || Number(input.holdDurationMinutes) <= 0)) ||
        (input.isActive !== undefined && typeof input.isActive !== 'boolean')) fail(400, 'Invalid capacity configuration');
    return withTransaction(async session => {
      const facility = await FacilityModel.findOne({ _id: facilityId, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).session(session).exec();
      if (!facility) fail(404, 'Managed Inventory Facility not found');
      const existing = await ManagedFacilityCapacityModel.findOne({ facilityId }).session(session).exec();
      let capacity = existing;
      if (!capacity) {
        if (input.sellableCapacityM3 === undefined || input.holdDurationMinutes === undefined) fail(400, 'Initial configuration requires sellableCapacityM3 and holdDurationMinutes');
        capacity = new ManagedFacilityCapacityModel({ facilityId, sellableCapacityM3: input.sellableCapacityM3, holdDurationMinutes: input.holdDurationMinutes, bookingVersion: 1, isActive: input.isActive ?? true, updatedBy: actor._id });
        await capacity.save({ session });
        await audit(session, { facilityId, actorId: actor._id, action: ManagedReservationAction.QUOTA_CONFIGURED,
          details: { sellableCapacityM3: capacity.sellableCapacityM3, holdDurationMinutes: capacity.holdDurationMinutes, isActive: capacity.isActive } });
        return capacity;
      }
      await ManagedFacilityCapacityModel.updateOne({ _id: capacity._id }, { $inc: { bookingVersion: 1 } }, { session }).exec();
      capacity = await ManagedFacilityCapacityModel.findById(capacity._id).session(session).exec();
      if (!capacity) fail(409, 'Capacity configuration changed; retry');
      const nextCapacity = (input.sellableCapacityM3 as number | undefined) ?? capacity.sellableCapacityM3;
      const commitments = await readCommitments(facilityId, new Date(), new Date(8640000000000000), session);
      const peak = peakCapacity(commitments, new Date(), new Date(8640000000000000));
      if (nextCapacity < peak) fail(409, 'Capacity cannot be reduced below valid committed quota');
      if (input.sellableCapacityM3 !== undefined) capacity.sellableCapacityM3 = input.sellableCapacityM3 as number;
      if (input.holdDurationMinutes !== undefined) capacity.holdDurationMinutes = input.holdDurationMinutes as number;
      if (input.isActive !== undefined) capacity.isActive = input.isActive as boolean;
      capacity.updatedBy = actor._id;
      await capacity.save({ session });
      await audit(session, { facilityId, actorId: actor._id, action: ManagedReservationAction.QUOTA_CONFIGURED,
        details: { sellableCapacityM3: capacity.sellableCapacityM3, holdDurationMinutes: capacity.holdDurationMinutes, isActive: capacity.isActive } });
      return capacity;
    });
  }
  static async getCapacity(facilityIdInput: unknown, query: unknown, actor: Actor) {
    const facilityId = id(facilityIdInput, 'facilityId');
    if ([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) assertFacilityScope(actor, facilityId);
    else if (![UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_STAFF, UserRole.CUSTOMER].includes(actor.role)) fail(403, 'Forbidden');
    const input = object(query, ['startDate', 'endDate'], 'query');
    const startDate = utc(input.startDate, 'startDate'), endDate = utc(input.endDate, 'endDate');
    if (endDate <= startDate) fail(400, 'endDate must be later than startDate');
    const facility = await FacilityModel.findOne({ _id: facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).exec();
    if (!facility) fail(404, 'Active Managed Inventory Facility not found');
    const capacity = await ManagedFacilityCapacityModel.findOne({ facilityId, isActive: true }).lean().exec();
    if (!capacity) fail(404, 'Managed capacity configuration not found');
    const rows = await readCommitments(facilityId, startDate, endDate);
    const committedPeakCapacityM3 = peakCapacity(rows, startDate, endDate);
    const unresolvedOverdueObligationM3 = rows.filter((row: any) => isUnresolvedOverdue(row))
      .reduce((sum: number, row: any) => sum + (Number.isFinite(Number(row.allocatedCapacity)) ? Number(row.allocatedCapacity) : 0), 0);
    return { facilityId, sellableCapacityM3: capacity.sellableCapacityM3, committedPeakCapacityM3,
      unresolvedOverdueObligationM3, availableCapacityM3: Math.max(0, capacity.sellableCapacityM3 - committedPeakCapacityM3), interval: { startDate, endDate } };
  }
  static async get(idInput: unknown, actor: Actor) {
    const reservationId = id(idInput, 'reservationId');
    const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY }).exec();
    if (!reservation) fail(404, 'Managed reservation not found');
    if (actor.role === UserRole.CUSTOMER) { if (!reservation.customerId.equals(actor._id)) fail(404, 'Managed reservation not found'); }
    else { requireManagement(actor); assertFacilityScope(actor, reservation.facilityId); }
    return reservation;
  }
  static async approve(idInput: unknown, actor: Actor) {
    if (![UserRole.FACILITY_MANAGER, UserRole.ADMIN].includes(actor.role)) fail(403, 'Facility Manager or Admin required');
    const reservationId = id(idInput, 'reservationId');
    return withTransaction(async session => {
      const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $nin: [2, 3] }, status: ReservationStatus.RESERVED, expiresAt: { $gt: new Date() } }).session(session).exec();
      if (!reservation) fail(409, 'Managed reservation is missing, expired or not RESERVED');
      assertFacilityScope(actor, reservation.facilityId);
      const facility = await FacilityModel.findOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE,
        serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).session(session).exec();
      const profile = await CustomerProfileModel.findOne({ userId: reservation.customerId }).session(session).exec();
      const user = await UserModel.findById(reservation.customerId).session(session).exec();
      if (!facility || !profile || profile.verificationStatus !== VerificationStatus.VERIFIED) fail(409, 'Verified customer and active Managed Facility are required');
      if (await ContractModel.exists({ reservationId }).session(session).exec()) fail(409, 'Contract already exists for this reservation');
      reservation.status = ReservationStatus.CONTRACTED; reservation.approvedBy = actor._id; reservation.approvedAt = new Date();
      reservation.statusHistory.push({ status: ReservationStatus.CONTRACTED, actorId: actor._id, reason: 'Managed quota approved; draft contract created', createdAt: new Date() } as any);
      await reservation.save({ session });
      const snapshot = reservation.managedPricingSnapshot ?? {};
      const contract = new ContractModel({
        contractCode: `CTR-${reservation.reservationCode}`, reservationId: reservation._id, customerId: reservation.customerId,
        customerSnapshot: { identityCard: profile.identityCard, address: profile.address, taxCode: profile.taxCode, fullName: user?.displayName, email: user?.email, phone: user?.phone },
        pricingSnapshot: snapshot,
      });
      await contract.save({ session });
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.APPROVED, fromStatus: ReservationStatus.RESERVED, toStatus: ReservationStatus.CONTRACTED,
        details: { contractId: contract._id } });
      return { reservation, contract };
    });
  }
  static async reject(idInput: unknown, body: unknown, actor: Actor) {
    if (![UserRole.FACILITY_MANAGER, UserRole.ADMIN].includes(actor.role)) fail(403, 'Facility Manager or Admin required');
    const input = object(body, ['reason'], 'rejection');
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500) fail(400, 'A rejection reason is required');
    const reason = (input.reason as string).trim();
    const reservationId = id(idInput, 'reservationId');
    const initial = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY }).select('facilityId').exec();
    if (!initial) fail(404, 'Managed reservation not found'); assertFacilityScope(actor, initial.facilityId);
    return withTransaction(async session => {
      await lockCapacity(initial.facilityId, session, false);
      const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $nin: [2, 3] }, status: ReservationStatus.RESERVED }).session(session).exec();
      if (!reservation) fail(409, 'Only RESERVED Managed reservations can be rejected');
      reservation.status = ReservationStatus.CANCELLED; reservation.rejectReason = reason;
      reservation.statusHistory.push({ status: ReservationStatus.CANCELLED, actorId: actor._id, reason: `Managed reservation rejected: ${reason}`, createdAt: new Date() } as any);
      await reservation.save({ session });
      await releaseReservationCells(reservation._id, session);
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.REJECTED, fromStatus: ReservationStatus.RESERVED, toStatus: ReservationStatus.CANCELLED, details: { reason } });
      return reservation;
    });
  }
  static async cancel(idInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Customer role required');
    const reservationId = id(idInput, 'reservationId');
    const initial = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id, serviceType: FacilityServiceType.MANAGED_INVENTORY }).select('facilityId').exec();
    if (!initial) fail(404, 'Managed reservation not found');
    return withTransaction(async session => {
      await lockCapacity(initial.facilityId, session, false);
      const reservation = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id, serviceType: FacilityServiceType.MANAGED_INVENTORY, status: { $in: [ReservationStatus.RESERVED, ReservationStatus.CONTRACTED] } }).session(session).exec();
      if (!reservation) fail(409, 'Only unpaid RESERVED or CONTRACTED Managed reservations can be cancelled');
      const fromStatus = reservation.status;
      reservation.status = ReservationStatus.CANCELLED;
      reservation.statusHistory.push({ status: ReservationStatus.CANCELLED, actorId: actor._id, reason: 'Customer cancelled Managed quota reservation', createdAt: new Date() } as any);
      await reservation.save({ session });
      await releaseReservationCells(reservation._id, session);
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.CANCELLED, fromStatus, toStatus: ReservationStatus.CANCELLED });
      return reservation;
    });
  }
  static async mockPay(idInput: unknown, actor: Actor) {
    if (process.env.NODE_ENV === 'production' || process.env.MI_MOCK_PAYMENT_ENABLED !== 'true') fail(404, 'Mock payment is disabled');
    const reservationId = id(idInput, 'reservationId');
    return withTransaction(async session => {
      const contract = await ContractModel.findOne({ reservationId }).session(session).exec();
      if (!contract || contract.status !== ContractStatus.SIGNED || !contract.signedByCustomerAt) fail(409, 'Customer-signed contract required before payment');
      if (actor.role === UserRole.CUSTOMER) { if (!contract.customerId.equals(actor._id)) fail(404, 'Managed reservation not found'); }
      else if (![UserRole.ADMIN, UserRole.BOM].includes(actor.role)) fail(403, 'Reservation owner or authorized test role required');
      const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $nin: [2, 3] }, customerId: contract.customerId, status: ReservationStatus.CONTRACTED, expiresAt: { $gt: new Date() } }).session(session).exec();
      if (!reservation) fail(409, 'Only a valid held CONTRACTED reservation can receive mock payment');
      reservation.status = ReservationStatus.PAID; reservation.set('expiresAt', undefined);
      reservation.paymentSimulation = { simulated: true, provider: 'MOCK', paidAt: new Date(), actorId: actor._id };
      reservation.statusHistory.push({ status: ReservationStatus.PAID, actorId: actor._id, reason: 'SIMULATED DEVELOPMENT MOCK PAYMENT; NO REAL PAYMENT PROVIDER', createdAt: new Date() } as any);
      await reservation.save({ session });
      await CellAllocationModel.updateMany({ reservationId: reservation._id, status: CellAllocationStatus.HOLD },
        { $set: { status: CellAllocationStatus.RESERVED }, $unset: { holdExpiresAt: 1 } }, { session }).exec();
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.MOCK_PAYMENT, fromStatus: ReservationStatus.CONTRACTED, toStatus: ReservationStatus.PAID, details: { simulated: true, provider: 'MOCK' } });
      return reservation;
    });
  }
  static async initiateDeposit(idInput: unknown, body: unknown, actor: Actor) {
    if (!managedDepositFlowEnabled()) fail(404, 'Managed deposit flow is disabled');
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Customer role required');
    const reservationId = id(idInput, 'reservationId');
    const input = object(body, ['idempotencyKey'], 'deposit request');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.trim().length > 160) fail(400, 'Valid idempotencyKey required');
    const idempotencyKey = input.idempotencyKey.trim();
    const initial = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 2 }).select('facilityId').exec();
    if (!initial) fail(404, 'Managed reservation not found');
    return withTransaction(async session => {
      await lockCapacity(initial.facilityId, session, false);
      const reservation = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 2, status: ReservationStatus.RESERVED, expiresAt: { $gt: new Date() } }).session(session).exec();
      if (!reservation) fail(409, 'Managed reservation is missing, expired or not awaiting its deposit');
      const currency = String((reservation.managedPricingSnapshot as any)?.pricingRule?.currency ?? '');
      if (currency !== 'VND') fail(409, 'Managed deposit flow currently requires VND pricing');
      const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent, depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
      const amount = breakdown.depositCredit;
      if (amount <= 0) fail(409, 'A positive deposit payment is required');
      const identity = { reservationId: String(reservation._id), purpose: PaymentPurpose.DEPOSIT, amount, currency, idempotencyKey };
      const existing = await ReservationPaymentModel.findOne({ idempotencyKey }).session(session).exec();
      if (existing) {
        try { assertIdempotentPaymentMatch({ reservationId: String(existing.reservationId), purpose: existing.purpose, amount: existing.amount, currency: existing.currency, idempotencyKey: existing.idempotencyKey }, identity); } catch (error) { if (error instanceof PaymentAccountingError) fail(error.status, error.message); throw error; }
        if (!existing.customerId.equals(actor._id) || !existing.facilityId.equals(reservation.facilityId) || existing.serviceType !== FacilityServiceType.MANAGED_INVENTORY || existing.provider !== PaymentProvider.MOCK) fail(409, 'Idempotency key belongs to a different payment');
        return { payment: existing, reservationId: reservation._id, amount, currency, idempotent: true };
      }
      const payment = new ReservationPaymentModel({ ...identity, customerId: actor._id, facilityId: reservation.facilityId,
        providerReference: `MOCK-DEPOSIT-${new Types.ObjectId().toString()}`,
        serviceType: FacilityServiceType.MANAGED_INVENTORY, provider: PaymentProvider.MOCK, status: PaymentStatus.PENDING });
      await payment.save({ session });
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.DEPOSIT_INITIATED, fromStatus: ReservationStatus.RESERVED, toStatus: ReservationStatus.RESERVED,
        details: { paymentId: payment._id, purpose: PaymentPurpose.DEPOSIT, amount, currency, simulatedProvider: PaymentProvider.MOCK } });
      return { payment, reservationId: reservation._id, amount, currency, idempotent: false };
    });
  }
  static async confirmMockDeposit(idInput: unknown, body: unknown, actor: Actor) {
    if (!managedDepositFlowEnabled()) fail(404, 'Managed deposit flow is disabled');
    if (actor.role !== UserRole.CUSTOMER) fail(403, 'Customer role required');
    const reservationId = id(idInput, 'reservationId');
    const input = object(body, ['idempotencyKey'], 'deposit confirmation');
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.trim().length > 160) fail(400, 'Valid idempotencyKey required');
    const idempotencyKey = input.idempotencyKey.trim();
    const initial = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 2 }).select('facilityId').exec();
    if (!initial) fail(404, 'Managed reservation not found');
    return withTransaction(async session => {
      await lockCapacity(initial.facilityId, session, false);
      const reservation = await ReservationModel.findOne({ _id: reservationId, customerId: actor._id, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 2 }).session(session).exec();
      if (!reservation) fail(404, 'Managed reservation not found');
      const payment = await ReservationPaymentModel.findOne({ idempotencyKey }).session(session).exec();
      if (!payment || !payment.reservationId.equals(reservation._id) || !payment.customerId.equals(actor._id)) fail(404, 'Deposit payment not found');
      if (payment.purpose !== PaymentPurpose.DEPOSIT || payment.provider !== PaymentProvider.MOCK || payment.serviceType !== FacilityServiceType.MANAGED_INVENTORY) fail(409, 'Payment is not a Managed deposit');
      const currency = String((reservation.managedPricingSnapshot as any)?.pricingRule?.currency ?? '');
      const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent, depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
      if (currency !== 'VND' || payment.currency !== currency || payment.amount !== breakdown.depositCredit || payment.amount > breakdown.totalDue) fail(409, 'Deposit amount or purpose does not match the reservation');
      if (payment.status === PaymentStatus.SUCCEEDED && reservation.status === ReservationStatus.DEPOSIT_PAID) return { payment, reservation, idempotent: true };
      if (payment.status !== PaymentStatus.PENDING) fail(409, 'Deposit payment is not pending');
      const now = new Date();
      if (reservation.status !== ReservationStatus.RESERVED || !reservation.expiresAt || reservation.expiresAt <= now) {
        payment.status = transitionPaymentStatus(payment.status, PaymentStatus.RECONCILIATION_REQUIRED).status;
        payment.reconciliationReason = 'Mock deposit confirmation arrived after the temporary reservation hold expired or changed';
        await payment.save({ session });
        await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
          action: ManagedReservationAction.PAYMENT_RECONCILIATION_REQUIRED, fromStatus: reservation.status, toStatus: reservation.status,
          details: { paymentId: payment._id, purpose: PaymentPurpose.DEPOSIT, reason: payment.reconciliationReason } });
        return { payment, reservation, idempotent: false, reconciliationRequired: true };
      }
      const allocationFilter = { reservationId: reservation._id, customerId: actor._id, status: CellAllocationStatus.HOLD, holdExpiresAt: { $gt: now } };
      const allocationCount = await CellAllocationModel.countDocuments(allocationFilter).session(session).exec();
      if (!reservation.allocatedCellIds?.length || allocationCount !== reservation.allocatedCellIds.length) fail(409, 'Temporary Cell allocations are no longer valid');
      const transition = await CellAllocationModel.updateMany(allocationFilter,
        { $set: { status: CellAllocationStatus.RESERVED }, $unset: { holdExpiresAt: 1 } }, { session }).exec();
      if (transition.matchedCount !== reservation.allocatedCellIds.length) fail(409, 'Temporary Cell allocations changed; retry');
      payment.status = transitionPaymentStatus(payment.status, PaymentStatus.SUCCEEDED).status; payment.succeededAt = now;
      await payment.save({ session });
      reservation.status = ReservationStatus.DEPOSIT_PAID; reservation.set('expiresAt', undefined);
      reservation.statusHistory.push({ status: ReservationStatus.DEPOSIT_PAID, actorId: actor._id, reason: 'Development mock advance-rent deposit confirmed; no contract or physical occupancy created', createdAt: now } as any);
      await reservation.save({ session });
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.DEPOSIT_CONFIRMED, fromStatus: ReservationStatus.RESERVED, toStatus: ReservationStatus.DEPOSIT_PAID,
        details: { paymentId: payment._id, purpose: PaymentPurpose.DEPOSIT, amount: payment.amount, currency, allocations: transition.matchedCount, simulated: true } });
      return { payment, reservation, idempotent: false };
    });
  }
  static async activate(idInput: unknown, actor: Actor) {
    if (![UserRole.FACILITY_MANAGER, UserRole.ADMIN].includes(actor.role)) fail(403, 'Facility Manager or Admin required');
    const reservationId = id(idInput, 'reservationId');
    return withTransaction(async session => {
      const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: { $ne: 3 }, status: ReservationStatus.PAID }).session(session).exec();
      if (!reservation) fail(409, 'Only a PAID Managed reservation can be activated');
      assertFacilityScope(actor, reservation.facilityId);
      const now = new Date();
      if (reservation.startDate > now || reservation.endDate <= now || !reservation.allocatedCapacity || reservation.allocatedCapacity <= 0) fail(409, 'Managed rental interval or quota is not currently valid');
      const contract = await ContractModel.findOne({ reservationId }).session(session).exec();
      if (!contract || contract.status !== ContractStatus.SIGNED || !contract.signedByCustomerAt) fail(409, 'Signed contract required before activation');
      const facility = await FacilityModel.findOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE, serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).session(session).exec();
      if (!facility) fail(409, 'Managed Facility is not active');
      reservation.status = ReservationStatus.ACTIVE;
      reservation.statusHistory.push({ status: ReservationStatus.ACTIVE, actorId: actor._id, reason: 'Managed quota activated; selected Cells remain allocated and physical occupancy awaits Staff-confirmed inbound', createdAt: new Date() } as any);
      await reservation.save({ session });
      await audit(session, { facilityId: reservation.facilityId, reservationId: reservation._id, actorId: actor._id,
        action: ManagedReservationAction.ACTIVATED, fromStatus: ReservationStatus.PAID, toStatus: ReservationStatus.ACTIVE, details: { selectedCellsRemainAllocated: true, physicalOccupancyRecorded: false } });
      return reservation;
    });
  }

  static async confirmHandover(idInput: unknown, body: unknown, actor: Actor) {
    if (![UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(actor.role)) fail(403, 'Assigned Facility Staff or Manager required');
    const reservationId = id(idInput, 'reservationId');
    const input = object(body, ['storageCondition', 'accessNotes'], 'handover confirmation');
    if (!['GOOD', 'MINOR_DAMAGE', 'UNSAFE'].includes(String(input.storageCondition))) fail(400, 'storageCondition must be GOOD, MINOR_DAMAGE or UNSAFE');
    if (input.storageCondition === 'UNSAFE') fail(409, 'Unsafe Cell handover cannot activate the rental');
    if (typeof input.accessNotes !== 'string' || !input.accessNotes.trim() || input.accessNotes.length > 1000) fail(400, 'accessNotes are required and must not exceed 1000 characters');
    return withTransaction(async session => {
      const reservation = await ReservationModel.findOne({ _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
        bookingFlowVersion: 3, status: { $in: [ReservationStatus.PAID, ReservationStatus.CHECKIN_READY, ReservationStatus.ACTIVE] } }).session(session).exec();
      if (!reservation) fail(409, 'Managed V3 handover requires a PAID reservation');
      if (reservation.rentalPaymentFlow !== 'FULL_UPFRONT_V1') fail(409, 'Managed V3 handover requires the full upfront rental payment flow');
      if (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(reservation.facilityId)) fail(403, 'Facility is outside assigned scope');
      if (reservation.status === ReservationStatus.ACTIVE && reservation.handoverAt) return reservation;
      const now = new Date();
      if (reservation.startDate > now || reservation.endDate <= now || !reservation.allocatedCellIds?.length) fail(409, 'Managed V3 rental dates and Cells must be confirmed before handover');
      const fullPayment = reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && reservation.fullPaymentId ? await ReservationPaymentModel.findOne({ _id: reservation.fullPaymentId,
        reservationId, customerId: reservation.customerId, facilityId: reservation.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
        purpose: PaymentPurpose.FULL_RENT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
        providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED }).session(session).exec() : null;
      const managedTotalDue = Number((reservation.managedPricingSnapshot as any)?.amountBreakdown?.totalDue ?? reservation.estimatedRent);
      if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && fullPayment && fullPayment.amount !== managedTotalDue) fail(409, 'Full-rent amount does not match the immutable Managed pricing snapshot');
      if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && (!fullPayment || reservation.status !== ReservationStatus.CHECKIN_READY)) fail(409, 'Verified full-rent payment and verified contract are required before handover');
      const contract = await ContractModel.findOne({ reservationId, customerId: reservation.customerId }).session(session).exec();
      const active = contract?.contentVersions?.find(version => version.version === contract.currentContentVersion);
      const signatures = (contract?.signatures ?? []).filter(signature => signature.version === active?.version && signature.contentHash === active?.contentHash);
      if (!contract || contract.status !== ContractStatus.SIGNED || (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && (!contract.signedProofPublicId || !contract.verifiedAt)) || !active ||
          (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1' && createHash('sha256').update(JSON.stringify(active.content)).digest('hex') !== active.contentHash) ||
          !signatures.some(signature => signature.signerRole === UserRole.CUSTOMER) ||
          !signatures.some(signature => [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER].includes(signature.signerRole as UserRole))) fail(409, 'Both parties must sign the current Managed V3 contract before handover');
      if (reservation.status !== ReservationStatus.CHECKIN_READY) fail(409, 'Full-rent Managed V3 contract must be verified before handover');
      const allocationCount = await CellAllocationModel.countDocuments({ reservationId, customerId: reservation.customerId,
        facilityId: reservation.facilityId, cellId: { $in: reservation.allocatedCellIds }, status: CellAllocationStatus.RESERVED }).session(session).exec();
      if (allocationCount !== reservation.allocatedCellIds.length) fail(409, 'Every allocated Cell must remain reserved for this rental');
      const facility = await FacilityModel.findOne({ _id: reservation.facilityId, status: FacilityStatus.ACTIVE,
        serviceTypes: FacilityServiceType.MANAGED_INVENTORY, deletedAt: { $exists: false } }).session(session).exec();
      if (!facility) fail(409, 'Managed Facility is not active');
      const previousStatus = reservation.status;
      reservation.status = ReservationStatus.ACTIVE;
      reservation.handoverByStaffId = actor._id;
      reservation.handoverAt = now;
      reservation.storageCondition = String(input.storageCondition);
      reservation.handoverAccessNotes = (input.accessNotes as string).trim();
      reservation.statusHistory.push({ status: ReservationStatus.ACTIVE, actorId: actor._id,
        reason: 'Facility Staff confirmed Managed V3 access handover; physical inbound remains separate', createdAt: now } as any);
      await reservation.save({ session });
      await audit(session, { facilityId: reservation.facilityId, reservationId, actorId: actor._id,
        action: ManagedReservationAction.HANDOVER_CONFIRMED, fromStatus: previousStatus, toStatus: ReservationStatus.ACTIVE,
        details: { storageCondition: reservation.storageCondition, accessNotes: reservation.handoverAccessNotes,
          allocatedCellIds: reservation.allocatedCellIds.map(String), firstInboundRequired: true } });
      return reservation;
    });
  }
}
