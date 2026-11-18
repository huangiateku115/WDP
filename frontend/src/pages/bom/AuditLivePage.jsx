import { useState } from "react";
import { Screen, Panel, Table, Status, Field, Select, Input, Message } from "@/components/manager/ManagerUI";
import ListPager from "@/components/manager/ListPager";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { PAGE_SIZE, pageSlice } from "@/lib/pageSlice";
import { usePageIndex } from "@/lib/usePageIndex";
import { facilityLabel } from "@/lib/facilityLabels";
import auditApi from "@/api/auditApi";

// BOM audit review.
// Backend contract (routes/audit.routes.ts + services/audit/audit.service.ts):
//   GET /audit/bom/subjects?search&role&status&page&limit   BOM only, never ADMIN/BOM targets
//   GET /audit/bom/login-history/:userId                    whole per-account history (unpaged)
//   GET /audit/logs?actorId&page&limit                      paged light list DTO, BOM-scoped
// The paged reads replaced GET /customers (whole collection with PII) and the unpaged
// per-account audit list, which shipped every before/after snapshot just to render 20 rows.
const SUBJECT_LIMIT = 100;
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);
const when = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");
const subjectLabel = (row) =>
  `${row.displayName || row.email || row._id}${row.role ? ` · ${facilityLabel(row.role)}` : ""}`;

export default function AuditLivePage() {
  // The backend exposes a paged, searchable subject list for BOM (customers and facility
  // accounts), so the picker never downloads every customer profile to fill a <Select>.
  const [subjectSearch, setSubjectSearch] = useState("");
  const search = useDebouncedValue(subjectSearch);
  const subjects = useAsyncData(async ({ signal }) => {
    const response = await auditApi.listSubjects("bom", {
      limit: SUBJECT_LIMIT,
      ...(search.trim() ? { search: search.trim() } : {}),
    }, { signal });
    const body = response?.data?.data;
    return { items: Array.isArray(body?.items) ? body.items : [], pagination: body?.pagination ?? null };
  }, [search]);

  const [subjectId, setSubjectId] = useState("");
  const [historyPage, setHistoryPage] = usePageIndex(subjectId);
  const [logPage, setLogPage] = usePageIndex(subjectId);

  const subjectItems = subjects.data?.items || [];
  const options = [
    ["", "Chọn tài khoản"],
    // A chosen account stays selectable even when a new search no longer returns it.
    ...(subjectId && !subjectItems.some((row) => String(row._id) === subjectId)
      ? [[subjectId, "Tài khoản đã chọn"]]
      : []),
    ...subjectItems.map((row) => [String(row._id), subjectLabel(row)]),
  ];

  // Login history is unpaged server-side; the audit actions use the paged list read.
  const records = useAsyncData(async ({ signal }) => {
    if (!subjectId) return null;
    const [history, logs] = await Promise.all([
      auditApi.getBomLoginHistory(subjectId, { signal }).then(unwrapList),
      auditApi.listLogs({ actorId: subjectId, page: logPage, limit: PAGE_SIZE }, { signal }),
    ]);
    const body = logs?.data?.data;
    return {
      history,
      logs: Array.isArray(body?.items) ? body.items : [],
      logsPagination: body?.pagination ?? null,
    };
  }, [subjectId, logPage]);

  const historyPaged = pageSlice(records.data?.history || [], historyPage);
  const logsPagination = records.data?.logsPagination ?? null;

  return (
    <Screen
      title="Rà soát nhật ký"
      description="Lịch sử đăng nhập và hành động của các tài khoản bạn được phép xem."
    >
      <Panel title="Tài khoản có thể rà soát">
        {subjects.loading && <p role="status" className="text-sm text-slate-500">Đang tải danh sách tài khoản…</p>}
        {subjects.error && <Message error={subjects.error} />}
        {!subjects.loading && !subjects.error && (
          <>
            <div className="manager-filters">
              <Field label="Tìm tài khoản" hint="Theo tên hoặc email.">
                <Input aria-label="Tìm tài khoản cần rà soát" value={subjectSearch} onChange={(e) => setSubjectSearch(e.target.value)} />
              </Field>
            </div>
            <Field label="Tài khoản">
              <Select label="Tài khoản cần rà soát" value={subjectId} onChange={setSubjectId} options={options} />
            </Field>
            {subjectItems.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">Không tìm thấy tài khoản phù hợp để rà soát.</p>
            )}
            {subjects.data?.pagination && subjects.data.pagination.total > subjectItems.length && (
              <p className="mt-3 text-sm text-slate-500">
                Đang hiển thị {subjectItems.length} / {subjects.data.pagination.total} tài khoản. Hãy thu hẹp từ khoá.
              </p>
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
                    rows={data.logs.map((row) => ({ ...row, id: row._id }))}
                    columns={[
                      { key: "createdAt", label: "Thời điểm", render: (r) => when(r.createdAt) },
                      { key: "action", label: "Hành động", render: (r) => facilityLabel(r.action) || "—" },
                      { key: "entityType", label: "Đối tượng", render: (r) => r.entityType || "—" },
                      { key: "entityId", label: "Mã đối tượng", render: (r) => r.entityId || "—" },
                    ]}
                    empty="Tài khoản này chưa có hành động nào được ghi nhận."
                  />
                  <ListPager
                    page={logsPagination?.page ?? logPage}
                    totalPages={logsPagination?.totalPages ?? 1}
                    total={logsPagination?.total ?? data.logs.length}
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
