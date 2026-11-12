import LoadState from './CustomerResourceState';
import { PortalEmptyState } from './CustomerPortalUI';
import ContractPrintAction from './ContractPrintAction';
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
  isManagedV3,
  isManagedV2,
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
import { Dialog } from "@/components/ui/dialog";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import { reservationDateOnly, reservationVietnamTime, reservationAmount } from "@/lib/customerReservationDisplay";
import { ArrowUpRight, ClipboardList, Clock3, FileText, MapPin, Package, Plus, Warehouse, RefreshCw } from "lucide-react";
import { CustomerScreen } from "@/components/common/CustomerScreen";
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
  addressText,
  useBackend,
  rows,
  record,
  recordId,
  validId,
  rentalError,
  ConfirmAction,
} from "./RentalBackendUI";
function vietnamDateTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : undefined; }
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
  if (reservation.rentalPaymentFlow !== 'FULL_UPFRONT_V1') throw Error('Managed V3 requires full-rent PayOS Hosted Checkout; legacy Deposit/Balance is disabled.');
  return { contract: null, reservation };
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
  const cards = [
    ["Đang thuê", resource.data?.filter(r => r.status === 'ACTIVE').length ?? 0, "Đơn đang hoạt động", Warehouse, "green"],
    ["Cần xử lý", resource.data?.filter(r => ['PAID', 'CHECKIN_READY'].includes(r.status)).length ?? 0, "Đơn cần hoàn tất", Clock3, "orange"],
    ["Tổng đơn thuê", resource.data?.length ?? 0, "Tất cả đơn thuê", ClipboardList, "blue"],
  ];
  return (
    <CustomerScreen title="Kho lưu trữ của tôi" description="Theo dõi đơn thuê và quản lý không gian lưu trữ." eyebrow="KHÔNG GIAN LƯU TRỮ" showNotice={false} action={<Button asChild variant="orange" className="my-storage-rent-cta"><Link to="/portal/rent"><Plus size={17} aria-hidden="true" />Thuê kho mới</Link></Button>}>
      <LoadState resource={resource} />
      {resource.data && !resource.error && <div className="portal-summary-grid my-storage-kpis" aria-label="Tóm tắt đơn thuê">{cards.map(([label, value, subtext, Icon, tone]) => <Card key={label} className={`portal-summary-card my-storage-kpi my-storage-kpi-${tone}`}><CardContent><div className="my-storage-kpi-icon"><Icon size={21} aria-hidden="true" /></div><div className="my-storage-kpi-copy"><span>{label}</span><strong>{value}</strong><small>{subtext}</small></div></CardContent></Card>)}</div>}
      <section className="my-storage-list">
        <div className="my-storage-list-heading"><div><p className="my-storage-overline">TỔNG QUAN</p><h2>Danh sách đơn thuê</h2></div>{resource.data && !resource.error && <span className="my-storage-count">Đang hiển thị {records.length} đơn thuê</span>}</div>
        <div className="portal-filter-bar my-storage-filter-bar">
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
          {(filter || service) && <button type="button" className="my-storage-clear" onClick={() => { setFilter(""); setService(""); }}>Xóa bộ lọc</button>}
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
              <section key={title} className="portal-rental-group my-storage-group">
                <h2 className="mb-4 text-xl font-bold">{title}</h2>
                <div className="portal-rental-grid my-storage-grid">
                  {group.map((r) => (
                    <MyStorageReservationCard key={recordId(r)} item={r} />
                  ))}
                </div>
              </section>
            )
          );
        })}
        {!resource.loading && !resource.error && !records.length && (
          <PortalEmptyState title="Không có đơn thuê phù hợp." description="Hãy thử chọn loại dịch vụ hoặc trạng thái khác, hoặc tìm kho mới." action={<Button asChild variant="orange"><Link to="/portal/rent"><Plus size={16} aria-hidden="true" />Thuê kho mới</Link></Button>} />
        )}
      </section>
    </CustomerScreen>
  );
}

function MyStorageReservationCard({ item }) {
  const type = serviceType(item), managed = type === MANAGED_INVENTORY;
  const facility = typeof item.facilityId === 'object' ? item.facilityId : item.facility;
  const unit = typeof item.storageUnitId === 'object' ? item.storageUnitId : item.storageUnit;
  const status = item.status;
  const displayStatus = managed && [2, 3].includes(item.bookingFlowVersion) ? reservationLifecycle(item).label : (type === SELF_STORAGE && status === 'CONTRACTED' ? 'Đã xác nhận · Chờ thanh toán trước tiền thuê' : statusLabels[status] || status || 'Chưa cập nhật');
  const date = value => { if (typeof value !== 'string' || !value) return 'Chưa cập nhật'; return /^\d{4}-\d{2}-\d{2}$/.test(value) ? reservationDateOnly(value) : reservationVietnamTime(value) };
  const values = managed ? [
    ['Kỳ thuê', `${date(item.startDate)} – ${date(item.endDate)}`],
    ...(typeof item.allocatedCapacityM3 === 'number' && Number.isFinite(item.allocatedCapacityM3) ? [['Sức chứa', `${item.allocatedCapacityM3} m³`]] : []),
    ...((item.totalRentPayable ?? item.totalRent ?? item.estimatedRent) != null ? [['Tổng tiền thuê', reservationAmount(item.totalRentPayable ?? item.totalRent ?? item.estimatedRent, item.currency || 'VND')]] : []),
  ] : [
    ['Mã kho', unit?.unitCode], ['Kích thước', unit?.size], ['Thể tích', typeof unit?.volumeM3 === 'number' ? `${unit.volumeM3} m³` : unit?.volumeM3], ['Ngày bắt đầu', date(item.startDate)], ['Ngày kết thúc', date(item.endDate)],
    ...(item.estimatedRent != null ? [['Tổng tiền thanh toán', reservationAmount(item.estimatedRent, item.currency || 'VND')]] : []),
  ];
  const Icon = managed ? Package : Warehouse;
  return <Card className="my-storage-card"><CardContent><div className="my-storage-card-head"><span className={`my-storage-service-icon ${managed ? 'is-managed' : ''}`}><Icon size={20} aria-hidden="true" /></span><div className="my-storage-card-title"><p>{serviceLabel(item)}</p><h3>{facility?.name || 'Chưa cập nhật cơ sở'}</h3></div><span className={`my-storage-status ${['ACTIVE'].includes(status) ? 'is-active' : ['CANCELLED'].includes(status) ? 'is-cancelled' : ['CLOSED', 'CHECKED_OUT'].includes(status) ? 'is-closed' : 'is-pending'}`}>{displayStatus}</span></div><div className="my-storage-card-fields">{values.map(([label, value]) => <div className="my-storage-field" key={label}><span>{label}</span><strong>{value === undefined || value === null || value === '' ? 'Chưa cập nhật' : value}</strong></div>)}</div><div className="my-storage-card-footer">{validId(recordId(item)) ? <Link className="my-storage-detail" to={`/portal/reservations/${recordId(item)}`}>Xem chi tiết<ArrowUpRight size={16} aria-hidden="true" /></Link> : <span className="my-storage-no-detail">Chi tiết hiện chưa khả dụng</span>}</div></CardContent></Card>;
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
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutNote, setCheckoutNote] = useState("");
  const [showRenew, setShowRenew] = useState(false);
  const [renewMonths, setRenewMonths] = useState(1);
  const [actionPending, setActionPending] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);

  const handleRequestCheckout = async (e) => {
    e.preventDefault();
    if (actionPending) return;
    setActionPending(true);
    setActionFeedback(null);
    try {
      await reservationApi.requestCheckout(id, checkoutNote);
      setShowCheckout(false);
      setCheckoutNote("");
      setActionFeedback({ success: "Đã gửi yêu cầu trả kho thành công! Nhân viên cơ sở sẽ kiểm tra và nghiệm thu kho." });
      resource.retry();
    } catch (err) {
      setActionFeedback({ error: err.response?.data?.message || err.message || "Lỗi khi gửi yêu cầu trả kho." });
    } finally {
      setActionPending(false);
    }
  };

  const handleRenew = async (e) => {
    e.preventDefault();
    if (actionPending) return;
    setActionPending(true);
    setActionFeedback(null);
    try {
      const res = await reservationApi.renewReservation(id, renewMonths);
      setShowRenew(false);
      setActionFeedback({ success: res.data?.message || "Gia hạn hợp đồng thành công!" });
      resource.retry();
    } catch (err) {
      setActionFeedback({ error: err.response?.data?.message || err.message || "Lỗi khi gia hạn hợp đồng." });
    } finally {
      setActionPending(false);
    }
  };
  return (
    <BackendScreen
      title="Reservation details"
      description="Current backend status is the source of truth."
    >
      <LoadState resource={resource} />
      {location.state?.selfStorageCreated && (
        <Message success={resource.data?.rentalPaymentFlow === "FULL_UPFRONT_V1" ? "Đã tạo Reservation Self Storage. Thanh toán 100% tiền thuê qua PayOS để tiếp tục hoàn tất hợp đồng." : "Self Storage booking confirmed. Continue with the existing payment step."} />
      )}
      {location.state?.managedCreated && (
        <Message success={isManagedV2(resource.data) || isManagedV3(resource.data) ? reservationLifecycle(resource.data).description : isLegacyManaged(resource.data) ? "Luồng tạo Reservation Managed cũ đã đóng; hồ sơ này chỉ còn để xem lịch sử." : undefined} />
      )}
      {resource.data && (
        <>
          <RentalSummary item={resource.data} localizeManagedV2 />
          {isManagedV2(resource.data) && <div role="status" className="soft-panel p-4">Luồng Managed Inventory phiên bản cũ đã ngừng tạo giao dịch mới. Hồ sơ này chỉ còn ở chế độ xem; vui lòng liên hệ hỗ trợ nếu cần đối soát lịch sử.</div>}
          <ManagedCellSummary reservation={resource.data} />
          {isManagedV3(resource.data) && <div className="flex flex-wrap gap-3">{resource.data.status === 'RESERVED' && <Button asChild variant="orange"><Link to={`/portal/payments/${id}`}>Thanh toán 100% qua PayOS</Link></Button>}{['PAID', 'CHECKIN_READY', 'ACTIVE'].includes(resource.data.status) && <Button asChild variant="outline"><Link to={`/portal/contracts/${id}`}>Xem hợp đồng Managed V3</Link></Button>}{['CHECKIN_READY', 'ACTIVE'].includes(resource.data.status) && eligibleInventoryRegistration(resource.data) && <Button asChild variant="orange"><Link to={`/portal/inventory/register?reservationId=${id}`}>Chuẩn bị SKU hàng hóa</Link></Button>}{resource.data.status === 'CHECKIN_READY' && <p role="status" className="text-sm text-orange-700">Bạn có thể khai báo SKU trước. Hàng chỉ được ghi nhận sau khi hoàn tất bàn giao và quy trình nhập kho V3.</p>}{resource.data.status === 'ACTIVE' && <p role="status" className="text-sm text-emerald-700">Đã bàn giao. Quyền ghi nhận tồn kho chỉ được cấp qua phiên Access Session và nghiệp vụ V3.</p>}</div>}
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
                <>
                  <Button asChild>
                    <Link to={`/portal/rentals/${id}/access`}>
                      Simulated unit access
                    </Link>
                  </Button>
                  <Button variant="outline" onClick={() => setShowRenew(true)}>
                    Gia hạn thuê kho
                  </Button>
                  {resource.data.checkoutRequest?.status === "PENDING" ? (
                    <div className="w-full rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                      🕒 <strong>Đã gửi yêu cầu trả kho</strong> ({new Date(resource.data.checkoutRequest.requestedAt).toLocaleDateString('vi-VN')}). Nhân viên cơ sở sẽ kiểm tra và nghiệm thu kho.
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => setShowCheckout(true)}>
                      Yêu cầu trả kho (Checkout)
                    </Button>
                  )}
                </>
              )}
            {actionFeedback && <div className="w-full mt-3"><Message {...actionFeedback} /></div>}
          </div>
          {showCheckout && (
            <Dialog title="Yêu cầu trả kho (Checkout)" onClose={() => setShowCheckout(false)}>
              <form onSubmit={handleRequestCheckout} className="space-y-4">
                <p className="text-sm text-slate-600">
                  Vui lòng đảm bảo bạn đã dọn sạch toàn bộ tài sản trong kho. Sau khi gửi yêu cầu, nhân viên cơ sở sẽ đến kiểm tra thực tế và hoàn tất thủ tục trả kho.
                </p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  ⚠️ <strong>Lưu ý:</strong> Nếu trả kho trước ngày hết hạn hợp đồng, khoản tiền thuê còn lại sẽ không được hoàn trả theo quy định.
                </div>
                <div>
                  <label className="text-sm font-medium">Ghi chú (không bắt buộc)</label>
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                    placeholder="Ví dụ: Tôi đã dọn xong đồ, nhờ nhân viên kiểm tra..."
                    value={checkoutNote}
                    onChange={(e) => setCheckoutNote(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowCheckout(false)}>Hủy</Button>
                  <Button type="submit" disabled={actionPending}>{actionPending ? "Đang gửi…" : "Xác nhận gửi yêu cầu"}</Button>
                </div>
              </form>
            </Dialog>
          )}
          {showRenew && (
            <Dialog title="Gia hạn hợp đồng thuê kho" onClose={() => setShowRenew(false)}>
              <form onSubmit={handleRenew} className="space-y-4">
                <p className="text-sm text-slate-600">
                  Chọn số tháng bạn muốn gia hạn tiếp theo. Hợp đồng hiện tại và mã PIN mở cửa của bạn sẽ được giữ nguyên.
                </p>
                <div>
                  <label className="text-sm font-medium">Thời gian gia hạn</label>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                    value={renewMonths}
                    onChange={(e) => setRenewMonths(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((m) => (
                      <option key={m} value={m}>{m} tháng</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p>Hạn hợp đồng hiện tại: <strong>{new Date(resource.data.endDate).toLocaleDateString('vi-VN')}</strong></p>
                  <p className="mt-1">Hạn hợp đồng mới sau gia hạn: <strong>{(() => {
                    const d = new Date(resource.data.endDate);
                    d.setUTCMonth(d.getUTCMonth() + renewMonths);
                    return d.toLocaleDateString('vi-VN');
                  })()}</strong></p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowRenew(false)}>Hủy</Button>
                  <Button type="submit" disabled={actionPending}>{actionPending ? "Đang xử lý…" : "Xác nhận gia hạn"}</Button>
                </div>
              </form>
            </Dialog>
          )}
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
      title="Hợp đồng của bạn"
      description="Xem nội dung, trạng thái ký và các thông tin đã được xác nhận cho từng hợp đồng."
      notice="Thông tin hợp đồng được tải trực tiếp từ hệ thống. Trạng thái ký và thanh toán chỉ thay đổi sau khi Backend xác nhận."
    >
      <LoadState resource={resource} />
      {!resource.loading && !resource.error && resource.data?.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{resource.data.map((c) => {
        const reservationId = recordId(c.reservationId);
        const reservation = reservations.data?.find(r => recordId(r) === reservationId);
        const facility = reservation?.facilityId?.name || reservation?.facility?.name;
        const startDate = reservation?.startDate;
        const endDate = reservation?.endDate;
        return <Card key={recordId(c)} className="overflow-hidden border-slate-200 shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="p-0">
            <div className="flex items-start gap-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white p-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800"><FileText size={22} /></span>
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Hợp đồng thuê</p><h2 className="mt-1 break-words text-lg font-bold text-slate-900">{c.contractCode || "Hợp đồng lưu trữ"}</h2><p className="mt-1 text-sm text-slate-500">Mã đặt thuê: {reservation?.reservationCode || reservationId || "Đang cập nhật"}</p></div>
              <RentalStatus status={c.status} />
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 text-xs text-slate-500"><MapPin size={14} />Cơ sở</p><p className="mt-1 font-semibold text-slate-800">{facility || "Thông tin cơ sở đang được cập nhật"}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 text-xs text-slate-500"><Clock3 size={14} />Thời hạn thuê</p><p className="mt-1 font-semibold text-slate-800">{startDate ? reservationVietnamTime(startDate) : "—"}{endDate ? ` – ${reservationVietnamTime(endDate)}` : ""}</p></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
              <SelfPaymentNavigation contract={c} reservation={reservation} />
              {validId(reservationId) ? <Button asChild><Link to={`/portal/contracts/${reservationId}`}>Xem chi tiết hợp đồng <ArrowUpRight size={16} /></Link></Button> : <span className="text-sm text-slate-500">Chưa có liên kết đặt thuê để mở chi tiết.</span>}
            </div>
          </CardContent>
        </Card>;
      })}</div>}
      {resource.data?.length === 0 && <PortalEmptyState title="Chưa có hợp đồng" description="Hợp đồng sẽ xuất hiện tại đây khi hệ thống tạo hợp đồng cho đơn thuê của bạn." />}
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
  if (isManagedV2(reservation) && contract) return <BackendScreen title="Hợp đồng Managed lịch sử" description="Luồng Managed phiên bản cũ đã đóng. Hợp đồng này chỉ đọc để tra cứu, không thể ký hoặc thay đổi."><LoadState resource={resource} /><RentalStatus status={contract.status} /><ContractPrintAction contractId={recordId(contract)} reservationId={reservationId} v2 /><Details values={[["Mã hợp đồng", contract.contractCode], ["Trạng thái", contract.status], ["Phiên bản điều khoản", contract.termsVersion || '—'], ["Ngày tạo", contract.createdAt || '—']]} /><Link className="text-brand" to={`/portal/reservations/${reservationId}`}>Về Reservation</Link></BackendScreen>;
  if (isManagedV3(reservation) && contract) {
    const active = contract.contentVersions?.find(version => version.version === contract.currentContentVersion);
    const content = active?.content;
    const customerSigned = contract.signatures?.some(signature => signature.version === active?.version && signature.contentHash === active?.contentHash && signature.signerRole === 'CUSTOMER');
    const fullUpfront = reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1';
    if (!fullUpfront) return <BackendScreen title="Reservation Managed cần đối soát" description="Hồ sơ V3 không có cấu hình thanh toán toàn phần hợp lệ. Không thể tiếp tục theo luồng Deposit/Balance cũ."><LoadState resource={resource} /><Message error="Vui lòng liên hệ hỗ trợ để đối soát hồ sơ. Không thực hiện thanh toán hoặc ký trên trang này." /></BackendScreen>;
    const canSignV3 = false;
    return <BackendScreen title="Review Managed V3 contract" description="Review the Backend's Cell, capacity, dates, term and confirmed pricing snapshot."><LoadState resource={resource} /><Message error={signatureNotice} /><RentalStatus status={contract.status} /><ContractPrintAction contractId={recordId(contract)} reservationId={reservationId} />{content?.reservation && <Card><CardContent><h2 className="text-xl font-bold">Thông tin hợp đồng đã chốt</h2>{content.facility?.address && <p className="mt-2 text-sm text-slate-600">Địa chỉ Facility: {content.facility.address}</p>}<Details values={[["Phiên bản tài liệu", active.version], ["Mã xác thực nội dung", active.contentHash], ["Facility ID", content.facility?.id || content.reservation.facilityId], ["Cell đã chọn", Array.isArray(content.reservation.cellIds) ? content.reservation.cellIds.join(', ') : 'Chưa có'], ["Dung lượng", typeof content.reservation.allocatedCapacityM3 === 'number' ? `${content.reservation.allocatedCapacityM3} m³` : 'Chưa có'], ["Thời hạn thuê", `${content.reservation.startDate || '—'} – ${content.reservation.endDate || '—'}`], ["Kỳ hạn", content.reservation.term ? JSON.stringify(content.reservation.term) : '—'], ["Tiền thuê", content.pricing?.estimatedRent], ["Đã thanh toán 100%", content.pricing?.totalPaid ?? content.pricing?.amountBreakdown?.totalDue], ["Hạn ký", vietnamDateTime(reservation.signingDeadline)], ["Thuế", content.pricing?.taxAmount], ["Giảm giá", content.pricing?.discountAmount]]} /></CardContent></Card>}{contract.status === 'DRAFT' && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Đã thanh toán 100% — Chờ hoàn tất hợp đồng giấy tại cơ sở. Customer và đại diện Facility cần ký cùng một bản; Staff sẽ tải bằng chứng thực tế và xác minh. Trang này không tạo chữ ký giả.</p>}<Details values={[["Phiên bản Điều khoản", contract.termsVersion], ["Chữ ký Facility", contract.signedByFMAt || 'Đang chờ'], ["Chữ ký Customer", contract.signedByCustomerAt || 'Đang chờ']]} />{contract.status === 'SIGNED' && contract.verifiedAt && <p role="status" className="mt-3 text-emerald-800">Hợp đồng đã được xác minh — sẵn sàng thực hiện thủ tục nhận kho.</p>}<Link className="text-brand" to={`/portal/reservations/${reservationId}`}>Xem Reservation</Link></BackendScreen>;
  }
  return (
    <BackendScreen
      title="Chi tiết hợp đồng"
      description="Rà soát thông tin đặt thuê, nội dung và trạng thái hợp đồng trước khi thực hiện bước tiếp theo."
    >
      <LoadState resource={resource} />
      <Message error={signatureNotice} />
      {contract ? (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 via-white to-white p-6">
              <div className="flex min-w-0 items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-800"><FileText size={22} /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Hợp đồng thuê</p><h2 className="mt-1 break-words text-2xl font-bold text-slate-900">{contract.contractCode || "Chi tiết hợp đồng"}</h2><p className="mt-1 text-sm text-slate-600">Mã đặt thuê: {reservation?.reservationCode || reservationId}</p></div></div>
              <RentalStatus status={contract.status} reservation={reservation} />
            </div>
            <div className="space-y-5 p-5 md:p-7">
              <ContractPrintAction contractId={recordId(contract)} reservationId={reservationId} />
              {isManagedV2(reservation) && <ManagedFinancialSummary reservation={reservation} />}
              <section className="rounded-2xl border border-slate-200 p-5">
                <h3 className="mb-4 font-semibold text-slate-900">Thông tin đặt thuê</h3>
                <Details
                  values={[
                    ["Mã hợp đồng", contract.contractCode],
                    ["Ngày ký", contract.signedByCustomerAt ? vietnamDateTime(contract.signedByCustomerAt) : undefined],
                    ["Dịch vụ", serviceLabel(reservation)],
                    ...(!isManagedV2(reservation) ? (serviceType(reservation) === SELF_STORAGE ? [["Tổng tiền thanh toán", amounts.estimatedRent]] : [["Estimated rent", amounts.estimatedRent], ["Deposit", amounts.depositAmount], ["Total due", amounts.totalDue]]) : []),
                    [
                      "Tiền tệ",
                      serviceType(reservation) === MANAGED_INVENTORY
                        ? contract.pricingSnapshot?.pricingRule?.currency
                        : undefined,
                    ],
                    ["Hạn giữ chỗ", reservation?.expiresAt ? vietnamDateTime(reservation.expiresAt) : undefined],
                    ["Cơ sở", reservation?.facilityId?.name || reservation?.facility?.name],
                    ["Địa chỉ cơ sở", addressText(reservation?.facilityId?.address || reservation?.facility?.address)],
                    ["Thời hạn thuê", reservation?.startDate && reservation?.endDate ? `${reservationVietnamTime(reservation.startDate)} – ${reservationVietnamTime(reservation.endDate)}` : undefined],
                    ...(reservation?.rentalPaymentFlow === "FULL_UPFRONT_V1" ? [["Hạn ký", vietnamDateTime(reservation.signingDeadline)], ["Payment status", reservation.status === "CONTRACTED" ? "Chờ thanh toán 100%" : "Đã thanh toán 100%"], ["Handover", reservation.status === "ACTIVE" ? "Đã ghi nhận bàn giao" : reservation.status === "CHECKIN_READY" ? "Sẵn sàng làm thủ tục nhận kho" : "Chưa bàn giao"]] : []),
                    ["Phiên bản điều khoản", contract.termsVersion],
                  ].filter(([, value]) => value != null)}
                />
              </section>
              {typeof contract.content === "string" && (
                <section className="rounded-2xl border border-slate-200 p-5"><h3 className="font-semibold text-slate-900">Nội dung hợp đồng</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                  {contract.content}
                </p></section>
              )}
              {reservation?.rentalPaymentFlow === "FULL_UPFRONT_V1" && contract.status === "DRAFT" && reservation.status === "PAID" && (
                <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Đã thanh toán 100% — Chờ ký hợp đồng giấy tại cơ sở. Customer và đại diện Facility cần ký cùng phiên bản; Staff sẽ tải bằng chứng thực tế và xác minh. Nút ký điện tử không khả dụng cho luồng này.</p>
              )}
              {reservation?.rentalPaymentFlow === "FULL_UPFRONT_V1" && contract.status === "SIGNED" && contract.verifiedAt && reservation.status === "CHECKIN_READY" && (
                <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Hợp đồng đã được xác minh — Sẵn sàng thực hiện thủ tục nhận kho. Thuê chưa ACTIVE cho đến khi Staff ghi nhận bàn giao.</p>
              )}
              {reservation?.rentalPaymentFlow === "FULL_UPFRONT_V1" && reservation.status === "ACTIVE" && (
                <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Đã ghi nhận bàn giao. Trạng thái truy cập: {reservation.accessPinCode ? "đã có credential từ Backend" : "chưa được cấp credential an toàn"}.</p>
              )}
              {Array.isArray(contract.terms) && (
                <section className="rounded-2xl border border-slate-200 p-5"><h3 className="font-semibold text-slate-900">Các điều khoản</h3><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-700">
                  {contract.terms
                    .filter((t) => typeof t === "string")
                    .map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                </ol></section>
              )}
              <section className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5"><h3 className="mb-3 font-semibold text-slate-900">Việc cần làm tiếp theo</h3>
                {canSign(contract, reservation, now) &&
                  validId(recordId(contract)) && (
                    <ConfirmAction
                      label="Xác nhận chữ ký hợp đồng"
                      onAction={async () => {
                        const token = getAccessToken();
                        const latest = await contractContext(reservationId);
                        if (getAccessToken() !== token) return;
                        if (
                          recordId(latest.contract) !== recordId(contract) ||
                          !canSign(latest.contract, latest.reservation)
                        )
                          throw Error(
                            "Hợp đồng hoặc thời hạn giữ chỗ đã thay đổi. Hãy tải lại trước khi ký.",
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
                            "Backend chưa xác nhận chữ ký hợp đồng.",
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
                    <div
                      role="status"
                      className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 text-amber-700"
                      >
                        ⚠
                      </span>

                      <p className="text-sm font-medium leading-6 text-amber-900">
                        {isManagedV2(reservation)
                          ? "Chức năng ký hợp đồng trực tuyến hiện chưa khả dụng đối với đơn thuê này."
                          : serviceType(reservation) === SELF_STORAGE &&
                            reservation?.status === "CONTRACTED"
                            ? "Vui lòng hoàn tất thanh toán trước khi tiếp tục thủ tục ký hợp đồng."
                            : "Hiện chưa đủ điều kiện ký hợp đồng. Vui lòng kiểm tra trạng thái đơn thuê hoặc thời hạn giữ chỗ."}
                      </p>
                    </div>
                  )}

                <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-4">
                    <h4 className="text-base font-bold text-[#153D2B]">
                      Thao tác với hợp đồng
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-[#607568]">
                      Thanh toán hoặc cập nhật trạng thái để tiếp tục quy trình thuê kho.
                    </p>
                  </div>

                  <div className="contract-next-actions">
                    <div className="contract-payment-action">
                      <SelfPaymentNavigation
                        contract={contract}
                        reservation={reservation}
                      />
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="contract-refresh-action"
                      onClick={() => {
                        setSignatureNotice("");
                        resource.retry();
                      }}
                    >
                      <RefreshCw size={18} aria-hidden="true" />
                      <span>Làm mới trạng thái</span>
                    </Button>
                  </div>

                  <div className="mt-4 border-t border-[#E1EBE3] pt-4">
                    <Link
                      to={`/portal/reservations/${reservationId}`}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-[#176B45] transition-colors hover:text-[#105536] hover:underline"
                    >
                      Xem chi tiết đơn thuê
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </section>
            </div>
          </CardContent>
        </Card>
      ) : (
        !resource.loading &&
        !resource.error && (
          <Card className="border-dashed"><CardContent className="py-10 text-center"><FileText className="mx-auto text-slate-400" size={36} /><h2 className="mt-4 text-lg font-semibold text-slate-900">Chưa tìm thấy hợp đồng</h2><p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">Reservation đã được xác minh nhưng chưa có hợp đồng để hiển thị. Hãy thử tải lại hoặc mở đơn thuê.</p><div className="mt-5 flex justify-center gap-3"><Button variant="outline" onClick={resource.retry}>Thử tải lại</Button><Button asChild variant="outline"><Link to={`/portal/reservations/${reservationId}`}>Mở đơn thuê</Link></Button></div></CardContent></Card>
        )
      )}
    </BackendScreen>
  );
}
export function PaymentIntegration() {
  const session = useAuthSession();
  const { reservationId } = useParams();
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
  const managedV3 = managed && resource.data?.bookingFlowVersion === 3;
  if (resource.loading) return <BackendScreen title="Loading payment details" description="Loading your reservation from the Backend."><LoadState resource={resource} /></BackendScreen>;
  if (resource.error || !resource.data) return <BackendScreen title="Payment unavailable" description="A payment can only be shown for a verified reservation."><Message error="Không tải được thông tin đơn thuê. Vui lòng thử lại." /><Button variant="outline" onClick={resource.retry}>Retry reservation</Button></BackendScreen>;
  if (serviceType(resource.data) === SELF_STORAGE) return <SelfStoragePayosCheckout key={`${session.accessToken}:${reservationId}`} reservationId={reservationId} initialReservation={resource.data} loadContext={selfStoragePaymentContext} loadContract={loadSelfStorageContract} loadOverview={loadSelfStorageOverview} onReservationRefresh={resource.retry} />;
  if (managedV3) return <SelfStoragePayosCheckout key={`${session.accessToken}:${reservationId}:managed-v3`} reservationId={reservationId} initialReservation={resource.data} loadContext={managedV3PaymentContext} loadContract={loadSelfStorageContract} onReservationRefresh={resource.retry} />;
  return <BackendScreen title="Thanh toán Managed lịch sử" description="Luồng thanh toán Managed cũ đã đóng. Hệ thống không tạo Deposit, Balance hoặc thanh toán giả cho hồ sơ này."><RentalSummary item={resource.data} /><Message error="Chỉ Reservation Managed V3 mới dùng PayOS Hosted Checkout. Hồ sơ cũ chỉ còn để tra cứu lịch sử." /><Button variant="outline" onClick={resource.retry}>Tải lại trạng thái</Button></BackendScreen>;
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
    [revealedPin, setRevealedPin] = useState(false),
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
    (resource.data?.rentalPaymentFlow !== "FULL_UPFRONT_V1" || Boolean(resource.data?.accessPinCode)) &&
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
          {resource.data?.rentalPaymentFlow === "FULL_UPFRONT_V1" && !resource.data?.accessPinCode ? "Hệ thống cấp credential truy cập an toàn chưa khả dụng; không dùng mã demo để mở kho." : "Access unavailable for this reservation status or missing reservation code."}
        </p>
      )}
      {resource.data?.status === "ACTIVE" && resource.data?.accessPinCode && (
        <div className="mb-4 p-4 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-sky-800 uppercase tracking-wider">Mã PIN điện tử (Digital Access PIN)</p>
            <p className="font-mono text-2xl font-bold tracking-widest text-sky-950 mt-1">
              {revealedPin ? resource.data.accessPinCode : "••••••"}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRevealedPin((v) => !v)}>
            {revealedPin ? "Ẩn mã PIN" : "Xem mã PIN"}
          </Button>
        </div>
      )}
      <form onSubmit={unlock} className="space-y-4">
        <label className="block">
          <span className="field-label">PIN code</span>
          <Input
            aria-label="PIN code"
            type="password"
            autoComplete="off"
            maxLength={6}
            placeholder="Nhập mã PIN 6 số"
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
