import LoadState from "./CustomerResourceState";
import { Bell, CheckCircle2, MailOpen } from "lucide-react";
import { reservationVietnamTime } from "@/lib/customerReservationDisplay";
import { PortalEmptyState } from "./CustomerPortalUI";
import { useState } from "react";
import { notificationApi } from "@/api/customerRentalApi";
import { getAccessToken } from "@/lib/authSession";
import { Dialog } from "@/components/ui/dialog";
import {
  BackendScreen,
  useBackend,
  rows,
  record,
  recordId,
  validId,
  Card,
  CardContent,
  Button,
} from "./RentalBackendUI";

function splitNotificationContent(content) {
  if (typeof content !== "string") return { summary: "", detail: "" };
  const idx = content.indexOf("\n\n");
  if (idx === -1) return { summary: content, detail: content };
  return {
    summary: content.slice(0, idx).trim(),
    detail: content.slice(idx + 2).trim(),
  };
}

export default function CustomerNotificationsIntegration() {
  const [unread, setUnread] = useState(false);
  const [selected, setSelected] = useState(null);
  const [locallyReadIds, setLocallyReadIds] = useState({});
  const resource = useBackend((config) =>
    notificationApi.mine(config).then(rows)
  );

  const items = (resource.data || []).map((n) => {
    const id = recordId(n);
    return locallyReadIds[id] ? { ...n, isRead: true } : n;
  });

  const visible = items.filter((n) => !unread || n.isRead === false);
  const unreadCount = items.filter((n) => n.isRead === false).length;

  async function handleOpenNotification(item) {
    const id = recordId(item);
    setSelected(item);

    if (item.isRead === false && validId(id)) {
      setLocallyReadIds((prev) => ({ ...prev, [id]: true }));
      setSelected({ ...item, isRead: true });
      try {
        const token = getAccessToken();
        const result = record(await notificationApi.read(id));
        if (getAccessToken() === token && result?.isRead === true) {
          resource.retry();
        }
      } catch (err) {
        console.warn("Mark notification as read failed:", err?.message || err);
      }
    }
  }

  const selectedParts = selected ? splitNotificationContent(selected.content) : null;

  return (
    <BackendScreen
      title="Thông báo"
      description="Theo dõi các cập nhật mới nhất về đơn thuê kho, thanh toán, mã PIN và gia hạn hợp đồng từ VaultSpace."
      notice={`Bạn có ${unreadCount} thông báo chưa đọc. Bấm vào từng thông báo để xem nội dung chi tiết và tự động đánh dấu đã đọc.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={unread ? "default" : "outline"}
          aria-pressed={unread}
          onClick={() => setUnread((v) => !v)}
        >
          {unread ? "Đang lọc: Chưa đọc (Bấm để xem tất cả)" : `Chỉ xem chưa đọc (${unreadCount})`}
        </Button>
        <Button variant="outline" onClick={resource.retry}>
          Tải lại
        </Button>
      </div>

      <LoadState resource={resource} />

      <div className="space-y-3">
        {visible.map((n) => {
          const id = recordId(n);
          const { summary } = splitNotificationContent(n.content);
          const isUnread = n.isRead === false;
          return (
            <Card
              key={id}
              className={`portal-notification cursor-pointer transition-colors hover:border-emerald-400 ${
                isUnread
                  ? "border-emerald-300 bg-emerald-50/40"
                  : "border-slate-200 bg-white"
              }`}
              data-read={n.isRead === true ? "true" : "false"}
              onClick={() => void handleOpenNotification(n)}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bell
                      size={18}
                      className={isUnread ? "text-emerald-600" : "text-slate-400"}
                      aria-hidden="true"
                    />
                    <h2 className="text-base font-bold text-slate-900 break-words">
                      {n.title}
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      isUnread
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {isUnread ? "Chưa đọc" : "Đã đọc"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700 line-clamp-2 break-words">
                  {summary}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{reservationVietnamTime(n.createdAt)}</span>
                  <span className="font-medium text-emerald-700">
                    Bấm để xem chi tiết →
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!resource.loading && !resource.error && !visible.length && (
        <PortalEmptyState
          title="Không có thông báo nào phù hợp."
          description="Bạn đã cập nhật đầy đủ. Các thông báo mới về đơn thuê kho sẽ hiển thị tại đây."
        />
      )}

      {selected && (
        <Dialog
          title={selected.title || "Chi tiết thông báo"}
          onClose={() => setSelected(null)}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                {selected.isRead ? (
                  <>
                    <CheckCircle2 size={14} /> Đã đánh dấu đã đọc
                  </>
                ) : (
                  <>
                    <MailOpen size={14} /> Đang mở
                  </>
                )}
              </span>
              <span>{reservationVietnamTime(selected.createdAt)}</span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap break-words max-h-[60vh] overflow-y-auto">
              {selectedParts?.detail || selected.content}
            </div>

            <div className="flex justify-end pt-1">
              <Button type="button" onClick={() => setSelected(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </BackendScreen>
  );
}
