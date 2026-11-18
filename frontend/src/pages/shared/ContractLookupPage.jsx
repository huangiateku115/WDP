import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Screen, Panel, Table, Details, Field, Input, Select, Status, Button, Message, money } from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAuthSession } from "@/lib/authSession";
import { loadFacilities, loadFacilityReservations, loadContractForReservation } from "@/lib/bomApiData";
import { apiErrorMessage } from "@/lib/apiError";
import contractApi from "@/api/contractApi";
import { serviceLabel } from "@/lib/bomMappers";

// Shared contract workspace for BOM and Admin.
// The backend exposes no contract collection, only GET /contracts/:id and
// GET /contracts/reservation/:reservationId. A contract is therefore discovered through one of
// the facility reservations and opened on its own detail route; the page never fans out one
// contract request per reservation and never asks the user to type an ObjectId.
const RESERVATION_STATUSES = ["RESERVED", "DEPOSIT_PAID", "CHECKIN_READY", "CONTRACTED", "PAID", "ACTIVE", "OVERDUE", "CHECKED_OUT", "CLOSED", "CANCELLED"];
const unwrap = (response) => response?.data?.data ?? null;
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const addressText = (address) => {
  if (!address) return "—";
  if (typeof address === "string") return address;
  return [address.line1, address.ward, address.district, address.city, address.country].filter(Boolean).join(", ") || "—";
};
// A 24-hex ObjectId is not readable on screen, so it is shortened to its last 6 characters.
const shortRef = (value) => {
  const text = String(value);
  return /^[0-9a-f]{24}$/i.test(text) ? `#${text.slice(-6)}` : text;
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
  if (depositPolicy) rows.push(["Deposit policy", `${depositPolicy.percentage ?? "—"}% giá trị tiền thuê${depositPolicy.version ? ` · v${depositPolicy.version}` : ""}`]);
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
    rows.push(["Selected cells", `${pricing.selectedCells.length} ô · ${volume.toFixed(3)} m³`]);
  }
  // The pricing policy is a reference, not a value: an ObjectId means nothing to the reader, so
  // only a short handle is printed. Unknown snapshot fields are dropped instead of being turned
  // into English labels by splitting the camelCase key.
  if (pricing.pricingPolicyId) rows.push(["Pricing policy", shortRef(pricing.pricingPolicyId)]);
  if (pricing.capacityBookingVersion) rows.push(["Version", `v${pricing.capacityBookingVersion}`]);
  return rows.length ? rows : [["Pricing", "Hợp đồng chưa chốt giá trị giá nào."]];
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
      if (!contract.id) throw new Error("Không mở được hợp đồng.");
      nav(`${basePath}/${contract.id}`);
    } catch (error) {
      setFeedback({ error: apiErrorMessage(error, "No contract is available for this reservation yet.") });
    } finally {
      setOpening("");
    }
  }

  return (
    <Screen
      title="Hợp đồng"
      description="Mở đơn đặt thuê của cơ sở để xem hợp đồng đã lập khi đơn được duyệt. Trang chi tiết hợp đồng mở riêng."
      action={<Button variant="outline" disabled={reservations.loading} onClick={reservations.reload}>Tải lại</Button>}
    >
      <Panel
        title="Tìm hợp đồng qua đơn đặt thuê"
        subtitle={facilityId ? `${rows.length} / ${(reservations.data || []).length} đơn` : "Chọn một cơ sở để tải danh sách đơn."}
      >
        <div className="manager-filters">
          {!facilityScoped && (
            <Field label="Cơ sở">
              <Select
                label="Cơ sở của hợp đồng"
                value={facilityId}
                onChange={selectFacility}
                options={[["", "Chọn cơ sở"], ...(directory.data || []).map((facility) => [facility.id, `${facility.name} (${facility.code})`])]}
              />
            </Field>
          )}
          <Field label="Trạng thái đơn">
            <Select
              label="Lọc theo trạng thái đơn"
              value={status}
              onChange={setStatus}
              disabled={!facilityId}
              options={[["", "Tất cả trạng thái"], ...RESERVATION_STATUSES.map((value) => [value, value.replaceAll("_", " ")])]}
            />
          </Field>
          <Field label="Tìm kiếm" hint="Mã đơn hoặc tên khách hàng.">
            <Input
              aria-label="Tìm hợp đồng theo đơn"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={!facilityId}
            />
          </Field>
        </div>
        {facilityScoped && <p className="mb-4 text-sm text-slate-500">Chỉ hiển thị đơn của cơ sở bạn được phân công.</p>}
        <Message {...feedback} />

        {!facilityId ? (
          <p className="text-sm text-slate-500">Hãy chọn cơ sở trước. Hợp đồng được mở theo từng đơn đặt thuê.</p>
        ) : (
          <AsyncBoundary state={reservations} render={() => (
            <Table
              label="Đơn đặt thuê"
              rows={rows}
              columns={[
                { key: "code", label: "Reservation", render: (row) => row.code || row.id },
                { key: "customer", label: "Customer", render: (row) => row.customerName },
                // reservationFromDto exposes the service model as `service`; `serviceType` is kept
                // as a fallback for raw backend rows.
                { key: "service", label: "Service", render: (row) => serviceLabel(row.service || row.serviceType) },
                { key: "window", label: "Rental window", render: (row) => `${day(row.startDate)} → ${day(row.endDate)}` },
                { key: "status", label: "Reservation status", render: (row) => <Status value={row.status} /> },
                {
                  key: "contract", label: "Contract",
                  render: (row) => (
                    <Button variant="outline" size="sm" disabled={opening === row.id} onClick={() => openContract(row.id)}>
                      {opening === row.id ? "Đang mở…" : "Mở hợp đồng"}
                    </Button>
                  ),
                },
              ]}
              empty="Không có đơn phù hợp bộ lọc hiện tại."
            />
          )} />
        )}
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
      title="Chi tiết hợp đồng"
      description="Bản ghi hợp đồng với các giá trị được chốt tại thời điểm duyệt đơn."
      action={<Button variant="outline" onClick={() => nav(basePath)}>Quay lại danh sách hợp đồng</Button>}
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
        title="Hồ sơ hợp đồng"
        subtitle={contract.contractCode || "Hợp đồng"}
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
      </Panel>

      <Panel title="Thông tin khách hàng">
        <Details values={customerRows(customer)} />
      </Panel>

      <Panel title="Giá và thanh toán">
        <Details values={pricingRows(pricing)} />
      </Panel>
    </>
  );
}
