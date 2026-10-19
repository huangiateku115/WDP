import ContractPrintAction from './ContractPrintAction';
import ManagedContractReview from './inventory/ManagedContractReview';
import CustomerBalancePayment from './CustomerBalancePayment';
import CustomerDepositPayment from './CustomerDepositPayment';
import {volumeText} from '@/lib/managedCellBooking';
import {eligibleInventoryRegistration} from '@/lib/inventoryRegistration';
import SelfStorageMockPayment,{SelfPaymentNavigation} from './SelfStorageMockPayment';
import {canPaySelfStorage} from '@/lib/selfStoragePayment';
import ManagedCellSummary from './warehouse/ManagedCellSummary';
import {clearMapAvailability} from './warehouse/ManagedCellBooking';
import {
  serviceType,
  serviceLabel,
  SELF_STORAGE,
  MANAGED_INVENTORY,
  liveHold,
  canCancel,
  canSign,
  canMockPay,
  contractAmounts,
  managedMockEnabled,
  isManagedV2,
  isLegacyManaged,
  hasLegacyRentalFlow,
  reservationLifecycle,
} from "@/lib/customerReservationService";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import reservationApi from "@/api/reservationApi";
import paymentApi from "@/api/paymentApi";
import managedReservationApi from "@/api/managedReservationApi";
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
  ManagedFinancialSummary,
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
function useCurrentTime() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
async function contractContext(reservationId, config) {
  if (!validId(reservationId)) throw Error("Invalid reservation ID.");
  const [contracts, reservation] = await Promise.all([
    contractApi.mineReal(config).then(rows),
    reservationApi.detailForCustomer(reservationId, config).then(record),
  ]);
  const owned = contracts.find(
    (c) => recordId(c.reservationId) === reservationId,
  );
  if (!owned) return { contract: null, reservation };
  const contract = record(
    await contractApi.detailReal(recordId(owned), config),
  );
  if (
    recordId(contract) !== recordId(owned) ||
    recordId(contract.reservationId) !== reservationId
  )
    throw Error("Contract does not match this reservation.");
  return { contract, reservation };
}
export function RentalsIntegration() {
  const resource = useBackend((config) =>
    reservationApi.mineReal(config).then(rows),
  ),
    [filter, setFilter] = useState(""),
    [service, setService] = useState("");
  const records =
    resource.data?.filter(
      (r) =>
        (!filter || r.status === filter) &&
        (!service ||
          (service === "UNKNOWN"
            ? !serviceType(r)
            : serviceType(r) === service)),
    ) || [];
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
        Storage service
        <select
          aria-label="Storage service"
          className="customer-select mt-2"
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">All services</option>
          <option value={SELF_STORAGE}>Self Storage</option>
          <option value={MANAGED_INVENTORY}>Managed Inventory</option>
          <option value="UNKNOWN">Unsupported / unknown</option>
        </select>
      </label>
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
              {s==='RESERVED'&&resource.data?.some(isManagedV2)?'RESERVED — see rental flow':statusLabels[s] || s}
            </option>
          ))}
        </select>
      </label>
      {[
        ["Active Rentals", ["ACTIVE", "OVERDUE"]],
        ["Awaiting activation / handover", ["PAID", "CHECKIN_READY"]],
        ["Rental History", ["CHECKED_OUT", "CLOSED"]],
        ["Reservations", ["RESERVED", "DEPOSIT_PAID", "CONTRACTED", "CANCELLED"]],
        [
          "Other returned statuses",
          records
            .map((r) => r.status)
            .filter(
              (status) =>
                ![
                  "ACTIVE",
                  "OVERDUE",
                  "PAID",
                  "CHECKIN_READY",
                  "DEPOSIT_PAID",
                  "CHECKED_OUT",
                  "CLOSED",
                  "RESERVED",
                  "CONTRACTED",
                  "CANCELLED",
                ].includes(status),
            ),
        ],
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
export function ReservationDetailIntegration() {
  const session = useAuthSession();
  const location = useLocation(),
    now = useCurrentTime();
  const params = useParams(),
    id = params.id || params.reservationId,
    resource = useBackend(
      (config) =>
        validId(id)
          ? reservationApi.detailForCustomer(id, config).then(record)
          : Promise.reject(Error("Invalid reservation ID.")),
      [id],
    );
  const paymentContracts = useBackend(config => serviceType(resource.data) === SELF_STORAGE ? contractApi.mineReal(config).then(rows) : Promise.resolve([]), [id, resource.data?.serviceType, resource.data?.status]);
  const paymentContract = paymentContracts.data?.find(c => recordId(c.reservationId) === id);
  const allocated=resource.data?.allocatedCapacity,used=resource.data?.usedCapacityM3;
  const capacityKnown=[allocated,used].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0);
  return (
    <BackendScreen
      title="Reservation details"
      description="Current backend status is the source of truth."
    >
      <LoadState resource={resource} />
      {location.state?.selfStorageCreated && (
        <Message success=" Waiting for management approval." />
      )}
      {location.state?.managedCreated && (
        <Message success={isManagedV2(resource.data) ? reservationLifecycle(resource.data).description : isLegacyManaged(resource.data) ? "Waiting for management approval." : undefined} />
      )}
      {resource.data && (
        <>
          <RentalSummary item={resource.data} localizeManagedV2 />
          {isManagedV2(resource.data)&&<Card><CardContent><h2 className="text-xl font-bold">Reservation capacity usage</h2><Details values={[["Allocated capacity",typeof allocated==='number'&&Number.isFinite(allocated)&&allocated>=0?volumeText(allocated):'Not returned'],["Used capacity",typeof used==='number'&&Number.isFinite(used)&&used>=0?volumeText(used):'Not returned'],["Remaining capacity",capacityKnown?volumeText(Math.max(0,allocated-used)):'Not available — capacity data is missing or invalid']]}/></CardContent></Card>}
          {isManagedV2(resource.data)&&<CustomerDepositPayment key={`deposit:${session.accessToken}:${id}`} reservation={resource.data} loadLatest={config=>reservationApi.detailForCustomer(id,config).then(record)} onReservationRefresh={resource.retry}/>}
          {isManagedV2(resource.data)&&<CustomerBalancePayment key={`${session.accessToken}:${id}`} reservation={resource.data} loadLatest={config=>contractContext(id,config)} onReservationRefresh={resource.retry}/>}
          <ManagedCellSummary reservation={resource.data}/>{isManagedV2(resource.data)&&<div className="flex flex-wrap gap-3">{eligibleInventoryRegistration(resource.data)&&<Button asChild variant="orange"><Link to={`/portal/inventory/register?reservationId=${id}`}>Register inventory item</Link></Button>}<Button asChild variant="outline"><Link to="/portal/inventory">View inventory items</Link></Button><Button asChild variant="outline"><Link to={`/portal/contracts/${id}`}>Review intake contract</Link></Button>{resource.data.status==='RESERVED'&&<p className="text-sm text-orange-700">Item registration becomes available after Backend confirms DEPOSIT_PAID.</p>}</div>}
          <p>
            {reservationLifecycle(resource.data).description}
          </p>
          {serviceType(resource.data) === MANAGED_INVENTORY &&
            ["RESERVED", "CONTRACTED"].includes(resource.data.status) &&
            !liveHold(resource.data, now) && (
              <p className="text-sm text-orange-700">
                The hold has expired or cannot be verified. Signing/payment are
                unavailable; the displayed backend status is unchanged.
              </p>
            )}
          {serviceType(resource.data) === SELF_STORAGE && <><LoadState resource={paymentContracts} /><SelfPaymentNavigation contract={paymentContract} reservation={resource.data} /></>}
          <div className="flex flex-wrap gap-4">
            {canCancel(resource.data) && (
              <ConfirmAction
                label="Cancel reservation"
                onAction={async () => {
                  const token = getAccessToken();
                  const latest = record(
                    await reservationApi.detailForCustomer(id),
                  );
                  if (getAccessToken() !== token) return;
                  if (
                    !canCancel(latest) ||
                    serviceType(latest) !== serviceType(resource.data)
                  )
                    throw Error(
                      "Reservation status or service changed. Refresh before cancelling.",
                    );
                  const result = record(
                    await reservationApi.cancelForService(latest),
                  );
                  if (getAccessToken() !== token) return;
                  if (result.status !== "CANCELLED" || recordId(result) !== id)
                    throw Error(
                      "Cancellation was not confirmed by the backend.",
                    );
                  if(serviceType(result)===MANAGED_INVENTORY)clearMapAvailability();
                  resource.retry();
                }}
              />
            )}
            <Button variant="outline" onClick={resource.retry}>
              Refresh status
            </Button>
            {hasLegacyRentalFlow(resource.data) &&
              [
                "CONTRACTED",
                "PAID",
                "ACTIVE",
                "OVERDUE",
                "CHECKED_OUT",
                "CLOSED",
              ].includes(resource.data.status) && (
                <Button asChild>
                  <Link to={`/portal/contracts/${id}`}>
                    View reservation contract
                  </Link>
                </Button>
              )}
            {isLegacyManaged(resource.data) && ["CONTRACTED", "PAID"].includes(resource.data.status) && (
              <Button asChild variant="outline"><Link to={`/portal/payments/${id}`}>Review simulated payment</Link></Button>
            )}
            {serviceType(resource.data) === SELF_STORAGE &&
              resource.data.status === "ACTIVE" && (
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
  const reservations = useBackend(config => reservationApi.mineReal(config).then(rows));
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
            <SelfPaymentNavigation contract={c} reservation={reservations.data?.find(r => recordId(r) === recordId(c.reservationId))} />
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
      <p className="text-sm text-slate-500">
        Legacy drafts follow the existing approval flow. Managed V2 contracts
        belong to physical intake; review the current content version before signing.
      </p>
    </BackendScreen>
  );
}
export function ContractDetailIntegration() {
  const nav = useNavigate(), session = useAuthSession();
  const [confirmedSignature, setConfirmedSignature] = useState(null), [signatureNotice, setSignatureNotice] = useState('');
  const { reservationId } = useParams(),
    now = useCurrentTime();
  const resource = useBackend(
    (config) => contractContext(reservationId, config),
    [reservationId],
  );
  useEffect(() => { setSignatureNotice(''); setConfirmedSignature(null); }, [reservationId, session.accessToken]);
  const contract = resource.data?.contract?.status === 'SIGNED' ? resource.data.contract : confirmedSignature?.id === reservationId && confirmedSignature?.token === session.accessToken ? confirmedSignature.contract : resource.data?.contract,
    reservation = resource.data?.reservation,
    amounts = contractAmounts(contract, reservation);
  if(isManagedV2(reservation)&&contract)return <BackendScreen title="Review rental contract" description="Review Backend content and sign during direct intake."><RentalStatus status={contract.status}/><ContractPrintAction contractId={recordId(contract)} reservationId={reservationId} v2/><ManagedContractReview customerView key={`${session.accessToken}:${JSON.stringify(contract)}`} contract={contract} reservation={reservation} loadLatest={()=>contractContext(reservationId)} onRefresh={resource.retry}/><Link className="text-brand" to={`/portal/reservations/${reservationId}`}>View reservation</Link></BackendScreen>;
  return (
    <BackendScreen
      title="Review rental contract"
      description="Owned contracts, including drafts, are retrieved from the backend."
    >
      <LoadState resource={resource} />
      <Message error={signatureNotice} />
      {contract ? (
        <Card>
          <CardContent>
            <RentalStatus status={contract.status} />
            <ContractPrintAction contractId={recordId(contract)} reservationId={reservationId}/>
            {isManagedV2(reservation)&&<ManagedFinancialSummary reservation={reservation}/>}
            <Details
              values={[
                ["Contract number", contract.contractCode],
                ["Signed at", contract.signedByCustomerAt],
                ["Service", serviceLabel(reservation)],
                ...(!isManagedV2(reservation)?[["Estimated rent", amounts.estimatedRent],["Deposit", amounts.depositAmount],["Total due", amounts.totalDue]]:[]),
                [
                  "Currency",
                  serviceType(reservation) === MANAGED_INVENTORY
                    ? contract.pricingSnapshot?.pricingRule?.currency
                    : undefined,
                ],
                ["Hold deadline", reservation?.expiresAt],
                ["Terms version", contract.termsVersion],
              ].filter(([, value]) => value != null)}
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
            {canSign(contract, reservation, now) &&
              validId(recordId(contract)) && (
                <ConfirmAction
                  label="Sign Contract"
                  onAction={async () => {
                    const token = getAccessToken();
                    const latest = await contractContext(reservationId);
                    if (getAccessToken() !== token) return;
                    if (
                      recordId(latest.contract) !== recordId(contract) ||
                      !canSign(latest.contract, latest.reservation)
                    )
                      throw Error(
                        "Contract or hold changed. Refresh before signing.",
                      );
                    const result = record(
                      await contractApi.signReal(recordId(contract)),
                    );
                    if (getAccessToken() !== token) return;
                    if (
                      result.status !== "SIGNED" ||
                      recordId(result) !== recordId(contract)
                    )
                      throw Error(
                        "Backend did not confirm this contract signature.",
                      );
                    if (latest.reservation.serviceType === SELF_STORAGE) {
                      setConfirmedSignature({ id: reservationId, token, contract: result });
                      const associatedId = recordId(result.reservationId) || recordId(latest.contract.reservationId);
                      resource.retry();
                      if (!validId(associatedId) || associatedId !== recordId(latest.reservation)) { setSignatureNotice('Contract signed. The associated reservation could not be verified; refresh before proceeding to payment.'); return; }
                      try { const refreshed = await contractContext(associatedId); if (getAccessToken() !== token) return; if (canPaySelfStorage(refreshed.reservation, refreshed.contract)) nav(`/portal/payments/${associatedId}`); }
                      catch (e) { if (getAccessToken() === token) setSignatureNotice('Contract signed. Refresh the contract/reservation to continue to payment.'); }
                    } else resource.retry();
                  }}
                />
              )}
            {contract.status === "DRAFT" &&
              !canSign(contract, reservation, now) && (
                <p className="mt-4 text-sm text-orange-700">
                  {isManagedV2(reservation)?'Managed V2 contract signing is not implemented in this phase. No signature can be submitted here.':'Signing unavailable: service, reservation status or Managed hold could not be confirmed.'}
                </p>
              )}
            <SelfPaymentNavigation contract={contract} reservation={reservation} />
            <Button variant="outline" className="mt-4" onClick={() => { setSignatureNotice(''); resource.retry(); }}>
              Refresh contract and reservation
            </Button>
            <Link
              className="mt-4 block text-brand"
              to={`/portal/reservations/${reservationId}`}
            >
              View reservation
            </Link>
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
  const session = useAuthSession();
  const { reservationId } = useParams(),
    now = useCurrentTime(),
    enabled = managedMockEnabled(import.meta.env);
  const [depositInitiated, setDepositInitiated] = useState(false);
  const depositKey = useRef(`managed-deposit-${reservationId}`);
  const resource = useBackend(
    (config) =>
      validId(reservationId)
        ? reservationApi.detailForCustomer(reservationId, config).then(record)
        : Promise.reject(Error("Invalid reservation ID.")),
    [reservationId],
  );
  const managed = serviceType(resource.data) === MANAGED_INVENTORY;
  const managedDeposit = isManagedV2(resource.data);
  const managedDepositEnabled = import.meta.env.DEV === true && import.meta.env.VITE_MI_MANAGED_DEPOSIT_FLOW_ENABLED === "true";
  const contracts = useBackend(
    (config) =>
      isLegacyManaged(resource.data) ? contractApi.mineReal(config).then(rows) : Promise.resolve([]),
    [reservationId, managed, managedDeposit, resource.data?.status],
  );
  const contract = contracts.data?.find(
    (c) => recordId(c.reservationId) === reservationId,
  );
  if (serviceType(resource.data) === SELF_STORAGE) return <SelfStorageMockPayment key={`${session.accessToken}:${reservationId}`} reservationId={reservationId} loadContext={contractContext} />;
  return (
    <BackendScreen
      title={managedDeposit ? "Managed V2 payment status" : "Simulated Payment"}
      description={managedDeposit ? "Read-only status. No payment action is implemented in this phase." : "Demo payment via the backend mock-pay endpoint. This is not a real PayOS transaction."}
    >
      <LoadState resource={resource} />
      {resource.data && (
        <>
          <RentalSummary item={resource.data} />
          {managedDeposit && (
            <Card><CardContent><h2 className="text-xl font-bold">Advance rent deposit</h2>
              <p className="mt-2 text-sm">The deposit is credited toward rent. Paying it reserves the selected Cells; it does not activate the rental or create a contract. Payment actions are unavailable in this phase.</p>
              <ManagedFinancialSummary reservation={resource.data}/>
              <p className="mt-3 text-sm">{reservationLifecycle(resource.data).description}</p>
              <p className="mt-3 text-sm text-slate-500">Deposit and balance actions are not available in this phase. Review intake signatures under Contracts. No payment can be submitted here.</p>
             </CardContent></Card>
          )}
          {!hasLegacyRentalFlow(resource.data) ? null : resource.data.status === "PAID" ? (
            <Message success="Backend reservation status: Đã thanh toán." />
          ) : (
            <p className="text-sm text-slate-500">
              {managed
                ? "Managed payment is simulated only. It requires a signed contract, a live hold, explicit frontend development opt-in and backend MI_MOCK_PAYMENT_ENABLED=true."
                : "Demo payment is available for an owned Self Storage CONTRACTED reservation."}
            </p>
          )}
          {isLegacyManaged(resource.data) && <LoadState resource={contracts} />}
          {isLegacyManaged(resource.data) && !enabled && (
            <p className="mt-4 text-sm text-orange-700">
              Managed mock payment is unavailable in this environment. No
              production payment API is provided.
            </p>
          )}
          {isLegacyManaged(resource.data) &&
            enabled &&
            !canMockPay(resource.data, contract, enabled, now) && (
              <p className="mt-4 text-sm text-orange-700">
                Managed simulation unavailable: a signed contract and an
                unexpired CONTRACTED hold are required.
              </p>
            )}
          {!serviceType(resource.data) && (
            <Message error="Unsupported service. Payment is unavailable." />
          )}
          {hasLegacyRentalFlow(resource.data) && canMockPay(resource.data, contract, enabled, now) && (
            <ConfirmAction
              label="Simulate Payment (Demo)"
              onAction={async () => {
                const token = getAccessToken();
                const latest = record(
                  await reservationApi.detailForCustomer(reservationId),
                );
                if (getAccessToken() !== token) return;
                let latestContract = null;
                if (serviceType(latest) === MANAGED_INVENTORY) {
                  latestContract = (
                    await contractApi.mineReal().then(rows)
                  ).find((c) => recordId(c.reservationId) === reservationId);
                  if (getAccessToken() !== token) return;
                }
                if (
                  serviceType(latest) !== serviceType(resource.data) ||
                  !canMockPay(latest, latestContract, enabled)
                )
                  throw Error(
                    "Reservation, signature or hold changed. Refresh before payment.",
                  );
                const result = record(
                  await paymentApi.mockPayForService(latest),
                );
                if (getAccessToken() !== token) return;
                if (
                  result.status !== "PAID" ||
                  recordId(result) !== reservationId
                )
                  throw Error("Backend did not confirm payment.");
                if(serviceType(result)===MANAGED_INVENTORY)clearMapAvailability();
                resource.retry();
                contracts.retry();
              }}
            />
          )}
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
  const logs = useBackend((config) => accessApi.logs(config).then(rows), [id]);
  const resource = useBackend(
    (config) =>
      validId(id)
        ? reservationApi.detailForCustomer(id, config).then(record)
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
    serviceType(resource.data) === SELF_STORAGE &&
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
        serviceType(latest) !== SELF_STORAGE ||
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
      if (
        body?.success !== true ||
        body.data?.action !== "UNLOCK_SUCCESS" ||
        recordId(body.data?.reservationId) !== id
      )
        throw Error("Backend did not confirm the simulated access request.");
      setMessage(
        "Backend confirmed UNLOCK_SUCCESS for this reservation. Simulated access only.",
      );
      resource.retry();
      logs.retry();
    } catch (e) {
      if (getAccessToken() === token)
        setError(
          e.response?.status === 401 &&
            e.response?.data?.data?.action === "UNLOCK_FAILED"
            ? "The backend rejected the PIN. Please try again."
            : rentalError(e),
        );
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
      <h2 className="text-xl font-bold">My simulated access history</h2>
      <LoadState resource={logs} />
      {logs.data
        ?.filter((log) => recordId(log.reservationId) === id)
        .map((log) => (
          <Card key={recordId(log)}>
            <CardContent>
              <p>
                {log.action} · {log.createdAt}
              </p>
            </CardContent>
          </Card>
        ))}
    </BackendScreen>
  );
}
