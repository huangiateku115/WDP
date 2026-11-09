import { useState } from "react";
import { Screen, Panel, Table, Status, Field, Select, Input, Button } from "@/components/manager/ManagerUI";
import { AsyncBoundary, TruncatedNotice, ConfirmDialog } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { UnitDialog, UnitStatusDialog } from "@/components/bom/StorageUnitDialogs";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityUnits } from "@/lib/bomApiData";
import { bomUnitApi } from "@/api/bomApi";
import { BOM_UNIT_SIZES } from "@/lib/bomMappers";
import { countBy, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Storage unit console shared by BOM and Admin. ADMIN, BOM and FACILITY_MANAGER may write;
// creation additionally requires the facility to be ACTIVE and to offer SELF_STORAGE.
// The list accepts status / size / search filters and is paged server-side.
const SELF_STORAGE = "SELF_STORAGE";
const wc = (conditions) => Object.fromEntries(Object.entries(conditions).filter(([, value]) => value));

export default function StorageUnitsPage() {
  const directory = useAsyncData(loadFacilities, []);
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [size, setSize] = useState("");
  const [search, setSearch] = useState("");
  const [unitDialog, setUnitDialog] = useState(null);
  const [statusDialog, setStatusDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const units = useAsyncData(
    ({ signal }) => (facilityId
      ? loadFacilityUnits(facilityId, { signal, ...wc({ status, size, search: search.trim() }) })
      : Promise.resolve(null)),
    [facilityId, status, size, search],
  );

  function selectFacility(id) {
    setFacilityId(id);
    setStatus("");
    setSize("");
    setSearch("");
  }

  function removeUnit(unit) {
    setConfirm({
      title: `Delete unit ${unit.code}?`,
      summary: "Units are soft deleted: HELD and OCCUPIED units are rejected with 409. Deleted units disappear from every list, so they cannot be restored from this console.",
      label: "Delete unit",
      run: async () => { await bomUnitApi.remove(unit.id); units.reload(); },
    });
  }

  return (
    <Screen
      title="Storage units"
      description="Private storage units per facility. Create, edit, change status or delete the units of a facility."
    >
      <AsyncBoundary state={directory} render={(facilities) => {
        const facility = facilities.find((f) => f.id === facilityId);
        const canWrite = Boolean(facility && facility.status === "ACTIVE" && facility.serviceTypes.includes(SELF_STORAGE));
        const rows = units.data?.rows || [];
        return (
          <>
            <Kpis items={[
              ["Facilities", facilities.length, "Backend facility collection"],
              ["Units loaded", units.data?.total ?? "—", "Matches the current filters"],
              ["Available", countBy(rows, "status", "AVAILABLE"), "Ready to rent"],
              ["Registered volume", m3(sumBy(rows, "volumeM3")), "Derived from unit dimensions"],
            ]} />

            <Panel
              title="Unit scope"
              subtitle="Reads work for any facility; creating units additionally requires ACTIVE + SELF_STORAGE on the backend."
            >
              <div className="manager-filters">
                <Field label="Facility">
                  <Select
                    label="Unit facility"
                    value={facilityId}
                    onChange={selectFacility}
                    options={[["", "Select a facility"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                  />
                </Field>
                <Field label="Status">
                  <Select
                    label="Unit status filter"
                    value={status}
                    onChange={setStatus}
                    options={[["", "All statuses"], ["AVAILABLE", "Available"], ["MAINTENANCE", "Maintenance"], ["INACTIVE", "Inactive"], ["HELD", "Held"], ["OCCUPIED", "Occupied"]]}
                  />
                </Field>
                <Field label="Size">
                  <Select
                    label="Unit size filter"
                    value={size}
                    onChange={setSize}
                    options={[["", "All sizes"], ...BOM_UNIT_SIZES.map((s) => [s, s])]}
                  />
                </Field>
                <Field label="Search" hint="Matches the unit code.">
                  <Input aria-label="Search storage units" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
              </div>
              {facility && !canWrite && (
                <p className="bom-warning mt-5">
                  {facility.name} is {facility.status} and does not offer SELF_STORAGE, so the backend rejects unit creation with 409.
                </p>
              )}
            </Panel>

            {!facilityId && (
              <Panel title="Select a facility">
                <p className="text-sm text-slate-500">Storage units belong to one facility.</p>
              </Panel>
            )}

            {facilityId && (
              <AsyncBoundary state={units} render={(data) => (data ? (
                <Panel
                  title="Unit register"
                  subtitle={`${data.total} unit${data.total === 1 ? "" : "s"} · ${countBy(data.rows, "status", "AVAILABLE")} available`}
                  action={<Button onClick={() => setUnitDialog("new")} disabled={!canWrite}>Create unit</Button>}
                >
                  {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
                  <div className="mt-5">
                    <Table
                      label="Storage units"
                      rows={data.rows}
                      columns={[
                        { key: "code", label: "Unit" },
                        { key: "size", label: "Size" },
                        { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                        {
                          key: "dimensions",
                          label: "Dimensions",
                          render: (r) => {
                            const d = r.dimensions || {};
                            return d.lengthM ? `${d.lengthM}×${d.widthM}×${d.heightM} m` : "—";
                          },
                        },
                        { key: "volumeM3", label: "Volume", render: (r) => m3(r.volumeM3) },
                        { key: "description", label: "Description", render: (r) => r.description || "—" },
                        {
                          key: "actions",
                          label: "Actions",
                          render: (r) => {
                            const locked = r.status === "HELD" || r.status === "OCCUPIED";
                            return (
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" disabled={locked} onClick={() => setUnitDialog(r)}>Edit</Button>
                                <Button size="sm" variant="outline" disabled={locked} onClick={() => setStatusDialog(r)}>Status</Button>
                                <Button size="sm" variant="outline" disabled={locked} onClick={() => removeUnit(r)}>Delete</Button>
                              </div>
                            );
                          },
                        },
                      ]}
                      empty="No storage unit matches the current filters."
                    />
                  </div>
                </Panel>
              ) : null)} />
            )}
          </>
        );
      }} />

      {unitDialog && (
        <UnitDialog
          facilityId={facilityId}
          unit={unitDialog === "new" ? null : unitDialog}
          onClose={() => setUnitDialog(null)}
          onSaved={() => units.reload()}
        />
      )}
      {statusDialog && (
        <UnitStatusDialog unit={statusDialog} onClose={() => setStatusDialog(null)} onSaved={() => units.reload()} />
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
