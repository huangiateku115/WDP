import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Details, Button, money,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { bomPricingApi, bomPolicyApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName, fetchPaged } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, BOM_UNIT_SIZES, BOM_TERM_MONTHS, BOM_CURRENCY, BOM_POLICY_TYPES,
  bomFutureDate, isEffectiveRecord, responseData, serviceLabel,
  pricingFromDto, pricingLabel, pricingBody, pricingUpdateBody,
  policyFromDto,
} from "@/lib/bomMappers";

const blankPricing = () => ({
  facilityId: "", service: "SELF_STORAGE", unitSize: "SMALL", billingMonths: 1,
  rate: "", currency: BOM_CURRENCY, effectiveFrom: bomFutureDate(1), effectiveTo: "", status: "INACTIVE",
});
const CONFIGS = {
  pricing: {
    api: bomPricingApi, root: "/bom/pricing", title: "Bảng giá", code: "P051",
    fromDto: pricingFromDto, body: pricingBody, updateBody: pricingUpdateBody,
    blank: blankPricing, hasService: true,
  },
  policy: {
    api: bomPolicyApi, root: "/bom/policies", title: "Chính sách kinh doanh", code: "P052",
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
  // Business policies are system-controlled: even if a route exposes new/edit later, the page
  // refuses to render a write form, so the console can never POST a policy.
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
        ? "Giá kho riêng và đơn giá công suất lưu trữ theo từng thời gian hiệu lực."
        : "Chính sách kinh doanh theo từng loại chính sách."}
      action={kind === "pricing"
        ? <Button asChild variant="orange"><Link to={`${config.root}/new`}>Tạo quy tắc giá</Link></Button>
        : undefined}
    >
      <Panel title="Bộ lọc">
        <div className="manager-filters">
          <Select label="Lọc theo trạng thái" value={status} onChange={setStatus} options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
          {kind === "policy" && (
            <Select label="Lọc theo loại chính sách" value={type} onChange={setType}
              options={[["", "Tất cả loại chính sách"], ...BOM_POLICY_TYPES.map(({ key, label }) => [key, label])]} />
          )}
          {kind === "pricing" && (
            <Select label="Lọc theo dịch vụ" value={service} onChange={setService}
              options={[["", "Cả hai dịch vụ"], ...BOM_SERVICE_TYPES.map((s) => [s, serviceLabel(s)])]} />
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
          <Panel title={config.title} subtitle={`${rows.length} / ${records.length} bản ghi`}>
            {recordPage.truncated && <TruncatedNotice total={recordPage.total} shown={records.length} />}
            <Table
              label={config.title}
              rows={rows}
              columns={kind === "pricing" ? [
                { key: "scope", label: "Phạm vi", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{pricingLabel(r)}</OpenLink> },
                { key: "service", label: "Dịch vụ", render: (r) => serviceLabel(r.service) },
                { key: "facility", label: "Cơ sở", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "rate", label: "Đơn giá", render: (r) => `${money(r.rate)} ${r.currency}` },
                { key: "effectiveFrom", label: "Hiệu lực từ" },
                { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Phiên bản" },
              ] : [
                { key: "name", label: "Chính sách", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{r.name}</OpenLink> },
                { key: "facility", label: "Cơ sở", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "rule", label: "Quy tắc" },
                { key: "effectiveFrom", label: "Hiệu lực từ" },
                { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Phiên bản" },
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
      title="Chi tiết bản ghi"
      description={config.title}
      action={<Button asChild variant="outline"><Link to={config.root}>Quay lại danh sách</Link></Button>}
    >
      <AsyncBoundary state={state} render={(record) => {
        const nextStatus = record.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
        const futurePricing = kind === "pricing" && record.effectiveFrom && new Date(record.effectiveFrom) > new Date();
        // The API rejects status changes once a rule is effective; only a new price revision is accepted.
        const effectiveRule = kind === "pricing" && isEffectiveRecord(record);
        return (
          <>
            <Panel
              title={kind === "pricing" ? futurePricing ? "Quy tắc giá đã lên lịch" : "Quy tắc giá đang hiệu lực" : "Chính sách hiện tại"}
              action={kind === "pricing" ? <Button asChild variant="outline"><Link to={`${config.root}/${id}/edit`}>Sửa</Link></Button> : undefined}
            >
              <Details values={kind === "pricing" ? [
                ["Phạm vi", pricingLabel(record)],
                ["Dịch vụ", serviceLabel(record.service)],
                ["Kích cỡ kho riêng", record.unitSize || "—"],
                ["Kỳ tính phí", `${record.billingMonths} tháng`],
                ["Đơn giá", `${money(record.rate)} ${record.currency}`],
                ["Hiệu lực từ", record.effectiveFrom],
                ["Hiệu lực đến", record.effectiveTo || "Không thời hạn"],
                ["Trạng thái", <Status value={record.status} />],
                ["Phiên bản", record.revision],
              ] : [
                ["Chính sách", record.name],
                ["Loại chính sách", record.type],
                ["Dịch vụ", record.service ? serviceLabel(record.service) : "Mọi loại"],
                ["Mô tả", record.description],
                ["Quy tắc", record.rule],
                ["Hiệu lực từ", record.effectiveFrom],
                ["Hiệu lực đến", record.effectiveTo || "Không thời hạn"],
                ["Trạng thái", <Status value={record.status} />],
                ["Phiên bản", record.revision],
              ]} />
              {futurePricing && <p className="mt-4 text-sm text-slate-600">Bắt đầu áp dụng từ {record.effectiveFrom}.</p>}
              {kind === "pricing" && !effectiveRule && <div className="mt-5">
                <Button variant="orange" onClick={() => setConfirmOpen(true)}>
                  {nextStatus === "ACTIVE" ? "Kích hoạt" : "Ngừng áp dụng"}
                </Button>
              </div>}
              {effectiveRule && record.status === "ACTIVE" && (
                <p className="mt-4 text-sm text-slate-600">
                  Quy tắc đã có hiệu lực nên không thể ngừng áp dụng. Hãy hẹn mức giá mới bằng nút Sửa.
                </p>
              )}
            </Panel>
            {kind === "pricing" && record.service === "MANAGED_INVENTORY" && (
              <Panel title="Ước tính theo công suất">
                <Field label="Công suất dự kiến (m³)">
                  <Input aria-label="Công suất dự kiến (m³)" type="number" min="0.01" step="any" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                </Field>
                <p className="mt-5 text-xl font-bold">
                  {Number(capacity) > 0 && Number.isFinite(Number(capacity))
                    ? `${money(Number(capacity) * record.rate)} ${record.currency}`
                    : "Nhập công suất lớn hơn 0"}{" "}
                  / kỳ {record.billingMonths} tháng
                </p>
              </Panel>
            )}
            {confirmOpen && (
              <ConfirmDialog
                title="Xác nhận đổi trạng thái"
                confirmLabel={`Chuyển sang ${nextStatus}`}
                onClose={() => setConfirmOpen(false)}
                onConfirm={async () => {
                  await config.api.setActive(id, nextStatus === "ACTIVE");
                  state.reload();
                }}
              >
                <p className="text-sm text-slate-500">
                  Quy tắc sẽ được chuyển sang trạng thái <b>{nextStatus}</b>.
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
  // An already-effective rule accepts one edit only: a new price revision starting on a future date.
  const locked = isEdit && isEffectiveRecord(form);

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
  const lockNotice = locked
    ? "Quy tắc đã có hiệu lực nên giá hiện tại không sửa được. Lưu biểu mẫu này sẽ tạo mức giá mới bắt đầu từ ngày bạn chọn trong tương lai."
    : "";

  return (
    <Screen
      title={`${isEdit ? "Sửa" : "Tạo"} ${kind === "pricing" ? "bảng giá" : "chính sách"}`}
      description={isEdit
        ? "Đặt ngày bắt đầu áp dụng giá mới."
        : "Ngày hiệu lực phải ở tương lai."}
    >
      <AsyncBoundary
        state={state}
        render={([, facilities = []]) => (
          <Panel title="Biểu mẫu">
            {locked && <p className="bom-warning mb-5">{lockNotice}</p>}
            <form className="bom-form" onSubmit={submit}>
              {!isEdit && <Field label="Phạm vi cơ sở">
                <Select
                  label="Phạm vi cơ sở"
                  value={form.facilityId}
                  disabled={locked}
                  onChange={(v) => change("facilityId", v)}
                  options={[["", "Chọn cơ sở"], ...facilities.map((f) => [f.id, f.name])]}
                />
              </Field>}
              {!isEdit && config.hasService && (
                <Field label="Mô hình dịch vụ">
                  <Select label="Mô hình dịch vụ" value={form.service} disabled={locked} onChange={(v) => change("service", v)} options={BOM_SERVICE_TYPES.map((s) => [s, serviceLabel(s)])} />
                </Field>
              )}
              {!isEdit && kind === "pricing" && form.service === "SELF_STORAGE" && (
                <Field label="Kích cỡ kho riêng">
                  <Select label="Kích cỡ kho riêng" value={form.unitSize} disabled={locked} onChange={(v) => change("unitSize", v)} options={BOM_UNIT_SIZES} />
                </Field>
              )}
              {kind === "pricing" && (
                <>
                  {!isEdit && <Field label="Kỳ thanh toán (tháng)">
                    <Select label="Kỳ thanh toán (tháng)" value={form.billingMonths} onChange={(v) => change("billingMonths", Number(v))}
                      options={BOM_TERM_MONTHS.map((m) => [m, `${m} tháng`])} />
                  </Field>}
                  <Field label={form.service === "MANAGED_INVENTORY" ? "Đơn giá mỗi m³ mỗi kỳ (VND)" : "Giá mỗi kỳ thanh toán (VND)"}>
                    <Input aria-label="Đơn giá" type="number" min="0" step="any" required value={form.rate} onChange={(e) => change("rate", e.target.value)} />
                  </Field>
                  <Field label="Tiền tệ">
                    <Input aria-label="Tiền tệ" maxLength={3} value={form.currency} onChange={(e) => change("currency", e.target.value.toUpperCase())} />
                  </Field>
                </>
              )}
              <Field label="Hiệu lực từ" hint={locked ? "Bắt buộc chọn ngày trong tương lai — đây là ngày bắt đầu của mức giá mới." : `Chọn từ ${minDate} trở đi.`}>
                <Input aria-label="Hiệu lực từ" type="date" min={minDate} required value={form.effectiveFrom} onChange={(e) => change("effectiveFrom", e.target.value)} />
              </Field>
              <Field label="Hiệu lực đến (không bắt buộc)" hint={locked ? "Nếu nhập, phải sau ngày bắt đầu của mức giá mới." : undefined}>
                <Input aria-label="Hiệu lực đến" type="date" min={form.effectiveFrom || minDate} value={form.effectiveTo} onChange={(e) => change("effectiveTo", e.target.value)} />
              </Field>
              {!isEdit && <Field label="Trạng thái">
                <Select label="Trạng thái" value={form.status} onChange={(v) => change("status", v)} options={["INACTIVE", "ACTIVE"]} />
              </Field>}
              <div className="bom-wide">
                {error && <p role="alert" className="bom-error">{error}</p>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : isEdit ? "Lưu giá mới" : "Tạo quy tắc"}</Button>
                  <Button type="button" variant="outline" onClick={() => nav(config.root)}>Hủy</Button>
                </div>
              </div>
            </form>
          </Panel>
        )}
      />
    </Screen>
  );
}
