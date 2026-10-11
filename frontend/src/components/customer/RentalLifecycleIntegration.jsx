import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import reservationApi from "@/api/reservationApi";
import paymentApi from "@/api/paymentApi";
import contractApi from "@/api/contractApi";
import { accessApi } from "@/api/customerRentalApi";
import { Input } from "@/components/ui/input";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import {
  BackendScreen,
  Card,
  CardContent,
  Button,
  Link,
  Details,
  Message,
  LoadState,
  RentalSummary,
  RentalStatus,
  statusLabels,
  useBackend,
  rows,
  record,
  recordId,
  validId,
  rentalError,
  ConfirmAction,
} from "./RentalBackendUI";
export function RentalsIntegration() {
  const resource = useBackend((config) =>
      reservationApi.mineReal(config).then(rows),
    ),
    [filter, setFilter] = useState("");
  const records =
    resource.data?.filter((r) => !filter || r.status === filter) || [];
  return (
    <BackendScreen
      title="My Storage"
      description="Your backend reservations and rental lifecycle."
      action={
        <Button asChild variant="orange">
          <Link to="/portal/rent">Rent New Unit</Link>
        </Button>
      }
    >
      <LoadState resource={resource} />
      <label className="block field-label">
        Reservation status
        <select
          aria-label="Reservation status"
          className="customer-select mt-2"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All returned statuses</option>
          {[
            ...new Set(
              resource.data?.map((r) => r.status).filter(Boolean) || [],
            ),
          ].map((s) => (
            <option key={s} value={s}>
              {statusLabels[s] || s}
            </option>
          ))}
        </select>
      </label>
      {[
        ["Active Rentals", ["ACTIVE", "OVERDUE"]],
        ["Awaiting Handover", ["PAID"]],
        ["Rental History", ["CHECKED_OUT", "CLOSED"]],
        ["Reservations", ["RESERVED", "CONTRACTED", "CANCELLED"]],
      ].map(([title, statuses]) => {
        const group = records.filter((r) => statuses.includes(r.status));
        return (
          group.length > 0 && (
            <section key={title}>
              <h2 className="mb-4 text-xl font-bold">{title}</h2>
              <div className="space-y-4">
                {group.map((r) => (
                  <div key={recordId(r)}>
                    <RentalSummary item={r} />
                    {validId(recordId(r)) && (
                      <Link
                        className="mt-3 inline-block font-semibold text-brand"
                        to={`/portal/reservations/${recordId(r)}`}
                      >
                        View reservation
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        );
      })}
      {!resource.loading && !resource.error && !records.length && (
        <p>No reservations match your filter.</p>
      )}
      <p className="text-xs text-slate-500">
        Extensions, notifications, inventory and payment history remain separate
        demo/API-ready features.
      </p>
    </BackendScreen>
  );
}
const lifecycleInfo = {
  RESERVED:
    "Waiting for Facility Manager approval. Any deadline is shown only when returned by the backend.",
  CONTRACTED: "Approved. Review the available backend contract.",
  PAID: "Payment completed. Waiting for Facility Manager handover.",
  ACTIVE: "Rental active. Simulated access is available.",
  OVERDUE: "Rental overdue. Access is unavailable.",
  CHECKED_OUT: "Storage returned. Access is unavailable.",
  CLOSED: "Rental completed and archived.",
  CANCELLED: "Reservation cancelled. Payment and access are unavailable.",
};
export function ReservationDetailIntegration() {
  const params = useParams(), id=params.id||params.reservationId,
    resource = useBackend(
      (config) =>
        validId(id)
          ? reservationApi.detailReal(id, config).then(record)
          : Promise.reject(Error("Invalid reservation ID.")),
      [id],
    );
  return (
    <BackendScreen
      title="Reservation details"
      description="Current backend status is the source of truth."
    >
      <LoadState resource={resource} />
      {resource.data && (
        <>
          <RentalSummary item={resource.data} />
          <p>
            {lifecycleInfo[resource.data.status] ||
              "Status information is not available."}
          </p>
          <div className="flex flex-wrap gap-4">
            {['RESERVED','CONTRACTED'].includes(resource.data.status)&&<ConfirmAction label="Cancel reservation" onAction={async()=>{const token=getAccessToken();const result=record(await reservationApi.cancelReal(id));if(getAccessToken()!==token)return;if(result.status!=='CANCELLED')throw Error('Cancellation was not confirmed by the backend.');resource.retry();}}/>}
            <Button variant="outline" onClick={resource.retry}>
              Refresh status
            </Button>
            {resource.data.status === "CONTRACTED" && (
              <Button asChild>
                <Link to={`/portal/contracts/${id}`}>
                  View reservation contract
                </Link>
              </Button>
            )}
            {resource.data.status === "CONTRACTED" && (
              <Button asChild variant="outline">
                <Link to={`/portal/payments/${id}`}>
                  Review simulated payment
                </Link>
              </Button>
            )}
            {resource.data.status === "ACTIVE" && (
              <Button asChild>
                <Link to={`/portal/rentals/${id}/access`}>
                  Simulated unit access
                </Link>
              </Button>
            )}
          </div>
        </>
      )}
    </BackendScreen>
  );
}
export function ContractsIntegration() {
  const resource = useBackend((config) =>
    contractApi.mineReal(config).then(rows),
  );
  return (
    <BackendScreen
      title="Contracts & Sign"
      description="Review contracts returned by your backend account."
    >
      <LoadState resource={resource} />
      {resource.data?.map((c) => (
        <Card key={recordId(c)}>
          <CardContent>
            <h2 className="text-xl font-bold">
              {c.contractCode || "Storage rental contract"}
            </h2>
            <RentalStatus status={c.status} />
            {validId(recordId(c.reservationId)) && (
              <Button asChild className="mt-4">
                <Link to={`/portal/contracts/${recordId(c.reservationId)}`}>
                  Review contract
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
      {resource.data?.length === 0 && <p>No contracts returned.</p>}
      <p className="text-sm text-slate-500">The backend returns DRAFT and signed contracts. Facility Manager approval creates the draft.</p>
    </BackendScreen>
  );
}
export function ContractDetailIntegration() {
  const { reservationId } = useParams(),
    resource = useBackend(
      (config) => contractApi.mineReal(config).then(rows),
      [reservationId],
    );
  const contract = resource.data?.find(
    (c) => recordId(c.reservationId) === reservationId,
  );
  return (
    <BackendScreen
      title="Review rental contract"
      description="Owned contracts, including drafts, are retrieved from the backend."
    >
      <LoadState resource={resource} />
      {contract ? (
        <Card>
          <CardContent>
            <RentalStatus status={contract.status} />
            <Details
              values={[
                ["Contract number", contract.contractCode],
                ["Signed at", contract.signedByCustomerAt],
                ["Estimated rent",contract.pricingSnapshot?.estimatedRent],
                ["Deposit",contract.pricingSnapshot?.depositAmount],
                ["Terms version",contract.termsVersion],
              ]}
            />
            {typeof contract.content === "string" && (
              <p className="mt-5 whitespace-pre-wrap break-words text-sm">
                {contract.content}
              </p>
            )}
            {Array.isArray(contract.terms) && (
              <ul className="mt-5 list-disc space-y-3 pl-5 text-sm">
                {contract.terms
                  .filter((t) => typeof t === "string")
                  .map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
              </ul>
            )}
            {contract.status==='DRAFT'&&validId(recordId(contract))&&<ConfirmAction label="Sign Contract" onAction={async()=>{const token=getAccessToken();const result=record(await contractApi.signReal(recordId(contract)));if(getAccessToken()!==token)return;if(result.status!=='SIGNED'||recordId(result)!==recordId(contract))throw Error('Backend did not confirm this contract signature.');resource.retry();}}/>}
          </CardContent>
        </Card>
      ) : (
        !resource.loading &&
        !resource.error && (
          <p>
            Contract is not returned for this reservation. DRAFT retrieval may
            require a backend contract update.
          </p>
        )
      )}
    </BackendScreen>
  );
}
export function PaymentIntegration() {
  const { reservationId } = useParams(),
    resource = useBackend(
      (config) =>
        validId(reservationId)
          ? reservationApi.detailReal(reservationId, config).then(record)
          : Promise.reject(Error("Invalid reservation ID.")),
      [reservationId],
    );
  return (
    <BackendScreen
      title="Simulated Payment"
      description="Demo payment via the backend mock-pay endpoint. This is not a real PayOS transaction."
    >
      <LoadState resource={resource} />
      {resource.data && (
        <>
          <RentalSummary item={resource.data} />
          {resource.data.status === "PAID" ? (
            <Message success="Backend reservation status: Đã thanh toán." />
          ) : (
            <p className="text-sm text-slate-500">Demo payment is available for an owned CONTRACTED reservation. The current backend does not require a SIGNED contract; this lifecycle gap is recorded in the audit.</p>
          )}
          {resource.data.status==='CONTRACTED'&&<ConfirmAction label="Simulate Payment (Demo)" onAction={async()=>{const token=getAccessToken();const latest=record(await reservationApi.detailReal(reservationId));if(getAccessToken()!==token)return;if(latest.status!=='CONTRACTED')throw Error('Reservation status changed. Refresh before payment.');const result=record(await paymentApi.mockPayReal(reservationId));if(getAccessToken()!==token)return;if(result.status!=='PAID'||recordId(result)!==reservationId)throw Error('Backend did not confirm payment.');resource.retry();}}/>}
          <Button variant="outline" onClick={resource.retry}>
            Refresh payment status
          </Button>
        </>
      )}
    </BackendScreen>
  );
}
export function AccessIntegration() {
  const { id } = useParams(),
    session = useAuthSession();
  return <AccessForm key={`${session.accessToken}:${id}`} id={id} />;
}
function AccessForm({ id }) {
  const logs=useBackend(config=>accessApi.logs(config).then(rows),[id]);
  const resource = useBackend(
      (config) =>
        validId(id)
          ? reservationApi.detailReal(id, config).then(record)
          : Promise.reject(Error("Invalid reservation ID.")),
      [id],
    ),
    [pin, setPin] = useState(""),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    setPin("");
  }, [resource.data?.status]);
  const allowed =
    resource.data?.status === "ACTIVE" &&
    typeof resource.data.reservationCode === "string" &&
    !!resource.data.reservationCode.trim();
  async function unlock(event) {
    event.preventDefault();
    if (busy.current || !allowed || !pin.trim()) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    const token = getAccessToken();
    try {
      const latest = record(await reservationApi.detailReal(id));
      if (getAccessToken() !== token) return;
      if (
        latest.status !== "ACTIVE" ||
        latest.reservationCode !== resource.data.reservationCode
      )
        throw Error(
          "Access status changed. Refresh your rental before retrying.",
        );
      const response = await accessApi.unlock({
        reservationCode: latest.reservationCode,
        pinCode: pin.trim(),
      });
      if (getAccessToken() !== token) return;
      const body = response.data;
      if (body?.success !== true || body.data?.action!=='UNLOCK_SUCCESS' || recordId(body.data?.reservationId)!==id)
        throw Error("Backend did not confirm the simulated access request.");
      setMessage(
        "Backend confirmed UNLOCK_SUCCESS for this reservation. Simulated access only.",
      );
      resource.retry();
      logs.retry();
    } catch (e) {
      if (getAccessToken() === token) setError(e.response?.status===401&&e.response?.data?.data?.action==='UNLOCK_FAILED'?'The backend rejected the PIN. Please try again.':rentalError(e));
    } finally {
      setPin("");
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <BackendScreen
      title="Your unit access"
      description="Simulated IoT access only. This does not control a physical gate."
    >
      <LoadState resource={resource} />
      {resource.data && <RentalSummary item={resource.data} />}
      <Message error={error} />
      <Message success={message} />
      {resource.data && !allowed && (
        <p>
          Access unavailable for this reservation status or missing reservation
          code.
        </p>
      )}
      <form onSubmit={unlock} className="space-y-4">
        <label className="block">
          <span className="field-label">PIN code</span>
          <Input
            aria-label="PIN code"
            type="password"
            autoComplete="off"
            value={pin}
            disabled={!allowed || pending}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </label>
        <Button type="submit" disabled={!allowed || pending || !pin.trim()}>
          {pending ? "Submitting…" : "Simulate Unlock"}
        </Button>
      </form>
      <h2 className="text-xl font-bold">My simulated access history</h2><LoadState resource={logs}/>{logs.data?.filter(log=>recordId(log.reservationId)===id).map(log=><Card key={recordId(log)}><CardContent><p>{log.action} · {log.createdAt}</p></CardContent></Card>)}
    </BackendScreen>
  );
}
