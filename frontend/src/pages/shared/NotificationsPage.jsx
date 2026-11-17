import { useEffect, useState } from "react";
import { Screen, Panel, Table, Field, Input, Select, Button, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { apiErrorMessage } from "@/lib/apiError";
import { notificationApi } from "@/api/notificationApi";
import { filterNotifications } from "@/lib/facilityNotifications";
import { downloadCsv } from "@/lib/csvExport";

// Shared notification inbox for BOM and Admin. The endpoint returns the notifications of the
// signed-in account only, so this page shows the operator's own operational alerts; the
// backend still has no "send notification" or "notification list for another user" API.
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);

export default function NotificationsPage() {
  const state = useAsyncData(({ signal }) => notificationApi.list({ signal }).then(unwrapList), []);
  const [rows, setRows] = useState([]);
  const [scope, setScope] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { setRows(state.data || []); }, [state.data]);

  const types = [...new Set(rows.map((row) => row.type).filter(Boolean))].sort();
  const visible = filterNotifications(rows, { status: scope, search, from, to })
    .filter((row) => !type || row.type === type);
  const unread = rows.filter((row) => !row.isRead).length;

  async function markRead(row) {
    if (busy) return;
    setBusy(row._id);
    setError("");
    setNotice("");
    try {
      await notificationApi.markRead(row._id);
      setRows((previous) => previous.map((item) => (item._id === row._id ? { ...item, isRead: true } : item)));
      setNotice(`“${row.title}” đã được đánh dấu là đã đọc.`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <Screen
      title="Thông báo"
      description="Thông báo gửi tới tài khoản của bạn. Hãy đánh dấu đã đọc sau khi xử lý."
      action={<Button variant="outline" disabled={state.loading} onClick={state.reload}>Tải lại</Button>}
    >
      <AsyncBoundary state={state} render={() => (
        <>
          <Kpis items={[
            ["Thông báo", rows.length, "Gửi tới tài khoản này"],
            ["Chưa đọc", unread, "Chưa mở"],
            ["Đã đọc", rows.length - unread, "Đã xác nhận"],
            ["Loại thông báo", types.length || "—", "Số loại đang có"],
          ]} />

          <Panel
            title="Hộp thư"
            subtitle={`${visible.length} / ${rows.length} thông báo · mới nhất ở trên cùng.`}
            action={
              <Button
                variant="outline"
                disabled={!visible.length}
                onClick={() => downloadCsv(
                  `thong-bao${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`,
                  [["title", "Tiêu đề"], ["type", "Loại"], ["content", "Nội dung"], ["channel", "Kênh"], ["isRead", "Đã đọc"], ["createdAt", "Thời điểm nhận"]],
                  visible.map((row) => ({
                    ...row,
                    channel: Array.isArray(row.sentVia) && row.sentVia.length ? row.sentVia.join(", ") : "",
                    isRead: row.isRead ? "Đã đọc" : "Chưa đọc",
                    createdAt: row.createdAt ? new Date(row.createdAt).toLocaleString("vi-VN") : "",
                  })),
                )}
              >
                Xuất CSV
              </Button>
            }
          >
            <div className="manager-filters">
              <Field label="Trạng thái đọc">
                <Select
                  label="Lọc theo trạng thái đọc"
                  value={scope}
                  onChange={setScope}
                  options={[["", "Tất cả thông báo"], ["UNREAD", "Chưa đọc"], ["READ", "Đã đọc"]]}
                />
              </Field>
              <Field label="Loại">
                <Select
                  label="Lọc theo loại thông báo"
                  value={type}
                  onChange={setType}
                  options={[["", "Tất cả loại"], ...types.map((value) => [value, value])]}
                />
              </Field>
              <Field label="Tìm kiếm">
                <Input aria-label="Tìm thông báo" value={search} onChange={(event) => setSearch(event.target.value)} />
              </Field>
              <Field label="Từ ngày">
                <Input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </Field>
              <Field label="Đến ngày">
                <Input aria-label="Đến ngày" type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} />
              </Field>
            </div>
            <Message error={error} success={notice} />
            <div className="mt-5">
              <Table
                label="Thông báo"
                rows={visible}
                columns={[
                  { key: "title", label: "Tiêu đề", render: (r) => r.title || "Thông báo" },
                  { key: "type", label: "Loại", render: (r) => r.type || "—" },
                  { key: "content", label: "Nội dung", render: (r) => r.content || "—" },
                  { key: "channel", label: "Kênh", render: (r) => (Array.isArray(r.sentVia) && r.sentVia.length ? r.sentVia.join(", ") : "—") },
                  { key: "state", label: "Trạng thái", render: (r) => (r.isRead ? "Đã đọc" : "Chưa đọc") },
                  { key: "at", label: "Thời điểm nhận", render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("vi-VN") : "—") },
                  {
                    key: "action",
                    label: "Thao tác",
                    render: (r) => (r.isRead
                      ? "—"
                      : (
                        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => markRead(r)}>
                          {busy === r._id ? "Đang lưu…" : "Đánh dấu đã đọc"}
                        </Button>
                      )),
                  },
                ]}
                empty="Không có thông báo phù hợp bộ lọc này."
              />
            </div>
          </Panel>
        </>
      )} />
    </Screen>
  );
}
