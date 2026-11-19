import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Select, Input, Button, Details, Timeline,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import ListPager from "@/components/bom/ListPager";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { usePageIndex } from "@/lib/usePageIndex";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { loadFacilities, loadInventoryItem, loadInventoryItems, loadItemMovements } from "@/lib/bomApiData";
import customerProfileApi from "@/api/customerProfileApi";
import { facilityLabel } from "@/lib/facilityLabels";
import { formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Managed Inventory console shared by BOM and Admin.
// Backend contract (inventory-item.routes.ts): GET /inventory-items is readable by
// ADMIN/BOM/FM/STAFF and accepts facilityId, customerId, category, status, search + paging;
// without facilityId ADMIN/BOM receive every facility. GET /inventory-items/:id returns the
// item, GET /inventory-items/:id/movements the immutable inbound ledger.
// Physical inbound (request/confirm/reject) is FACILITY_STAFF-only, so this console is
// read-only by design: it reports what Staff confirmed rather than performing it.
const ITEM_STATUSES = ["REGISTERED", "PENDING_INBOUND", "RECEIVED_PENDING_ACCEPTANCE", "IN_STORAGE", "PENDING_OUTBOUND", "CHECKED_OUT"];
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const stamp = (value) => (value ? new Date(value).toLocaleString("en-GB") : "—");
const filtered = (conditions) => Object.fromEntries(Object.entries(conditions).filter(([, value]) => value));

export default function InventoryItemsPage({ basePath = "/admin/inventory" }) {
  const { id } = useParams();
  if (id) return <ItemDetail key={id} id={id} basePath={basePath} />;
  return <ItemList basePath={basePath} />;
}

function ItemList({ basePath }) {
  const directory = useAsyncData(loadFacilities, []);
  const profiles = useAsyncData(({ signal }) => customerProfileApi.list({ signal }).then((r) => r?.data?.data ?? []).catch(() => []), []);
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  // Both text inputs reach the API, so they are debounced (quy ước 2).
  const debouncedCategory = useDebouncedValue(category);
  const debouncedSearch = useDebouncedValue(search);
  // GET /inventory-items accepts page/limit and applies the filters in the database, so the list
  // pages server-side instead of stopping at the first 300 rows.
  const [page, setPage] = usePageIndex(`${facilityId}|${status}|${debouncedCategory}|${debouncedSearch}`);

  const items = useAsyncData(
    ({ signal }) => loadInventoryItems(filtered({ facilityId, status, category: debouncedCategory.trim(), search: debouncedSearch.trim() }), { signal, page }),
    [facilityId, status, debouncedCategory, debouncedSearch, page],
  );

  const facilities = directory.data || [];
  const nameOfFacility = (id) => facilities.find((f) => f.id === id)?.name || (id ? `${String(id).slice(0, 8)}…` : "—");
  const customers = new Map((profiles.data || []).map((p) => [String(p.userId?._id || p.userId || ""), p.userId?.email || p.userId?.fullName || p._id]));
  const owner = (customerId) => customers.get(String(customerId)) || (customerId ? `${String(customerId).slice(0, 8)}…` : "—");
  const rows = items.data?.rows || [];

  return (
    <Screen
      title="Hàng hóa và tồn kho"
      description="Các lô hàng khách đã đăng ký và trạng thái xếp ô."
      action={<Button variant="outline" disabled={items.loading} onClick={items.reload}>Tải lại</Button>}
    >
      <AsyncBoundary state={directory} render={() => (
        <>
          <Kpis items={[
            ["Lô hàng", items.data?.total ?? "—", facilityId ? "Trong cơ sở đã chọn" : "Trên mọi cơ sở"],
            ["Trong kho", rows.filter((r) => r.status === "IN_STORAGE").length, "Đã xếp vào ô · trang này"],
            ["Chờ nhập kho", rows.filter((r) => r.status === "PENDING_INBOUND").length, "Chờ nhân viên xác nhận · trang này"],
            ["Thể tích đang lưu", m3(sumBy(rows, "totalVolumeM3")), "Trong trang đang xem"],
          ]} />

          <Panel
            title="Bộ lọc"
            subtitle="Để trống cơ sở để xem mọi cơ sở."
          >
            <div className="manager-filters">
              <Field label="Cơ sở">
                <Select
                  label="Cơ sở hàng hóa"
                  value={facilityId}
                  onChange={setFacilityId}
                  options={[["", "Tất cả cơ sở"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
              <Field label="Trạng thái">
                <Select
                  label="Lọc theo trạng thái hàng hóa"
                  value={status}
                  onChange={setStatus}
                  options={[["", "Tất cả trạng thái"], ...ITEM_STATUSES.map((s) => [s, s.replaceAll("_", " ")])]}
                />
              </Field>
              <Field label="Danh mục" hint="Khớp chính xác danh mục hàng.">
                <Input aria-label="Lọc theo danh mục hàng hóa" value={category} onChange={(e) => setCategory(e.target.value)} />
              </Field>
              <Field label="Tìm kiếm" hint="Mã hàng, tên hoặc danh mục.">
                <Input aria-label="Tìm hàng hóa" value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
            </div>
          </Panel>

          <AsyncBoundary state={items} render={(data) => (data ? (
            <Panel title="Lô hàng" subtitle={`${data.total} lô · ${rows.filter((r) => r.placed).length} đã xếp ô ở trang này`}>
              {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
              <Table
                label="Hàng hóa lưu trữ"
                rows={data.rows}
                columns={[
                  { key: "code", label: "Item", render: (r) => <OpenLink to={`${basePath}/${r.id}`}>{r.code || r.name}</OpenLink> },
                  { key: "name", label: "Name" },
                  { key: "category", label: "Category", render: (r) => facilityLabel(r.category) || "—" },
                  { key: "owner", label: "Customer", render: (r) => owner(r.customerId) },
                  { key: "facility", label: "Facility", render: (r) => nameOfFacility(r.facilityId) },
                  { key: "quantity", label: "Quantity", render: (r) => `${r.quantity} ${r.quantityUnit || ""}`.trim() },
                  { key: "totalVolumeM3", label: "Volume", render: (r) => m3(r.totalVolumeM3) },
                  { key: "totalWeightKg", label: "Weight", render: (r) => kg(r.totalWeightKg) },
                  { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  { key: "cell", label: "Cell", render: (r) => (r.currentCellId ? "Placed" : r.preferredCellId ? "Preferred only" : "—") },
                  { key: "createdAt", label: "Registered", render: (r) => day(r.createdAt) },
                ]}
                empty="Không có lô hàng phù hợp bộ lọc hiện tại."
              />
              <ListPager
                page={data.pagination?.page ?? page}
                totalPages={data.pagination?.totalPages ?? 1}
                total={data.total}
                loading={items.loading}
                onPageChange={setPage}
                unit="lô hàng"
              />
            </Panel>
          ) : null)} />
        </>
      )} />
    </Screen>
  );
}

function ItemDetail({ id, basePath }) {
  const item = useAsyncData(({ signal }) => loadInventoryItem(id, { signal }), [id]);
  const movements = useAsyncData(({ signal }) => loadItemMovements(id, { signal }), [id]);

  return (
    <Screen
      title="Chi tiết lô hàng"
      description="Hàng hóa, đơn lưu trữ, trạng thái xếp ô và lịch sử biến động."
      action={<Button asChild variant="outline"><Link to={basePath}>Quay lại danh sách hàng hóa</Link></Button>}
    >
      <AsyncBoundary state={item} render={(row) => (
        <>
          <Panel
            title={row.name || "Inventory lot"}
            subtitle={row.code}
            action={<Status value={row.status} />}
          >
            <Details values={[
              ["Item code", row.code || "—"],
              ["Category", row.category || "—"],
              ["Quantity", `${row.quantity} ${row.quantityUnit || ""}`.trim()],
              ["Unit weight", kg(row.unitWeightKg)],
              ["Unit dimensions", row.unitDimensionsM
                ? `${row.unitDimensionsM.widthM} × ${row.unitDimensionsM.depthM} × ${row.unitDimensionsM.heightM} m`
                : "—"],
              ["Unit volume", m3(row.unitVolumeM3)],
              ["Total volume", m3(row.totalVolumeM3)],
              ["Total weight", kg(row.totalWeightKg)],
              ["Managed reservation", row.reservationId || "—"],
              ["Placement", row.currentCellId ? `Đang xếp ở ô ${row.currentCellId}` : row.preferredCellId ? "Đã chọn ô ưu tiên, chưa nhận hàng" : "Chưa phân bổ"],
              ["Inbound requested", stamp(row.inboundRequestedAt)],
              ["Inbound confirmed", stamp(row.inboundConfirmedAt)],
              ["Rejection reason", row.rejectionReason || "—"],
              ["Registered", stamp(row.createdAt)],
              ["Description", row.description || "—"],
            ]} />
          </Panel>

          <AsyncBoundary state={movements} render={(ledger) => (
            <Panel
            title="Lịch sử biến động"
            subtitle={`${ledger.length} biến động · mới nhất ở trên`}
            >
              {ledger.length > 0 && (
                <div className="mb-5">
                  <Timeline entries={ledger.map((row) => ({
                    at: row.performedAt,
                    status: row.type,
                    note: `${row.quantity} ${row.quantityUnit || ""} · ${kg(row.totalWeightKg)} · ${m3(row.totalVolumeM3)}${row.note ? ` · ${row.note}` : ""}`,
                  }))} />
                </div>
              )}
              <Table
                label="Biến động hàng hóa"
                rows={ledger.map((row) => ({ ...row, id: row.id }))}
                columns={[
                  { key: "type", label: "Loại", render: (r) => <Status value={r.type} /> },
                  { key: "performedAt", label: "Thời điểm", render: (r) => stamp(r.performedAt) },
                  { key: "quantity", label: "Số lượng", render: (r) => `${r.quantity} ${r.quantityUnit || ""}`.trim() },
                  { key: "totalWeightKg", label: "Khối lượng", render: (r) => kg(r.totalWeightKg) },
                  { key: "totalVolumeM3", label: "Thể tích", render: (r) => m3(r.totalVolumeM3) },
                  { key: "sourceCellId", label: "Ô nguồn", render: (r) => r.sourceCellId || "—" },
                  { key: "cellId", label: "Ô đích", render: (r) => r.cellId || "—" },
                  { key: "performedBy", label: "Người thực hiện", render: (r) => r.performedBy || "—" },
                  { key: "note", label: "Ghi chú", render: (r) => r.note || "—" },
                ]}
                empty="Chưa có biến động. Bản ghi xuất hiện khi nhân viên xác nhận nhập, xuất hoặc di chuyển hàng."
              />
            </Panel>
          )} />
        </>
      )} />
    </Screen>
  );
}
