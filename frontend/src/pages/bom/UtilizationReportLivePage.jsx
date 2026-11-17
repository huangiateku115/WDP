import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Screen, Panel, Table, Status, Field, Select, Details, Button, Meter,
} from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { ManagedCapacityDialog } from "@/components/bom/ManagedCapacityDialog";
import { useAsyncData } from "@/lib/useAsyncData";
import {
  facilityName, loadFacilities, loadFacilityInventory, loadFacilityUnits, loadManagedCapacity, loadWarehouseStructure,
} from "@/lib/bomApiData";
import { BOM_UNIT_SIZES } from "@/lib/bomMappers";
import { loadUtilizationSummary } from "@/lib/reportSources";
import { countBy, formatKg as kg, formatM3 as m3, percent as pct, sumBy } from "@/lib/bomMetrics";

const UNIT_ALLOCATED = ["OCCUPIED"];
const UNIT_FREE = ["AVAILABLE"];
const UNIT_BLOCKED = ["HELD", "MAINTENANCE", "INACTIVE"];

// Backend utilization rates are already percentages (0–100); null means "not available".
const rate = (value) => (typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—");

// The managed-capacity read is interval based, so we report on the current calendar month.
function currentMonthWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

// Utilization report rebuilt on live reads. Unit occupancy, managed volume and physical
// capacity come from the warehouse / storage-unit / managed-inventory / capacity APIs.
// The backend still exposes no cross-facility aggregate or payment ledger, so revenue
// based utilization and historical time series stay unavailable and are labelled as such.
export default function UtilizationReportLivePage({ basePath = "/bom" }) {
  const directory = useAsyncData(loadFacilities, []);
  const summary = useAsyncData(({ signal }) => loadUtilizationSummary({ signal }), []);
  const [facilityId, setFacilityId] = useState("");
  const window = currentMonthWindow();

  const scope = useAsyncData(async ({ signal }) => {
    if (!facilityId) return null;
    const [structure, units, inventory, capacity] = await Promise.all([
      loadWarehouseStructure(facilityId, { signal }),
      loadFacilityUnits(facilityId, { signal }),
      loadFacilityInventory(facilityId, { signal }),
      loadManagedCapacity(facilityId, { ...window, signal }),
    ]);
    return { structure, units, inventory, capacity };
  }, [facilityId]);

  return (
    <Screen
      title="Báo cáo mức sử dụng"
      description="Tỷ lệ lấp đầy kho riêng và mức sử dụng theo thể tích của từng cơ sở."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button>}
    >
      <AsyncBoundary state={directory} render={(facilities) => (
        <>
          <Kpis items={[
              ["Cơ sở", facilities.length, "Trên toàn hệ thống"],
            ["Đang hoạt động", countBy(facilities, "status", "ACTIVE"), "Trạng thái ACTIVE"],
              ["Thuê kho riêng", facilities.filter((f) => f.serviceTypes.includes("SELF_STORAGE")).length, "Mô hình Thuê kho riêng"],
              ["Lưu trữ hàng hóa", facilities.filter((f) => f.serviceTypes.includes("MANAGED_INVENTORY")).length, "Mô hình Lưu trữ hàng hóa"],
          ]} />

          <Panel title="Tổng hợp toàn hệ thống" subtitle="Số liệu tổng hợp từ máy chủ trên mọi cơ sở bạn được xem.">
            {summary.error
              ? <p className="bom-note">{summary.error}</p>
              : summary.loading
                ? <p role="status" className="text-sm text-slate-500">Đang tải số liệu tổng hợp…</p>
                : <Kpis items={[
                    ["Cơ sở", summary.data?.facilities ?? "—", "Trong phạm vi được xem"],
                    ["Kho riêng", summary.data?.totalUnits ?? "—", "Tổng số kho"],
                    ["Đang sử dụng", summary.data?.occupied ?? "—", "Kho đã có khách"],
                    ["Tỷ lệ lấp đầy kho riêng", rate(summary.data?.selfStorageRate), "Kho đang dùng / kho cho thuê"],
                    ["Thể tích lưu trữ đã dùng", rate(summary.data?.managedVolumeRate), "Thể tích đã dùng / công suất"],
                    ["Tải trọng đã dùng", rate(summary.data?.managedWeightRate), "Khối lượng đã dùng / tải trọng"],
                  ]} />}
          </Panel>

          <Panel
            title="Phạm vi báo cáo"
            subtitle="Mức sử dụng phản ánh tình hình tồn kho hiện tại của cơ sở được chọn."
          >
            <div className="manager-filters">
              <Field label="Cơ sở">
                <Select
                  label="Cơ sở cần xem sử dụng"
                  value={facilityId}
                  onChange={setFacilityId}
                  options={[["", "Chọn cơ sở"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
            </div>
            <p className="text-sm text-slate-500">
              Công suất lưu trữ được tính trong <b>{window.startDate.slice(0, 10)} → {window.endDate.slice(0, 10)}</b> (tháng hiện tại).
            </p>
          </Panel>

          {facilityId && (
            <AsyncBoundary state={scope} render={(data) => (data ? (
              <FacilityUtilization facilityId={facilityId} facilities={facilities} data={data} window={window} onReload={scope.reload} />
            ) : null)} />
          )}
        </>
      )} />
    </Screen>
  );
}

function FacilityUtilization({ facilityId, facilities, data, window, onReload }) {
  const { structure, units, inventory, capacity } = data;
  const [capacityOpen, setCapacityOpen] = useState(false);
  const racks = structure.racks;
  const unitRows = units.rows;
  const itemRows = inventory.rows;
  // Show only the blocks the facility actually sells: units for SELF_STORAGE, capacity and
  // warehouse information for MANAGED_INVENTORY. A facility may offer both models.
  const serviceTypes = (facilities.find((f) => f.id === facilityId) || {}).serviceTypes || [];
  const offersSelfStorage = serviceTypes.includes("SELF_STORAGE");
  const offersManaged = serviceTypes.includes("MANAGED_INVENTORY");

  const unitsTotal = unitRows.length;
  const unitsOccupied = unitRows.filter((u) => UNIT_ALLOCATED.includes(u.status)).length;
  const unitsFree = unitRows.filter((u) => UNIT_FREE.includes(u.status)).length;
  const unitsBlocked = unitRows.filter((u) => UNIT_BLOCKED.includes(u.status)).length;
  const unitsCapacityM3 = sumBy(unitRows, "volumeM3");

  const cells = sumBy(racks, "cellCount");
  const availableCells = sumBy(racks, "availableCellCount");
  const ratedKg = sumBy(racks, "ratedCapacityKg");
  const allocatableKg = sumBy(racks, "allocatableCapacityKg");
  const envelopeM3 = sumBy(racks, "envelopeM3");

  const usedM3 = sumBy(itemRows, "totalVolumeM3");
  const usedKg = sumBy(itemRows, "totalWeightKg");
  const sellableM3 = Number(capacity?.sellableCapacityM3) || 0;
  const committedM3 = Number(capacity?.committedPeakCapacityM3) || 0;
  const availableM3 = Number(capacity?.availableCapacityM3) || 0;

  const sizeRows = BOM_UNIT_SIZES.map((size) => {
    const rows = unitRows.filter((u) => u.size === size);
    const occupied = rows.filter((u) => UNIT_ALLOCATED.includes(u.status)).length;
    return {
      id: size,
      size,
      total: rows.length,
      occupied,
      available: rows.filter((u) => UNIT_FREE.includes(u.status)).length,
      blocked: rows.filter((u) => UNIT_BLOCKED.includes(u.status)).length,
      capacityM3: sumBy(rows, "volumeM3"),
      occupancy: rows.length ? `${Math.round((occupied / rows.length) * 100)}%` : "—",
    };
  });

  return (
    <>
      <Kpis items={[
        ...(offersSelfStorage ? [["Tỷ lệ lấp đầy kho riêng", unitsTotal ? `${Math.round((unitsOccupied / unitsTotal) * 100)}%` : "—", `${unitsOccupied} / ${unitsTotal} kho đang sử dụng`]] : []),
        ...(offersManaged ? [
          ["Thể tích đã dùng", sellableM3 ? `${Math.round(pct(usedM3, sellableM3))}%` : m3(usedM3), sellableM3 ? `${m3(usedM3)} / ${m3(sellableM3)} công suất bán được` : "Chưa cấu hình công suất bán được"],
          ["Ô còn trống", cells ? `${availableCells} / ${cells}` : "—", "Ô có thể xếp thêm hàng"],
          ["Tải trọng có thể phân bổ", kg(allocatableKg), `trên ${kg(ratedKg)} định mức`],
        ] : []),
      ]} />

      {offersSelfStorage && <Panel title="Tỷ lệ lấp đầy kho riêng" subtitle={`${units.rows.length} / ${units.total} kho · ${facilityName(facilities, facilityId)}`}>
        {units.truncated && <TruncatedNotice total={units.total} shown={units.rows.length} />}
        {unitsTotal > 0 && <Meter label="Kho riêng đang sử dụng" used={unitsOccupied} max={unitsTotal} unit="kho" />}
        <div className="mt-5">
          <Details values={[
            ["Đang sử dụng", unitsOccupied],
            ["Sẵn sàng", unitsFree],
            ["Bị chặn (đang giữ / bảo trì / ngưng hoạt động)", unitsBlocked],
            ["Tổng thể tích kho đã đăng ký", m3(unitsCapacityM3)],
          ]} />
        </div>
        <div className="mt-5">
          <Table
            label="Tỷ lệ lấp đầy theo kích cỡ kho"
            rows={sizeRows}
            columns={[
              { key: "size", label: "Kích cỡ kho" },
              { key: "total", label: "Tổng" },
              { key: "occupied", label: "Đang sử dụng" },
              { key: "available", label: "Sẵn sàng" },
              { key: "blocked", label: "Bị chặn" },
              { key: "capacityM3", label: "Công suất", render: (r) => m3(r.capacityM3) },
              { key: "occupancy", label: "Tỷ lệ lấp đầy" },
            ]}
            empty="Cơ sở này chưa đăng ký kho riêng nào."
          />
        </div>
      </Panel>}

      {offersManaged && (
      <Panel
        title="Công suất lưu trữ hàng hóa"
        subtitle={capacity
          ? `Khoảng ${String(capacity.interval?.startDate || window.startDate).slice(0, 10)} → ${String(capacity.interval?.endDate || window.endDate).slice(0, 10)}`
          : "Cơ sở này chưa có cấu hình công suất lưu trữ hàng hóa đang hoạt động."}
        action={<Button variant="outline" onClick={() => setCapacityOpen(true)}>Cấu hình công suất</Button>}
      >
        {capacity ? (
          <>
            <Meter label="Công suất đã cam kết" used={committedM3} max={sellableM3 || committedM3 || 1} />
            <div className="mt-5">
              <Details values={[
                ["Công suất bán được", m3(sellableM3)],
                ["Công suất cam kết cao nhất", m3(committedM3)],
                ["Công suất còn lại", m3(availableM3)],
                ["Tỷ lệ cam kết", `${Math.round(pct(committedM3, sellableM3))}% công suất bán được`],
              ]} />
            </div>
          </>
        ) : (
          <p className="bom-warning">
            Chỉ có công suất khi cơ sở đang hoạt động, có dịch vụ Lưu trữ hàng hóa và đã lưu cấu hình công suất.
          </p>
        )}
        <div className="mt-5">
          <Details values={[
            ["Registered item lots", itemRows.length],
            ["Item volume", m3(usedM3)],
            ["Item weight", kg(usedKg)],
            ["Volume vs sellable capacity", sellableM3 ? `${Math.round(pct(usedM3, sellableM3))}%` : "No sellable capacity"],
            ["Placed on a cell", countBy(itemRows, "placed", true)],
          ]} />
        </div>
        {inventory.truncated && <div className="mt-4"><TruncatedNotice total={inventory.total} shown={itemRows.length} /></div>}
        {capacityOpen && (
          <ManagedCapacityDialog
            facilityId={facilityId}
            facilityLabel={facilityName(facilities, facilityId)}
            configured={Boolean(capacity)}
            onClose={() => setCapacityOpen(false)}
            onSaved={onReload}
          />
        )}
      </Panel>
      )}

      {offersManaged && (
      <Panel title="Thông tin kho và tải trọng">
        {!structure.available && (
          <p className="bom-note mb-5">
            Cơ sở này không thuộc bản đồ kho: {structure.reason || "cơ sở không cung cấp dịch vụ lưu trữ hàng hóa"}.
          </p>
        )}
        <Details values={[
          ["Khu vực", structure.zones.length],
          ["Kệ", racks.length],
          ["Ô lưu trữ", cells ? `${availableCells} / ${cells} ô trống` : "—"],
          ["Tải trọng định mức", kg(ratedKg)],
          ["Tải trọng có thể phân bổ", kg(allocatableKg)],
          ["Thể tích bao kệ", m3(envelopeM3)],
        ]} />
        <div className="mt-5">
          <Table
            label="Tải trọng vật lý của kệ"
            rows={racks}
            columns={[
              { key: "rackCode", label: "Kệ" },
              { key: "zone", label: "Khu vực", render: (r) => `${r.zoneCode} · ${r.zoneName}` },
              { key: "aisleCode", label: "Dãy" },
              { key: "operationalStatus", label: "Trạng thái", render: (r) => <Status value={r.operationalStatus} /> },
              { key: "cells", label: "Ô lưu trữ", render: (r) => `${r.availableCellCount} / ${r.cellCount} ô trống` },
              { key: "envelopeM3", label: "Thể tích bao kệ", render: (r) => m3(r.envelopeM3) },
              { key: "ratedCapacityKg", label: "Định mức / phân bổ được", render: (r) => `${kg(r.ratedCapacityKg)} / ${kg(r.allocatableCapacityKg)}` },
            ]}
            empty="Chưa cấu hình khu vực, kệ hoặc ô lưu trữ cho cơ sở này."
          />
        </div>
      </Panel>
      )}
    </>
  );
}
