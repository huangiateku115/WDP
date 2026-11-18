import { useState } from "react";
import { Screen, Panel, Table, Status, Field, Select, Message } from "@/components/manager/ManagerUI";
import ListPager from "@/components/manager/ListPager";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { pageSlice } from "@/lib/pageSlice";
import { usePageIndex } from "@/lib/usePageIndex";
import { facilityLabel } from "@/lib/facilityLabels";
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
  return user.fullName || user.displayName || user.email || userIdOf(profile) || "Khách hàng";
};
const when = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");

export default function AuditLivePage() {
  const subjects = useAsyncData(({ signal }) => customerProfileApi.list({ signal }).then(unwrapList), []);
  const [subjectId, setSubjectId] = useState("");
  // Both audit reads are per account and unpaged server-side, so each table pages locally and
  // returns to page 1 when another account is selected.
  const [historyPage, setHistoryPage] = usePageIndex(subjectId);
  const [logPage, setLogPage] = usePageIndex(subjectId);
  const historyPaged = pageSlice(records.data?.history || [], historyPage);
  const logsPaged = pageSlice(records.data?.logs || [], logPage);

  const options = [
    ["", "Chọn tài khoản khách hàng"],
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
    <Screen
      title="Rà soát nhật ký"
      description="Lịch sử đăng nhập và hành động của các tài khoản bạn được phép xem."
    >
      <Panel title="Tài khoản có thể rà soát">
        {subjects.loading && <p role="status" className="text-sm text-slate-500">Đang tải danh sách khách hàng…</p>}
        {subjects.error && <Message error={subjects.error} />}
        {!subjects.loading && !subjects.error && (
          <>
            <Field label="Tài khoản khách hàng">
              <Select label="Tài khoản khách hàng" value={subjectId} onChange={setSubjectId} options={options} />
            </Field>
            {options.length <= 1 && (
              <p className="mt-3 text-sm text-slate-500">Chưa có tài khoản khách hàng nào để rà soát.</p>
            )}
          </>
        )}
      </Panel>

      {subjectId && (
        <>
          <Panel title="Lịch sử đăng nhập">
            <AsyncBoundary
              state={records}
              render={(data) => (data ? (
                <>
                  <Table
                    label="Lịch sử đăng nhập"
                    rows={data.history.map((row) => ({ ...row, id: row._id })).slice(historyPaged.start, historyPaged.end)}
                    columns={[
                      { key: "createdAt", label: "Thời điểm", render: (r) => when(r.createdAt) },
                      { key: "eventType", label: "Sự kiện", render: (r) => facilityLabel(r.eventType) || "—" },
                      { key: "status", label: "Kết quả", render: (r) => <Status value={r.status || "—"} /> },
                      { key: "failureReason", label: "Lý do", render: (r) => r.failureReason || "—" },
                      { key: "ip", label: "IP", render: (r) => r.ip || "—" },
                      { key: "device", label: "Thiết bị", render: (r) => r.device || "—" },
                    ]}
                    empty="Tài khoản này chưa có lần đăng nhập nào."
                  />
                  <ListPager
                    page={historyPaged.page}
                    totalPages={historyPaged.totalPages}
                    total={historyPaged.total}
                    loading={records.loading}
                    onPageChange={setHistoryPage}
                    unit="lần đăng nhập"
                  />
                </>
              ) : null)}
            />
          </Panel>
          <Panel title="Hành động đã thực hiện">
            <AsyncBoundary
              state={records}
              render={(data) => (data ? (
                <>
                  <Table
                    label="Hành động đã thực hiện"
                    rows={data.logs.map((row) => ({ ...row, id: row._id })).slice(logsPaged.start, logsPaged.end)}
                    columns={[
                      { key: "createdAt", label: "Thời điểm", render: (r) => when(r.createdAt) },
                      { key: "action", label: "Hành động", render: (r) => facilityLabel(r.action) || "—" },
                      { key: "entityType", label: "Đối tượng", render: (r) => r.entityType || "—" },
                      { key: "entityId", label: "Mã đối tượng", render: (r) => r.entityId || "—" },
                      { key: "reason", label: "Lý do", render: (r) => r.reason || "—" },
                    ]}
                    empty="Tài khoản này chưa có hành động nào được ghi nhận."
                  />
                  <ListPager
                    page={logsPaged.page}
                    totalPages={logsPaged.totalPages}
                    total={logsPaged.total}
                    loading={records.loading}
                    onPageChange={setLogPage}
                    unit="hành động"
                  />
                </>
              ) : null)}
            />
          </Panel>
        </>
      )}
    </Screen>
  );
}
