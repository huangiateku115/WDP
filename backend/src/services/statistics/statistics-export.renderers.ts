import * as XLSX from 'xlsx';
import path from 'node:path';

export const UNVERIFIED_VALUE = 'Không có dữ liệu xác minh';
export class StatisticsExportRenderLimitError extends Error {}
export const STATISTICS_EXPORT_COLUMNS = ['Nhóm', 'Chỉ số', 'Chi tiết', 'Giá trị', 'Đơn vị'] as const;
const STATISTICS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export type ExportRow = { section: string; metric: string; detail: string; value: unknown; unit: string };
export interface StatisticsExportDocument {
  reportType: string;
  title: string;
  scopeLabel: string;
  periodLabel: string;
  snapshotAt: string | null;
  exportedAt: string;
  rows: ExportRow[];
  information: Array<{ key: string; value: unknown }>;
  limitations: string[];
}

const LABELS: Record<string, string> = {
  facilityId: 'Facility ID', facilityCode: 'Mã Facility', facilityName: 'Tên Facility', serviceType: 'Loại dịch vụ',
  collectedAmount: 'Tiền đã thu', grossCollectedAmount: 'Tổng tiền đã thu', refundedAmount: 'Tiền hoàn', netCashFlow: 'Dòng tiền ròng',
  recognizedRevenue: 'Doanh thu ghi nhận', captureCount: 'Số capture', verifiedCaptureCount: 'Số capture đã xác minh',
  reservationCount: 'Số Reservation', totalReservations: 'Tổng Reservation', paidReservations: 'Reservation đã thanh toán',
  uniqueCustomers: 'Khách hàng duy nhất', totalCells: 'Tổng Cell', availableCells: 'Cell còn trống', reservedCells: 'Cell đã giữ',
  allocatedCells: 'Cell đã phân bổ', nonAvailableCells: 'Cell không khả dụng', capacityWeightKg: 'Sức chứa trọng lượng', usedWeightKg: 'Trọng lượng đang dùng',
  capacityVolumeM3: 'Sức chứa thể tích', usedVolumeM3: 'Thể tích đang dùng', weightUtilizationRate: 'Tỷ lệ sử dụng trọng lượng',
  volumeUtilizationRate: 'Tỷ lệ sử dụng thể tích', occupancyRate: 'Tỷ lệ lấp đầy', openIncidents: 'Sự cố đang mở',
  activeContracts: 'Hợp đồng đang hiệu lực', expiringContracts: 'Hợp đồng sắp hết hạn', inboundOperations: 'Thao tác nhập',
  outboundOperations: 'Thao tác xuất', relocationOperations: 'Thao tác di chuyển', totalCommittedOperations: 'Tổng thao tác đã ghi nhận',
  snapshotAt: 'Thời điểm snapshot', generatedAt: 'Thời điểm tạo', fromDate: 'Từ ngày', toDateExclusive: 'Đến ngày (không gồm)',
  requestedPeriod: 'Khoảng thời gian yêu cầu', facilityScope: 'Phạm vi Facility', dataCompleteness: 'Mức độ đầy đủ dữ liệu',
  reconciliationStatus: 'Trạng thái đối soát', limitations: 'Giới hạn dữ liệu', timezone: 'Múi giờ', status: 'Trạng thái',
  action: 'Thao tác', quantity: 'Số lượng', quantityUnit: 'Đơn vị số lượng', amount: 'Số tiền', percentage: 'Tỷ lệ phần trăm',
};

function label(key: string): string { return LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase()); }
function vietnamCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: STATISTICS_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(date);
  const part = (type: string) => parts.find(entry => entry.type === type)?.value;
  const day = part('day'), month = part('month'), year = part('year');
  return day && month && year ? `${day}/${month}/${year}` : null;
}
function vietnamTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: STATISTICS_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
}
function normalizePeriod(meta: Record<string, any>) {
  const sources = [meta.period, meta.requestedPeriod, meta];
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    const hasFrom = source.fromDate !== undefined && source.fromDate !== null;
    const hasTo = source.toDateExclusive !== undefined && source.toDateExclusive !== null;
    if (hasFrom || hasTo) {
      return { fromDate: vietnamCalendarDate(source.fromDate), toDateExclusive: vietnamCalendarDate(source.toDateExclusive), inclusiveToDate: vietnamInclusivePeriodEnd(source.toDateExclusive) };
    }
  }
  return null;
}
function vietnamDateOnly(value: unknown, exclusiveEnd = false): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (exclusiveEnd) date.setTime(date.getTime() - 1);
  return vietnamCalendarDate(date);
}
function vietnamInclusivePeriodEnd(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const localCalendarDate = vietnamCalendarDate(date);
  if (!localCalendarDate) return null;
  const [dayText, monthText, yearText] = localCalendarDate.split('/');
  const day = Number(dayText), month = Number(monthText), year = Number(yearText);
  if (!year || !month || !day) return null;
  const boundary = new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
  return vietnamCalendarDate(date.getTime() === boundary.getTime() ? new Date(date.getTime() - 1) : date);
}
function isPlainObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date); }
function identityOf(value: Record<string, unknown>): string {
  const preferred = ['facilityCode', 'code', 'facilityId', 'serviceType', 'action', 'status', 'purpose', 'category', 'priority', 'unitSize', 'itemSpecId', 'reservationId', 'scope', 'quantityUnit'];
  for (const key of preferred) if (value[key] !== undefined && value[key] !== null) return `${label(key)}: ${String(value[key])}`;
  return '';
}
function inferUnit(path: string[]): string {
  const key = path.at(-1)?.toLowerCase() ?? '';
  if (/amount|cashflow|revenue|payment|vnd/.test(key)) return 'VND';
  if (/percent|rate|share|growth|penetration/.test(key)) return '%';
  if (/weight|kg/.test(key)) return 'kg';
  if (/volume|m3/.test(key)) return 'm³';
  if (/date|time|bucket|at$/.test(key)) return 'Ngày giờ';
  if (/count|total|units|cells|racks|facilities|contracts|reservations|customers|operations|items|payments|incidents|quantity/.test(key)) return 'Số lượng';
  return '';
}

export function flattenStatisticsData(value: unknown, maxRows = 1000): ExportRow[] {
  const rows: ExportRow[] = [];
  const visit = (item: unknown, path: string[], contexts: string[], depth: number): void => {
    if (depth > 14) throw new StatisticsExportRenderLimitError('Report data nesting exceeds the export safety limit');
    if (item === null || item === undefined || typeof item !== 'object' || item instanceof Date) {
      const key = path.at(-1) ?? 'data';
      rows.push({ section: label(path[0] ?? 'data'), metric: path.slice(1).map(label).join(' / ') || label(key), detail: contexts.join(' · '),
        value: item instanceof Date ? item.toISOString() : item, unit: inferUnit(path) });
      if (rows.length > maxRows) throw new StatisticsExportRenderLimitError(`Report exceeds the ${maxRows}-row export limit; narrow the date or Facility filters.`);
      return;
    }
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) {
        const child = item[index];
        const context = isPlainObject(child) ? identityOf(child) : '';
        visit(child, path, context ? [...contexts, context] : [...contexts, `Dòng ${index + 1}`], depth + 1);
        if (rows.length > maxRows) throw new StatisticsExportRenderLimitError(`Report exceeds the ${maxRows}-row export limit; narrow the date or Facility filters.`);
      }
      return;
    }
    for (const [key, child] of Object.entries(item)) visit(child, [...path, key], contexts, depth + 1);
  };
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) visit(child, [key], [], 0);
  } else visit(value, ['data'], [], 0);
  return rows;
}

export function makeStatisticsExportDocument(reportType: string, result: any, scopeLabel: string, exportedAt = new Date()): StatisticsExportDocument {
  const data = result?.data ?? {};
  const meta = result?.meta ?? {};
  const normalizedPeriod = normalizePeriod(meta);
  const from = normalizedPeriod?.fromDate ?? vietnamDateOnly(meta.fromDate);
  const to = normalizedPeriod?.inclusiveToDate ?? vietnamInclusivePeriodEnd(meta.toDateExclusive);
  const snapshotAt = typeof meta.snapshotAt === 'string' ? meta.snapshotAt : null;
  const periodLabel = snapshotAt ? `Snapshot: ${vietnamTimestamp(snapshotAt) ?? snapshotAt} (${STATISTICS_TIME_ZONE}; current snapshot)` : from || to ? `${from ?? '—'} – ${to ?? '—'} (${STATISTICS_TIME_ZONE})` : 'Không áp dụng';
  const limitations: string[] = Array.isArray(meta.limitations) ? meta.limitations.map((value: unknown) => String(value)) : [];
  const completeness = isPlainObject(meta.dataCompleteness) ? flattenStatisticsData(meta.dataCompleteness, 100).map(row => ({
    key: `Đầy đủ dữ liệu / ${row.metric}${row.detail ? ` / ${row.detail}` : ''}`, value: row.value,
  })) : [{ key: 'Đầy đủ dữ liệu', value: meta.dataCompleteness ?? null }];
  const information: Array<{ key: string; value: unknown }> = [
    { key: 'Loại báo cáo', value: reportType }, { key: 'Phạm vi', value: scopeLabel }, { key: 'Khoảng thời gian', value: periodLabel },
    { key: 'Múi giờ', value: meta.timezone ?? STATISTICS_TIME_ZONE }, { key: 'Thời điểm xuất', value: vietnamTimestamp(exportedAt) ?? exportedAt.toISOString() },
    { key: 'Snapshot tại', value: snapshotAt }, ...completeness,
    ...limitations.map((value: string, index: number) => ({ key: `Giới hạn ${index + 1}`, value })),
  ];
  const titles: Record<string, string> = {
    'facilities-kpi': 'KPI theo cơ sở', revenue: 'Báo cáo tiền đã thu', 'financial-analytics': 'Phân tích tài chính',
    'managed-operations': 'Thao tác kho Managed Inventory', 'storage-capacity': 'Sức chứa kho Self Storage',
    'managed-capacity': 'Sức chứa Managed Inventory', reservations: 'Thống kê Reservation',
    'contracts-lifecycle': 'Vòng đời hợp đồng', incidents: 'Thống kê sự cố',
  };
  return { reportType, title: titles[reportType] ?? 'Báo cáo Statistics', scopeLabel, periodLabel, snapshotAt,
    exportedAt: exportedAt.toISOString(), rows: flattenStatisticsData(data), information, limitations };
}

export function serializeCsv(document: StatisticsExportDocument): Buffer {
  const lines: unknown[][] = [
    ['Thông tin báo cáo', 'Chỉ số', 'Chi tiết', 'Giá trị', 'Đơn vị'],
    ...document.information.map(row => ['Thông tin báo cáo', row.key, '', row.value, '']),
    ...document.rows.map(row => [row.section, row.metric, row.detail, row.value === null || row.value === undefined ? UNVERIFIED_VALUE : row.value, row.unit]),
    ...document.limitations.map((item, index) => ['Giới hạn', `Ghi chú ${index + 1}`, '', item, '']),
  ];
  const escape = (value: unknown): string => {
    let text = value instanceof Date ? value.toISOString() : String(value ?? '');
    if (typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return Buffer.from(`\uFEFF${lines.map(row => row.map(escape).join(',')).join('\r\n')}\r\n`, 'utf8');
}

function safeSheetValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return UNVERIFIED_VALUE;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return text;
}

function setColumnWidths(sheet: XLSX.WorkSheet, widths: number[]) { sheet['!cols'] = widths.map(wch => ({ wch })); }

function worksheetValue(row: ExportRow): string | number | boolean {
  if (row.value === null || row.value === undefined) return UNVERIFIED_VALUE;
  if (row.unit === 'Ngày giờ' && typeof row.value === 'string') {
    const date = new Date(row.value);
    if (Number.isFinite(date.getTime())) return date.getTime() / 86_400_000 + 25_569;
  }
  return safeSheetValue(row.value);
}

export function serializeXlsx(document: StatisticsExportDocument): Buffer {
  const workbook = XLSX.utils.book_new();
  const info = XLSX.utils.aoa_to_sheet([['Thông tin báo cáo', 'Giá trị'], ...document.information.map(row => [row.key, safeSheetValue(row.value)])]);
  setColumnWidths(info, [34, 72]);
  XLSX.utils.book_append_sheet(workbook, info, 'Thông tin báo cáo');
  const table = XLSX.utils.aoa_to_sheet([
    [...STATISTICS_EXPORT_COLUMNS],
    ...document.rows.map(row => [row.section, row.metric, row.detail, worksheetValue(row), row.unit]),
  ]);
  setColumnWidths(table, [24, 34, 52, 24, 15]);
  for (const [address, cell] of Object.entries(table)) {
    if (address.startsWith('!') || !cell || typeof cell !== 'object') continue;
    if (cell.v === UNVERIFIED_VALUE || typeof cell.v === 'string') { cell.t = 's'; delete cell.f; }
    const rowNumber = Number(address.match(/\d+/)?.[0] ?? 0);
    if (address.startsWith('D') && cell.t === 'n') {
      const unit = String(table[`E${rowNumber}`]?.v ?? table[`C${rowNumber}`]?.v ?? table[`B${rowNumber}`]?.v ?? table[`A${rowNumber}`]?.v ?? '');
      cell.z = unit === 'VND' ? '#,##0.00' : unit === '%' ? '0.00"%"' : unit === 'Ngày giờ' ? 'yyyy-mm-dd hh:mm' : '#,##0.###';
    }
  }
  XLSX.utils.book_append_sheet(workbook, table, 'Dữ liệu');
  workbook.Props = { Title: document.title, Subject: `Statistics ${document.reportType}`, Author: 'VaultSpace' };
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

type PdfMakeServer = {
  addFonts(fonts: Record<string, unknown>): void;
  addTableLayouts(layouts: Record<string, unknown>): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  createPdf(definition: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
};
const pdfmake = require('pdfmake') as PdfMakeServer;
const roboto = require('pdfmake/fonts/Roboto') as { Roboto: Record<string, string> };
pdfmake.addFonts(roboto);
pdfmake.addTableLayouts({ lightHorizontalLines: { hLineColor: () => '#cbd5e1', vLineColor: () => '#e2e8f0', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 } });
pdfmake.setUrlAccessPolicy(() => false);
const allowedRobotoFiles = new Set(Object.values(roboto.Roboto).map(fontPath => path.resolve(fontPath)));
pdfmake.setLocalAccessPolicy(fontPath => allowedRobotoFiles.has(path.resolve(fontPath)));

export async function serializePdf(document: StatisticsExportDocument): Promise<Buffer> {
  const infoRows = document.information.map(row => [
    { text: row.key, bold: true, color: '#334155' }, { text: safePdfText(row.value), color: '#0f172a' },
  ]);
  const tableRows = document.rows.map(row => [row.section, row.metric, row.detail, safePdfText(row.value), row.unit]);
  const content: unknown[] = [
    { text: document.title, style: 'title', margin: [0, 0, 0, 6] },
    { text: document.scopeLabel, style: 'subtitle' },
    { text: document.periodLabel, style: 'subtitle', margin: [0, 0, 0, 10] },
    { text: 'Thông tin báo cáo', style: 'section' },
    { table: { widths: [130, '*'], body: infoRows.length ? infoRows : [['Thông tin', 'Không có dữ liệu xác minh']] }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 12] },
    { text: 'Chỉ số và dữ liệu', style: 'section' },
    { table: { headerRows: 1, dontBreakRows: false, widths: [90, 150, '*', 100, 55], body: [[...STATISTICS_EXPORT_COLUMNS], ...tableRows] }, layout: 'lightHorizontalLines' },
  ];
  if (document.limitations.length) content.push({ text: 'Lưu ý', style: 'section', margin: [0, 12, 0, 4] }, { ul: document.limitations.map(safePdfText) });
  const pdf = pdfmake.createPdf({
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 32, 28, 34], compress: true,
    defaultStyle: { font: 'Roboto', fontSize: 8, color: '#172033' },
    styles: { title: { fontSize: 18, bold: true, color: '#0f3b63' }, subtitle: { fontSize: 9, color: '#475569' }, section: { fontSize: 11, bold: true, color: '#0f3b63', margin: [0, 7, 0, 5] } },
    footer: (currentPage: number, pageCount: number) => ({ text: `VaultSpace Statistics · ${document.reportType} · ${currentPage}/${pageCount}`, alignment: 'right', margin: [28, 0, 28, 0], fontSize: 7, color: '#64748b' }),
    content,
  } as unknown as Record<string, unknown>);
  return pdf.getBuffer();
}

function safePdfText(value: unknown): string {
  return value === null || value === undefined ? UNVERIFIED_VALUE : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
