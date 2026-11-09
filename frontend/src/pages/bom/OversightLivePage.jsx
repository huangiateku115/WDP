import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Screen, Panel, Table, Status, Field, Input, Select, Details, Button, Meter,
} from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, LIVE_NOTICE, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import {
  facilityName, loadFacilities, loadFacilityInventory, loadFacilityReservations, loadFacilityUnits, loadWarehouseStructure,
} from "@/lib/bomApiData";
import { BOM_RESERVATION_STATUSES, BOM_SERVICE_TYPES, BOM_UNIT_SIZES } from "@/lib/bomMappers";
import { countBy, formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Cross-facility oversight rebuilt on live reads.
//
// The backend exposes no global aggregate endpoint, so the page never fans out over
// every facility: it lists facilities with ONE request and then loads the heavy,
// facility-scoped reads (warehouse map, units, managed inventory, reservations) for
// the facility the user selects - 4 parallel requests, no N+1.
export default function OversightLivePage({
  oversightRoot = "/bom/oversight", managePath = "/bom/facilities",
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
      loadFacilityReservations(facilityId, { signal }),
    ]);
    return { structure, units, inventory, reservations };
  }, [facilityId]);

  return (
    <Screen
      title="Cross-facility oversight"
      description="Read-only cross-facility visibility built from the live facility, warehouse-map, storage-unit, managed-inventory and reservation APIs."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to={managePath}>Manage facilities</Link></Button>}
    >
      <AsyncBoundary state={directory} render={(facilities) => {
        const rows = facilities.filter((f) =>
          (!status || f.status === status) &&
          (!service || f.serviceTypes.includes(service)) &&
          (!search || `${f.code} ${f.name} ${f.address}`.toLowerCase().includes(search.toLowerCase())));
        return (
          <>
            <Kpis items={[
              ["Facilities", facilities.length, "Backend facility collection"],
              ["Active", countBy(facilities, "status", "ACTIVE"), "Status ACTIVE"],
              ["Private storage", facilities.filter((f) => f.serviceTypes.includes("SELF_STORAGE")).length, "SELF_STORAGE service model"],
              ["Managed inventory", facilities.filter((f) => f.serviceTypes.includes("MANAGED_INVENTORY")).length, "MANAGED_INVENTORY service model"],
            ]} />

            <Panel title="Facility directory" subtitle={`${rows.length} of ${facilities.length} facilities`}>
              <div className="manager-filters">
                <Field label="Search">
                  <Input aria-label="Search facilities" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
                <Field label="Status">
                  <Select label="Facility status filter" value={status} onChange={setStatus}
                    options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
                </Field>
                <Field label="Service model">
                  <Select label="Service model filter" value={service} onChange={setService}
                    options={[["", "All service models"], ...BOM_SERVICE_TYPES]} />
                </Field>
              </div>
              <Table
                label="Facility directory"
                rows={rows}
                columns={[
                  { key: "name", label: "Facility", render: (f) => <Link className="manager-link font-semibold" to={`${oversightRoot}/facilities/${f.id}`}>{f.name}</Link> },
                  { key: "code", label: "Code" },
                  { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
                  { key: "city", label: "City / Province" },
                  { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
                  { key: "openingHours", label: "Opening hours" },
                ]}
                empty="No facilities match the filters."
              />
            </Panel>

            <Panel title="Facility scope" subtitle="Pick one facility to load its live warehouse structure, storage units, managed inventory and reservations.">
              <div className="manager-filters">
                <Field label="Facility">
                  <Select
                    label="Oversight facility"
                    value={facilityId}
                    onChange={setFacilityId}
                    options={[["", "Select a facility"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                  />
                </Field>
              </div>
              {!facilityId && (
                <p className="text-sm text-slate-500">
                  No facility selected. The backend has no cross-facility aggregate endpoint, so scoped reads are issued per facility on demand.
                </p>
              )}
            </Panel>

            {facilityId && (
              <AsyncBoundary state={scope} render={(data) => (data ? (
                <FacilityScope facilityId={facilityId} facilities={facilities} data={data} />
              ) : null)} />
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function FacilityScope({ facilityId, facilities, data }) {
  const { structure, units, inventory, reservations } = data;
  const racks = structure.racks;
  const cells = sumBy(racks, "cellCount");
  const availableCells = sumBy(racks, "availableCellCount");
  const ratedKg = sumBy(racks, "ratedCapacityKg");
  const allocatableKg = sumBy(racks, "allocatableCapacityKg");

  return (
    <>
      <Kpis items={[
        ["Zones", structure.zones.length, `Active zones · ${facilityName(facilities, facilityId)}`],
        ["Racks", racks.length, "Across every active zone"],
        ["Cells", cells, `${availableCells} available for placement`],
        ["Rated capacity", kg(ratedKg), `${kg(allocatableKg)} allocatable across cells`],
      ]} />

      <Panel title="Warehouse structure" subtitle="Live warehouse-map read model (zones -> aisles -> racks -> cells).">
        {racks.length > 0 && <Meter label="Allocatable cell capacity" used={allocatableKg} max={ratedKg || allocatableKg || 1} unit="kg" />}
        <p className="bom-warning mt-4">
          Used weight reads 0 until Staff confirm an inbound for an item, because the rack total is the sum of its cell counters.
        </p>
        <Table
          label="Warehouse racks"
          rows={racks}
          columns={[
            { key: "rackCode", label: "Rack" },
            { key: "zone", label: "Zone", render: (r) => `${r.zoneCode} · ${r.zoneName}` },
            { key: "aisleCode", label: "Aisle" },
            { key: "operationalStatus", label: "Status", render: (r) => <Status value={r.operationalStatus} /> },
            { key: "cells", label: "Cells", render: (r) => `${r.availableCellCount} / ${r.cellCount} available` },
            { key: "capacity", label: "Rated / allocatable", render: (r) => `${kg(r.ratedCapacityKg)} / ${kg(r.allocatableCapacityKg)}` },
            { key: "utilizationStatus", label: "Utilization", render: (r) => <Status value={r.utilizationStatus} /> },
          ]}
          empty="No warehouse zone, rack or cell is configured for this facility."
        />
      </Panel>

      <Panel title="Private storage units" subtitle={`${units.rows.length} of ${units.total} units`}>
        {units.truncated && <TruncatedNotice total={units.total} shown={units.rows.length} />}
        <Details values={[
          ["Occupied", countBy(units.rows, "status", "OCCUPIED")],
          ["Available", countBy(units.rows, "status", "AVAILABLE")],
          ["Held / maintenance", countBy(units.rows, "status", "HELD") + countBy(units.rows, "status", "MAINTENANCE")],
          ["By size", BOM_UNIT_SIZES.map((size) => `${size}: ${countBy(units.rows, "size", size)}`).join(" · ")],
        ]} />
        <div className="mt-5">
          <Table
            label="Storage units"
            rows={units.rows}
            columns={[
              { key: "code", label: "Unit" },
              { key: "size", label: "Size" },
              { key: "volumeM3", label: "Volume", render: (r) => m3(r.volumeM3) },
              { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
            ]}
            empty="No storage units are registered for this facility."
          />
        </div>
      </Panel>

      <Panel title="Managed inventory items" subtitle={`${inventory.rows.length} of ${inventory.total} registered items`}>
        {inventory.truncated && <TruncatedNotice total={inventory.total} shown={inventory.rows.length} />}
        <Details values={[
          ["Registered lots", inventory.rows.length],
          ["Total volume", m3(sumBy(inventory.rows, "totalVolumeM3"))],
          ["Total weight", kg(sumBy(inventory.rows, "totalWeightKg"))],
          ["Placed on a cell", countBy(inventory.rows, "placed", true)],
        ]} />
        <div className="mt-5">
          <Table
            label="Managed inventory items"
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
            empty="No managed inventory item is registered for this facility."
          />
        </div>
      </Panel>

      <Panel title="Reservations" subtitle={`${reservations.length} records for this facility`}>
        <Details values={BOM_RESERVATION_STATUSES.map((value) => [value, countBy(reservations, "status", value)])} />
        <div className="mt-5">
          <Table
            label="Facility reservations"
            rows={reservations}
            columns={[
              { key: "code", label: "Reservation" },
              { key: "customer", label: "Customer", render: (r) => r.customerName },
              { key: "service", label: "Service", render: (r) => String(r.service || "").replaceAll("_", " ") },
              { key: "resource", label: "Unit / capacity", render: (r) => r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : "—") },
              { key: "period", label: "Period", render: (r) => `${r.startDate} → ${r.endDate}` },
              { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
            ]}
            empty="No reservation exists for this facility."
          />
        </div>
      </Panel>
    </>
  );
}
