import { Link, useParams } from "react-router-dom";
import { Panel, Screen, Button, Details } from "@/components/manager/ManagerUI";
import { ReadOnlyValues } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import auditApi from "@/api/auditApi";

// Route-backed audit detail. The backend only exposes per-account audit reads
// (`GET /audit/admin/audit-logs/:userId`), so the URL carries both the account and the log id and
// the page resolves the entry from that account's log.
const unwrap = (response) => {
  const body = response?.data;
  return Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
};
const stamp = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");

export default function AuditLogDetailPage() {
  const { userId = "", logId = "" } = useParams();
  const logs = useAsyncData(() => auditApi.getAdminAuditLogs(userId).then(unwrap), [userId]);
  const record = (logs.data || []).find((row) => row._id === logId) || null;

  return (
    <Screen
      title="Chi tiết nhật ký kiểm toán"
      description="Giá trị trước và sau của một hành động trong nhật ký."
      action={<Button asChild variant="outline"><Link to="/admin/audit">Quay lại nhật ký</Link></Button>}
    >
      <AsyncBoundary
        state={{
          loading: logs.loading,
          error: logs.error,
          data: logs.data,
          reload: logs.reload,
        }}
        render={() => (record ? (
          <Panel
            title={`Chi tiết thay đổi · ${record.action || logId}`}
            subtitle={stamp(record.createdAt)}
            action={<Button asChild variant="outline"><Link to="/admin/audit">Quay lại nhật ký</Link></Button>}
          >
            <Details values={[
              ["Hành động", record.action || "—"],
              ["Vai trò", record.actorRole || "—"],
              ["Đối tượng", `${record.entityType || "—"} · ${record.entityId || "—"}`],
              ["Cơ sở", record.facilityId || "—"],
              ["Thời điểm", stamp(record.createdAt)],
            ]} />
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div><h4 className="mb-2 font-bold">Trước</h4><ReadOnlyValues value={record.before} /></div>
              <div><h4 className="mb-2 font-bold">Sau</h4><ReadOnlyValues value={record.after} /></div>
            </div>
            {record.reason && <p className="mt-5 text-sm text-slate-500">Lý do: {record.reason}</p>}
          </Panel>
        ) : (
          <Panel title="Không tìm thấy bản ghi">
            <p className="text-sm text-slate-500">Bản ghi này không thuộc tài khoản đã chọn hoặc đã bị xóa.</p>
            <Button asChild variant="outline" className="mt-4"><Link to="/admin/audit">Quay lại nhật ký</Link></Button>
          </Panel>
        ))} />
    </Screen>
  );
}
