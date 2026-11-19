import {CustomerImagePreview} from '../CustomerMediaUI';
import LoadState from '../CustomerResourceState';
import InventoryStatus from "./InventoryStatus";
import { useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useAuthSession } from "@/lib/authSession";
import {
  inventoryCollection,
  inventoryRecord,
  inventoryId,
  editableInventory,
  httpImage,
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
import ItemSpecifications from "./ItemSpecifications";
import ManagedUnifiedSelfInbound from "./ManagedUnifiedSelfInbound";
import ManagedSelfOutboundV3 from "./ManagedSelfOutboundV3";
import ManagedSelfRelocationV3 from "./ManagedSelfRelocationV3";
import { inventoryCellLabels } from "./managedInventoryContext";
import { formatInventoryDateTime } from "./inventoryUiFormat";
import { managedInventoryV3Api } from "@/api/managedInventoryV3Api";

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
export function InventoryListIntegration() {
  const location = useLocation(), params = new URLSearchParams(location.search),
    operation = params.get('operation'), accessSessionId = params.get('accessSessionId'), reservationFilter = params.get('reservationId'),
    operationLabel = ({ INBOUND: 'nhập kho', OUTBOUND: 'xuất kho', RELOCATION: 'chuyển vị trí' })[operation],
    [page, setPage] = useState(1),
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
      action={
        <Button asChild variant="orange">
          <Link to="/portal/inventory/register">Đăng ký mặt hàng</Link>
        </Button>
      }
    >
      {accessSessionId && operationLabel && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">Bạn đang chọn thao tác {operationLabel} trong Access Session đã cấp. Hãy mở mặt hàng thuộc đúng Reservation để tiếp tục; Backend sẽ kiểm tra lại quyền và Cell khi xem trước/xác nhận.</p>}
      <LoadState resource={resource} />
      {(resource.data?.items || []).filter(item => !reservationFilter || inventoryId(item.managedReservationId) === reservationFilter).length === 0 && (
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold">{reservationFilter ? 'Không có mặt hàng thuộc Reservation này' : 'Chưa có mặt hàng nào được đăng ký'}</h2>
            <p className="mt-3">
              Đăng ký hàng trong một đơn thuê kho quản lý còn hiệu lực. Lịch sử đăng ký vẫn được lưu khi đơn thuê kết thúc.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {(resource.data?.items || []).filter(item => !reservationFilter || inventoryId(item.managedReservationId) === reservationFilter).map((item) => (
          <Card key={inventoryId(item)}>
            <CardContent>
              <h2 className="text-xl font-bold">{item.name}</h2>
              <p className="mt-2 font-semibold text-brand">{item.itemCode}</p>
              <div className="mt-4">
                <InventoryStatus status={item.status} />
                <Details
                  values={[
                    ["Danh mục", item.category],
                    ["Vai trò", "SKU · nhóm hàng"],
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
                      "Mở chi tiết để xem vị trí tồn kho",
                    ],
                  ]}
                />
              </div>
              <Button asChild variant="outline" className="mt-5">
                <Link to={`/portal/inventory/${inventoryId(item)}${accessSessionId ? `?accessSessionId=${encodeURIComponent(accessSessionId)}&operation=${encodeURIComponent(operation || '')}` : ''}`}>
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
      description="Đăng ký SKU cho đơn thuê kho quản lý."
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
    query = new URLSearchParams(location.search), initialSessionId = query.get('accessSessionId') || '',
    rental = rentals.data?.find(
      (r) => inventoryId(r) === inventoryId(item?.managedReservationId),
    ),
    editable = editableInventory(item, rental);
  const stock = useInventoryBackend(
    () => item?.inventorySchemaVersion === 3
      ? managedInventoryV3Api.cellStock(inventoryId(item)).then(response => response.data?.data || null)
      : Promise.resolve(null),
    [inventoryId(item), item?.inventorySchemaVersion, item?.updatedAt],
  );
  const ownedStockCells = item?.inventorySchemaVersion === 3 && stock.data?.ledgerReplayStatus === "VERIFIED"
    ? (stock.data.ledgerByCell || []).filter(row => Number(row.quantityOnHand) > 0).map(row => inventoryId(row.cellId)).filter(Boolean)
    : [];
  const cellLabels = useInventoryBackend(
    (config) => rental && item ? inventoryCellLabels(rental, [...(rental.allocatedCellIds || []), item.preferredCellId, item.currentCellId, ...ownedStockCells], config) : Promise.resolve({}),
    [inventoryId(rental), inventoryId(item?.preferredCellId), inventoryId(item?.currentCellId), JSON.stringify(rental?.allocatedCellIds || []), JSON.stringify(ownedStockCells)],
  );
  const refresh = () => {
    setEditing(false);
    resource.retry();
    rentals.retry();
    stock.retry();
  };
  const locationValue = item?.inventorySchemaVersion !== 3
    ? "Chưa xác minh vị trí tồn kho"
    : stock.loading
      ? "Đang tải vị trí tồn kho…"
      : stock.error
        ? "Không tải được vị trí tồn kho"
        : stock.data?.ledgerReplayStatus !== "VERIFIED"
        ? "Vị trí tồn kho đang được đối soát"
        : ownedStockCells.length
          ? cellLabels.loading
            ? "Đang tải mã ô lưu kho…"
            : ownedStockCells.map(cellId => cellLabels.data?.[cellId]).filter(Boolean).join("; ") || `Đã ghi nhận tại ${ownedStockCells.length} ô kệ`
          : "Chưa ghi nhận tồn thực tế";
  return (
    <CustomerScreen
      title={item?.name || "Mặt hàng"}
      description="Thông tin SKU, quy cách và vị trí lưu kho thực tế."
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
                    ["Vai trò", "SKU · nhóm hàng"],
                    [
                      "Đơn thuê Managed",
                      rental?.reservationCode || "Thông tin đơn thuê đã liên kết",
                    ],
                    [
                      "Cơ sở",
                      rental?._facility?.name || "Cơ sở đã liên kết",
                    ],
                    [
                      "Vị trí lưu kho",
                      locationValue,
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
            <Button asChild variant="outline"><Link to={`/portal/warehouse-map/${inventoryId(item.facilityId)}`}>Xem sơ đồ kho</Link></Button>
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
          {item.inventorySchemaVersion===3&&<ItemSpecifications sku={item} readOnly={!editable} onChanged={refresh}/>}
          {item.inventorySchemaVersion===3&&<ManagedUnifiedSelfInbound item={item} rental={rental} cellLabels={cellLabels.data||{}} onRefresh={refresh} initialSessionId={initialSessionId}/>}
          {item.inventorySchemaVersion===3&&<ManagedSelfOutboundV3 item={item} rental={rental} cellLabels={cellLabels.data||{}} onRefresh={refresh} initialSessionId={initialSessionId}/>}
          {item.inventorySchemaVersion===3&&<ManagedSelfRelocationV3 item={item} rental={rental} onRefresh={refresh} initialSessionId={initialSessionId}/>}
          {item.inventorySchemaVersion!==3&&<p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Thao tác tồn kho cho dữ liệu lịch sử được giữ ở chế độ tra cứu trong khi SKU V3 dùng luồng nhập kho hợp nhất.</p>}
        </>
      )}
    </CustomerScreen>
  );
}
