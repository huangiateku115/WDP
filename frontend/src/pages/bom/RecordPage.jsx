import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Details, Button, money,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, ConfirmDialog, PendingAction } from "@/components/bom/LiveBomUI";
import RuleEffectBadge from "@/components/bom/RuleEffectBadge";
import ListPager from "@/components/bom/ListPager";
import { bomPricingApi, bomPolicyApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import { POLICY_WRITE_REASON, bomCapability } from "@/lib/bomCapabilities";
import { useAsyncData } from "@/lib/useAsyncData";
import { usePageIndex } from "@/lib/usePageIndex";
import { loadFacilities, facilityName, fetchPaged } from "@/lib/bomApiData";
import {
  BOM_SERVICE_TYPES, BOM_UNIT_SIZES, BOM_TERM_MONTHS, BOM_CURRENCY, BOM_POLICY_TYPES, BOM_POLICY_FORM_TYPES,
  POLICY_DESCRIPTION_TYPES,
  bomFutureDate, isEffectiveRecord, responseData, serviceLabel,
  pricingFromDto, pricingLabel, pricingBody, pricingUpdateBody,
  policyFromDto, policyBlank, policyBody, policyCloseBody,
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
    fromDto: policyFromDto, blank: policyBlank, body: policyBody, hasService: true,
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

// Server-side query understood by the rule list (rule.validation.ts): isActive, type and serviceType.
// Keeping the filters in the query is what allows the table to page without lying about totals.
const recordQuery = (kind, { status, type, service }) => {
  const params = {};
  if (status) params.isActive = status === "ACTIVE" ? "true" : "false";
  if (kind === "policy" && type) params.type = type;
  if (kind === "pricing" && service) params.serviceType = service;
  return params;
};

export default function RecordPage({ kind, mode = "list", basePath = "/bom" }) {
  const config = configFor(kind, basePath);
  if (!config) return <BomUnavailable />;
  // A business policy never rewrites its config: `edit` is refused for good, and `new` stays
  // refused until the backend accepts POST /policies (lib/bomCapabilities.policyWrite).
  if (kind === "policy" && mode === "edit") return <BomUnavailable />;
  if (kind === "policy" && mode === "new" && !bomCapability("policyWrite")) return <BomUnavailable />;
  if (mode === "new") return <RecordForm kind={kind} config={config} mode="new" />;
  if (mode === "edit") return <RecordForm kind={kind} config={config} mode="edit" />;
  if (mode === "detail") return <RecordDetail kind={kind} config={config} />;
  return <RecordList kind={kind} config={config} />;
}

function RecordList({ kind, config }) {
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [service, setService] = useState("");
  // Filters are applied by the API, so a page only ships that page's rows.
  const [page, setPage] = usePageIndex(`${kind}|${status}|${type}|${service}`);
  const state = useAsyncData(
    ({ signal }) => Promise.all([
      fetchPaged(config.api.list, recordQuery(kind, { status, type, service }), { signal, page }),
      loadFacilities(),
    ]),
    [kind, status, type, service, page],
  );

  return (
    <Screen
      title={config.title}
      description={kind === "pricing"
        ? "Giá kho riêng và đơn giá công suất lưu trữ theo từng thời gian hiệu lực."
        : "Chính sách kinh doanh theo từng loại chính sách."}
      action={kind === "pricing" ? <Button asChild variant="orange"><Link to={`${config.root}/new`}>Tạo quy tắc giá</Link></Button> : (
        // A business policy is created through POST /policies, which the backend still rejects;
        // the control keeps its final shape and explains the state instead of hiding the feature.
        bomCapability("policyWrite")
          ? <Button asChild variant="orange"><Link to={`${config.root}/new`}>Tạo chính sách</Link></Button>
          : <PendingAction label="Tạo chính sách" reason={POLICY_WRITE_REASON} />
      )}
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
        const rows = recordPage.rows.map(config.fromDto);
        return (
          <Panel title={config.title} subtitle={`${recordPage.total} bản ghi`}>
            <Table
              label={config.title}
              rows={rows}
              columns={kind === "pricing" ? [
                { key: "scope", label: "Phạm vi", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{pricingLabel(r)}</OpenLink> },
                { key: "service", label: "Dịch vụ", render: (r) => serviceLabel(r.service) },
                { key: "facility", label: "Cơ sở", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "rate", label: "Đơn giá", render: (r) => `${money(r.rate)} ${r.currency}` },
                { key: "effectiveFrom", label: "Hiệu lực từ" },
                { key: "phase", label: "Hiệu lực", render: (r) => <RuleEffectBadge record={r} /> },
                { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Phiên bản" },
              ] : [
                { key: "name", label: "Chính sách", render: (r) => <OpenLink to={`${config.root}/${r.id}`}>{r.name}</OpenLink> },
                { key: "facility", label: "Cơ sở", render: (r) => facilityName(facilities, r.facilityId) },
                { key: "rule", label: "Quy tắc" },
                { key: "effectiveFrom", label: "Hiệu lực từ" },
                { key: "phase", label: "Hiệu lực", render: (r) => <RuleEffectBadge record={r} /> },
                { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
                { key: "revision", label: "Phiên bản" },
              ]}
            />
            <ListPager
              page={recordPage.pagination?.page ?? page}
              totalPages={recordPage.pagination?.totalPages ?? 1}
              total={recordPage.total}
              loading={state.loading}
              onPageChange={setPage}
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
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeDate, setCloseDate] = useState(bomFutureDate(1));

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
                ["Hiệu lực đến", record.hasEffectiveTo ? (record.effectiveTo || "Không thời hạn") : "—"],
                ["Hiệu lực", <RuleEffectBadge record={record} />],
                ["Trạng thái", <Status value={record.status} />],
                ["Phiên bản", record.revision],
              ] : [
                ["Chính sách", record.name],
                ["Loại chính sách", record.type],
                ["Dịch vụ", record.service ? serviceLabel(record.service) : "Mọi loại"],
                ["Mô tả", record.description],
                ["Quy tắc", record.rule || "—"],
                ["Hiệu lực từ", record.effectiveFrom],
                ["Hiệu lực đến", record.hasEffectiveTo ? (record.effectiveTo || "Không thời hạn") : "—"],
                ["Hiệu lực", <RuleEffectBadge record={record} />],
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
              {kind === "policy" && (
                bomCapability("policyWrite")
                  ? <div className="mt-5"><Button variant="orange" onClick={() => setCloseOpen(true)}>Đóng từ ngày…</Button></div>
                  // Closing a policy needs PATCH /policies/:id/close with an effectiveTo; until the
                  // backend accepts it the control keeps its final shape and stays inert.
                  : <div className="mt-5"><PendingAction label="Đóng từ ngày…" reason={POLICY_WRITE_REASON} /></div>
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
            {kind === "policy" && closeOpen && (
              <ConfirmDialog
                title="Đóng chính sách"
                confirmLabel="Đóng chính sách"
                onClose={() => setCloseOpen(false)}
                onConfirm={async () => {
                  await bomPolicyApi.close(id, policyCloseBody({ effectiveTo: closeDate }));
                  state.reload();
                }}
              >
                <Field label="Đóng từ ngày" hint="Phải sau hôm nay và sau ngày bắt đầu hiệu lực.">
                  <Input aria-label="Đóng từ ngày" type="date" min={bomFutureDate(1)} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
                </Field>
                <p className="mt-3 text-sm text-slate-500">
                  Chính sách sẽ ngừng áp dụng từ ngày này. Nội dung chính sách không thay đổi.
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
              {!isEdit && kind === "policy" && (
                <Field label="Loại chính sách">
                  <Select
                    label="Loại chính sách"
                    value={form.type}
                    onChange={(v) => {
                      change("type", v);
                      // The category policy only exists for Managed Inventory.
                      if (v === "CATEGORY") change("service", "MANAGED_INVENTORY");
                    }}
                    options={BOM_POLICY_FORM_TYPES.map(({ key, label }) => [key, label])}
                  />
                </Field>
              )}
              {kind === "policy" && form.type === "DEPOSIT" && form.service === "SELF_STORAGE" && (
                <>
                  <Field label="Số tiền đặt cọc (VND)">
                    <Input aria-label="Số tiền đặt cọc (VND)" type="number" min="0" step="any" value={form.amount} onChange={(e) => change("amount", e.target.value)} />
                  </Field>
                  <Field label="Tiền tệ">
                    <Input aria-label="Tiền tệ đặt cọc" maxLength={3} value={form.currency} onChange={(e) => change("currency", e.target.value.toUpperCase())} />
                  </Field>
                </>
              )}
              {kind === "policy" && form.type === "DEPOSIT" && form.service === "MANAGED_INVENTORY" && (
                <Field label="Tỷ lệ đặt cọc (% tiền thuê)">
                  <Input aria-label="Tỷ lệ đặt cọc (% tiền thuê)" type="number" min="0" step="any" value={form.percentage} onChange={(e) => change("percentage", e.target.value)} />
                </Field>
              )}
              {kind === "policy" && form.type === "CATEGORY" && (
                <>
                  <Field label="Danh mục được phép" hint="Cách nhau bằng dấu phẩy, ít nhất một danh mục.">
                    <Input aria-label="Danh mục được phép" value={form.allowedCategories} onChange={(e) => change("allowedCategories", e.target.value)} />
                  </Field>
                  <Field label="Danh mục bị chặn" hint="Có thể để trống.">
                    <Input aria-label="Danh mục bị chặn" value={form.blockedCategories} onChange={(e) => change("blockedCategories", e.target.value)} />
                  </Field>
                </>
              )}
              {kind === "policy" && POLICY_DESCRIPTION_TYPES.includes(form.type) && (
                <Field label="Nội dung chính sách" hint="Loại chính sách này hiện dùng để ghi nhận nội dung.">
                  <Input aria-label="Nội dung chính sách" value={form.description} onChange={(e) => change("description", e.target.value)} />
                </Field>
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
                  <Button type="submit" variant="orange" disabled={pending}>{pending ? "Đang lưu…" : isEdit ? "Lưu giá mới" : kind === "pricing" ? "Tạo quy tắc" : "Tạo chính sách"}</Button>
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
