import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Screen, Panel, Details, Field, Input, Status, Button, Message } from "@/components/manager/ManagerUI";
import { AsyncBoundary, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { ReadOnlyValues } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { apiErrorMessage } from "@/lib/apiError";
import contractApi from "@/api/contractApi";

// Shared read-only contract workspace for BOM and Admin.
// The backend only exposes GET /contracts/:id (roles CUSTOMER, FACILITY_MANAGER, ADMIN, BOM)
// and GET /contracts/me (customer), so there is no cross-facility contract list to page
// through: the operator looks a contract up by the id returned by the reservation approval.
const OBJECT_ID = /^[a-f\d]{24}$/i;
const unwrap = (response) => response?.data?.data ?? null;
const day = (value) => (value ? String(value).slice(0, 10) : "—");

export default function ContractLookupPage({ basePath = "/admin/contracts" }) {
  const { id } = useParams();
  return <ContractLookup key={id || "lookup"} id={id || ""} basePath={basePath} />;
}

function ContractLookup({ id, basePath }) {
  const nav = useNavigate();
  const [draft, setDraft] = useState(id);
  const [invalid, setInvalid] = useState("");
  const state = useAsyncData(
    ({ signal }) => (id ? contractApi.detailReal(id, { signal }).then(unwrap) : Promise.resolve(null)),
    [id],
  );

  function open(event) {
    event.preventDefault();
    const next = draft.trim();
    if (!OBJECT_ID.test(next)) {
      setInvalid("Enter the 24-character contract id (ObjectId) from the backend.");
      return;
    }
    setInvalid("");
    if (next === id) state.reload();
    else nav(`${basePath}/${next}`);
  }

  return (
    <Screen
      title="Contract lookup"
      description="Read-only contract record by id. The backend exposes no contract collection for staff roles, so a contract is opened from the id returned when a reservation is approved."
      notice={LIVE_NOTICE}
      action={<Button variant="outline" onClick={() => { setDraft(""); setInvalid(""); nav(basePath); }}>Clear</Button>}
    >
      <Panel
        title="Contract id"
        subtitle="Contract ids are created as CTR-<reservationCode>; the document id is the ObjectId below."
      >
        <form className="bom-form" onSubmit={open}>
          <div className="manager-filters">
            <Field label="Contract document id" hint="24 hexadecimal characters">
              <Input
                aria-label="Contract document id"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setInvalid(""); }}
                placeholder="68f1c0a2b4e9d30012ab34cd"
              />
            </Field>
          </div>
          <Message error={invalid} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Open contract</Button>
          </div>
        </form>
      </Panel>

      {id && (
        <AsyncBoundary
          state={state}
          render={(contract) => (contract ? <ContractRecord contract={contract} /> : null)}
        />
      )}
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
          Contract snapshots are frozen copies captured when the reservation was approved, so they intentionally keep the
          customer and pricing values of that moment.
        </p>
      </Panel>

      <Panel title="Customer snapshot" subtitle="Immutable copy stored on the contract at approval time.">
        <ReadOnlyValues value={customer} />
      </Panel>

      <Panel title="Pricing snapshot" subtitle="Immutable estimate stored on the contract at approval time.">
        <ReadOnlyValues value={pricing} />
      </Panel>
    </>
  );
}
