import reservationApi from "@/api/reservationApi";
import storageApi from "@/api/storageApi";
import { selfStorageEstimate } from "@/lib/selfStorageReservation";
import { availabilityMatches, buildAvailabilityDays, monthKey, rangeContainsDay, shiftMonth, utcToday } from "@/lib/selfStorageAvailability";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pricingApi } from "@/api/customerRentalApi";
import { useReservation } from "@/contexts/ReservationContext";
import { reservationDateOnly, reservationAmount } from "@/lib/customerReservationDisplay";
import { matchingRentalTerms, rentalEndDate, termKey } from "@/lib/rentalPeriod";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import Steps from "@/components/common/Steps";
import {CalendarDays,Warehouse,ReceiptText} from "lucide-react";
import { BackendScreen, Card, CardContent, Button, Details, Link, LoadState, Message, useBackend, rows, record, recordId, validId } from "./RentalBackendUI";

const weekDays = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"];
const money = (value,currency) => typeof value === "number" && Number.isFinite(value) && typeof currency === "string" ? reservationAmount(value,currency) : "Chưa xác định đơn vị tiền tệ";
const displayDate = (value) => reservationDateOnly(value) || "Chưa chọn ngày";
const localizedTerm = (term) => {
  if (!term) return "Chưa chọn thời hạn";
  const unit = { DAY: "ngày", MONTH: "tháng", YEAR: "năm" }[term.unit] || term.unit;
  return `${term.value} ${unit}`;
};

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
  const todayStr = utcToday();
  const [start, setStart] = useState(rentalDraft.startDate || todayStr);
  const defaultTermKey = "MONTH:1";
  const [selected, setSelected] = useState(rentalDraft.term ? termKey(rentalDraft.term) : Number.isSafeInteger(rentalDraft.months) && rentalDraft.months > 0 ? termKey({ value: rentalDraft.months, unit: "MONTH" }) : defaultTermKey);
  const [visibleMonth, setVisibleMonth] = useState(monthKey(rentalDraft.startDate || todayStr));
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
      if (!pagination || !Number.isInteger(pagination.totalPages) || pagination.totalPages < 0) throw Error("Chưa thể tải các thời hạn thuê. Vui lòng thử lại.");
      totalPages = pagination.totalPages;
      page++;
    } while (page <= totalPages);
    return all;
  }, [facilityId, unitId, unitSize, scopeValid]);

  const at = start ? `${start}T00:00:00Z` : null;
  let availableTerms = { terms: [], reason: "" }, mappingError = "";
  if (rules.data && rules.data.length > 0) {
    try {
      const matched = matchingRentalTerms(rules.data, { facilityId, unitSize, serviceType, at });
      availableTerms = matched;
      if (!matched.terms || matched.terms.length === 0) {
        mappingError = matched.reason || "Cơ sở này chưa cấu hình bảng giá cho thời hạn thuê của loại kho đã chọn.";
      }
    } catch (err) {
      mappingError = err.message || "Lỗi khi xử lý cấu hình bảng giá.";
    }
  } else if (!rules.loading && !rules.error) {
    availableTerms = { terms: [], reason: "Chưa có quy định giá cho cơ sở này." };
    mappingError = "Chưa có quy định giá cho cơ sở này.";
  }
  const selectedTerm = availableTerms.terms.find((term) => termKey(term) === selected) || availableTerms.terms[0] || null;
  useEffect(() => {
    if (!rules.loading && !rules.error && availableTerms.terms.length > 0) {
      if (!selected || !availableTerms.terms.some((term) => termKey(term) === selected)) {
        setSelected(termKey(availableTerms.terms[0]));
      }
    }
  }, [rules.loading, rules.error, selected, availableTerms.terms]);

  const end = selectedTerm ? rentalEndDate(start, selectedTerm) : "";
  const periodValid = scopeValid && !!selectedTerm && !!end && end > start && start >= utcToday() && !mappingError;
  const price = useBackend(async (config) => {
    if (!periodValid) return null;
    let result;
    try {
      result = record(await pricingApi.resolve({ facilityId, serviceType, unitSize, termValue: selectedTerm.value, termUnit: selectedTerm.unit, at }, config));
    } catch (error) {
      if (error.response?.status === 404 && error.response?.data?.message === "No effective rule") throw Error("Chưa có mức giá áp dụng cho ngày bắt đầu và thời hạn đã chọn. Vui lòng chọn ngày hoặc thời hạn khác.");
      throw error;
    }
    if (!validId(recordId(result))) throw Error("Mức giá chưa khớp hoặc không hợp lệ. Vui lòng tải lại thông tin.");
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
    const today = entry.date === utcToday();
    const inRange = rangeContainsDay(start, end, entry.date);
    const inPast = entry.date < utcToday();
    const status = inPast ? "đã qua" : inRange ? "khoảng thuê chiếm dụng" : entry.booked ? "đã được đặt" : "còn trống";
    const stateStyle = inPast
      ? "border-slate-200 bg-slate-100 text-slate-400"
      : inRange
      ? "border-[#176B45] bg-[#176B45] text-white shadow-sm font-bold"
      : entry.booked
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-slate-200 bg-slate-50 text-slate-600";
    const labelDate = new Date(`${entry.date}T12:00:00.000Z`).toLocaleDateString("vi-VN", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    return {
      date: entry.date,
      element: (
        <div
          key={entry.date}
          aria-label={`${labelDate}: ${today ? "hôm nay, " : ""}${status}`}
          title={`${labelDate}: ${status} (Lịch trực quan - cố định theo kỳ hạn)`}
          className={`h-11 w-full min-w-0 rounded-lg border text-center text-sm font-semibold flex items-center justify-center cursor-default select-none transition-colors ${today ? "ring-2 ring-amber-500 ring-offset-1" : ""} ${stateStyle}`}
        >
          <span>{entry.day}</span>
          <span className="sr-only">, {today ? "hôm nay, " : ""}{status}</span>
        </div>
      ),
    };
  });

  return <BackendScreen title="Chọn thời gian thuê" description="Chọn ngày bắt đầu và thời hạn thuê. Lịch sẽ xác nhận tình trạng kho trước khi bạn tiếp tục." eyebrow="BƯỚC 2 / 4 · THỜI GIAN THUÊ" notice="Ngày thuê và tình trạng kho được kiểm tra theo thông tin hiện có.">
    <Steps current={2} />
    {!scopeValid && <Link to="/portal/rent">Trước tiên, hãy chọn kho Self Storage tại cơ sở đang hoạt động</Link>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.9fr)]">
      <Card className="min-w-0 border-[#d4e2d8] shadow-sm"><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3"><span className="rounded-xl bg-[#e8f4ec] p-2.5 text-[#176B45]"><CalendarDays size={20}/></span><div><p className="text-xs font-bold uppercase tracking-wide text-[#176B45]">Lịch còn trống</p><h2 className="mt-1 text-xl font-bold">{new Date(`${visibleMonth}-01T12:00:00.000Z`).toLocaleDateString("vi-VN", { timeZone: "UTC", month: "long", year: "numeric" })}</h2></div></div>
          <div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Tháng trước" disabled={shiftMonth(visibleMonth, -1) < monthKey(utcToday())} onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}>‹</Button><Button size="icon" variant="outline" aria-label="Tháng sau" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}>›</Button></div>
        </div>
        <p className="mt-2 text-sm" role="status">{calendarState === "LOADING" ? "Đang tải lịch đặt kho..." : calendarState === "ERROR" || calendarState === "UNKNOWN" ? "Không thể xác minh lịch kho. Vui lòng thử lại." : calendarState === "UNIT_UNAVAILABLE" ? "Kho này hiện không khả dụng." : "Lịch đặt kho đã được cập nhật"}</p>
        {(calendarState === "UNKNOWN" || calendarState === "ERROR") && <div className="mt-2 flex flex-wrap items-center gap-3"><Message error="Lịch kho chưa được xác minh. Ngày chưa xác minh không thể chọn." /><Button variant="outline" onClick={monthlyAvailability.retry}>Thử tải lại lịch</Button></div>}
        {unavailableUnit && <Message error="Kho này hiện không khả dụng cho lượt đặt mới." />}
        <div className="mt-4 mb-2 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50/80 to-sky-50/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#176B45]">Khoảng thời gian chiếm kho dự kiến</p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                Kho sẽ được giữ trong <span className="text-[#176B45] font-bold text-lg">{estimate.data?.durationDays || (selectedTerm ? selectedTerm.value * 30 : "—")} ngày</span>
              </p>
              <p className="text-sm text-slate-600">
                Từ hôm nay <strong className="text-slate-800">{displayDate(start)}</strong> đến hết ngày <strong className="text-slate-800">{displayDate(end)}</strong>
              </p>
            </div>
            <span className="inline-flex items-center rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-[#176B45]">
              Lịch cố định từ hôm nay (Chế độ xem)
            </span>
          </div>
        </div>
        <div className="mt-5 grid min-w-0 grid-cols-7 gap-1.5 sm:gap-2" role="grid" aria-label={`Lịch tình trạng kho tháng ${visibleMonth}`}>
          {weekDays.map((day) => <div key={day} role="columnheader" className="min-w-0 py-2 text-center text-xs font-semibold text-slate-500">{day}</div>)}
          {calendar.map((cell, index) => <div key={cell?.date || `blank-${index}`} role="gridcell" aria-hidden={cell?.blank || undefined} className="flex min-w-0 items-center justify-center">{cell?.element || null}</div>)}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700" aria-label="Chú giải lịch">
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-emerald-200" />Còn trống</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-red-200" />Đã được đặt</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-slate-300" />Không khả dụng / đã qua</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded bg-[#176B45]" />Khoảng thuê đang chọn</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded border border-slate-300 bg-slate-50" />Chưa xác minh</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded border-2 border-amber-500" />Hôm nay</span>
        </div>
        <div className="mt-5"><label htmlFor="rental-commitment" className="field-label">Thời hạn thuê</label><Select value={selectedTerm ? selected : ""} onValueChange={setSelected} disabled={!scopeValid || rules.loading || !!rules.error || !!mappingError || !availableTerms.terms.length}>
          <SelectTrigger id="rental-commitment" aria-label="Chọn thời hạn thuê"><SelectValue placeholder={rules.loading ? "Đang tải thời hạn thuê…" : !availableTerms.terms.length ? "Không có thời hạn thuê" : "Chọn thời hạn thuê"} /></SelectTrigger>
          <SelectContent>{availableTerms.terms.map((term) => <SelectItem key={termKey(term)} value={termKey(term)}>{localizedTerm(term)}</SelectItem>)}</SelectContent>
        </Select></div>
        <LoadState resource={rules} /><Message error={mappingError} />
        {periodValid && rangeValidation.error && <div className="mt-3 flex flex-wrap items-center gap-3"><Message error="Không thể xác minh toàn bộ khoảng thuê. Vui lòng thử lại." /><Button variant="outline" onClick={rangeValidation.retry}>Thử kiểm tra lại khoảng thuê</Button></div>}
        {periodValid && <p className="mt-4 text-sm" role="status">{rangeValidation.loading ? "Đang kiểm tra toàn bộ khoảng thuê..." : rangeState === "AVAILABLE" ? "Toàn bộ khoảng thuê đã được xác minh còn trống." : rangeState === "CONFLICT" ? "Khoảng ngày đã chọn trùng với lượt đặt khác. Hãy chọn ngày, thời hạn hoặc kho khác." : rangeState === "UNIT_UNAVAILABLE" ? "Kho này không thể đặt." : rangeState === "UNKNOWN" ? "Không thể xác minh toàn bộ khoảng thuê. Nút tiếp tục đang bị khóa." : "Hãy xác minh toàn bộ khoảng thuê trước khi tiếp tục."}</p>}
      </CardContent></Card>
      <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
        <Card className="border-[#d4e2d8] shadow-sm"><CardContent><div className="flex items-center gap-3"><Warehouse className="text-[#176B45]" size={19}/><h2 className="text-lg font-bold">Tóm tắt kho đã chọn</h2></div><div className="mt-4"><Details values={[["Cơ sở", facility?.name], ["Mã kho", unit?.unitCode], ["Diện tích", unitSize?({SMALL:'Nhỏ',MEDIUM:'Vừa',LARGE:'Lớn'})[unitSize]||unitSize:unitSize], ["Thể tích", typeof unit?.volumeM3 === "number" ? `${unit.volumeM3} m³` : "Chưa có thông tin"], ["Ngày bắt đầu", start ? displayDate(start) : "Chưa chọn ngày"], ["Ngày kết thúc", end ? displayDate(end) : "Chưa chọn thời hạn"], ["Thời hạn thuê", localizedTerm(selectedTerm)], ["Tình trạng khoảng thuê", rangeAvailable ? "Đã xác nhận còn trống" : rangeState === "CONFLICT" ? "Trùng với lượt đặt khác" : "Chưa xác minh"]]} /></div></CardContent></Card>
        <Card className="border-[#c9dfd0] bg-white shadow-md"><CardContent><div className="flex items-center gap-3"><ReceiptText className="text-[#176B45]" size={19}/><h2 className="text-lg font-bold">Chi phí dự kiến</h2></div><p className="mt-1 text-sm text-slate-600">Vui lòng kiểm tra trước khi tiếp tục.</p><LoadState resource={price} /><LoadState resource={estimate} /><LoadState resource={policy} />{estimate.data && <div className="mt-4"><Details values={[["Tổng tiền thanh toán", money(estimate.data.estimatedRent,price.data?.currency)], ["Thời hạn", `${estimate.data.durationDays} ngày`]]} /></div>}</CardContent></Card>
        <Message error={price.error || estimate.error || policy.error} />
        {rangeState === "CONFLICT" && <Link to="/portal/rent" className="block">Chọn kho khác</Link>}
        <Button className="w-full" disabled={!rangeAvailable || !verifiedRange || !verifiedMonth || !price.data || price.loading || !!price.error || !estimate.data || estimate.loading || !!estimate.error || !selectedTerm} onClick={review}>Tiếp tục kiểm tra đơn thuê</Button>
      </aside>
    </div>
  </BackendScreen>;
}
