import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Screen, Panel, Button } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { RackForm, ZoneForm } from "@/components/bom/WarehouseStructureDialogs";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadRacks, loadZones } from "@/lib/bomApiData";

// Zone / rack create + edit route for the warehouse console (quy ước 1: no edit form inside the
// list page). The list screen only links here.
//   /…/warehouse/:facilityId/zones/new        /…/warehouse/:facilityId/zones/:zoneId/edit
//   /…/warehouse/:facilityId/racks/new        /…/warehouse/:facilityId/racks/:rackId/edit
const TITLES = {
  zones: { new: "Tạo khu vực kho", edit: "Sửa khu vực kho", fallback: "khu vực" },
  racks: { new: "Tạo kệ", edit: "Sửa kệ", fallback: "kệ" },
};

export default function WarehouseFormPage({ basePath = "/bom/warehouse", kind = "zones", mode = "new" }) {
  const { facilityId = "", zoneId = "", rackId = "" } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const editing = mode === "edit";
  const copy = TITLES[kind] || TITLES.zones;
  const backToList = `${basePath}?facility=${encodeURIComponent(facilityId)}${params.get("zone") ? `&zone=${encodeURIComponent(params.get("zone"))}` : ""}`;

  const directory = useAsyncData(loadFacilities, []);
  const zones = useAsyncData(({ signal }) => (facilityId ? loadZones(facilityId, { signal }) : Promise.resolve(null)), [facilityId]);
  // Only the rack routes need the rack list; the zone routes skip the extra request.
  const racks = useAsyncData(
    ({ signal }) => (kind === "racks" && editing && facilityId ? loadRacks(facilityId, { signal }) : Promise.resolve(null)),
    [kind, editing, facilityId],
  );

  const facility = (directory.data || []).find((row) => row.id === facilityId);
  const zone = editing && kind === "zones" ? (zones.data?.rows || []).find((row) => row.id === zoneId) : null;
  const rack = editing && kind === "racks" ? (racks.data?.rows || []).find((row) => row.id === rackId) : null;
  const missing = editing && ((kind === "zones" && !zone) || (kind === "racks" && !rack));

  return (
    <Screen
      title={editing ? copy.edit : copy.new}
      description={facility ? `Cơ sở ${facility.name} · ${kind === "zones" ? "khu vực chứa các kệ" : "kệ và các ô lưu trữ"}.` : "Cấu trúc kho của một cơ sở."}
      action={<Button asChild variant="outline"><Link to={backToList}>Quay lại thông tin kho</Link></Button>}
    >
      {missing ? (
        <Panel title={`Không tìm thấy ${copy.fallback}`}>
          <p className="text-sm text-slate-500">{copy.fallback} này không thuộc cơ sở đã chọn hoặc đã bị xóa.</p>
          <Button asChild variant="outline" className="mt-4"><Link to={backToList}>Quay lại thông tin kho</Link></Button>
        </Panel>
      ) : (
        <Panel title={editing ? copy.edit : copy.new} subtitle={kind === "zones"
          ? "Khu vực gom các kệ cùng một vùng của kho."
          : "Tạo kệ sẽ tạo luôn các ô lưu trữ theo số tầng và số ô mỗi tầng."}>
          {kind === "zones" ? (
            <AsyncBoundary
              state={editing ? zones : { loading: false, error: "", data: [], reload: zones.reload }}
              render={() => <ZoneForm facilityId={facilityId} zone={zone} onClose={() => nav(backToList)} />}
            />
          ) : (
            <AsyncBoundary
              state={editing ? racks : zones}
              render={() => (
                <RackForm
                  facilityId={facilityId}
                  zones={(zones.data?.rows || []).filter((row) => row.isActive)}
                  rack={rack}
                  onClose={() => nav(backToList)}
                />
              )}
            />
          )}
        </Panel>
      )}
    </Screen>
  );
}
