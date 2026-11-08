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
import { isValidObjectId } from "@/lib/selfStoragePayos";
import facilityApi from "@/api/facilityApi";
import storageApi from "@/api/storageApi";
import { selfStorageAlternatives } from "./selfStorageSuggestions";
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
    [error, setError] = useState(""),
    [alternatives, setAlternatives] = useState([]);
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
    setAlternatives([]);
    const token = getAccessToken();
    let sent = false;
    try {
      const customerId = session?.user?.id || session?.user?._id;
      let bookingStorage = null;
      try {
        bookingStorage = window.sessionStorage;
      } catch {
        bookingStorage = null;
      }
      if (!isValidObjectId(customerId) || !bookingStorage) {
        throw Error(
          "This browser cannot safely preserve the booking request. Allow session storage and try again.",
        );
      }
      const bookingAttempt = readOrCreateSelfStorageBookingAttempt(
        bookingStorage,
        customerId,
        context.payload,
      );
      if (bookingAttempt.reservationId) {
        nav("/portal/payments/" + bookingAttempt.reservationId);
        return;
      }
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
      attempted.current = true;
      sent = true;
      const response = await reservationApi.createReal(fresh.payload, {
        headers: { "Idempotency-Key": bookingAttempt.idempotencyKey },
      });
      const created = selfStorageCreation(response, fresh.payload);
      if (getAccessToken() !== token) return;
      const createdReservationId = recordId(created);
      try {
        writeSelfStorageBookingAttempt(bookingStorage, {
          ...bookingAttempt,
          reservationId: createdReservationId,
        });
      } catch {
        // The booking is already saved. Its original key still protects a replay.
      }
      nav("/portal/payments/" + createdReservationId, {
        state: { selfStorageCreated: true, startDepositAfterBooking: response.status === 201 },
      });
      updateRentalDraft({
        facility: null,
        unit: null,
        quote: null,
        startDate: "",
        endDate: "",
        term: null,
      });
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
        setAlternatives(selfStorageAlternatives(e, recordId(draft.unit)));
        resource.retry();
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function selectAlternative(suggestion) {
    if (busy.current || pending || uncertain) return;
    busy.current = true;
    setPending(true);
    setError("");
    const token = getAccessToken();
    try {
      const unit = record(await storageApi.unitDetail(suggestion._id));
      if (getAccessToken() !== token) return;
      if (
        recordId(unit) !== suggestion._id ||
        recordId(unit.facilityId) !== recordId(draft.facility) ||
        unit.size !== suggestion.size ||
        ["INACTIVE", "MAINTENANCE"].includes(unit.status)
      )
        throw Error(
          "Alternative Unit could not be verified. Select storage again.",
        );
      // Dates and term remain. Pricing and availability are reviewed again for the explicitly selected Unit.
      updateRentalDraft({ unit, quote: null });
      nav("/portal/rent/period");
    } catch (e) {
      if (getAccessToken() === token) setError(rentalError(e));
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
      {alternatives.length > 0 && !uncertain && (
        <section
          aria-label="Alternative storage units"
          className="soft-panel space-y-3 p-4"
        >
          <h2 className="font-bold">
            Other Units suggested for your rental period
          </h2>
          <p>
            Your dates are preserved. Choose a Unit explicitly, then review its
            availability and pricing. No booking is retried automatically.
          </p>
          {alternatives.map((unit) => (
            <Button
              key={unit._id}
              variant="outline"
              disabled={pending}
              onClick={() => selectAlternative(unit)}
            >
              Review {unit.unitCode} · {unit.size}
              {unit.sameSize ? " · same size" : ""}
            </Button>
          ))}
        </section>
      )}
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
        {pending
          ? "Đang xác nhận đặt kho và thanh toán…"
          : "Xác nhận đặt kho và thanh toán"}
      </Button>
      {uncertain && (
        <div className="grid gap-2 sm:flex">
          <Button
            variant="orange"
            disabled={pending}
            onClick={retryUncertainCreation}
          >
            Thử khôi phục đơn thuê an toàn
          </Button>
          <Button asChild variant="outline">
            <Link to="/portal">Kiểm tra kho của tôi</Link>
          </Button>
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
