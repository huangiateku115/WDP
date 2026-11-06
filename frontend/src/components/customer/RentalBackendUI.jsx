import {reservationAmount,reservationVietnamTime} from '@/lib/customerReservationDisplay';
import {
  serviceType,
  serviceLabel,
  MANAGED_INVENTORY,
  SELF_STORAGE,
  reservationLifecycle,
} from "@/lib/customerReservationService";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import { apiErrorMessage } from "@/lib/apiError";
import {
  CustomerScreen,
  Details,
  Message,
} from "@/components/common/CustomerScreen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {managedReservationFinancials,managedQuoteFinancials,managedFinancialRows} from '@/lib/managedRentalPricing';
import {isManagedV2} from '@/lib/customerReservationService';
export { CustomerScreen, Details, Message, Card, CardContent, Button, Link };
export const statusLabels = {
  RESERVED: "Chờ duyệt",
  DEPOSIT_PAID: "Đã thanh toán trước tiền thuê",
  CHECKIN_READY: "Đã hoàn tất tiền thuê / Chờ nhập kho thực tế",
  CONTRACTED: "Đã duyệt / Chờ hoàn tất hợp đồng",
  PAID: "Đã thanh toán",
  ACTIVE: "Đang thuê",
  OVERDUE: "Quá hạn",
  CHECKED_OUT: "Đã trả kho",
  CLOSED: "Hoàn tất",
  CANCELLED: "Đã hủy",
};
export const recordId = (record) =>
  typeof record === "string" ? record : record?._id || record?.id;
export const validId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
export function responseData(response) {
  const body = response?.data;
  if (body?.success !== true || !Object.hasOwn(body, "data"))
    throw Error(
      "Backend response contract is unavailable or unsupported. Please retry; no demo data is substituted.",
    );
  return body.data;
}
export function rows(response) {
  const data = responseData(response);
  if (!Array.isArray(data))
    throw Error(
      "Expected a backend collection. Response mapping requires confirmation.",
    );
  return data;
}
export function record(response) {
  const data = responseData(response);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("Expected a backend record.");
  return data;
}
export function rentalError(error) {
  const backendMessage = error.response?.data?.message;
  if (
    error.response?.status < 500 &&
    [
      "Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt.",
      "Kho này đã có người đặt trong khoảng thời gian bạn chọn. Vui lòng chọn ngày hoặc kho khác.",
      "Kho này đang bị khóa hoặc bảo trì, không thể đặt.",
      "Không tìm thấy Kho hoặc Kho không thuộc Cơ sở này.",
      "Ngày bắt đầu thuê phải nằm trong tương lai.",
      "Ngày kết thúc phải lớn hơn ngày bắt đầu.",
    ].includes(backendMessage)
  )
    return backendMessage;
  if (
    error.response?.status < 500 &&
    typeof backendMessage === "string" &&
    /^(Managed (sellable capacity is not configured or active|pricing is ambiguous|deposit policy is ambiguous|deposit policy has an unsupported configuration|deposit policy must explicitly configure PERCENT_OF_RENT and a non-negative percentage|quote amount overflow|reservation is missing, expired or not RESERVED|reservation not found|contract requires an active, held CONTRACTED reservation\.|capacity configuration not found)|Effective (per-m3 Managed pricing|Managed deposit policy) is not configured|Requested quota exceeds available Managed capacity for this interval|Verified Customer Profile required|Active Managed Inventory Facility not found|Only unpaid RESERVED or CONTRACTED Managed reservations can be cancelled|Customer-signed contract required before payment)$/.test(
      backendMessage,
    )
  )
    return backendMessage;
  if (error.response?.status >= 500)
    return "The backend could not complete this request. Please retry later.";
  const statuses = {
    401: "Please sign in to continue.",
    403: "You are not authorized to view or change this record.",
    404: "The requested record or applicable rule is unavailable.",
    409: "The unit, booking or rule changed. Refresh and review before retrying.",
    429: "Too many requests. Please wait before retrying.",
  };
  if (statuses[error.response?.status]) return statuses[error.response.status];
  const message = apiErrorMessage(error, "Unable to complete the request.");
  return /stack|trace|MongoServerError|AxiosError| at .*:[0-9]+/i.test(message)
    ? "Unable to complete the request. Please check the entered information or retry."
    : message;
}
export function useBackend(loader, dependencies = [], publicRead = false) {
  const { accessToken } = useAuthSession(),
    [revision, setRevision] = useState(0),
    [state, setState] = useState({
      key: "",
      data: null,
      error: "",
      loading: true,
    });
  const key = JSON.stringify([
    publicRead ? "public" : accessToken,
    ...dependencies,
    revision,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ key, data: null, error: "", loading: true });
    if (!publicRead && !accessToken) {
      setState({
        key,
        data: null,
        error: "Please sign in to continue.",
        loading: false,
      });
      return;
    }
    Promise.resolve()
      .then(() => loader({ signal: controller.signal }))
      .then((data) => {
        if (active && (publicRead || getAccessToken() === accessToken))
          setState({ key, data, error: "", loading: false });
      })
      .catch((error) => {
        if (active && !controller.signal.aborted)
          setState({
            key,
            data: null,
            error: rentalError(error),
            loading: false,
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [key]);
  return {
    ...(state.key === key ? state : { data: null, error: "", loading: true }),
    retry: () => setRevision((v) => v + 1),
  };
}
export function LoadState({ resource }) {
  return (
    <>
      {resource.loading && <p role="status">Loading backend data…</p>}
      <Message error={resource.error} />
      {resource.error && (
        <Button variant="outline" onClick={resource.retry}>
          Retry
        </Button>
      )}
    </>
  );
}
export function RentalStatus({ status, reservation }) {
  const selfStorageContracted = reservation?.serviceType === "SELF_STORAGE" && status === "CONTRACTED";
  return (
    <Badge
      variant={
        ["ACTIVE", "PAID", "CLOSED"].includes(status) ? "green" : "orange"
      }
    >
      {(selfStorageContracted ? "Booking confirmed — advance-rent Deposit pending" : reservation && reservationLifecycle(reservation).label) || statusLabels[status] || status || "Status not returned"}
    </Badge>
  );
}
export function addressText(value) {
  return typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? ["line1", "ward", "district", "city", "country"]
          .map((key) => value[key])
          .filter((v) => typeof v === "string")
          .join(", ")
      : undefined;
}
export function RentalSummary({ item, localizeManagedV2=false }) {
  const localized=localizeManagedV2&&isManagedV2(item),date=value=>localized?reservationVietnamTime(value):value;
  const facility =
      typeof item.facilityId === "object" ? item.facilityId : item.facility,
    unit =
      typeof item.storageUnitId === "object"
        ? item.storageUnitId
        : item.storageUnit;
  const values = [
    ["Service", serviceLabel(item)],
    ["Reservation ID", recordId(item)],
    ["Reservation code", item.reservationCode],
    ["Facility", facility?.name],
    ["Address", addressText(facility?.address)],
    ...(serviceType(item) === MANAGED_INVENTORY
      ? [
          ["Allocated capacity (m³)", item.allocatedCapacity],
          ["Currency", item.managedPricingSnapshot?.pricingRule?.currency],
        ]
      : serviceType(item) === SELF_STORAGE
        ? [
            ["Storage unit", unit?.unitCode],
            ["Unit size", unit?.size],
            ["Volume (m³)", unit?.volumeM3],
          ]
        : []),
    ["Start date", date(item.startDate)],
    ["End date", date(item.endDate)],
    ...(!isManagedV2(item)?[["Estimated rent", item.estimatedRent],["Deposit", item.depositAmount]]:[]),
    ["Payment deadline", date(item.paymentDeadline || item.expiresAt)],
  ];
  return (
    <Card>
      <CardContent>
        <RentalStatus status={item.status} reservation={item} />
        <div className="mt-5">
          {isManagedV2(item)&&<ManagedFinancialSummary reservation={item} localizeCurrency={localized}/>}
          <Details
            values={values.filter(
              ([, v]) => v !== undefined && v !== null && typeof v !== "object",
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
export function ManagedFinancialSummary({reservation,quote,localizeCurrency=false}){
  try{const result=quote?managedQuoteFinancials(quote):managedReservationFinancials(reservation);return <div><Details values={managedFinancialRows(result,localizeCurrency?reservationAmount:undefined)}/><p className="mt-2 text-xs text-slate-500">Advance rent is included in the total, not an additional security deposit. The planned balance does not prove payment.</p></div>;}
  catch(error){return <Message error={error.message}/>;}
}
export function BackendScreen({ children, ...props }) {
  return <CustomerScreen {...props}>{children}</CustomerScreen>;
}
export function ConfirmAction({ label, disabled, onAction }) {
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    busy = useRef(false);
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onAction();
      setOpen(false);
    } catch (e) {
      setError(rentalError(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      <Button
        disabled={disabled || pending}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open && (
        <div
          role="group"
          aria-label="Explicit action confirmation"
          className="soft-panel rounded-xl p-5"
        >
          <p className="mb-4 text-sm">
            Review this action before confirming: {label}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending} onClick={submit}>
              {pending ? "Submitting…" : "Confirm action"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
          <Message error={error} />
        </div>
      )}
    </div>
  );
}
