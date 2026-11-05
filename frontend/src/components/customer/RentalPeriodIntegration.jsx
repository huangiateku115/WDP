import reservationApi from "@/api/reservationApi";
import storageApi from "@/api/storageApi";
import { selfStorageEstimate } from "@/lib/selfStorageReservation";
import { availabilityMatches, buildAvailabilityDays, monthKey, rangeContainsDay, shiftMonth, utcToday } from "@/lib/selfStorageAvailability";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pricingApi } from "@/api/customerRentalApi";
import { useReservation } from "@/contexts/ReservationContext";
import { formatMoney } from "@/lib/booking";
import { matchingRentalTerms, rentalEndDate, termKey, termLabel } from "@/lib/rentalPeriod";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import Steps from "@/components/common/Steps";
import { BackendScreen, Card, CardContent, Button, Details, Link, LoadState, Message, useBackend, rows, record, recordId, validId } from "./RentalBackendUI";

const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (value) => typeof value === "number" && Number.isFinite(value) ? `${formatMoney(value)} VND` : "Not available";

export default function RentalPeriodIntegration() {
  const { rentalDraft } = useReservation();
  return <RentalPeriodForm key={`${recordId(rentalDraft.facility)}:${recordId(rentalDraft.unit)}`} />;
}

function RentalPeriodForm() {
  const { rentalDraft, updateRentalDraft } = useReservation();
  const nav = useNavigate();
  const facilityId = recordId(rentalDraft.facility);
  const unitId = recordId(rentalDraft.unit);
  const unit = rentalDraft.unit;
  const facility = rentalDraft.facility;
  const unitSize = unit?.size;
  const serviceType = "SELF_STORAGE";
  const [start, setStart] = useState(rentalDraft.startDate || "");
  const [selected, setSelected] = useState(rentalDraft.term ? termKey(rentalDraft.term) : Number.isSafeInteger(rentalDraft.months) && rentalDraft.months > 0 ? termKey({ value: rentalDraft.months, unit: "MONTH" }) : "");
  const [visibleMonth, setVisibleMonth] = useState(monthKey(rentalDraft.startDate || utcToday()));
  const scopeValid = validId(facilityId) && validId(unitId) && recordId(unit?.facilityId) === facilityId &&
    !["INACTIVE", "MAINTENANCE"].includes(unit?.status) && ["SMALL", "MEDIUM", "LARGE"].includes(unitSize) &&
    Array.isArray(facility?.serviceTypes) && facility.serviceTypes.includes(serviceType);

  const rules = useBackend(async (config) => {
    if (!scopeValid) return [];
    const all = [];
    let page = 1, totalPages = 1;
    do {
      const response = await pricingApi.list({ facilityId, serviceType, unitSize, isActive: true, page, limit: 100 }, config);
      all.push(...rows(response));
      const pagination = response.data.pagination;
      if (!pagination || !Number.isInteger(pagination.totalPages) || pagination.totalPages < 0) throw Error("Pricing Rules collection mapping failed: pagination is invalid.");
      totalPages = pagination.totalPages;
      page++;
    } while (page <= totalPages);
    return all;
  }, [facilityId, unitId, unitSize, scopeValid]);

  const at = start ? `${start}T00:00:00Z` : null;
  let availableTerms = { terms: [], reason: "" }, mappingError = "";
  if (rules.data) {
    try { availableTerms = matchingRentalTerms(rules.data, { facilityId, unitSize, serviceType, at }); }
    catch (error) { mappingError = error.message; }
  }
  const selectedTerm = availableTerms.terms.find((term) => termKey(term) === selected);
  useEffect(() => {
    if (!rules.loading && !rules.error && (!selectedTerm || mappingError)) setSelected("");
  }, [rules.loading, rules.error, selectedTerm?.value, selectedTerm?.unit, mappingError]);

  const end = rentalEndDate(start, selectedTerm);
  const periodValid = scopeValid && !!selectedTerm && !!end && end > start && start > utcToday() && Date.parse(at) > Date.now() && !mappingError;
  const price = useBackend(async (config) => {
    if (!periodValid) return null;
    let result;
    try {
      result = record(await pricingApi.resolve({ facilityId, serviceType, unitSize, termValue: selectedTerm.value, termUnit: selectedTerm.unit, at }, config));
    } catch (error) {
      if (error.response?.status === 404 && error.response?.data?.message === "No effective rule") throw Error("Backend pricing resolution: No effective rule for the selected move-in date and commitment.");
      throw error;
    }
    const checked = matchingRentalTerms([result], { facilityId, serviceType, unitSize, at });
    if (!checked.terms.some((term) => termKey(term) === selected) || !validId(recordId(result))) throw Error("Resolved Pricing Rule does not match the selected duration or effective date.");
    return result;
  }, [facilityId, unitId, start, selected, periodValid]);
  const estimate = useBackend((config) => periodValid && price.data
    ? reservationApi.estimateReal({ startDate: `${start}T00:00:00.000Z`, endDate: `${end}T00:00:00.000Z`, pricingPolicyId: recordId(price.data) }, config).then(selfStorageEstimate)
    : Promise.resolve(null), [start, end, recordId(price.data), periodValid]);
  const policy = useBackend((config) => periodValid
    ? pricingApi.resolvePolicy({ facilityId, serviceType, type: "DEPOSIT", at }, config).then(record)
    : Promise.resolve(null), [facilityId, unitId, start, periodValid]);

  const monthlyAvailability = useBackend((config) => scopeValid
    ? storageApi.availability(unitId, { month: visibleMonth, signal: config.signal }).then(record)
    : Promise.resolve(null), [facilityId, unitId, visibleMonth, scopeValid]);
  const rangeMonth = monthKey(start);
  const rangeValidation = useBackend((config) => scopeValid && periodValid
    ? storageApi.availability(unitId, { month: rangeMonth, startDate: start, endDate: end, signal: config.signal }).then(record)
    : Promise.resolve(null), [facilityId, unitId, start, end, periodValid]);
  const verifiedMonth = availabilityMatches(monthlyAvailability.data, { unitId, month: visibleMonth }) && monthlyAvailability.data.availabilityState === "VERIFIED";
  const verifiedRange = periodValid && availabilityMatches(rangeValidation.data, { unitId, month: rangeMonth, startDate: start, endDate: end });
  const rangeState = verifiedRange ? rangeValidation.data.rangeAvailability : null;
  const rangeAvailable = rangeState === "AVAILABLE";
  const days = buildAvailabilityDays(visibleMonth, verifiedMonth ? monthlyAvailability.data.intervals : [], utcToday());
  const unavailableUnit = (availabilityMatches(monthlyAvailability.data, { unitId, month: visibleMonth }) && monthlyAvailability.data.availabilityState === "UNIT_UNAVAILABLE") || rangeState === "UNIT_UNAVAILABLE";
  const calendarState = unavailableUnit ? "UNIT_UNAVAILABLE" : monthlyAvailability.error ? "ERROR" : monthlyAvailability.loading ? "LOADING" : verifiedMonth ? "VERIFIED" : "UNKNOWN";

  function selectDate(value) {
    setStart(value);
    setVisibleMonth(monthKey(value));
  }

  function review() {
    if (!rangeAvailable || !price.data || price.loading || price.error || !estimate.data || estimate.loading || estimate.error) return;
    updateRentalDraft({
      startDate: start,
      endDate: end,
      term: selectedTerm,
      months: selectedTerm.unit === "MONTH" ? selectedTerm.value : null,
      quote: { price: price.data, policy: policy.data, estimate: estimate.data },
    });
    nav("/portal/rent/review");
  }

  const calendar = days.map((entry) => {
    if (!entry) return { blank: true, element: null };
    const selectedDay = entry.date === start;
    const inRange = rangeContainsDay(start, end, entry.date);
    const futureStart = Date.parse(`${entry.date}T00:00:00.000Z`) > Date.now();
    const disabled = !futureStart || entry.booked || calendarState !== "VERIFIED";
    const status = !futureStart ? "past or unavailable" : calendarState === "UNIT_UNAVAILABLE" ? "unit unavailable" : calendarState !== "VERIFIED" ? "availability unverified" : entry.booked ? "booked" : inRange ? "selected rental interval" : "available";
    const stateStyle = !futureStart || calendarState === "UNIT_UNAVAILABLE" ? "border-slate-200 bg-slate-100 text-slate-400" : calendarState !== "VERIFIED" ? "border-slate-200 bg-slate-50 text-slate-500" : entry.booked ? "border-red-300 bg-red-100 text-red-900" : selectedDay || inRange ? "border-blue-700 bg-blue-600 text-white" : "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100";
    const labelDate = new Date(`${entry.date}T12:00:00.000Z`).toLocaleDateString("en", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
    return { date: entry.date, element: <button key={entry.date} type="button" disabled={disabled} onClick={() => selectDate(entry.date)} aria-pressed={selectedDay} aria-label={`${labelDate}: ${status}`} title={`${labelDate}: ${status}`} className={`h-11 w-full min-w-0 rounded-lg border text-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed ${stateStyle}`}>
      <span>{entry.day}</span><span className="sr-only">, {status}</span>
    </button> };
  });

  return <BackendScreen title="Choose your rental period" description="Check the selected StorageUnit calendar and verify the full rental range before continuing.">
    <Steps current={2} />
    {!scopeValid && <Link to="/portal/rent">Select an eligible Self Storage unit at an active facility first</Link>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.9fr)]">
      <Card className="min-w-0"><CardContent>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">StorageUnit availability</p><h2 className="mt-1 text-xl font-bold">{new Date(`${visibleMonth}-01T12:00:00.000Z`).toLocaleDateString("en", { timeZone: "UTC", month: "long", year: "numeric" })}</h2></div>
          <div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Previous month" disabled={shiftMonth(visibleMonth, -1) < monthKey(utcToday())} onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}>‹</Button><Button size="icon" variant="outline" aria-label="Next month" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}>›</Button></div>
        </div>
        <p className="mt-2 text-sm" role="status">{calendarState === "LOADING" ? "Đang tải lịch đặt kho..." : calendarState === "ERROR" || calendarState === "UNKNOWN" ? "Không thể xác minh lịch kho. Vui lòng thử lại." : calendarState === "UNIT_UNAVAILABLE" ? "Kho này hiện không khả dụng." : "Lịch đặt kho đã được cập nhật"}</p>
        {(calendarState === "UNKNOWN" || calendarState === "ERROR") && <div className="mt-2 flex flex-wrap items-center gap-3"><Message error="Lịch kho chưa được xác minh. Ngày chưa xác minh không thể chọn." /><Button variant="outline" onClick={monthlyAvailability.retry}>Thử tải lại lịch</Button></div>}
        {unavailableUnit && <Message error="Kho này hiện không khả dụng cho lượt đặt mới." />}
        <div className="mt-5 grid min-w-0 grid-cols-7 gap-1.5 sm:gap-2" role="grid" aria-label={`Availability calendar for ${visibleMonth}`}>
          {weekDays.map((day) => <div key={day} role="columnheader" className="min-w-0 py-2 text-center text-xs font-semibold text-slate-500">{day}</div>)}
          {calendar.map((cell, index) => <div key={cell?.date || `blank-${index}`} role="gridcell" aria-hidden={cell?.blank || undefined} className="flex min-w-0 items-center justify-center">{cell?.element || null}</div>)}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700" aria-label="Calendar legend">
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-emerald-200" />Còn trống</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-red-200" />Đã được đặt</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-slate-300" />Không khả dụng / đã qua</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-blue-600" />Khoảng thuê đang chọn</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded border border-slate-300 bg-slate-50" />Chưa xác minh</span>
        </div>
        <div className="mt-5"><label htmlFor="rental-commitment" className="field-label">Select commitment duration</label><Select value={selectedTerm ? selected : ""} onValueChange={setSelected} disabled={!scopeValid || rules.loading || !!rules.error || !!mappingError || !availableTerms.terms.length}>
          <SelectTrigger id="rental-commitment" aria-label="Select commitment duration"><SelectValue placeholder={rules.loading ? "Loading pricing terms…" : "Choose commitment duration"} /></SelectTrigger>
          <SelectContent>{availableTerms.terms.map((term) => <SelectItem key={termKey(term)} value={termKey(term)}>{termLabel(term)}</SelectItem>)}</SelectContent>
        </Select></div>
        <LoadState resource={rules} /><Message error={mappingError} />
        {periodValid && rangeValidation.error && <div className="mt-3 flex flex-wrap items-center gap-3"><Message error="Không thể xác minh toàn bộ khoảng thuê. Vui lòng thử lại." /><Button variant="outline" onClick={rangeValidation.retry}>Thử kiểm tra lại khoảng thuê</Button></div>}
        {periodValid && <p className="mt-4 text-sm" role="status">{rangeValidation.loading ? "Đang kiểm tra toàn bộ khoảng thuê..." : rangeState === "AVAILABLE" ? "Toàn bộ khoảng thuê đã được xác minh còn trống." : rangeState === "CONFLICT" ? "Khoảng ngày đã chọn trùng với lượt đặt khác. Hãy chọn ngày, thời hạn hoặc kho khác." : rangeState === "UNIT_UNAVAILABLE" ? "Kho này không thể đặt." : rangeState === "UNKNOWN" ? "Không thể xác minh toàn bộ khoảng thuê. Nút tiếp tục đang bị khóa." : "Hãy xác minh toàn bộ khoảng thuê trước khi tiếp tục."}</p>}
      </CardContent></Card>
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <Card><CardContent><h2 className="text-lg font-bold">Selected rental</h2><div className="mt-4"><Details values={[["Facility", facility?.name], ["Unit code", unit?.unitCode], ["Unit size", unitSize], ["Volume", typeof unit?.volumeM3 === "number" ? `${unit.volumeM3} m³` : "Not returned"], ["Move-in", start || "Choose a date"], ["End date", end || "Choose a duration"], ["Commitment", selectedTerm ? termLabel(selectedTerm) : "Choose a duration"], ["Selected interval", rangeAvailable ? "Verified available" : rangeState === "CONFLICT" ? "Conflicts with an existing booking" : "Not verified"]]} /></div></CardContent></Card>
        <Card><CardContent><h2 className="text-lg font-bold">Backend pricing estimate</h2><p className="mt-1 text-xs text-slate-500">Amounts are estimates from the Backend. The final PayOS Payment amount is independently returned by the Backend.</p><LoadState resource={price} /><LoadState resource={estimate} /><LoadState resource={policy} />{estimate.data && <div className="mt-4"><Details values={[["Estimated rent", money(estimate.data.estimatedRent)], ["Deposit estimate", money(estimate.data.depositAmount)], ["Tax estimate", money(estimate.data.taxAmount)], ["Currency", price.data?.currency || "Not returned"], ["Duration", `${estimate.data.durationDays} days`]]} /></div>}</CardContent></Card>
        <Message error={price.error || estimate.error || policy.error} />
        {rangeState === "CONFLICT" && <Link to="/portal/rent" className="block">Choose another StorageUnit</Link>}
        <Button className="w-full" disabled={!rangeAvailable || !verifiedRange || !verifiedMonth || !price.data || price.loading || !!price.error || !estimate.data || estimate.loading || !!estimate.error} onClick={review}>Review Reservation</Button>
      </aside>
    </div>
  </BackendScreen>;
}
