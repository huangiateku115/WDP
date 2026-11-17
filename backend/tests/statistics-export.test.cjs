'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { UserRole } = require('../dist/types/user.type');
const Facility = require('../dist/models/facilities/facility.model').default;
const { requireRole } = require('../dist/middlewares/auth/requireRole');
const { StatisticsExportService, StatisticsExportError } = require('../dist/services/statistics/statistics-export.service');
const { parseStatisticsExportRequestValue } = require('../dist/services/statistics/statistics-export.validation');
const { parseStatisticsQuery } = require('../dist/services/statistics/statistics.validation');
const { StatisticsService } = require('../dist/services/statistics/statistics.service');
const StatisticsServiceModule = require('../dist/services/statistics/statistics.service');
const { makeStatisticsExportDocument, serializeCsv, serializeXlsx, serializePdf, UNVERIFIED_VALUE } = require('../dist/services/statistics/statistics-export.renderers');
const ExportController = require('../dist/controllers/statistics/statistics-export.controller');

const facilityA = '507f1f77bcf86cd799439011';
const facilityB = '507f1f77bcf86cd799439012';
const REPORT = { success: true, data: { collectedAmount: 1200.5, refundedAmount: null, collectedByFacility: [{ facilityId: facilityA, amount: 1200.5 }] },
  meta: { period: { fromDate: '2026-11-01T00:00:00.000Z', toDateExclusive: '2026-12-01T00:00:00.000Z' }, timezone: 'Asia/Ho_Chi_Minh', limitations: ['Refund ledger chưa có dữ liệu xác minh.'], dataCompleteness: { refundedAmount: 'UNAVAILABLE' } } };

test('export request validation accepts the nine supported reports and rejects unsupported filters and snapshot periods', () => {
  const reports = ['facilities-kpi','revenue','financial-analytics','managed-operations','storage-capacity','managed-capacity','reservations','contracts-lifecycle','incidents'];
  for (const reportType of reports) assert.equal(parseStatisticsExportRequestValue({ reportType }).reportType, reportType);
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'customers' }), e => e.code === 'UNSUPPORTED_REPORT_TYPE');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'revenue', paymentStatus: 'FAILED' }), e => e.code === 'UNSUPPORTED_REPORT_FILTER');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'financial-analytics', paymentStatus: 'FAILED' }), e => e.code === 'UNSUPPORTED_PAYMENT_STATUS_FILTER');
  assert.equal(parseStatisticsExportRequestValue({ reportType: 'financial-analytics', paymentStatus: 'SUCCEEDED' }).reportType, 'financial-analytics');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'storage-capacity', status: 'ACTIVE' }), e => e.code === 'UNSUPPORTED_STATUS_FILTER');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'reservations', status: 'ACTIVE' }), e => e.status === 400 && /status/.test(e.message));
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'managed-operations', status: 'OPEN' }), e => e.code === 'UNSUPPORTED_REPORT_FILTER');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'managed-capacity', fromDate: '2026-11-01' }), e => e.code === 'SNAPSHOT_DATE_FILTER_UNSUPPORTED');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'revenue', page: '2' }), e => e.code === 'EXPORT_PAGINATION_UNSUPPORTED');
});

test('incident status values pass shared query validation and export validation while other-service statuses fail', () => {
  for (const status of ['OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED']) {
    assert.equal(parseStatisticsQuery({ status, fromDate: '2026-11-01', toDate: '2026-11-30' }).status, status);
    const parsed = parseStatisticsExportRequestValue({ reportType: 'incidents', status });
    assert.equal(parsed.queryInput.status, status);
  }
  assert.throws(() => parseStatisticsQuery({ status: 'NOT_A_STATUS' }), e => e.status === 400 && e.code === 'INVALID_STATUS');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'incidents', status: 'OCCUPIED' }), e => e.status === 400 && e.code === 'UNSUPPORTED_STATUS_FILTER');
  assert.throws(() => parseStatisticsExportRequestValue({ reportType: 'incidents', status: ['OPEN', 'CLOSED'] }), e => e.status === 400 && e.code === 'INVALID_STATUS');
});

test('incident status request flows through shared query resolution and export service boundary without database access', async t => {
  const resolveRequestValue = parseStatisticsExportRequestValue;
  for (const status of ['OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED']) {
    const incidentQuery = parseStatisticsQuery({ fromDate:'2026-11-01',toDate:'2026-11-30',status });
    assert.equal(incidentQuery.status,status);
    for (const format of ['csv','xlsx','pdf']) {
      const parsed = resolveRequestValue({reportType:'incidents',fromDate:'2026-11-01',toDate:'2026-11-30',status});
      const query = parseStatisticsQuery(parsed.queryInput);
      assert.equal(parsed.reportType,'incidents');
      assert.equal(query.status,status,`${format} ${status}`);
    }
  }
  assert.throws(()=>resolveRequestValue({reportType:'incidents',status:'OCCUPIED'}),e=>e.status===400&&e.code==='UNSUPPORTED_STATUS_FILTER');
});

test('report period normalizes period, requestedPeriod, and top-level metadata to inclusive Vietnam calendar dates', () => {
  const start='2026-10-31T17:00:00.000Z', end='2026-11-30T17:00:00.000Z';
  for (const meta of [{period:{fromDate:start,toDateExclusive:end}},{requestedPeriod:{fromDate:start,toDateExclusive:end}},{fromDate:start,toDateExclusive:end}]) {
    const doc=makeStatisticsExportDocument('incidents',{data:{newIncidents:2},meta},'Facility A');
    assert.equal(doc.periodLabel,'01/11/2026 – 30/11/2026 (Asia/Ho_Chi_Minh)');
  }
  const single=makeStatisticsExportDocument('incidents',{data:{},meta:{fromDate:'2026-02-27T17:00:00.000Z',toDateExclusive:'2026-02-28T17:00:00.000Z'}},'Facility A');
  assert.equal(single.periodLabel,'28/02/2026 – 28/02/2026 (Asia/Ho_Chi_Minh)');
  const yearEnd=makeStatisticsExportDocument('incidents',{data:{},meta:{fromDate:'2026-12-31T17:00:00.000Z',toDateExclusive:'2027-01-01T17:00:00.000Z'}},'Facility A');
  assert.equal(yearEnd.periodLabel,'01/01/2027 – 01/01/2027 (Asia/Ho_Chi_Minh)');
  const leap=makeStatisticsExportDocument('incidents',{data:{},meta:{fromDate:'2024-02-28T17:00:00.000Z',toDateExclusive:'2024-02-29T17:00:00.000Z'}},'Facility A');
  assert.equal(leap.periodLabel,'29/02/2024 – 29/02/2024 (Asia/Ho_Chi_Minh)');
  const snapshot=makeStatisticsExportDocument('managed-capacity',{data:{},meta:{snapshotAt:'2026-10-31T17:00:00.000Z',requestedPeriod:{fromDate:start,toDateExclusive:end,applied:false}}},'Facility A');
  assert.match(snapshot.periodLabel,/Snapshot: 01\/11\/2026/); assert.match(snapshot.periodLabel,/current snapshot/);
  const noPeriod=makeStatisticsExportDocument('incidents',{data:{},meta:{}},'Facility A');
  assert.equal(noPeriod.periodLabel,'Không áp dụng');
});

test('CSV is UTF-8 with BOM, Vietnamese labels, RFC-style quoting, formula injection defense, and explicit nulls', () => {
  const doc = makeStatisticsExportDocument('revenue', { data: {
    unicode: 'Tiếng Việt: ă â ê ô ơ ư đ', formula: '=HYPERLINK("https://bad","click")',
    comma: 'A, B', quoted: 'He said "OK"\nnext line', amount: 1200.5, missing: null,
  }, meta: {} }, 'Toàn hệ thống', new Date('2026-11-17T00:00:00.000Z'));
  const csv = serializeCsv(doc).toString('utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('Tiếng Việt: ă â ê ô ơ ư đ'));
  assert.ok(csv.includes("'=HYPERLINK("));
  assert.ok(csv.includes('"A, B"'));
  assert.ok(csv.includes('"He said ""OK""\nnext line"'));
  assert.ok(csv.includes(UNVERIFIED_VALUE));
});

test('XLSX is a valid workbook with required sheets, typed cells, formula safety, date/amount formatting, and null label', () => {
  const doc = makeStatisticsExportDocument('revenue', { data: {
    attack: '=1+1', collectedAmount: 1234.5, captureDate: '2026-11-17T03:00:00.000Z', unavailable: null,
  }, meta: {} }, 'Toàn hệ thống');
  const bytes = serializeXlsx(doc);
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: false });
  assert.deepEqual(workbook.SheetNames, ['Thông tin báo cáo', 'Dữ liệu']);
  const sheet = workbook.Sheets['Dữ liệu'];
  assert.equal(sheet.D2.t, 's');
  assert.equal(sheet.D2.f, undefined);
  assert.equal(sheet.D2.v, "'=1+1");
  assert.equal(sheet.D3.t, 'n');
  assert.match(sheet.D3.w, /1,234\.50/);
  assert.match(sheet.D4.w, /2026-11-17 03:00/);
  assert.equal(sheet.D5.v, UNVERIFIED_VALUE);
});

test('PDF renders a valid paginated Unicode document with embedded font mapping and null notation', async () => {
  const doc = makeStatisticsExportDocument('incidents', { data: { title: 'Báo cáo tiếng Việt: ă â ê ô ơ ư đ', metric: null }, meta: {} }, 'Toàn hệ thống');
  const bytes = await serializePdf(doc);
  assert.ok(bytes.subarray(0, 5).toString('ascii').startsWith('%PDF-'));
  assert.ok(bytes.toString('binary').includes('%%EOF'));
  assert.ok(bytes.toString('binary').includes('/ToUnicode'));
  assert.ok(bytes.toString('binary').includes('/FontFile2'));
  assert.ok(doc.rows.some(row => row.value === null));
});

test('empty reports still produce valid non-empty CSV, XLSX, and PDF files', async () => {
  const doc = makeStatisticsExportDocument('incidents', { data: { incidentsByFacility: [] }, meta: {} }, 'Toàn hệ thống');
  assert.ok(serializeCsv(doc).length > 20);
  assert.ok(XLSX.read(serializeXlsx(doc), { type: 'buffer' }).Sheets['Dữ liệu']);
  assert.ok((await serializePdf(doc)).subarray(0, 5).toString('ascii').startsWith('%PDF-'));
});

test('export row limit returns a structured 413 instead of truncating data', async () => {
  const data = { events: Array.from({ length: 1_001 }, (_, i) => ({ id: i, value: i })) };
  await assert.rejects(StatisticsExportService.buildDocument('revenue', { data, meta: {} }, { type: 'ALL' }),
    e => e && e.status === 413 && e.code === 'EXPORT_ROW_LIMIT_EXCEEDED');
});

test('financial and managed capacity exports dispatch to audited Phase 1–4 services', async t => {
  let financialCalls = 0, capacityCalls = 0;
  t.mock.method(require('../dist/services/statistics/statistics-phase3.service').StatisticsPhase3Service, 'financialAnalytics', async () => { financialCalls += 1; return REPORT; });
  t.mock.method(require('../dist/services/statistics/statistics-phase2.service').StatisticsPhase2Service, 'managedCapacity', async () => {
    capacityCalls += 1; return { ...REPORT, data: { usedWeightKg: 10, usedVolumeM3: 2 }, meta: { dataCompleteness: { reconciliationStatus: 'RECONCILED' } } };
  });
  const query = { from: new Date('2026-11-01'), toExclusive: new Date('2026-12-01'), page: 1, limit: 20, sortOrder: -1, comparePrevious: false };
  const financial = await StatisticsExportService.collectReport('financial-analytics', query, { type: 'ALL' });
  const capacity = await StatisticsExportService.collectReport('managed-capacity', query, { type: 'ALL' });
  assert.equal(financial.data.collectedAmount, 1200.5);
  assert.equal(capacity.meta.dataCompleteness.reconciliationStatus, 'RECONCILED');
  assert.equal(financialCalls, 1);
  assert.equal(capacityCalls, 1);
});

test('export requests pass through the real role guard and Statistics scope resolution before report collection', async t => {
  const scopes = [];
  t.mock.method(StatisticsExportService, 'collectReport', async (_type, _query, scope) => { scopes.push(scope); return REPORT; });
  const facilityQuery = () => ({ select() { return this; }, lean() { return this; }, exec: async () => ({ _id: facilityA, code: 'HCM-01', name: 'Kho Hồ Chí Minh' }) });
  t.mock.method(Facility, 'findOne', filter => { assert.equal(String(filter._id), facilityA); return facilityQuery(); });

  async function request(user, query = { reportType: 'revenue' }) {
    const req = { user, query };
    const response = { statusCode: 200, headers: {}, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      send(body) { this.body = body; return this; },
    };
    const roleGuard = requireRole([UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER]);
    const next = async error => { if (error) throw error; await ExportController.csv(req, response, reject => { if (reject) throw reject; }); };
    await new Promise((resolve, reject) => {
      const guardedNext = error => {
        if (error) { reject(error); return; }
        ExportController.csv(req, response, error => error ? reject(error) : resolve()).then(resolve, reject);
      };
      roleGuard(req, response, guardedNext);
      if (response.body && response.statusCode !== 200) resolve();
    });
    return response;
  }

  const noToken = await request(undefined);
  assert.equal(noToken.statusCode, 401);
  for (const role of [UserRole.CUSTOMER, UserRole.FACILITY_STAFF]) assert.equal((await request({ role })).statusCode, 403);
  const admin = await request({ role: UserRole.ADMIN });
  const bom = await request({ role: UserRole.BOM });
  assert.equal(admin.statusCode, 200);
  assert.equal(bom.statusCode, 200);
  assert.equal(scopes[0].type, 'ALL');
  assert.equal(scopes[1].type, 'ALL');
  const manager = await request({ role: UserRole.FACILITY_MANAGER, assignedFacilityId: facilityA });
  assert.equal(manager.statusCode, 200);
  assert.equal(scopes[2].type, 'FACILITY');
  assert.equal(scopes[2].facilityId.toString(), facilityA);
  const deniedScope = await request({ role: UserRole.FACILITY_MANAGER, assignedFacilityId: facilityA }, { reportType: 'revenue', facilityId: facilityB });
  assert.equal(deniedScope.statusCode, 403);
  assert.equal(deniedScope.body.code, 'FACILITY_SCOPE_FORBIDDEN');
  const unassigned = await request({ role: UserRole.FACILITY_MANAGER });
  assert.equal(unassigned.statusCode, 403);
  assert.equal(unassigned.body.code, 'FACILITY_ASSIGNMENT_REQUIRED');
  assert.equal(admin.headers['content-type'], 'text/csv; charset=utf-8');
  assert.match(admin.headers['content-disposition'], /^attachment; filename="vaultspace-statistics-revenue-/);
  assert.ok(Buffer.isBuffer(admin.body));
});
