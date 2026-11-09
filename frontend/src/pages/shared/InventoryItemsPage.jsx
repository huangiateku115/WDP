import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Select, Input, Button, Details, Timeline,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadInventoryItem, loadInventoryItems, loadItemMovements } from "@/lib/bomApiData";
import customerProfileApi from "@/api/customerProfileApi";
import { formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Managed Inventory console shared by BOM and Admin.
// Backend contract (inventory-item.routes.ts): GET /inventory-items is readable by
// ADMIN/BOM/FM/STAFF and accepts facilityId, customerId, category, status, search + paging;
// without facilityId ADMIN/BOM receive every facility. GET /inventory-items/:id returns the
// item, GET /inventory-items/:id/movements the immutable inbound ledger.
// Physical inbound (request/confirm/reject) is FACILITY_STAFF-only, so this console is
// read-only by design: it reports what Staff confirmed rather than performing it.
const ITEM_STATUSES = ["REGISTERED", "PENDING_INBOUND", "RECEIVED_PENDING_ACCEPTANCE", "IN_STORAGE", "PENDING_OUTBOUND", "CHECKED_OUT"];
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const stamp = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");
const filtered = (conditions) => Object.fromEntries(Object.entries(conditions).filter(([, value]) => value));

export default function InventoryItemsPage({ basePath = "/admin/inventory" }) {
  const { id } = useParams();
  if (id) return <ItemDetail key={id} id={id} basePath={basePath} />;
  return <ItemList basePath={basePath} />;
}

function ItemList({ basePath }) {
  const directory = useAsyncData(loadFacilities, []);
  const profiles = useAsyncData(({ signal }) => customerProfileApi.list({ signal }).then((r) => r?.data?.data ?? []).catch(() => []), []);
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const items = useAsyncData(
    ({ signal }) => loadInventoryItems(filtered({ facilityId, status, category: category.trim(), search: search.trim() }), { signal }),
    [facilityId, status, category, search],
  );

  const facilities = directory.data || [];
  const nameOfFacility = (id) => facilities.find((f) => f.id === id)?.name || "Unknown facility";
  const customers = new Map((profiles.data || []).map((p) => [String(p.userId?._id || p.userId || ""), p.userId?.email || p.userId?.fullName || p._id]));
  const owner = (customerId) => customers.get(String(customerId)) || (customerId ? `${String(customerId).slice(0, 8)}…` : "—");
  const rows = items.data?.rows || [];

  return (
    <Screen
      title="Managed inventory"
      description="Every inventory lot registered by customers, its placement state and the cell that holds it. Staff perform the physical inbound; this console reports the result."
      action={<Button variant="outline" disabled={items.loading} onClick={items.reload}>Refresh</Button>}
    >
      <AsyncBoundary state={directory} render={() => (
        <>
          <Kpis items={[
            ["Inventory lots", items.data?.total ?? "—", facilityId ? "In the selected facility" : "Across every facility"],
            ["In storage", rows.filter((r) => r.status === "IN_STORAGE").length, "Placed on a cell"],
            ["Pending inbound", rows.filter((r) => r.status === "PENDING_INBOUND").length, "Waiting for Staff confirmation"],
            ["Stored volume", m3(sumBy(rows, "totalVolumeM3")), "Registered item volume"],
          ]} />

          <Panel
            title="Filters"
            subtitle="Filters apply to the whole list. Leave the facility empty to list every facility."
          >
            <div className="manager-filters">
              <Field label="Facility">
                <Select
                  label="Inventory facility"
                  value={facilityId}
                  onChange={setFacilityId}
                  options={[["", "All facilities"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
              <Field label="Status">
                <Select
                  label="Inventory status filter"
                  value={status}
                  onChange={setStatus}
                  options={[["", "All statuses"], ...ITEM_STATUSES.map((s) => [s, s.replaceAll("_", " ")])]}
                />
              </Field>
              <Field label="Category" hint="Exact match on the item category.">
                <Input aria-label="Inventory category filter" value={category} onChange={(e) => setCategory(e.target.value)} />
              </Field>
              <Field label="Search" hint="Item code, name or category.">
                <Input aria-label="Search inventory items" value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
            </div>
            <p className="bom-warning mt-5">
              The effective Item Category policy applies at inbound, so a lot can only be stored when its category is
              allowed by the facility policy.
            </p>
          </Panel>

          <AsyncBoundary state={items} render={(data) => (data ? (
            <Panel title="Inventory lots" subtitle={`${data.total} lot${data.total === 1 ? "" : "s"} · ${rows.filter((r) => r.placed).length} placed on a cell`}>
              {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
              <Table
                label="Managed inventory"
                rows={data.rows}
                columns={[
                  { key: "code", label: "Item", render: (r) => <OpenLink to={`${basePath}/${r.id}`}>{r.code || r.name}</OpenLink> },
                  { key: "name", label: "Name" },
                  { key: "category", label: "Category", render: (r) => r.category || "—" },
                  { key: "owner", label: "Customer", render: (r) => owner(r.customerId) },
                  { key: "facility", label: "Facility", render: (r) => nameOfFacility(r.facilityId) },
                  { key: "quantity", label: "Quantity", render: (r) => `${r.quantity} ${r.quantityUnit || ""}`.trim() },
                  { key: "totalVolumeM3", label: "Volume", render: (r) => m3(r.totalVolumeM3) },
                  { key: "totalWeightKg", label: "Weight", render: (r) => kg(r.totalWeightKg) },
                  { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  { key: "cell", label: "Cell", render: (r) => (r.currentCellId ? "Placed" : r.preferredCellId ? "Preferred only" : "—") },
                  { key: "createdAt", label: "Registered", render: (r) => day(r.createdAt) },
                ]}
                empty="No inventory lot matches the current filters."
              />
            </Panel>
          ) : null)} />
        </>
      )} />
    </Screen>
  );
}

function ItemDetail({ id, basePath }) {
  const item = useAsyncData(({ signal }) => loadInventoryItem(id, { signal }), [id]);
  const movements = useAsyncData(({ signal }) => loadItemMovements(id, { signal }), [id]);

  return (
    <Screen
      title="Inventory lot"
      description="Registered goods, its Managed reservation link, placement state and the immutable movement ledger written by Staff inbounds."
      action={<Button asChild variant="outline"><Link to={basePath}>Back to inventory</Link></Button>}
    >
      <AsyncBoundary state={item} render={(row) => (
        <>
          <Panel
            title={row.name || "Inventory lot"}
            subtitle={row.code}
            action={<Status value={row.status} />}
          >
            <Details values={[
              ["Item code", row.code || "—"],
              ["Category", row.category || "—"],
              ["Quantity", `${row.quantity} ${row.quantityUnit || ""}`.trim()],
              ["Unit weight", kg(row.unitWeightKg)],
              ["Unit dimensions", row.unitDimensionsM
                ? `${row.unitDimensionsM.widthM} × ${row.unitDimensionsM.depthM} × ${row.unitDimensionsM.heightM} m`
                : "—"],
              ["Unit volume", m3(row.unitVolumeM3)],
              ["Total volume", m3(row.totalVolumeM3)],
              ["Total weight", kg(row.totalWeightKg)],
              ["Managed reservation", row.reservationId || "—"],
              ["Placement", row.currentCellId ? `Stored on cell ${row.currentCellId}` : row.preferredCellId ? "Preferred cell set, not received yet" : "Not assigned"],
              ["Inbound requested", stamp(row.inboundRequestedAt)],
              ["Inbound confirmed", stamp(row.inboundConfirmedAt)],
              ["Rejection reason", row.rejectionReason || "—"],
              ["Registered", stamp(row.createdAt)],
              ["Description", row.description || "—"],
            ]} />
            <p className="bom-warning mt-5">
              Placement is decided during the Staff-confirmed inbound. Cell weight and volume counters increase only at that moment,
              which is why an approved reservation can still hold unplaced lots.
            </p>
          </Panel>

          <AsyncBoundary state={movements} render={(ledger) => (
            <Panel
              title="Movement ledger"
              subtitle={`${ledger.length} movement${ledger.length === 1 ? "" : "s"} · newest first`}
            >
              {ledger.length > 0 && (
                <div className="mb-5">
                  <Timeline entries={ledger.map((row) => ({
                    at: row.performedAt,
                    status: row.type,
                    note: `${row.quantity} ${row.quantityUnit || ""} · ${kg(row.totalWeightKg)} · ${m3(row.totalVolumeM3)}${row.note ? ` · ${row.note}` : ""}`,
                  }))} />
                </div>
              )}
              <Table
                label="Item movements"
                rows={ledger.map((row) => ({ ...row, id: row.id }))}
                columns={[
                  { key: "type", label: "Type", render: (r) => <Status value={r.type} /> },
                  { key: "performedAt", label: "Performed", render: (r) => stamp(r.performedAt) },
                  { key: "quantity", label: "Quantity", render: (r) => `${r.quantity} ${r.quantityUnit || ""}`.trim() },
                  { key: "totalWeightKg", label: "Weight", render: (r) => kg(r.totalWeightKg) },
                  { key: "totalVolumeM3", label: "Volume", render: (r) => m3(r.totalVolumeM3) },
                  { key: "sourceCellId", label: "Source cell", render: (r) => r.sourceCellId || "—" },
                  { key: "cellId", label: "Destination cell", render: (r) => r.cellId || "—" },
                  { key: "performedBy", label: "Performed by", render: (r) => r.performedBy || "—" },
                  { key: "note", label: "Note", render: (r) => r.note || "—" },
                ]}
                empty="No movement yet. A row appears when Staff confirm an inbound, outbound or relocation."
              />
            </Panel>
          )} />
        </>
      )} />
    </Screen>
  );
}
