import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Screen, Panel, Table, Details, Field, Input, Select, Status, Button, Message, money } from "@/components/manager/ManagerUI";
import { AsyncBoundary, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAuthSession } from "@/lib/authSession";
import { loadFacilities, loadFacilityReservations, loadContractForReservation } from "@/lib/bomApiData";
import { apiErrorMessage } from "@/lib/apiError";
import contractApi from "@/api/contractApi";

// Shared contract workspace for BOM and Admin.
// The backend exposes no contract collection, only GET /contracts/:id and
// GET /contracts/reservation/:reservationId. A contract is therefore discovered through one of
// the facility reservations and opened on its own detail route; the page never fans out one
// contract request per reservation and never asks the user to type an ObjectId.
const RESERVATION_STATUSES = ["RESERVED", "DEPOSIT_PAID", "CHECKIN_READY", "CONTRACTED", "PAID", "ACTIVE", "OVERDUE", "CHECKED_OUT", "CLOSED", "CANCELLED"];
const unwrap = (response) => response?.data?.data ?? null;
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const labelize = (key) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
const addressText = (address) => {
  if (!address) return "—";
  if (typeof address === "string") return address;
  return [address.line1, address.ward, address.district, address.city, address.country].filter(Boolean).join(", ") || "—";
};
const customerRows = (customer = {}) => [
  ["Full name", customer.fullName || customer.displayName || "—"],
  ["Email", customer.email || "—"],
  ["Phone", customer.phone || "—"],
  ["ID card", customer.identityCard || "—"],
  ["Tax code", customer.taxCode || "—"],
  ["Address", addressText(customer.address)],
];
// Contract snapshots mix self-storage fields with the Managed pricing object, so known fields
// are rendered with labels and money formatting instead of dumping raw JSON.
const pricingRows = (pricing = {}) => {
  const rows = [];
  const amount = pricing.amountBreakdown && typeof pricing.amountBreakdown === "object" ? pricing.amountBreakdown : pricing;
  const rule = pricing.pricingRule && typeof pricing.pricingRule === "object" ? pricing.pricingRule : null;
  const depositPolicy = pricing.depositPolicy && typeof pricing.depositPolicy === "object" ? pricing.depositPolicy : null;
  const term = pricing.term && typeof pricing.term === "object" ? pricing.term : null;
  if (pricing.quotaM3 !== undefined && pricing.quotaM3 !== null) rows.push(["Allocated quota", `${pricing.quotaM3} m³`]);
  if (term?.value) rows.push(["Rental term", `${term.value} ${String(term.unit || "").toLowerCase()}`]);
  if (pricing.startDate || pricing.endDate) rows.push(["Rental window", `${day(pricing.startDate)} → ${day(pricing.endDate)}`]);
  if (rule) rows.push(["Rate", `${money(rule.ratePerM3)} / m³${rule.version ? ` · v${rule.version}` : ""}`]);
  if (depositPolicy) rows.push(["Deposit policy", `${depositPolicy.percentage ?? "—"}% of rent${depositPolicy.version ? ` · v${depositPolicy.version}` : ""}`]);
  const amounts = [
    ["estimatedRent", "Estimated rent"],
    ["depositAmount", "Deposit"],
    ["taxAmount", "Tax"],
    ["discountAmount", "Discount"],
    ["totalDue", "Total due"],
    ["depositCredit", "Deposit credit"],
    ["balanceDue", "Balance due"],
  ];
  amounts.forEach(([key, label]) => {
    if (amount?.[key] !== undefined && amount[key] !== null) rows.push([label, money(amount[key])]);
  });
  if (Array.isArray(pricing.selectedCells) && pricing.selectedCells.length) {
    const volume = pricing.selectedCells.reduce((sum, cell) => sum + Number(cell.volumeM3 || 0), 0);
    rows.push(["Selected cells", `${pricing.selectedCells.length} cell(s) · ${volume.toFixed(3)} m³`]);
  }
  const known = new Set([
    "quotaM3", "term", "startDate", "endDate", "pricingRule", "depositPolicy", "amountBreakdown", "selectedCells",
    "capacityBookingVersion", ...amounts.map(([key]) => key),
  ]);
  Object.entries(pricing).forEach(([key, value]) => {
    if (known.has(key) || value === null || value === undefined || typeof value === "object") return;
    rows.push([key === "pricingPolicyId" ? "Pricing policy" : labelize(key), String(value)]);
  });
  return rows.length ? rows : [["Pricing", "No pricing values were captured."]];
};

export default function ContractLookupPage({ basePath = "/admin/contracts" }) {
  const { id } = useParams();
  return id
    ? <ContractDetail key={id} id={id} basePath={basePath} />
    : <ContractList basePath={basePath} />;
}

function ContractList({ basePath }) {
  const nav = useNavigate();
  const { user } = useAuthSession();
  const facilityScoped = user?.role === "FACILITY_MANAGER" || user?.role === "FACILITY_STAFF";
  const assignedFacility = typeof user?.assignedFacilityId === "string"
    ? user.assignedFacilityId
    : user?.assignedFacilityId?._id || "";
  // Facility roles never need the facility directory: their reservations are already scoped.
  const directory = useAsyncData(
    () => (facilityScoped ? Promise.resolve([]) : loadFacilities()),
    [facilityScoped],
  );
  const [facilityId, setFacilityId] = useState(assignedFacility);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState("");
  const [feedback, setFeedback] = useState({});

  // One collection request per selected facility. The contract is resolved only for the
  // reservation the user opens, so there is no per-row contract request and no N+1 fan-out.
  const reservations = useAsyncData(
    ({ signal }) => (facilityId ? loadFacilityReservations(facilityId, { signal }) : Promise.resolve([])),
    [facilityId],
  );
  const rows = (reservations.data || []).filter((row) => {
    if (status && row.status !== status) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return String(row.code || "").toLowerCase().includes(needle) || String(row.customerName || "").toLowerCase().includes(needle);
  });

  function selectFacility(id) {
    setFacilityId(id);
    setStatus("");
    setSearch("");
    setFeedback({});
  }

  async function openContract(reservationId) {
    setOpening(reservationId);
    setFeedback({});
    try {
      const contract = await loadContractForReservation(reservationId);
      if (!contract.id) throw new Error("The backend returned a contract without an id.");
      nav(`${basePath}/${contract.id}`);
    } catch (error) {
      setFeedback({ error: apiErrorMessage(error, "No contract is available for this reservation yet.") });
    } finally {
      setOpening("");
    }
  }

  return (
    <Screen
      title="Contracts"
      description="Open a facility reservation to review the contract captured when it was approved. Contract detail stays on its own route."
      notice={LIVE_NOTICE}
      action={<Button variant="outline" disabled={reservations.loading} onClick={reservations.reload}>Refresh</Button>}
    >
      <Panel
        title="Find a contract through its reservation"
        subtitle={facilityId ? `${rows.length} of ${(reservations.data || []).length} reservation(s) shown` : "Select a facility to load its reservations."}
      >
        <div className="manager-filters">
          {!facilityScoped && (
            <Field label="Facility">
              <Select
                label="Contract facility"
                value={facilityId}
                onChange={selectFacility}
                options={[["", "Select a facility"], ...(directory.data || []).map((facility) => [facility.id, `${facility.name} (${facility.code})`])]}
              />
            </Field>
          )}
          <Field label="Reservation status">
            <Select
              label="Reservation status filter"
              value={status}
              onChange={setStatus}
              disabled={!facilityId}
              options={[["", "All statuses"], ...RESERVATION_STATUSES.map((value) => [value, value.replaceAll("_", " ")])]}
            />
          </Field>
          <Field label="Search" hint="Reservation code or customer name.">
            <Input
              aria-label="Search contracts by reservation"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={!facilityId}
            />
          </Field>
        </div>
        {facilityScoped && <p className="mb-4 text-sm text-slate-500">The backend narrows the reservation collection to your assigned facility.</p>}
        <Message {...feedback} />

        {!facilityId ? (
          <p className="text-sm text-slate-500">Choose a facility first. Contracts cannot be listed globally because the backend has no contract collection endpoint.</p>
        ) : (
          <AsyncBoundary state={reservations} render={() => (
            <Table
              label="Reservations"
              rows={rows}
              columns={[
                { key: "code", label: "Reservation", render: (row) => row.code || row.id },
                { key: "customer", label: "Customer", render: (row) => row.customerName },
                // reservationFromDto exposes the service model as `service`; `serviceType` is kept
                // as a fallback for raw backend rows.
                { key: "service", label: "Service", render: (row) => (row.service || row.serviceType || "—").replaceAll("_", " ") },
                { key: "window", label: "Rental window", render: (row) => `${day(row.startDate)} → ${day(row.endDate)}` },
                { key: "status", label: "Reservation status", render: (row) => <Status value={row.status} /> },
                {
                  key: "contract", label: "Contract",
                  render: (row) => (
                    <Button variant="outline" size="sm" disabled={opening === row.id} onClick={() => openContract(row.id)}>
                      {opening === row.id ? "Opening…" : "Open contract"}
                    </Button>
                  ),
                },
              ]}
              empty="No reservation matches the current filters."
            />
          )} />
        )}
      </Panel>

      <Panel title="Backend surface" subtitle="Nothing is requested until a reservation is opened.">
        <Details values={[
          ["Reservation list", "GET /reservations/facility/:facilityId — one request per selected facility."],
          ["Contract lookup", "GET /contracts/reservation/:reservationId — one request for the reservation you open."],
          ["Missing API", "GET /contracts (collection with code/status/facility filters) — needed to search contracts directly across facilities."],
        ]} />
      </Panel>
    </Screen>
  );
}

function ContractDetail({ id, basePath }) {
  const nav = useNavigate();
  const state = useAsyncData(
    ({ signal }) => contractApi.detailReal(id, { signal }).then(unwrap),
    [id],
  );
  return (
    <Screen
      title="Contract detail"
      description="Read-only contract record. Customer and pricing values are copies captured at approval time."
      notice={LIVE_NOTICE}
      action={<Button variant="outline" onClick={() => nav(basePath)}>Back to contracts</Button>}
    >
      <AsyncBoundary
        state={state}
        render={(contract) => (contract ? <ContractRecord contract={contract} /> : null)}
      />
    </Screen>
  );
}

function ContractRecord({ contract }) {
  const reservation = typeof contract.reservationId === "object" ? contract.reservationId : null;
  const customer = contract.customerSnapshot || {};
  const pricing = contract.pricingSnapshot || {};

  return (
    <>
      <Panel
        title="Contract record"
        subtitle={contract.contractCode || "Contract"}
        action={<Status value={contract.status} />}
      >
        <Details values={[
          ["Contract code", contract.contractCode || "—"],
          ["Status", contract.status || "—"],
          ["Terms version", contract.termsVersion || "—"],
          ["Customer", customer.fullName || customer.displayName || customer.email || String(contract.customerId || "—")],
          ["Reservation code", reservation?.reservationCode || "—"],
          ["Reservation status", reservation?.status || "—"],
          ["Service model", reservation?.serviceType || "—"],
          ["Rental window", reservation ? `${day(reservation.startDate)} → ${day(reservation.endDate)}` : "—"],
          ["Signed by customer", day(contract.signedByCustomerAt)],
          ["Signed by manager", day(contract.signedByFMAt)],
          ["Created", day(contract.createdAt)],
          ["Last updated", day(contract.updatedAt)],
        ]} />
        <p className="bom-warning mt-5">
          These values were frozen when the reservation was approved. Later pricing or customer changes do not rewrite this contract.
        </p>
      </Panel>

      <Panel title="Customer information" subtitle="Captured at approval time.">
        <Details values={customerRows(customer)} />
      </Panel>

      <Panel title="Pricing & payment" subtitle="Amounts captured at approval time.">
        <Details values={pricingRows(pricing)} />
      </Panel>
    </>
  );
}
