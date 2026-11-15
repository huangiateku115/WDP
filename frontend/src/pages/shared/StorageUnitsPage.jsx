import { useState } from "react";
import { Screen, Panel, Table, Status, Field, Select, Input, Button } from "@/components/manager/ManagerUI";
import { AsyncBoundary, TruncatedNotice, ConfirmDialog } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { ResourceThumb } from "@/components/bom/ResourceImages";
import { UnitDialog, UnitStatusDialog } from "@/components/bom/StorageUnitDialogs";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityUnits } from "@/lib/bomApiData";
import { bomUnitApi } from "@/api/bomApi";
import { BOM_UNIT_SIZES } from "@/lib/bomMappers";
import { countBy, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Storage unit console shared by BOM and Admin. ADMIN, BOM and FACILITY_MANAGER may write;
// creation additionally requires the facility to be ACTIVE and to offer SELF_STORAGE.
// The list accepts status / size / search filters and is paged server-side.
const SELF_STORAGE = "SELF_STORAGE";
const wc = (conditions) => Object.fromEntries(Object.entries(conditions).filter(([, value]) => value));

export default function StorageUnitsPage() {
  const directory = useAsyncData(loadFacilities, []);
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [size, setSize] = useState("");
  const [search, setSearch] = useState("");
  const [unitDialog, setUnitDialog] = useState(null);
  const [statusDialog, setStatusDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const units = useAsyncData(
    ({ signal }) => (facilityId
      ? loadFacilityUnits(facilityId, { signal, ...wc({ status, size, search: search.trim() }) })
      : Promise.resolve(null)),
    [facilityId, status, size, search],
  );

  function selectFacility(id) {
    setFacilityId(id);
    setStatus("");
    setSize("");
    setSearch("");
  }

  function removeUnit(unit) {
    setConfirm({
      title: `Xóa kho ${unit.code}?`,
      summary: "Không thể xóa kho đang được giữ hoặc đang sử dụng.",
      label: "Xóa kho",
      run: async () => { await bomUnitApi.remove(unit.id); units.reload(); },
    });
  }

  return (
    <Screen
      title="Kho riêng"
      description="Quản lý kho riêng theo từng cơ sở: tạo mới, sửa, đổi trạng thái hoặc xóa."
    >
      <AsyncBoundary state={directory} render={(facilities) => {
        const facility = facilities.find((f) => f.id === facilityId);
        const canWrite = Boolean(facility && facility.status === "ACTIVE" && facility.serviceTypes.includes(SELF_STORAGE));
        const rows = units.data?.rows || [];
        return (
          <>
            <Kpis items={[
              ["Cơ sở", facilities.length, "Trên toàn hệ thống"],
              ["Số kho đã tải", units.data?.total ?? "—", "Theo bộ lọc hiện tại"],
              ["Sẵn sàng", countBy(rows, "status", "AVAILABLE"), "Có thể cho thuê"],
              ["Tổng thể tích đã đăng ký", m3(sumBy(rows, "volumeM3")), "Tính từ kích thước kho"],
            ]} />

            <Panel
              title="Phạm vi kho"
              subtitle="Chỉ tạo được kho khi cơ sở đang hoạt động và có dịch vụ Thuê kho riêng."
            >
              <div className="manager-filters">
                <Field label="Cơ sở">
                  <Select
                    label="Cơ sở của kho"
                    value={facilityId}
                    onChange={selectFacility}
                    options={[["", "Chọn cơ sở"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                  />
                </Field>
                <Field label="Trạng thái">
                  <Select
                    label="Lọc theo trạng thái kho"
                    value={status}
                    onChange={setStatus}
                    options={[["", "Tất cả trạng thái"], ["AVAILABLE", "Sẵn sàng"], ["MAINTENANCE", "Bảo trì"], ["INACTIVE", "Ngừng hoạt động"], ["HELD", "Đang giữ"], ["OCCUPIED", "Đang sử dụng"]]}
                  />
                </Field>
                <Field label="Kích cỡ">
                  <Select
                    label="Lọc theo kích cỡ kho"
                    value={size}
                    onChange={setSize}
                    options={[["", "Tất cả kích cỡ"], ...BOM_UNIT_SIZES.map((s) => [s, s])]}
                  />
                </Field>
                <Field label="Tìm kiếm" hint="Theo mã kho.">
                  <Input aria-label="Tìm kho riêng" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
              </div>
              {facility && !canWrite && (
                <p className="bom-warning mt-5">
                  {facility.name} đang ở trạng thái {facility.status} và không cung cấp dịch vụ Thuê kho riêng, nên không thể tạo kho.
                </p>
              )}
            </Panel>

            {!facilityId && (
              <Panel title="Chọn cơ sở">
                <p className="text-sm text-slate-500">Mỗi kho riêng thuộc một cơ sở.</p>
              </Panel>
            )}

            {facilityId && (
              <AsyncBoundary state={units} render={(data) => (data ? (
                <Panel
                  title="Danh sách kho"
                  subtitle={`${data.total} kho · ${countBy(data.rows, "status", "AVAILABLE")} đang sẵn sàng`}
                  action={<Button onClick={() => setUnitDialog("new")} disabled={!canWrite}>Tạo kho</Button>}
                >
                  {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
                  <div className="mt-5">
                    <Table
                      label="Kho riêng"
                      rows={data.rows}
                      columns={[
                        { key: "photo", label: "Photo", render: (r) => <ResourceThumb src={r.coverImage} alt={`${r.code} photo`} /> },
                        { key: "code", label: "Unit" },
                        { key: "size", label: "Size" },
                        { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                        {
                          key: "dimensions",
                          label: "Dimensions",
                          render: (r) => {
                            const d = r.dimensions || {};
                            return d.lengthM ? `${d.lengthM}×${d.widthM}×${d.heightM} m` : "—";
                          },
                        },
                        { key: "volumeM3", label: "Volume", render: (r) => m3(r.volumeM3) },
                        { key: "description", label: "Description", render: (r) => r.description || "—" },
                        {
                          key: "actions",
                          label: "Actions",
                          render: (r) => {
                            const locked = r.status === "HELD" || r.status === "OCCUPIED";
                            return (
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" disabled={locked} onClick={() => setUnitDialog(r)}>Sửa</Button>
                                <Button size="sm" variant="outline" disabled={locked} onClick={() => setStatusDialog(r)}>Trạng thái</Button>
                                <Button size="sm" variant="outline" disabled={locked} onClick={() => removeUnit(r)}>Xóa</Button>
                              </div>
                            );
                          },
                        },
                      ]}
                      empty="Không có kho phù hợp bộ lọc hiện tại."
                    />
                  </div>
                </Panel>
              ) : null)} />
            )}
          </>
        );
      }} />

      {unitDialog && (
        <UnitDialog
          facilityId={facilityId}
          unit={unitDialog === "new" ? null : unitDialog}
          onClose={() => setUnitDialog(null)}
          onSaved={() => units.reload()}
        />
      )}
      {statusDialog && (
        <UnitStatusDialog unit={statusDialog} onClose={() => setStatusDialog(null)} onSaved={() => units.reload()} />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          summary={<p className="text-sm text-slate-500">{confirm.summary}</p>}
          confirmLabel={confirm.label}
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        />
      )}
    </Screen>
  );
}
