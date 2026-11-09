import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, LIVE_NOTICE, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { bomPolicyApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName, fetchPaged } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, BOM_DISCOUNT_KINDS, BOM_DISCOUNT_VALUE_TYPES, BOM_DISCOUNT_TYPES,
  bomFutureDate, responseData, isEffectiveRecord,
  discountFromDto, discountValueLabel, discountBody, discountUpdateBody,
  categoryFromDto, categoryBody, categoryUpdateBody,
} from "@/lib/bomMappers";

// Live Discounts/Waivers and Item-category policies, backed by the confirmed /policies API
// (backend PolicyType DISCOUNT / WAIVER / CATEGORY).

const blankDiscount = () => ({
  facilityId: "", service: "", kind: "PROMOTIONAL", name: "", valueType: "UNDEFINED", value: "",
  conditions: "", effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});
const blankCategory = () => ({
  facilityId: "", service: "MANAGED_INVENTORY", allowedCategories: "", blockedCategories: "",
  effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});

const CONFIGS = {
  discount: {
    root: "/bom/policies/discounts", title: "Discounts and waivers", single: "discount policy",
    policyTypes: BOM_DISCOUNT_TYPES, listParams: {},
    fromDto: discountFromDto, body: discountBody, updateBody: discountUpdateBody, blank: blankDiscount,
  },
  category: {
    root: "/bom/policies/item-categories", title: "Item categories", single: "item category",
    policyTypes: ["CATEGORY"], listParams: { type: "CATEGORY" },
    fromDto: categoryFromDto, body: categoryBody, updateBody: categoryUpdateBody, blank: blankCategory,
  },
};

// Mounted under both /bom and /admin; memoised so the config identity stays stable.
const CONFIG_ROOTS = { discount: "/policies/discounts", category: "/policies/item-categories" };
const configCache = new Map();
function configFor(kind, basePath) {
  if (!CONFIGS[kind]) return null;
  const key = `${kind}:${basePath}`;
  if (!configCache.has(key))
    configCache.set(key, { ...CONFIGS[kind], root: `${basePath}${CONFIG_ROOTS[kind]}` });
  return configCache.get(key);
}

// Bounded server-paged fetch. Category rows are filtered by the backend; discounts are narrowed by type.
const loadRecords = (config, signal) =>
  fetchPaged(bomPolicyApi.list, config.listParams, { signal })
    .then((page) => ({ ...page, rows: page.rows.filter((row) => config.policyTypes.includes(row.type)) }));

export default function PolicyRecordsPage({ kind, mode = "list", basePath = "/bom" }) {
  const config = configFor(kind, basePath);
  if (!config) return <BomUnavailable />;
  if (mode === "new") return <RecordForm kind={kind} config={config} mode="new" />;
  if (mode === "edit") return <RecordForm kind={kind} config={config} mode="edit" />;
  if (mode === "detail") return <RecordDetail kind={kind} config={config} />;
  return <RecordList kind={kind} config={config} />;
}

function RecordList({ kind, config }) {
  const state = useAsyncData(({ signal }) => Promise.all([loadRecords(config, signal), loadFacilities()]), [kind]);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");
  // Discounts are narrowed by kind client-side; CATEGORY policies only need the status filter.
  const typeFilter = kind === "discount"
    ? [["", "All discount kinds"], ...BOM_DISCOUNT_KINDS.map((k) => [k, k.replaceAll("_", " ")])]
    : null;

  return (
    <Screen
      title={config.title}
      description={kind === "discount"
        ? "Live promotional, loyalty and fee-waiver policies stored as backend DISCOUNT/WAIVER policy types."
        : "Live Managed Inventory category acceptance policies stored as backend CATEGORY policy types."}
      notice={LIVE_NOTICE}
      action={<Button asChild variant="orange"><Link to={`${config.root}/new`}>Create {config.single}</Link></Button>}
    >
      <Panel title="Filters">
        <div className="manager-filters">
          <Select label="Status filter" value={status} onChange={setStatus} options={[["", "All statuses"], "ACTIVE", "INACTIVE"]} />
          {typeFilter && <Select label="Type filter" value={filter} onChange={setFilter} options={typeFilter} />}
        </div>
      </Panel>
      <AsyncBoundary state={state} render={([recordPage, facilities]) => {
        const records = recordPage.rows;
        const rows = records.map(config.fromDto).filter((row) =>
          (!status || row.status === status) &&
          (!typeFilter || !filter || row.kind === filter));
        return (
          <Panel title={config.title} subtitle={`${rows.length} of ${records.length} records`}>
            {recordPage.truncated && <TruncatedNotice total={recordPage.total} shown={records.length} />}
            <Table
              label={config.title}
              rows={rows}
              columns={kind === "discount" ? [
                { key: "name", label: "Discount", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{r.name}</OpenLink> },
                { key: "kind", label: "Kind", render: (r) => r.kind.replaceAll("_", " ") },
                { key: "value", label: "Value", render: (r) => discountValueLabel(r) },
                { key: "facility", label: "Facility", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "effectiveFrom", label: "Effective from" },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Version" },
              ] : [
                { key: "name", label: "Allowed categories", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{r.name}</OpenLink> },
                { key: "blocked", label: "Blocked", render: (r) => r.blockedCount },
                { key: "facility", label: "Facility", render: (r) => facilityName(facilities, r.facilityId) },
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
  const state = useAsyncData(() => bomPolicyApi.get(id).then(responseData).then(config.fromDto), [id, kind]);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
              <Details values={kind === "discount" ? [
                ["Discount", record.name],
                ["Kind", record.kind.replaceAll("_", " ")],
                ["Backend policy type", record.policyType],
                ["Value", discountValueLabel(record)],
                ["Conditions", record.conditions],
                ["Effective from", record.effectiveFrom],
                ["Effective end", record.effectiveTo || "Open-ended"],
                ["Status", <Status value={record.status} />],
                ["Version", record.revision],
              ] : [
                ["Allowed categories", record.allowedCategories || "—"],
                ["Blocked categories", record.blockedCategories || "—"],
                ["Service model", record.service || "MANAGED_INVENTORY"],
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
            {confirmOpen && (
              <ConfirmDialog
                title="Confirm status change"
                confirmLabel={`Set ${nextStatus}`}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => {
                  await bomPolicyApi.setActive(id, nextStatus === "ACTIVE");
                  state.reload();
                }}
              >
                <p className="text-sm text-slate-500">
                  This policy will be set to <b>{nextStatus}</b> on the backend. Existing rentals, contracts and payments are not rewritten.
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
      isEdit ? bomPolicyApi.get(id).then(responseData).then(config.fromDto) : Promise.resolve(null),
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
  // An already-effective policy is immutable except for a prospective effectiveTo.
  const locked = isEdit && isEffectiveRecord(form);

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      if (!form.facilityId) throw new Error("Select a facility.");
      if (locked && !form.effectiveTo) {
        throw new Error("This policy is already effective. Set a future effective end date to close it.");
      }
      const body = isEdit ? config.updateBody(form, { effective: locked }) : config.body(form);
      if (isEdit) await bomPolicyApi.update(id, body);
      else await bomPolicyApi.create(body);
      nav(config.root);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const minDate = bomFutureDate(1);
  const lockNotice = locked
    ? "This policy is already effective: scope, type and config are immutable. Only a future effective end date can be saved."
    : "";

  return (
    <Screen
      title={`${isEdit ? "Edit" : "Create"} ${config.single}`}
      description="Effective dates must start in the future. Changes are written to the backend through the confirmed ADMIN/BOM APIs."
      notice={LIVE_NOTICE}
    >
      <AsyncBoundary state={state} render={([, facilities = []]) => (
        <Panel title="Rule form">
          <form className="bom-form" onSubmit={submit}>
            <Field label="Facility scope">
              <Select label="Facility scope" value={form.facilityId} disabled={locked} onChange={(v) => change("facilityId", v)}
                options={[["", "Select a facility"], ...facilities.map((f) => [f.id, f.name])]} />
            </Field>
            {kind === "discount" && (
              <Field label="Service model (optional)">
                <Select label="Service model" value={form.service} disabled={locked} onChange={(v) => change("service", v)}
                  options={[["", "Any service"], ...BOM_SERVICE_TYPES]} />
              </Field>
            )}

            {kind === "discount" && (
              <>
                <Field label="Discount kind">
                  <Select label="Discount kind" value={form.kind} disabled={locked} onChange={(v) => change("kind", v)}
                    options={BOM_DISCOUNT_KINDS.map((k) => [k, k.replaceAll("_", " ")])} />
                </Field>
                <Field label="Discount name"><Input aria-label="Discount name" required disabled={locked} value={form.name} onChange={(e) => change("name", e.target.value)} /></Field>
                <Field label="Value type">
                  <Select label="Value type" value={form.valueType} disabled={locked} onChange={(v) => change("valueType", v)}
                    options={BOM_DISCOUNT_VALUE_TYPES.map((t) => [t, t.replaceAll("_", " ")])} />
                </Field>
                {form.valueType !== "UNDEFINED" && (
                  <Field label={form.valueType === "PERCENTAGE" ? "Percentage (0-100)" : "Fixed amount (VND)"}>
                    <Input aria-label="Discount value" type="number" min="0" step="any" required disabled={locked}
                      value={form.value} onChange={(e) => change("value", e.target.value)} />
                  </Field>
                )}
                <div className="bom-wide"><Field label="Conditions"><Textarea aria-label="Conditions" required disabled={locked} value={form.conditions} onChange={(e) => change("conditions", e.target.value)} /></Field></div>
              </>
            )}

            {kind === "category" && (
              <>
                <div className="bom-wide">
                  <Field label="Allowed categories" hint="Required. Managed Inventory is rejected for any item outside this list. Separate entries with commas or new lines.">
                    <Textarea aria-label="Allowed categories" required disabled={locked} value={form.allowedCategories} onChange={(e) => change("allowedCategories", e.target.value)} />
                  </Field>
                </div>
                <div className="bom-wide">
                  <Field label="Blocked categories" hint="Optional. Blocked entries win over allowed ones; the backend stores at most 100 entries per list.">
                    <Textarea aria-label="Blocked categories" disabled={locked} value={form.blockedCategories} onChange={(e) => change("blockedCategories", e.target.value)} />
                  </Field>
                </div>
                <p className="bom-wide text-sm text-slate-500">
                  CATEGORY policies apply to Managed Inventory only, so the service model is fixed to MANAGED_INVENTORY.
                </p>
              </>
            )}

            <Field label="Effective from" hint={`Must be ${minDate} or later (backend rejects today/past).`}>
              <Input aria-label="Effective from" type="date" min={minDate} required disabled={locked} value={form.effectiveFrom} onChange={(e) => change("effectiveFrom", e.target.value)} />
            </Field>
            <Field label="Effective end (optional)" hint={locked ? "Required to close an effective policy; must be in the future." : undefined}>
              <Input aria-label="Effective end" type="date" min={form.effectiveFrom || minDate} value={form.effectiveTo} onChange={(e) => change("effectiveTo", e.target.value)} />
            </Field>
            <Field label="Status" hint={locked ? "Effective policies cannot be toggled." : undefined}>
              <Select label="Status" value={form.status} disabled={locked} onChange={(v) => change("status", v)} options={["INACTIVE", "ACTIVE"]} />
            </Field>
            {lockNotice && <p className="bom-warning bom-wide">{lockNotice}</p>}

            <div className="bom-wide">
              {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save record" : "Create record"}</Button>
                <Button type="button" variant="outline" onClick={() => nav(config.root)}>Cancel</Button>
              </div>
            </div>
          </form>
        </Panel>
      )} />
    </Screen>
  );
}
