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
      setError("Hãy nhập công suất bán được lớn hơn 0 m³.");
      return;
    }
    const hold = form.holdDurationMinutes.trim();
    if (requiresHold && !hold) {
      setError("Thời gian giữ chỗ là bắt buộc cho lần cấu hình đầu.");
      return;
    }
    if (hold && (!Number.isSafeInteger(Number(hold)) || Number(hold) <= 0)) {
      setError("Thời gian giữ chỗ phải là số nguyên phút lớn hơn 0.");
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
    <Dialog title="Cấu hình công suất lưu trữ" onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <p className="text-sm text-slate-500">
          <b>{facilityLabel}</b> · {configured
            ? "Đã có cấu hình công suất. Để trống thời gian giữ chỗ để giữ nguyên giá trị hiện tại."
            : "Cấu hình lần đầu: cần cả công suất bán được và thời gian giữ chỗ."}
        </p>
        <div className="manager-filters">
          <Field label="Công suất bán được (m³)" hint="Không được giảm dưới mức đã cam kết hiện tại.">
            <Input
              aria-label="Công suất bán được (mét khối)"
              inputMode="decimal"
              required
              value={form.sellableCapacityM3}
              onChange={(e) => change("sellableCapacityM3", e.target.value)}
            />
          </Field>
          <Field label="Thời gian giữ chỗ (phút)" hint={requiresHold ? "Bắt buộc cho lần cấu hình đầu." : "Để trống để giữ nguyên giá trị hiện tại."}>
            <Input
              aria-label="Thời gian giữ chỗ (phút)"
              inputMode="numeric"
              required={requiresHold}
              value={form.holdDurationMinutes}
              onChange={(e) => change("holdDurationMinutes", e.target.value)}
            />
          </Field>
          <Field label="Trạng thái công suất" hint="Tắt để dừng nhận đơn lưu trữ hàng hóa mới.">
            <Select
              label="Trạng thái công suất"
              value={form.isActive}
              onChange={(value) => change("isActive", value)}
              options={[["true", "Đang áp dụng"], ["false", "Ngừng áp dụng"]]}
            />
          </Field>
        </div>
        <p className="bom-warning">
          Công suất chỉ áp dụng khi cơ sở đang hoạt động, có dịch vụ Lưu trữ hàng hóa và có cấu hình công suất đang hoạt động.
        </p>
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : "Lưu cấu hình"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
        </div>
      </form>
    </Dialog>
  );
}
