import { useState } from "react";
import { Dialog, Button, Panel, Message } from "@/components/manager/ManagerUI";
import { apiErrorMessage } from "@/lib/apiError";

export function AsyncBoundary({ state, render }) {
  if (state.loading)
    return (
      <Panel title="Đang tải">
        <p role="status" className="text-sm text-slate-500">Đang tải…</p>
      </Panel>
    );
  if (state.error)
    return (
      <Panel title="Không tải được dữ liệu">
        <p role="alert" className="bom-error">{state.error}</p>
        <Button variant="outline" className="mt-4" onClick={state.reload}>Thử lại</Button>
      </Panel>
    );
  return render(state.data);
}

export function TruncatedNotice({ total, shown }) {
  return (
    <p role="status" className="bom-note mb-4">
      Đang hiển thị {shown} / {total} bản ghi. Hãy thu hẹp bộ lọc để xem đủ dữ liệu.
    </p>
  );
}

export function ConfirmDialog({ title, summary, confirmLabel = "Xác nhận", onConfirm, onClose, children }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onConfirm();
      onClose?.();
    } catch (err) {
      // Surface the backend rule (for example the 409 "delete active racks first") instead
      // of the generic axios status text.
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="space-y-5">
        {children}
        {summary}
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button variant="orange" disabled={pending} onClick={submit}>{pending ? "Đang lưu…" : confirmLabel}</Button>
          <Button variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
        </div>
      </div>
    </Dialog>
  );
}
