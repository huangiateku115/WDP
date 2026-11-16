import { useEffect, useState } from "react";
import { Screen, Panel, Table, Field, Select, Button, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { apiErrorMessage } from "@/lib/apiError";
import { notificationApi } from "@/api/notificationApi";

// Shared notification inbox for BOM and Admin. The endpoint returns the notifications of the
// signed-in account only, so this page shows the operator's own operational alerts; the
// backend still has no "send notification" or "notification list for another user" API.
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);

function toRow(notification) {
  const sentVia = Array.isArray(notification?.sentVia) ? notification.sentVia : [];
  return {
    id: notification?._id,
    title: notification?.title || "Thông báo",
    type: notification?.type || "",
    content: notification?.content || "",
    channel: sentVia.length ? sentVia.join(", ") : "—",
    isRead: Boolean(notification?.isRead),
    at: notification?.createdAt ? new Date(notification.createdAt).toLocaleString("vi-VN") : "—",
    atRaw: notification?.createdAt || "",
  };
}

export default function NotificationsPage() {
  const state = useAsyncData(({ signal }) => notificationApi.list({ signal }).then(unwrapList).then((rows) => rows.map(toRow)), []);
  const [rows, setRows] = useState([]);
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { setRows(state.data || []); }, [state.data]);

  const visible = rows.filter((row) => (scope === "UNREAD" ? !row.isRead : scope === "READ" ? row.isRead : true));
  const unread = rows.filter((row) => !row.isRead).length;

  async function markRead(row) {
    if (busy) return;
    setBusy(row.id);
    setError("");
    setNotice("");
    try {
      await notificationApi.markRead(row.id);
      setRows((previous) => previous.map((item) => (item.id === row.id ? { ...item, isRead: true } : item)));
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
            ["Cũ nhất", rows.length ? rows[rows.length - 1].at.slice(0, 10) : "—", "Thông báo cũ nhất trong hộp thư"],
          ]} />

          <Panel title="Hộp thư" subtitle="Thông báo mới nhất ở trên cùng.">
            <div className="manager-filters">
              <Field label="Trạng thái đọc">
                <Select
                  label="Lọc theo trạng thái đọc"
                  value={scope}
                  onChange={setScope}
                  options={[["", "Tất cả thông báo"], ["UNREAD", "Chưa đọc"], ["READ", "Đã đọc"]]}
                />
              </Field>
            </div>
            <Message error={error} success={notice} />
            <div className="mt-5">
              <Table
                label="Thông báo"
                rows={visible}
                columns={[
                  { key: "title", label: "Tiêu đề" },
                  { key: "type", label: "Loại" },
                  { key: "content", label: "Nội dung" },
                  { key: "channel", label: "Kênh" },
                  { key: "state", label: "Trạng thái", render: (r) => (r.isRead ? "Đã đọc" : "Chưa đọc") },
                  { key: "at", label: "Thời điểm nhận" },
                  {
                    key: "action",
                    label: "Thao tác",
                    render: (r) => (r.isRead
                      ? "—"
                      : (
                        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => markRead(r)}>
                          {busy === r.id ? "Đang lưu…" : "Đánh dấu đã đọc"}
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
