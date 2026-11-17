import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Screen, Panel, Button } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { UnitForm } from "@/components/bom/StorageUnitDialogs";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities } from "@/lib/bomApiData";
import { bomUnitApi } from "@/api/bomApi";
import { unitFromDto } from "@/lib/bomMappers";

// Create/edit route for a private storage unit. The unit list only links here, so the form is a
// page (quy ước 1) instead of a dialog opened from the table.
//   /…/units/new/:facilityId
//   /…/units/:id/edit
export default function UnitFormPage({ basePath = "/bom/units", mode = "new" }) {
  const { id = "", facilityId = "" } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const editing = mode === "edit";
  const backToList = `${basePath}${params.toString() ? `?${params.toString()}` : ""}`;

  const directory = useAsyncData(loadFacilities, []);
  const record = useAsyncData(
    ({ signal }) => (editing ? bomUnitApi.get(id, { signal }).then((response) => unitFromDto(response?.data?.data ?? null)) : Promise.resolve(null)),
    [editing, id],
  );

  const targetFacilityId = editing ? (record.data?.facilityId || "") : facilityId;
  const facility = (directory.data || []).find((row) => row.id === (editing ? targetFacilityId || "" : facilityId));

  return (
    <Screen
      title={editing ? "Sửa kho riêng" : "Tạo kho riêng"}
      description={facility ? `Cơ sở ${facility.name} · thông tin kho dùng cho đơn Thuê kho riêng.` : "Thông tin kho dùng cho đơn Thuê kho riêng."}
      action={<Button asChild variant="outline"><Link to={backToList}>Quay lại danh sách kho</Link></Button>}
    >
      {editing ? (
        <AsyncBoundary
          state={record}
          render={(unit) => (unit ? (
            <Panel title={`Kho ${unit.code}`} subtitle="Mã kho, kích thước và hình ảnh dùng chung cho mọi đơn của kho này.">
              <UnitForm facilityId={unit.facilityId} unit={unit} onClose={() => nav(backToList)} />
            </Panel>
          ) : (
            <Panel title="Không tìm thấy kho">
              <p className="text-sm text-slate-500">Kho này không tồn tại hoặc đã bị xóa.</p>
              <Button asChild variant="outline" className="mt-4"><Link to={backToList}>Quay lại danh sách kho</Link></Button>
            </Panel>
          ))}
        />
      ) : (
        <Panel title="Kho mới" subtitle="Mã kho phải là duy nhất trong cơ sở; thể tích do hệ thống tính từ kích thước.">
          <UnitForm facilityId={facilityId} unit={null} onClose={() => nav(backToList)} />
        </Panel>
      )}
    </Screen>
  );
}
