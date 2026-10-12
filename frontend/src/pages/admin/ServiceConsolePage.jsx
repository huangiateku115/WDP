import { Link, useParams } from "react-router-dom";
import { Screen, Panel, Table, Status, OpenLink, Details, Button, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import supportApi from "@/api/supportApi";
import maintenanceApi from "@/api/maintenanceApi";

// Read-only Admin console for support requests and maintenance tickets.
// Actions (assign / status) are deferred until their UI is designed.

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
    toRow: supportRow,
  },
  maintenance: {
    basePath: "/admin/maintenance",
    title: "Maintenance tickets",
    label: "Title",
    list: (config) => maintenanceApi.list(config).then(unwrapList),
    get: (id, config) => maintenanceApi.get(id, config).then(unwrap),
    toRow: maintenanceRow,
  },
};

export default function ServiceConsolePage({ kind, mode = "list" }) {
  const config = CONFIGS[kind];
  return mode === "detail"
    ? <ServiceDetail config={config} />
    : <ServiceList config={config} />;
}

function ServiceList({ config }) {
  const state = useAsyncData(({ signal }) => config.list({ signal }), [config]);
  return (
    <Screen
      title={config.title}
      description={`Read-only list from the confirmed ${config.title.toLowerCase()} API.`}
      notice={LIVE_NOTICE}
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
      description={`Read-only detail from the confirmed ${config.title.toLowerCase()} API.`}
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
