import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Panel, Table, Status, OpenLink, Field, Input, Select, Details, Button, Message,
} from "@/components/manager/ManagerUI";
import { AdminScreen, UserApiState, ApiConfirmation } from "@/components/admin/AdminUI";
import {
  useAdminUsers, loadAdminUsers, userId, userStatus, isInactive, facilityIdOf,
  createAdminUser, changeAdminUserRole, deactivateAdminUser, reactivateAdminUser, updateAdminUser,
  assignAdminUserFacility, unassignAdminUserFacility,
} from "@/lib/adminUsers";
import { apiErrorMessage } from "@/lib/apiError";
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
  const columns = [
    { key: "identity", label: "User ID", render: (r) => userId(r.source) || "ID not returned" },
    ...fields.map(([key, label]) => ({
      key, label,
      render: (r) => (key === "role" ? <Status value={r.source[key]} /> : r.source[key] ?? "Not returned"),
    })),
    ...(hasStatus ? [{ key: "status", label: "Status", render: (r) => (userStatus(r.source) ? <Status value={userStatus(r.source)} /> : "Not returned") }] : []),
    { key: "detail", label: "Action", render: (r) => (userId(r.source) ? <OpenLink to={`/admin/users/${encodeURIComponent(userId(r.source))}`}>View user</OpenLink> : "Detail unavailable without a backend ID") },
  ];

  return (
    <AdminScreen
      title="Backend users"
      description="Search and manage user accounts."
      action={<Button asChild variant="orange"><Link to="/admin/users/new">Create user</Link></Button>}
    >
      <UserApiState state={state} />
      {state.status === "ready" && state.sessionToken && (
        <Panel
          title="User directory"
          subtitle="This collection contains backend records only."
          action={<Button variant="outline" onClick={() => loadAdminUsers(true)}>Refresh users</Button>}
        >
          <div className="manager-filters">
            <Field label="Search">
              <Input aria-label="User search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <Field label="Role">
              <Select label="User role filter" value={role} onChange={setRole} options={[["", "All returned roles"], ...state.roles]} />
            </Field>
            {hasStatus && (
              <Field label="Status">
                <Select label="User status filter" value={status} onChange={setStatus} options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
              </Field>
            )}
          </div>
          <Table label="Backend users" rows={rows} columns={columns} />
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
      <AdminScreen title="Backend user detail" description="Details are resolved from the loaded user collection.">
        <UserApiState state={state} />
      </AdminScreen>
    );

  if (!row)
    return (
      <AdminScreen title="User unavailable in the loaded collection" description="This account is not in the loaded collection. Reload the directory or return to it.">
        <UserApiState state={state} />
        <Panel title="Account unavailable">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => loadAdminUsers(true)}>Reload user collection</Button>
            <Button asChild variant="outline"><Link to="/admin/users">Back to users</Link></Button>
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
    <AdminScreen title={row.displayName || row.email || "Backend user"} description="Identity and supported account actions from the loaded backend user collection.">
      <UserApiState state={state} />
      <Panel title="Account identity" action={<Button asChild variant="outline"><Link to="/admin/users">Back to users</Link></Button>}>
        <Details values={values} />
      </Panel>

      <EditAccount row={row} id={id} />

      <Panel title="Change account role">
        <RoleChange row={row} id={id} roles={state.roles} />
      </Panel>

      <FacilityScope row={row} id={id} facilities={facilities.data || []} />

      <Panel title="Account status" subtitle={inactive ? "This account is inactive according to the loaded backend data." : "This account is active according to the loaded backend data."}>
        {inactive
          ? <ApiConfirmation
              label="Reactivate account"
              title="Confirm account reactivation"
              summary={<Details values={[["Account", row.email || userId(row)], ["Action", "Reactivate (PATCH /users/:id/reactivate)"]]} />}
              run={() => reactivateAdminUser(id)}
            />
          : <ApiConfirmation
              label="Deactivate account"
              title="Confirm account deactivation"
              summary={<Details values={[["Account", row.email || userId(row)], ["Action", "Deactivate (DELETE /users/:id)"]]} />}
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
      <Panel title="Facility scope" subtitle="Only Facility Manager and Facility Staff accounts can be assigned to a Facility.">
        <p className="text-sm text-slate-500">This role does not use a Facility scope.</p>
      </Panel>
    );
  return (
    <Panel title="Facility scope" subtitle="PATCH/DELETE /users/:id/facility-assignment.">
      <Field label="Assigned facility">
        <Select
          label="Assigned facility"
          value={facilityId}
          onChange={setFacilityId}
          options={[["", current ? "Select another facility" : "Select a facility"], ...facilities.map((item) => [item.id, `${item.name} (${item.code})`])]}
        />
      </Field>
      <div className="mt-4 flex flex-wrap gap-3">
        <ApiConfirmation
          label="Assign facility"
          title="Confirm facility assignment"
          disabled={!facilityId || facilityId === current}
          summary={<Details values={[["Account", row.email || userId(row)], ["Facility", facilities.find((item) => item.id === facilityId)?.name || facilityId || "—"]]} />}
          run={() => assignAdminUserFacility(id, facilityId)}
        />
        {current && (
          <ApiConfirmation
            label="Unassign facility"
            title="Confirm facility unassignment"
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
      setSuccess("User profile updated through the backend API.");
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to update the account."));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Panel title="Edit account" subtitle="Update the display name, phone and email.">
      <form className="admin-form" onSubmit={submit}>
        <Field label="Display name"><Input aria-label="Edit display name" required value={form.displayName} onChange={(e) => change("displayName", e.target.value)} disabled={pending} /></Field>
        <Field label="Email"><Input aria-label="Edit email" type="email" required value={form.email} onChange={(e) => change("email", e.target.value)} disabled={pending} /></Field>
        <Field label="Phone"><Input aria-label="Edit phone" type="tel" value={form.phone} onChange={(e) => change("phone", e.target.value)} disabled={pending} /></Field>
        <div className="admin-wide space-y-4">
          <Message error={error} success={success} />
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : "Save account"}</Button>
        </div>
      </form>
    </Panel>
  );
}

function RoleChange({ row, id, roles }) {
  const [selected, setSelected] = useState("");
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">Only supported roles or roles already present in the collection are selectable.</p>
      <Field label="New account role">
        <Select label="New account role" value={selected} onChange={setSelected} options={[["", "Select role"], ...roles]} />
      </Field>
      <ApiConfirmation
        label="Review role change"
        title="Confirm role change"
        disabled={!selected || selected === row.role}
        summary={<Details values={[["Account", row.email || userId(row)], ["Current role", <Status value={row.role} />], ["New role", <Status value={selected} />]]} />}
        run={() => changeAdminUserRole(id, selected)}
      />
    </div>
  );
}

function CreateUser({ state }) {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(state.roles[0] || "FACILITY_MANAGER");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (busy.current || !state.sessionToken) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await createAdminUser({ email, password, displayName, phone, role }, () => setPassword(""));
      nav("/admin/users");
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to create the account."));
    } finally {
      setPassword("");
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <AdminScreen title="Create backend user" description="Create an account. Identity, password and role are validated on submit.">
      {!state.sessionToken && <UserApiState state={state} />}
      <Panel title="New account">
        <form onSubmit={submit} className="admin-form">
          <Field label="Email"><Input aria-label="New user email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} /></Field>
          <Field label="Password"><Input aria-label="New user password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} /></Field>
          <Field label="Display name"><Input aria-label="New user display name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={pending} /></Field>
          <Field label="Phone"><Input aria-label="New user phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending} /></Field>
          <Field label="Role"><Select label="New user role" value={role} onChange={setRole} options={state.roles} disabled={pending} /></Field>
          <div className="admin-wide space-y-4">
            <p className="text-xs text-slate-500">Role choices are the supported roles plus any role already present in the loaded data. Passwords are cleared immediately after submission.</p>
            <Message error={error} />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="orange" disabled={pending}>{pending ? "Creating…" : "Create user"}</Button>
              <Button type="button" variant="outline" onClick={() => nav("/admin/users")}>Cancel</Button>
            </div>
          </div>
        </form>
      </Panel>
    </AdminScreen>
  );
}
