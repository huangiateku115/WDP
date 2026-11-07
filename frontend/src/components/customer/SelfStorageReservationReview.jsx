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
import Steps from "@/components/common/Steps";
import {
  BackendScreen,
  Card,
  CardContent,
  Button,
  Details,
  Message,
  Link,
  useBackend,
  LoadState,
  record,
  recordId,
  rentalError,
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
          "The reservation result could not be verified. Check My Storage before booking again. This request will not be retried automatically.",
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
  return (
    <BackendScreen
      title="Review your reservation"
      description="Confirm the selected facility, unit, UTC rental period and authoritative Backend estimate."
    >
      <Steps current={3} />
      <LoadState resource={resource} />
      {context && (
        <>
          <Card>
            <CardContent>
              <Details
                values={[
                  ["Service", "Self Storage"],
                  ["Facility", context.facility.name],
                  ["Storage unit", context.unit.unitCode],
                  ["Start date", context.payload.startDate],
                  ["End date", context.payload.endDate],
                  ["Commitment", `${draft.term.value} ${draft.term.unit}`],
                  ["Pricing rule", context.payload.pricingPolicyId],
                  ["Currency", context.price.currency],
                  ["Estimated rent", context.estimate.estimatedRent],
                  ["Deposit", context.estimate.depositAmount],
                  ["Tax", context.estimate.taxAmount],
                  ["Duration (days)", context.estimate.durationDays],
                ]}
              />
            </CardContent>
          </Card>
          {!verified && (
            <Message error="Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt." />
          )}
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox
              aria-label="Confirm provided personal data"
              checked={confirmed}
              disabled={pending || uncertain}
              onCheckedChange={(v) => setConfirmed(v === true)}
            />
            <span>
              I confirm that all provided personal data and reservation details
              are accurate.
            </span>
          </label>
        </>
      )}
      <Message error={error} />
      <Button
        variant="orange"
        disabled={
          !confirmed ||
          !verified ||
          !context ||
          resource.loading ||
          !!resource.error ||
          pending ||
          uncertain
        }
        onClick={create}
      >
        {pending ? "Đang xác nhận đặt kho và thanh toán…" : "Xác nhận đặt kho và thanh toán"}
      </Button>
      {uncertain && (
        <div className="grid gap-2 sm:flex">
          <Button variant="orange" disabled={pending} onClick={retryUncertainCreation}>Thử khôi phục đơn thuê an toàn</Button>
          <Button asChild variant="outline"><Link to="/portal">Kiểm tra kho của tôi</Link></Button>
        </div>
      )}
      <Link to="/portal/rent/period" className="block">
        Back to rental period
      </Link>
      <Link to="/portal/rent" className="block">
        Select another unit
      </Link>
    </BackendScreen>
  );
}
