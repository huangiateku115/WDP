import { useState } from "react";
import { BomScreen } from "@/components/bom/BomUI";
import { Panel, Details, Table, Status, Field, Select, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import customerProfileApi from "@/api/customerProfileApi";
import auditApi from "@/api/auditApi";

// BOM audit review.
// Backend contract (routes/audit.routes.ts + controllers/audit/audit.controller.ts):
//   GET /audit/bom/login-history/:userId   BOM only; target must not be ADMIN/BOM
//   GET /audit/bom/audit-logs/:userId      BOM only; target must not be ADMIN/BOM
// BOM cannot call GET /users (ADMIN-only), but GET /customers is allowed for BOM and returns the
// populated userId of every customer profile, so customer accounts are reviewable today.
// Reviewing FACILITY_STAFF / FACILITY_MANAGER accounts still needs GET /audit/bom/subjects.
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);
const userIdOf = (profile) =>
  profile?.userId && typeof profile.userId === "object" ? profile.userId._id : profile?.userId;
const accountLabel = (profile) => {
  const user = profile?.userId && typeof profile.userId === "object" ? profile.userId : {};
  return user.fullName || user.displayName || user.email || userIdOf(profile) || "Customer";
};
const when = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");

export default function AuditLivePage() {
  const subjects = useAsyncData(({ signal }) => customerProfileApi.list({ signal }).then(unwrapList), []);
  const [subjectId, setSubjectId] = useState("");

  const options = [
    ["", "Select a customer account"],
    ...(subjects.data || [])
      .map((profile) => [userIdOf(profile), accountLabel(profile)])
      .filter(([id]) => typeof id === "string" && id.length > 0),
  ];

  // Both reads are per-user; the backend refuses ADMIN/BOM targets with 403.
  const records = useAsyncData(async ({ signal }) => {
    if (!subjectId) return null;
    const [history, logs] = await Promise.all([
      auditApi.getBomLoginHistory(subjectId, { signal }).then(unwrapList),
      auditApi.getBomAuditLogs(subjectId, { signal }).then(unwrapList),
    ]);
    return { history, logs };
  }, [subjectId]);

  return (
    <BomScreen
      title="Audit review"
      description="Sign-in events and audit actions for accounts below the BOM level."
    >
      <Panel
        title="Reviewable account"
        subtitle="BOM may review accounts below its own level; the backend refuses ADMIN and BOM targets."
      >
        {subjects.loading && <p role="status" className="text-sm text-slate-500">Loading customer accounts…</p>}
        {subjects.error && <Message error={subjects.error} />}
        {!subjects.loading && !subjects.error && (
          <>
            <Field
              label="Customer account"
              hint="Customer accounts come from GET /customers, which the backend allows for BOM."
            >
              <Select label="Customer account" value={subjectId} onChange={setSubjectId} options={options} />
            </Field>
            {options.length <= 1 && (
              <p className="mt-3 text-sm text-slate-500">The backend returned no customer account to review.</p>
            )}
          </>
        )}
        <div className="mt-5">
          <Details
            values={[
              ["Available now", "GET /customers for the account list, then GET /audit/bom/login-history/:userId and GET /audit/bom/audit-logs/:userId."],
              ["Still missing", "GET /audit/bom/subjects — required to review FACILITY_STAFF / FACILITY_MANAGER accounts."],
              ["Not available", "A global audit collection with server-side filters and export."],
            ]}
          />
        </div>
      </Panel>

      {subjectId && (
        <>
          <Panel title="Sign-in history" subtitle="From GET /audit/bom/login-history/:userId.">
            <AsyncBoundary
              state={records}
              render={({ history }) => (
                <Table
                  label="Sign-in history"
                  rows={history.map((row) => ({ ...row, id: row._id }))}
                  columns={[
                    { key: "createdAt", label: "When", render: (r) => when(r.createdAt) },
                    { key: "eventType", label: "Event", render: (r) => r.eventType || "—" },
                    { key: "status", label: "Result", render: (r) => <Status value={r.status || "—"} /> },
                    { key: "failureReason", label: "Reason", render: (r) => r.failureReason || "—" },
                    { key: "ip", label: "IP", render: (r) => r.ip || "—" },
                    { key: "device", label: "Device", render: (r) => r.device || "—" },
                  ]}
                  empty="No sign-in event was returned for this account."
                />
              )}
            />
          </Panel>
          <Panel title="Audit actions" subtitle="From GET /audit/bom/audit-logs/:userId.">
            <AsyncBoundary
              state={records}
              render={({ logs }) => (
                <Table
                  label="Audit actions"
                  rows={logs.map((row) => ({ ...row, id: row._id }))}
                  columns={[
                    { key: "createdAt", label: "When", render: (r) => when(r.createdAt) },
                    { key: "action", label: "Action", render: (r) => r.action || "—" },
                    { key: "entityType", label: "Entity", render: (r) => r.entityType || "—" },
                    { key: "entityId", label: "Entity id", render: (r) => r.entityId || "—" },
                    { key: "reason", label: "Reason", render: (r) => r.reason || "—" },
                  ]}
                  empty="No audit action was returned for this account."
                />
              )}
            />
          </Panel>
        </>
      )}
    </BomScreen>
  );
}
