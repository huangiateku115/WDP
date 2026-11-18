import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Panel, Table, Status, OpenLink, Field, Input, Select, Details, Button, Message,
} from "@/components/manager/ManagerUI";
import { AdminScreen, UserApiState, ApiConfirmation } from "@/components/admin/AdminUI";
import ListPager from "@/components/bom/ListPager";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import {
  useAdminUsers, loadAdminUsers, userId, userStatus, isInactive, facilityIdOf,
  createAdminUser, changeAdminUserRole, deactivateAdminUser, reactivateAdminUser, updateAdminUser,
  assignAdminUserFacility, unassignAdminUserFacility,
} from "@/lib/adminUsers";
import { apiErrorMessage } from "@/lib/apiError";
import { pageSlice } from "@/lib/pageSlice";
import { usePageIndex } from "@/lib/usePageIndex";
import { ROLE_LABELS } from "@/lib/roles";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities } from "@/lib/bomApiData";

// Live Admin user administration on top of the confirmed User APIs.
// Adds Reactivate (PATCH /users/:id/reactivate) and Edit (PUT /users/:id) to the existing
// list/create/detail, role-change and deactivate operations.
export default function UsersLivePage({ create = false }) {
  const state = useAdminUsers();
  const { id } = useParams();
  if (create) return <CreateUser key="create" state={state} />;
  if (id) return <UserDetail key={id} state={state} id={id} />;
  return <UserDirectory state={state} />;
}

function UserDirectory({ state }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const hasStatus = state.users.some((u) => userStatus(u) !== null);
  const fields = [["displayName", "Display name"], ["email", "Email"], ["phone", "Phone"], ["role", "Role"]]
    .filter(([key]) => state.users.some((u) => typeof u[key] === "string"));
  const rows = state.users
    .filter((u) =>
      `${userId(u) || ""} ${u.displayName || ""} ${u.email || ""} ${u.phone || ""}`.toLowerCase().includes(search.toLowerCase()) &&
      (!role || u.role === role) &&
      (!status || userStatus(u) === status))
    .map((u, index) => ({ id: userId(u) || `row-${index}`, source: u }));
  // GET /users has no page/limit contract, so the directory is sliced in the browser and the
  // page resets whenever a filter changes.
  const [page, setPage] = usePageIndex(`${search}|${role}|${status}`);
  const paged = pageSlice(rows, page);
  const columns = [
    { key: "identity", label: "Mã người dùng", render: (r) => userId(r.source) || "Không có mã" },
    ...fields.map(([key, label]) => ({
      key, label,
        render: (r) => (key === "role" ? <Status value={ROLE_LABELS[r.source[key]] || r.source[key]} /> : r.source[key] ?? "Không có dữ liệu"),
    })),
    ...(hasStatus ? [{ key: "status", label: "Trạng thái", render: (r) => (userStatus(r.source) ? <Status value={userStatus(r.source)} /> : "Không có dữ liệu") }] : []),
    { key: "detail", label: "Thao tác", render: (r) => (userId(r.source) ? <OpenLink to={`/admin/users/${encodeURIComponent(userId(r.source))}`}>Xem người dùng</OpenLink> : "Không xem được chi tiết") },
  ];

  return (
    <AdminScreen
      title="Người dùng"
      description="Tìm kiếm và quản lý tài khoản người dùng."
      action={(
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => loadAdminUsers(true)} disabled={state.status === "loading"}>Tải lại</Button>
          <Button asChild variant="orange"><Link to="/admin/users/new">Tạo người dùng</Link></Button>
        </div>
      )}
    >
      <UserApiState state={state} />
      {state.status === "ready" && state.sessionToken && (
        <Panel
          title="Danh sách người dùng"
          subtitle="Các tài khoản bạn có thể quản lý."
        >
          <div className="manager-filters">
            <Field label="Tìm kiếm">
              <Input aria-label="Tìm người dùng" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <Field label="Vai trò">
              <Select label="Lọc theo vai trò" value={role} onChange={setRole} options={[["", "Tất cả vai trò"], ...state.roles.map((r) => [r, ROLE_LABELS[r] || r])]} />
            </Field>
            {hasStatus && (
              <Field label="Trạng thái">
                <Select label="Lọc theo trạng thái" value={status} onChange={setStatus} options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
              </Field>
            )}
          </div>
          <AsyncBoundary
            state={{ loading: state.status === "loading", error: state.status === "error" ? state.error : "", data: paged.rows, reload: () => loadAdminUsers(true) }}
            render={() => (
              <>
                <Table label="Người dùng" rows={paged.rows} columns={columns} />
                <ListPager
                  page={paged.page}
                  totalPages={paged.totalPages}
                  total={paged.total}
                  loading={state.status === "loading"}
                  onPageChange={setPage}
                  unit="người dùng"
                />
              </>
            )}
          />
        </Panel>
      )}
    </AdminScreen>
  );
}

function UserDetail({ state, id }) {
  const facilities = useAsyncData(loadFacilities, []);
  const row = state.users.find((u) => userId(u) === id);
  if (!state.sessionToken || state.status !== "ready")
    return (
      <AdminScreen title="Chi tiết người dùng" description="Thông tin tài khoản.">
        <UserApiState state={state} />
      </AdminScreen>
    );

  if (!row)
    return (
      <AdminScreen title="Không tìm thấy người dùng" description="Tài khoản này không khả dụng.">
        <UserApiState state={state} />
        <Panel title="Tài khoản không khả dụng">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => loadAdminUsers(true)}>Tải lại danh sách</Button>
            <Button asChild variant="outline"><Link to="/admin/users">Quay lại danh sách</Link></Button>
          </div>
        </Panel>
      </AdminScreen>
    );

  const inactive = isInactive(row);
  const facility = facilityIdOf(row);
  const facilityLabel = facility ? ((facilities.data || []).find((item) => item.id === facility)?.name || facility) : "Not assigned";
  const values = [
    ["User ID", userId(row)],
    ...["displayName", "email", "phone"].filter((k) => typeof row[k] === "string").map((k) => [[["displayName", "Display name"], ["email", "Email"], ["phone", "Phone"]].find(([key]) => key === k)[1], row[k]]),
    ["Role", <Status value={row.role} />],
    ...(userStatus(row) ? [["Status", <Status value={userStatus(row)} />]] : []),
    ["Facility scope", facilityLabel],
  ];

  return (
    <AdminScreen title={row.displayName || row.email || "Tài khoản"} description="Thông tin và thao tác trên tài khoản.">
      <UserApiState state={state} />
      <Panel title="Thông tin tài khoản" action={<Button asChild variant="outline"><Link to="/admin/users">Quay lại danh sách</Link></Button>}>
        <Details values={values} />
      </Panel>

      <EditAccount row={row} id={id} />

      <Panel title="Đổi vai trò">
        <RoleChange row={row} id={id} roles={state.roles} />
      </Panel>

      <FacilityScope row={row} id={id} facilities={facilities.data || []} />

      <Panel title="Trạng thái tài khoản" subtitle={inactive ? "Ngừng hoạt động" : "Đang hoạt động"}>
        {inactive
          ? <ApiConfirmation
              label="Kích hoạt lại tài khoản"
              title="Xác nhận kích hoạt lại tài khoản"
              summary={<Details values={[["Account", row.email || userId(row)], ["Action", "Reactivate"]]} />}
              run={() => reactivateAdminUser(id)}
            />
          : <ApiConfirmation
              label="Ngừng tài khoản"
              title="Xác nhận ngừng tài khoản"
              summary={<Details values={[["Account", row.email || userId(row)], ["Action", "Deactivate"]]} />}
              run={() => deactivateAdminUser(id)}
            />}
      </Panel>
    </AdminScreen>
  );
}

function FacilityScope({ row, id, facilities }) {
  const eligible = ["FACILITY_MANAGER", "FACILITY_STAFF"].includes(row.role);
  const current = facilityIdOf(row);
  const [facilityId, setFacilityId] = useState("");
  if (!eligible)
    return (
      <Panel title="Phạm vi cơ sở">
        <p className="text-sm text-slate-500">Vai trò này không dùng phạm vi cơ sở.</p>
      </Panel>
    );
  return (
    <Panel title="Phạm vi cơ sở" subtitle="Gán hoặc gỡ cơ sở mà tài khoản này phụ trách.">
      <Field label="Cơ sở được gán">
        <Select
          label="Cơ sở được gán"
          value={facilityId}
          onChange={setFacilityId}
          options={[["", current ? "Chọn cơ sở khác" : "Chọn cơ sở"], ...facilities.map((item) => [item.id, `${item.name} (${item.code})`])]}
        />
      </Field>
      <div className="mt-4 flex flex-wrap gap-3">
        <ApiConfirmation
          label="Gán cơ sở"
          title="Xác nhận gán cơ sở"
          disabled={!facilityId || facilityId === current}
          summary={<Details values={[["Account", row.email || userId(row)], ["Facility", facilities.find((item) => item.id === facilityId)?.name || facilityId || "—"]]} />}
          run={() => assignAdminUserFacility(id, facilityId)}
        />
        {current && (
          <ApiConfirmation
            label="Gỡ cơ sở"
            title="Xác nhận gỡ cơ sở"
            summary={<Details values={[["Account", row.email || userId(row)], ["Current facility", current]]} />}
            run={() => unassignAdminUserFacility(id)}
          />
        )}
      </div>
    </Panel>
  );
}

function EditAccount({ row, id }) {
  const [form, setForm] = useState({
    displayName: row.displayName || "",
    email: row.email || "",
    phone: row.phone || "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const busy = useRef(false);
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await updateAdminUser(id, form);
      setSuccess("Đã cập nhật thông tin tài khoản.");
    } catch (err) {
      setError(apiErrorMessage(err, "Không cập nhật được tài khoản."));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Panel title="Sửa tài khoản" subtitle="Cập nhật tên hiển thị, số điện thoại và email.">
      <form className="admin-form" onSubmit={submit}>
        <Field label="Tên hiển thị"><Input aria-label="Sửa tên hiển thị" required value={form.displayName} onChange={(e) => change("displayName", e.target.value)} disabled={pending} /></Field>
        <Field label="Email"><Input aria-label="Sửa email" type="email" required value={form.email} onChange={(e) => change("email", e.target.value)} disabled={pending} /></Field>
        <Field label="Số điện thoại"><Input aria-label="Sửa số điện thoại" type="tel" value={form.phone} onChange={(e) => change("phone", e.target.value)} disabled={pending} /></Field>
        <div className="admin-wide space-y-4">
          <Message error={error} success={success} />
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : "Lưu tài khoản"}</Button>
        </div>
      </form>
    </Panel>
  );
}

function RoleChange({ row, id, roles }) {
  const [selected, setSelected] = useState("");
  return (
    <div className="space-y-5">
      <Field label="Vai trò mới">
        <Select label="Vai trò mới" value={selected} onChange={setSelected} options={[["", "Chọn vai trò"], ...roles.map((r) => [r, ROLE_LABELS[r] || r])]} />
      </Field>
      <ApiConfirmation
        label="Xem lại thay đổi vai trò"
        title="Xác nhận đổi vai trò"
        disabled={!selected || selected === row.role}
        summary={<Details values={[["Account", row.email || userId(row)], ["Current role", <Status value={ROLE_LABELS[row.role] || row.role} />], ["New role", <Status value={ROLE_LABELS[selected] || selected} />]]} />}
        run={() => changeAdminUserRole(id, selected)}
      />
    </div>
  );
}

function CreateUser({ state }) {
  const nav = useNavigate();
  const facilities = useAsyncData(loadFacilities, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(state.roles[0] || "FACILITY_MANAGER");
  const [facilityId, setFacilityId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Set when the account exists but the facility scope could not be attached.
  const [unassignedId, setUnassignedId] = useState("");
  const busy = useRef(false);
  // Only Facility Manager / Facility Staff accounts carry a Facility scope, and the backend
  // refuses to assign one to any other role (facility-assignment.service.ts).
  const needsFacility = ["FACILITY_MANAGER", "FACILITY_STAFF"].includes(role);
  const facilityOptions = facilities.data || [];

  async function submit(event) {
    event.preventDefault();
    if (busy.current || !state.sessionToken) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (needsFacility && !facilityId) throw new Error("Hãy chọn cơ sở cho tài khoản này.");
      const createdId = await createAdminUser({ email, password, displayName, phone, role }, () => setPassword(""));
      if (needsFacility) {
        if (!createdId) {
          // The backend creates the account without a facility scope, so the assignment is a
          // second call. If the id is not returned the account still exists: send the operator to
          // the detail page instead of leaving a half-configured account behind.
          setError("Đã tạo tài khoản nhưng máy chủ không trả về mã tài khoản. Hãy mở trang tài khoản để gán cơ sở.");
          nav("/admin/users");
          return;
        }
        try {
          await assignAdminUserFacility(createdId, facilityId);
        } catch (assignError) {
          setError(`Đã tạo tài khoản nhưng gán cơ sở thất bại: ${apiErrorMessage(assignError, "lỗi không xác định")}`);
          setUnassignedId(createdId);
          return;
        }
      }
      nav("/admin/users");
    } catch (err) {
      setError(apiErrorMessage(err, "Không tạo được tài khoản."));
    } finally {
      setPassword("");
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <AdminScreen title="Tạo người dùng" description="Tạo tài khoản mới.">
      {!state.sessionToken && <UserApiState state={state} />}
      <Panel title="Tài khoản mới">
        <form onSubmit={submit} className="admin-form">
          <Field label="Email"><Input aria-label="Email người dùng mới" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} /></Field>
          <Field label="Mật khẩu"><Input aria-label="Mật khẩu người dùng mới" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} /></Field>
          <Field label="Tên hiển thị"><Input aria-label="Tên hiển thị người dùng mới" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={pending} /></Field>
          <Field label="Số điện thoại"><Input aria-label="Số điện thoại người dùng mới" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending} /></Field>
          <Field label="Vai trò"><Select label="Vai trò người dùng mới" value={role} onChange={(value) => { setRole(value); setFacilityId(""); }} options={state.roles.map((r) => [r, ROLE_LABELS[r] || r])} disabled={pending} /></Field>
          {needsFacility && (
            <Field
              label="Phạm vi cơ sở"
              hint={facilities.error
                ? "Không tải được danh sách cơ sở. Hãy tạo tài khoản rồi gán cơ sở ở trang chi tiết."
                : "Bắt buộc: tài khoản Quản lý hoặc Nhân viên chưa được gán cơ sở sẽ không có quyền truy cập."}
            >
              <Select
                label="Cơ sở của người dùng mới"
                value={facilityId}
                onChange={setFacilityId}
                disabled={pending || facilities.loading || Boolean(facilities.error)}
                options={[["", facilities.loading ? "Đang tải danh sách cơ sở…" : "Chọn cơ sở"], ...facilityOptions.map((f) => [f.id, `${f.name} (${f.code})`])]}
              />
            </Field>
          )}
          <div className="admin-wide space-y-4">
            <Message error={error} />
            {unassignedId && (
              <p className="bom-warning">
                Tài khoản đã được tạo. Gán cơ sở ngay để tài khoản dùng được.{" "}
                <Link className="manager-link font-semibold" to={`/admin/users/${unassignedId}`}>Mở trang tài khoản</Link>
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang tạo…" : "Tạo người dùng"}</Button>
              <Button type="button" variant="outline" onClick={() => nav("/admin/users")}>Hủy</Button>
            </div>
          </div>
        </form>
      </Panel>
    </AdminScreen>
  );
}
