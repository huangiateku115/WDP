import { useState } from "react";
import { Dialog, Button, Field, Input, Select, Message } from "@/components/manager/ManagerUI";
import { bomReservationApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";

// Managed Inventory quota configuration (PUT /reservations/managed/capacity/:facilityId).
// FACILITY_MANAGER, ADMIN and BOM may write it. The backend rules that the form mirrors:
//   - the facility must be ACTIVE and offer MANAGED_INVENTORY, otherwise 404
//   - the FIRST configuration requires both sellableCapacityM3 and holdDurationMinutes
//   - a later save may send a subset; reducing sellable capacity below the currently
//     committed peak is rejected with 409, so we surface that message verbatim.
// GET only returns a payload once a capacity row exists AND isActive is true, therefore the
// caller tells us whether the facility is already configured.
export function ManagedCapacityDialog({ facilityId, facilityLabel, configured, onClose, onSaved }) {
  const [form, setForm] = useState({ sellableCapacityM3: "", holdDurationMinutes: "", isActive: "true" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const requiresHold = !configured;
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    const capacity = Number(form.sellableCapacityM3);
    if (!form.sellableCapacityM3.trim() || !Number.isFinite(capacity) || capacity <= 0) {
      setError("Enter a sellable capacity greater than 0 m³.");
      return;
    }
    const hold = form.holdDurationMinutes.trim();
    if (requiresHold && !hold) {
      setError("Hold duration is required for the first configuration.");
      return;
    }
    if (hold && (!Number.isSafeInteger(Number(hold)) || Number(hold) <= 0)) {
      setError("Hold duration must be a whole number of minutes greater than 0.");
      return;
    }
    setPending(true);
    try {
      const body = { sellableCapacityM3: capacity, isActive: form.isActive === "true" };
      if (hold) body.holdDurationMinutes = Number(hold);
      await bomReservationApi.configureCapacity(facilityId, body);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="Configure managed capacity" onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <p className="text-sm text-slate-500">
          <b>{facilityLabel}</b> · {configured
            ? "A capacity row already exists. Leave the hold duration blank to keep the current value."
            : "First configuration: sellable capacity and hold duration are both required."}
        </p>
        <div className="manager-filters">
          <Field label="Sellable capacity (m³)" hint="Cannot be reduced below the current committed peak.">
            <Input
              aria-label="Sellable capacity in cubic metres"
              inputMode="decimal"
              required
              value={form.sellableCapacityM3}
              onChange={(e) => change("sellableCapacityM3", e.target.value)}
            />
          </Field>
          <Field label="Hold duration (minutes)" hint={requiresHold ? "Required for the first configuration." : "Blank keeps the current value."}>
            <Input
              aria-label="Hold duration in minutes"
              inputMode="numeric"
              required={requiresHold}
              value={form.holdDurationMinutes}
              onChange={(e) => change("holdDurationMinutes", e.target.value)}
            />
          </Field>
          <Field label="Capacity state" hint="Inactive capacity answers 404 on read.">
            <Select
              label="Capacity state"
              value={form.isActive}
              onChange={(value) => change("isActive", value)}
              options={[["true", "Active"], ["false", "Inactive"]]}
            />
          </Field>
        </div>
        <p className="bom-warning">
          Saving writes the quota configuration to the backend and increments the booking version. The read endpoint only answers for a
          facility that is ACTIVE, offers MANAGED_INVENTORY and has an active capacity row.
        </p>
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : "Save configuration"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
