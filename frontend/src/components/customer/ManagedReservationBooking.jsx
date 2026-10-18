import { managedQuoteFinancials } from "@/lib/managedRentalPricing";
import {
  cellBookingReason,
  cellVolume,
  canonicalRange,
} from "@/lib/managedCellBooking";
import { ManagedFinancialSummary } from "./RentalBackendUI";

import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import facilityApi from "@/api/facilityApi";
import managedApi from "@/api/managedReservationApi";
import { pricingApi, customerProfileApi } from "@/api/customerRentalApi";
import { getAccessToken, useAuthSession } from "@/lib/authSession";
import {
  managedTerms,
  managedRequest,
  managedCreation,
  MANAGED_INVENTORY,
} from "@/lib/customerReservationService";
import { rentalEndDate, termKey, termLabel } from "@/lib/rentalPeriod";
import { managedBookingRecovery } from "@/lib/managedBookingDisplay";
import ManagedWarehouseMap from "@/components/customer/ManagedWarehouseMap";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BackendScreen,
  Card,
  CardContent,
  Button,
  Link,
  Details,
  Message,
  LoadState,
  useBackend,
  rows,
  record,
  recordId,
  validId,
  rentalError,
} from "./RentalBackendUI";

export function ServiceChoice() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Storage service">
      <Button asChild variant="outline">
        <Link to="/portal/rent">Self Storage · Rent a unit</Link>
      </Button>
      <Button asChild variant="orange">
        <Link to="/portal/rent?service=managed">
          Managed Inventory · Select Cells
        </Link>
      </Button>
    </div>
  );
}
export default function ManagedReservationBooking() {
  const session = useAuthSession();
  return <ManagedForm key={session.accessToken} />;
}
function ManagedForm() {
  const [params] = useSearchParams(),
    nav = useNavigate();
  const [facilityId, setFacilityId] = useState(params.get("facility") || ""),
    [start, setStart] = useState(""),
    [duration, setDuration] = useState(""),
    [selectedCells, setSelectedCells] = useState({}),
    [mapRefreshKey, setMapRefreshKey] = useState(0);
  const [checked, setChecked] = useState(null),
    [quote, setQuote] = useState(null),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const busy = useRef(false),
    currentKey = useRef(""),
    attempted = useRef(false);
  const facilities = useBackend(
    async (config) => {
      const items = [];
      let page = 1,
        totalPages = 1;
      do {
        const response = await facilityApi.publicList({
          ...config,
          params: { page, limit: 100 },
        });
        items.push(...rows(response));
        totalPages = response.data.pagination?.totalPages ?? 1;
        if (!Number.isInteger(totalPages) || totalPages < 0)
          throw Error("Invalid facility pagination.");
        page++;
      } while (page <= totalPages);
      return items;
    },
    [],
    true,
  );
  const profile = useBackend((config) =>
    customerProfileApi.get(config).then(record),
  );
  const eligible =
    facilities.data?.filter(
      (f) =>
        (f.status == null || f.status === "ACTIVE") &&
        f.serviceTypes?.includes(MANAGED_INVENTORY),
    ) || [];
  const facility = eligible.find((f) => recordId(f) === facilityId);
  const rules = useBackend(
    async (config) => {
      if (!facility || !validId(facilityId)) return [];
      const items = [];
      let page = 1,
        totalPages = 1;
      do {
        const response = await pricingApi.list(
          {
            facilityId,
            serviceType: MANAGED_INVENTORY,
            isActive: true,
            page,
            limit: 100,
          },
          config,
        );
        items.push(...rows(response));
        totalPages = response.data.pagination?.totalPages;
        if (!Number.isInteger(totalPages) || totalPages < 0)
          throw Error("Invalid Managed pricing pagination.");
        page++;
      } while (page <= totalPages);
      return items;
    },
    [facilityId, !!facility],
  );
  const terms = managedTerms(rules.data || [], facilityId, start),
    term = terms.find((t) => termKey(t) === duration),
    end = rentalEndDate(start, term),
    startDate = start ? `${start}T00:00:00.000Z` : "";
  const allocatedCapacityM3 = Object.values(selectedCells).reduce(
    (sum, cell) => sum + cell.volumeM3,
    0,
  );
  const cellIds = Object.keys(selectedCells);
  const requestKey = JSON.stringify([
    facilityId,
    start,
    duration,
    cellIds,
    allocatedCapacityM3,
  ]);
  currentKey.current = requestKey;
  let payload = null;
  try {
    if (facility && !rules.loading && !rules.error && term && cellIds.length)
      payload = managedRequest({
        facilityId,
        allocatedCapacityM3,
        startDate,
        term,
        cellIds,
      });
  } catch {
    /* Form remains disabled until inputs are valid. */
  }
  const capacity = checked?.key === requestKey ? checked.data : null,
    review = quote?.key === requestKey ? quote.data : null;
  const verified = profile.data?.verificationStatus === "VERIFIED";
  function change(setter, value) {
    setter(value);
    setChecked(null);
    setQuote(null);
    setConfirmed(false);
    setSelectedCells({});
    setMapRefreshKey((v) => v + 1);
    setError("");
  }
  function toggleCell(cell, volumeM3, rack) {
    // This optional map callback must apply the same rules as the main basket.
    const range = { startDate, endDate: `${end}T00:00:00.000Z` };
    if (selectedCells[cell?._id]) {
      setSelectedCells((current) => {
        const next = { ...current };
        delete next[cell._id];
        return next;
      });
      setChecked(null);
      setQuote(null);
      setConfirmed(false);
      return;
    }
    if (
      !rack ||
      rack.facilityId !== facilityId ||
      cellBookingReason(cell, rack, range)
    )
      return;
    try {
      canonicalRange(range);
      if (cellVolume(cell) !== volumeM3) return;
    } catch {
      return;
    }
    if (Object.keys(selectedCells).length >= 100) return;
    setSelectedCells((current) => {
      const next = { ...current };
      if (next[cell._id]) delete next[cell._id];
      else next[cell._id] = { volumeM3 };
      return next;
    });
    setChecked(null);
    setQuote(null);
    setConfirmed(false);
    setError("");
  }
  async function check() {
    if (busy.current || !payload) return;
    busy.current = true;
    setPending("capacity");
    setError("");
    setQuote(null);
    setConfirmed(false);
    const token = getAccessToken(),
      key = requestKey;
    try {
      const data = record(
        await managedApi.capacity(facilityId, {
          startDate,
          endDate: `${end}T00:00:00.000Z`,
        }),
      );
      if (getAccessToken() !== token || currentKey.current !== key) return;
      if (
        recordId(data.facilityId) !== facilityId ||
        !Number.isFinite(data.availableCapacityM3) ||
        data.availableCapacityM3 < 0 ||
        data.interval?.startDate !== startDate ||
        data.interval?.endDate !== `${end}T00:00:00.000Z`
      )
        throw Error("Invalid Managed capacity response.");
      setChecked({ key, data });
    } catch (e) {
      if (getAccessToken() === token && currentKey.current === key)
        setError(rentalError(e));
    } finally {
      busy.current = false;
      setPending("");
    }
  }
  async function resolve() {
    if (
      busy.current ||
      !payload ||
      !capacity ||
      capacity.availableCapacityM3 < payload.allocatedCapacityM3
    )
      return;
    busy.current = true;
    setPending("quote");
    setError("");
    setConfirmed(false);
    const token = getAccessToken(),
      key = requestKey;
    try {
      const data = record(await managedApi.quote(payload));
      if (getAccessToken() !== token || currentKey.current !== key) return;
      if (
        recordId(data.facilityId) !== facilityId ||
        data.allocatedCapacityM3 !== payload.allocatedCapacityM3 ||
        data.startDate !== startDate ||
        data.endDate !== `${end}T00:00:00.000Z` ||
        data.term?.value !== term.value ||
        data.term?.unit !== term.unit ||
        !Number.isFinite(data.pricing?.estimatedRent) ||
        !Number.isFinite(data.deposit?.amount) ||
        typeof data.pricing?.currency !== "string"
      )
        throw Error("Invalid Managed quote response.");
      if (data.bookingFlowVersion === 2) managedQuoteFinancials(data);
      else if (data.bookingFlowVersion != null && data.bookingFlowVersion !== 1)
        throw Error("Unsupported Managed quote version.");
      setQuote({ key, data });
    } catch (e) {
      if (getAccessToken() === token && currentKey.current === key)
        setError(rentalError(e));
    } finally {
      busy.current = false;
      setPending("");
    }
  }
  function create() {
    if (!facility || !validId(facilityId) || pending) return;
    const query = new URLSearchParams();
    if (start) query.set("start", start);
    if (term) {
      query.set("termValue", String(term.value));
      query.set("termUnit", term.unit);
    }
    nav(`/portal/warehouse-map/${facilityId}?${query}`);
  }
  return (
    <BackendScreen
      title="Rent Managed Inventory Cells"
      description="Review commercial capacity and pricing. Select specific Warehouse Cells before creating a reservation."
    >
      <ServiceChoice />
      <div className="soft-panel p-5">
        <p>
          New Managed reservations require specific Cells. Your existing
          reservations and capacity quotes remain accessible.
        </p>
        <Button
          className="mt-3"
          variant="orange"
          disabled={!facility || !!pending}
          onClick={create}
        >
          Select Warehouse Cells
        </Button>
      </div>
      <LoadState resource={facilities} />
      <LoadState resource={profile} />
      {profile.data && !verified && (
        <Message error="A VERIFIED Customer Profile is required to create a Managed reservation. You can still check availability and obtain a quote." />
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold">Facility & rental capacity</h2>
            <div className="mt-5 space-y-5">
              <label className="block field-label">
                Managed Facility
                <select
                  aria-label="Managed Facility"
                  className="customer-select mt-2"
                  value={facilityId}
                  disabled={!!pending}
                  onChange={(e) => change(setFacilityId, e.target.value)}
                >
                  <option value="">Choose an active Managed facility</option>
                  {eligible.map((f) => (
                    <option key={recordId(f)} value={recordId(f)}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              {!facilities.loading && !facilities.error && !eligible.length && (
                <p>No active Managed Inventory facilities are available.</p>
              )}
              <label className="block field-label">
                Managed move-in date (UTC)
                <Input
                  aria-label="Managed move-in date (UTC)"
                  className="mt-2"
                  type="date"
                  disabled={!!pending}
                  value={start}
                  onChange={(e) => change(setStart, e.target.value)}
                />
              </label>
              <LoadState resource={rules} />
              <label className="block field-label">
                Managed commitment duration
                <select
                  aria-label="Managed commitment duration"
                  className="customer-select mt-2"
                  value={term ? duration : ""}
                  disabled={!!pending || rules.loading || !terms.length}
                  onChange={(e) => change(setDuration, e.target.value)}
                >
                  <option value="">Choose an effective term</option>
                  {terms.map((t) => (
                    <option key={termKey(t)} value={termKey(t)}>
                      {termLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              {facility &&
                start &&
                !rules.loading &&
                !rules.error &&
                !terms.length && (
                  <p>
                    No effective PER_M3 rental terms are configured for this
                    date.
                  </p>
                )}
              <div className="field-label">
                <p>Selected Cell capacity (m³)</p>
                <p className="mt-2 text-sm" role="status">
                  {payload
                    ? `${allocatedCapacityM3} m³ from ${cellIds.length} selected Cell(s)`
                    : "No validated Cells selected. Select Cells on the Warehouse Map to calculate capacity."}
                </p>
              </div>
              <p className="text-sm">
                Rental end (UTC): {end || "Choose a valid date and term"}
              </p>
              {start && Date.parse(startDate) <= Date.now() && (
                <p className="text-sm text-orange-700">
                  Choose a future UTC start date.
                </p>
              )}
              <Button disabled={!payload || !!pending} onClick={check}>
                {pending === "capacity"
                  ? "Checking capacity…"
                  : "Check Managed capacity"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold">Availability & quote</h2>
            {capacity && (
              <>
                <Details
                  values={[
                    ["Sellable capacity (m³)", capacity.sellableCapacityM3],
                    [
                      "Peak committed capacity (m³)",
                      capacity.committedPeakCapacityM3,
                    ],
                    [
                      "Unresolved overdue capacity (m³)",
                      capacity.unresolvedOverdueObligationM3,
                    ],
                    ["Available capacity (m³)", capacity.availableCapacityM3],
                    ["Selected Cell capacity (m³)", allocatedCapacityM3],
                    ["Start", capacity.interval?.startDate],
                    ["End", capacity.interval?.endDate],
                  ].filter(([, v]) => v != null)}
                />
                {capacity.availableCapacityM3 < allocatedCapacityM3 ? (
                  <Message error="Selected Cell capacity exceeds available Managed capacity for this interval." />
                ) : (
                  <Button
                    className="mt-5"
                    disabled={!payload || !!pending}
                    onClick={resolve}
                  >
                    {pending === "quote"
                      ? "Requesting quote…"
                      : "Get Managed quote"}
                  </Button>
                )}
              </>
            )}
            {review && (
              <div className="mt-6 space-y-5">
                <h3 className="font-bold">Review server quote</h3>
                {review.bookingFlowVersion === 2 && (
                  <ManagedFinancialSummary quote={review} />
                )}
                <Details
                  values={[
                    ["Allocated capacity (m³)", review.allocatedCapacityM3],
                    ["Commitment", termLabel(review.term)],
                    ["Start", review.startDate],
                    ["End", review.endDate],
                    ["Rate per m³", review.pricing.ratePerM3],
                    ["Estimated rent", review.pricing.estimatedRent],
                    [
                      review.bookingFlowVersion === 2
                        ? "Scheduled advance-rent deposit"
                        : "Deposit",
                      review.deposit.amount,
                    ],
                    ["Deposit percentage", review.deposit.percentage],
                    ["Currency", review.pricing.currency],
                    [
                      "Total due",
                      review.bookingFlowVersion === 2
                        ? undefined
                        : review.totalDue,
                    ],
                  ].filter(([, v]) => v != null)}
                />
                <p className="text-sm text-slate-500">
                  This quote does not reserve capacity. The server checks
                  availability and recalculates amounts when you create the
                  reservation.
                </p>
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <Checkbox
                    aria-label="Confirm Managed reservation details"
                    checked={confirmed}
                    disabled={!!pending || uncertain}
                    onCheckedChange={(v) => setConfirmed(v === true)}
                  />
                  <span>
                    I confirm the facility, selected Cell capacity, UTC rental
                    period and returned quote.
                  </span>
                </label>
                <Button
                  variant="orange"
                  disabled={!facility || !!pending}
                  onClick={create}
                >
                  Select Cells to Reserve
                </Button>
              </div>
            )}
            {!capacity && (
              <p className="mt-5 text-sm text-slate-500">
                Choose a facility, date and configured term, then select Cells
                on the Warehouse Map. Capacity checks and quotes remain
                unavailable here until validated Cell selections are available.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <Message error={error} />
      {uncertain && (
        <Button asChild variant="outline">
          <Link to="/portal">Check My Storage</Link>
        </Button>
      )}
      <p className="text-sm text-slate-500">
        Managed V2 bookings do not require routine Manager approval. Activation
        follows Staff-confirmed first inbound after the required contract and
        balance steps. Legacy records retain their existing lifecycle.
      </p>
    </BackendScreen>
  );
}
