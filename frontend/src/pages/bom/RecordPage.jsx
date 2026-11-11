import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Details, Button, money,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, LIVE_NOTICE, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { bomPricingApi, bomPolicyApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName, fetchPaged } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, BOM_UNIT_SIZES, BOM_TERM_MONTHS, BOM_CURRENCY, BOM_POLICY_TYPES,
  bomFutureDate, responseData,
  pricingFromDto, pricingLabel, pricingBody, pricingUpdateBody,
  policyFromDto,
} from "@/lib/bomMappers";

const blankPricing = () => ({
  facilityId: "", service: "SELF_STORAGE", unitSize: "SMALL", billingMonths: 1,
  rate: "", currency: BOM_CURRENCY, effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});
const CONFIGS = {
  pricing: {
    api: bomPricingApi, root: "/bom/pricing", title: "Pricing rules", code: "P051",
    fromDto: pricingFromDto, body: pricingBody, blank: blankPricing, hasService: true,
  },
  policy: {
    api: bomPolicyApi, root: "/bom/policies", title: "Business policies", code: "P052",
    policyTypes: BOM_POLICY_TYPES.map(({ key }) => key),
    fromDto: policyFromDto,
  },
};

// The same page is mounted under /bom and /admin. Config objects are memoised per
// (kind, basePath) so they stay referentially stable for the useAsyncData dependency arrays.
const CONFIG_ROOTS = { pricing: "/pricing", policy: "/policies" };
const configCache = new Map();
function configFor(kind, basePath) {
  if (!CONFIGS[kind]) return null;
  const key = `${kind}:${basePath}`;
  if (!configCache.has(key))
    configCache.set(key, { ...CONFIGS[kind], root: `${basePath}${CONFIG_ROOTS[kind]}` });
  return configCache.get(key);
}

// Bounded server-paged fetch. Results are narrowed to the configured policy types when present.
const loadRecords = (config, signal) =>
  fetchPaged(config.api.list, config.listParams || {}, { signal })
    .then((page) => ({
      ...page,
      rows: config.policyTypes ? page.rows.filter((row) => config.policyTypes.includes(row.type)) : page.rows,
    }));

export default function RecordPage({ kind, mode = "list", basePath = "/bom" }) {
  const config = configFor(kind, basePath);
  if (!config) return <BomUnavailable />;
  if (kind === "policy" && ["new", "edit"].includes(mode)) return <BomUnavailable />;
  if (mode === "new") return <RecordForm kind={kind} config={config} mode="new" />;
  if (mode === "edit") return <RecordForm kind={kind} config={config} mode="edit" />;
  if (mode === "detail") return <RecordDetail kind={kind} config={config} />;
  return <RecordList kind={kind} config={config} />;
}

function RecordList({ kind, config }) {
  const state = useAsyncData(
    ({ signal }) => Promise.all([loadRecords(config, signal), loadFacilities()]),
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
        ? <Button asChild variant="orange"><Link to={`${config.root}/new`}>Create pricing rule</Link></Button>
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
      <AsyncBoundary state={state} render={([recordPage, facilities]) => {
        const records = recordPage.rows;
        const rows = records.map(config.fromDto).filter((row) =>
          (!status || row.status === status) &&
          (kind !== "policy" || !type || row.type === type) &&
          (kind !== "pricing" || !service || row.service === service));
        return (
          <Panel title={config.title} subtitle={`${rows.length} of ${records.length} records`}>
            {recordPage.truncated && <TruncatedNotice total={recordPage.total} shown={records.length} />}
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
        const futurePricing = kind === "pricing" && record.effectiveFrom && new Date(record.effectiveFrom) > new Date();
        return (
          <>
            <Panel
              title={kind === "pricing" ? futurePricing ? "Scheduled Pricing Rule" : "Effective Pricing Rule" : "Current rule"}
              action={kind === "pricing" ? <Button asChild variant="outline"><Link to={`${config.root}/${id}/edit`}>Edit</Link></Button> : undefined}
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
              {futurePricing && <p className="mt-4 text-sm text-slate-600">This price is scheduled for {record.effectiveFrom}; the current effective price remains in force until then.</p>}
              {kind === "pricing" && <div className="mt-5">
                <Button variant="orange" onClick={() => setConfirmOpen(true)}>
                  {nextStatus === "ACTIVE" ? "Activate" : "Deactivate"}
                </Button>
              </div>}
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
      const body = isEdit ? pricingUpdateBody(form) : config.body(form);
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
      description={isEdit
        ? "Set the future date when this price starts. The current effective price remains unchanged before that date."
        : "Effective dates must start in the future. Changes are written to the backend through the confirmed ADMIN/BOM APIs."}
      notice={LIVE_NOTICE}
    >
      <AsyncBoundary
        state={state}
        render={([, facilities = []]) => (
          <Panel title="Rule form">
            <form className="bom-form" onSubmit={submit}>
              {!isEdit && <Field label="Facility scope">
                <Select
                  label="Facility scope"
                  value={form.facilityId}
                  onChange={(v) => change("facilityId", v)}
                  options={[["", "Select a facility"], ...facilities.map((f) => [f.id, f.name])]}
                />
              </Field>}
              {!isEdit && config.hasService && (
                <Field label="Service model">
                  <Select label="Service model" value={form.service} onChange={(v) => change("service", v)} options={BOM_SERVICE_TYPES} />
                </Field>
              )}
              {!isEdit && kind === "pricing" && form.service === "SELF_STORAGE" && (
                <Field label="Private unit size">
                  <Select label="Private unit size" value={form.unitSize} onChange={(v) => change("unitSize", v)} options={BOM_UNIT_SIZES} />
                </Field>
              )}
              {kind === "pricing" && (
                <>
                  {!isEdit && <Field label="Billing duration (months)">
                    <Select label="Billing duration (months)" value={form.billingMonths} onChange={(v) => change("billingMonths", Number(v))}
                      options={BOM_TERM_MONTHS.map((m) => [m, `${m} month(s)`])} />
                  </Field>}
                  <Field label={form.service === "MANAGED_INVENTORY" ? "Rate per m³ per billing period (VND)" : "Price per billing period (VND)"}>
                    <Input aria-label="Rate" type="number" min="0" step="any" required value={form.rate} onChange={(e) => change("rate", e.target.value)} />
                  </Field>
                  <Field label="Currency">
                    <Input aria-label="Currency" value={form.currency} onChange={(e) => change("currency", e.target.value.toUpperCase())} />
                  </Field>
                </>
              )}
              <Field label="Effective from" hint={`Must be ${minDate} or later (backend rejects today/past).`}>
                <Input aria-label="Effective from" type="date" min={minDate} required value={form.effectiveFrom} onChange={(e) => change("effectiveFrom", e.target.value)} />
              </Field>
              <Field label="Effective end (optional)">
                <Input aria-label="Effective end" type="date" min={form.effectiveFrom || minDate} value={form.effectiveTo} onChange={(e) => change("effectiveTo", e.target.value)} />
              </Field>
              {!isEdit && <Field label="Status">
                <Select label="Status" value={form.status} onChange={(v) => change("status", v)} options={["INACTIVE", "ACTIVE"]} />
              </Field>}
              <div className="bom-wide">
                {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save future price" : "Create rule"}</Button>
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
