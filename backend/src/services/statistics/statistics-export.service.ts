import FacilityModel from '../../models/facilities/facility.model';
import { StatisticsScope, StatisticsService } from './statistics.service';
import { StatisticsExportDocument, StatisticsExportRenderLimitError, makeStatisticsExportDocument, serializeCsv, serializePdf, serializeXlsx } from './statistics-export.renderers';
import { resolveStatisticsExportRequest, StatisticsExportFormat, StatisticsExportReportType } from './statistics-export.validation';
import { StatisticsPhase2Service } from './statistics-phase2.service';
import { StatisticsPhase3Service } from './statistics-phase3.service';
import { StatisticsPhase4Service } from './statistics-phase4.service';
import { StatisticsQuery } from './statistics.validation';
import { IUser } from '../../types/user.type';
import { localDateKey } from './statistics.validation';

const MAX_EXPORT_ROWS = 1_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_DURATION_MS = 25_000;
const MAX_CONCURRENT_EXPORTS = 2;
const INTERNAL_PAGE_LIMIT = 100;
const LIVE = { deletedAt: { $exists: false } };
let activeExports = 0;

export class StatisticsExportError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export interface StatisticsExportDownload { buffer: Buffer; contentType: string; filename: string; document: StatisticsExportDocument }

export class StatisticsExportService {
  static async resolveRequest(user: IUser, input: Record<string, unknown>) { return resolveStatisticsExportRequest(user, input); }

  static async collectReport(reportType: StatisticsExportReportType, query: StatisticsQuery, scope: StatisticsScope) {
    const boundedQuery = { ...query, page: 1, limit: INTERNAL_PAGE_LIMIT };
    let result: any;
    switch (reportType) {
      case 'facilities-kpi': result = await StatisticsPhase4Service.facilitiesKpi(boundedQuery, scope); break;
      case 'revenue': result = await StatisticsService.revenue(query, scope); break;
      case 'financial-analytics': result = await StatisticsPhase3Service.financialAnalytics(query, scope); break;
      case 'managed-operations': result = await StatisticsPhase3Service.managedOperations(boundedQuery, scope); break;
      case 'storage-capacity': result = await StatisticsPhase2Service.storageCapacity(query, scope); break;
      case 'managed-capacity': result = await StatisticsPhase2Service.managedCapacity(query, scope); break;
      case 'reservations': result = await StatisticsPhase2Service.reservations(query, scope); break;
      case 'contracts-lifecycle': result = await StatisticsPhase2Service.contractsLifecycle(query, scope); break;
      case 'incidents': result = await StatisticsPhase3Service.incidents(query, scope); break;
      default: throw new StatisticsExportError(400, 'UNSUPPORTED_REPORT_TYPE', 'The requested Statistics export report is not supported');
    }
    this.assertCompleteServicePage(reportType, result);
    return result;
  }

  private static assertCompleteServicePage(reportType: StatisticsExportReportType, result: any) {
    const data = result?.data ?? {};
    if (reportType === 'facilities-kpi' && Number(data.total) > (Array.isArray(data.items) ? data.items.length : 0)) {
      throw new StatisticsExportError(413, 'EXPORT_ROW_LIMIT_EXCEEDED', `Facility KPI report exceeds ${INTERNAL_PAGE_LIMIT} Facilities. Narrow the Facility scope or use smaller Facility groups.`);
    }
    if (reportType === 'managed-operations') {
      const total = Number(data.operationsByItemSpecificationPagination?.total ?? 0);
      const returned = Array.isArray(data.operationsByItemSpecification) ? data.operationsByItemSpecification.length : 0;
      if (total > returned) throw new StatisticsExportError(413, 'EXPORT_ROW_LIMIT_EXCEEDED', `Managed Operations has more than ${INTERNAL_PAGE_LIMIT} Item Specification rows. Narrow the date, Facility, SKU, Item Specification, Reservation, or action filters.`);
    }
  }

  static async buildDocument(reportType: StatisticsExportReportType, result: any, scope: StatisticsScope, exportedAt = new Date()) {
    let scopeLabel = 'Toàn hệ thống';
    if (scope.type === 'FACILITY') {
      const facility = await FacilityModel.findOne({ _id: scope.facilityId, ...LIVE }).select('code name').lean().exec();
      scopeLabel = facility ? `${facility.code} — ${facility.name}` : `Facility ${scope.facilityId.toString()}`;
    }
    let doc: StatisticsExportDocument;
    try { doc = makeStatisticsExportDocument(reportType, result, scopeLabel, exportedAt); }
    catch (error) {
      if (error instanceof StatisticsExportRenderLimitError) {
        throw new StatisticsExportError(413, 'EXPORT_ROW_LIMIT_EXCEEDED', `Report exceeds the ${MAX_EXPORT_ROWS}-row or nesting limit. Narrow the date or Facility filters.`);
      }
      throw error;
    }
    if (doc.rows.length > MAX_EXPORT_ROWS) throw new StatisticsExportError(413, 'EXPORT_ROW_LIMIT_EXCEEDED', `Report exceeds ${MAX_EXPORT_ROWS} export rows. Narrow the date or Facility filters.`);
    return doc;
  }

  static async export(user: IUser, input: Record<string, unknown>, format: StatisticsExportFormat): Promise<StatisticsExportDownload> {
    if (activeExports >= MAX_CONCURRENT_EXPORTS) throw new StatisticsExportError(429, 'EXPORT_BUSY', 'Export capacity is busy. Retry shortly.');
    activeExports += 1;
    let timer: NodeJS.Timeout | undefined;
    let releaseWhenWorkEnds = false;
    const release = () => { activeExports = Math.max(0, activeExports - 1); };
    const task = (async () => {
      const resolved = await this.resolveRequest(user, input);
      const report = await this.collectReport(resolved.reportType, resolved.query, resolved.scope);
      const document = await this.buildDocument(resolved.reportType, report, resolved.scope);
      const buffer = format === 'csv' ? serializeCsv(document) : format === 'xlsx' ? serializeXlsx(document) : await serializePdf(document);
      if (buffer.length > MAX_FILE_BYTES) throw new StatisticsExportError(413, 'EXPORT_FILE_SIZE_LIMIT_EXCEEDED', `Export exceeds ${MAX_FILE_BYTES} bytes. Narrow the date or Facility filters.`);
      return { buffer, contentType: MIME_TYPES[format], filename: `vaultspace-statistics-${resolved.reportType}-${localDateKey(new Date())}.${format}`, document };
    })();
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StatisticsExportError(503, 'EXPORT_TIMEOUT', 'Export exceeded the processing time limit. Narrow the date or Facility filters and try again.')), MAX_EXPORT_DURATION_MS);
        timer.unref();
      });
      return await Promise.race([task, timeout]);
    } catch (error) {
      if (error instanceof StatisticsExportError && error.code === 'EXPORT_TIMEOUT') {
        releaseWhenWorkEnds = true;
        void task.then(release, release);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (!releaseWhenWorkEnds) release();
    }
  }
}

export const MIME_TYPES: Record<StatisticsExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
