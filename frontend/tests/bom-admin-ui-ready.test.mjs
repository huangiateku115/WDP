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

test('Warehouse information is labelled as information and only shown for Managed Inventory facilities',()=>{
  // "Cấu trúc kho" is a technical term; the screens only display warehouse information.
  for(const layout of ['../src/layouts/BomLayout.jsx','../src/layouts/AdminLayout.jsx']){
    const source=read(layout);
    assert.match(source,/['"]warehouse['"],Warehouse,['"]Thông tin kho['"]/);
    assert.doesNotMatch(source,/['"]Cấu trúc kho['"]/);
  }
  const warehouse=read('../src/pages/shared/WarehouseStructurePage.jsx');
  assert.match(warehouse,/title="Thông tin kho"/);
  const facility=read('../src/pages/bom/FacilityPage.jsx');
  assert.match(facility,/facility\.serviceTypes\.includes\("MANAGED_INVENTORY"\) && \(/);
  assert.match(facility,/facility\.serviceTypes\.includes\("SELF_STORAGE"\) && \(/);
  const oversight=read('../src/pages/bom/OversightLivePage.jsx');
  assert.match(oversight,/const offersSelfStorage = serviceTypes\.includes\("SELF_STORAGE"\)/);
  assert.match(oversight,/const offersManaged = serviceTypes\.includes\("MANAGED_INVENTORY"\)/);
  const utilization=read('../src/pages/bom/UtilizationReportLivePage.jsx');
  assert.match(utilization,/\.\.\.\(offersSelfStorage \? \[\["Tỷ lệ lấp đầy kho riêng"/);
  assert.match(utilization,/\.\.\.\(offersManaged \? \[/);
  // Units are only offered for facilities that sell the Self Storage model.
  const units=read('../src/pages/shared/StorageUnitsPage.jsx');
  assert.match(units,/const selectable = facilities\.filter\(\(f\) => f\.serviceTypes\.includes\(SELF_STORAGE\)\)/);
  // The hierarchy hint was dropped from every screen.
  for(const page of [facility,oversight,utilization,warehouse]){
    assert.doesNotMatch(page,/Khu vực → lối đi → kệ → ô chứa/);
  }
});
test('Managed reservations expose no unsupported console actions',()=>{
  const page=read('../src/pages/shared/ReservationDetailPage.jsx');
  for(const dead of [/managedApprove/,/managedReject/,/managedMockPay/,/managedActivate/]){
    assert.doesNotMatch(page,dead);
  }
  assert.match(page,/\{!managed && canReview && reservation\.status === "RESERVED"/);
  assert.match(page,/Đơn lưu trữ hàng hóa được duyệt theo luồng hợp đồng và bàn giao tại cơ sở\./);
  const api=read('../src/api/bomApi.js');
  assert.doesNotMatch(api,/managedApprove|managedReject|managedMockPay|managedActivate/);
  assert.match(api,/managedGet: \(id, config\) => axiosClient\.get\(`\/reservations\/managed\/\$\{encode\(id\)\}`/);
  const roles=read('../src/lib/roles.js');
  assert.doesNotMatch(roles,/canMockPayReservations/);
});

test('Policy and discount write mappers stay deleted while read mappers remain',()=>{
  const mappers=read('../src/lib/bomMappers.js');
  for(const dead of ['policyBody','policyUpdateBody','discountBody','discountUpdateBody','categoryBody','categoryUpdateBody','splitCategoryInput','BOM_CATEGORY_TYPES','BOM_DISCOUNT_VALUE_TYPES','contractFromDto']){
    assert.doesNotMatch(mappers,new RegExp(`${dead}\\b`));
  }
  for(const alive of ['policyFromDto','discountFromDto','discountValueLabel','categoryFromDto','pricingBody','pricingUpdateBody']){
    assert.match(mappers,new RegExp(`${alive}\\b`));
  }
  const reportSources=read('../src/lib/reportSources.js');
  assert.doesNotMatch(reportSources,/export async function exportRevenueReport/);
  assert.match(reportSources,/export async function exportStatistics/);
});