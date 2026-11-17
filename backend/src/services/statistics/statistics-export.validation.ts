import { StatisticsQueryError, parseStatisticsQuery, StatisticsQuery } from './statistics.validation';
import { StatisticsScope, StatisticsService } from './statistics.service';
import { IUser } from '../../types/user.type';
import { MaintenanceStatus } from '../../types/maintenance-ticket.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';

export const STATISTICS_EXPORT_REPORTS = [
  'facilities-kpi', 'revenue', 'financial-analytics', 'managed-operations', 'storage-capacity',
  'managed-capacity', 'reservations', 'contracts-lifecycle', 'incidents',
] as const;
export type StatisticsExportReportType = typeof STATISTICS_EXPORT_REPORTS[number];
export type StatisticsExportFormat = 'csv' | 'xlsx' | 'pdf';
export interface StatisticsExportRequest { reportType: StatisticsExportReportType; query: StatisticsQuery; scope: StatisticsScope }

const BASE_FILTERS = new Set(['fromDate', 'toDate', 'facilityId']);
const REPORT_FILTERS: Record<StatisticsExportReportType, string[]> = {
  'facilities-kpi': ['serviceType', 'sortBy', 'sortOrder', 'expiringWithinDays'],
  revenue: ['serviceType', 'granularity', 'comparePrevious'],
  'financial-analytics': ['serviceType', 'granularity', 'comparePrevious', 'paymentStatus'],
  'managed-operations': ['serviceType', 'granularity', 'action', 'skuId', 'itemSpecId', 'reservationId'],
  'storage-capacity': ['unitSize', 'status'],
  'managed-capacity': [],
  reservations: ['serviceType', 'granularity', 'unitSize'],
  'contracts-lifecycle': ['serviceType', 'unitSize', 'expiringWithinDays'],
  incidents: ['granularity', 'status'],
};
const SNAPSHOT_REPORTS = new Set<StatisticsExportReportType>(['storage-capacity', 'managed-capacity']);
const STATUS_FILTERS: Partial<Record<StatisticsExportReportType, readonly string[]>> = {
  'storage-capacity': Object.values(StorageUnitStatus),
  incidents: Object.values(MaintenanceStatus),
};

export function parseStatisticsExportRequestValue(input: Record<string, unknown>) {
  const reportValue = input.reportType;
  if (Array.isArray(reportValue)) throw new StatisticsQueryError(400, 'INVALID_REPORT_TYPE', 'reportType must be provided once');
  if (typeof reportValue !== 'string' || !STATISTICS_EXPORT_REPORTS.includes(reportValue as StatisticsExportReportType)) {
    throw new StatisticsQueryError(400, 'UNSUPPORTED_REPORT_TYPE', `reportType must be one of: ${STATISTICS_EXPORT_REPORTS.join(', ')}`);
  }
  const reportType = reportValue as StatisticsExportReportType;
  if (input.page !== undefined || input.limit !== undefined) {
    throw new StatisticsQueryError(400, 'EXPORT_PAGINATION_UNSUPPORTED', 'Export returns a bounded complete report; page/limit are not accepted. Narrow the report filters if it exceeds the export cap.');
  }
  if (SNAPSHOT_REPORTS.has(reportType) && (input.fromDate !== undefined || input.toDate !== undefined)) {
    throw new StatisticsQueryError(400, 'SNAPSHOT_DATE_FILTER_UNSUPPORTED', `${reportType} is a current snapshot and does not accept fromDate/toDate filters`);
  }
  const allowed = new Set([...BASE_FILTERS, ...REPORT_FILTERS[reportType]]);
  const unsupported = Object.keys(input).find(key => key !== 'reportType' && !allowed.has(key));
  if (unsupported) throw new StatisticsQueryError(400, 'UNSUPPORTED_REPORT_FILTER', `${unsupported} is not supported for ${reportType}`);
  if (input.status !== undefined) {
    if (Array.isArray(input.status)) throw new StatisticsQueryError(400, 'INVALID_STATUS', 'status must be provided once');
    if (reportType === 'reservations' || reportType === 'contracts-lifecycle') {
      throw new StatisticsQueryError(400, 'UNSUPPORTED_STATUS_FILTER', `status filtering is not supported for ${reportType}; narrow by date, Facility, serviceType, or unitSize`);
    }
    if (!STATUS_FILTERS[reportType]?.includes(String(input.status))) {
      throw new StatisticsQueryError(400, 'UNSUPPORTED_STATUS_FILTER', `status is not supported for ${reportType}`);
    }
  }
  if (input.paymentStatus !== undefined && (reportType !== 'financial-analytics' || input.paymentStatus !== 'SUCCEEDED')) {
    throw new StatisticsQueryError(400, 'UNSUPPORTED_PAYMENT_STATUS_FILTER', 'financial-analytics exports only verified successful PayOS captures; paymentStatus must be SUCCEEDED');
  }
  const queryInput = { ...input };
  delete queryInput.reportType;
  return { reportType, queryInput };
}

export async function resolveStatisticsExportRequest(user: IUser, input: Record<string, unknown>): Promise<StatisticsExportRequest> {
  const { reportType, queryInput } = parseStatisticsExportRequestValue(input);
  const resolved = await StatisticsService.resolveScope(user, queryInput);
  return { reportType, ...resolved };
}
