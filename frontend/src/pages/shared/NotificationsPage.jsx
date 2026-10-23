import { useEffect, useState } from "react";
import { Screen, Panel, Table, Field, Select, Button, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
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
    title: notification?.title || "Notification",
    type: notification?.type || "",
    content: notification?.content || "",
    channel: sentVia.length ? sentVia.join(", ") : "—",
    isRead: Boolean(notification?.isRead),
    at: notification?.createdAt ? new Date(notification.createdAt).toLocaleString("en-GB") : "—",
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
      setNotice(`“${row.title}” is now marked as read.`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <Screen
      title="Notifications"
      description="Operational alerts delivered to your own account. Reading them is the only write the backend currently supports."
      notice={LIVE_NOTICE}
      action={<Button variant="outline" disabled={state.loading} onClick={state.reload}>Refresh</Button>}
    >
      <AsyncBoundary state={state} render={() => (
        <>
          <Kpis items={[
            ["Notifications", rows.length, "Delivered to this account"],
            ["Unread", unread, "Not opened yet"],
            ["Read", rows.length - unread, "Acknowledged"],
            ["Oldest", rows.length ? rows[rows.length - 1].at.slice(0, 10) : "—", "Oldest message in the inbox"],
          ]} />

          <Panel title="Inbox" subtitle="Notifications are returned newest first by the backend.">
            <div className="manager-filters">
              <Field label="Read state">
                <Select
                  label="Read state filter"
                  value={scope}
                  onChange={setScope}
                  options={[["", "All notifications"], ["UNREAD", "Unread only"], ["READ", "Read only"]]}
                />
              </Field>
            </div>
            <Message error={error} success={notice} />
            <div className="mt-5">
              <Table
                label="Notifications"
                rows={visible}
                columns={[
                  { key: "title", label: "Title" },
                  { key: "type", label: "Type" },
                  { key: "content", label: "Message" },
                  { key: "channel", label: "Channel" },
                  { key: "state", label: "State", render: (r) => (r.isRead ? "Read" : "Unread") },
                  { key: "at", label: "Received" },
                  {
                    key: "action",
                    label: "Action",
                    render: (r) => (r.isRead
                      ? "—"
                      : (
                        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => markRead(r)}>
                          {busy === r.id ? "Saving…" : "Mark as read"}
                        </Button>
                      )),
                  },
                ]}
                empty="No notification matches this filter."
              />
            </div>
          </Panel>
        </>
      )} />
    </Screen>
  );
}
