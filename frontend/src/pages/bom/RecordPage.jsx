import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button, money,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { bomPricingApi, bomPolicyApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, BOM_UNIT_SIZES, BOM_TERM_MONTHS, BOM_CURRENCY, BOM_POLICY_TYPES,
  bomFutureDate, responseData, responseList,
  pricingFromDto, pricingLabel, pricingBody,
  policyFromDto, policyBody,
} from "@/lib/bomMappers";

const blankPricing = () => ({
  facilityId: "", service: "SELF_STORAGE", unitSize: "SMALL", billingMonths: 1,
  rate: "", currency: BOM_CURRENCY, effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});
const blankPolicy = () => ({
  facilityId: "", service: "", type: "DEPOSIT", description: "", rule: "",
  effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});

const CONFIGS = {
  pricing: {
    api: bomPricingApi, root: "/bom/pricing", title: "Pricing rules", code: "P051",
    fromDto: pricingFromDto, body: pricingBody, blank: blankPricing, hasService: true,
  },
  policy: {
    api: bomPolicyApi, root: "/bom/policies", title: "Business policies", code: "P052",
    fromDto: policyFromDto, body: policyBody, blank: blankPolicy, hasService: false,
  },
};

async function loadAll(api) {
  const first = responseList(await api.list({ page: 1, limit: 100 }));
  let rows = first.rows;
  const totalPages = first.pagination?.totalPages || 1;
  for (let page = 2; page <= totalPages; page += 1) {
    rows = rows.concat(responseList(await api.list({ page, limit: 100 })).rows);
  }
  return rows;
}

export default function RecordPage({ kind, mode = "list" }) {
  const config = CONFIGS[kind];
  if (!config) return <BomUnavailable />;
  if (mode === "new") return <RecordForm kind={kind} config={config} mode="new" />;
  if (mode === "edit") return <RecordForm kind={kind} config={config} mode="edit" />;
  if (mode === "detail") return <RecordDetail kind={kind} config={config} />;
  return <RecordList kind={kind} config={config} />;
}

function RecordList({ kind, config }) {
  const state = useAsyncData(
    () => Promise.all([loadAll(config.api), loadFacilities()]),
    [kind],
  );
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [service, setService] = useState("");

  return (
    <Screen
      title={config.title}
      description={kind === "pricing"
        ? "Live pricing rules: private-unit prices and Managed capacity rates with effective periods."
        : "Live business policies confirmed by the backend PolicyType contract."}
      notice={LIVE_NOTICE}
      action={kind === "pricing"
        ? <Button asChild variant="orange"><Link to="/bom/pricing/new">Create pricing rule</Link></Button>
        : undefined}
    >
      <Panel title="Filters">
        <div className="manager-filters">
          <Select label="Status filter" value={status} onChange={setStatus} options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
          {kind === "policy" && (
            <Select label="Policy type filter" value={type} onChange={setType}
              options={[["", "All policy types"], ...BOM_POLICY_TYPES.map(({ key, label }) => [key, label])]} />
          )}
          {kind === "pricing" && (
            <Select label="Service filter" value={service} onChange={setService}
              options={[["", "Both services"], ...BOM_SERVICE_TYPES]} />
          )}
        </div>
      </Panel>
      <AsyncBoundary state={state} render={([records, facilities]) => {
        const rows = records.map(config.fromDto).filter((row) =>
          (!status || row.status === status) &&
          (kind !== "policy" || !type || row.type === type) &&
          (kind !== "pricing" || !service || row.service === service));
        return (
          <Panel title={config.title} subtitle={`${rows.length} of ${records.length} records`}>
            <Table
              label={config.title}
              rows={rows}
              columns={kind === "pricing" ? [
                { key: "scope", label: "Scope", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{pricingLabel(r)}</OpenLink> },
                { key: "service", label: "Service" },
                { key: "facility", label: "Facility", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "rate", label: "Price", render: (r) => `${money(r.rate)} ${r.currency}` },
                { key: "effectiveFrom", label: "Effective from" },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Version" },
              ] : [
                { key: "name", label: "Policy", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{r.name}</OpenLink> },
                { key: "facility", label: "Facility", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "rule", label: "Rule" },
                { key: "effectiveFrom", label: "Effective from" },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Version" },
              ]}
            />
          </Panel>
        );
      }} />
    </Screen>
  );
}

function RecordDetail({ kind, config }) {
  const { id } = useParams();
  const state = useAsyncData(
    () => config.api.get(id).then(responseData).then(config.fromDto),
    [id, kind],
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [capacity, setCapacity] = useState("10");

  if (!state.loading && state.error && /not found|unavailable|404/i.test(state.error)) return <BomUnavailable />;

  return (
    <Screen
      title="Record detail"
      description={config.title}
      notice={LIVE_NOTICE}
      action={<Button asChild variant="outline"><Link to={config.root}>Back to {config.title.toLowerCase()}</Link></Button>}
    >
      <AsyncBoundary state={state} render={(record) => {
        const nextStatus = record.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        return (
          <>
            <Panel
              title="Current rule"
              action={<Button asChild variant="outline"><Link to={`${config.root}/${id}/edit`}>Edit</Link></Button>}
            >
              <Details values={kind === "pricing" ? [
                ["Scope", pricingLabel(record)],
                ["Service", record.service],
                ["Private unit size", record.unitSize || "—"],
                ["Billing term", `${record.billingMonths} month(s)`],
                ["Price", `${money(record.rate)} ${record.currency}`],
                ["Effective from", record.effectiveFrom],
                ["Effective end", record.effectiveTo || "Open-ended"],
                ["Status", <Status value={record.status} />],
                ["Version", record.revision],
              ] : [
                ["Policy", record.name],
                ["Policy type", record.type],
                ["Service", record.service || "Any"],
                ["Description", record.description],
                ["Rule", record.rule],
                ["Effective from", record.effectiveFrom],
                ["Effective end", record.effectiveTo || "Open-ended"],
                ["Status", <Status value={record.status} />],
                ["Version", record.revision],
              ]} />
              <div className="mt-5">
                <Button variant="orange" onClick={() => setConfirmOpen(true)}>
                  {nextStatus === "ACTIVE" ? "Activate" : "Deactivate"}
                </Button>
              </div>
            </Panel>
            {kind === "pricing" && record.service === "MANAGED_INVENTORY" && (
              <Panel title="Future quote illustration" subtitle="Illustrative only. Does not create or modify any contract, invoice or payment.">
                <Field label="Quote allocated capacity (m³)">
                  <Input aria-label="Quote allocated capacity (m³)" type="number" min="0.01" step="any" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                </Field>
                <p className="mt-5 text-xl font-bold">
                  {Number(capacity) > 0 && Number.isFinite(Number(capacity))
                    ? `${money(Number(capacity) * record.rate)} ${record.currency}`
                    : "Enter a positive capacity"}{" "}
                  / {record.billingMonths} month billing period
                </p>
              </Panel>
            )}
            {confirmOpen && (
              <ConfirmDialog
                title="Confirm status change"
                confirmLabel={`Set ${nextStatus}`}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => {
                  await config.api.setActive(id, nextStatus === "ACTIVE");
                  state.reload();
                }}
              >
                <p className="text-sm text-slate-500">
                  This rule will be set to <b>{nextStatus}</b> on the backend. Historical contract and payment snapshots are not rewritten.
                </p>
              </ConfirmDialog>
            )}
          </>
        );
      }} />
    </Screen>
  );
}

function RecordForm({ kind, config, mode }) {
  const { id } = useParams();
  const nav = useNavigate();
  const isEdit = mode === "edit";
  const state = useAsyncData(
    () => Promise.all([
      isEdit ? config.api.get(id).then(responseData).then(config.fromDto) : Promise.resolve(null),
      loadFacilities(),
    ]),
    [id, kind, isEdit],
  );
  const [form, setForm] = useState(config.blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isEdit && state.data?.[0]) setForm(state.data[0]);
    else if (!isEdit) setForm(config.blank);
  }, [state.data, isEdit, config]);

  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const body = config.body(form);
      if (isEdit) await config.api.update(id, body);
      else await config.api.create(body);
      nav(config.root);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const minDate = bomFutureDate(1);

  return (
    <Screen
      title={`${isEdit ? "Edit" : "Create"} ${kind}`}
      description="Effective dates must start in the future. Changes are written to the backend through the confirmed ADMIN/BOM APIs."
      notice={LIVE_NOTICE}
    >
      <AsyncBoundary
        state={state}
        render={([, facilities = []]) => (
          <Panel title="Rule form">
            <form className="bom-form" onSubmit={submit}>
              <Field label="Facility scope">
                <Select
                  label="Facility scope"
                  value={form.facilityId}
                  onChange={(v) => change("facilityId", v)}
                  options={[["", "Select a facility"], ...facilities.map((f) => [f.id, f.name])]}
                />
              </Field>
              {kind === "policy" && (
                <Field label="Policy type">
                  <Select label="Policy type" value={form.type} onChange={(v) => change("type", v)}
                    options={BOM_POLICY_TYPES.map(({ key, label }) => [key, label])} />
                </Field>
              )}
              {config.hasService && (
                <Field label="Service model">
                  <Select label="Service model" value={form.service} onChange={(v) => change("service", v)} options={BOM_SERVICE_TYPES} />
                </Field>
              )}
              {kind === "pricing" && form.service === "SELF_STORAGE" && (
                <Field label="Private unit size">
                  <Select label="Private unit size" value={form.unitSize} onChange={(v) => change("unitSize", v)} options={BOM_UNIT_SIZES} />
                </Field>
              )}
              {kind === "pricing" && (
                <>
                  <Field label="Billing duration (months)">
                    <Select label="Billing duration (months)" value={form.billingMonths} onChange={(v) => change("billingMonths", Number(v))}
                      options={BOM_TERM_MONTHS.map((m) => [m, `${m} month(s)`])} />
                  </Field>
                  <Field label={form.service === "MANAGED_INVENTORY" ? "Rate per m³ per billing period (VND)" : "Price per billing period (VND)"}>
                    <Input aria-label="Rate" type="number" min="0" step="any" required value={form.rate} onChange={(e) => change("rate", e.target.value)} />
                  </Field>
                  <Field label="Currency">
                    <Input aria-label="Currency" value={form.currency} onChange={(e) => change("currency", e.target.value.toUpperCase())} />
                  </Field>
                </>
              )}
              {kind === "policy" && (
                <>
                  <div className="bom-wide">
                    <Field label="Policy description">
                      <Textarea aria-label="Policy description" required value={form.description} onChange={(e) => change("description", e.target.value)} />
                    </Field>
                  </div>
                  <div className="bom-wide">
                    <Field label="Policy rule">
                      <Textarea aria-label="Policy rule" required value={form.rule} onChange={(e) => change("rule", e.target.value)} />
                    </Field>
                  </div>
                </>
              )}
              <Field label="Effective from" hint={`Must be ${minDate} or later (backend rejects today/past).`}>
                <Input aria-label="Effective from" type="date" min={minDate} required value={form.effectiveFrom} onChange={(e) => change("effectiveFrom", e.target.value)} />
              </Field>
              <Field label="Effective end (optional)">
                <Input aria-label="Effective end" type="date" min={form.effectiveFrom || minDate} value={form.effectiveTo} onChange={(e) => change("effectiveTo", e.target.value)} />
              </Field>
              <Field label="Status">
                <Select label="Status" value={form.status} onChange={(v) => change("status", v)} options={["INACTIVE", "ACTIVE"]} />
              </Field>
              <div className="bom-wide">
                {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save rule" : "Create rule"}</Button>
                  <Button type="button" variant="outline" onClick={() => nav(config.root)}>Cancel</Button>
                </div>
              </div>
            </form>
          </Panel>
        )}
      />
    </Screen>
  );
}
