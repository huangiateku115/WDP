import {CustomerImagePreview} from '../CustomerMediaUI';
import LoadState from '../CustomerResourceState';
import InventoryStatus from "./InventoryStatus";
import CanonicalCustomerOutbound from './CanonicalCustomerOutbound';
import { useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useAuthSession } from "@/lib/authSession";
import {
  inventoryCollection,
  inventoryRecord,
  inventoryId,
  editableInventory,
  httpImage,
  eligibleInventoryRental,
} from "@/lib/inventoryRegistration";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import {
  Card,
  CardContent,
  Button,
  Link,
  Details,
  RentalStatus,
} from "../RentalBackendUI";
import {
  inventoryApi,
  inventoryRentals,
  useInventoryBackend,
} from "./InventoryBackendUI";
import InventoryItemForm from "./InventoryItemForm";
import ManagedSelfInboundV3 from "./ManagedSelfInboundV3";
import ManagedSelfOutboundV3 from "./ManagedSelfOutboundV3";
import { inventoryCellLabels } from "./managedInventoryContext";
import { formatInventoryDateTime } from "./inventoryUiFormat";

function InventoryImages({ item }) {
  const [active, setActive] = useState(null),
    [broken, setBroken] = useState({}),
    images = (item.images || []).filter(httpImage);
  if (!images.length) return null;
  return (
    <>
      <div className="inventory-image-gallery mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((url, index) => (
          <button
            type="button"
            key={`${url}-${index}`}
            className="overflow-hidden rounded-xl border bg-white p-2 text-left"
            onClick={() => setActive(url)}
            aria-label={`View full size image ${index + 1}`}
          >
            {broken[index] ? (
              <div className="inventory-image-placeholder flex h-40 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
                Image unavailable
              </div>
            ) : (
              <img
                className="h-40 w-full rounded-lg object-contain"
                src={url}
                loading="lazy"
                decoding="async"
                alt={`${item.name}, image ${index + 1}`}
                onError={() =>
                  setBroken((previous) => ({ ...previous, [index]: true }))
                }
              />
            )}
            <span className="mt-2 block text-xs text-slate-600">
              Image {index + 1}
            </span>
          </button>
        ))}
      </div>
      {active&&<CustomerImagePreview images={images} selectedUrl={active} onClose={()=>setActive(null)}/>}
    </>
  );
}
import PlacementPreview from "./PlacementPreview";
const notice =
  "Thông tin đăng ký mặt hàng · Ô kệ ưu tiên chỉ là đề xuất. Đăng ký hoặc xem trước không xếp hàng vào kho, không nhận hàng và không làm thay đổi sức chứa.";
export function InventoryListIntegration() {
  const [page, setPage] = useState(1),
    resource = useInventoryBackend(
      (config) =>
        inventoryApi
          .getMine({ page, limit: 20 }, config)
          .then(inventoryCollection),
      [page],
    );
  return (
    <CustomerScreen
      title="Hàng hóa của tôi"
      description="Danh sách hàng hóa bạn đã đăng ký cho kho quản lý."
      notice={notice}
      action={
        <Button asChild variant="orange">
          <Link to="/portal/inventory/register">Đăng ký mặt hàng</Link>
        </Button>
      }
    >
      <LoadState resource={resource} />
      {resource.data?.items.length === 0 && (
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold">Chưa có mặt hàng nào được đăng ký</h2>
            <p className="mt-3">
              Đăng ký hàng trong một đơn thuê kho quản lý còn hiệu lực. Lịch sử đăng ký vẫn được lưu khi đơn thuê kết thúc.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {resource.data?.items.map((item) => (
          <Card key={inventoryId(item)}>
            <CardContent>
              <h2 className="text-xl font-bold">{item.name}</h2>
              <p className="mt-2 font-semibold text-brand">{item.itemCode}</p>
              <div className="mt-4">
                <InventoryStatus status={item.status} />
                <Details
                  values={[
                    ["Danh mục", item.category],
                    ["Số lượng", `${item.quantity.toLocaleString('vi-VN')} ${item.quantityUnit}`],
                    [
                      "Đơn thuê kho quản lý",
                      item.managedReservationId?.reservationCode || "Đơn thuê đã liên kết",
                    ],
                    [
                      "Facility",
                      typeof item.facilityId === "object"
                        ? item.facilityId.name || "Cơ sở đã liên kết"
                        : "Cơ sở đã liên kết",
                    ],
                    ["Ngày đăng ký", formatInventoryDateTime(item.createdAt)],
                    [
                      "Vị trí lưu kho",
                      item.inventorySchemaVersion === 3
                        ? "Xem phân bổ nhiều Cell trong phần Tồn kho V3 bên dưới"
                        : item.currentCellId === null ? "Chưa được xếp vào kho" : "Vị trí đang cập nhật",
                    ],
                  ]}
                />
              </div>
              <Button asChild variant="outline" className="mt-5">
                <Link to={`/portal/inventory/${inventoryId(item)}`}>
                  Xem mặt hàng
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {resource.data && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={resource.loading || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Trang trước
          </Button>
          <span>
            Trang {resource.data.pagination.page} ·{" "}
            {resource.data.pagination.total.toLocaleString('vi-VN')} mặt hàng
          </span>
          <Button
            variant="outline"
            disabled={
              resource.loading || page >= resource.data.pagination.totalPages
            }
            onClick={() => setPage((p) => p + 1)}
          >
            Trang sau
          </Button>
          <Button variant="outline" onClick={resource.retry}>
            Làm mới danh sách
          </Button>
        </div>
      )}
    </CustomerScreen>
  );
}
export function InventoryRegisterIntegration() {
  const session = useAuthSession();
  return (
    <CustomerScreen
      title="Đăng ký mặt hàng"
      description="Khai báo mặt hàng cho một đơn thuê kho quản lý V3 đủ điều kiện. Bước này chỉ lưu thông tin, chưa ghi nhận hàng trong kho."
      notice={notice}
      action={
        <Button asChild variant="outline">
          <Link to="/portal/inventory">Hàng hóa của tôi</Link>
        </Button>
      }
    >
      <InventoryItemForm key={session.accessToken} />
    </CustomerScreen>
  );
}
export function InventoryDetailIntegration() {
  const { id } = useParams(),
    session = useAuthSession();
  return <Detail key={`${session.accessToken}:${id}`} id={id} />;
}
function Detail({ id }) {
  const [editing, setEditing] = useState(false),
    location = useLocation(),
    resource = useInventoryBackend(
      (config) =>
        inventoryApi.get(id, config).then((response) => {
          const item = inventoryRecord(response);
          if (inventoryId(item) !== id)
            throw Error(
              "Inventory response does not match the requested item.",
            );
          return item;
        }),
      [id],
    );
  const rentals = useInventoryBackend(
    (config) =>
      resource.data
        ? inventoryRentals(
            config,
            (r) => r?.serviceType === "MANAGED_INVENTORY",
          )
        : Promise.resolve([]),
    [!!resource.data, resource.data?.updatedAt],
  );
  const item = resource.data,
    rental = rentals.data?.find(
      (r) => inventoryId(r) === inventoryId(item?.managedReservationId),
    ),
    editable = editableInventory(item, rental),
    eligible =
      eligibleInventoryRental(rental) &&
      inventoryId(rental.facilityId) === inventoryId(item?.facilityId);
  const cellLabels = useInventoryBackend(
    (config) => rental && item ? inventoryCellLabels(rental, [item.preferredCellId, item.currentCellId], config) : Promise.resolve({}),
    [inventoryId(rental), inventoryId(item?.preferredCellId), inventoryId(item?.currentCellId)],
  );
  const refresh = () => {
    setEditing(false);
    resource.retry();
    rentals.retry();
  };
  return (
    <CustomerScreen
      title={item?.name || "Mặt hàng"}
      description="Thông tin đăng ký và vị trí lưu kho dự kiến của mặt hàng."
      notice={notice}
      action={
        <Button asChild variant="outline">
          <Link to="/portal/inventory">Hàng hóa của tôi</Link>
        </Button>
      }
    >
      <LoadState resource={resource} />
      {item && (
        <>
          {location.state?.inventoryCreated && (
            <p role="status" className="soft-panel p-4">
            Đã đăng ký mặt hàng. Hàng chưa được xếp vào vị trí lưu kho.
            </p>
          )}
          <Card>
            <CardContent>
              <h2 className="text-xl font-bold">{item.itemCode}</h2>
              <div className="mt-3">
                <InventoryStatus status={item.status} />
              </div>
              <div className="inventory-detail-layout">
              <div className="inventory-detail-metadata mt-5">
                <Details
                  values={[
                    ["Tên mặt hàng", item.name],
                    ["Danh mục", item.category],
                    ["Số lượng đã đăng ký", `${item.quantity} ${item.quantityUnit}`],
                    ["Khối lượng mỗi món (kg)", item.unitWeightKg],
                    ["Chiều rộng (m)", item.unitDimensionsM?.widthM],
                    ["Chiều sâu (m)", item.unitDimensionsM?.depthM],
                    ["Chiều cao (m)", item.unitDimensionsM?.heightM],
                    ["Thể tích mỗi món (m³)", item.unitVolumeM3],
                    ["Tổng khối lượng (kg)", item.totalWeightKg],
                    ["Tổng thể tích (m³)", item.totalVolumeM3],
                    [
                      "Đơn thuê Managed",
                      rental?.reservationCode || "Thông tin đơn thuê đã liên kết",
                    ],
                    [
                      "Cơ sở",
                      rental?._facility?.name || "Cơ sở đã liên kết",
                    ],
                    [
                      "Ô kệ ưu tiên (chỉ là đề xuất)",
                      item.preferredCellId ? cellLabels.data?.[inventoryId(item.preferredCellId)] || "Ô kệ ưu tiên (đang tải tên vị trí)" : "Chưa chọn",
                    ],
                    [
                      "Vị trí lưu kho",
                      item.inventorySchemaVersion === 3
                        ? "Có thể gồm nhiều ô kệ; xem thông tin nhập/xuất bên dưới"
                        : item.currentCellId === null ? "Chưa được xếp vào kho" : cellLabels.data?.[inventoryId(item.currentCellId)] || "Vị trí đang được cập nhật",
                    ],
                    ["Mô tả", item.description],
                    ["Ngày đăng ký", formatInventoryDateTime(item.createdAt)],
                    ["Cập nhật lần cuối", formatInventoryDateTime(item.updatedAt)],
                  ].filter(([, value]) => value != null)}
                />
              </div>
              <InventoryImages key={JSON.stringify(item.images)} item={item}/>
              </div>
            </CardContent>
          </Card>
          <LoadState resource={rentals} />
          <div className="inventory-actions flex flex-wrap gap-3" role="group" aria-label="Item actions">
            <div className="inventory-action-group flex flex-wrap gap-2">
            <Button variant="outline" onClick={refresh}>
              Làm mới thông tin
            </Button>
            <Button asChild variant="outline">
              <Link to={`/portal/inventory/${id}/history`}>
                Xem lịch sử nhập/xuất
              </Link>
            </Button>
            {['IN_STORAGE','CHECKED_OUT'].includes(item.status)&&<Button asChild variant="outline"><Link to={`/portal/inventory/${id}/outbound`}>Yêu cầu xuất kho</Link></Button>}
            </div>
            <div className="inventory-action-group flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link
                to={`/portal/reservations/${inventoryId(item.managedReservationId)}`}
              >
                Xem đơn thuê Managed
              </Link>
            </Button>
            {editable && !editing && (
              <Button variant="orange" onClick={() => setEditing(true)}>
                Chỉnh sửa mặt hàng
              </Button>
            )}
            <Button asChild variant="outline">
              <Link
                to={`/portal/warehouse-map/${inventoryId(item.facilityId)}${eligible ? `?inventoryItem=${inventoryId(item)}` : ""}`}
              >
                {editable
                  ? "Chọn ô kệ ưu tiên trên sơ đồ"
                  : "Xem sơ đồ kho"}
              </Link>
            </Button>
            </div>
          </div>
          {!editable && !rentals.loading && (
            <p className="text-sm text-orange-700">
              Chỉ có thể chỉnh sửa mặt hàng đã đăng ký nhưng chưa được xếp vào kho, khi đơn thuê V3 sẵn sàng nhận kho hoặc đang hoạt động trong kỳ thuê. Lịch sử đăng ký vẫn được giữ.
            </p>
          )}
          {editing && editable && (
            <InventoryItemForm
              key={JSON.stringify(item)}
              item={item}
              onSaved={refresh}
            />
          )}
          <PlacementPreview
            key={JSON.stringify(item)}
            item={item}
            rental={rental}
            cellLabels={cellLabels.data || {}}
            eligible={eligible}
          />
          {item.inventorySchemaVersion === 3 && eligible && (
            <ManagedSelfInboundV3 item={item} rental={rental} cellLabels={cellLabels.data || {}} onRefresh={refresh} />
          )}
          <p className="text-sm text-slate-500">
            Đăng ký chỉ lưu thông tin mặt hàng. Tồn kho thực tế chỉ thay đổi sau khi bạn xác nhận nhập hàng trong phiên đến kho còn hiệu lực.
          </p>
          {item.inventorySchemaVersion === 3 ? <ManagedSelfOutboundV3 item={item} rental={rental} cellLabels={cellLabels.data || {}} onRefresh={refresh} /> :
            <CanonicalCustomerOutbound item={item} rental={rental} loading={resource.loading || !!resource.error || rentals.loading} onRefresh={refresh} />}
        </>
      )}
    </CustomerScreen>
  );
}
