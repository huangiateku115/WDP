import { useState } from "react";
import { Dialog, Button, Panel, Message } from "@/components/manager/ManagerUI";

export const LIVE_NOTICE =
  "Live backend data · Changes are saved to the server through the confirmed ADMIN/BOM APIs. Existing rentals, contracts and payments are never rewritten.";

export function AsyncBoundary({ state, render }) {
  if (state.loading)
    return (
      <Panel title="Loading">
        <p role="status" className="text-sm text-slate-500">Loading live data…</p>
      </Panel>
    );
  if (state.error)
    return (
      <Panel title="Unable to load">
        <p role="alert" className="text-sm text-red-700">{state.error}</p>
        <Button variant="outline" className="mt-4" onClick={state.reload}>Try again</Button>
      </Panel>
    );
  return render(state.data);
}

export function TruncatedNotice({ total, shown }) {
  return (
    <p role="status" className="bom-warning mb-4">
      Showing the first {shown} of {total} records. Refine the filters to narrow the result set.
    </p>
  );
}

export function ConfirmDialog({ title, summary, confirmLabel = "Confirm", onConfirm, onClose, children }) {
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
      setError(err?.message || "The request could not be completed.");
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
          <Button variant="orange" disabled={pending} onClick={submit}>{pending ? "Saving…" : confirmLabel}</Button>
          <Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
