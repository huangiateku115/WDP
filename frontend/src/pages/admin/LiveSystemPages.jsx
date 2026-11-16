import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Panel, Table, Status, Field, Input, Select, Button, Message,
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
      title="Tổng quan quản trị hệ thống"
      description="Số liệu tài khoản và cơ sở."
      action={<Button asChild variant="orange"><Link to="/admin/users">Quản lý người dùng</Link></Button>}
    >
      <UserApiState state={state} />
        <Panel title="Số liệu người dùng">
        <Kpis items={[
          ["Tổng người dùng", ready ? state.users.length : "Không khả dụng", "Tổng số tài khoản"],
          ["Người dùng đang hoạt động", hasStatuses ? state.users.filter((u) => userStatus(u)?.toUpperCase() === "ACTIVE").length : "Không khả dụng", "Trạng thái ACTIVE"],
          ["Khách hàng", count("CUSTOMER"), "Tài khoản khách hàng"],
          ["Nhân viên cơ sở", count("FACILITY_STAFF"), "Tài khoản nhân viên cơ sở"],
          ["Quản lý cơ sở", count("FACILITY_MANAGER"), "Tài khoản quản lý cơ sở"],
        ]} />
      </Panel>
      {ready && (
        <Panel title="Phân bố vai trò">
          <Table
            label="Phân bố vai trò"
            rows={[...new Set(state.users.map((u) => u.role || "Role not returned"))].map((role) => ({ id: role, role, count: state.users.filter((u) => (u.role || "Role not returned") === role).length }))}
            columns={[{ key: "role", label: "Role" }, { key: "count", label: "Users" }]}
          />
        </Panel>
      )}
      <Panel
        title="Số liệu cơ sở"
        action={<Button asChild variant="outline"><Link to="/admin/facilities">Mở giám sát cơ sở</Link></Button>}
      >
        {facilities.error
          ? <Message error={facilities.error} />
          : facilities.loading
            ? <p role="status" className="text-sm text-slate-500">Đang tải danh sách cơ sở…</p>
            : (
              <Kpis items={[
                ["Tổng số cơ sở", facilitiesData.length, "Bản ghi cơ sở"],
                ["Cơ sở đang hoạt động", activeFacilities, "Đang nhận đơn mới"],
                ["Cơ sở ngừng hoạt động", facilitiesData.length - activeFacilities, "Chặn nhận đơn mới"],
                ["Mô hình dịch vụ", serviceModels.length, serviceModels.join(", ") || "Chưa có dữ liệu"],
              ]} />
            )}
      </Panel>
      <Panel title="Lịch sử đăng nhập và nhật ký">
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to="/admin/login-history">Mở lịch sử đăng nhập</Link></Button>
          <Button asChild variant="outline"><Link to="/admin/audit">Mở nhật ký kiểm toán</Link></Button>
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
    <AdminScreen title="Lịch sử đăng nhập" description="Các lần đăng nhập của tài khoản đã chọn.">
      <UserApiState state={state} />
      <Panel title="Chọn tài khoản">
        <div className="manager-filters">
          <UserPicker state={state} value={selected} onChange={setSelected} label="Tài khoản" />
        </div>
        {!selected && <p className="text-sm text-slate-500">Chọn một tài khoản để xem lịch sử đăng nhập.</p>}
      </Panel>
      {selected && (
        <Panel title="Lần đăng nhập" subtitle={`${rows.length} sự kiện`} action={<Button variant="outline" onClick={history.reload}>Tải lại</Button>}>
          {history.error
            ? <Message error={history.error} />
            : history.loading
              ? <p role="status" className="text-sm text-slate-500">Đang tải lịch sử đăng nhập…</p>
              : (
                <Table label="Lịch sử đăng nhập" rows={rows} columns={[
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
    <AdminScreen title="Nhật ký kiểm toán" description="Hành động của tài khoản đã chọn.">
      <UserApiState state={state} />
      <Panel title="Chọn tài khoản">
        <div className="manager-filters">
          <UserPicker state={state} value={selected} onChange={(v) => { setSelected(v); setOpenId(""); }} label="Tài khoản" />
        </div>
        {!selected && <p className="text-sm text-slate-500">Chọn một tài khoản để xem các hành động đã thực hiện.</p>}
      </Panel>
      {selected && (
        <>
          <Panel title="Sự kiện kiểm toán" subtitle={`${rows.length} sự kiện`} action={<Button variant="outline" onClick={logs.reload}>Tải lại</Button>}>
            {logs.error
              ? <Message error={logs.error} />
              : logs.loading
                ? <p role="status" className="text-sm text-slate-500">Đang tải nhật ký…</p>
                : (
                  <Table label="Nhật ký kiểm toán" rows={rows} columns={[
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
            <Panel title={`Chi tiết thay đổi · ${open.action}`} subtitle={stamp(open.createdAt)} action={<Button variant="ghost" onClick={() => setOpenId("")}>Đóng</Button>}>
              <div className="grid gap-5 md:grid-cols-2">
                <div><h4 className="mb-2 font-bold">Trước</h4><ReadOnlyValues value={open.before} /></div>
                <div><h4 className="mb-2 font-bold">Sau</h4><ReadOnlyValues value={open.after} /></div>
              </div>
              {open.reason && <p className="mt-5 text-sm text-slate-500">Lý do: {open.reason}</p>}
            </Panel>
          )}
        </>
      )}
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
    <AdminScreen title="Giám sát cơ sở" description="Xem toàn bộ cơ sở trong hệ thống.">
      <Panel title="Bộ lọc">
        <div className="manager-filters">
          <Field label="Tìm kiếm">
            <Input aria-label="Tìm cơ sở" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Trạng thái">
            <Select label="Lọc theo trạng thái" value={status} onChange={setStatus} options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
          </Field>
        </div>
      </Panel>
      <Panel title="Tổng hợp cơ sở" subtitle={`${rows.length} / ${facilities.length} cơ sở`} action={<Button variant="outline" onClick={() => { invalidateFacilities(); state.reload(); }}>Tải lại</Button>}>
        {state.error
          ? <Message error={state.error} />
          : state.loading
            ? <p role="status" className="text-sm text-slate-500">Đang tải danh sách cơ sở…</p>
            : (
              <Table label="Cơ sở" rows={rows} columns={[
                { key: "name", label: "Facility" },
                { key: "code", label: "Code" },
                { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
                { key: "district", label: "Khu vực" },
                { key: "address", label: "Address" },
                { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
                { key: "openingHours", label: "Opening hours" },
              ]} />
            )}
      </Panel>
    </AdminScreen>
  );
}
