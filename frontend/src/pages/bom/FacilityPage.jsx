import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button,
} from "@/components/manager/ManagerUI";
import { Checkbox } from "@/components/ui/checkbox";
import { TimeRangePicker } from "@/components/ui/time-range-picker";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { bomFacilityApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilitiesIncludingDeleted, invalidateFacilities, loadFacilityUnits, loadWarehouseStructure } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, facilityFromDto, facilityForm, facilityBody, responseData, serviceLabel,
} from "@/lib/bomMappers";
import { COUNTRIES, CUSTOM_WARD, citiesFor, wardsFor } from "@/lib/addressData";
import { countBy, formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

const EMPTY_FORM = {
  code: "", name: "", line1: "", ward: "", wardCustom: false, district: "", city: "", country: "",
  openingHours: "", allDay: false, contactPhone: "", contactEmail: "",
  description: "", serviceTypes: ["SELF_STORAGE"], images: [], status: "ACTIVE",
  visitScheduleEnabled: false,
  visitScheduleDraft: { slotDurationMinutes: 60, weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, enabled: false, opensAt: "09:00", closesAt: "18:00" })) },
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Single "opening hours" field: validates a `HH:MM - HH:MM` range (en-dash accepted).
const HOURS_PATTERN = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/;
const toMinutes = (hours, minutes) => Number(hours) * 60 + Number(minutes);
function hoursError(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = HOURS_PATTERN.exec(raw);
  if (!match) return "Use the HH:MM - HH:MM format (for example 08:00 - 18:00).";
  const [h1, m1, h2, m2] = match.slice(1).map(Number);
  if (h1 > 23 || m1 > 59 || h2 > 23 || m2 > 59) return "Hour or minute is out of range.";
  if (toMinutes(h2, m2) <= toMinutes(h1, m1)) return "Closing time must be later than opening time.";
  return "";
}
function formatHours(value) {
  const match = HOURS_PATTERN.exec(String(value || ""));
  if (!match) return String(value || "").trim();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(match[1])}:${match[2]} - ${pad(match[3])}:${match[4]}`;
}

// `basePath` and `oversightRoot` keep the same facility console usable from the BOM and the
// Admin workspace: every internal link, the breadcrumb back-action and the post-save
// redirect are derived from them instead of being hard-coded to /bom/*.
export default function FacilityPage({
  mode = "list", basePath = "/bom/facilities", oversightRoot = "/bom/oversight",
}) {
  if (mode === "new") return <FacilityForm mode="new" basePath={basePath} oversightRoot={oversightRoot} />;
  if (mode === "edit") return <FacilityForm mode="edit" basePath={basePath} oversightRoot={oversightRoot} />;
  if (mode === "detail") return <FacilityDetail basePath={basePath} oversightRoot={oversightRoot} />;
  return <FacilityList basePath={basePath} />;
}

function FacilityList({ basePath }) {
  const [showDeleted, setShowDeleted] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const state = useAsyncData(
    ({ signal }) => (showDeleted ? loadFacilitiesIncludingDeleted({ signal }) : loadFacilities()),
    [showDeleted],
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const facilities = state.data || [];
  const cities = [...new Set(facilities.map((f) => f.city).filter(Boolean))];
  const rows = facilities.filter((f) =>
    (!search || `${f.code} ${f.name} ${f.address}`.toLowerCase().includes(search.toLowerCase())) &&
    (!status || f.status === status) &&
    (!city || f.city === city));

  return (
    <Screen
      title="Facilities"
      description="Create, edit, activate, deactivate or delete facilities."
      action={<Button asChild variant="orange"><Link to={`${basePath}/new`}>Create facility</Link></Button>}
    >
      <Panel title="Facility filters">
        <div className="manager-filters">
          <Field label="Search">
            <Input aria-label="Search facilities" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select label="Status filter" value={status} onChange={setStatus} options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
          </Field>
          <Field label="City">
            <Select label="City filter" value={city} onChange={setCity} options={[["", "All cities"], ...cities]} />
          </Field>
            <Field label="Records" hint="Only administrators and business operations can list deleted facilities.">
            <Select
              label="Record filter"
              value={showDeleted ? "deleted" : "live"}
              onChange={(value) => setShowDeleted(value === "deleted")}
              options={[["live", "Active facilities"], ["deleted", "Deleted facilities"]]}
            />
          </Field>
        </div>
      </Panel>
      <AsyncBoundary state={state} render={() => (
        <Panel title="Facility records" subtitle={`${rows.length} of ${facilities.length} facilities`}>
          <Table
            label="Facilities"
            rows={rows}
            columns={[
              { key: "name", label: "Facility", render: (f) => (f.deleted
                ? f.name
                : <OpenLink to={`${basePath}/${f.id}`}>{f.name}</OpenLink>) },
              { key: "code", label: "Code" },
              { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
              { key: "city", label: "City / Province" },
              { key: "address", label: "Address" },
              { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
              { key: "openingHours", label: "Opening hours" },
              {
                key: "actions",
                label: "Actions",
                render: (f) => (f.deleted
                  ? <Button size="sm" variant="outline" onClick={() => setRestoreTarget(f)}>Restore</Button>
                  : <OpenLink to={`${basePath}/${f.id}`}>Open</OpenLink>),
              },
            ]}
            empty={showDeleted ? "No deleted facility." : "No facility matches the current filters."}
          />
        </Panel>
      )} />
      {restoreTarget && (
        <ConfirmDialog
          title={`Restore ${restoreTarget.code}?`}
          confirmLabel="Restore facility"
          onClose={() => setRestoreTarget(null)}
          onConfirm={async () => {
            await bomFacilityApi.restore(restoreTarget.id);
            invalidateFacilities();
            state.reload();
          }}
        >
          <p className="text-sm text-slate-500">
            <b>{restoreTarget.name}</b> becomes visible again and can accept reservations once it is ACTIVE.
          </p>
        </ConfirmDialog>
      )}
    </Screen>
  );
}

// Navigation context comes from the ROUTE first, so the sidebar, the back action and the
// edit flow stay correct on reload, bookmark or shared link. `location.state` is only a
// fallback for entry points that have no dedicated route yet (e.g. the dashboard).
function facilityNav(location, { basePath = "/bom/facilities", oversightRoot = "/bom/oversight" } = {}) {
  const pathname = location?.pathname || "";
  if (pathname === oversightRoot || pathname.startsWith(`${oversightRoot}/`)) {
    return { base: `${oversightRoot}/facilities`, backTo: oversightRoot, backLabel: "Back to oversight" };
  }
  const backTo = location?.state?.from || basePath;
  const backLabel = backTo.endsWith("/dashboard") ? "Back to dashboard" : "Back to facilities";
  return { base: basePath, backTo, backLabel };
}

function FacilityDetail({ basePath, oversightRoot }) {
  const { id } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const state = useAsyncData(() => bomFacilityApi.get(id).then(responseData).then(facilityFromDto), [id]);
  const warehouse = useAsyncData(({ signal }) => loadWarehouseStructure(id, { signal }), [id]);
  const units = useAsyncData(({ signal }) => loadFacilityUnits(id, { signal }), [id]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { base, backTo, backLabel } = facilityNav(location, { basePath, oversightRoot });

  if (!state.loading && state.error && /not found|unavailable|invalid|404/i.test(state.error)) return <BomUnavailable />;

  return (
    <Screen
      title="Facility detail"
      description="Facility details and status."
      action={<Button asChild variant="outline"><Link to={backTo}>{backLabel}</Link></Button>}
    >
      <AsyncBoundary state={state} render={(facility) => {
        const nextStatus = facility.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        return (
          <>
            <Panel
              title="Facility information"
              action={(
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline"><Link to={`${base}/${id}/edit`} state={{ from: backTo }}>Edit facility</Link></Button>
                  <Button variant="outline" onClick={() => setDeleteOpen(true)}>Delete facility</Button>
                </div>
              )}
            >
              <Details values={[
                ["Facility code", facility.code],
                ["Country", facility.country],
                ["City / Province", facility.city],
                ["Ward / Commune", facility.ward],
                ["Street / area", facility.district],
                ["Address", facility.address],
                ["Opening hours", facility.openingHours],
                ["Service models", facility.serviceTypes.join(", ") || "—"],
                ["Managed visit schedule", facility.managedVisitSchedule ? `${facility.managedVisitSchedule.timeZone} · ${facility.managedVisitSchedule.slotDurationMinutes} min slots · ${facility.managedVisitSchedule.weeklyHours?.length || 0} configured days` : "Not configured (Customer visit booking is unavailable)"],
                ["Business status", <Status value={facility.status} />],
                ["Contact phone", facility.contact?.phone],
                ["Contact email", facility.contact?.email],
                ["Description", facility.description],
              ]} />
              <p className="bom-warning mt-5">
                Deactivation only blocks new reservations. Existing active rentals are preserved.
              </p>
              <div className="mt-5">
                <Button variant="orange" onClick={() => setConfirmOpen(true)}>
                  {nextStatus === "ACTIVE" ? "Activate facility" : "Deactivate facility"}
                </Button>
              </div>
            </Panel>
            <AsyncBoundary state={warehouse} render={({ zones, racks, available, reason }) => {
              const cells = sumBy(racks, "cellCount");
              const availableCells = sumBy(racks, "availableCellCount");
              return (
                <Panel title="Warehouse structure" subtitle="Zones → aisles → racks → cells.">
                  {!available && (
                    <p className="bom-warning mb-5">
                      The warehouse map does not apply to this facility: {reason || "this facility does not offer Managed Inventory"}.
                      Storage units are the storage model that applies here.
                    </p>
                  )}
                  <Details values={[
                    ["Zones", zones.length],
                    ["Racks", racks.length],
                    ["Cells", cells ? `${availableCells} of ${cells} available` : "—"],
                    ["Rated / allocatable weight", `${kg(sumBy(racks, "ratedCapacityKg"))} / ${kg(sumBy(racks, "allocatableCapacityKg"))}`],
                  ]} />
                  <div className="mt-5">
                    <Table
                      label="Facility racks"
                      rows={racks}
                      columns={[
                        { key: "rackCode", label: "Rack" },
                        { key: "zone", label: "Zone", render: (r) => `${r.zoneCode} · ${r.zoneName}` },
                        { key: "aisleCode", label: "Aisle" },
                        { key: "operationalStatus", label: "Status", render: (r) => <Status value={r.operationalStatus} /> },
                        { key: "cells", label: "Cells", render: (r) => `${r.availableCellCount} / ${r.cellCount} available` },
                        { key: "ratedCapacityKg", label: "Rated / allocatable", render: (r) => `${kg(r.ratedCapacityKg)} / ${kg(r.allocatableCapacityKg)}` },
                      ]}
                      empty="No warehouse zone, rack or cell is configured for this facility."
                    />
                  </div>
                </Panel>
              );
            }} />
            <AsyncBoundary state={units} render={({ rows, total, truncated }) => (
              <Panel title="Private storage units" subtitle={`${rows.length} of ${total} units`}>
                {truncated && <TruncatedNotice total={total} shown={rows.length} />}
                <Details values={[
                  ["Occupied", countBy(rows, "status", "OCCUPIED")],
                  ["Available", countBy(rows, "status", "AVAILABLE")],
                  ["Blocked", countBy(rows, "status", "HELD") + countBy(rows, "status", "MAINTENANCE") + countBy(rows, "status", "INACTIVE")],
                  ["Registered volume", m3(sumBy(rows, "volumeM3"))],
                ]} />
                <div className="mt-5">
                  <Table
                    label="Facility storage units"
                    rows={rows}
                    columns={[
                      { key: "code", label: "Unit" },
                      { key: "size", label: "Size" },
                      { key: "volumeM3", label: "Volume", render: (r) => m3(r.volumeM3) },
                      { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                    ]}
                    empty="No storage unit is registered for this facility."
                  />
                </div>
              </Panel>
            )} />
            {confirmOpen && (
              <ConfirmDialog
                title="Confirm facility status"
                confirmLabel={`Set ${nextStatus}`}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => {
                  await bomFacilityApi.setStatus(id, nextStatus);
                  invalidateFacilities();
                  state.reload();
                }}
              >
                <p className="text-sm text-slate-500">
                  The facility <b>{facility.name}</b> will be set to <b>{nextStatus}</b>.
                </p>
              </ConfirmDialog>
            )}
            {deleteOpen && (
              <ConfirmDialog
                title="Delete facility"
                confirmLabel="Delete facility"
                onClose={() => setDeleteOpen(false)}
                onConfirm={async () => {
                  await bomFacilityApi.remove(id);
                  invalidateFacilities();
                  nav(backTo);
                }}
              >
                <p className="text-sm text-slate-500">
                  <b>{facility.name}</b> is soft deleted: it leaves every list, the warehouse map and the rent wizard, and only
                  ADMIN/BOM can list and restore it again. The delete is blocked while storage units or warehouse zones still
                  reference the facility.
                </p>
              </ConfirmDialog>
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function FacilityForm({ mode, basePath, oversightRoot }) {
  const { id } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const { backTo } = facilityNav(location, { basePath, oversightRoot });
  const isEdit = mode === "edit";
  const state = useAsyncData(
    () => (isEdit ? bomFacilityApi.get(id).then(responseData).then(facilityForm) : Promise.resolve(null)),
    [id, isEdit],
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const next = state.data || EMPTY_FORM;
    const stored = String(next.openingHours || "").trim();
    const allDay = stored.toLowerCase() === "24/7";
    setForm({
      ...next,
      allDay,
      openingHours: allDay ? "" : stored,
      wardCustom: Boolean(next.ward) && !wardsFor(next.city).includes(next.ward),
    });
  }, [state.data]);

  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const wards = wardsFor(form.city);
  const wardChosen = form.wardCustom ? Boolean(form.ward.trim()) : Boolean(form.ward);
  const toggleService = (service) => setForm((f) => ({
    ...f,
    serviceTypes: f.serviceTypes.includes(service)
      ? f.serviceTypes.filter((s) => s !== service)
      : [...f.serviceTypes, service],
  }));
  const images = form.images || [];
  const setImage = (index, value) => setForm((f) => ({
    ...f,
    images: (f.images || []).map((url, i) => (i === index ? value : url)),
  }));
  const addImage = () => setForm((f) => ({ ...f, images: [...(f.images || []), ""].slice(0, 10) }));
  const removeImage = (index) => setForm((f) => ({ ...f, images: (f.images || []).filter((_, i) => i !== index) }));

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      if (!form.country) throw new Error("Select a country.");
      if (!form.city) throw new Error("Select a city / province.");
      if (!form.ward.trim()) throw new Error("Select or enter a ward / commune.");
      if (!form.district.trim()) throw new Error("Enter the street / area.");
      if (!form.line1.trim()) throw new Error("Enter the address / house number.");
      if (form.contactEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) {
        throw new Error("Enter a valid contact email address.");
      }
      const hours = form.allDay ? "" : form.openingHours.trim();
      if (hours) {
        const message = hoursError(hours);
        if (message) throw new Error(message);
      }
      const openingHours = form.allDay ? "24/7" : (hours ? formatHours(hours) : "");
      if (form.visitScheduleEnabled) {
        const configuredDays = form.visitScheduleDraft?.weeklyHours?.filter((entry) => entry.enabled) || [];
        if (!configuredDays.length) throw new Error("Select at least one day for Managed Inventory visits.");
        const duration = Number(form.visitScheduleDraft.slotDurationMinutes);
        if (!Number.isSafeInteger(duration) || duration < 30 || duration > 480 || duration % 15) throw new Error("Visit slot duration must be 30–480 minutes in 15-minute increments.");
        if (configuredDays.some((entry) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.opensAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.closesAt) || entry.opensAt >= entry.closesAt)) throw new Error("Each visit day needs valid opening and closing times.");
      }
      const imageUrls = (form.images || []).map((url) => String(url).trim()).filter(Boolean);
      if (imageUrls.length > 10) throw new Error("At most 10 facility images are allowed.");
      if (imageUrls.some((url) => {
        try {
          const parsed = new URL(url);
          return !["http:", "https:"].includes(parsed.protocol);
        } catch {
          return true;
        }
      })) throw new Error("Each facility image must be a valid HTTP(S) URL.");
      const body = facilityBody({ ...form, openingHours, images: imageUrls }, { includeCode: !isEdit });
      if (isEdit) await bomFacilityApi.update(id, body);
      else await bomFacilityApi.create(body);
      invalidateFacilities();
      nav(backTo);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen
      title={isEdit ? "Edit facility" : "Create facility"}
      description="Code is required on create and is immutable afterwards."
    >
      <AsyncBoundary
        state={isEdit ? state : { loading: false, data: null, error: "" }}
        render={() => (
          <Panel title="Facility form">
            <form className="bom-form" onSubmit={submit}>
              {!isEdit && (
                <Field label="Facility code" hint="Trimmed and uppercased; must be unique.">
                  <Input aria-label="Facility code" required value={form.code} onChange={(e) => change("code", e.target.value)} />
                </Field>
              )}
              <Field label="Facility name">
                <Input aria-label="Facility name" required value={form.name} onChange={(e) => change("name", e.target.value)} />
              </Field>
              <Field label="Country" hint="Country where the facility is located.">
                <Select
                  label="Country"
                  value={form.country}
                  onChange={(v) => setForm((f) => ({ ...f, country: v, city: "", ward: "", wardCustom: false, district: "", line1: "" }))}
                  options={[["", "Select a country"], ...COUNTRIES]}
                />
              </Field>
              <Field label="City / Province" hint="Select the city or province.">
                <Select
                  label="City / Province"
                  value={form.city}
                  disabled={!form.country}
                  onChange={(v) => setForm((f) => ({ ...f, city: v, ward: "", wardCustom: false, district: "", line1: "" }))}
                  options={[["", form.country ? "Select a city / province" : "Select a country first"], ...citiesFor(form.country)]}
                />
              </Field>
              <Field label="Ward / Commune" hint="Select the ward or commune.">
                <Select
                  label="Ward / Commune"
                  value={form.wardCustom ? CUSTOM_WARD : form.ward}
                  disabled={!form.city}
                  onChange={(v) => setForm((f) => ({ ...f, wardCustom: v === CUSTOM_WARD, ward: v === CUSTOM_WARD ? "" : v, district: "", line1: "" }))}
                  options={[["", form.city ? "Select a ward / commune" : "Select a city / province first"], ...wards, [CUSTOM_WARD, "Other (enter manually)"]]}
                />
              </Field>
              {form.wardCustom && (
                <Field label="Ward / Commune (manual)" hint="Enter the ward or commune.">
                  <Input aria-label="Ward / Commune" required value={form.ward} onChange={(e) => change("ward", e.target.value)} />
                </Field>
              )}
              <Field label="Street / Area" hint="Street name or area.">
                <Input
                  aria-label="Street / Area"
                  required
                  disabled={!wardChosen}
                  value={form.district}
                  onChange={(e) => change("district", e.target.value)}
                />
              </Field>
              <Field label="Address / House number" hint="House number and detail address.">
                <Input
                  aria-label="Address / House number"
                  required
                  disabled={!form.district.trim()}
                  value={form.line1}
                  onChange={(e) => change("line1", e.target.value)}
                />
              </Field>
              {/* Not <Field/>: a <label> would forward clicks from the custom trigger
                  to the first labelable child (the 24/7 checkbox input). */}
              <div className="manager-field">
                <span>Opening hours</span>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[240px] flex-1">
                    <TimeRangePicker
                      ariaLabel="Opening hours"
                      placeholder="08:00 - 18:00"
                      disabled={form.allDay}
                      value={form.openingHours}
                      onChange={(next) => setForm((f) => ({ ...f, openingHours: next }))}
                    />
                  </div>
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox aria-label="Open 24/7" checked={form.allDay} onCheckedChange={(v) => setForm((f) => ({ ...f, allDay: v === true }))} />
                    Open 24/7
                  </span>
                </div>
                <small>Pick the opening and closing time, or mark the facility as open 24/7.</small>
                {!form.allDay && hoursError(form.openingHours) && (
                  <small role="alert" className="text-xs text-red-700">{hoursError(form.openingHours)}</small>
                )}
              </div>
              {form.serviceTypes.includes("MANAGED_INVENTORY") && <div className="manager-field">
                <span>Managed Inventory visit schedule</span>
                <small>Separate from general facility opening hours. Customer availability is estimated from active Staff accounts and overlapping visits; a Manager must still assign a specific escort. Times use Asia/Ho_Chi_Minh.</small>
                <label className="mt-2 flex items-center gap-2 text-sm"><Checkbox aria-label="Configure Managed Inventory visit schedule" checked={form.visitScheduleEnabled} onCheckedChange={(checked) => change("visitScheduleEnabled", checked === true)} />Configure Customer visit booking schedule</label>
                {form.visitScheduleEnabled && <div className="mt-3 space-y-3">
                  <Field label="Visit slot duration" hint="30–480 minutes in 15-minute increments. Access Session still ends after at most 60 minutes or earlier at Visit/rental end.">
                    <Select label="Visit slot duration" value={String(form.visitScheduleDraft.slotDurationMinutes)} onChange={(value) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, slotDurationMinutes: Number(value) } }))} options={Array.from({ length: 31 }, (_, index) => String(30 + index * 15))} />
                  </Field>
                  {form.visitScheduleDraft.weeklyHours.map((day, index) => <div key={day.weekday} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                    <label className="flex items-center gap-2 text-sm"><Checkbox aria-label={`${WEEKDAYS[day.weekday]} visit day`} checked={day.enabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, weeklyHours: current.visitScheduleDraft.weeklyHours.map((entry, i) => i === index ? { ...entry, enabled: checked === true } : entry) } }))} />{WEEKDAYS[day.weekday]}</label>
                    <Field label={`${WEEKDAYS[day.weekday]} opens`}><Input aria-label={`${WEEKDAYS[day.weekday]} opens`} type="time" disabled={!day.enabled} value={day.opensAt} onChange={(event) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, weeklyHours: current.visitScheduleDraft.weeklyHours.map((entry, i) => i === index ? { ...entry, opensAt: event.target.value } : entry) } }))} /></Field>
                    <Field label={`${WEEKDAYS[day.weekday]} closes`}><Input aria-label={`${WEEKDAYS[day.weekday]} closes`} type="time" disabled={!day.enabled} value={day.closesAt} onChange={(event) => setForm((current) => ({ ...current, visitScheduleDraft: { ...current.visitScheduleDraft, weeklyHours: current.visitScheduleDraft.weeklyHours.map((entry, i) => i === index ? { ...entry, closesAt: event.target.value } : entry) } }))} /></Field>
                  </div>)}
                </div>}
              </div>}
              <Field label="Business status">
                <Select label="Business status" value={form.status} onChange={(v) => change("status", v)} options={["ACTIVE", "INACTIVE"]} />
              </Field>
              <Field label="Contact phone" hint="Optional. Sent as contact.phone.">
                <Input aria-label="Contact phone" value={form.contactPhone || ""} onChange={(e) => change("contactPhone", e.target.value)} />
              </Field>
              <Field label="Contact email" hint="Optional. Sent as contact.email and must be a valid address.">
                <Input aria-label="Contact email" type="email" value={form.contactEmail || ""} onChange={(e) => change("contactEmail", e.target.value)} />
              </Field>
              <Field label="Service models" hint="At least one service model is required.">
                <div className="flex flex-wrap gap-4 py-2">
                  {BOM_SERVICE_TYPES.map((service) => (
                    <label key={service} className="flex items-center gap-2 text-sm">
                      <Checkbox aria-label={service} checked={form.serviceTypes.includes(service)} onCheckedChange={() => toggleService(service)} />
                      {serviceLabel(service)}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="manager-field">
                <span>Facility images</span>
                <div className="space-y-2">
                  {images.map((url, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[240px] flex-1">
                        <Input
                          aria-label={`Facility image URL ${index + 1}`}
                          placeholder="https://res.cloudinary.com/..."
                          value={url}
                          onChange={(event) => setImage(index, event.target.value)}
                        />
                      </div>
                      <Button type="button" variant="outline" onClick={() => removeImage(index)}>Remove</Button>
                    </div>
                  ))}
                  {images.length < 10 && (
                    <Button type="button" variant="outline" onClick={addImage}>Add image URL</Button>
                  )}
                </div>
                <small>Optional. Up to 10 HTTP(S) image URLs; the first image is used as the public catalog cover.</small>
              </div>
              <div className="bom-wide">
                <Field label="Description">
                  <Textarea aria-label="Description" value={form.description} onChange={(e) => change("description", e.target.value)} />
                </Field>
                {form.status === "INACTIVE" && (
                  <p className="bom-warning mb-5">New reservations are blocked. Existing active rentals are NOT automatically terminated.</p>                )}
                {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save facility" : "Create facility"}</Button>
                  <Button type="button" variant="outline" onClick={() => nav(backTo)}>Cancel</Button>
                </div>
              </div>
            </form>
          </Panel>
        )}
      />
    </Screen>
  );
}
