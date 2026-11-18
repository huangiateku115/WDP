import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Screen, Panel, Table, Status, Field, Select, Button, Details } from "@/components/manager/ManagerUI";
import { AsyncBoundary, TruncatedNotice, ConfirmDialog } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { ManagedCapacityDialog } from "@/components/bom/ManagedCapacityDialog";import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadManagedCapacity, loadRacks, loadZones } from "@/lib/bomApiData";
import { bomWarehouseApi } from "@/api/bomApi";
import { countBy, formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Warehouse structure console shared by BOM and Admin (ADMIN and BOM are both listed in the
// backend `managers` role set for warehouse-map writes).
// IMPORTANT backend rule: every zone/rack/cell read and write validates the facility through
// facilityForMap, which requires status ACTIVE + serviceTypes MANAGED_INVENTORY. Facilities
// that do not qualify answer 409, so the selector only offers eligible facilities.
const eligible = (facility) => facility.status === "ACTIVE" && facility.serviceTypes.includes("MANAGED_INVENTORY");
// Dimensions are printed with their meaning instead of a bare "2×0.6×2 m" sequence.
const dims = (d) => `rộng ${d.widthM} × sâu ${d.depthM} × cao ${d.heightM} m`;

// The capacity read is interval based, so the console reports on the current calendar month.
function currentMonthWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export default function WarehouseStructurePage({ basePath = "/bom" }) {
  const directory = useAsyncData(loadFacilities, []);
  // The selected facility lives in the URL so the rack-cell route can link back to the same view.
  const [searchParams, setSearchParams] = useSearchParams();
  const [facilityId, setFacilityId] = useState(searchParams.get("facility") || "");
  const [zoneFilter, setZoneFilter] = useState(searchParams.get("zone") || "");
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const window = currentMonthWindow();

  const zones = useAsyncData(({ signal }) => (facilityId ? loadZones(facilityId, { signal }) : Promise.resolve(null)), [facilityId]);
  const racks = useAsyncData(({ signal }) => (facilityId ? loadRacks(facilityId, { signal }) : Promise.resolve(null)), [facilityId]);
  const capacity = useAsyncData(
    ({ signal }) => (facilityId ? loadManagedCapacity(facilityId, { ...window, signal }) : Promise.resolve(null)),
    [facilityId],
  );

  function selectFacility(id) {
    setFacilityId(id);
    setZoneFilter("");
    setSearchParams(id ? { facility: id } : {}, { replace: true });
  }

  // Keeps the chosen facility and zone in the URL so the form routes can link back here.
  function selectZone(id) {
    setZoneFilter(id);
    const next = {};
    if (facilityId) next.facility = facilityId;
    if (id) next.zone = id;
    setSearchParams(next, { replace: true });
  }

  const formHref = (kind, id) => `${basePath}/warehouse/${encodeURIComponent(facilityId)}/${kind}/${id ? `${encodeURIComponent(id)}/edit` : "new"}${zoneFilter ? `?zone=${encodeURIComponent(zoneFilter)}` : ""}`;

  function reloadStructure() {
    zones.reload();
    racks.reload();
  }
  function removeZone(zone) {
    setConfirm({
      title: `Xóa khu vực ${zone.code}?`,
      summary: "Chỉ xóa được khu vực khi đã xóa hết kệ bên trong.",
      label: "Xóa khu vực",
      run: async () => { await bomWarehouseApi.deleteZone(zone.id); reloadStructure(); },
    });
  }

  function removeRack(rack) {
    setConfirm({
      title: `Xóa kệ ${rack.rackCode}?`,
      summary: "Chỉ xóa được kệ khi mọi ô đều đang bị chặn hoặc đang bảo trì, và không ô nào còn hàng, đang giữ hoặc đang được đặt.",
      label: "Xóa kệ",
      run: async () => { await bomWarehouseApi.deleteRack(rack.id); reloadStructure(); },
    });
  }

  return (
    <Screen
      title="Thông tin kho"
      description="Khu vực, kệ và ô lưu trữ của cơ sở lưu trữ hàng hóa."
    >
      <AsyncBoundary state={directory} render={(facilities) => {
        const options = facilities.filter(eligible);
        const excluded = facilities.length - options.length;
        return (
          <>
            <Kpis items={[
              ["Số cơ sở hiển thị", options.length, "Cơ sở đang hoạt động có dịch vụ Lưu trữ hàng hóa"],
              ["Khu vực", zones.data?.total ?? "—", "Khu vực của cơ sở đã chọn"],
              ["Kệ", racks.data?.total ?? "—", "Kệ của cơ sở đã chọn"],
              ["Ô lưu trữ", sumBy(racks.data?.rows || [], "cellCount") || "—", "Tạo tự động theo kệ"],
            ]} />

            <Panel
              title="Phạm vi cấu trúc"
              subtitle="Bản đồ kho chỉ liệt kê cơ sở đang hoạt động và có dịch vụ Lưu trữ hàng hóa."
            >
              <div className="manager-filters">
                <Field label="Cơ sở">
                  <Select
                    label="Cơ sở kho"
                    value={facilityId}
                    onChange={selectFacility}
                    options={[["", "Chọn cơ sở"], ...options.map((f) => [f.id, `${f.name} (${f.code})`])]}
                  />
                </Field>
                <Field label="Lọc theo khu vực" hint="Chỉ ảnh hưởng danh sách kệ.">
                  <Select
                    label="Lọc theo khu vực"
                    value={zoneFilter}
                    onChange={selectZone}
                    disabled={!facilityId}
                    options={[["", "Tất cả khu vực"], ...(zones.data?.rows || []).map((z) => [z.id, `${z.code} · ${z.name}`])]}
                  />
                </Field>
              </div>
              {excluded > 0 && (
                <p className="bom-note mt-5">
                  Ẩn {excluded} cơ sở khác vì cơ sở không đang hoạt động hoặc không cung cấp dịch vụ Lưu trữ hàng hóa.
                </p>
              )}
            </Panel>

            {!facilityId && (
              <Panel title="Chọn cơ sở">
                <p className="text-sm text-slate-500">Khu vực, kệ và ô lưu trữ thuộc một cơ sở.</p>
              </Panel>
            )}

            {facilityId && (
              <>
                <Panel
                  title="Công suất lưu trữ"
                  subtitle="Công suất có thể bán trong tháng hiện tại."
                  action={<Button onClick={() => setCapacityOpen(true)}>Cấu hình công suất</Button>}
                >
                  <AsyncBoundary state={capacity} render={(data) => (data ? (
                    <Details values={[
                      ["Khoảng thời gian", `${String(data.interval?.startDate || window.startDate).slice(0, 10)} → ${String(data.interval?.endDate || window.endDate).slice(0, 10)}`],
                      ["Sellable capacity", m3(data.sellableCapacityM3)],
                      ["Committed peak", m3(data.committedPeakCapacityM3)],
                      ["Available capacity", m3(data.availableCapacityM3)],
                      ["Overdue obligation", m3(data.unresolvedOverdueObligationM3)],
                    ]} />
                  ) : (
                    <p className="bom-warning">
                      Cơ sở chưa có cấu hình công suất đang hoạt động nên chưa thể tạo đơn lưu trữ hàng hóa.
                      Dùng Cấu hình công suất để đặt công suất bán được và thời gian giữ chỗ.
                    </p>
                  ))} />
                </Panel>

                <AsyncBoundary state={zones} render={(data) => (data ? (
                  <Panel
                    title="Khu vực"
                    subtitle={`${data.total} khu vực`}
                    action={<Button asChild><Link to={formHref("zones")}>Tạo khu vực</Link></Button>}
                  >
                    {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
                    <Table
                      label="Khu vực kho"
                      rows={data.rows}
                      columns={[
                        { key: "code", label: "Code" },
                        { key: "name", label: "Name" },
                        { key: "sortOrder", label: "Sort order" },
                        { key: "state", label: "State", render: (r) => <Status value={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
                        { key: "description", label: "Description", render: (r) => r.description || "—" },
                        {
                          key: "actions",
                          label: "Actions",
                          render: (r) => (
                            <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm" variant="outline"><Link to={formHref("zones", r.id)}>Sửa</Link></Button>
                            <Button size="sm" variant="outline" onClick={() => removeZone(r)}>Xóa</Button>
                            </div>
                          ),
                        },
                      ]}
                      empty="Cơ sở này chưa cấu hình khu vực kho."
                    />
                  </Panel>
                ) : null)} />

                <AsyncBoundary state={racks} render={(data) => (data ? (
                  <Panel
                    title="Kệ"
                    action={(
                      (zones.data?.rows || []).length
                        ? <Button asChild><Link to={formHref("racks")}>Tạo kệ</Link></Button>
                        : <Button disabled title="Hãy tạo một khu vực kho trước khi thêm kệ">Tạo kệ</Button>
                    )}
                  >
                    {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
                    {!(zones.data?.rows || []).length && (
                      <p className="bom-warning mb-4">Hãy tạo một khu vực đang hoạt động trước khi thêm kệ.</p>
                    )}
                    <Table
                      label="Kệ trong kho"
                      rows={data.rows.filter((rack) => !zoneFilter || rack.zoneId === zoneFilter)}
                      columns={[
                        { key: "rackCode", label: "Rack" },
                        { key: "zone", label: "Zone", render: (r) => (zones.data?.rows || []).find((z) => z.id === r.zoneId)?.code || "—" },
                        { key: "aisleCode", label: "Aisle" },
                        { key: "operationalStatus", label: "Status", render: (r) => <Status value={r.operationalStatus} /> },
                        { key: "layout", label: "Layout", render: (r) => `${r.levelCount} tầng × ${r.cellsPerLevel} ô (tổng ${r.cellCount} ô)` },
                        { key: "dimensions", label: "Dimensions", render: (r) => dims(r.dimensions) },
                        { key: "maxWeightKg", label: "Rated weight", render: (r) => `${kg(r.maxWeightKg)} · ${kg(r.maxWeightKgPerLevel)} mỗi tầng` },
                        { key: "map", label: "Map", render: (r) => `Ngang ${r.mapX} · Dọc ${r.mapY} · hướng ${r.orientation}°` },
                        {
                          key: "actions",
                          label: "Actions",
                          render: (r) => (
                            <div className="flex flex-wrap gap-2">
                              <Button asChild size="sm" variant="outline">
                                <Link to={`${basePath}/warehouse/${encodeURIComponent(facilityId)}/racks/${encodeURIComponent(r.id)}/cells`}>Ô lưu trữ</Link>
                              </Button>
                              <Button asChild size="sm" variant="outline"><Link to={formHref("racks", r.id)}>Sửa</Link></Button>
                              <Button size="sm" variant="outline" onClick={() => removeRack(r)}>Xóa</Button>
                            </div>
                          ),
                        },
                      ]}
                      empty="Chưa có kệ nào trong cơ sở (hoặc khu vực đã chọn)."
                    />
                  </Panel>
                ) : null)} />
              </>
            )}
          </>
        );
      }} />

      {capacityOpen && (
        <ManagedCapacityDialog
          facilityId={facilityId}
          facilityLabel={(directory.data || []).find((f) => f.id === facilityId)?.name || facilityId}
          configured={Boolean(capacity.data)}
          onClose={() => setCapacityOpen(false)}
          onSaved={capacity.reload}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          summary={<p className="text-sm text-slate-500">{confirm.summary}</p>}
          confirmLabel={confirm.label}
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        />
      )}
    </Screen>
  );
}
