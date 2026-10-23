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

export const MANAGEMENT_STATUSES = [["AVAILABLE", "Available"], ["MAINTENANCE", "Maintenance"], ["INACTIVE", "Inactive"]];

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
      setError("Unit code is required and must be at most 100 characters.");
      return;
    }
    for (const [label, key] of [["length", "lengthM"], ["width", "widthM"], ["height", "heightM"]]) {
      if (!isPositive(form[key])) {
        setError(`Unit ${label} must be a positive number of metres.`);
        return;
      }
    }
    if (form.description.trim().length > 2000) {
      setError("Description must be at most 2000 characters.");
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
    <Dialog title={editing ? `Edit unit ${unit.code}` : "Create storage unit"} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <div className="manager-filters">
          <Field label="Unit code" hint="Uppercased; unique inside the facility.">
            <Input aria-label="Unit code" required value={form.unitCode} onChange={(e) => change("unitCode", e.target.value)} />
          </Field>
          <Field label="Size">
            <Select label="Unit size" value={form.size} onChange={(value) => change("size", value)} options={BOM_UNIT_SIZES} />
          </Field>
          <Field label="Length (m)">
            <Input aria-label="Unit length in metres" inputMode="decimal" required value={form.lengthM} onChange={(e) => change("lengthM", e.target.value)} />
          </Field>
          <Field label="Width (m)">
            <Input aria-label="Unit width in metres" inputMode="decimal" required value={form.widthM} onChange={(e) => change("widthM", e.target.value)} />
          </Field>
          <Field label="Height (m)">
            <Input aria-label="Unit height in metres" inputMode="decimal" required value={form.heightM} onChange={(e) => change("heightM", e.target.value)} />
          </Field>
          <Field label="Derived volume" hint="The backend always derives volume from dimensions.">
            <Input aria-label="Derived volume" readOnly value={volume ? `${volume.toFixed(3)} m³` : "—"} />
          </Field>
        </div>
        <Field label="Description" hint="Optional, up to 2000 characters.">
          <Input aria-label="Unit description" value={form.description} onChange={(e) => change("description", e.target.value)} />
        </Field>
        <p className="bom-warning">
          {editing
            ? "A HELD or OCCUPIED unit cannot be edited; finish or release its reservation first."
            : "Units can only be created in a facility that is ACTIVE and offers SELF_STORAGE."}
        </p>
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : editing ? "Save unit" : "Create unit"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
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
    <Dialog title={`Unit status ${unit.code}`} onClose={onClose}>
      <form className="space-y-5" onSubmit={submit}>
        <div className="manager-filters">
          <Field label="Status" hint="HELD and OCCUPIED are driven by reservations and rentals.">
            <Select label="Unit status" value={status} onChange={setStatus} options={MANAGEMENT_STATUSES} />
          </Field>
        </div>
        <p className="bom-warning">
          Marking a unit AVAILABLE requires the facility to still be ACTIVE and to offer SELF_STORAGE, otherwise the backend answers 409.
        </p>
        <Message error={error} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : "Save status"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
