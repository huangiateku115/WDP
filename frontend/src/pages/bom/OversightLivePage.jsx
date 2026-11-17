import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Screen, Panel, Table, Status, Field, Input, Select, Details, Button, Meter,
} from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { ResourceThumb } from "@/components/bom/ResourceImages";
import { useAsyncData } from "@/lib/useAsyncData";
import {
  facilityName, loadFacilities, loadFacilityInventory, loadFacilityReservationsAll, loadFacilityUnits, loadWarehouseStructure,
  reservationScopeLabel,
} from "@/lib/bomApiData";
import { BOM_RESERVATION_STATUSES, BOM_SERVICE_TYPES, BOM_UNIT_SIZES, serviceLabel } from "@/lib/bomMappers";
import { countBy, formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Cross-facility oversight rebuilt on live reads.
//
// The backend exposes no global aggregate endpoint, so the page never fans out over
// every facility: it lists facilities with ONE request and then loads the heavy,
// facility-scoped reads (warehouse map, units, managed inventory, reservations) for
// the facility the user selects - 4 parallel requests, no N+1.
export default function OversightLivePage({
  oversightRoot = "/bom/oversight", managePath = "/bom/facilities", reservationsBase = "/bom/reservations",
}) {
  const directory = useAsyncData(loadFacilities, []);
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [service, setService] = useState("");
  const [search, setSearch] = useState("");

  const scope = useAsyncData(async ({ signal }) => {
    if (!facilityId) return null;
    const [structure, units, inventory, reservations] = await Promise.all([
      loadWarehouseStructure(facilityId, { signal }),
      loadFacilityUnits(facilityId, { signal }),
      loadFacilityInventory(facilityId, { signal }),
      loadFacilityReservationsAll(facilityId, { signal }),
    ]);
    return { structure, units, inventory, reservations };
  }, [facilityId]);

  return (
    <Screen
      title="Giám sát đa cơ sở"
      description="Theo dõi cơ sở, kho, kho riêng, hàng hóa và đơn đặt thuê trên toàn hệ thống."
      action={<Button asChild variant="outline"><Link to={managePath}>Quản lý cơ sở</Link></Button>}
    >
      <AsyncBoundary state={directory} render={(facilities) => {
        const rows = facilities.filter((f) =>
          (!status || f.status === status) &&
          (!service || f.serviceTypes.includes(service)) &&
          (!search || `${f.code} ${f.name} ${f.address}`.toLowerCase().includes(search.toLowerCase())));
        return (
          <>
            <Kpis items={[
              ["Cơ sở", facilities.length, "Trên toàn hệ thống"],
              ["Đang hoạt động", countBy(facilities, "status", "ACTIVE"), "Trạng thái ACTIVE"],
              ["Thuê kho riêng", facilities.filter((f) => f.serviceTypes.includes("SELF_STORAGE")).length, "Mô hình Thuê kho riêng"],
              ["Lưu trữ hàng hóa", facilities.filter((f) => f.serviceTypes.includes("MANAGED_INVENTORY")).length, "Mô hình Lưu trữ hàng hóa"],
            ]} />

            <Panel title="Danh sách cơ sở" subtitle={`${rows.length} / ${facilities.length} cơ sở`}>
              <div className="manager-filters">
                <Field label="Tìm kiếm">
                  <Input aria-label="Tìm cơ sở" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
                <Field label="Trạng thái">
                  <Select label="Lọc theo trạng thái cơ sở" value={status} onChange={setStatus}
                    options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
                </Field>
                <Field label="Mô hình dịch vụ">
                  <Select label="Lọc theo mô hình dịch vụ" value={service} onChange={setService}
                    options={[["", "Tất cả mô hình dịch vụ"], ...BOM_SERVICE_TYPES.map((s) => [s, serviceLabel(s)])]} />
                </Field>
              </div>
              <Table
                label="Danh sách cơ sở"
                rows={rows}
                columns={[
                  { key: "cover", label: "Photo", render: (f) => <ResourceThumb src={f.coverImage} alt={`${f.name} cover`} /> },
                  { key: "name", label: "Facility", render: (f) => <Link className="manager-link font-semibold" to={`${oversightRoot}/facilities/${f.id}`}>{f.name}</Link> },
                  { key: "code", label: "Code" },
                  { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
                  { key: "city", label: "City / Province" },
                  { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
                  { key: "openingHours", label: "Opening hours" },
                ]}
                empty="Không có cơ sở phù hợp bộ lọc."
              />
            </Panel>

            <Panel title="Phạm vi cơ sở" subtitle="Chọn một cơ sở để tải cấu trúc kho, kho riêng, hàng hóa và đơn đặt thuê.">
              <div className="manager-filters">
                <Field label="Cơ sở">
                  <Select
                    label="Cơ sở cần giám sát"
                    value={facilityId}
                    onChange={setFacilityId}
                    options={[["", "Chọn cơ sở"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                  />
                </Field>
              </div>
              {!facilityId && (
                <p className="text-sm text-slate-500">
                  Chọn một cơ sở để xem dữ liệu vận hành.
                </p>
              )}
            </Panel>

            {facilityId && (
              <AsyncBoundary state={scope} render={(data) => (data ? (
                <FacilityScope facilityId={facilityId} facilities={facilities} data={data} reservationsBase={reservationsBase} />
              ) : null)} />
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function FacilityScope({ facilityId, facilities, data, reservationsBase }) {
  const { structure, units, inventory, reservations } = data;
  const reservationRows = reservations.rows;
  const racks = structure.racks;
  const cells = sumBy(racks, "cellCount");
  const availableCells = sumBy(racks, "availableCellCount");
  const ratedKg = sumBy(racks, "ratedCapacityKg");
  const allocatableKg = sumBy(racks, "allocatableCapacityKg");
  // Only render the blocks the facility actually sells: private units for SELF_STORAGE,
  // warehouse/inventory for MANAGED_INVENTORY. A facility can offer both.
  const serviceTypes = (facilities.find((f) => f.id === facilityId) || {}).serviceTypes || [];
  const offersSelfStorage = serviceTypes.includes("SELF_STORAGE");
  const offersManaged = serviceTypes.includes("MANAGED_INVENTORY");

  return (
    <>
      {offersManaged && <Kpis items={[
        ["Khu vực", structure.zones.length, `Khu vực đang hoạt động · ${facilityName(facilities, facilityId)}`],
        ["Kệ", racks.length, "Trong mọi khu vực đang hoạt động"],
        ["Ô chứa", cells, `${availableCells} ô còn trống để xếp hàng`],
        ["Tải trọng định mức", kg(ratedKg), `${kg(allocatableKg)} có thể phân bổ theo ô`],
      ]} />}

      {offersManaged && <Panel title="Thông tin kho">
        {racks.length > 0 && <Meter label="Tải trọng ô có thể phân bổ" used={allocatableKg} max={ratedKg || allocatableKg || 1} unit="kg" />}
        <p className="bom-note mt-4">
          Tải trọng đã dùng bằng 0 cho đến khi nhân viên xác nhận nhập kho.
        </p>
        <Table
          label="Kệ trong cơ sở"
          rows={racks}
          columns={[
            { key: "rackCode", label: "Rack" },
            { key: "zone", label: "Zone", render: (r) => `${r.zoneCode} · ${r.zoneName}` },
            { key: "aisleCode", label: "Aisle" },
            { key: "operationalStatus", label: "Status", render: (r) => <Status value={r.operationalStatus} /> },
            { key: "cells", label: "Cells", render: (r) => `${r.availableCellCount} / ${r.cellCount} ô trống` },
            { key: "capacity", label: "Rated / allocatable", render: (r) => `${kg(r.ratedCapacityKg)} / ${kg(r.allocatableCapacityKg)}` },
            { key: "utilizationStatus", label: "Utilization", render: (r) => <Status value={r.utilizationStatus} /> },
          ]}
          empty="Chưa cấu hình khu vực, kệ hoặc ô chứa cho cơ sở này."
        />
      </Panel>}

      {offersSelfStorage && <Panel title="Kho riêng" subtitle={`${units.rows.length} / ${units.total} kho`}>
        {units.truncated && <TruncatedNotice total={units.total} shown={units.rows.length} />}
        <Details values={[
          ["Occupied", countBy(units.rows, "status", "OCCUPIED")],
          ["Available", countBy(units.rows, "status", "AVAILABLE")],
          ["Held / maintenance", countBy(units.rows, "status", "HELD") + countBy(units.rows, "status", "MAINTENANCE")],
          ["By size", BOM_UNIT_SIZES.map((size) => `${size}: ${countBy(units.rows, "size", size)}`).join(" · ")],
        ]} />
        <div className="mt-5">
          <Table
            label="Kho riêng của cơ sở"
            rows={units.rows}
            columns={[
              { key: "photo", label: "Photo", render: (r) => <ResourceThumb src={r.coverImage} alt={`${r.code} photo`} /> },
              { key: "code", label: "Unit" },
              { key: "size", label: "Size" },
              { key: "volumeM3", label: "Volume", render: (r) => m3(r.volumeM3) },
              { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
            ]}
            empty="Cơ sở này chưa đăng ký kho riêng nào."
          />
        </div>
      </Panel>}

      {offersManaged && <Panel title="Hàng hóa lưu trữ" subtitle={`${inventory.rows.length} / ${inventory.total} mặt hàng đã đăng ký`}>
        {inventory.truncated && <TruncatedNotice total={inventory.total} shown={inventory.rows.length} />}
        <Details values={[
          ["Số lô đã đăng ký", inventory.rows.length],
          ["Tổng thể tích", m3(sumBy(inventory.rows, "totalVolumeM3"))],
          ["Tổng khối lượng", kg(sumBy(inventory.rows, "totalWeightKg"))],
          ["Đã xếp vào ô", countBy(inventory.rows, "placed", true)],
        ]} />
        <div className="mt-5">
          <Table
            label="Hàng hóa lưu trữ"
            rows={inventory.rows}
            columns={[
              { key: "code", label: "Item code" },
              { key: "name", label: "Name" },
              { key: "category", label: "Category" },
                { key: "quantity", label: "Quantity", render: (r) => `${r.quantity} ${r.quantityUnit || ""}`.trim() },
              { key: "totalVolumeM3", label: "Volume", render: (r) => m3(r.totalVolumeM3) },
              { key: "totalWeightKg", label: "Weight", render: (r) => kg(r.totalWeightKg) },
              { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
            ]}
            empty="Cơ sở này chưa có mặt hàng lưu trữ nào."
          />
        </div>
      </Panel>}

      <Panel title="Đơn đặt thuê" subtitle={`${reservationRows.length} bản ghi của cơ sở này`}>
        {reservations.failedServiceTypes.length > 0 && (
          <p className="bom-warning mb-4">
            Không tải được đơn {reservationScopeLabel(reservations.failedServiceTypes)} của cơ sở này, nên các số liệu bên dưới
            không bao gồm chúng. Hãy tải lại để thử lại.
          </p>
        )}
        <Details values={BOM_RESERVATION_STATUSES.map((value) => [value, countBy(reservationRows, "status", value)])} />
        <div className="mt-5">
          <Table
            label="Đơn đặt thuê của cơ sở"
            rows={reservationRows}
            columns={[
              {
                key: "code",
                label: "Reservation",
                render: (r) => (
                  <Link className="manager-link" to={`${reservationsBase}/${r.isManaged ? "managed/" : ""}${r.id}`}>
                    {r.code || r.id}
                  </Link>
                ),
              },
              { key: "customer", label: "Customer", render: (r) => r.customerName },
                  { key: "service", label: "Service", render: (r) => serviceLabel(r.service) },
              { key: "resource", label: "Unit / capacity", render: (r) => r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : "—") },
              { key: "period", label: "Period", render: (r) => `${r.startDate} → ${r.endDate}` },
              { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
            ]}
            empty="Cơ sở này chưa có đơn đặt thuê nào."
          />
        </div>
      </Panel>
    </>
  );
}
