import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReservation } from "@/contexts/ReservationContext";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import {
  selfStorageRequest,
  selfStorageEstimate,
  selfStorageCreation,
  sameEstimate,
  readOrCreateSelfStorageBookingAttempt,
  writeSelfStorageBookingAttempt,
} from "@/lib/selfStorageReservation";
import reservationApi from "@/api/reservationApi";
import paymentApi from "@/api/paymentApi";
import { newPayosIdempotencyKey, readPayosAttempts, writePayosAttempts, isValidObjectId } from "@/lib/selfStoragePayos";
import { canOpenPayosCheckout } from "@/api/payosPaymentClient";
import facilityApi from "@/api/facilityApi";
import storageApi from "@/api/storageApi";
import { pricingApi, customerProfileApi } from "@/api/customerRentalApi";
import { Checkbox } from "@/components/ui/checkbox";
import { reservationDateOnly, reservationAmount } from "@/lib/customerReservationDisplay";
import { CalendarDays, CheckCircle2, ClipboardCheck, Warehouse, ArrowLeft } from "lucide-react";

const displayDate = (value) => reservationDateOnly(typeof value === "string" ? value.slice(0, 10) : value) || "Chưa có thông tin";
const displayMoney = (value, currency) => typeof value === "number" && Number.isFinite(value) && typeof currency === "string" ? reservationAmount(value, currency) : "Chưa xác định đơn vị tiền tệ";
import Steps from "@/components/common/Steps";
import {
  BackendScreen,
  Card,
  CardContent,
  Button,
  Message,
  Link,
  useBackend,
  LoadState,
  record,
  recordId,
  rentalError,
  addressText,
} from "./RentalBackendUI";

async function reviewContext(draft, config) {
  const request = selfStorageRequest(draft);
  const [facility, unit, profile, price] = await Promise.all([
    facilityApi.publicDetail(request.facilityId, config).then(record),
    storageApi.unitDetail(request.storageUnitId, config).then(record),
    customerProfileApi.get(config).then(record),
    pricingApi
      .resolve(
        {
          facilityId: request.facilityId,
          serviceType: "SELF_STORAGE",
          unitSize: draft.unit.size,
          termValue: draft.term.value,
          termUnit: draft.term.unit,
          at: request.startDate,
        },
        config,
      )
      .then(record),
  ]);
  if (
    recordId(facility) !== request.facilityId ||
    recordId(unit) !== request.storageUnitId
  )
    throw Error(
      "Backend returned a different facility or unit. Select storage again.",
    );
  const payload = selfStorageRequest({
    ...draft,
    facility,
    unit,
    quote: { price },
  });
  const estimate = selfStorageEstimate(
    await reservationApi.estimateReal(payload, config),
  );
  return { facility, unit, profile, price, payload, estimate };
}
export default function SelfStorageReservationReview() {
  const { rentalDraft } = useReservation(),
    session = useAuthSession();
  return (
    <Review
      key={JSON.stringify([session.accessToken, rentalDraft])}
      draft={rentalDraft}
      session={session}
    />
  );
}
function Review({ draft, session }) {
  const nav = useNavigate(),
    { updateRentalDraft } = useReservation();
  const resource = useBackend((config) => reviewContext(draft, config));
  const [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false),
    attempted = useRef(false),
    context = resource.data;
  useEffect(() => {
    setConfirmed(false);
  }, [context]);
  const verified = context?.profile.verificationStatus === "VERIFIED";
  async function create() {
    if (
      busy.current ||
      attempted.current ||
      !confirmed ||
      !verified ||
      !context ||
      resource.loading ||
      resource.error
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    const token = getAccessToken();
    let sent = false;
    try {
      const fresh = await reviewContext(draft);
      if (getAccessToken() !== token) return;
      if (fresh.profile.verificationStatus !== "VERIFIED")
        throw Error(
          "Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt.",
        );
      if (
        JSON.stringify(fresh.payload) !== JSON.stringify(context.payload) ||
        !sameEstimate(fresh.estimate, context.estimate)
      ) {
        setConfirmed(false);
        resource.retry();
        throw Error(
          "The Backend price or selected unit changed. Review the refreshed estimate and confirm again.",
        );
      }
      const customerId = session?.user?.id || session?.user?._id;
      let bookingStorage = null;
      try { bookingStorage = window.sessionStorage; } catch { bookingStorage = null; }
      if (!isValidObjectId(customerId) || !bookingStorage) {
        throw Error("This browser cannot safely preserve the booking request. Allow session storage and try again.");
      }
      const bookingAttempt = readOrCreateSelfStorageBookingAttempt(bookingStorage, customerId, fresh.payload);
      attempted.current = true;
      sent = true;
      const created = selfStorageCreation(
        await reservationApi.createReal(fresh.payload, { headers: { "Idempotency-Key": bookingAttempt.idempotencyKey } }),
        fresh.payload,
      );
      if (getAccessToken() !== token) return;
      const createdReservationId = recordId(created);
      writeSelfStorageBookingAttempt(bookingStorage, { ...bookingAttempt, reservationId: createdReservationId });
      updateRentalDraft({ facility: null, unit: null, quote: null, startDate: "", endDate: "", term: null });
      let checkoutCreated = false;
      let checkoutRecoveryNeeded = false;
      let storage = null;
      try { storage = window.sessionStorage; } catch { storage = null; }
      if (isValidObjectId(customerId) && storage && isValidObjectId(createdReservationId)) {
        try {
          const tracked = readPayosAttempts(storage, customerId, createdReservationId, "DEPOSIT");
          if (tracked.unavailable || tracked.corrupt) throw Error("Payment attempt tracking is unavailable.");
          let attempts = tracked.attempts;
          let attempt = attempts.at(-1);
          if (!attempt) {
            attempt = { idempotencyKey: newPayosIdempotencyKey(), paymentId: null };
            attempts = [...attempts, attempt];
            writePayosAttempts(storage, customerId, createdReservationId, "DEPOSIT", attempts);
          }
          if (attempt.paymentId) {
            checkoutRecoveryNeeded = true;
          } else {
            const result = await paymentApi.createPayosCheckout(createdReservationId, "DEPOSIT", attempt.idempotencyKey);
            if (getAccessToken() !== token) return;
            attempts = attempts.map((entry) => entry.idempotencyKey === attempt.idempotencyKey ? { ...entry, paymentId: result.payment.id } : entry);
            writePayosAttempts(storage, customerId, createdReservationId, "DEPOSIT", attempts);
            checkoutCreated = true;
            if (result.payment.reservationId === createdReservationId && result.payment.purpose === "DEPOSIT" && canOpenPayosCheckout(result.payment)) {
              window.location.assign(result.payment.checkoutUrl);
              return;
            }
          }
        } catch {
          checkoutRecoveryNeeded = true;
        }
      } else {
        checkoutRecoveryNeeded = true;
      }
      nav("/portal/payments/" + createdReservationId, { state: { selfStorageCreated: true, checkoutCreated, checkoutRecoveryNeeded } });
    } catch (e) {
      if (getAccessToken() !== token) return;
      const status = e.response?.status;
      if (sent && (!status || status >= 500)) {
        setUncertain(true);
        setError(
          "Chưa thể xác minh kết quả đặt thuê. Vui lòng kiểm tra Kho của tôi trước khi tạo đơn khác. Hệ thống sẽ không tự gửi lại yêu cầu này.",
        );
      } else {
        attempted.current = false;
        setConfirmed(false);
        setError(rentalError(e));
        resource.retry();
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function retryUncertainCreation() {
    if (busy.current || !uncertain) return;
    attempted.current = false;
    setUncertain(false);
    void create();
  }
  const sizeLabel={SMALL:'Nhỏ',MEDIUM:'Vừa',LARGE:'Lớn'};
  const termLabel=`${draft.term?.value||'—'} ${{MONTH:'tháng',DAY:'ngày',YEAR:'năm'}[draft.term?.unit]||''}`.trim();
  return <BackendScreen title="Kiểm tra thông tin thuê kho" description="Vui lòng kiểm tra thông tin và chi phí trước khi xác nhận đặt thuê." eyebrow="BƯỚC 3 / 4 · KIỂM TRA ĐƠN" notice="Đơn thuê chỉ được gửi sau khi bạn xác nhận thông tin.">
    <Steps current={3}/>
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#c9dfd0] bg-[#e8f4ec] px-4 py-3 text-sm text-[#17382A]"><ClipboardCheck className="shrink-0 text-[#176B45]" size={19}/><span>Bạn sắp hoàn tất việc đặt kho. Hãy rà soát các mục bên dưới.</span></div>
    <LoadState resource={resource}/>
    {context&&<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(270px,3fr)]">
      <div className="min-w-0 space-y-5">
        <Card className="border-[#d4e2d8] shadow-sm"><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-[#e8f4ec] p-2.5 text-[#176B45]"><Warehouse size={20}/></span><div><h2 className="text-lg font-bold">Kho bạn đã chọn</h2><p className="text-sm text-[#607568]">Thông tin cơ sở và không gian lưu trữ</p></div></div><Link className="text-sm font-semibold text-[#176B45] underline-offset-4 hover:underline" to="/portal/rent">Thay đổi kho</Link></div><dl className="mt-5 grid gap-4 sm:grid-cols-2">{[['Cơ sở',context.facility.name],['Địa chỉ',addressText(context.facility.address)],['Mã kho',context.unit.unitCode],['Kích thước',sizeLabel[context.unit.size]||context.unit.size],['Thể tích',typeof context.unit.volumeM3==='number'?`${context.unit.volumeM3} m³`:null]].filter(([,value])=>value!=null&&value!=='').map(([label,value])=><div key={label} className="min-w-0 rounded-lg bg-[#f7faf7] p-3"><dt className="text-xs font-medium text-[#607568]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#17382A]">{value}</dd></div>)}</dl></CardContent></Card>
        <Card className="border-[#d4e2d8] shadow-sm"><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="rounded-xl bg-[#e8f4ec] p-2.5 text-[#176B45]"><CalendarDays size={20}/></span><div><h2 className="text-lg font-bold">Thời gian thuê</h2><p className="text-sm text-[#607568]">Thời hạn đã được kiểm tra ở bước trước</p></div></div><Link className="text-sm font-semibold text-[#176B45] underline-offset-4 hover:underline" to="/portal/rent/period">Thay đổi thời gian</Link></div><div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><div className="rounded-xl border border-[#d4e2d8] p-4"><p className="text-xs text-[#607568]">Ngày bắt đầu</p><p className="mt-1 text-lg font-bold text-[#17382A]">{displayDate(context.payload.startDate)}</p></div><div className="hidden h-px w-12 bg-[#176B45] sm:block" aria-hidden="true"/><div className="rounded-xl border border-[#d4e2d8] p-4"><p className="text-xs text-[#607568]">Ngày kết thúc</p><p className="mt-1 text-lg font-bold text-[#17382A]">{displayDate(context.payload.endDate)}</p></div></div><p className="mt-4 rounded-lg bg-[#f7faf7] p-3 text-sm text-[#607568]">Thời hạn thuê: <b className="text-[#17382A]">{termLabel}</b></p></CardContent></Card>
        {!verified&&<Message error="Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt."/>}
      </div>
      <aside className="space-y-4 lg:sticky lg:top-28"><Card className="border-[#c9dfd0] shadow-md"><CardContent><div className="flex items-center gap-3"><span className="rounded-xl bg-[#e8f4ec] p-2.5 text-[#176B45]"><CheckCircle2 size={20}/></span><div><h2 className="text-lg font-bold">Tóm tắt chi phí</h2><span className="text-xs font-semibold text-[#607568]">Số tiền dự kiến</span></div></div><div className="mt-5 space-y-4"><div className="flex items-start justify-between gap-4 border-b border-[#e4ece6] pb-4"><span className="text-sm text-[#607568]">Tiền thuê dự kiến</span><b className="text-right text-base text-[#17382A]">{displayMoney(context.estimate.estimatedRent,context.price.currency)}</b></div><div className="flex items-start justify-between gap-4"><span className="text-sm text-[#607568]">Khoản trả trước dự kiến</span><b className="text-right text-base text-[#17382A]">{displayMoney(context.estimate.depositAmount,context.price.currency)}</b></div></div><p className="mt-5 text-xs leading-5 text-[#607568]">Khoản thanh toán chính thức sẽ được hiển thị trước khi bạn thanh toán.</p></CardContent></Card>
        <Message error={error}/>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#d4e2d8] bg-white p-4 text-sm leading-6 text-[#17382A]"><Checkbox aria-label="Xác nhận thông tin đặt thuê chính xác" checked={confirmed} disabled={pending||uncertain} onCheckedChange={v=>setConfirmed(v===true)}/><span>Tôi xác nhận thông tin cá nhân đã cung cấp và thông tin đơn thuê ở trên là chính xác.</span></label>
        <Button className="w-full" disabled={!confirmed||!verified||!context||resource.loading||!!resource.error||pending||uncertain} onClick={create}>{pending?'Đang xác nhận đơn thuê…':'Xác nhận đặt thuê'}</Button>
        {uncertain&&<div className="space-y-2"><Button className="w-full" variant="outline" disabled={pending} onClick={retryUncertainCreation}>Thử lại bằng yêu cầu đã lưu</Button><Button className="w-full" variant="outline" asChild><Link to="/portal">Kiểm tra Kho của tôi</Link></Button></div>}
        <Button className="w-full" variant="outline" asChild><Link to="/portal/rent/period"><ArrowLeft size={16}/>Quay lại</Link></Button>
      </aside>
    </div>}
    {!resource.loading&&!context&&!resource.error&&<div className="rounded-xl border border-dashed border-[#c9dfd0] bg-white p-6 text-center"><p className="text-sm text-[#607568]">Chưa có đủ thông tin để kiểm tra đơn thuê.</p><Button className="mt-4" variant="outline" asChild><Link to="/portal/rent">Quay lại chọn kho</Link></Button></div>}
  </BackendScreen>;
}
