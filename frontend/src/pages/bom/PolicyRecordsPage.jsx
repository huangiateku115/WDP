import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Select, Details, Button,
} from "@/components/manager/ManagerUI";
import { BomUnavailable } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import RuleEffectBadge from "@/components/bom/RuleEffectBadge";
import { bomPolicyApi } from "@/api/bomApi";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName, fetchPaged } from "@/lib/bomApiData";
import { responseData, categoryFromDto } from "@/lib/bomMappers";

// Item categories are the only policy screen kept in the BOM/Admin console. The effective
// CATEGORY policy really blocks inbound items (inventory-items/assertCategoryPolicyDecision),
// which is why it stays visible even though the backend only exposes read endpoints here.
// Every other policy type (deposit, cancellation, refund, overdue, shelf constraint, promotional
// and loyalty discounts) was removed from the console: no policy changes a reservation amount
// today. See backend/docs/POLICY_PRICING_DISCOUNT_BE_SPEC.md.
const TITLE = "Danh mục hàng hóa";
const loadRecords = (signal) => fetchPaged(bomPolicyApi.list, { type: "CATEGORY" }, { signal });

export default function PolicyRecordsPage({ mode = "list", basePath = "/bom" }) {
  const root = `${basePath}/policies/item-categories`;
  if (mode === "detail") return <RecordDetail root={root} />;
  return <RecordList root={root} />;
}

function RecordList({ root }) {
  const state = useAsyncData(({ signal }) => Promise.all([loadRecords(signal), loadFacilities()]), [root]);
  const [status, setStatus] = useState("");

  return (
    <Screen title={TITLE} description="Chính sách danh mục hàng hóa lưu trữ.">
      <Panel title="Bộ lọc">
        <div className="manager-filters">
          <Select label="Lọc theo trạng thái" value={status} onChange={setStatus} options={[["", "Tất cả trạng thái"], "ACTIVE", "INACTIVE"]} />
        </div>
      </Panel>
      <AsyncBoundary state={state} render={([recordPage, facilities]) => {
        const rows = recordPage.rows.map(categoryFromDto).filter((row) => !status || row.status === status);
        return <Panel title={TITLE} subtitle={`${rows.length} / ${recordPage.rows.length} bản ghi`}>
          {recordPage.truncated && <TruncatedNotice total={recordPage.total} shown={recordPage.rows.length} />}
          <Table label={TITLE} rows={rows} columns={[
            { key: "name", label: "Danh mục", render: (r) => <OpenLink to={`${root}/${r.id}`}>{r.name}</OpenLink> },
            // The CATEGORY policy exposes only the allowed/blocked lists; there is no acceptance flag.
            { key: "allowedCount", label: "Danh mục được phép", render: (r) => r.allowedCount },
            { key: "blockedCount", label: "Danh mục bị chặn", render: (r) => r.blockedCount },
            { key: "facility", label: "Cơ sở", render: (r) => facilityName(facilities, r.facilityId) },
            { key: "effectiveFrom", label: "Hiệu lực từ" },
            { key: "phase", label: "Hiệu lực", render: (r) => <RuleEffectBadge record={r} /> },
            { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
            { key: "revision", label: "Phiên bản" },
          ]} />
        </Panel>;
      }} />
    </Screen>
  );
}

function RecordDetail({ root }) {
  const { id } = useParams();
  const state = useAsyncData(() => bomPolicyApi.get(id).then(responseData).then(categoryFromDto), [id]);
  if (!state.loading && state.error && /not found|unavailable|404/i.test(state.error)) return <BomUnavailable />;
  return <Screen title="Chi tiết chính sách" description={TITLE}
    action={<Button asChild variant="outline"><Link to={root}>Quay lại danh sách</Link></Button>}>
    <AsyncBoundary state={state} render={(record) => <Panel title="Chính sách hiện tại">
      {/* The CATEGORY policy only carries the two category lists; the DTO has no description,
          handling note, restriction or acceptance flag, so those rows are not rendered. */}
      <Details values={[
        ["Danh mục", record.name], ["Danh mục được phép", record.allowedCount], ["Danh mục bị chặn", record.blockedCount],
        ["Hiệu lực từ", record.effectiveFrom],
        ["Hiệu lực đến", record.hasEffectiveTo ? (record.effectiveTo || "Không thời hạn") : "—"],
        ["Hiệu lực", <RuleEffectBadge record={record} />], ["Trạng thái", <Status value={record.status} />], ["Phiên bản", record.revision],
      ]} />
    </Panel>} />
  </Screen>;
}
