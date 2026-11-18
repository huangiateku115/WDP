import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Panel, Table, Status, Field, Input, Select, Button, Message,
} from "@/components/manager/ManagerUI";
import { AdminScreen, UserApiState } from "@/components/admin/AdminUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { facilityLabel } from "@/lib/facilityLabels";
import { useAdminUsers, loadAdminUsers, userId, userStatus } from "@/lib/adminUsers";
import { useAsyncData } from "@/lib/useAsyncData";
import { PAGE_SIZE, pageSlice } from "@/lib/pageSlice";
import { usePageIndex } from "@/lib/usePageIndex";
import ListPager from "@/components/manager/ListPager";
import { loadFacilities, invalidateFacilities } from "@/lib/bomApiData";
import auditApi from "@/api/auditApi";
import { downloadCsv } from "@/lib/csvExport";

// Live Admin system pages. Login History and Audit use the confirmed per-user audit APIs;
// Facility oversight uses the confirmed read-only Facility list.

const unwrap = (response) => {
  const body = response?.data;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
};
const stamp = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");
// Filtering happens on the events already loaded for the selected account; a cross-account
// search needs GET /audit?actorId=&action=&from=&to= (see backendCapabilities.globalAuditSearch).
const dayOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
const inRange = (value, from, to) => {
  const day = dayOf(value);
  return Boolean(day) && (!from || day >= from) && (!to || day <= to);
};
const distinct = (rows, read) => [...new Set(rows.map(read).filter(Boolean))].sort();

function UserPicker({ state, value, onChange, label }) {
  const options = [["", "Chọn tài khoản"], ...state.users.filter((u) => userId(u)).map((u) => [userId(u), u.displayName || u.email || userId(u)])];
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
          <AsyncBoundary
            state={{ loading: false, error: "", data: state.users, reload: () => loadAdminUsers(true) }}
            render={() => (
              <Table
                label="Phân bố vai trò"
                rows={[...new Set(state.users.map((u) => u.role || "Chưa rõ vai trò"))].map((role) => ({ id: role, role, count: state.users.filter((u) => (u.role || "Chưa rõ vai trò") === role).length }))}
                columns={[{ key: "role", label: "Vai trò" }, { key: "count", label: "Số tài khoản" }]}
              />
            )}
          />
        </Panel>
      )}
      <Panel
        title="Số liệu cơ sở"
        action={<Button asChild variant="outline"><Link to="/admin/facilities">Mở giám sát cơ sở</Link></Button>}
      >
        <AsyncBoundary state={facilities} render={() => (
          <Kpis items={[
            ["Tổng số cơ sở", facilitiesData.length, "Bản ghi cơ sở"],
            ["Cơ sở đang hoạt động", activeFacilities, "Đang nhận đơn mới"],
            ["Cơ sở ngừng hoạt động", facilitiesData.length - activeFacilities, "Chặn nhận đơn mới"],
            ["Mô hình dịch vụ", serviceModels.length, serviceModels.map(facilityLabel).join(", ") || "Chưa có dữ liệu"],
          ]} />
        )} />
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
  const [eventType, setEventType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const events = distinct(rows, (r) => r.source.eventType);
  const visible = rows.filter((r) =>
    (!eventType || r.source.eventType === eventType) && inRange(r.source.createdAt, from, to));
  // The per-account history endpoint returns every event (no page/limit), so the page is sliced
  // in the browser. The CSV export still receives the full filtered set.
  const [page, setPage] = usePageIndex(`${selected}|${eventType}|${from}|${to}`);
  const paged = pageSlice(visible, page);

  return (
    <AdminScreen
      title="Lịch sử đăng nhập"
      description="Các lần đăng nhập của tài khoản đã chọn."
      action={selected ? <Button variant="outline" onClick={history.reload} disabled={history.loading}>Tải lại</Button> : undefined}
    >
      <UserApiState state={state} />
      <Panel title="Chọn tài khoản">
        <div className="manager-filters">
          <UserPicker state={state} value={selected} onChange={setSelected} label="Tài khoản" />
        </div>
        {!selected && <p className="text-sm text-slate-500">Chọn một tài khoản để xem lịch sử đăng nhập.</p>}
      </Panel>
      {selected && (
        <Panel
          title="Lần đăng nhập"
          subtitle={`${visible.length} / ${rows.length} sự kiện`}
          action={
            selected ? (
              <Button
                variant="outline"
                disabled={!visible.length}
                onClick={() => downloadCsv(
                  `lich-su-dang-nhap${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`,
                  [["eventType", "Sự kiện"], ["status", "Kết quả"], ["failureReason", "Lý do lỗi"], ["attemptedEmail", "Email đăng nhập"], ["ip", "IP"], ["device", "Thiết bị"], ["createdAt", "Thời điểm"]],
                  visible.map((r) => ({ ...r.source, createdAt: stamp(r.source.createdAt) })),
                )}
              >
                Xuất CSV
              </Button>
            ) : undefined
          }
        >
          <div className="manager-filters mb-5">
            <Field label="Sự kiện">
              <Select label="Lọc theo sự kiện" value={eventType} onChange={setEventType}
                  options={[["", "Tất cả sự kiện"], ...events.map((value) => [value, facilityLabel(value)])]} />
            </Field>
            <Field label="Từ ngày">
              <Input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="Đến ngày">
              <Input aria-label="Đến ngày" type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          <AsyncBoundary
            state={history}
            render={() => (
              <>
                <Table label="Lịch sử đăng nhập" rows={paged.rows} columns={[
                  { key: "event", label: "Sự kiện", render: (r) => facilityLabel(r.source.eventType) || "—" },
                  { key: "status", label: "Kết quả", render: (r) => <Status value={r.source.status} /> },
                  { key: "reason", label: "Lý do lỗi", render: (r) => r.source.failureReason || "—" },
                  { key: "email", label: "Email đăng nhập", render: (r) => r.source.attemptedEmail || "—" },
                  { key: "ip", label: "IP", render: (r) => r.source.ip || "—" },
                  { key: "device", label: "Thiết bị", render: (r) => r.source.device || "—" },
                  { key: "at", label: "Thời điểm", render: (r) => stamp(r.source.createdAt) },
                ]} empty="Không có sự kiện phù hợp bộ lọc." />
                <ListPager
                  page={paged.page}
                  totalPages={paged.totalPages}
                  total={paged.total}
                  loading={history.loading}
                  onPageChange={setPage}
                  unit="sự kiện"
                />
              </>
            )}
          />
        </Panel>
      )}
    </AdminScreen>
  );
}

export function AuditPage() {
  const state = useAdminUsers();
  const [selected, setSelected] = useState("");
  // Filters and paging are applied by GET /audit/logs, which returns the light list DTO
  // (no before/after snapshots) instead of the whole per-account history.
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = usePageIndex(`${selected}|${action}|${entityType}|${from}|${to}`);
  const logs = useAsyncData(async ({ signal }) => {
    if (!selected) return null;
    const response = await auditApi.listLogs({
      actorId: selected,
      page,
      limit: PAGE_SIZE,
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }, { signal });
    const body = response?.data?.data;
    const items = Array.isArray(body?.items) ? body.items : [];
    return { rows: items.map((row, index) => ({ id: row._id || `log-${index}`, source: row })), pagination: body?.pagination ?? null };
  }, [selected, action, entityType, from, to, page]);
  const rows = logs.data?.rows || [];
  const pagination = logs.data?.pagination ?? null;
  const total = pagination?.total ?? rows.length;
  // The filter menus list the values of the current page; the API applies the filter to the whole
  // history, and the selected value stays visible so a choice is never silently dropped.
  const withCurrent = (values, current) => Array.from(new Set([...(current ? [current] : []), ...values]));
  const actionOptions = withCurrent(distinct(rows, (r) => r.source.action), action);
  const entityOptions = withCurrent(distinct(rows, (r) => r.source.entityType), entityType);

  return (
    <AdminScreen
      title="Nhật ký kiểm toán"
      description="Hành động của tài khoản đã chọn."
      action={selected ? <Button variant="outline" onClick={logs.reload} disabled={logs.loading}>Tải lại</Button> : undefined}
    >
      <UserApiState state={state} />
      <Panel title="Chọn tài khoản">
        <div className="manager-filters">
          <UserPicker state={state} value={selected} onChange={setSelected} label="Tài khoản" />
        </div>
        {!selected && <p className="text-sm text-slate-500">Chọn một tài khoản để xem các hành động đã thực hiện.</p>}
      </Panel>
      {selected && (
        <>
          <Panel
            title="Sự kiện kiểm toán"
            subtitle={`${total} sự kiện`}
            action={
              <Button
                variant="outline"
                disabled={!rows.length}
                onClick={() => downloadCsv(
                  `nhat-ky-kiem-toan${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`,
                  [["action", "Hành động đã thực hiện"], ["actorRole", "Vai trò"], ["entityType", "Đối tượng"], ["entityId", "Mã đối tượng"], ["facilityId", "Cơ sở"], ["createdAt", "Thời điểm"]],
                  rows.map((r) => ({ ...r.source, createdAt: stamp(r.source.createdAt) })),
                )}
              >
                Xuất trang này (CSV)
              </Button>
            }
          >
            <div className="manager-filters mb-5">
              <Field label="Hành động">
                <Select label="Lọc theo hành động" value={action} onChange={setAction}
                  options={[["", "Tất cả hành động"], ...actionOptions.map((value) => [value, facilityLabel(value)])]} />
              </Field>
              <Field label="Đối tượng">
                <Select label="Lọc theo đối tượng" value={entityType} onChange={setEntityType}
                  options={[["", "Tất cả đối tượng"], ...entityOptions.map((value) => [value, value])]} />
              </Field>
              <Field label="Từ ngày">
                <Input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </Field>
              <Field label="Đến ngày">
                <Input aria-label="Đến ngày" type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} />
              </Field>
            </div>
            <AsyncBoundary state={logs} render={() => (
              <>
                <Table label="Nhật ký kiểm toán" rows={rows} columns={[
                      { key: "action", label: "Hành động", render: (r) => facilityLabel(r.source.action) || "—" },
                      { key: "role", label: "Vai trò", render: (r) => <Status value={r.source.actorRole} /> },
                      { key: "entity", label: "Đối tượng", render: (r) => `${r.source.entityType || "—"} · ${r.source.entityId || "—"}` },
                      { key: "facility", label: "Cơ sở", render: (r) => r.source.facilityId || "—" },
                      { key: "at", label: "Thời điểm", render: (r) => stamp(r.source.createdAt) },
                      {
                        key: "detail",
                        label: "Chi tiết",
                        render: (r) => (
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/admin/audit/${encodeURIComponent(selected)}/${encodeURIComponent(r.source._id)}`}>Xem</Link>
                          </Button>
                        ),
                      },
                    ]} empty="Không có sự kiện phù hợp bộ lọc." />
                <ListPager
                  page={pagination?.page ?? page}
                  totalPages={pagination?.totalPages ?? 1}
                  total={total}
                  loading={logs.loading}
                  onPageChange={setPage}
                  unit="sự kiện"
                />
              </>
            )} />
          </Panel>
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
  const [page, setPage] = usePageIndex(`${status}|${search}`);
  const paged = pageSlice(rows, page);

  return (
    <AdminScreen
      title="Giám sát cơ sở"
      description="Xem toàn bộ cơ sở trong hệ thống."
      action={<Button variant="outline" onClick={() => { invalidateFacilities(); state.reload(); }} disabled={state.loading}>Tải lại</Button>}
    >
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
      <Panel title="Tổng hợp cơ sở" subtitle={`${rows.length} / ${facilities.length} cơ sở`}>
        <AsyncBoundary state={state} render={() => (
          <>
            <Table label="Cơ sở" rows={paged.rows} columns={[
              { key: "name", label: "Facility" },
              { key: "code", label: "Code" },
              { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
              { key: "district", label: "Khu vực" },
              { key: "address", label: "Address" },
              { key: "services", label: "Service models", render: (f) => f.serviceTypes.map(facilityLabel).join(", ") || "—" },
              { key: "openingHours", label: "Opening hours" },
            ]} />
            <ListPager
              page={paged.page}
              totalPages={paged.totalPages}
              total={paged.total}
              loading={state.loading}
              onPageChange={setPage}
              unit="cơ sở"
            />
          </>
        )} />
      </Panel>
    </AdminScreen>
  );
}
