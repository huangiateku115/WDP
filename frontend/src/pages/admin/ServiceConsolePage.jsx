import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Screen, Panel, Table, Status, OpenLink, Details, Button, Message, Field, Select, Input } from "@/components/manager/ManagerUI";
import { AsyncBoundary, ConfirmDialog, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAdminUsers, userId } from "@/lib/adminUsers";
import { useAuthSession } from "@/lib/authSession";
import { isAdmin } from "@/lib/roles";
import supportApi from "@/api/supportApi";
import maintenanceApi from "@/api/maintenanceApi";

// Admin console for support requests and maintenance tickets.
// Reads are live; assign / unassign / status / escalate write through the confirmed
// ADMIN/BOM/FACILITY_MANAGER endpoints (assign, unassign and escalate are manager-only).
const SERVICE_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const ASSIGNEE_ROLES = ["FACILITY_STAFF", "FACILITY_MANAGER"];

const unwrap = (response) => response?.data?.data ?? null;
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);
const refId = (v) => (v && typeof v === "object" ? v._id : v) || "";
const accountName = (u) => (u && typeof u === "object" ? u.displayName || u.fullName || u.email : u) || "—";
const when = (v) => (v ? new Date(v).toLocaleString("en-GB") : "—");

function supportRow(d) {
  return {
    id: d?._id,
    subject: d?.subject || "",
    customer: accountName(d?.customerId),
    facilityId: refId(d?.facilityId),
    category: d?.category || "",
    priority: d?.priority || "",
    status: d?.status || "",
    assignedTo: accountName(d?.assignedTo),
    assigneeId: refId(d?.assignedTo),
    relatedEntity: d?.relatedEntity ? `${d.relatedEntity.type} · ${d.relatedEntity.id}` : "",
    description: d?.description || "",
    resolutionNote: d?.resolutionNote || "",
    createdAt: when(d?.createdAt),
  };
}
function maintenanceRow(d) {
  return {
    id: d?._id,
    title: d?.title || "",
    customer: accountName(d?.reportedBy),
    facilityId: refId(d?.facilityId),
    storageUnit: refId(d?.storageUnitId),
    category: d?.category || "",
    priority: d?.priority || "",
    status: d?.status || "",
    assignedTo: accountName(d?.assignedTo),
    assigneeId: refId(d?.assignedTo),
    relatedEntity: refId(d?.storageUnitId) ? `Storage unit · ${refId(d.storageUnitId)}` : "",
    description: d?.description || "",
    resolutionNote: d?.resolutionNote || "",
    createdAt: when(d?.createdAt),
  };
}

const CONFIGS = {
  support: {
    basePath: "/admin/support",
    title: "Support requests",
    label: "Subject",
    list: (config) => supportApi.listReal(config).then(unwrapList),
    get: (id, config) => supportApi.detailReal(id, config).then(unwrap),
    messages: (id, config) => supportApi.messagesReal(id, config).then(unwrapList),
    assigneeLabel: "Staff",
    assign: (id, assignee) => supportApi.assign(id, assignee),
    unassign: (id) => supportApi.unassign(id),
    setStatus: (id, payload) => supportApi.setStatus(id, payload),
    escalate: (id) => supportApi.escalate(id),
    toRow: supportRow,
  },
  maintenance: {
    basePath: "/admin/maintenance",
    title: "Maintenance tickets",
    label: "Title",
    list: (config) => maintenanceApi.list(config).then(unwrapList),
    get: (id, config) => maintenanceApi.get(id, config).then(unwrap),
    assigneeLabel: "Assignee",
    assign: (id, assignee) => maintenanceApi.assign(id, assignee),
    unassign: (id) => maintenanceApi.unassign(id),
    setStatus: (id, payload) => maintenanceApi.setStatus(id, payload),
    toRow: maintenanceRow,
  },
};

// Mounted in both workspaces: ADMIN keeps assign/unassign/escalate, BOM gets status changes.
// Config objects are memoised per (kind, basePath) so their identity stays stable for hooks.
const CONFIG_PATHS = { support: "/support", maintenance: "/maintenance" };
const configCache = new Map();
function configFor(kind, basePath) {
  if (!CONFIGS[kind]) return null;
  const key = `${kind}:${basePath}`;
  if (!configCache.has(key))
    configCache.set(key, { ...CONFIGS[kind], basePath: `${basePath}${CONFIG_PATHS[kind]}` });
  return configCache.get(key);
}

export default function ServiceConsolePage({ kind, mode = "list", basePath = "/admin" }) {
  const config = configFor(kind, basePath);
  if (!config) return <Panel title="Service console unavailable"><p>Unknown console kind.</p></Panel>;
  return mode === "detail"
    ? <ServiceDetail config={config} />
    : <ServiceList config={config} />;
}

function ServiceList({ config }) {
  const state = useAsyncData(({ signal }) => config.list({ signal }), [config]);
  return (
    <Screen
      title={config.title}
      description={`Live list from the confirmed ${config.title.toLowerCase()} API.`}
      notice={LIVE_NOTICE}
      action={<Button variant="outline" onClick={state.reload}>Refresh</Button>}
    >
      <AsyncBoundary state={state} render={(records) => {
        const rows = records.map(config.toRow);
        return (
          <Panel title={config.title} subtitle={`${rows.length} record(s)`}>
            <Table
              label={config.title}
              rows={rows}
              columns={[
                { key: "code", label: config.label, render: (r) => <OpenLink to={`${config.basePath}/${r.id}`}>{r.subject || r.title}</OpenLink> },
                { key: "customer", label: "Opened by" },
                { key: "category", label: "Category" },
                { key: "priority", label: "Priority", render: (r) => <Status value={r.priority} /> },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "assignedTo", label: "Assigned to" },
                { key: "createdAt", label: "Created" },
              ]}
              empty="No records were returned by the backend."
            />
          </Panel>
        );
      }} />
    </Screen>
  );
}

function ServiceDetail({ config }) {
  const { id } = useParams();
  const state = useAsyncData(({ signal }) => config.get(id, { signal }), [id, config]);
  const messages = useAsyncData(
    ({ signal }) => (config.messages ? config.messages(id, { signal }) : Promise.resolve(null)),
    [id, config],
  );

  if (!state.loading && state.error && /not found|unavailable|404/i.test(state.error))
    return (
      <Screen title="Record unavailable" notice={LIVE_NOTICE}>
        <Panel title="Record unavailable"><Link className="manager-link" to={config.basePath}>Back to {config.title.toLowerCase()}</Link></Panel>
      </Screen>
    );

  return (
    <Screen
      title={config.title.replace(/s$/, "") + " detail"}
      description={`Live detail from the confirmed ${config.title.toLowerCase()} API.`}
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to={config.basePath}>Back to {config.title.toLowerCase()}</Link></Button>}
    >
      <AsyncBoundary state={state} render={(record) => {
        const row = config.toRow(record);
        return (
          <>
            <Panel title="Record">
              <Details values={[
                ["Reference", row.id],
                [config.label, row.subject || row.title],
                ["Opened by", row.customer],
                ["Category", row.category],
                ["Priority", <Status value={row.priority} />],
                ["Status", <Status value={row.status} />],
                ["Assigned to", row.assignedTo],
                ["Related entity", row.relatedEntity || "—"],
                ["Created", row.createdAt],
                ["Description", row.description],
                ["Resolution note", row.resolutionNote || "—"],
              ]} />
            </Panel>
            <ServiceActions config={config} row={row} onDone={state.reload} />
            {config.messages && (
              <Panel title="Conversation" subtitle="Internal messages are hidden from customers by the backend.">
                {messages.loading && <p role="status" className="text-sm text-slate-500">Loading messages…</p>}
                {messages.error && <Message error={messages.error} />}
                {messages.data && (
                  <ul className="space-y-3">
                    {messages.data.map((m) => (
                      <li key={m._id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                          <span>{accountName(m.authorId || m.senderId)}</span>
                          <span>{when(m.createdAt)}</span>
                        </div>
                        <p className="mt-2 text-sm">{m.message || m.body || ""}</p>
                        {m.isInternal && <Status value="INTERNAL" />}
                      </li>
                    ))}
                    {!messages.data.length && <li className="text-sm text-slate-500">No messages yet.</li>}
                  </ul>
                )}
              </Panel>
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function ServiceActions({ config, row, onDone }) {
  const { user } = useAuthSession();
  if (isAdmin(user?.role)) return <ServiceAdminActions config={config} row={row} onDone={onDone} />;
  return <ServiceStatusActions config={config} row={row} onDone={onDone} />;
}

function ServiceAdminActions({ config, row, onDone }) {
  const directory = useAdminUsers();
  const assignees = directory.users
    .filter((user) => userId(user) && ASSIGNEE_ROLES.includes(user.role))
    .map((user) => [userId(user), user.displayName || user.email || userId(user)]);
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Assignees come from the Admin user collection; the backend has no staff-list endpoint.
  const open = (next) => { setError(""); setNotice(""); setDialog(next); };
  const confirmed = (execute, message) => async () => {
    await execute();
    setNotice(message);
    onDone?.();
  };
  const assigneeName = assignees.find(([id]) => id === assignee)?.[1] || assignee;

  return (
    <Panel title="Actions" subtitle="Every change is sent to the backend API. The backend authorizes the action and validates the transition.">
      <Message error={error} success={notice} />
      <div className="manager-filters mt-4">
        <Field
          label={config.assigneeLabel}
          hint={assignees.length ? undefined : "The user collection returned no FACILITY_STAFF or FACILITY_MANAGER account."}
        >
          <Select
            label={`${config.assigneeLabel} to assign`}
            value={assignee}
            onChange={setAssignee}
            disabled={!assignees.length}
            options={assignees.length ? [["", `Select a ${config.assigneeLabel.toLowerCase()}`], ...assignees] : [["", "No assignable account"]]}
          />
        </Field>
        <Field label="New status">
          <Select label="New status" value={status} onChange={setStatus} options={[["", "Select a status"], ...SERVICE_STATUSES]} />
        </Field>
        <Field label="Resolution note" hint="Sent only when the new status is RESOLVED.">
          <Input aria-label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} disabled={status !== "RESOLVED"} />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={!assignees.length}
          onClick={() => (assignee
            ? open({
              title: `Assign ${config.assigneeLabel.toLowerCase()}`,
              confirmLabel: "Assign",
              summary: <Details values={[["Record", row.subject || row.title], [config.assigneeLabel, assigneeName]]} />,
              execute: confirmed(() => config.assign(row.id, assignee), "Assignment saved through the backend API."),
            })
            : setError(`Select a ${config.assigneeLabel.toLowerCase()} first.`))}
        >
          Assign
        </Button>
        <Button
          variant="outline"
          disabled={!row.assigneeId}
          onClick={() => open({
            title: "Remove assignment",
            confirmLabel: "Unassign",
            summary: <Details values={[["Record", row.subject || row.title], ["Currently assigned to", row.assignedTo]]} />,
            execute: confirmed(() => config.unassign(row.id), "Assignment removed through the backend API."),
          })}
        >
          Unassign
        </Button>
        {config.escalate && (
          <Button
            variant="outline"
            onClick={() => open({
              title: "Escalate request",
              confirmLabel: "Escalate",
              summary: <Details values={[["Record", row.subject || row.title], ["Current status", row.status]]} />,
              execute: confirmed(() => config.escalate(row.id), "Request escalated through the backend API."),
            })}
          >
            Escalate
          </Button>
        )}
        <Button
          variant="orange"
          onClick={() => (status
            ? open({
              title: "Change status",
              confirmLabel: "Save status",
              summary: <Details values={[
                ["Record", row.subject || row.title],
                ["From", row.status],
                ["To", status],
                ["Resolution note", status === "RESOLVED" ? note.trim() || "—" : "Not sent"],
              ]} />,
              execute: confirmed(
                () => config.setStatus(row.id, {
                  status,
                  ...(status === "RESOLVED" && note.trim() ? { resolutionNote: note.trim() } : {}),
                }),
                "Status saved through the backend API.",
              ),
            })
            : setError("Select the new status first."))}
        >
          Save status
        </Button>
      </div>
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          confirmLabel={dialog.confirmLabel}
          summary={dialog.summary}
          onConfirm={dialog.execute}
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-slate-500">The backend applies the change and the record is reloaded afterwards.</p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}

// BOM (and any non-ADMIN viewer) can change status but cannot assign: the assignee picker needs
// the ADMIN-only user directory. Rendering this variant also avoids calling GET /users at all.
function ServiceStatusActions({ config, row, onDone }) {
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const open = (next) => { setError(""); setNotice(""); setDialog(next); };

  return (
    <Panel title="Actions" subtitle="Status changes are sent to the backend API. Assignment stays with ADMIN.">
      <Message error={error} success={notice} />
      <div className="manager-filters mt-4">
        <Field label="New status">
          <Select label="New status" value={status} onChange={setStatus} options={[["", "Select a status"], ...SERVICE_STATUSES]} />
        </Field>
        <Field label="Resolution note" hint="Sent only when the new status is RESOLVED.">
          <Input aria-label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} disabled={status !== "RESOLVED"} />
        </Field>
      </div>
      <p className="mt-4 text-sm text-slate-500">
        Assigning a {config.assigneeLabel.toLowerCase()} needs the ADMIN user directory (GET /users is ADMIN-only),
        so the assignment controls are not shown here.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="orange"
          onClick={() => (status
            ? open({
              title: "Change status",
              confirmLabel: "Save status",
              summary: <Details values={[
                ["Record", row.subject || row.title],
                ["From", row.status],
                ["To", status],
                ["Resolution note", status === "RESOLVED" ? note.trim() || "—" : "Not sent"],
              ]} />,
              execute: async () => {
                await config.setStatus(row.id, {
                  status,
                  ...(status === "RESOLVED" && note.trim() ? { resolutionNote: note.trim() } : {}),
                });
                setNotice("Status saved through the backend API.");
                onDone?.();
              },
            })
            : setError("Select the new status first."))}
        >
          Save status
        </Button>
      </div>
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          confirmLabel={dialog.confirmLabel}
          summary={dialog.summary}
          onConfirm={dialog.execute}
          onClose={() => setDialog(null)}
        >
          <p className="text-sm text-slate-500">The backend applies the change and the record is reloaded afterwards.</p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}
