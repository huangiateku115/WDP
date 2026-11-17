import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

// Guards the "UI built ahead of the API" work: every screen must keep its final shape and
// route the missing endpoints through lib/backendCapabilities.js so that shipping a backend
// endpoint only flips a flag. These assertions also catch a merge that silently reverts it.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const walk = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory()
    ? walk(`${dir}/${entry.name}`)
    : /\.[jt]sx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []));

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
  assert.match(page,/import \{ defaultRevenuePeriod, exportStatistics, loadRentalTrends, loadReservationReport \} from "@\/lib\/reportSources"/);
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
  assert.match(rental,/Xuất bảng đang xem \(CSV\)/);
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
test('Every visible BOM/Admin field label exists in the Vietnamese dictionary',()=>{
  const dictionary=read('../src/lib/facilityLabels.js');
  const keys=new Set();
  for(const match of dictionary.matchAll(/(?:^|[\s,{])(?:'([^']+)'|([A-Za-z][A-Za-z0-9_]*))\s*:/g)){
    keys.add(match[1] || match[2]);
  }
  assert.ok(keys.has('Customer') && keys.has('Deposit') && keys.has('Tax'),'dictionary keeps the contract labels');
  // Labels are rendered through facilityLabel(), so any label missing here shows up in English.
  const files=[
    'pages/bom/AuditLivePage.jsx','pages/bom/DashboardLivePage.jsx','pages/bom/FacilityPage.jsx',
    'pages/bom/OversightLivePage.jsx','pages/bom/RentalReportLivePage.jsx','pages/bom/ReportsPages.jsx',
    'pages/bom/UtilizationReportLivePage.jsx','pages/admin/LiveSystemPages.jsx','pages/admin/ServiceConsolePage.jsx',
    'pages/shared/ContractLookupPage.jsx','pages/shared/CustomerProfilesPage.jsx','pages/shared/InventoryItemsPage.jsx',
    'pages/shared/NotificationsPage.jsx','pages/shared/ReservationDetailPage.jsx','pages/shared/ReservationsOversightPage.jsx',
    'pages/shared/StorageUnitsPage.jsx','pages/shared/WarehouseStructurePage.jsx',
  ];
  // "Sang", "Kho" and "Trong kho" are Vietnamese words that happen to be plain ASCII.
  const allowed=new Set(['Sang','Kho','Trong kho']);
  const missing=[];
  for(const file of files){
    const source=read(`../src/${file}`);
    const labels=[];
    for(const match of source.matchAll(/\[\s*"([^"]{2,60})"\s*,/g)) labels.push(match[1]);
    for(const match of source.matchAll(/label:\s*"([^"]{2,60})"/g)) labels.push(match[1]);
    for(const label of labels){
      if(/[^\x20-\x7E]/.test(label)) continue;      // already Vietnamese
      if(!/^[A-Z]/.test(label)) continue;           // object keys such as "createdAt" are data, not labels
      if(allowed.has(label) || keys.has(label)) continue;
      missing.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(missing,[],`field labels missing from lib/facilityLabels.js: ${missing.join(' | ')}`);
});

test('Contract pricing snapshot never invents English labels or prints raw ids',()=>{
  const page=read('../src/pages/shared/ContractLookupPage.jsx');
  assert.doesNotMatch(page,/labelize/);
  assert.match(page,/const shortRef = \(value\) =>/);
  assert.match(page,/"Pricing policy", shortRef\(pricing\.pricingPolicyId\)/);
  assert.doesNotMatch(page,/No pricing values were captured/);
  assert.doesNotMatch(page,/could not be opened/);
});

test('Warehouse forms explain every field and fold technical values away',()=>{
  const dialogs=read('../src/components/bom/WarehouseStructureDialogs.jsx');
  // One name per concept across roles: Manager/Staff say "Mã dãy" / "Tọa độ ngang, dọc".
  assert.match(dialogs,/label="Mã dãy"/);
  assert.match(dialogs,/label="Tọa độ ngang"/);
  assert.match(dialogs,/label="Tọa độ dọc"/);
  for(const legacy of [/Mã lối đi/,/Tọa độ X/,/Tọa độ Y/,/Hướng xoay/]){
    assert.doesNotMatch(dialogs,legacy);
  }
  // Map coordinates and the zone colour are optional/technical: they sit behind a disclosure that
  // still explains what each value means, so opening it never leaves the user guessing.
  const advanced=dialogs.match(/<AdvancedFields[\s\S]*?<\/AdvancedFields>/g) || [];
  assert.equal(advanced.length,2,'rack and zone forms each carry one advanced section');
  for(const block of advanced){
    const hints=block.match(/hint="/g) || [];
    const fields=block.match(/<Field label="/g) || [];
    assert.ok(hints.length >= fields.length,`every folded field keeps a hint: ${fields.length} fields / ${hints.length} hints`);
  }
  assert.match(dialogs,/Ba giá trị dưới đây chỉ dùng để vẽ kệ lên bản đồ kho/);
  assert.match(dialogs,/Chỉ dùng khi bạn muốn khu vực này có màu riêng trên bản đồ kho/);
});

test('BOM/Admin warehouse wording matches the Manager and Staff vocabulary',()=>{
  const dictionary=read('../src/lib/facilityLabels.js');
  assert.match(dictionary,/Cells: 'Ô lưu trữ'/);
  assert.match(dictionary,/Cell: 'Ô lưu trữ'/);
  assert.match(dictionary,/Aisle: 'Dãy'/);
  assert.match(dictionary,/Level: 'Tầng kệ'/);
  assert.match(dictionary,/Position: 'Thứ tự ô'/);
  assert.match(dictionary,/Map: 'Vị trí trên bản đồ kho'/);
  const files=[
    'pages/bom/FacilityPage.jsx','pages/bom/OversightLivePage.jsx','pages/bom/UtilizationReportLivePage.jsx',
    'pages/bom/DashboardLivePage.jsx','pages/shared/WarehouseStructurePage.jsx','components/bom/WarehouseStructureDialogs.jsx',
  ];
  const legacy=[/ô chứa/i,/Ô chứa/,/label="Lối đi"/,/label: "Lối đi"/];
  for(const file of files){
    const source=read(`../src/${file}`);
    for(const pattern of legacy) assert.doesNotMatch(source,pattern,`${file} still uses the old wording: ${pattern}`);
  }
  // English units must not survive inside rendered values.
  const warehouse=read('../src/pages/shared/WarehouseStructurePage.jsx');
  assert.doesNotMatch(warehouse,/levels ×/);
  assert.doesNotMatch(warehouse,/\/level/);
  assert.doesNotMatch(warehouse,/m usable/);
});

test('No source file contains a broken UTF-8 replacement character',()=>{
  const files=[...walk('../src')];
  assert.ok(files.length > 100,'walk() found sources to scan');
  const broken=files.filter((file)=>readFileSync(new URL(file,import.meta.url),'utf8').includes('\uFFFD'));
  assert.deepEqual(broken,[],`files with U+FFFD (wrong encoding on write): ${broken.join(', ')}`);
});

test('Rental report uses the server aggregate and server export',()=>{
  const page=read('../src/pages/bom/RentalReportLivePage.jsx');
  assert.match(page,/loadReservationReport/);
  assert.match(page,/reportType: "reservations"/);
  for(const format of ['csv','xlsx','pdf']) assert.match(page,new RegExp(`EXPORT_FORMATS = \\[.*${format}`));
  assert.match(page,/Xuất báo cáo \$\{format\.toUpperCase\(\)\}/);
  const api=read('../src/api/statisticsApi.js');
  assert.match(api,/reservations: \(query, config\) => axiosClient\.get\("\/statistics\/reservations"/);
  const adapter=read('../src/lib/reportSources.js');
  assert.match(adapter,/export async function loadReservationReport/);
  assert.match(adapter,/filters = \{\}/);
});

test('BOM dashboard offers a facility filter and facility photos',()=>{
  const page=read('../src/pages/bom/DashboardLivePage.jsx');
  assert.match(page,/const \[facility, setFacility\] = useState\(""\)/);
  assert.match(page,/label="Lọc theo cơ sở"/);
  assert.match(page,/import \{ ResourceThumb \} from "@\/components\/bom\/ResourceImages"/);
  assert.match(page,/\{ key: "cover", label: "Ảnh", render: \(r\) => <ResourceThumb/);
  assert.match(page,/const scoped = facility \? reservations\.filter/);
});

test('Admin account creation never leaves an English or half-configured account',()=>{
  const page=read('../src/pages/admin/UsersLivePage.jsx');
  for(const english of [/Select a Facility for this account/,/The account was created/,/Facility assignment failed/,/Unable to create the account/,/unknown error/]){
    assert.doesNotMatch(page,english);
  }
  assert.match(page,/Hãy chọn cơ sở cho tài khoản này\./);
  assert.match(page,/const \[unassignedId, setUnassignedId\] = useState\(""\)/);
  assert.match(page,/to=\{`\/admin\/users\/\$\{unassignedId\}`\}/);
});

test('List screens never render detail or edit inline (quy ước 1)',()=>{
  const warehouse=read('../src/pages/shared/WarehouseStructurePage.jsx');
  assert.doesNotMatch(warehouse,/rackId &&/,'rack cells must not expand inside the warehouse list');
  assert.match(warehouse,/warehouse\/\$\{encodeURIComponent\(facilityId\)\}\/racks\/\$\{encodeURIComponent\(r\.id\)\}\/cells/);
  const rackCells=read('../src/pages/shared/RackCellsPage.jsx');
  assert.match(rackCells,/useParams/);
  assert.match(rackCells,/loadCells\(facilityId, rackId/);
  assert.match(rackCells,/AsyncBoundary/);
  const catalog=read('../src/pages/bom/ManagedInventoryCatalogPage.jsx');
  assert.doesNotMatch(catalog,/\{form\s*&&/,'the catalog form must live on its own route');
  assert.match(catalog,/managed-inventory-catalog\/new|\/new\/\$\{kind\}/);
  const catalogForm=read('../src/pages/bom/CatalogRecordPage.jsx');
  assert.match(catalogForm,/mode = "new"/);
  assert.match(catalogForm,/api\[config\.get\]/);
  const audit=read('../src/pages/admin/LiveSystemPages.jsx');
  assert.doesNotMatch(audit,/\{open && \(/,'audit detail must not expand below the table');
  assert.match(audit,/\/admin\/audit\/\$\{encodeURIComponent\(selected\)\}/);
  const auditDetail=read('../src/pages/admin/AuditLogDetailPage.jsx');
  assert.match(auditDetail,/getAdminAuditLogs\(userId\)/);
  const bomRoutes=read('../src/routes/BomRoutes.jsx');
  const adminRoutes=read('../src/routes/AdminRoutes.jsx');
  for(const routes of [bomRoutes,adminRoutes]){
    assert.match(routes,/path="warehouse\/:facilityId\/racks\/:rackId\/cells"/);
    assert.match(routes,/path="managed-inventory-catalog\/new\/:kind"/);
    assert.match(routes,/path="managed-inventory-catalog\/:kind\/:id\/edit"/);
  }
  assert.match(adminRoutes,/path="audit\/:userId\/:logId"/);
});

test('List tables use AsyncBoundary and refresh lives in the screen action (quy ước 5)',()=>{
  for(const file of ['pages/admin/LiveSystemPages.jsx','pages/admin/UsersLivePage.jsx','pages/bom/ManagedInventoryCatalogPage.jsx']){
    assert.match(read(`../src/${file}`),/AsyncBoundary/,`${file} must wrap its list table`);
  }
  for(const file of ['pages/bom/ReportsPages.jsx','pages/bom/RentalReportLivePage.jsx']){
    const page=read(`../src/${file}`);
    assert.match(page,/action=\{<div className="flex flex-wrap gap-2"><Button variant="outline" onClick=\{\w+\.reload\}/,`${file}: refresh belongs to the screen action`);
    assert.doesNotMatch(page,/Panel title="Bộ lọc">[\s\S]{0,900}Tính lại/,'refresh must not sit inside the filter panel');
  }
});

test('Free-text filters are debounced and carry no submit button (quy ước 2)',()=>{
  const hook=read('../src/lib/useDebouncedValue.js');
  assert.match(hook,/FILTER_DEBOUNCE_MS = 350/);
  // Scope: BOM/Admin only. Manager and Staff screens are owned by their own workspace.
  const catalog=read('../src/pages/bom/ManagedInventoryCatalogPage.jsx');
  assert.match(catalog,/useDebouncedValue/);
  assert.match(catalog,/className="manager-filters"/);
  assert.doesNotMatch(catalog,/facility-filter-row/);
});

test('Audit and login screens print Vietnamese labels, not raw codes (quy ước 6)',()=>{
  const page=read('../src/pages/admin/LiveSystemPages.jsx');
  assert.match(page,/facilityLabel\(r\.source\.action\)/);
  assert.match(page,/facilityLabel\(r\.source\.eventType\)/);
  const dictionary=read('../src/lib/facilityLabels.js');
  for(const code of ['LOGIN','LOGOUT','CREATE_FACILITY','UPDATE_PRICING_RULE','APPROVE_RESERVATION','TERMINATED','RECONCILIATION_REQUIRED','UNLOCK_FAILED']){
    assert.ok(dictionary.includes(`${code}:`),`dictionary is missing the audit/status code ${code}`);
  }
});

test('Unit and warehouse create/edit screens live on their own routes',()=>{
  const units=read('../src/pages/shared/StorageUnitsPage.jsx');
  assert.doesNotMatch(units,/<UnitDialog/,'the unit list must not open an edit dialog');
  assert.match(units,/units\/new|\/new\/\$\{encodeURIComponent\(facilityId\)\}/);
  assert.match(units,/\$\{basePath\}\/\$\{encodeURIComponent\(r\.id\)\}\/edit/);
  const unitForm=read('../src/pages/shared/UnitFormPage.jsx');
  assert.match(unitForm,/bomUnitApi\.get\(id/);
  const warehouse=read('../src/pages/shared/WarehouseStructurePage.jsx');
  assert.doesNotMatch(warehouse,/<ZoneDialog|<RackDialog/,'the warehouse list must not open edit dialogs');
  assert.match(warehouse,/formHref\("zones"\)/);
  assert.match(warehouse,/formHref\("racks", r\.id\)/);
  const warehouseForm=read('../src/pages/shared/WarehouseFormPage.jsx');
  assert.match(warehouseForm,/ZoneForm/);
  assert.match(warehouseForm,/RackForm/);
  for(const routes of [read('../src/routes/BomRoutes.jsx'),read('../src/routes/AdminRoutes.jsx')]){
    assert.match(routes,/path="units\/new\/:facilityId"/);
    assert.match(routes,/path="units\/:id\/edit"/);
    assert.match(routes,/path="warehouse\/:facilityId\/zones\/new"/);
    assert.match(routes,/path="warehouse\/:facilityId\/zones\/:zoneId\/edit"/);
    assert.match(routes,/path="warehouse\/:facilityId\/racks\/new"/);
    assert.match(routes,/path="warehouse\/:facilityId\/racks\/:rackId\/edit"/);
  }
});

test('Every BOM/Admin list search that calls the API is debounced',()=>{
  for(const file of ['pages/shared/StorageUnitsPage.jsx','pages/shared/InventoryItemsPage.jsx','pages/bom/ManagedInventoryCatalogPage.jsx']){
    assert.match(read(`../src/${file}`),/useDebouncedValue/,`${file} must debounce its server-side search`);
  }
});

test('Report and system tables all render through AsyncBoundary',()=>{
  for(const file of ['pages/bom/RentalReportLivePage.jsx','pages/admin/LiveSystemPages.jsx']){
    const page=read(`../src/${file}`);
    assert.doesNotMatch(page,/role="status"/,`${file} still renders a manual loading placeholder`);
    // A loader must never drive a hand-written branch; AsyncBoundary owns loading and error.
    assert.doesNotMatch(page,/\b(facilities|trends|summary|history|logs)\.(loading|error)\s*\n\s*\?/,`${file} still branches on a loader by hand`);
  }
});

test('Audit and inventory console print dictionary labels',()=>{
  const audit=read('../src/pages/bom/AuditLivePage.jsx');
  assert.match(audit,/facilityLabel\(r\.action\)/);
  assert.match(audit,/facilityLabel\(r\.eventType\)/);
  const inventory=read('../src/pages/shared/InventoryItemsPage.jsx');
  assert.match(inventory,/facilityLabel\(r\.category\)/);
  assert.doesNotMatch(inventory,/Unknown facility/);
});
