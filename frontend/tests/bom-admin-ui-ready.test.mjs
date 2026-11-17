import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Guards the "UI built ahead of the API" work: every screen must keep its final shape and
// route the missing endpoints through lib/backendCapabilities.js so that shipping a backend
// endpoint only flips a flag. These assertions also catch a merge that silently reverts it.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Facility and storage unit forms share the capability-aware image editor',()=>{
  const editor=read('../src/components/bom/ImageEditor.jsx');
  assert.match(editor,/export function ImageEditor/);
  assert.match(editor,/Đặt làm ảnh bìa/);
  assert.match(editor,/capability\(target === "storage-unit" \? "storageUnitImageUpload" : "facilityImageUpload"\)/);
  assert.match(editor,/MAX_IMAGES = 10/);
  const facility=read('../src/pages/bom/FacilityPage.jsx');
  assert.match(facility,/import \{ ImageEditor \} from "@\/components\/bom\/ImageEditor"/);
  assert.match(facility,/<ImageEditor\r?\n\s+label="Hình ảnh cơ sở"\r?\n\s+target="facility"/);
  const unit=read('../src/components/bom/StorageUnitDialogs.jsx');
  assert.match(unit,/import \{ ImageEditor, isHttpImage, MAX_IMAGES \} from "@\/components\/bom\/ImageEditor"/);
  assert.match(unit,/<ImageEditor\r?\n\s+label="Hình ảnh kho"\r?\n\s+target="storage-unit"/);
  // Editing always sends the list so clearing every URL removes the saved images.
  assert.match(unit,/if \(editing \|\| images\.length\) body\.images = images;/);
});

test('Revenue report keeps its full shell on top of a capability-gated adapter',()=>{
  const page=read('../src/pages/bom/ReportsPages.jsx');
  for(const marker of [/loadRevenueReport/,/revenueSource/,/defaultRevenuePeriod/,/exportStatistics/,/Xuất \$\{format\.toUpperCase\(\)\}/,/Doanh thu theo cơ sở/]){
    assert.match(page,marker);
  }
  // Ranking report is served by the same statistics read model.
  assert.match(page,/export function FacilityRankingPage/);
  assert.match(page,/loadFacilityRanking/);
  assert.match(page,/reportType: "facilities-kpi"/);
  const adapter=read('../src/lib/reportSources.js');
  assert.match(adapter,/export async function loadRevenueReport/);
  assert.match(adapter,/export function defaultRevenuePeriod/);
  assert.match(adapter,/export async function loadUtilizationSummary/);
  assert.match(adapter,/export async function loadFacilityRanking/);
  assert.match(adapter,/export async function loadRentalTrends/);
  assert.match(adapter,/export async function exportStatistics/);
  const api=read('../src/api/statisticsApi.js');
  for(const endpoint of ['revenue','utilization','facilities-ranking','rental-trends','filters']){
    assert.match(api,new RegExp(`/statistics/${endpoint}`));
  }
  assert.match(api,/\/statistics\/export\/\$\{format\}/);
  const allowlist=read('../src/api/confirmedContract.js');
  assert.match(allowlist,/revenue\|facilities-ranking/);
  assert.match(allowlist,/rental-trends/);
  assert.match(allowlist,/statistics\\\/export\\\/\(csv\|xlsx\|pdf\)/);
  const bomRoutes=read('../src/routes/BomRoutes.jsx');
  const adminRoutes=read('../src/routes/AdminRoutes.jsx');
  for(const routes of [bomRoutes,adminRoutes]){
    assert.match(routes,/path="reports\/facilities-ranking"/);
    assert.match(routes,/FacilityRankingPage/);
  }
  // The statistics read model now serves revenue and server export; the rest still waits on backend.
  const capabilities=read('../src/lib/backendCapabilities.js');
  assert.match(capabilities,/revenueReport: true/);
  assert.match(capabilities,/serverExport: true/);
  for(const flag of ['facilityImageUpload','storageUnitImageUpload','globalAuditSearch','notificationProducer']){
    assert.match(capabilities,new RegExp(`${flag}: false`));
  }
});

test('Rental report renders the server trend series instead of aggregating on the client',()=>{
  const page=read('../src/pages/bom/RentalReportLivePage.jsx');
  assert.match(page,/import \{ defaultRevenuePeriod, loadRentalTrends \} from "@\/lib\/reportSources"/);
  assert.match(page,/loadRentalTrends\(/);
  assert.match(page,/Xu hướng theo kỳ/);
  assert.match(page,/options=\{\[\["day", "Theo ngày"\], \["week", "Theo tuần"\], \["month", "Theo tháng"\]\]\}/);
});

test('Audit, login history and the notification inbox expose filters and CSV export',()=>{
  const system=read('../src/pages/admin/LiveSystemPages.jsx');
  assert.match(system,/import \{ downloadCsv \} from "@\/lib\/csvExport"/);
  assert.match(system,/Lọc theo hành động/);
  assert.match(system,/Lọc theo sự kiện/);
  assert.match(system,/inRange\(r\.source\.createdAt, from, to\)/);
  const notifications=read('../src/pages/shared/NotificationsPage.jsx');
  assert.match(notifications,/filterNotifications\(rows, \{ status: scope, search, from, to \}\)/);
  assert.match(notifications,/Lọc theo loại thông báo/);
  assert.match(notifications,/downloadCsv\(/);
  const rental=read('../src/pages/bom/RentalReportLivePage.jsx');
  assert.match(rental,/r\.startDate >= from/);
  assert.match(rental,/Xuất CSV/);
});

test('CSV export writes a BOM-prefixed UTF-8 blob so Excel keeps Vietnamese',()=>{
  const csv=read('../src/lib/csvExport.js');
  assert.match(csv,/text\/csv;charset=utf-8/);
  assert.match(csv,/\\uFEFF/);
  assert.match(csv,/replaceAll\('"', '""'\)/);
});
