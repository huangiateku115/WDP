import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Screen, Panel, Table, Status, Button, Details } from "@/components/manager/ManagerUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { CellDialog } from "@/components/bom/WarehouseStructureDialogs";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadCells, loadFacilities, loadRacks } from "@/lib/bomApiData";
import { countBy, formatKg as kg, formatM3 as m3, sumBy } from "@/lib/bomMetrics";

// Route-backed rack detail: the cell list of one rack lives on its own URL instead of expanding
// inside the warehouse list. The URL carries the facility so a refresh keeps the same context
// (`/bom/warehouse?facility=…` → `/bom/warehouse/:facilityId/racks/:rackId/cells`).
export default function RackCellsPage({ basePath = "/bom/warehouse" }) {
  const { facilityId = "", rackId = "" } = useParams();
  const nav = useNavigate();
  const [cellDialog, setCellDialog] = useState(null);

  const directory = useAsyncData(loadFacilities, []);
  const racks = useAsyncData(({ signal }) => loadRacks(facilityId, { signal }), [facilityId]);
  const cells = useAsyncData(({ signal }) => loadCells(facilityId, rackId, { signal }), [facilityId, rackId]);

  const facility = (directory.data || []).find((row) => row.id === facilityId);
  const rack = (racks.data?.rows || []).find((row) => row.id === rackId);
  const backToList = `${basePath}?facility=${encodeURIComponent(facilityId)}`;

  return (
    <Screen
      title={rack ? `Ô lưu trữ của kệ ${rack.rackCode}` : "Ô lưu trữ của kệ"}
      description={facility
        ? `Cơ sở ${facility.name}${rack?.aisleCode ? ` · dãy ${rack.aisleCode}` : ""} · tải trọng và trạng thái từng ô.`
        : "Danh sách ô lưu trữ thuộc một kệ của cơ sở."}
      action={<Button asChild variant="outline"><Link to={backToList}>Quay lại thông tin kho</Link></Button>}
    >
      <AsyncBoundary state={cells} render={(data) => (data ? (
        <Panel
          title="Ô lưu trữ"
          subtitle={`${data.total} ô${rack ? ` · ${rack.levelCount} tầng × ${rack.cellsPerLevel} ô` : ""}`}
          action={<Button asChild variant="outline"><Link to={backToList}>Quay lại danh sách kệ</Link></Button>}
        >
          {data.truncated && <TruncatedNotice total={data.total} shown={data.rows.length} />}
          <Details values={[
            ["Kệ", rack?.rackCode || rackId],
            ["Dãy", rack?.aisleCode || "—"],
            ["Ô còn trống", countBy(data.rows, "operationalStatus", "AVAILABLE")],
            ["Tải trọng các ô", kg(sumBy(data.rows, "maxWeightKg"))],
            ["Thể tích sử dụng", m3(sumBy(data.rows, "usableVolumeM3"))],
          ]} />
          <div className="mt-5">
            <Table
              label="Ô lưu trữ của kệ"
              rows={data.rows}
              columns={[
                { key: "code", label: "Mã ô" },
                { key: "levelNumber", label: "Tầng kệ" },
                { key: "cellNumber", label: "Thứ tự ô" },
                { key: "dimensions", label: "Kích thước", render: (r) => `${r.dimensions.widthM}×${r.dimensions.depthM} m · cao dùng được ${r.dimensions.usableHeightM ?? "—"} m` },
                { key: "maxWeightKg", label: "Tải trọng tối đa", render: (r) => kg(r.maxWeightKg) },
                { key: "usableVolumeM3", label: "Thể tích", render: (r) => (r.usableVolumeM3 === null ? "—" : m3(r.usableVolumeM3)) },
                { key: "operationalStatus", label: "Trạng thái", render: (r) => <Status value={r.operationalStatus} /> },
                { key: "actions", label: "Thao tác", render: (r) => <Button size="sm" variant="outline" onClick={() => setCellDialog(r)}>Sửa</Button> },
              ]}
              empty="Kệ này chưa có ô lưu trữ nào."
            />
          </div>
        </Panel>
      ) : null)} />

      {!cells.loading && !cells.error && !rack && (
        <Panel title="Không tìm thấy kệ">
          <p className="text-sm text-slate-500">Kệ này không thuộc cơ sở đã chọn hoặc đã bị xóa.</p>
          <Button variant="outline" className="mt-4" onClick={() => nav(backToList)}>Quay lại thông tin kho</Button>
        </Panel>
      )}

      {cellDialog && (
        <CellDialog
          cell={cellDialog}
          onClose={() => setCellDialog(null)}
          onSaved={() => { cells.reload(); racks.reload(); }}
        />
      )}
    </Screen>
  );
}
