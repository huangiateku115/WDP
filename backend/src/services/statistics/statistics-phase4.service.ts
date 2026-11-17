import { Document, Model, PipelineStage } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ContractModel from '../../models/contracts/contract.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import MaintenanceTicketModel from '../../models/maintenance-tickets/maintenance-ticket.model';
import { MaintenanceStatus } from '../../types/maintenance-ticket.type';
import { FacilityServiceType } from '../../types/facility.type';
import { PaymentStatus } from '../../types/payment.type';
import { ReservationStatus } from '../../types/reservation.type';
import { StatisticsScope, StatisticsService, verifiedCapturePipeline } from './statistics.service';
import { StatisticsQuery } from './statistics.validation';
import { StatisticsPhase2Service } from './statistics-phase2.service';
import { StatisticsPhase3Service } from './statistics-phase3.service';
import { ContractStatus } from '../../types/contract.type';
import { StorageUnitSize, StorageUnitStatus } from '../../types/storage-unit.type';
import { MovementBatchAction } from '../../types/item-movement.type';
import { UserRole } from '../../types/user.type';

type Row = Record<string, any>;
const LIVE = { deletedAt: { $exists: false } };
function scopeMatch(scope: StatisticsScope): Row { return scope.type === 'FACILITY' ? { facilityId: scope.facilityId } : {}; }
function run<T extends Document>(model: Model<T>, pipeline: PipelineStage[]) { return model.aggregate<Row>(pipeline).option({ maxTimeMS: 15_000, allowDiskUse: true }).exec(); }
function num(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function id(value: unknown) { return value == null ? '' : String(value); }
export function summarizeFacilityManagedOperations(rows: Row[], facilityIds: string[]) {
  const byFacility = new Map<string, Row>(facilityIds.map(facilityId => [facilityId, {
    inboundOperations: 0, outboundOperations: 0, relocationOperations: 0,
    totalCommittedOperations: 0, weightByAction: { ADD: 0, REMOVE: 0, MOVE: 0 }, volumeByAction: { ADD: 0, REMOVE: 0, MOVE: 0 },
  }]));
  for (const row of rows) {
    const facilityId = id(row.facilityId), summary = byFacility.get(facilityId);
    if (!summary) continue;
    const action = String(row.action ?? '').toUpperCase();
    const count = num(row.operationCount);
    if (action === 'ADD') summary.inboundOperations += count;
    else if (action === 'REMOVE') summary.outboundOperations += count;
    else if (action === 'MOVE') summary.relocationOperations += count;
    else continue;
    summary.totalCommittedOperations += count;
    summary.weightByAction[action] += num(row.weightKg);
    summary.volumeByAction[action] += num(row.volumeM3);
  }
  return byFacility;
}

export class StatisticsPhase4Service {
  static async filters(user: Parameters<typeof StatisticsService.resolveScope>[0], input: Record<string, unknown>) {
    const { scope } = await StatisticsService.resolveScope(user, input);
    const facilities = await FacilityModel.find({ ...LIVE, ...(scope.type === 'FACILITY' ? { _id: scope.facilityId } : {}) })
      .select('_id code name serviceTypes').sort({ code: 1 }).lean().exec();
    return { success: true, data: {
      facilities: facilities.map(row => ({ id: id(row._id), code: row.code, name: row.name, serviceTypes: row.serviceTypes })),
      serviceTypes: Object.values(FacilityServiceType), reservationStatuses: Object.values(ReservationStatus), contractStatuses: Object.values(ContractStatus),
      storageUnitSizes: Object.values(StorageUnitSize), storageUnitStatuses: Object.values(StorageUnitStatus), paymentStatuses: Object.values(PaymentStatus),
      granularities: ['day', 'week', 'month'], movementActions: Object.values(MovementBatchAction),
      facilityKpiSortFields: ['facilityCode', 'facilityName', 'reservationCount', 'uniqueCustomers', 'collectedAmount', 'openIncidents', 'activeContracts', 'expiringContracts', 'storageOccupancyRate', 'managedVolumeUtilizationRate', 'managedWeightUtilizationRate'],
    }, meta: { facilityScope: scope.type === 'ALL' ? { type: 'ALL' } : { type: 'FACILITY', facilityId: scope.facilityId.toString() } } };
  }

  static async facilitiesKpi(query: StatisticsQuery, scope: StatisticsScope) {
    const allowedSort = new Set(['facilityCode','facilityName','reservationCount','uniqueCustomers','collectedAmount','openIncidents','activeContracts','expiringContracts','storageOccupancyRate','managedVolumeUtilizationRate','managedWeightUtilizationRate']);
    const sortBy = query.sortBy ?? 'facilityCode';
    if (!allowedSort.has(sortBy)) throw Object.assign(new Error('sortBy is not supported for facilities-kpi'), { status: 400, code: 'INVALID_SORT' });
    const serviceQuery = { ...query };
    delete serviceQuery.status;
    delete serviceQuery.serviceType;
    const now = new Date();
    const expiringAt = new Date(now.getTime() + (query.expiringWithinDays ?? 30) * 86_400_000);
    const [facilities, reservationRows, captureRows, incidents, contracts, storage, managed, operations] = await Promise.all([
      FacilityModel.find({ ...LIVE, ...(scope.type === 'FACILITY' ? { _id: scope.facilityId } : {}) }).select('_id code name serviceTypes').lean().exec(),
      run(ReservationModel, [ { $match: { ...scopeMatch(scope), ...(query.serviceType ? { serviceType: query.serviceType } : {}), createdAt: { $gte: query.from, $lt: query.toExclusive } } },
        { $group: { _id: '$facilityId', reservations: { $sum: 1 }, customers: { $addToSet: '$customerId' } } } ]),
      run(ReservationPaymentModel, [
        ...verifiedCapturePipeline(query, scope),
        { $group: { _id: '$facilityId', collected: { $sum: '$captureAmount' } } },
      ]),
      run(MaintenanceTicketModel, [ { $match: { ...LIVE, ...scopeMatch(scope), status: { $in: [MaintenanceStatus.OPEN, MaintenanceStatus.ASSIGNED, MaintenanceStatus.IN_PROGRESS] } } }, { $group: { _id: '$facilityId', count: { $sum: 1 } } } ]),
      run(ContractModel, [
        { $match: { ...LIVE, status: ContractStatus.SIGNED } },
        { $lookup: { from: 'reservations', localField: 'reservationId', foreignField: '_id', as: '_reservation' } }, { $unwind: '$_reservation' },
        { $match: { ...(scope.type === 'FACILITY' ? { '_reservation.facilityId': scope.facilityId } : {}), ...(query.serviceType ? { '_reservation.serviceType': query.serviceType } : {}), '_reservation.status': { $in: [ReservationStatus.ACTIVE, ReservationStatus.OVERDUE] } } },
        { $set: { _signatureRoles: { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } },
          _customerSigned: { $or: [ { $eq: [{ $type: '$signedByCustomerAt' }, 'date'] }, { $in: [UserRole.CUSTOMER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] },
          _facilitySigned: { $or: [ { $eq: [{ $type: '$signedByFMAt' }, 'date'] }, { $eq: [{ $type: '$verifiedAt' }, 'date'] }, { $in: [UserRole.FACILITY_STAFF, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $in: [UserRole.FACILITY_MANAGER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] },
          _bothSignersPresent: { $and: [ { $in: [UserRole.CUSTOMER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $or: [ { $in: [UserRole.FACILITY_STAFF, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] }, { $in: [UserRole.FACILITY_MANAGER, { $map: { input: { $ifNull: ['$signatures', []] }, as: 'signature', in: '$$signature.signerRole' } }] } ] } ] },
        } },
        { $set: { _isSigned: { $and: [{ $eq: ['$status', ContractStatus.SIGNED] }, { $or: ['$_bothSignersPresent', { $and: ['$_customerSigned', { $eq: [{ $type: '$verifiedAt' }, 'date'] }, { $eq: [{ $type: '$signedProofPublicId' }, 'string'] }] }] }] },
          _expiring: { $and: [{ $gte: ['$_reservation.endDate', now] }, { $lte: ['$_reservation.endDate', expiringAt] }] } } },
        { $match: { _isSigned: true } },
        { $group: { _id: '$_reservation.facilityId', active: { $sum: 1 }, expiring: { $sum: { $cond: ['$_expiring', 1, 0] } } } },
      ]),
      StatisticsPhase2Service.storageCapacity(serviceQuery, scope),
      StatisticsPhase2Service.managedCapacity(serviceQuery, scope),
      StatisticsPhase3Service.managedOperations(serviceQuery, scope),
    ]);
    const reservations = new Map(reservationRows.map(row => [id(row._id), row]));
    const collections = new Map(captureRows.map(row => [id(row._id), num(row.collected)]));
    const openIncidents = new Map(incidents.map(row => [id(row._id), num(row.count)]));
    const contractCounts = new Map(contracts.map(row => [id(row._id), row]));
    const selfStorage = new Map(storage.data.capacityByFacility.map((row: Row) => [id(row.facilityId), row]));
    const managedCapacity = new Map(managed.data.capacityByFacility.map((row: Row) => [id(row.facilityId), row]));
    const movements = summarizeFacilityManagedOperations(operations.data.operationsByFacility, facilities.map(row => id(row._id)));
    const rows = facilities.map(facility => {
      const facilityId = id(facility._id), reservation = reservations.get(facilityId), storageRow = selfStorage.get(facilityId) as Row | undefined;
      const managedRow = managedCapacity.get(facilityId) as Row | undefined;
      return { facilityId, facilityCode: facility.code, facilityName: facility.name, serviceTypes: facility.serviceTypes,
        reservationCount: num(reservation?.reservations), uniqueCustomers: Array.isArray(reservation?.customers) ? reservation.customers.length : 0,
        collectedAmount: collections.get(facilityId) ?? 0, openIncidents: openIncidents.get(facilityId) ?? 0,
        activeContracts: num(contractCounts.get(facilityId)?.active), expiringContracts: num(contractCounts.get(facilityId)?.expiring),
        storageOccupancyRate: storageRow?.occupancyRate ?? null,
        managedVolumeUtilizationRate: managedRow?.volumeUtilizationRate ?? null,
        managedWeightUtilizationRate: managedRow?.weightUtilizationRate ?? null,
        managedCapacityReconciliationStatus: managedRow?.reconciliationStatus ?? 'UNKNOWN',
        managedOperations: movements.get(facilityId) ?? { inboundOperations: 0, outboundOperations: 0, relocationOperations: 0, totalCommittedOperations: 0, weightByAction: { ADD: 0, REMOVE: 0, MOVE: 0 }, volumeByAction: { ADD: 0, REMOVE: 0, MOVE: 0 } },
      };
    });
    rows.sort((a, b) => {
      const av = (a as Row)[sortBy], bv = (b as Row)[sortBy];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return cmp * (query.sortBy ? query.sortOrder : 1) || a.facilityCode.localeCompare(b.facilityCode);
    });
    const offset = (query.page - 1) * query.limit;
    return { success: true, data: { items: rows.slice(offset, offset + query.limit), page: query.page, limit: query.limit, total: rows.length, totalPages: Math.ceil(rows.length / query.limit) },
      meta: { facilityScope: scope.type === 'ALL' ? { type: 'ALL' } : { type: 'FACILITY', facilityId: scope.facilityId.toString() },
        period: { fromDate: query.from.toISOString(), toDateExclusive: query.toExclusive.toISOString() }, timezone: 'Asia/Ho_Chi_Minh',
        timeBasis: { reservationCount: 'Reservation.createdAt', uniqueCustomers: 'distinct Reservation.customerId in period', collectedAmount: 'verified PayOS capture transactionDateTime deduplicated by eventHash', openIncidents: 'current open MaintenanceTicket snapshot', capacity: 'current snapshot', contracts: 'current signed Contract evidence joined to ACTIVE/OVERDUE Reservation; expiring window from now' },
        dataCompleteness: { managedCapacity: managed.meta.dataCompleteness, activeContracts: 'current signed evidence', expiringContracts: 'current signed evidence' },
        limitations: ['Collected amount includes only verified successful PayOS captures; refunds and net cash flow are not represented.'] } };
  }
}
