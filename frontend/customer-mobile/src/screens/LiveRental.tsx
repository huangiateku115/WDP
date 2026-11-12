import { CardHeading, TintedPanel } from "../components/livePresentation";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiIssue, MobileInputError } from "../api/client";
import { mobileRepo } from "../api/mobileRepository";
import { lifecycle, type ReservationDto } from "../api/contracts/customer";
import { journal, newAttempt } from "../state/attemptJournal";
import { useLiveSession } from "../state/useLiveSession";
import {
  openSelfStoragePayment,
  paymentContext,
  readRentalPayment,
} from "../api/selfStoragePayment";
import {
  AppText,
  Button,
  Card,
  Chip,
  Filter,
  StateCard,
  ui,
} from "../components/ui";
import {
  dateLabel,
  LiveScreen,
  money,
  ResourceState,
  serviceLabel,
  useResource,
} from "../components/liveUI";

import { ReservationProgressTracker } from "../components/ReservationProgressTracker";
import { reservationProgress } from "../domain/reservationProgress";
import {
  BookingCalendar,
  bookingDateLabel,
} from "../components/BookingCalendar";
import {
  canStartOn,
  rentalEndDate,
  termKey,
  termLabels,
  utcToday,
  type RentalTerm,
} from "../domain/liveBooking";

function rentalLabel(r: ReservationDto) {
  const progress = reservationProgress(r);
  if (progress) return progress.summary;
  const label = lifecycle(r).label;
  return label !== r.status
    ? label
    : ({
        OVERDUE: "Quá hạn",
        CHECKED_OUT: "Đã trả kho",
        CLOSED: "Đã đóng",
        CANCELLED: "Đã hủy",
      }[r.status as string] ?? "Đang cập nhật");
}

export function RentalCard({ r }: { r: ReservationDto }) {
  const router = useRouter();
  return (
    <Card>
      <CardHeading icon="key-outline" title={r.reservationCode} />
      <AppText>
        {serviceLabel(r.serviceType)} · {rentalLabel(r)}
      </AppText>
      <AppText>
        {dateLabel(r.startDate)} – {dateLabel(r.endDate)}
      </AppText>
      <Button
        label="Xem đơn thuê"
        icon="arrow-forward-outline"
        variant="outline"
        onPress={() =>
          router.push({
            pathname: "/preview/[kind]/[id]",
            params: { kind: "rental", id: r._id },
          })
        }
      />
    </Card>
  );
}
export function Rentals() {
  const owner = useLiveSession((s) => s.user?._id ?? "");
  const data = useResource(owner, (signal) =>
    mobileRepo.rentals(owner, signal),
  );
  return (
    <LiveScreen
      title="Kho của tôi"
      eyebrow="ĐƠN THUÊ"
      subtitle="Theo dõi trạng thái và các bước tiếp theo của từng đơn."
      onRefresh={data.reload}
      refreshing={data.loading}
    >
      <ResourceState {...data} />
      {data.data?.length === 0 && <StateCard title="Bạn chưa có đơn thuê" />}
      {data.data?.map((r) => (
        <RentalCard key={r._id} r={r} />
      ))}
    </LiveScreen>
  );
}
export function RentalDetail({ id }: { id: string }) {
  const owner = useLiveSession((s) => s.user?._id ?? ""),
    router = useRouter();
  const data = useResource(owner + ":" + id, (signal) =>
    mobileRepo.rental(id, owner, signal),
  );
  const r = data.data;
  const facility =
    typeof r?.facilityId === "object" && typeof r.facilityId.name === "string"
      ? r.facilityId.name
      : undefined;
  const unit =
    typeof r?.storageUnitId === "object" &&
    typeof r.storageUnitId?.unitCode === "string"
      ? r.storageUnitId.unitCode
      : undefined;
  return (
    <LiveScreen
      title="Chi tiết đơn thuê"
      eyebrow="HỒ SƠ THUÊ"
      subtitle="Thông tin kho, hợp đồng và tiến độ của đơn thuê."
      onRefresh={data.reload}
      refreshing={data.loading}
    >
      <ResourceState {...data} />
      {r && (
        <Card>
          <AppText variant="card">{r.reservationCode}</AppText>
          <AppText>{rentalLabel(r)}</AppText>
          <AppText>
            {dateLabel(r.startDate)} – {dateLabel(r.endDate)}
          </AppText>
          {r.serviceType === "SELF_STORAGE" && (
            <>
              <AppText>Cơ sở: {facility ?? "Chưa có thông tin"}</AppText>
              <AppText>Kho: {unit ?? "Chưa có thông tin"}</AppText>
            </>
          )}
          <Button
            label="Xem hợp đồng"
            icon="document-text-outline"
            variant="outline"
            onPress={() =>
              router.push({
                pathname: "/rentals/[id]/contract",
                params: { id },
              })
            }
          />
          {r.serviceType === "SELF_STORAGE" && (
            <Button
              label="Thanh toán và lịch sử"
              icon="card-outline"
              onPress={() =>
                router.push({
                  pathname: "/rentals/[id]/payment",
                  params: { id },
                })
              }
            />
          )}
        </Card>
      )}
      {r?.serviceType === "SELF_STORAGE" && (
        <RentalProgress
          key={owner + ":" + id}
          reservation={r}
          owner={owner}
          onRetry={data.reload}
        />
      )}
    </LiveScreen>
  );
}

function RentalProgress({
  reservation,
  owner,
  onRetry,
}: {
  reservation: ReservationDto;
  owner: string;
  onRetry: () => void;
}) {
  const router = useRouter();
  const read = useResource(owner + ":" + reservation._id, (signal) =>
    readRentalPayment(reservation, owner, signal, true),
  );
  if (read.error)
    return (
      <StateCard
        kind="error"
        title="Chưa thể xác minh tiến độ"
        description={read.error}
        onRetry={onRetry}
      />
    );
  const progress = read.data
    ? reservationProgress(reservation, {
        ...read.data,
        decision: read.data.decision.kind,
      })
    : null;
  if (!progress) return <ResourceState {...read} />;
  return (
    <ReservationProgressTracker
      progress={progress}
      onAction={(action) =>
        router.push(
          action.destination === "PAYMENT"
            ? {
                pathname: "/rentals/[id]/payment",
                params: {
                  id: reservation._id,
                  ...(action.purpose ? { purpose: action.purpose } : {}),
                },
              }
            : {
                pathname: "/rentals/[id]/contract",
                params: { id: reservation._id },
              },
        )
      }
    />
  );
}

export { Contract } from "./LiveContract";

export function BookingReview() {
  const { facilityId, unitId } = useLocalSearchParams<{
    facilityId: string;
    unitId: string;
  }>();
  return (
    <BookingForm
      key={facilityId + ":" + unitId}
      facilityId={facilityId}
      unitId={unitId}
    />
  );
}

function BookingForm({
  facilityId,
  unitId,
}: {
  facilityId: string;
  unitId: string;
}) {
  const owner = useLiveSession((s) => s.user?._id ?? ""),
    router = useRouter();
  const [start, setStart] = useState(""),
    [month, setMonth] = useState(() => utcToday().slice(0, 7));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [durationUnit, setDurationUnit] = useState<RentalTerm["unit"]>("MONTH"),
    [selectedTerm, setSelectedTerm] = useState("");
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false);
  const preflight = useRef<AbortController | null>(null);
  useEffect(() => () => preflight.current?.abort(), []);
  const unitData = useResource(facilityId + ":" + unitId, (signal) =>
    mobileRepo.unit(facilityId, unitId, signal),
  );
  const status = unitData.data?.status;
  const unitReady =
    status === "AVAILABLE" || status === "OCCUPIED" || status === "HELD";
  const monthly = useResource(
    unitId + ":" + month + ":" + unitReady,
    (signal) =>
      unitReady
        ? mobileRepo.monthlyAvailability(unitId, month, signal)
        : Promise.resolve(null),
  );
  const size = unitReady ? unitData.data?.size : undefined;
  const terms = useResource(facilityId + ":" + size + ":" + start, (signal) =>
    start && size
      ? mobileRepo.bookingTerms(facilityId, size, start, signal)
      : Promise.resolve([]),
  );
  const term = terms.data?.find((option) => termKey(option) === selectedTerm);
  const end = term ? rentalEndDate(start, term) : undefined;
  const period =
    start && start > utcToday() && end && term ? { start, end, ...term } : null;
  const scope = period
    ? JSON.stringify([facilityId, unitId, start, end, selectedTerm])
    : "";
  const review = useResource(owner + ":" + scope, async (signal) => {
    if (!period) return null;
    const store = await journal(
      "booking",
      owner,
      JSON.stringify([facilityId, unitId, start, end]),
    );
    const attempt = await store.read();
    const quote = attempt
      ? null
      : await mobileRepo.quote(facilityId, unitId, period, signal);
    return { quote, attempt, store };
  });

  async function confirm() {
    const currentReview = review.data;
    if (busy.current || !period || !currentReview) return;
    busy.current = true;
    setPending(true);
    setError("");
    const { store, quote } = currentReview;
    const controller = new AbortController();
    preflight.current = controller;
    let creating = false;
    try {
      let attempt = await store.read();
      if (attempt?.resourceId) {
        const r = await mobileRepo.rental(
          attempt.resourceId,
          owner,
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          useLiveSession.getState().user?._id === owner
        )
          router.replace({
            pathname: "/rentals/[id]/payment",
            params: { id: r._id },
          });
        return;
      }
      if (!attempt) {
        if (!quote)
          throw new MobileInputError("Không xác minh được lần đặt kho đã lưu.");
        const fresh = await mobileRepo.quote(
          facilityId,
          unitId,
          period,
          controller.signal,
        );
        if (
          JSON.stringify(fresh.estimate) !== JSON.stringify(quote.estimate) ||
          JSON.stringify(fresh.body) !== JSON.stringify(quote.body)
        ) {
          throw new MobileInputError(
            "Giá hoặc kỳ thuê đã thay đổi. Vui lòng kiểm tra và xác nhận lại.",
          );
        }
        if (
          controller.signal.aborted ||
          useLiveSession.getState().user?._id !== owner
        )
          return;
        attempt = { ...newAttempt(), bookingBody: fresh.body };
        if (!(await store.claim(attempt)))
          throw new MobileInputError(
            "Đã có lần đặt kho. Vui lòng kiểm tra lại.",
          );
      }
      if (!attempt.bookingBody)
        throw new MobileInputError(
          "Không xác minh được lần đặt kho đã lưu. Hãy kiểm tra Kho của tôi.",
        );
      if (
        controller.signal.aborted ||
        useLiveSession.getState().user?._id !== owner
      )
        return;
      creating = true;
      const r = await mobileRepo.book(attempt.bookingBody, attempt.key, owner);
      await store.write({ ...attempt, resourceId: r._id }).catch(() => {});
      if (useLiveSession.getState().user?._id === owner)
        router.replace({
          pathname: "/rentals/[id]/payment",
          params: { id: r._id },
        });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const conflict =
        creating && axios.isAxiosError(cause) && cause.response?.status === 409;
      setError(
        conflict
          ? "Kho không còn trống hoặc trạng thái đặt kho đã thay đổi. Hãy kiểm tra Kho của tôi hoặc chọn kỳ thuê khác."
          : apiIssue(cause),
      );
      if (conflict) {
        setStart("");
        setSelectedTerm("");
      }
      monthly.reload();
      review.reload();
    } finally {
      preflight.current = null;
      busy.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const quote = review.data?.quote;
  const availableUnits = (["DAY", "MONTH", "YEAR"] as const).filter((unit) =>
    terms.data?.some((term) => term.unit === unit),
  );
  const activeUnit = availableUnits.includes(durationUnit)
    ? durationUnit
    : availableUnits[0];
  return (
    <LiveScreen
      title="Kỳ thuê và xác nhận"
      eyebrow="ĐẶT KHO · THỜI HẠN"
      subtitle="Chọn ngày bắt đầu và kỳ hạn để xem báo giá."
    >
      <ResourceState {...unitData} />
      {unitData.data && !unitReady ? (
        <StateCard
          title="Kho không khả dụng"
          description="Vui lòng quay lại và chọn kho khác."
        />
      ) : null}
      {unitReady && (
        <Card>
          <CardHeading
            icon="calendar-outline"
            title={`Kho ${unitData.data?.unitCode ?? ""}`}
          />
          <AppText variant="label">Ngày bắt đầu</AppText>
          <Button
            label={
              calendarOpen
                ? "Đóng lịch"
                : start
                  ? bookingDateLabel(start)
                  : "Chọn ngày bắt đầu"
            }
            variant="outline"
            disabled={pending}
            onPress={() => setCalendarOpen(!calendarOpen)}
          />
          {calendarOpen && (
            <BookingCalendar
              month={month}
              setMonth={setMonth}
              selected={start}
              resource={monthly}
              onSelect={(date) => {
                if (!pending && canStartOn(date, monthly.data ?? undefined)) {
                  setStart(date);
                  setSelectedTerm("");
                  setCalendarOpen(false);
                  setError("");
                }
              }}
            />
          )}
          {start ? (
            <>
              <AppText variant="label">Thời hạn thuê</AppText>
              <ResourceState {...terms} />
              {terms.data?.length === 0 ? (
                <AppText>Không có kỳ hạn áp dụng cho ngày này.</AppText>
              ) : null}
              {!pending && (
                <View style={ui.wrap}>
                  {availableUnits.map((unit) => (
                    <Filter
                      key={unit}
                      label={termLabels[unit]}
                      selected={activeUnit === unit}
                      onPress={() => {
                        if (activeUnit !== unit) {
                          setDurationUnit(unit);
                          setSelectedTerm("");
                          setError("");
                        }
                      }}
                    />
                  ))}
                </View>
              )}
              {!pending && (
                <View style={ui.wrap}>
                  {terms.data
                    ?.filter((term) => term.unit === activeUnit)
                    .map((option) => (
                      <Filter
                        key={termKey(option)}
                        label={
                          option.value +
                          " " +
                          termLabels[option.unit].toLowerCase()
                        }
                        selected={selectedTerm === termKey(option)}
                        onPress={() => {
                          setSelectedTerm(termKey(option));
                          setError("");
                        }}
                      />
                    ))}
                </View>
              )}
            </>
          ) : null}
          {end ? (
            <AppText>Ngày kết thúc: {bookingDateLabel(end)}</AppText>
          ) : null}
          {period && <ResourceState {...review} />}
          {quote && (
            <TintedPanel>
              <AppText variant="label">CHI PHÍ DỰ KIẾN</AppText>
              <AppText>
                Tiền thuê dự kiến {money(quote.estimate.estimatedRent)}
              </AppText>
              <AppText>
                Tiền đặt cọc {money(quote.estimate.depositAmount)}
              </AppText>
              <AppText>Thuế {money(quote.estimate.taxAmount)}</AppText>
            </TintedPanel>
          )}
          <Button
            label={
              review.data?.attempt
                ? "Khôi phục lần đặt kho"
                : "Xác nhận đặt kho"
            }
            loading={pending}
            disabled={
              !review.data || (!review.data.quote && !review.data.attempt)
            }
            onPress={() => void confirm()}
          />
        </Card>
      )}
      {error ? (
        <StateCard
          kind="error"
          title="Chưa thể hoàn tất đặt kho"
          description={error}
        />
      ) : null}
    </LiveScreen>
  );
}

export function Payment() {
  const { id, purpose } = useLocalSearchParams<{
    id: string;
    purpose?: string;
  }>();
  return (
    <PaymentScreen
      key={id + ":" + purpose}
      id={id}
      purpose={purpose === "BALANCE" ? "BALANCE" : "DEPOSIT"}
    />
  );
}

const paymentStatus = {
  PENDING: "Đang chờ xác nhận",
  SUCCEEDED: "Đã nhận thanh toán",
  FAILED: "Thất bại",
  RECONCILIATION_REQUIRED: "Cần đối soát",
} as const;
const checkoutStatus = {
  NOT_CREATED: "Chưa tạo",
  CREATING: "Đang tạo",
  READY: "Sẵn sàng",
  UNKNOWN: "Chưa rõ kết quả",
  RECONCILIATION_REQUIRED: "Cần đối soát",
} as const;
const applicationStatus = {
  APPLIED: "Đã ghi nhận vào đơn",
  NOT_APPLIED: "Chưa ghi nhận vào đơn",
  MANUAL_REVIEW: "Chờ đối soát",
} as const;

function PaymentScreen({
  id,
  purpose,
}: {
  id: string;
  purpose: "DEPOSIT" | "BALANCE";
}) {
  const router = useRouter();
  const owner = useLiveSession((s) => s.user?._id ?? "");
  const data = useResource(owner + ":" + id, (signal) =>
    paymentContext(id, owner, signal, true),
  );
  const busy = useRef(false),
    redirected = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const balance = purpose === "BALANCE";
  const decision = balance
    ? data.data?.balanceDecision.kind
    : data.data?.decision.kind;
  const state = data.data?.reservation.status;
  useEffect(() => {
    if (
      !redirected.current &&
      balance &&
      decision === "APPLIED" &&
      (state === "PAID" || state === "ACTIVE")
    ) {
      redirected.current = true;
      router.replace({
        pathname: "/preview/[kind]/[id]",
        params: { kind: "rental", id },
      });
    }
  }, [balance, decision, state, router, id]);

  async function pay() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await openSelfStoragePayment(
        id,
        owner,
        purpose,
        () => useLiveSession.getState().user?._id === owner,
        (url) => Linking.openURL(url),
      );
    } catch (cause) {
      setError(apiIssue(cause));
    } finally {
      busy.current = false;
      setPending(false);
      data.reload();
    }
  }

  const progress = data.data
    ? reservationProgress(data.data.reservation, {
        ...data.data,
        decision: data.data.decision.kind,
      })
    : null;
  const checkout = (decision === "CREATE" || decision === "READY") && (
    <Button
      label={
        decision === "READY"
          ? "Mở liên kết PayOS hiện có"
          : balance
            ? "Xác nhận tạo liên kết PayOS"
            : "Tạo liên kết thanh toán"
      }
      loading={pending}
      onPress={() => void pay()}
    />
  );
  return (
    <LiveScreen
      title={balance ? "Thanh toán phần còn lại" : "Thanh toán PayOS"}
      eyebrow="TÀI CHÍNH ĐƠN THUÊ"
      onRefresh={data.reload}
      refreshing={data.loading}
    >
      <AppText>
        Trạng thái thanh toán được xác nhận từ máy chủ. Khi trở lại ứng dụng,
        giao dịch sẽ được kiểm tra lại.
      </AppText>
      {data.error ? (
        <StateCard
          kind="error"
          title="Chưa thể xác minh tiến độ"
          description={data.error}
          onRetry={data.reload}
        />
      ) : (
        <ResourceState {...data} />
      )}
      {data.data && (
        <Card>
          <CardHeading
            icon="wallet-outline"
            title={data.data.reservation.reservationCode}
            subtitle={
              balance ? "Thanh toán phần còn lại" : "Thanh toán tiền cọc"
            }
          />
          <AppText>{rentalLabel(data.data.reservation)}</AppText>
          {decision === "APPLIED" && (
            <TintedPanel>
              <AppText accessibilityRole="status">
                {balance
                  ? "Số dư đã được xác minh và ghi nhận."
                  : "Tiền đặt cọc đã được xác minh và ghi nhận."}
              </AppText>
            </TintedPanel>
          )}
          {decision === "REVIEW" && (
            <TintedPanel tone="amber">
              <AppText>
                {balance
                  ? "Giao dịch cần được kiểm tra. Vui lòng không thanh toán lại."
                  : "Đã có lần thanh toán. Kiểm tra trạng thái hoặc liên hệ hỗ trợ để đối soát."}
              </AppText>
            </TintedPanel>
          )}
          {decision === "VERIFYING" && (
            <AppText>
              Đã nhận thông tin thanh toán, đang chờ hệ thống ghi nhận.
            </AppText>
          )}
          {decision === "PENDING" && (
            <AppText>Đang chờ xác nhận thanh toán.</AppText>
          )}
          {decision === "ZERO" && (
            <AppText>
              Không có số dư dương. Vui lòng liên hệ cơ sở để xác nhận bước tiếp
              theo.
            </AppText>
          )}
          {decision === "INELIGIBLE" && (
            <AppText>
              {balance
                ? "Đơn thuê chưa đủ điều kiện thanh toán số dư."
                : "Đơn thuê hoặc hợp đồng chưa đủ điều kiện thanh toán tiền cọc."}
            </AppText>
          )}
          {balance && decision === "CREATE" && (
            <AppText>
              Máy chủ xác định số tiền phải trả khi tạo liên kết.
            </AppText>
          )}
        </Card>
      )}
      {progress && (
        <ReservationProgressTracker
          progress={progress}
          paymentScreen
          paymentPurpose={purpose}
          onAction={(action) =>
            router.push(
              action.destination === "PAYMENT"
                ? {
                    pathname: "/rentals/[id]/payment",
                    params: { id, purpose: action.purpose ?? "DEPOSIT" },
                  }
                : { pathname: "/rentals/[id]/contract", params: { id } },
            )
          }
        >
          {checkout}
        </ReservationProgressTracker>
      )}
      {error && (
        <StateCard
          kind="error"
          title="Không mở được thanh toán"
          description={error}
          onRetry={data.reload}
        />
      )}
      {data.data && <AppText variant="heading">Lịch sử thanh toán</AppText>}
      {data.data?.payments.map((p) => (
        <Card key={p.id}>
          <CardHeading
            icon="card-outline"
            title={p.purpose === "DEPOSIT" ? "Đặt cọc" : "Tiền thuê còn lại"}
            subtitle={p.provider}
          />
          <AppText variant="heading">{money(p.amount)}</AppText>
          <Chip
            label={paymentStatus[p.status]}
            tone={p.reconciliationRequired ? "orange" : "neutral"}
          />
          <AppText>Liên kết: {checkoutStatus[p.checkoutStatus]}</AppText>
          <AppText>
            Xác minh thanh toán:{" "}
            {p.providerSettlementStatus === "VERIFIED"
              ? "Đã xác minh"
              : "Chưa xác minh"}
          </AppText>
          <AppText>{applicationStatus[p.applicationStatus]}</AppText>
          <AppText>
            Đối soát:{" "}
            {p.reconciliationRequired || p.checkoutStatus === "UNKNOWN"
              ? "Cần kiểm tra"
              : "Không có yêu cầu"}
          </AppText>
          <AppText>
            Ngày tạo: {p.createdAt ? dateLabel(p.createdAt) : "Chưa có dữ liệu"}
          </AppText>
          {p.succeededAt && (
            <AppText>Ngày thanh toán: {dateLabel(p.succeededAt)}</AppText>
          )}
        </Card>
      ))}
      <Button
        label="Kiểm tra trạng thái"
        icon="refresh-outline"
        variant="outline"
        disabled={pending}
        onPress={data.reload}
      />
    </LiveScreen>
  );
}
