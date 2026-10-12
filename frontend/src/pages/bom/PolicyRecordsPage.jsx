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
  BOM_SERVICE_TYPES, BOM_DISCOUNT_KINDS, BOM_DISCOUNT_VALUE_TYPES, BOM_DISCOUNT_TYPES, BOM_CATEGORY_STATUS,
  bomFutureDate, responseData,
  discountFromDto, discountValueLabel, discountBody,
  categoryFromDto, categoryBody,
} from "@/lib/bomMappers";

// Live Discounts/Waivers and Item-category policies, backed by the confirmed /policies API
// (backend PolicyType DISCOUNT / WAIVER / CATEGORY).

const blankDiscount = () => ({
  facilityId: "", service: "", kind: "PROMOTIONAL", name: "", valueType: "UNDEFINED", value: "",
  conditions: "", effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});
const blankCategory = () => ({
  facilityId: "", service: "", name: "", description: "", allowedStatus: "ALLOWED",
  handlingNotes: "", restrictions: "", effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});

const CONFIGS = {
  discount: {
    root: "/bom/policies/discounts", title: "Discounts and waivers", single: "discount policy",
    policyTypes: BOM_DISCOUNT_TYPES, listParams: {},
    fromDto: discountFromDto, body: discountBody, blank: blankDiscount,
  },
  category: {
    root: "/bom/policies/item-categories", title: "Item categories", single: "item category",
    policyTypes: ["CATEGORY"], listParams: { type: "CATEGORY" },
    fromDto: categoryFromDto, body: categoryBody, blank: blankCategory,
  },
};

// Bounded server-paged fetch. Category rows are filtered by the backend; discounts are narrowed by type.
const loadRecords = (config, signal) =>
  fetchPaged(bomPolicyApi.list, config.listParams, { signal })
    .then((page) => ({ ...page, rows: page.rows.filter((row) => config.policyTypes.includes(row.type)) }));

export default function PolicyRecordsPage({ kind, mode = "list" }) {
  const config = CONFIGS[kind];
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
  const typeFilter = kind === "discount"
    ? [["", "All discount kinds"], ...BOM_DISCOUNT_KINDS.map((k) => [k, k.replaceAll("_", " ")])]
    : [["", "All acceptance policies"], ...BOM_CATEGORY_STATUS];

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
          <Select label="Type filter" value={filter} onChange={setFilter} options={typeFilter} />
        </div>
      </Panel>
      <AsyncBoundary state={state} render={([recordPage, facilities]) => {
        const records = recordPage.rows;
        const rows = records.map(config.fromDto).filter((row) =>
          (!status || row.status === status) &&
          (!filter || (kind === "discount" ? row.kind === filter : row.allowedStatus === filter)));
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
                { key: "name", label: "Category", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{r.name}</OpenLink> },
                { key: "acceptance", label: "Acceptance", render: (r) => <Status value={r.allowedStatus} /> },
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
                ["Category", record.name],
                ["Acceptance", <Status value={record.allowedStatus} />],
                ["Description", record.description],
                ["Handling notes", record.handlingNotes],
                ["Restrictions", record.restrictions],
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

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const body = config.body(form);
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
              <Select label="Facility scope" value={form.facilityId} onChange={(v) => change("facilityId", v)}
                options={[["", "Select a facility"], ...facilities.map((f) => [f.id, f.name])]} />
            </Field>
            <Field label="Service model (optional)">
              <Select label="Service model" value={form.service} onChange={(v) => change("service", v)}
                options={[["", "Any service"], ...BOM_SERVICE_TYPES]} />
            </Field>

            {kind === "discount" && (
              <>
                <Field label="Discount kind">
                  <Select label="Discount kind" value={form.kind} onChange={(v) => change("kind", v)}
                    options={BOM_DISCOUNT_KINDS.map((k) => [k, k.replaceAll("_", " ")])} />
                </Field>
                <Field label="Discount name"><Input aria-label="Discount name" required value={form.name} onChange={(e) => change("name", e.target.value)} /></Field>
                <Field label="Value type">
                  <Select label="Value type" value={form.valueType} onChange={(v) => change("valueType", v)}
                    options={BOM_DISCOUNT_VALUE_TYPES.map((t) => [t, t.replaceAll("_", " ")])} />
                </Field>
                {form.valueType !== "UNDEFINED" && (
                  <Field label={form.valueType === "PERCENTAGE" ? "Percentage (0-100)" : "Fixed amount (VND)"}>
                    <Input aria-label="Discount value" type="number" min="0" step="any" required
                      value={form.value} onChange={(e) => change("value", e.target.value)} />
                  </Field>
                )}
                <div className="bom-wide"><Field label="Conditions"><Textarea aria-label="Conditions" required value={form.conditions} onChange={(e) => change("conditions", e.target.value)} /></Field></div>
              </>
            )}

            {kind === "category" && (
              <>
                <Field label="Category name"><Input aria-label="Category name" required value={form.name} onChange={(e) => change("name", e.target.value)} /></Field>
                <Field label="Acceptance">
                  <Select label="Acceptance" value={form.allowedStatus} onChange={(v) => change("allowedStatus", v)} options={BOM_CATEGORY_STATUS} />
                </Field>
                <div className="bom-wide"><Field label="Description"><Textarea aria-label="Description" required value={form.description} onChange={(e) => change("description", e.target.value)} /></Field></div>
                <div className="bom-wide"><Field label="Handling notes"><Textarea aria-label="Handling notes" required value={form.handlingNotes} onChange={(e) => change("handlingNotes", e.target.value)} /></Field></div>
                <div className="bom-wide"><Field label="Restrictions"><Textarea aria-label="Restrictions" required value={form.restrictions} onChange={(e) => change("restrictions", e.target.value)} /></Field></div>
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
