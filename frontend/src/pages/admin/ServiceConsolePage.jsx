import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Screen, Panel, Table, Status, OpenLink, Details, Button, Message, Field, Select, Input } from "@/components/manager/ManagerUI";
import ListPager from "@/components/bom/ListPager";
import { AsyncBoundary, ConfirmDialog } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { PAGE_SIZE } from "@/lib/pageSlice";
import { usePageIndex } from "@/lib/usePageIndex";
import { useAdminUsers, userId } from "@/lib/adminUsers";
import { useAuthSession } from "@/lib/authSession";
import { isAdmin } from "@/lib/roles";
import supportApi from "@/api/supportApi";
import maintenanceApi from "@/api/maintenanceApi";

// Admin console for support requests and maintenance tickets.
// Reads are live; assign / unassign / status / escalate write through the confirmed
// ADMIN/BOM/FACILITY_MANAGER endpoints (assign, unassign and escalate are manager-only).
const SERVICE_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
// Assign/unassign only accepts an active FACILITY_STAFF assigned to the ticket facility,
// so managers must not be offered as assignees.
const ASSIGNEE_ROLES = ["FACILITY_STAFF"];

const unwrap = (response) => response?.data?.data ?? null;
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);
// List reads keep the pagination envelope: without it the backend default (page 1, limit 20) was
// rendered as if it were the whole collection.
const unwrapPage = (response) => ({
  rows: Array.isArray(response?.data?.data) ? response.data.data : [],
  pagination: response?.data?.pagination ?? null,
});
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
    title: "Yêu cầu hỗ trợ",
    label: "Tiêu đề",
    list: (config) => supportApi.listReal(config).then(unwrapPage),
    get: (id, config) => supportApi.detailReal(id, config).then(unwrap),
    messages: (id, config) => supportApi.messagesReal(id, config).then(unwrapList),
    assigneeLabel: "Nhân viên",
    assign: (id, assignee) => supportApi.assign(id, assignee),
    unassign: (id) => supportApi.unassign(id),
    setStatus: (id, payload) => supportApi.setStatus(id, payload),
    escalate: (id) => supportApi.escalate(id),
    toRow: supportRow,
  },
  maintenance: {
    basePath: "/admin/maintenance",
    title: "Phiếu bảo trì",
    label: "Tiêu đề",
    list: (config) => maintenanceApi.list(config).then(unwrapPage),
    get: (id, config) => maintenanceApi.get(id, config).then(unwrap),
    assigneeLabel: "Người phụ trách",
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
  if (!config) return <Panel title="Không hỗ trợ loại màn hình này"><p>Loại màn hình không hợp lệ.</p></Panel>;
  return mode === "detail"
    ? <ServiceDetail config={config} />
    : <ServiceList config={config} />;
}

function ServiceList({ config }) {
  // Both collections are paged server-side (page defaults to 1, limit to 20), so the console asks
  // for one explicit page and renders previous/next instead of silently showing the first page.
  const [page, setPage] = usePageIndex(config.basePath);
  const state = useAsyncData(
    ({ signal }) => config.list({ signal, params: { page, limit: PAGE_SIZE } }),
    [config, page],
  );
  return (
    <Screen
      title={config.title}
      description={`Toàn bộ ${config.title.toLowerCase()}.`}
      action={<Button variant="outline" onClick={state.reload}>Tải lại</Button>}
    >
      <AsyncBoundary state={state} render={(records) => {
        if (!records) return null;
        const rows = records.rows.map(config.toRow);
        const pagination = records.pagination;
        return (
          <Panel title={config.title} subtitle={`${pagination?.total ?? rows.length} bản ghi`}>
            <Table
              label={config.title}
              rows={rows}
              columns={[
                { key: "code", label: config.label, render: (r) => <OpenLink to={`${config.basePath}/${r.id}`}>{r.subject || r.title}</OpenLink> },
                { key: "customer", label: "Người gửi" },
                { key: "category", label: "Danh mục" },
                { key: "priority", label: "Mức ưu tiên", render: (r) => <Status value={r.priority} /> },
                { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
                { key: "assignedTo", label: "Người phụ trách" },
                { key: "createdAt", label: "Ngày tạo" },
              ]}
              empty="Chưa có bản ghi nào."
            />
            <ListPager
              page={pagination?.page ?? page}
              totalPages={pagination?.totalPages ?? 1}
              total={pagination?.total ?? rows.length}
              loading={state.loading}
              onPageChange={setPage}
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
      <Screen title="Không xem được bản ghi">
        <Panel title="Không xem được bản ghi"><Link className="manager-link" to={config.basePath}>Quay lại danh sách</Link></Panel>
      </Screen>
    );

  return (
    <Screen
      title="Chi tiết bản ghi"
      description={config.title}
      action={<Button asChild variant="outline"><Link to={config.basePath}>Quay lại danh sách</Link></Button>}
    >
      <AsyncBoundary state={state} render={(record) => {
        const row = config.toRow(record);
        return (
          <>
            <Panel title="Thông tin bản ghi">
              <Details values={[
                ["Mã tham chiếu", row.id],
                [config.label, row.subject || row.title],
                ["Người gửi", row.customer],
                ["Danh mục", row.category],
                ["Mức ưu tiên", <Status value={row.priority} />],
                ["Trạng thái", <Status value={row.status} />],
                ["Người phụ trách", row.assignedTo],
                ["Đối tượng liên quan", row.relatedEntity || "—"],
                ["Ngày tạo", row.createdAt],
                ["Mô tả", row.description],
                ["Ghi chú xử lý", row.resolutionNote || "—"],
              ]} />
            </Panel>
            <ServiceActions config={config} row={row} onDone={state.reload} />
            {config.messages && (
              <Panel title="Hội thoại" subtitle="Tin nhắn nội bộ không hiển thị với khách hàng.">
                {messages.loading && <p role="status" className="text-sm text-slate-500">Đang tải tin nhắn…</p>}
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
                    {!messages.data.length && <li className="text-sm text-slate-500">Chưa có tin nhắn nào.</li>}
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
    <Panel title="Thao tác">
      <Message error={error} success={notice} />
      <div className="manager-filters mt-4">
        <Field
          label={config.assigneeLabel}
          hint={assignees.length ? undefined : "Chưa có tài khoản nhân viên nào khả dụng."}
        >
          <Select
            label={`${config.assigneeLabel} cần giao`}
            value={assignee}
            onChange={setAssignee}
            disabled={!assignees.length}
            options={assignees.length ? [["", `Chọn ${config.assigneeLabel.toLowerCase()}`], ...assignees] : [["", "Không có tài khoản để giao"]]}
          />
        </Field>
        <Field label="Trạng thái mới">
          <Select label="Trạng thái mới" value={status} onChange={setStatus} options={[["", "Chọn trạng thái"], ...SERVICE_STATUSES]} />
        </Field>
            <Field label="Ghi chú xử lý" hint="Chỉ gửi khi trạng thái mới là Đã giải quyết.">
          <Input aria-label="Ghi chú xử lý" value={note} onChange={(e) => setNote(e.target.value)} disabled={status !== "RESOLVED"} />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={!assignees.length}
          onClick={() => (assignee
            ? open({
                title: `Giao ${config.assigneeLabel.toLowerCase()}`,
                confirmLabel: "Giao việc",
                summary: <Details values={[["Bản ghi", row.subject || row.title], [config.assigneeLabel, assigneeName]]} />,
                execute: confirmed(() => config.assign(row.id, assignee), "Đã lưu phân công."),
              })
              : setError(`Hãy chọn ${config.assigneeLabel.toLowerCase()} trước.`))}
        >
          Phân công
        </Button>
        <Button
          variant="outline"
          disabled={!row.assigneeId}
          onClick={() => open({
            title: "Gỡ phân công",
            confirmLabel: "Gỡ phân công",
            summary: <Details values={[["Bản ghi", row.subject || row.title], ["Đang phụ trách", row.assignedTo]]} />,
              execute: confirmed(() => config.unassign(row.id), "Đã gỡ phân công."),
          })}
        >
          Gỡ phân công
        </Button>
        {config.escalate && (
          <Button
            variant="outline"
            onClick={() => open({
              title: "Chuyển cấp yêu cầu",
              confirmLabel: "Chuyển cấp",
              summary: <Details values={[["Bản ghi", row.subject || row.title], ["Trạng thái hiện tại", row.status]]} />,
              execute: confirmed(() => config.escalate(row.id), "Đã chuyển cấp yêu cầu."),
            })}
          >
            Chuyển cấp
          </Button>
        )}
        <Button
          variant="orange"
          onClick={() => (status
            ? open({
              title: "Đổi trạng thái",
              confirmLabel: "Lưu trạng thái",
              summary: <Details values={[
                ["Bản ghi", row.subject || row.title],
                ["Từ", row.status],
                ["Sang", status],
                ["Ghi chú xử lý", status === "RESOLVED" ? note.trim() || "—" : "Không gửi"],
              ]} />,
              execute: confirmed(
                () => config.setStatus(row.id, {
                  status,
                  ...(status === "RESOLVED" && note.trim() ? { resolutionNote: note.trim() } : {}),
                }),
                "Đã lưu trạng thái.",
              ),
            })
            : setError("Hãy chọn trạng thái mới trước."))}
        >
          Lưu trạng thái
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
    <Panel title="Thao tác">
      <Message error={error} success={notice} />
      <div className="manager-filters mt-4">
        <Field label="Trạng thái mới">
          <Select label="Trạng thái mới" value={status} onChange={setStatus} options={[["", "Chọn trạng thái"], ...SERVICE_STATUSES]} />
        </Field>
        <Field label="Ghi chú xử lý" hint="Chỉ gửi khi trạng thái mới là Đã giải quyết.">
          <Input aria-label="Ghi chú xử lý" value={note} onChange={(e) => setNote(e.target.value)} disabled={status !== "RESOLVED"} />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="orange"
          onClick={() => (status
            ? open({
              title: "Đổi trạng thái",
              confirmLabel: "Lưu trạng thái",
              summary: <Details values={[
                ["Bản ghi", row.subject || row.title],
                ["Từ", row.status],
                ["Sang", status],
                ["Ghi chú xử lý", status === "RESOLVED" ? note.trim() || "—" : "Không gửi"],
              ]} />,
              execute: async () => {
                await config.setStatus(row.id, {
                  status,
                  ...(status === "RESOLVED" && note.trim() ? { resolutionNote: note.trim() } : {}),
                });
                setNotice("Đã lưu trạng thái.");
                onDone?.();
              },
            })
            : setError("Hãy chọn trạng thái mới trước."))}
        >
          Lưu trạng thái
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
        </ConfirmDialog>
      )}
    </Panel>
  );
}
