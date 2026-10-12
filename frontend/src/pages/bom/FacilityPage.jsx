import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button,
} from "@/components/manager/ManagerUI";
import { Checkbox } from "@/components/ui/checkbox";
import { TimeRangePicker } from "@/components/ui/time-range-picker";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { bomFacilityApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, invalidateFacilities } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, facilityFromDto, facilityForm, facilityBody, responseData,
} from "@/lib/bomMappers";
import { COUNTRIES, CUSTOM_WARD, citiesFor, wardsFor } from "@/lib/addressData";

const EMPTY_FORM = {
  code: "", name: "", line1: "", ward: "", wardCustom: false, district: "", city: "", country: "",
  openingHours: "", allDay: false,
  description: "", serviceTypes: ["SELF_STORAGE"], status: "ACTIVE",
};

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

export default function FacilityPage({ mode = "list" }) {
  if (mode === "new") return <FacilityForm mode="new" />;
  if (mode === "edit") return <FacilityForm mode="edit" />;
  if (mode === "detail") return <FacilityDetail />;
  return <FacilityList />;
}

function FacilityList() {
  const state = useAsyncData(loadFacilities, []);
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
      description="Live facility records from the backend. Create, edit and activate or deactivate cross-facility resources."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="orange"><Link to="/bom/facilities/new">Create facility</Link></Button>}
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
        </div>
      </Panel>
      <AsyncBoundary state={state} render={() => (
        <Panel title="Facility records" subtitle={`${rows.length} of ${facilities.length} facilities`}>
          <Table
            label="Facilities"
            rows={rows}
            columns={[
              { key: "name", label: "Facility", render: (f) => <OpenLink to={`/bom/facilities/${f.id}`}>{f.name}</OpenLink> },
              { key: "code", label: "Code" },
              { key: "status", label: "Business status", render: (f) => <Status value={f.status} /> },
              { key: "city", label: "City / Province" },
              { key: "address", label: "Address" },
              { key: "services", label: "Service models", render: (f) => f.serviceTypes.join(", ") || "—" },
              { key: "openingHours", label: "Opening hours" },
            ]}
          />
        </Panel>
      )} />
    </Screen>
  );
}

// Navigation context comes from the ROUTE first, so the sidebar, the back action and the
// edit flow stay correct on reload, bookmark or shared link. `location.state` is only a
// fallback for entry points that have no dedicated route yet (e.g. the dashboard).
const OVERSIGHT_ROOT = "/bom/oversight";
const OVERSIGHT_FACILITIES = `${OVERSIGHT_ROOT}/facilities`;
const BACK_LABELS = {
  [OVERSIGHT_ROOT]: "Back to oversight",
  "/bom/dashboard": "Back to dashboard",
};

function facilityNav(location) {
  const pathname = location?.pathname || "";
  if (pathname === OVERSIGHT_ROOT || pathname.startsWith(`${OVERSIGHT_ROOT}/`)) {
    return { base: OVERSIGHT_FACILITIES, backTo: OVERSIGHT_ROOT, backLabel: BACK_LABELS[OVERSIGHT_ROOT] };
  }
  const backTo = location?.state?.from || "/bom/facilities";
  return { base: "/bom/facilities", backTo, backLabel: BACK_LABELS[backTo] || "Back to facilities" };
}

function FacilityDetail() {
  const { id } = useParams();
  const location = useLocation();
  const state = useAsyncData(() => bomFacilityApi.get(id).then(responseData).then(facilityFromDto), [id]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { base, backTo, backLabel } = facilityNav(location);

  if (!state.loading && state.error && /not found|unavailable|invalid|404/i.test(state.error)) return <BomUnavailable />;

  return (
    <Screen
      title="Facility detail"
      description="Live facility record from the backend."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to={backTo}>{backLabel}</Link></Button>}
    >
      <AsyncBoundary state={state} render={(facility) => {
        const nextStatus = facility.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        return (
          <>
            <Panel
              title="Facility information"
              action={<Button asChild variant="outline"><Link to={`${base}/${id}/edit`} state={{ from: backTo }}>Edit facility</Link></Button>}
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
                ["Business status", <Status value={facility.status} />],
                ["Contact phone", facility.contact?.phone],
                ["Contact email", facility.contact?.email],
                ["Description", facility.description],
              ]} />
              <p className="bom-warning mt-5">
                Deactivation only blocks new reservations. Existing active rentals are preserved by the backend contract.
              </p>
              <div className="mt-5">
                <Button variant="orange" onClick={() => setConfirmOpen(true)}>
                  {nextStatus === "ACTIVE" ? "Activate facility" : "Deactivate facility"}
                </Button>
              </div>
            </Panel>
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
                  The facility <b>{facility.name}</b> will be set to <b>{nextStatus}</b> on the backend.
                </p>
              </ConfirmDialog>
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function FacilityForm({ mode }) {
  const { id } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const { backTo } = facilityNav(location);
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
      const hours = form.allDay ? "" : form.openingHours.trim();
      if (hours) {
        const message = hoursError(hours);
        if (message) throw new Error(message);
      }
      const openingHours = form.allDay ? "24/7" : (hours ? formatHours(hours) : "");
      const body = facilityBody({ ...form, openingHours }, { includeCode: !isEdit });
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
      description="Facility fields confirmed by the backend contract. Code is required on create and is immutable afterwards."
      notice={LIVE_NOTICE}
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
              <Field label="Business status">
                <Select label="Business status" value={form.status} onChange={(v) => change("status", v)} options={["ACTIVE", "INACTIVE"]} />
              </Field>
              <Field label="Service models" hint="At least one service model is required.">
                <div className="flex flex-wrap gap-4 py-2">
                  {BOM_SERVICE_TYPES.map((service) => (
                    <label key={service} className="flex items-center gap-2 text-sm">
                      <Checkbox aria-label={service} checked={form.serviceTypes.includes(service)} onCheckedChange={() => toggleService(service)} />
                      {service.replaceAll("_", " ")}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="bom-wide">
                <Field label="Description">
                  <Textarea aria-label="Description" value={form.description} onChange={(e) => change("description", e.target.value)} />
                </Field>
                {form.status === "INACTIVE" && (
                  <p className="bom-warning mb-5">New reservations are blocked. Existing active rentals are NOT automatically terminated.</p>
                )}
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
