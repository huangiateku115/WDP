import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button,
} from "@/components/manager/ManagerUI";
import { Checkbox } from "@/components/ui/checkbox";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { bomFacilityApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, facilityFromDto, facilityForm, facilityBody, responseData,
} from "@/lib/bomMappers";

const EMPTY_FORM = {
  code: "", name: "", line1: "", ward: "", district: "", city: "", country: "Vietnam",
  openingHours: "", description: "", serviceTypes: ["SELF_STORAGE"], status: "ACTIVE",
};

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
  const [district, setDistrict] = useState("");
  const facilities = state.data || [];
  const districts = [...new Set(facilities.map((f) => f.district).filter(Boolean))];
  const rows = facilities.filter((f) =>
    (!search || `${f.code} ${f.name} ${f.address}`.toLowerCase().includes(search.toLowerCase())) &&
    (!status || f.status === status) &&
    (!district || f.district === district));

  return (
    <Screen
      title="Facilities"
      description="Live facility records from the backend. Create, edit and activate or deactivate cross-facility resources."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="orange"><Link to="/bom/facilities/new">Create facility</Link></Button>}
    >
      <Panel title="Facility filters">
        <div className="manager-filters">
          <Field label="Search"><Input aria-label="Search facilities" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Select label="Status filter" value={status} onChange={setStatus} options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
          <Select label="District filter" value={district} onChange={setDistrict} options={[["", "All districts"], ...districts]} />
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
              { key: "district", label: "District/location" },
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

function FacilityDetail() {
  const { id } = useParams();
  const state = useAsyncData(() => bomFacilityApi.get(id).then(responseData).then(facilityFromDto), [id]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!state.loading && state.error && /not found|unavailable|404/i.test(state.error)) return <BomUnavailable />;

  return (
    <Screen
      title="Facility detail"
      description="Live facility record from the backend."
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to="/bom/facilities">Back to facilities</Link></Button>}
    >
      <AsyncBoundary state={state} render={(facility) => {
        const nextStatus = facility.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        return (
          <>
            <Panel
              title="Facility information"
              action={<Button asChild variant="outline"><Link to={`/bom/facilities/${id}/edit`}>Edit facility</Link></Button>}
            >
              <Details values={[
                ["Facility code", facility.code],
                ["District/location", facility.district],
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
  const nav = useNavigate();
  const isEdit = mode === "edit";
  const state = useAsyncData(
    () => (isEdit ? bomFacilityApi.get(id).then(responseData).then(facilityForm) : Promise.resolve(null)),
    [id, isEdit],
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(state.data || EMPTY_FORM);
  }, [state.data]);

  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
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
      const body = facilityBody(form, { includeCode: !isEdit });
      if (isEdit) await bomFacilityApi.update(id, body);
      else await bomFacilityApi.create(body);
      nav("/bom/facilities");
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
              <Field label="Address line">
                <Input aria-label="Address line" required value={form.line1} onChange={(e) => change("line1", e.target.value)} />
              </Field>
              <Field label="Ward">
                <Input aria-label="Ward" value={form.ward} onChange={(e) => change("ward", e.target.value)} />
              </Field>
              <Field label="District/location">
                <Input aria-label="District/location" value={form.district} onChange={(e) => change("district", e.target.value)} />
              </Field>
              <Field label="City">
                <Input aria-label="City" required value={form.city} onChange={(e) => change("city", e.target.value)} />
              </Field>
              <Field label="Country">
                <Input aria-label="Country" required value={form.country} onChange={(e) => change("country", e.target.value)} />
              </Field>
              <Field label="Opening hours">
                <Input aria-label="Opening hours" placeholder="08:00 - 18:00" value={form.openingHours} onChange={(e) => change("openingHours", e.target.value)} />
              </Field>
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
                  <Button type="button" variant="outline" onClick={() => nav("/bom/facilities")}>Cancel</Button>
                </div>
              </div>
            </form>
          </Panel>
        )}
      />
    </Screen>
  );
}
