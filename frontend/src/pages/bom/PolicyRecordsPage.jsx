import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Select, Details, Button,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { bomPolicyApi } from "@/api/bomApi";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName, fetchPaged } from "@/lib/bomApiData";
import {
  BOM_DISCOUNT_KINDS, BOM_DISCOUNT_TYPES,
  responseData, discountFromDto, discountValueLabel, categoryFromDto,
} from "@/lib/bomMappers";

// Policy records remain visible for operational readers and history, but are system-controlled.
const CONFIGS = {
  discount: {
    title: "Giảm giá và miễn giảm", policyTypes: BOM_DISCOUNT_TYPES, listParams: {}, fromDto: discountFromDto,
  },
  category: {
    title: "Danh mục hàng hóa", policyTypes: ["CATEGORY"], listParams: { type: "CATEGORY" }, fromDto: categoryFromDto,
  },
};
const CONFIG_ROOTS = { discount: "/policies/discounts", category: "/policies/item-categories" };
const configCache = new Map();
function configFor(kind, basePath) {
  if (!CONFIGS[kind]) return null;
  const key = `${kind}:${basePath}`;
  if (!configCache.has(key)) configCache.set(key, { ...CONFIGS[kind], root: `${basePath}${CONFIG_ROOTS[kind]}` });
  return configCache.get(key);
}
const loadRecords = (config, signal) => fetchPaged(bomPolicyApi.list, config.listParams, { signal })
  .then((page) => ({ ...page, rows: page.rows.filter((row) => config.policyTypes.includes(row.type)) }));

export default function PolicyRecordsPage({ kind, mode = "list", basePath = "/bom" }) {
  const config = configFor(kind, basePath);
  if (!config) return <BomUnavailable />;
  if (mode === "detail") return <RecordDetail kind={kind} config={config} />;
  return <RecordList kind={kind} config={config} />;
}

function RecordList({ kind, config }) {
  const state = useAsyncData(({ signal }) => Promise.all([loadRecords(config, signal), loadFacilities()]), [kind]);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");
  // Discounts are narrowed by kind client-side; CATEGORY policies only need the status filter.
  const typeFilter = kind === "discount"
    ? [["", "Tất cả hình thức giảm giá"], ...BOM_DISCOUNT_KINDS.map((k) => [k, BOM_DISCOUNT_KIND_LABELS[k] || k])]
    : null;

  return (
    <Screen title={config.title}
      description={kind === "discount"
        ? "Chính sách khuyến mại, khách hàng thân thiết và miễn phụ phí."
        : "Chính sách danh mục hàng hóa lưu trữ."}>
      <Panel title="Bộ lọc">
        <div className="manager-filters">
          <Select label="Lọc theo trạng thái" value={status} onChange={setStatus} options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
          {typeFilter && <Select label="Lọc theo hình thức" value={filter} onChange={setFilter} options={typeFilter} />}
        </div>
      </Panel>
      <AsyncBoundary state={state} render={([recordPage, facilities]) => {
        const rows = recordPage.rows.map(config.fromDto).filter((row) =>
          (!status || row.status === status) &&
          (!filter || (kind === "discount" ? row.kind === filter : row.allowedStatus === filter)));
        return <Panel title={config.title} subtitle={`${rows.length} / ${recordPage.rows.length} bản ghi`}>
          {recordPage.truncated && <TruncatedNotice total={recordPage.total} shown={recordPage.rows.length} />}
          <Table label={config.title} rows={rows} columns={kind === "discount" ? [
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
          ]} />
        </Panel>;
      }} />
    </Screen>
  );
}

function RecordDetail({ kind, config }) {
  const { id } = useParams();
  const state = useAsyncData(() => bomPolicyApi.get(id).then(responseData).then(config.fromDto), [id, kind]);
  if (!state.loading && state.error && /not found|unavailable|404/i.test(state.error)) return <BomUnavailable />;
  return <Screen title="Chi tiết chính sách" description={config.title}
    action={<Button asChild variant="outline"><Link to={config.root}>Quay lại danh sách</Link></Button>}>
    <AsyncBoundary state={state} render={(record) => <Panel title="Chính sách hiện tại">
      <Details values={kind === "discount" ? [
        ["Discount", record.name], ["Kind", record.kind.replaceAll("_", " ")], ["Policy type", record.policyType],
        ["Value", discountValueLabel(record)], ["Conditions", record.conditions], ["Effective from", record.effectiveFrom],
        ["Effective end", record.effectiveTo || "Không thời hạn"], ["Status", <Status value={record.status} />], ["Version", record.revision],
      ] : [
        ["Category", record.name], ["Acceptance", <Status value={record.allowedStatus} />], ["Description", record.description],
        ["Handling notes", record.handlingNotes], ["Restrictions", record.restrictions], ["Effective from", record.effectiveFrom],
        ["Effective end", record.effectiveTo || "Không thời hạn"], ["Status", <Status value={record.status} />], ["Version", record.revision],
      ]} />
    </Panel>} />
  </Screen>;
}
