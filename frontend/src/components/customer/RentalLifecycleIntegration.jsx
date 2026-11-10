import LoadState from './CustomerResourceState';
import { PortalSummaryCards, PortalEmptyState, PortalTextLink } from './CustomerPortalUI';
import ContractPrintAction from './ContractPrintAction';
import ManagedContractReview from './inventory/ManagedContractReview';
import CustomerBalancePayment from './CustomerBalancePayment';
import CustomerDepositPayment from './CustomerDepositPayment';
import { volumeText } from '@/lib/managedCellBooking';
import { eligibleInventoryRegistration } from '@/lib/inventoryRegistration';
import SelfStoragePayosCheckout from './SelfStoragePayosCheckout';
import { SelfPaymentNavigation } from './CustomerPaymentNavigation';
import { eligiblePayosPurpose, normalizePayosReferenceId } from '@/lib/selfStoragePayos';
import ManagedCellSummary from './warehouse/ManagedCellSummary';
import { clearMapAvailability } from './warehouse/ManagedCellBooking';
import {
  serviceType,
  serviceLabel,
  SELF_STORAGE,
  MANAGED_INVENTORY,
  liveHold,
  canCancel,
  canSign,
  contractAmounts,
  isManagedV2,
  isManagedV3,
  isLegacyManaged,
  hasLegacyRentalFlow,
  reservationLifecycle,
} from "@/lib/customerReservationService";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import reservationApi from "@/api/reservationApi";
import managedReservationApi from "@/api/managedReservationApi";
import contractApi from "@/api/contractApi";
import facilityApi from "@/api/facilityApi";
import storageApi from "@/api/storageApi";
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
  const reservation = record(await reservationApi.detailForCustomer(reservationId, config));
  if (normalizePayosReferenceId(reservation) !== normalizePayosReferenceId(reservationId)) throw Error("Reservation does not match this payment route.");
  const contract = await loadSelfStorageContract(reservationId, normalizePayosReferenceId(reservation.customerId), config);
  return { contract, reservation };
}
async function loadSelfStorageReservation(reservationId, config) {
  if (!validId(reservationId)) throw Error("Invalid reservation ID.");
  const reservation = record(await reservationApi.detailForCustomer(reservationId, config));
  if (normalizePayosReferenceId(reservation) !== normalizePayosReferenceId(reservationId) || serviceType(reservation) !== SELF_STORAGE) {
    throw Error("The owned Self Storage reservation could not be verified.");
  }
  return reservation;
}
async function loadSelfStorageContract(reservationId, customerId, config) {
  try {
    const contract = record(await contractApi.byReservationReal(reservationId, config));
    if (normalizePayosReferenceId(contract.reservationId) !== normalizePayosReferenceId(reservationId)) {
      throw Error("The contract does not match this Reservation. Payment is unavailable.");
    }
    if (!normalizePayosReferenceId(customerId) ||
      normalizePayosReferenceId(contract.customerId) !== normalizePayosReferenceId(customerId)) {
      throw Error("Contract ownership could not be verified. Payment is unavailable.");
    }
    return contract;
  } catch (error) {
    if (error.response?.status === 404) return null;
    if (error.message?.includes("does not match this Reservation") ||
      error.message?.includes("ownership could not be verified")) throw error;
    throw Error("The reservation is saved, but its contract could not be loaded. Retry here; you do not need to book again.");
  }
}
async function loadSelfStorageOverview(reservation, config) {
  const facilityId = recordId(reservation.facilityId);
  const unitId = recordId(reservation.storageUnitId);
  const overview = { facility: null, unit: null, estimate: null, error: "" };
  try {
    const [facilityResponse, unitResponse] = await Promise.all([
      facilityApi.publicDetail(facilityId, config),
      storageApi.unitDetail(unitId, config),
    ]);
    const facility = record(facilityResponse);
    const unit = record(unitResponse);
    const durationMs = Date.parse(reservation.endDate) - Date.parse(reservation.startDate);
    const durationDays = Number.isFinite(durationMs) && durationMs > 0 ? Math.ceil(durationMs / 86_400_000) : null;
    const estimate = {
      estimatedRent: reservation.estimatedRent, depositAmount: reservation.depositAmount,
      taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0, durationDays
    };
    if (recordId(facility) === facilityId && recordId(unit) === unitId && recordId(unit.facilityId) === facilityId) Object.assign(overview, { facility, unit, estimate });
    else overview.error = "Facility or StorageUnit details did not match the owned Reservation.";
  } catch {
    overview.error = "Facility or StorageUnit details could not be loaded. The verified reservation and payment status remain available.";
  }
  return overview;
}
async function selfStoragePaymentContext(reservationId, config) {
  const reservation = await loadSelfStorageReservation(reservationId, config);
  const customerId = normalizePayosReferenceId(reservation.customerId);
  const [contract, rentalOverview] = await Promise.all([
    loadSelfStorageContract(reservationId, customerId, config),
    loadSelfStorageOverview(reservation, config),
  ]);
  return { contract, reservation, rentalOverview };
}
async function managedV3PaymentContext(reservationId, config) {
  const reservation = record(await managedReservationApi.detail(reservationId, config));
  if (recordId(reservation) !== normalizePayosReferenceId(reservationId) || reservation.serviceType !== MANAGED_INVENTORY || reservation.bookingFlowVersion !== 3) throw Error("The owned Managed V3 reservation could not be verified.");
  const customerId = normalizePayosReferenceId(reservation.customerId);
  const contract = await loadSelfStorageContract(reservationId, customerId, config);
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
      title="Kho lưu trữ của tôi"
      description="Quản lý các kho và đơn thuê của bạn."
      notice="Các thao tác khả dụng tùy theo trạng thái của từng đơn thuê."
      action={
        <Button asChild variant="orange">
          <Link to="/portal/rent">Thuê kho mới</Link>
        </Button>
      }
    >
      <LoadState resource={resource} />
      {resource.data && !resource.error && <PortalSummaryCards items={[{ label: "Đang thuê", value: resource.data.filter(r => r.status === 'ACTIVE').length }, { label: "Cần xử lý", value: resource.data.filter(r => ['PAID', 'CHECKIN_READY'].includes(r.status)).length }, { label: "Tổng đơn thuê", value: resource.data.length }]} />}
      <div className="portal-filter-bar">
        <label className="block field-label">
          Loại dịch vụ
          <select
            aria-label="Loại dịch vụ"
            className="customer-select mt-2"
            value={service}
            onChange={(e) => setService(e.target.value)}
          >
            <option value="">Tất cả dịch vụ</option>
            <option value={SELF_STORAGE}>Self Storage</option>
            <option value={MANAGED_INVENTORY}>Managed Inventory</option>
            <option value="UNKNOWN">Khác</option>
          </select>
        </label>
        <label className="block field-label">
          Trạng thái
          <select
            aria-label="Trạng thái đơn thuê"
            className="customer-select mt-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {[
              ...new Set(
                resource.data?.map((r) => r.status).filter(Boolean) || [],
              ),
            ].map((s) => (
              <option key={s} value={s}>
                {s === 'RESERVED' && resource.data?.some(isManagedV2) ? 'Đã đặt chỗ' : statusLabels[s] || s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {[
        ["Đang thuê", ["ACTIVE", "OVERDUE"]],
        ["Chờ bàn giao", ["PAID", "CHECKIN_READY"]],
        ["Lịch sử thuê", ["CHECKED_OUT", "CLOSED"]],
        ["Đơn thuê", ["RESERVED", "DEPOSIT_PAID", "CONTRACTED", "CANCELLED"]],
        [
          "Trạng thái khác",
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
            <section key={title} className="portal-rental-group">
              <h2 className="mb-4 text-xl font-bold">{title}</h2>
              <div className="portal-rental-grid space-y-4">
                {group.map((r) => (
                  <div key={recordId(r)}>
                    <RentalSummary item={r} localizeManagedV2 />
                    {validId(recordId(r)) && (
                    <PortalTextLink to={`/portal/reservations/${recordId(r)}`}>Xem chi tiết</PortalTextLink>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        );
      })}
      {!resource.loading && !resource.error && !records.length && (
        <PortalEmptyState title="Không có đơn thuê phù hợp." description="Hãy thử chọn loại dịch vụ hoặc trạng thái khác, hoặc tìm kho mới." />
      )}
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
  const allocated = resource.data?.allocatedCapacity, used = resource.data?.usedCapacityM3;
  const capacityKnown = [allocated, used].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return (
    <BackendScreen
      title="Reservation details"
      description="Current backend status is the source of truth."
    >
      <LoadState resource={resource} />
      {location.state?.selfStorageCreated && (
        <Message success="Self Storage booking confirmed. The advance-rent Deposit is pending; continue from the PayOS payment page." />
      )}
      {location.state?.managedCreated && (
        <Message success={isManagedV2(resource.data) || isManagedV3(resource.data) ? reservationLifecycle(resource.data).description : isLegacyManaged(resource.data) ? "Waiting for management approval." : undefined} />
      )}
      {resource.data && (
        <>
          <RentalSummary item={resource.data} localizeManagedV2 />
          {isManagedV2(resource.data) && <Card><CardContent><h2 className="text-xl font-bold">Reservation capacity usage</h2><Details values={[["Allocated capacity", typeof allocated === 'number' && Number.isFinite(allocated) && allocated >= 0 ? volumeText(allocated) : 'Not returned'], ["Used capacity", typeof used === 'number' && Number.isFinite(used) && used >= 0 ? volumeText(used) : 'Not returned'], ["Remaining capacity", capacityKnown ? volumeText(Math.max(0, allocated - used)) : 'Not available — capacity data is missing or invalid']]} /></CardContent></Card>}
          {isManagedV2(resource.data) && <CustomerDepositPayment key={`deposit:${session.accessToken}:${id}`} reservation={resource.data} loadLatest={config => reservationApi.detailForCustomer(id, config).then(record)} onReservationRefresh={resource.retry} />}
          {isManagedV2(resource.data) && <CustomerBalancePayment key={`${session.accessToken}:${id}`} reservation={resource.data} loadLatest={config => contractContext(id, config)} onReservationRefresh={resource.retry} />}
          <ManagedCellSummary reservation={resource.data} />{isManagedV2(resource.data) && <div className="flex flex-wrap gap-3">{eligibleInventoryRegistration(resource.data) && <Button asChild variant="orange"><Link to={`/portal/inventory/register?reservationId=${id}`}>Register inventory item</Link></Button>}<Button asChild variant="outline"><Link to="/portal/inventory">View inventory items</Link></Button><Button asChild variant="outline"><Link to={`/portal/payments/${id}`}>Deposit and balance</Link></Button><Button asChild variant="outline"><Link to={`/portal/contracts/${id}`}>Review intake contract</Link></Button>{resource.data.status === 'RESERVED' && <p className="text-sm text-orange-700">Item registration becomes available after Backend confirms DEPOSIT_PAID.</p>}</div>}
          {isManagedV3(resource.data) && <div className="flex flex-wrap gap-3">{['RESERVED','DEPOSIT_PAID'].includes(resource.data.status)&&<Button asChild variant="orange"><Link to={`/portal/payments/${id}`}>{resource.data.status==='RESERVED'?'Pay advance rent with PayOS':'Review balance payment'}</Link></Button>}{['DEPOSIT_PAID','PAID','ACTIVE'].includes(resource.data.status)&&<Button asChild variant="outline"><Link to={`/portal/contracts/${id}`}>Review Managed V3 contract</Link></Button>}{resource.data.status==='PAID'&&<p role="status" className="text-sm text-orange-700">Rent is settled. Facility Staff must record the Cell access handover before the rental becomes ACTIVE.</p>}{resource.data.status==='ACTIVE'&&<p role="status" className="text-sm text-emerald-700">Access handover is recorded. Physical inbound is tracked separately.</p>}</div>}
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
                  if (serviceType(result) === MANAGED_INVENTORY) clearMapAvailability();
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
            {isLegacyManaged(resource.data) && <p className="text-sm text-slate-700">Thanh toán trực tuyến cho Managed Inventory hiện chưa được hỗ trợ. Vui lòng liên hệ bộ phận hỗ trợ để được hướng dẫn.</p>}
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
      description="Review your rental agreements, signing progress and contract details."
      notice="Review the current contract version before signing. Signing and payment status remain confirmed by the service."
    >
      <LoadState resource={resource} />
      <div className="portal-contract-grid">{resource.data?.map((c) => (
        <Card key={recordId(c)} className="portal-contract-card">
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
      ))}</div>
      {resource.data?.length === 0 && <PortalEmptyState title="No contracts returned." description="Your rental agreements will appear here when they are available." />}
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
  if (isManagedV2(reservation) && contract) return <BackendScreen title="Review rental contract" description="Review Backend content and sign during direct intake."><RentalStatus status={contract.status} /><ContractPrintAction contractId={recordId(contract)} reservationId={reservationId} v2 /><ManagedContractReview customerView key={`${session.accessToken}:${JSON.stringify(contract)}`} contract={contract} reservation={reservation} loadLatest={() => contractContext(reservationId)} onRefresh={resource.retry} /><Link className="text-brand" to={`/portal/reservations/${reservationId}`}>View reservation</Link></BackendScreen>;
  if (isManagedV3(reservation) && contract) {
    const active = contract.contentVersions?.find(version => version.version === contract.currentContentVersion);
    const content = active?.content;
    const customerSigned = contract.signatures?.some(signature => signature.version === active?.version && signature.contentHash === active?.contentHash && signature.signerRole === 'CUSTOMER');
    const canSignV3 = contract.status === 'DRAFT' && reservation.status === 'DEPOSIT_PAID' && !!active && content?.schemaVersion === 3 && /^[a-f\d]{64}$/i.test(active.contentHash || '') && !customerSigned;
    return <BackendScreen title="Review Managed V3 contract" description="Review the Backend's Cell, capacity, dates, term and pricing snapshot. Both parties sign the same version and hash."><LoadState resource={resource}/><Message error={signatureNotice}/><RentalStatus status={contract.status}/><ContractPrintAction contractId={recordId(contract)} reservationId={reservationId}/>{content?.reservation&&<Card><CardContent><h2 className="text-xl font-bold">Quote snapshot</h2><Details values={[["Snapshot version",active.version],["Content hash",active.contentHash],["Facility ID",content.facility?.id||content.reservation.facilityId],["Selected Cells",Array.isArray(content.reservation.cellIds)?content.reservation.cellIds.join(', '):'Not returned'],["Allocated capacity",typeof content.reservation.allocatedCapacityM3==='number'?`${content.reservation.allocatedCapacityM3} m³`:'Not returned'],["Rental dates",`${content.reservation.startDate||'—'} – ${content.reservation.endDate||'—'}`],["Term",content.reservation.term?JSON.stringify(content.reservation.term):'Not returned'],["Rent",content.pricing?.estimatedRent],["Deposit",content.pricing?.depositAmount],["Tax",content.pricing?.taxAmount],["Discount",content.pricing?.discountAmount]]}/></CardContent></Card>}{canSignV3&&<ConfirmAction label="Sign Managed V3 contract snapshot" onAction={async()=>{const token=getAccessToken(),latest=await contractContext(reservationId);if(getAccessToken()!==token)return;if(recordId(latest.contract)!==recordId(contract)||!isManagedV3(latest.reservation)||latest.reservation.status!=='DEPOSIT_PAID')throw Error('Managed V3 reservation or contract changed. Refresh before signing.');const current=latest.contract.contentVersions?.find(version=>version.version===latest.contract.currentContentVersion);if(!current||current.version!==active.version||current.contentHash!==active.contentHash||current.content?.schemaVersion!==3)throw Error('Managed V3 snapshot version changed. Refresh before signing.');const signed=record(await contractApi.signReal(recordId(contract)));const accepted=signed.signatures?.some(signature=>signature.version===active.version&&signature.contentHash===active.contentHash&&signature.signerRole==='CUSTOMER');if(recordId(signed)!==recordId(contract)||!accepted)throw Error('Backend did not confirm the Customer signature on the current V3 version.');setSignatureNotice('Customer signature saved for this contract version. Facility Staff or Manager must sign the same version before Balance payment is available.');resource.retry();}}/>}{contract.status==='DRAFT'&&!canSignV3&&<p className="mt-4 text-sm text-orange-700">{reservation.status!=='DEPOSIT_PAID'?'Contract signing requires the applied Deposit.':customerSigned?'Your signature is saved. Facility Staff or Manager must sign the same current version.':'The current V3 snapshot is incomplete; signing is disabled.'}</p>}<Details values={[["Terms version",contract.termsVersion],["Facility signature",contract.signedByFMAt||'Pending'],["Customer signature",contract.signedByCustomerAt||'Pending']]}/><Link className="text-brand" to={`/portal/reservations/${reservationId}`}>View reservation</Link></BackendScreen>;
  }
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
            <ContractPrintAction contractId={recordId(contract)} reservationId={reservationId} />
            {isManagedV2(reservation) && <ManagedFinancialSummary reservation={reservation} />}
            <Details
              values={[
                ["Contract number", contract.contractCode],
                ["Signed at", contract.signedByCustomerAt],
                ["Service", serviceLabel(reservation)],
                ...(!isManagedV2(reservation) ? [["Estimated rent", amounts.estimatedRent], ["Deposit", amounts.depositAmount], ["Total due", amounts.totalDue]] : []),
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
                      try { const refreshed = await contractContext(associatedId); if (getAccessToken() !== token) return; if (eligiblePayosPurpose(refreshed.reservation, refreshed.contract) === "BALANCE") nav(`/portal/payments/${associatedId}`); }
                      catch (e) { if (getAccessToken() === token) setSignatureNotice('Contract signed. Refresh the contract/reservation to continue to payment.'); }
                    } else resource.retry();
                  }}
                />
              )}
            {contract.status === "DRAFT" &&
              !canSign(contract, reservation, now) && (
                <p className="mt-4 text-sm text-orange-700">
                  {isManagedV2(reservation) ? 'Managed V2 contract signing is not implemented in this phase. No signature can be submitted here.' : serviceType(reservation) === SELF_STORAGE && reservation?.status === 'CONTRACTED' ? 'Complete the Backend-confirmed PayOS Deposit before signing this Self-Storage contract.' : 'Signing unavailable: service, reservation status or Managed hold could not be confirmed.'}
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
    now = useCurrentTime();
  const resource = useBackend(
    (config) =>
      validId(reservationId)
        ? reservationApi.detailForCustomer(reservationId, config).then((response) => {
          const reservation = record(response);
          if (normalizePayosReferenceId(reservation) !== normalizePayosReferenceId(reservationId)) throw Error("Reservation does not match this payment route.");
          return reservation;
        })
        : Promise.reject(Error("Invalid reservation ID.")),
    [reservationId],
  );
  const managed = serviceType(resource.data) === MANAGED_INVENTORY;
  const managedDeposit = isManagedV2(resource.data);
  const managedV3 = managed && resource.data?.bookingFlowVersion === 3;
  const contracts = useBackend(
    (config) =>
      isLegacyManaged(resource.data) ? contractApi.mineReal(config).then(rows) : Promise.resolve([]),
    [reservationId, managed, managedDeposit, resource.data?.status],
  );
  const contract = contracts.data?.find(
    (c) => recordId(c.reservationId) === reservationId,
  );
  if (resource.loading) return <BackendScreen title="Loading payment details" description="Loading your reservation from the Backend."><LoadState resource={resource} /></BackendScreen>;
  if (resource.error || !resource.data) return <BackendScreen title="Payment unavailable" description="A payment can only be shown for a verified reservation."><Message error="Không tải được thông tin đơn thuê. Vui lòng thử lại." /><Button variant="outline" onClick={resource.retry}>Retry reservation</Button></BackendScreen>;
  if (serviceType(resource.data) === SELF_STORAGE) return <SelfStoragePayosCheckout key={`${session.accessToken}:${reservationId}`} reservationId={reservationId} initialReservation={resource.data} loadContext={selfStoragePaymentContext} loadContract={loadSelfStorageContract} loadOverview={loadSelfStorageOverview} onReservationRefresh={resource.retry} />;
  if (managedV3) return <SelfStoragePayosCheckout key={`${session.accessToken}:${reservationId}:managed-v3`} reservationId={reservationId} initialReservation={resource.data} loadContext={managedV3PaymentContext} loadContract={loadSelfStorageContract} onReservationRefresh={resource.retry} />;
  if (managedDeposit) return (
    <BackendScreen title="Managed Inventory payments" description="The Backend confirms each payment stage. Deposit is advance rent credited toward the balance.">
      <LoadState resource={resource} />
      {resource.data && <>
        <RentalSummary item={resource.data} localizeManagedV2 />
        <CustomerDepositPayment key={`deposit:${session.accessToken}:${reservationId}`} reservation={resource.data} loadLatest={config => reservationApi.detailForCustomer(reservationId, config).then(record)} onReservationRefresh={resource.retry} />
        <CustomerBalancePayment key={`balance:${session.accessToken}:${reservationId}`} reservation={resource.data} loadLatest={config => contractContext(reservationId, config)} onReservationRefresh={resource.retry} />
        <Button asChild variant="outline"><Link to={`/portal/reservations/${reservationId}`}>View reservation</Link></Button>
      </>}
    </BackendScreen>
  );
  if (!isLegacyManaged(resource.data)) return <BackendScreen title="Payment unavailable" description="Payment is not supported for this reservation type."><RentalSummary item={resource.data} /><Message error="Unsupported service. Payment is unavailable." /></BackendScreen>;
  const enabled = managedMockEnabled(import.meta.env);
  return (
    <BackendScreen
      title="Simulated Payment"
      description="Demo payment via the backend mock-pay endpoint. This is not a real PayOS transaction."
    >
      <LoadState resource={resource} />
      {resource.data && (
        <>
          <RentalSummary item={resource.data} />
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
