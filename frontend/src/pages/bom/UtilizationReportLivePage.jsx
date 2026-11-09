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
import { countBy, formatKg as kg, formatM3 as m3, percent as pct, sumBy } from "@/lib/bomMetrics";

const UNIT_ALLOCATED = ["OCCUPIED"];
const UNIT_FREE = ["AVAILABLE"];
const UNIT_BLOCKED = ["HELD", "MAINTENANCE", "INACTIVE"];

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
      title="Utilization report"
      description="Private-unit occupancy and volume-based physical/allocation utilization per facility."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Back to reports</Link></Button>}
    >
      <AsyncBoundary state={directory} render={(facilities) => (
        <>
          <Kpis items={[
              ["Facilities", facilities.length, "Across all facilities"],
            ["Active", countBy(facilities, "status", "ACTIVE"), "Status ACTIVE"],
              ["Private storage", facilities.filter((f) => f.serviceTypes.includes("SELF_STORAGE")).length, "Self Storage service model"],
              ["Managed inventory", facilities.filter((f) => f.serviceTypes.includes("MANAGED_INVENTORY")).length, "Managed Inventory service model"],
          ]} />

          <Panel
            title="Report scope"
            subtitle="Utilization shows the current stock snapshot for the selected facility."
          >
            <div className="manager-filters">
              <Field label="Facility">
                <Select
                  label="Utilization facility"
                  value={facilityId}
                  onChange={setFacilityId}
                  options={[["", "Select a facility"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
            </div>
            <p className="text-sm text-slate-500">
              Managed capacity is measured over <b>{window.startDate.slice(0, 10)} → {window.endDate.slice(0, 10)}</b> (current calendar month).
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
        ["Private unit occupancy", unitsTotal ? `${Math.round((unitsOccupied / unitsTotal) * 100)}%` : "—", `${unitsOccupied} of ${unitsTotal} units occupied`],
        ["Managed volume used", sellableM3 ? `${Math.round(pct(usedM3, sellableM3))}%` : m3(usedM3), sellableM3 ? `${m3(usedM3)} of ${m3(sellableM3)} sellable` : "No sellable capacity configured"],
        ["Cells available", cells ? `${availableCells} / ${cells}` : "—", "Cells open for new placement"],
        ["Allocatable weight", kg(allocatableKg), `of ${kg(ratedKg)} rated`],
      ]} />

      <Panel title="Private unit occupancy" subtitle={`${units.rows.length} of ${units.total} units · ${facilityName(facilities, facilityId)}`}>
        {units.truncated && <TruncatedNotice total={units.total} shown={units.rows.length} />}
        {unitsTotal > 0 && <Meter label="Occupied private units" used={unitsOccupied} max={unitsTotal} unit="units" />}
        <div className="mt-5">
          <Details values={[
            ["Occupied", unitsOccupied],
            ["Available", unitsFree],
            ["Blocked (held / maintenance / inactive)", unitsBlocked],
            ["Registered unit volume", m3(unitsCapacityM3)],
          ]} />
        </div>
        <div className="mt-5">
          <Table
            label="Occupancy by unit size"
            rows={sizeRows}
            columns={[
              { key: "size", label: "Unit size" },
              { key: "total", label: "Total" },
              { key: "occupied", label: "Occupied" },
              { key: "available", label: "Available" },
              { key: "blocked", label: "Blocked" },
              { key: "capacityM3", label: "Capacity", render: (r) => m3(r.capacityM3) },
              { key: "occupancy", label: "Occupancy" },
            ]}
            empty="No storage unit is registered for this facility."
          />
        </div>
      </Panel>

      <Panel
        title="Managed capacity utilization"
        subtitle={capacity
          ? `Interval ${String(capacity.interval?.startDate || window.startDate).slice(0, 10)} → ${String(capacity.interval?.endDate || window.endDate).slice(0, 10)}`
          : "This facility has no active Managed Inventory capacity configuration."}
        action={<Button variant="outline" onClick={() => setCapacityOpen(true)}>Configure capacity</Button>}
      >
        {capacity ? (
          <>
            <Meter label="Committed managed capacity" used={committedM3} max={sellableM3 || committedM3 || 1} />
            <div className="mt-5">
              <Details values={[
                ["Sellable capacity", m3(sellableM3)],
                ["Committed peak capacity", m3(committedM3)],
                ["Available capacity", m3(availableM3)],
                ["Committed ratio", `${Math.round(pct(committedM3, sellableM3))}% of sellable capacity`],
              ]} />
            </div>
          </>
        ) : (
          <p className="bom-warning">
            Capacity is only available for an ACTIVE Managed Inventory facility with a saved capacity configuration.
            Registered item volume is still reported below.
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

      <Panel title="Warehouse structure and physical capacity" subtitle="Warehouse-map read model (zones → aisles → racks → cells).">
        {!structure.available && (
          <p className="bom-warning mb-5">
            The warehouse map is unavailable for this facility: {structure.reason || "the facility is not part of the managed warehouse map"}.
            Structure counts stay empty, but the managed capacity configuration below can still be reviewed or configured.
          </p>
        )}
        <Details values={[
          ["Zones", structure.zones.length],
          ["Racks", racks.length],
          ["Cells", `${availableCells} of ${cells} available`],
          ["Rated weight capacity", kg(ratedKg)],
          ["Allocatable weight capacity", kg(allocatableKg)],
          ["Rack envelope volume", m3(envelopeM3)],
        ]} />
        <p className="bom-warning mt-5">
          Rack envelope volume is an approximate physical denominator (width × depth × height per rack). Used volume stays 0 until goods are received into a cell.
        </p>
        <div className="mt-5">
          <Table
            label="Rack physical capacity"
            rows={racks}
            columns={[
              { key: "rackCode", label: "Rack" },
              { key: "zone", label: "Zone", render: (r) => `${r.zoneCode} · ${r.zoneName}` },
              { key: "aisleCode", label: "Aisle" },
              { key: "operationalStatus", label: "Status", render: (r) => <Status value={r.operationalStatus} /> },
              { key: "cells", label: "Cells", render: (r) => `${r.availableCellCount} / ${r.cellCount} available` },
              { key: "envelopeM3", label: "Envelope volume", render: (r) => m3(r.envelopeM3) },
              { key: "ratedCapacityKg", label: "Rated / allocatable", render: (r) => `${kg(r.ratedCapacityKg)} / ${kg(r.allocatableCapacityKg)}` },
            ]}
            empty="No warehouse zone, rack or cell is configured for this facility."
          />
        </div>
      </Panel>
    </>
  );
}
