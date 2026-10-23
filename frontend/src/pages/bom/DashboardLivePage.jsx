import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Details, Button, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, LIVE_NOTICE, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadReservations, facilityName } from "@/lib/bomApiData";

const countBy = (rows, status) => rows.filter((row) => row.status === status).length;
const MAX_FACILITY_FETCHES = 12;

// Live BOM dashboard: facility inventory + cross-facility reservations from the confirmed APIs.
// Revenue/utilization/audit stay demo until their backend contracts exist.
export default function DashboardLivePage() {
  const state = useAsyncData(async ({ signal }) => {
    const facilities = await loadFacilities();
    const { rows, truncated } = await loadReservations(facilities, { signal });
    return { facilities, reservations: rows, truncated };
  }, []);

  return (
    <Screen
      title="Business across every facility"
      description="Live facility and reservation data from the confirmed BOM APIs. Revenue, utilization and audit stay demo until their backend contracts exist."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to="/bom/facilities">Manage facilities</Link></Button>}
    >
      <AsyncBoundary state={state} render={({ facilities, reservations, truncated }) => {
        const byFacility = facilities.map((f) => {
          const rows = reservations.filter((r) => r.facilityId === f.id);
          return {
            id: f.id,
            name: f.name,
            status: f.status,
            total: rows.length,
            reserved: countBy(rows, "RESERVED"),
            active: countBy(rows, "ACTIVE"),
            overdue: countBy(rows, "OVERDUE"),
          };
        });
        const recent = [...reservations]
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 20);

        return (
          <>
            <Kpis items={[
              ["Total facilities", facilities.length, "Facility records from the backend"],
              ["Active facilities", facilities.filter((f) => f.status === "ACTIVE").length, "Accepting new reservations"],
              ["Total reservations", reservations.length, "Across every fetched facility"],
              ["Active rentals", countBy(reservations, "ACTIVE"), "Reservations with status ACTIVE"],
              ["Awaiting approval", countBy(reservations, "RESERVED"), "Reservations with status RESERVED"],
              ["Overdue", countBy(reservations, "OVERDUE"), "Reservations with status OVERDUE"],
              ["Closed", countBy(reservations, "CLOSED"), "Reservations with status CLOSED"],
              ["Cancelled", countBy(reservations, "CANCELLED"), "Reservations with status CANCELLED"],
            ]} />
            {truncated && <TruncatedNotice total={facilities.length} shown={Math.min(facilities.length, MAX_FACILITY_FETCHES)} />}
            <Panel title="Reservations by facility" subtitle="Counts derived from the confirmed per-facility reservation API.">
              <Table
                label="Reservations by facility"
                rows={byFacility}
                columns={[
                  { key: "name", label: "Facility", render: (r) => <Link className="manager-link" to={`/bom/facilities/${r.id}`} state={{ from: "/bom/dashboard" }}>{r.name}</Link> },
                  { key: "status", label: "Business status", render: (r) => <Status value={r.status} /> },
                  { key: "total", label: "Reservations" },
                  { key: "reserved", label: "Reserved" },
                  { key: "active", label: "Active" },
                  { key: "overdue", label: "Overdue" },
                ]}
                empty="No facilities were returned by the backend."
              />
            </Panel>
            <Panel title="Recent reservations" subtitle="Latest 20 records across the fetched facilities.">
              <Table
                label="Recent reservations"
                rows={recent}
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
                empty="No reservations were returned for the fetched facilities."
              />
            </Panel>
            <Panel title="Still demo (backend contract pending)">
              <Details values={[
                ["Revenue reports", "Demo — no payment/report API yet"],
                ["Inventory placement", "Backend inbound confirmation exists (items land on cells); no live console screen for it yet"],
                ["Business audit", "Demo — backend audit endpoints are per-user only"],
              ]} />
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild variant="outline"><Link to="/bom/oversight">Open oversight</Link></Button>
                <Button asChild variant="outline"><Link to="/bom/reports">Open reports (demo)</Link></Button>
              </div>
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
