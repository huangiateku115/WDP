import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Field, Input, Select, Button, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, LIVE_NOTICE, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadReservations, facilityName } from "@/lib/bomApiData";
import { BOM_RESERVATION_STATUSES } from "@/lib/bomMappers";

const countBy = (rows, status) => rows.filter((row) => row.status === status).length;
const MAX_FACILITY_FETCHES = 12;

// Rental lifecycle report driven by the confirmed reservation API.
// Payment/revenue totals still need a cross-facility payment ledger endpoint.
export default function RentalReportLivePage({ basePath = "/bom" }) {
  const state = useAsyncData(async ({ signal }) => {
    const facilities = await loadFacilities();
    const { rows, truncated } = await loadReservations(facilities, { signal });
    return { facilities, reservations: rows, truncated };
  }, []);
  const [facility, setFacility] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  return (
    <Screen
      title="Rental lifecycle report"
      description="Reservations across every facility from the confirmed reservation API. Revenue totals await a cross-facility payment ledger endpoint."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Back to reports</Link></Button>}
    >
      <AsyncBoundary state={state} render={({ facilities, reservations, truncated }) => {
        const rows = reservations.filter((r) =>
          (!facility || r.facilityId === facility) &&
          (!status || r.status === status) &&
          (!search || `${r.code} ${r.customerName}`.toLowerCase().includes(search.toLowerCase())));
        return (
          <>
            <Kpis items={[
              ["Reservations", reservations.length, "Across every fetched facility"],
              ["Active", countBy(reservations, "ACTIVE"), "Status ACTIVE"],
              ["Overdue", countBy(reservations, "OVERDUE"), "Status OVERDUE"],
              ["Closed", countBy(reservations, "CLOSED"), "Status CLOSED"],
            ]} />
            <Panel title="Filters">
              <div className="manager-filters">
                <Field label="Facility">
                  <Select label="Facility filter" value={facility} onChange={setFacility}
                    options={[["", "All facilities"], ...facilities.map((f) => [f.id, f.name])]} />
                </Field>
                <Field label="Status">
                  <Select label="Status filter" value={status} onChange={setStatus}
                    options={[["", "All statuses"], ...BOM_RESERVATION_STATUSES]} />
                </Field>
                <Field label="Search">
                  <Input aria-label="Search reservations" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
              </div>
            </Panel>
            <Panel title="Reservations" subtitle={`${rows.length} of ${reservations.length} records`}>
              {truncated && <TruncatedNotice total={facilities.length} shown={Math.min(facilities.length, MAX_FACILITY_FETCHES)} />}
              <Table
                label="Rental lifecycle"
                rows={rows}
                columns={[
                  { key: "code", label: "Reservation" },
                  { key: "facility", label: "Facility", render: (r) => facilityName(facilities, r.facilityId) },
                  { key: "customer", label: "Customer", render: (r) => r.customerName },
                  { key: "service", label: "Service", render: (r) => String(r.service || "").replaceAll("_", " ") },
                  { key: "resource", label: "Unit / capacity", render: (r) => r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : "—") },
                  { key: "period", label: "Period", render: (r) => `${r.startDate} → ${r.endDate}` },
                  { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  { key: "rent", label: "Estimated rent", render: (r) => money(r.estimatedRent) },
                ]}
                empty="No reservations match the filters."
              />
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
