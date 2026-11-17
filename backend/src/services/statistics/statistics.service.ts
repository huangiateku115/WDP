import mongoose, { PipelineStage, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { FacilityServiceType } from '../../types/facility.type';
import { PaymentApplicationStatus, PaymentPurpose, PaymentProvider, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { IUser, UserRole } from '../../types/user.type';
import { parseStatisticsQuery, STATISTICS_TIME_ZONE, StatisticsQuery, StatisticsQueryError } from './statistics.validation';

type QueryInput = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
export type StatisticsScope = { type: 'ALL' } | { type: 'FACILITY'; facilityId: Types.ObjectId };
type Scope = StatisticsScope;
const PAYMENT_DATE_FORMAT = '%Y-%m-%d %H:%M:%S';
const SUPPORTED_SERVICES = Object.values(FacilityServiceType);
const PAID_PURPOSES = [PaymentPurpose.FULL_RENT, PaymentPurpose.BALANCE, PaymentPurpose.DEPOSIT];

export class StatisticsServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

function asRecord(value: unknown): JsonRecord { return value && typeof value === 'object' ? value as JsonRecord : {}; }
function asNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function amount(value: number): number { return Math.round(value * 100) / 100; }
function matchFacility(scope: Scope): JsonRecord {
  return scope.type === 'FACILITY' ? { facilityId: scope.facilityId } : {};
}

function paymentScopeMatch(query: StatisticsQuery, scope: Scope, from = query.from, to = query.toExclusive): JsonRecord {
  return {
    provider: PaymentProvider.PAYOS,
    status: PaymentStatus.SUCCEEDED,
    providerSettlementStatus: ProviderSettlementStatus.VERIFIED,
    applicationStatus: { $ne: PaymentApplicationStatus.MANUAL_REVIEW },
    currency: 'VND',
    ...matchFacility(scope),
    ...(query.serviceType ? { serviceType: query.serviceType } : {}),
    _captures: { $exists: true },
    _periodStart: from,
    _periodEnd: to,
  };
}

export function verifiedCapturePipeline(query: StatisticsQuery, scope: StatisticsScope, from = query.from, to = query.toExclusive): PipelineStage[] {
  const base: JsonRecord = {
    provider: PaymentProvider.PAYOS,
    status: PaymentStatus.SUCCEEDED,
    providerSettlementStatus: ProviderSettlementStatus.VERIFIED,
    applicationStatus: { $ne: PaymentApplicationStatus.MANUAL_REVIEW },
    currency: 'VND',
    ...matchFacility(scope),
    ...(query.serviceType ? { serviceType: query.serviceType } : {}),
  };
  return [
    { $match: base },
    { $unwind: '$providerCaptures' },
    { $set: { _captureDate: { $dateFromString: { dateString: '$providerCaptures.transactionDateTime', format: PAYMENT_DATE_FORMAT, timezone: STATISTICS_TIME_ZONE, onError: null, onNull: null } } } },
    { $match: { _captureDate: { $gte: from, $lt: to }, 'providerCaptures.amount': { $gt: 0 }, 'providerCaptures.currency': 'VND', 'providerCaptures.eventHash': { $type: 'string' } } },
    // Event hash is the identity used by the webhook idempotency path. Group first to guard legacy duplicates.
    { $group: { _id: '$providerCaptures.eventHash', paymentId: { $first: '$_id' }, reservationId: { $first: '$reservationId' }, customerId: { $first: '$customerId' }, facilityId: { $first: '$facilityId' }, serviceType: { $first: '$serviceType' }, purpose: { $first: '$purpose' }, captureAmount: { $first: '$providerCaptures.amount' }, captureDate: { $first: '$_captureDate' } } },
  ];
}

const capturePipeline = verifiedCapturePipeline;

function paidReservationPipeline(query: StatisticsQuery, scope: Scope, from = query.from, to = query.toExclusive): PipelineStage[] {
  return [
    ...capturePipeline(query, scope, from, to),
    { $match: { purpose: { $in: PAID_PURPOSES } } },
    { $lookup: { from: 'reservations', localField: 'reservationId', foreignField: '_id', as: 'reservation' } },
    { $unwind: '$reservation' },
    // DEPOSIT alone is not full payment. The only deposit-only exception is zero-balance Managed V3 settlement.
    { $match: { $or: [
      { purpose: { $in: [PaymentPurpose.FULL_RENT, PaymentPurpose.BALANCE] } },
      { purpose: PaymentPurpose.DEPOSIT, 'reservation.serviceType': FacilityServiceType.MANAGED_INVENTORY, 'reservation.bookingFlowVersion': 3, 'reservation.balanceSettledAt': { $type: 'date' } },
    ] } },
  ];
}

function periodForPrevious(query: StatisticsQuery): { from: Date; to: Date } {
  const duration = query.toExclusive.getTime() - query.from.getTime();
  return { from: new Date(query.from.getTime() - duration), to: query.from };
}

function bucketExpression(granularity: 'day' | 'week' | 'month'): JsonRecord {
  return { $dateTrunc: { date: '$_captureDate', unit: granularity, ...(granularity === 'week' ? { startOfWeek: 'monday' } : {}), timezone: STATISTICS_TIME_ZONE } };
}

function makeMeta(query: StatisticsQuery, scope: Scope, generatedAt: Date, completeness: JsonRecord = {}): JsonRecord {
  return {
    period: { fromDate: query.from.toISOString(), toDateExclusive: query.toExclusive.toISOString() },
    timezone: STATISTICS_TIME_ZONE,
    facilityScope: scope.type === 'ALL' ? { type: 'ALL' } : { type: 'FACILITY', facilityId: scope.facilityId.toString() },
    timeBasis: { reservations: 'createdAt', collectedPayment: 'providerCaptures.transactionDateTime', uniqueCustomers: 'qualifying verified payment capture time', currentInventory: 'current snapshot' },
    generatedAt: generatedAt.toISOString(), dataCompleteness: completeness,
  };
}

function emptyPaidTotals() { return { reservationCount: 0, customerCount: 0, selfStorageCount: 0, managedInventoryCount: 0 }; }

export class StatisticsService {
  static async resolveScope(user: IUser, input: QueryInput): Promise<{ query: StatisticsQuery; scope: Scope }> {
    if (![UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER].includes(user.role)) {
      throw new StatisticsServiceError(403, 'STATISTICS_FORBIDDEN', 'This role cannot access Statistics APIs');
    }
    const query = parseStatisticsQuery(input);
    if (user.role === UserRole.FACILITY_MANAGER) {
      if (query.facilityId && (!user.assignedFacilityId || !query.facilityId.equals(user.assignedFacilityId))) {
        throw new StatisticsServiceError(403, 'FACILITY_SCOPE_FORBIDDEN', 'Requested Facility is outside the authenticated Manager scope');
      }
      if (!user.assignedFacilityId || !Types.ObjectId.isValid(user.assignedFacilityId)) {
        throw new StatisticsServiceError(403, 'FACILITY_ASSIGNMENT_REQUIRED', 'Facility Manager must have a valid assigned Facility');
      }
      const facility = await FacilityModel.findOne({ _id: user.assignedFacilityId, deletedAt: { $exists: false } }).select('_id').lean().exec();
      if (!facility) throw new StatisticsServiceError(403, 'FACILITY_ASSIGNMENT_INVALID', 'Assigned Facility is unavailable');
      return { query, scope: { type: 'FACILITY', facilityId: user.assignedFacilityId } };
    }
    return { query, scope: query.facilityId ? { type: 'FACILITY', facilityId: query.facilityId } : { type: 'ALL' } };
  }

  static async overview(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const facilityCount = await FacilityModel.countDocuments({ deletedAt: { $exists: false }, ...(scope.type === 'FACILITY' ? { _id: scope.facilityId } : {}) });
    const reservationMatch = { ...matchFacility(scope), ...(query.serviceType ? { serviceType: query.serviceType } : {}), createdAt: { $gte: query.from, $lt: query.toExclusive } };
    const [reservationTotals, statusRows] = await Promise.all([
      ReservationModel.aggregate([{ $match: reservationMatch }, { $group: { _id: null, count: { $sum: 1 }, selfStorage: { $sum: { $cond: [{ $eq: ['$serviceType', FacilityServiceType.SELF_STORAGE] }, 1, 0] } }, managed: { $sum: { $cond: [{ $eq: ['$serviceType', FacilityServiceType.MANAGED_INVENTORY] }, 1, 0] } } } }]),
      ReservationModel.aggregate([{ $match: reservationMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ]);
    const paidRows = await ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: null, reservations: { $addToSet: '$reservationId' }, customers: { $addToSet: '$customerId' }, selfStorage: { $addToSet: { $cond: [{ $eq: ['$serviceType', FacilityServiceType.SELF_STORAGE] }, '$reservationId', null] } }, managed: { $addToSet: { $cond: [{ $eq: ['$serviceType', FacilityServiceType.MANAGED_INVENTORY] }, '$reservationId', null] } } } }]);
    const paid = asRecord(paidRows[0]);
    const reservationsSet = Array.isArray(paid.reservations) ? paid.reservations.filter(Boolean) : [];
    const customersSet = Array.isArray(paid.customers) ? paid.customers.filter(Boolean) : [];
    const serviceSetCount = (key: string) => Array.isArray(paid[key]) ? (paid[key] as unknown[]).filter(Boolean).length : 0;
    const revenue = await this.revenueTotals(query, scope);
    let previous: JsonRecord | null = null;
    if (query.comparePrevious) {
      const prior = periodForPrevious(query);
      const [priorReservations, priorPaid, priorRevenue] = await Promise.all([
        ReservationModel.countDocuments({ ...matchFacility(scope), ...(query.serviceType ? { serviceType: query.serviceType } : {}), createdAt: { $gte: prior.from, $lt: prior.to } }),
        ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope, prior.from, prior.to), { $group: { _id: null, reservations: { $addToSet: '$reservationId' } } }]),
        this.revenueTotals(query, scope, prior.from, prior.to),
      ]);
      previous = { reservationCount: priorReservations, paidReservationCount: Array.isArray(priorPaid[0]?.reservations) ? priorPaid[0].reservations.length : 0, collectedAmount: priorRevenue.collectedAmount };
    }
    return {
      success: true,
      data: {
        facilityCount,
        reservationCount: asNumber(asRecord(reservationTotals[0]).count),
        paidReservationCount: reservationsSet.length,
        uniquePaidCustomers: customersSet.length,
        collectedAmount: revenue.collectedAmount,
        reservationByService: { SELF_STORAGE: asNumber(asRecord(reservationTotals[0]).selfStorage), MANAGED_INVENTORY: asNumber(asRecord(reservationTotals[0]).managed) },
        paidReservationByService: { SELF_STORAGE: serviceSetCount('selfStorage'), MANAGED_INVENTORY: serviceSetCount('managed') },
        reservationByStatus: Object.fromEntries(statusRows.map(row => [String(row._id), asNumber(row.count)])),
        ...(previous ? { previousPeriod: previous } : {}),
      },
      meta: makeMeta(query, scope, generatedAt, { historicalReservationStatus: 'unavailable; status breakdown is current status of reservations created in period', refunds: 'unavailable', recognizedRevenue: 'unavailable' }),
    };
  }

  private static async revenueTotals(query: StatisticsQuery, scope: Scope, from = query.from, to = query.toExclusive) {
    const rows = await ReservationPaymentModel.aggregate([...capturePipeline(query, scope, from, to), { $group: { _id: null, collectedAmount: { $sum: '$captureAmount' }, eventCount: { $sum: 1 }, paymentIds: { $addToSet: '$paymentId' } } }]);
    const row = asRecord(rows[0]);
    return { collectedAmount: amount(asNumber(row.collectedAmount)), captureCount: asNumber(row.eventCount), paymentCount: Array.isArray(row.paymentIds) ? row.paymentIds.length : 0 };
  }

  static async revenue(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const [totals, facilityRows, serviceRows, purposeRows, trendRows] = await Promise.all([
      this.revenueTotals(query, scope),
      ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $group: { _id: '$facilityId', collectedAmount: { $sum: '$captureAmount' }, paymentIds: { $addToSet: '$paymentId' } } }, { $sort: { collectedAmount: -1, _id: 1 } }]),
      ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $group: { _id: '$serviceType', collectedAmount: { $sum: '$captureAmount' }, paymentIds: { $addToSet: '$paymentId' } } }, { $sort: { _id: 1 } }]),
      ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $group: { _id: '$purpose', collectedAmount: { $sum: '$captureAmount' }, paymentIds: { $addToSet: '$paymentId' } } }, { $sort: { _id: 1 } }]),
      ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $group: { _id: bucketExpression(query.granularity ?? 'day'), collectedAmount: { $sum: '$captureAmount' }, captureCount: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    ]);
    let previousPeriodCollected: number | null = null;
    let growthPercent: number | null = null;
    if (query.comparePrevious) {
      const prior = periodForPrevious(query);
      previousPeriodCollected = (await this.revenueTotals(query, scope, prior.from, prior.to)).collectedAmount;
      growthPercent = previousPeriodCollected === 0 ? (totals.collectedAmount === 0 ? 0 : null) : amount((totals.collectedAmount - previousPeriodCollected) / previousPeriodCollected * 100);
    }
    return {
      success: true,
      data: {
        ...totals,
        collectedByFacility: facilityRows.map(row => ({ facilityId: String(row._id), collectedAmount: amount(asNumber(row.collectedAmount)), paymentCount: Array.isArray(row.paymentIds) ? row.paymentIds.length : 0 })),
        collectedByService: serviceRows.map(row => ({ serviceType: row._id, collectedAmount: amount(asNumber(row.collectedAmount)), paymentCount: Array.isArray(row.paymentIds) ? row.paymentIds.length : 0 })),
        collectedByPurpose: purposeRows.map(row => ({ purpose: row._id, collectedAmount: amount(asNumber(row.collectedAmount)), paymentCount: Array.isArray(row.paymentIds) ? row.paymentIds.length : 0 })),
        collectedTrend: trendRows.map(row => ({ bucketStart: row._id, collectedAmount: amount(asNumber(row.collectedAmount)), captureCount: asNumber(row.captureCount) })),
        refundedAmount: null, netCashFlow: null, recognizedRevenue: null,
        financialDataStatus: 'PARTIAL', financialDataReason: 'Refund ledger and revenue-recognition source are not implemented in the audited backend.',
        ...(query.comparePrevious ? { previousPeriodCollected, growthPercent } : {}),
      },
      meta: makeMeta(query, scope, generatedAt, { collectedAmount: 'PayOS verified captures only; captures are deduplicated by eventHash', refundedAmount: 'unavailable', netCashFlow: 'unavailable', recognizedRevenue: 'unavailable' }),
    };
  }

  static async facilitiesRanking(query: StatisticsQuery, scope: Scope) {
    const sortBy = query.sortBy ?? 'collectedAmount';
    const allowedSort = new Set(['uniqueCustomers', 'paidReservationCount', 'collectedAmount', 'reservationCount']);
    if (!allowedSort.has(sortBy)) throw new StatisticsQueryError(400, 'INVALID_SORT', 'sortBy must be uniqueCustomers, paidReservationCount, collectedAmount, or reservationCount');
    const generatedAt = new Date();
    const facilities = await FacilityModel.find({ deletedAt: { $exists: false }, ...(scope.type === 'FACILITY' ? { _id: scope.facilityId } : {}), ...(query.serviceType ? { serviceTypes: query.serviceType } : {}) }).select('_id code name serviceTypes').lean().exec();
    const [reservations, paid, collected] = await Promise.all([
      ReservationModel.aggregate([{ $match: { ...matchFacility(scope), ...(query.serviceType ? { serviceType: query.serviceType } : {}), createdAt: { $gte: query.from, $lt: query.toExclusive } } }, { $group: { _id: '$facilityId', reservationCount: { $sum: 1 } } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: '$facilityId', reservationIds: { $addToSet: '$reservationId' }, customerIds: { $addToSet: '$customerId' } } }]),
      ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $group: { _id: '$facilityId', collectedAmount: { $sum: '$captureAmount' } } }]),
    ]);
    const indexed = (rows: JsonRecord[]) => new Map(rows.map(row => [String(row._id), row]));
    const rMap = indexed(reservations), pMap = indexed(paid), cMap = indexed(collected);
    const values = facilities.map(facility => {
      const id = String(facility._id), r = asRecord(rMap.get(id)), p = asRecord(pMap.get(id)), c = asRecord(cMap.get(id));
      const reservationCount = asNumber(r.reservationCount);
      const paidReservationCount = Array.isArray(p.reservationIds) ? p.reservationIds.length : 0;
      const uniqueCustomers = Array.isArray(p.customerIds) ? p.customerIds.length : 0;
      const collectedAmount = amount(asNumber(c.collectedAmount));
      return { facilityId: id, code: facility.code, name: facility.name, serviceTypes: facility.serviceTypes, reservationCount, paidReservationCount, uniqueCustomers, collectedAmount };
    });
    const sortValue = (row: JsonRecord) => asNumber(row[sortBy]);
    values.sort((a, b) => query.sortOrder * (sortValue(a) - sortValue(b)) || String(a.facilityId).localeCompare(String(b.facilityId)));
    const total = values.length, offset = (query.page - 1) * query.limit;
    return { success: true, data: { items: values.slice(offset, offset + query.limit), total, page: query.page, limit: query.limit, sortBy, sortOrder: query.sortOrder === 1 ? 'asc' : 'desc' }, meta: makeMeta(query, scope, generatedAt, { historicalReservationStatus: 'unavailable; reservation counts use current reservation documents created in period' }) };
  }

  static async customers(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const [periodRows, facilityRows, serviceRows, trendRows, priorRows] = await Promise.all([
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: null, customerIds: { $addToSet: '$customerId' } } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: '$facilityId', customerIds: { $addToSet: '$customerId' } } }, { $sort: { _id: 1 } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: '$serviceType', customerIds: { $addToSet: '$customerId' } } }, { $sort: { _id: 1 } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: bucketExpression(query.granularity ?? 'day'), customerIds: { $addToSet: '$customerId' } } }, { $sort: { _id: 1 } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope, new Date(0), query.from), { $group: { _id: '$customerId' } }]),
    ]);
    const currentIds: unknown[] = Array.isArray(periodRows[0]?.customerIds) ? periodRows[0].customerIds : [];
    const priorIds = new Set((priorRows as Array<{ _id: Types.ObjectId }>).map(row => String(row._id)));
    const newCustomers = currentIds.filter(id => !priorIds.has(String(id))).length;
    const returningCustomers = currentIds.length - newCustomers;
    return {
      success: true,
      data: {
        uniqueCustomers: currentIds.length, newCustomers, returningCustomers,
        customersByFacility: facilityRows.map(row => ({ facilityId: String(row._id), uniqueCustomers: Array.isArray(row.customerIds) ? row.customerIds.length : 0 })),
        customersByService: serviceRows.map(row => ({ serviceType: row._id, uniqueCustomers: Array.isArray(row.customerIds) ? row.customerIds.length : 0 })),
        customerTrend: trendRows.map(row => ({ bucketStart: row._id, uniqueCustomers: Array.isArray(row.customerIds) ? row.customerIds.length : 0 })),
      },
      meta: makeMeta(query, scope, generatedAt, { history: 'new/returning comparison uses verified completed-rental payment captures before fromDate; deposit-only history is excluded except Managed V3 zero-balance settlement where a current marker is present in period data' }),
    };
  }

  static async serviceMix(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const [reservationRows, paidRows, collectedRows, allCustomerRows] = await Promise.all([
      ReservationModel.aggregate([{ $match: { ...matchFacility(scope), ...(query.serviceType ? { serviceType: query.serviceType } : {}), createdAt: { $gte: query.from, $lt: query.toExclusive } } }, { $group: { _id: '$serviceType', reservationIds: { $addToSet: '$_id' }, customerIds: { $addToSet: '$customerId' } } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: '$serviceType', reservationIds: { $addToSet: '$reservationId' }, customerIds: { $addToSet: '$customerId' } } }]),
      ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $group: { _id: '$serviceType', collectedAmount: { $sum: '$captureAmount' } } }]),
      ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: '$customerId' } }, { $count: 'count' }]),
    ]);
    const byId = (rows: JsonRecord[]) => new Map(rows.map(row => [String(row._id), row]));
    const r = byId(reservationRows), p = byId(paidRows), c = byId(collectedRows);
    const items = (query.serviceType ? [query.serviceType] : SUPPORTED_SERVICES).map(serviceType => {
      const reservations = asRecord(r.get(serviceType)), paid = asRecord(p.get(serviceType)), collected = asRecord(c.get(serviceType));
      return { serviceType, reservationCount: Array.isArray(reservations.reservationIds) ? reservations.reservationIds.length : 0, paidReservationCount: Array.isArray(paid.reservationIds) ? paid.reservationIds.length : 0, uniqueCustomers: Array.isArray(paid.customerIds) ? paid.customerIds.length : 0, collectedAmount: amount(asNumber(collected.collectedAmount)) };
    });
    const reservationTotal = items.reduce((sum, row) => sum + row.reservationCount, 0), paidTotal = items.reduce((sum, row) => sum + row.paidReservationCount, 0), customerTotal = asNumber(asRecord(allCustomerRows[0]).count), collectedTotal = items.reduce((sum, row) => sum + row.collectedAmount, 0);
    const metric = query.sortBy ?? 'paidReservationCount';
    if (!['uniqueCustomers', 'paidReservationCount', 'collectedAmount', 'reservationCount'].includes(metric)) throw new StatisticsQueryError(400, 'INVALID_SORT', 'sortBy is not a supported service mix metric');
    const metricTotal = metric === 'uniqueCustomers' ? customerTotal : metric === 'paidReservationCount' ? paidTotal : metric === 'reservationCount' ? reservationTotal : collectedTotal;
    for (const row of items) Object.assign(row, { reservationSharePercent: reservationTotal ? amount(row.reservationCount / reservationTotal * 100) : 0, paidReservationSharePercent: paidTotal ? amount(row.paidReservationCount / paidTotal * 100) : 0, uniqueCustomerPenetrationPercent: customerTotal ? amount(row.uniqueCustomers / customerTotal * 100) : 0, collectedAmountSharePercent: collectedTotal ? amount(row.collectedAmount / collectedTotal * 100) : 0 });
    const popular = [...items].sort((a, b) => Number(b[metric as keyof typeof b]) - Number(a[metric as keyof typeof a]) || a.serviceType.localeCompare(b.serviceType))[0] ?? null;
    return { success: true, data: { items, totals: { reservationCount: reservationTotal, paidReservationCount: paidTotal, uniqueCustomersAcrossServices: customerTotal, collectedAmount: amount(collectedTotal) }, popularService: popular ? { serviceType: popular.serviceType, metric, value: popular[metric as keyof typeof popular] } : null, metricDenominators: { reservationCount: reservationTotal, paidReservationCount: paidTotal, collectedAmount: amount(collectedTotal), uniqueCustomers: customerTotal, uniqueCustomerPenetration: 'per-service unique customers divided by all distinct paid customers; overlapping customers may make shares sum above 100%' } }, meta: makeMeta(query, scope, generatedAt, { uniqueCustomerTotal: 'distinct across the whole selected scope; not added from service totals' }) };
  }

  static async unitDemand(query: StatisticsQuery, scope: Scope) {
    if (query.serviceType && query.serviceType !== FacilityServiceType.SELF_STORAGE) throw new StatisticsQueryError(400, 'INVALID_SERVICE_TYPE', 'unit-demand supports SELF_STORAGE only');
    const generatedAt = new Date();
    const units = await StorageUnitModel.find({ deletedAt: { $exists: false }, ...(scope.type === 'FACILITY' ? { facilityId: scope.facilityId } : {}) }).select('_id size').lean().exec();
    const unitIds = units.map(unit => unit._id);
    const base = { ...matchFacility(scope), serviceType: FacilityServiceType.SELF_STORAGE, storageUnitId: { $in: unitIds }, createdAt: { $gte: query.from, $lt: query.toExclusive } };
    const reservations = unitIds.length ? await ReservationModel.aggregate([{ $match: base }, { $group: { _id: '$storageUnitId', reservationIds: { $addToSet: '$_id' }, customerIds: { $addToSet: '$customerId' } } }]) : [];
    const paid = unitIds.length ? await ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $match: { serviceType: FacilityServiceType.SELF_STORAGE } }, { $lookup: { from: 'reservations', localField: 'reservationId', foreignField: '_id', as: 'reservation' } }, { $unwind: '$reservation' }, { $match: { 'reservation.storageUnitId': { $in: unitIds } } }, { $group: { _id: '$reservation.storageUnitId', reservationIds: { $addToSet: '$reservationId' }, customerIds: { $addToSet: '$customerId' } } }]) : [];
    const collected = unitIds.length ? await ReservationPaymentModel.aggregate([...capturePipeline(query, scope), { $match: { serviceType: FacilityServiceType.SELF_STORAGE } }, { $lookup: { from: 'reservations', localField: 'reservationId', foreignField: '_id', as: 'reservation' } }, { $unwind: '$reservation' }, { $match: { 'reservation.storageUnitId': { $in: unitIds } } }, { $group: { _id: '$reservation.storageUnitId', collectedAmount: { $sum: '$captureAmount' } } }]) : [];
    const rMap = new Map(reservations.map(row => [String(row._id), row]));
    const pMap = new Map(paid.map(row => [String(row._id), row]));
    const cMap = new Map(collected.map(row => [String(row._id), row]));
    const grouped = new Map<string, { unitType: string; reservationCount: number; paidRentalCount: number; uniqueCustomers: Set<string>; uniquePhysicalUnits: Set<string>; collectedAmount: number }>();
    for (const unit of units) {
      const type = String(unit.size);
      const entry = grouped.get(type) ?? { unitType: type, reservationCount: 0, paidRentalCount: 0, uniqueCustomers: new Set<string>(), uniquePhysicalUnits: new Set<string>(), collectedAmount: 0 };
      const row = rMap.get(String(unit._id)); const paidRow = pMap.get(String(unit._id));
      entry.reservationCount += Array.isArray(row?.reservationIds) ? row.reservationIds.length : 0;
      entry.paidRentalCount += Array.isArray(paidRow?.reservationIds) ? paidRow.reservationIds.length : 0;
      for (const customerId of paidRow?.customerIds ?? []) entry.uniqueCustomers.add(String(customerId));
      if (entry.reservationCount || entry.paidRentalCount) entry.uniquePhysicalUnits.add(String(unit._id));
      entry.collectedAmount += asNumber(cMap.get(String(unit._id))?.collectedAmount);
      grouped.set(type, entry);
    }
    const items = [...grouped.values()].map(entry => ({ unitType: entry.unitType, reservationCount: entry.reservationCount, paidRentalCount: entry.paidRentalCount, uniqueCustomers: entry.uniqueCustomers.size, uniquePhysicalUnits: entry.uniquePhysicalUnits.size, collectedAmount: amount(entry.collectedAmount) })).sort((a, b) => b.paidRentalCount - a.paidRentalCount || a.unitType.localeCompare(b.unitType));
    const totalPaid = items.reduce((n, item) => n + item.paidRentalCount, 0), totalReservations = items.reduce((n, item) => n + item.reservationCount, 0), totalCollected = items.reduce((n, item) => n + item.collectedAmount, 0);
    const popular = items[0] ?? null;
    return { success: true, data: { items: items.map(item => ({ ...item, paidRentalSharePercent: totalPaid ? amount(item.paidRentalCount / totalPaid * 100) : 0 })), totals: { reservationCount: totalReservations, paidRentalCount: totalPaid, collectedAmount: amount(totalCollected) }, mostPopularUnitType: popular ? { unitType: popular.unitType, paidRentalCount: popular.paidRentalCount } : null }, meta: makeMeta(query, scope, generatedAt, { historicalUnitType: 'current StorageUnit.size joined to reservation; accuracy is limited where a unit size changed after the historical reservation', reservationCount: 'reservation count by createdAt', paidRentalCount: 'qualifying payment capture counted against reservation-created period' }) };
  }

  static async rentalTrends(query: StatisticsQuery, scope: Scope) {
    const generatedAt = new Date();
    const granularity = query.granularity ?? 'day';
    const reservationRows = await ReservationModel.aggregate([
      { $match: { ...matchFacility(scope), ...(query.serviceType ? { serviceType: query.serviceType } : {}), createdAt: { $gte: query.from, $lt: query.toExclusive } } },
      { $group: { _id: { bucket: { $dateTrunc: { date: '$createdAt', unit: granularity, ...(granularity === 'week' ? { startOfWeek: 'monday' } : {}), timezone: STATISTICS_TIME_ZONE } }, serviceType: '$serviceType' }, count: { $sum: 1 } } },
      { $sort: { '_id.bucket': 1 } },
    ]);
    const paidRows = await ReservationPaymentModel.aggregate([...paidReservationPipeline(query, scope), { $group: { _id: { bucket: bucketExpression(granularity), serviceType: '$serviceType' }, reservationIds: { $addToSet: '$reservationId' }, customerIds: { $addToSet: '$customerId' } } }, { $sort: { '_id.bucket': 1 } }]);
    const buckets = new Map<number, { reservationCount: number; paidReservationCount: number; paidSelfStorageCount: number; paidManagedInventoryCount: number; customers: Set<string> }>();
    const getBucket = (date: Date) => {
      const time = date.getTime();
      let value = buckets.get(time);
      if (!value) { value = { reservationCount: 0, paidReservationCount: 0, paidSelfStorageCount: 0, paidManagedInventoryCount: 0, customers: new Set() }; buckets.set(time, value); }
      return value;
    };
    for (const row of reservationRows) {
      const id = asRecord(row._id), bucket = getBucket(new Date(id.bucket as string | number | Date));
      const count = asNumber(row.count);
      bucket.reservationCount += count;
    }
    for (const row of paidRows) {
      const id = asRecord(row._id), bucket = getBucket(new Date(id.bucket as string | number | Date));
      const count = Array.isArray(row.reservationIds) ? row.reservationIds.length : 0;
      bucket.paidReservationCount += count;
      if (id.serviceType === FacilityServiceType.SELF_STORAGE) bucket.paidSelfStorageCount += count;
      if (id.serviceType === FacilityServiceType.MANAGED_INVENTORY) bucket.paidManagedInventoryCount += count;
      for (const customerId of Array.isArray(row.customerIds) ? row.customerIds : []) bucket.customers.add(String(customerId));
    }
    // Add empty calendar buckets; results are capped by the validated date range.
    const cursor = new Date(query.from);
    const end = query.toExclusive.getTime();
    while (cursor.getTime() < end) {
      let bucketDate: Date;
      if (granularity === 'day') bucketDate = new Date(cursor);
      else if (granularity === 'week') {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: STATISTICS_TIME_ZONE, weekday: 'short' }).format(cursor);
        const delta = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[p] ?? 0;
        bucketDate = new Date(cursor.getTime() - delta * 86_400_000);
      } else {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: STATISTICS_TIME_ZONE, year: 'numeric', month: 'numeric' }).formatToParts(cursor);
        const year = Number(parts.find(part => part.type === 'year')?.value), month = Number(parts.find(part => part.type === 'month')?.value);
        bucketDate = new Date(Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000);
      }
      getBucket(bucketDate);
      cursor.setTime(bucketDate.getTime());
      if (granularity === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
      else if (granularity === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const trends = [...buckets.entries()].sort(([a], [b]) => a - b).map(([time, values]) => ({ bucketStart: new Date(time).toISOString(), reservationCount: values.reservationCount, paidReservationCount: values.paidReservationCount, paidSelfStorageRentalCount: values.paidSelfStorageCount, paidManagedInventoryRentalCount: values.paidManagedInventoryCount, uniquePaidCustomers: values.customers.size }));
    return { success: true, data: { granularity, items: trends }, meta: makeMeta(query, scope, generatedAt, { reservationStatusHistory: 'not used; reservation trends use createdAt', paidRental: 'verified payment capture transaction time; deposit alone excluded except Managed V3 zero-balance current marker' }) };
  }
}

export type StatisticsActor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
