import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Panel, Table, Status, Field, Input, Select, Details, Button, Message,
} from "@/components/manager/ManagerUI";
import { AdminScreen, UserApiState } from "@/components/admin/AdminUI";
import { ReadOnlyValues, Kpis } from "@/components/bom/BomUI";
import { useAdminUsers, userId, userStatus } from "@/lib/adminUsers";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, invalidateFacilities } from "@/lib/bomApiData";
import auditApi from "@/api/auditApi";

// Live Admin system pages. Login History and Audit use the confirmed per-user audit APIs;
// Facility oversight uses the confirmed read-only Facility list.

const unwrap = (response) => {
  const body = response?.data;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
};
const stamp = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");

function UserPicker({ state, value, onChange, label }) {
  const options = [["", "Select an account"], ...state.users.filter((u) => userId(u)).map((u) => [userId(u), u.displayName || u.email || userId(u)])];
  return (
    <Field label={label}>
      <Select label={label} value={value} onChange={onChange} options={options} />
    </Field>
  );
}

export function DashboardPage() {
  const state = useAdminUsers();
  const facilities = useAsyncData(loadFacilities, []);
  const ready = state.status === "ready" && Boolean(state.sessionToken);
  const hasStatuses = ready && state.users.every((u) => ["ACTIVE", "INACTIVE", "DEACTIVATED", "DISABLED"].includes(userStatus(u)?.toUpperCase()));
  const hasRoles = ready && state.users.every((u) => typeof u.role === "string");
  const count = (role) => (hasRoles ? state.users.filter((u) => u.role === role).length : "Unavailable");
  const facilitiesData = facilities.data || [];
  const activeFacilities = facilitiesData.filter((f) => f.status === "ACTIVE").length;
  const serviceModels = [...new Set(facilitiesData.flatMap((f) => f.serviceTypes))];

  return (
    <AdminScreen
      title="System administration overview"
      description="Account and facility metrics. Login history and audit logs are scoped to one account."
      action={<Button asChild variant="orange"><Link to="/admin/users">Manage users</Link></Button>}
    >
      <UserApiState state={state} />
        <Panel title="User metrics" subtitle="Derived from the loaded accounts.">
        <Kpis items={[
          ["Total users", ready ? state.users.length : "Unavailable", "Total accounts"],
          ["Active users", hasStatuses ? state.users.filter((u) => userStatus(u)?.toUpperCase() === "ACTIVE").length : "Unavailable", "Shown when all returned statuses are available"],
          ["Customers", count("CUSTOMER"), "Returned CUSTOMER roles"],
          ["Facility Staff", count("FACILITY_STAFF"), "Returned FACILITY_STAFF roles"],
          ["Facility Managers", count("FACILITY_MANAGER"), "Returned FACILITY_MANAGER roles"],
        ]} />
      </Panel>
      {ready && (
        <Panel title="Returned role distribution" subtitle="Unknown role names are displayed exactly as returned.">
          <Table
            label="Returned role distribution"
            rows={[...new Set(state.users.map((u) => u.role || "Role not returned"))].map((role) => ({ id: role, role, count: state.users.filter((u) => (u.role || "Role not returned") === role).length }))}
            columns={[{ key: "role", label: "Role" }, { key: "count", label: "Users" }]}
          />
        </Panel>
      )}
      <Panel
        title="Facility metrics"
        subtitle="Facility directory."
        action={<Button asChild variant="outline"><Link to="/admin/facilities">Open facility oversight</Link></Button>}
      >
        {facilities.error
          ? <Message error={facilities.error} />
          : facilities.loading
            ? <p role="status" className="text-sm text-slate-500">Loading facilities…</p>
            : (
              <Kpis items={[
                ["Total facilities", facilitiesData.length, "Facility records"],
                ["Active facilities", activeFacilities, "Accepting new reservations"],
                ["Inactive facilities", facilitiesData.length - activeFacilities, "Blocked for new reservations"],
                ["Service models", serviceModels.length, serviceModels.join(", ") || "None returned"],
              ]} />
            )}
      </Panel>
      <Panel title="Login history & audit" subtitle="Sign-in events and audit actions are scoped to one account.">
        <p className="mb-4 text-sm text-slate-500">Select an account on the dedicated pages to inspect its sign-in events or the audit actions it performed.</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to="/admin/login-history">Open login history</Link></Button>
          <Button asChild variant="outline"><Link to="/admin/audit">Open audit logs</Link></Button>
        </div>
      </Panel>
    </AdminScreen>
  );
}

export function LoginHistoryPage() {
  const state = useAdminUsers();
  const [selected, setSelected] = useState("");
  const history = useAsyncData(
    () => (selected ? auditApi.getAdminLoginHistory(selected).then(unwrap) : Promise.resolve([])),
    [selected],
  );
  const rows = (history.data || []).map((row, index) => ({ id: row._id || `login-${index}`, source: row }));

  return (
    <AdminScreen title="Login history" description="Sign-in events for the selected account.">
      <UserApiState state={state} />
      <Panel title="User selection">
        <div className="manager-filters">
          <UserPicker state={state} value={selected} onChange={setSelected} label="Account" />
        </div>
        {!selected && <p className="text-sm text-slate-500">Select an account to load its login history.</p>}
      </Panel>
      {selected && (
        <Panel title="Login events" subtitle={`${rows.length} event(s)`} action={<Button variant="outline" onClick={history.reload}>Refresh</Button>}>
          {history.error
            ? <Message error={history.error} />
            : history.loading
              ? <p role="status" className="text-sm text-slate-500">Loading login history…</p>
              : (
                <Table label="Login history" rows={rows} columns={[
                  { key: "event", label: "Event", render: (r) => r.source.eventType || "—" },
                  { key: "status", label: "Result", render: (r) => <Status value={r.source.status} /> },
                  { key: "reason", label: "Failure reason", render: (r) => r.source.failureReason || "—" },
                  { key: "email", label: "Attempted email", render: (r) => r.source.attemptedEmail || "—" },
                  { key: "ip", label: "IP", render: (r) => r.source.ip || "—" },
                  { key: "device", label: "Device", render: (r) => r.source.device || "—" },
                  { key: "at", label: "Timestamp", render: (r) => stamp(r.source.createdAt) },
                ]} />
              )}
        </Panel>
      )}
    </AdminScreen>
  );
}

export function AuditPage() {
  const { id } = useParams();
  const state = useAdminUsers();
  const [selected, setSelected] = useState("");
  const [openId, setOpenId] = useState(id || "");
  const logs = useAsyncData(
    () => (selected ? auditApi.getAdminAuditLogs(selected).then(unwrap) : Promise.resolve([])),
    [selected],
  );
  const records = logs.data || [];
  const rows = records.map((row, index) => ({ id: row._id || `log-${index}`, source: row }));
  const open = records.find((row) => row._id === openId);

  return (
    <AdminScreen title="Audit logs" description="Actions performed by the selected account.">
      <UserApiState state={state} />
      <Panel title="User selection">
        <div className="manager-filters">
          <UserPicker state={state} value={selected} onChange={(v) => { setSelected(v); setOpenId(""); }} label="Account" />
        </div>
        {!selected && <p className="text-sm text-slate-500">Select an account to load the audit actions it performed.</p>}
      </Panel>
      {selected && (
        <>
          <Panel title="Audit events" subtitle={`${rows.length} event(s)`} action={<Button variant="outline" onClick={logs.reload}>Refresh</Button>}>
            {logs.error
              ? <Message error={logs.error} />
              : logs.loading
                ? <p role="status" className="text-sm text-slate-500">Loading audit logs…</p>
                : (
                  <Table label="Audit logs" rows={rows} columns={[
                    { key: "action", label: "Action", render: (r) => (r.source._id === openId ? <b>{r.source.action}</b> : r.source.action) },
                    { key: "role", label: "Actor role", render: (r) => <Status value={r.source.actorRole} /> },
                    { key: "entity", label: "Entity", render: (r) => `${r.source.entityType || "—"} · ${r.source.entityId || "—"}` },
                    { key: "facility", label: "Facility", render: (r) => r.source.facilityId || "—" },
                    { key: "at", label: "Timestamp", render: (r) => stamp(r.source.createdAt) },
                    { key: "detail", label: "Detail", render: (r) => <Button variant="outline" size="sm" onClick={() => setOpenId(r.source._id)}>View</Button> },
                  ]} />
                )}
          </Panel>
          {open && (
            <Panel title={`Change detail · ${open.action}`} subtitle={stamp(open.createdAt)} action={<Button variant="ghost" onClick={() => setOpenId("")}>Close</Button>}>
              <div className="grid gap-5 md:grid-cols-2">
                <div><h4 className="mb-2 font-bold">Before</h4><ReadOnlyValues value={open.before} /></div>
                <div><h4 className="mb-2 font-bold">After</h4><ReadOnlyValues value={open.after} /></div>
              </div>
              {open.reason && <p className="mt-5 text-sm text-slate-500">Reason: {open.reason}</p>}
            </Panel>
          )}
        </>
      )}
      <Details values={[["Note", "Audit history lists the actions performed by one account."]]} />
    </AdminScreen>
  );
}

export function FacilitiesPage() {
  const state = useAsyncData(loadFacilities, []);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const facilities = state.data || [];
  const rows = facilities.filter((f) =>
    (!status || f.status === status) &&
    (!search || `${f.code} ${f.name} ${f.address}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <AdminScreen title="Facility oversight" description="Read-only system-wide facility visibility. Management stays in the BOM workspace.">
      <Panel title="Filters">
        <div className="manager-filters">
          <Field label="Search">
            <Input aria-label="Search facilities" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select label="Status filter" value={status} onChange={setStatus} options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
          </Field>
        </div>
      </Panel>
      <Panel title="Facility snapshot" subtitle={`${rows.length} of ${facilities.length} facilities`} action={<Button variant="outline" onClick={() => { invalidateFacilities(); state.reload(); }}>Refresh</Button>}>
        {state.error
          ? <Message error={state.error} />
          : state.loading
            ? <p role="status" className="text-sm text-slate-500">Loading facilities…</p>
            : (
              <Table label="Facilities" rows={rows} columns={[
                { key: "name", label: "Facility" },
                { key: "code", label: "Code" },
                { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
                { key: "district", label: "District/location" },
                { key: "address", label: "Address" },
                { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
                { key: "openingHours", label: "Opening hours" },
              ]} />
            )}
      </Panel>
    </AdminScreen>
  );
}
