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
  "Backend inventory registrations · A preferred Cell is a preference only. Registration and preview do not allocate Cells, receive stock or change warehouse usage.";
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
      title="My Inventory"
      description="Your owned Managed Inventory item registrations."
      notice={notice}
      action={
        <Button asChild variant="orange">
          <Link to="/portal/inventory/register">Register new item</Link>
        </Button>
      }
    >
      <LoadState resource={resource} />
      {resource.data?.items.length === 0 && (
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold">No inventory registrations</h2>
            <p className="mt-3">
              Register a lot against an activated Managed rental. Closed rentals
              retain their registration history.
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
                    ["Category", item.category],
                    ["Quantity", `${item.quantity} ${item.quantityUnit}`],
                    [
                      "Managed Reservation",
                      inventoryId(item.managedReservationId),
                    ],
                    [
                      "Facility",
                      typeof item.facilityId === "object"
                        ? item.facilityId.name || inventoryId(item.facilityId)
                        : item.facilityId,
                    ],
                    ["Registered at", item.createdAt],
                    [
                      "Current Cell",
                      item.currentCellId === null
                        ? "Not assigned"
                        : inventoryId(item.currentCellId),
                    ],
                  ]}
                />
              </div>
              <Button asChild variant="outline" className="mt-5">
                <Link to={`/portal/inventory/${inventoryId(item)}`}>
                  View item
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
            Previous items
          </Button>
          <span>
            Page {resource.data.pagination.page} ·{" "}
            {resource.data.pagination.total} registrations
          </span>
          <Button
            variant="outline"
            disabled={
              resource.loading || page >= resource.data.pagination.totalPages
            }
            onClick={() => setPage((p) => p + 1)}
          >
            Next items
          </Button>
          <Button variant="outline" onClick={resource.retry}>
            Refresh inventory
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
      title="Register inventory item"
      description="Declare a SKU against an eligible Managed V3 reservation. Registration records metadata only; it does not receive stock."
      notice={notice}
      action={
        <Button asChild variant="outline">
          <Link to="/portal/inventory">My Inventory</Link>
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
  const refresh = () => {
    setEditing(false);
    resource.retry();
    rentals.retry();
  };
  return (
    <CustomerScreen
      title={item?.name || "Inventory item"}
      description="Owned registration details and advisory placement information."
      notice={notice}
      action={
        <Button asChild variant="outline">
          <Link to="/portal/inventory">My Inventory</Link>
        </Button>
      }
    >
      <LoadState resource={resource} />
      {item && (
        <>
          {location.state?.inventoryCreated && (
            <p role="status" className="soft-panel p-4">
              Backend confirmed item registration. Physical location remains
              unassigned.
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
                    ["Item name", item.name],
                    ["Category", item.category],
                    ["Registered quantity (metadata)", `${item.quantity} ${item.quantityUnit}`],
                    ["Unit weight (kg)", item.unitWeightKg],
                    ["Width (m)", item.unitDimensionsM?.widthM],
                    ["Depth (m)", item.unitDimensionsM?.depthM],
                    ["Height (m)", item.unitDimensionsM?.heightM],
                    ["Unit volume (m³)", item.unitVolumeM3],
                    ["Total weight (kg)", item.totalWeightKg],
                    ["Total volume (m³)", item.totalVolumeM3],
                    [
                      "Managed Reservation",
                      inventoryId(item.managedReservationId),
                    ],
                    [
                      "Facility",
                      rental?._facility?.name || inventoryId(item.facilityId),
                    ],
                    [
                      "Preferred Cell (preference only)",
                      inventoryId(item.preferredCellId) || "No preference",
                    ],
                    [
                      "Current Cell (Backend location)",
                      item.currentCellId === null
                        ? "Not assigned"
                        : inventoryId(item.currentCellId),
                    ],
                    ["Description", item.description],
                    ["Registered at", item.createdAt],
                    ["Updated at", item.updatedAt],
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
              Refresh item
            </Button>
            <Button asChild variant="outline">
              <Link to={`/portal/inventory/${id}/history`}>
                View Movement History
              </Link>
            </Button>
            {['IN_STORAGE','CHECKED_OUT'].includes(item.status)&&<Button asChild variant="outline"><Link to={`/portal/inventory/${id}/outbound`}>Outbound requests</Link></Button>}
            </div>
            <div className="inventory-action-group flex flex-wrap gap-2">
            {rental?.bookingFlowVersion === 2 && (
              <Button asChild variant="orange">
                <Link to={`/portal/inventory/${id}/inbound`}>
                  Request Inbound
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link
                to={`/portal/reservations/${inventoryId(item.managedReservationId)}`}
              >
                View Managed Reservation
              </Link>
            </Button>
            {editable && !editing && (
              <Button variant="orange" onClick={() => setEditing(true)}>
                Edit item
              </Button>
            )}
            <Button asChild variant="outline">
              <Link
                to={`/portal/warehouse-map/${inventoryId(item.facilityId)}${eligible ? `?inventoryItem=${inventoryId(item)}` : ""}`}
              >
                {editable
                  ? "Choose preferred Cell on map"
                  : "View Warehouse Map"}
              </Link>
            </Button>
            </div>
          </div>
          {!editable && !rentals.loading && (
            <p className="text-sm text-orange-700">
              Editing unavailable: only unplaced REGISTERED metadata linked to
            an eligible CHECKIN_READY or in-term ACTIVE V3 Managed rental can be changed. Registration
              history remains readable.
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
            eligible={eligible}
          />
          <p className="text-sm text-slate-500">
            Registration does not confirm physical stock or physical placement. Self-Inbound V3 is not yet released.
          </p>
          <CanonicalCustomerOutbound
            item={item}
            rental={rental}
            loading={resource.loading || !!resource.error || rentals.loading}
            onRefresh={refresh}
          />
        </>
      )}
    </CustomerScreen>
  );
}
