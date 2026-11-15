import { useState } from "react";
import { Dialog, Button, Field, Input, Select, Message } from "@/components/manager/ManagerUI";
import { bomUnitApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { BOM_UNIT_SIZES } from "@/lib/bomMappers";

// Storage unit dialogs for the BOM/Admin unit console.
// Backend contract (storage-unit.validation.ts):
//   create  POST  /facilities/:facilityId/storage-units {unitCode, size, dimensions, description?, status?}
//   update  PATCH /storage-units/:id {unitCode?, size?, dimensions?, description?, images?}
//   status  PATCH /storage-units/:id/status {status}
// Volume is always derived by the backend from dimensions, and HELD / OCCUPIED belong to the
// reservation lifecycle, so the console only offers AVAILABLE / MAINTENANCE / INACTIVE.

export const MANAGEMENT_STATUSES = [["AVAILABLE", "Sẵn sàng"], ["MAINTENANCE", "Bảo trì"], ["INACTIVE", "Ngừng hoạt động"]];

const number = (value) => (String(value).trim() ? Number(value) : NaN);
const isPositive = (value) => Number.isFinite(number(value)) && number(value) > 0;

export function UnitDialog({ facilityId, unit, onClose, onSaved }) {
  const editing = Boolean(unit);
  const [form, setForm] = useState({
    unitCode: unit?.code || "",
    size: unit?.size || BOM_UNIT_SIZES[0],
    lengthM: String(unit?.dimensions?.lengthM ?? ""),
    widthM: String(unit?.dimensions?.widthM ?? ""),
    heightM: String(unit?.dimensions?.heightM ?? ""),
    description: unit?.description || "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const volume = ["lengthM", "widthM", "heightM"].every((key) => isPositive(form[key]))
    ? number(form.lengthM) * number(form.widthM) * number(form.heightM)
    : 0;

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (!form.unitCode.trim() || form.unitCode.trim().length > 100) {
      setError("Mã kho là bắt buộc và tối đa 100 ký tự.");
      return;
    }
    for (const [label, key] of [["chiều dài", "lengthM"], ["chiều rộng", "widthM"], ["chiều cao", "heightM"]]) {
      if (!isPositive(form[key])) {
        setError(`Kích thước ${label} phải là số dương (mét).`);
        return;
      }
    }
    if (form.description.trim().length > 2000) {
      setError("Mô tả tối đa 2000 ký tự.");
      return;
    }
    setPending(true);
    try {
      const body = {
        unitCode: form.unitCode.trim().toUpperCase(),
        size: form.size,
        dimensions: { lengthM: number(form.lengthM), widthM: number(form.widthM), heightM: number(form.heightM) },
      };
      if (form.description.trim()) body.description = form.description.trim();
      if (editing) await bomUnitApi.update(unit.id, body);
      else await bomUnitApi.create(facilityId, body);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title={editing ? `Sửa kho ${unit.code}` : "Tạo kho riêng"} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <div className="manager-filters">
          <Field label="Mã kho" hint="Phải là duy nhất trong cơ sở.">
            <Input aria-label="Mã kho" required value={form.unitCode} onChange={(e) => change("unitCode", e.target.value)} />
          </Field>
          <Field label="Kích cỡ">
            <Select label="Kích cỡ kho" value={form.size} onChange={(value) => change("size", value)} options={BOM_UNIT_SIZES} />
          </Field>
          <Field label="Chiều dài (m)">
            <Input aria-label="Chiều dài kho (mét)" inputMode="decimal" required value={form.lengthM} onChange={(e) => change("lengthM", e.target.value)} />
          </Field>
          <Field label="Chiều rộng (m)">
            <Input aria-label="Chiều rộng kho (mét)" inputMode="decimal" required value={form.widthM} onChange={(e) => change("widthM", e.target.value)} />
          </Field>
          <Field label="Chiều cao (m)">
            <Input aria-label="Chiều cao kho (mét)" inputMode="decimal" required value={form.heightM} onChange={(e) => change("heightM", e.target.value)} />
          </Field>
          <Field label="Thể tích tính toán" hint="Thể tích được tính từ kích thước.">
            <Input aria-label="Thể tích tính toán" readOnly value={volume ? `${volume.toFixed(3)} m³` : "—"} />
          </Field>
        </div>
        <Field label="Mô tả" hint="Không bắt buộc, tối đa 2000 ký tự.">
          <Input aria-label="Mô tả kho" value={form.description} onChange={(e) => change("description", e.target.value)} />
        </Field>
        <p className="bom-warning">
          {editing
            ? "Không sửa được kho đang được giữ hoặc đang sử dụng; hãy hoàn tất hoặc giải phóng đơn trước."
            : "Chỉ tạo được kho trong cơ sở đang hoạt động và có dịch vụ Thuê kho riêng."}
        </p>
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : editing ? "Lưu kho" : "Tạo kho"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function UnitStatusDialog({ unit, onClose, onSaved }) {
  const [status, setStatus] = useState(MANAGEMENT_STATUSES.some(([value]) => value === unit.status) ? unit.status : "AVAILABLE");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      await bomUnitApi.setStatus(unit.id, status);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title={`Trạng thái kho ${unit.code}`} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <div className="manager-filters">
          <Field label="Trạng thái" hint="Trạng thái Đang giữ / Đang sử dụng do đơn đặt thuê quyết định.">
            <Select label="Trạng thái kho" value={status} onChange={setStatus} options={MANAGEMENT_STATUSES} />
          </Field>
        </div>
        <p className="bom-warning">
          Để chuyển kho sang AVAILABLE, cơ sở phải đang hoạt động và còn cung cấp dịch vụ Thuê kho riêng.
        </p>
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : "Lưu trạng thái"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Hủy</Button>
        </div>
      </form>
    </Dialog>
  );
}
