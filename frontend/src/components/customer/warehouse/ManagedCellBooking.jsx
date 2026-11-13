import { useEffect, useRef, useState } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { getAccessToken, useAuthSession } from '@/lib/authSession';

import managedApi from '@/api/managedReservationApi';

import reservationApi from '@/api/reservationApi';

import warehouseMapApi from '@/api/warehouseMapApi';

import { customerProfileApi } from '@/api/customerRentalApi';
import { termsApi } from '@/api/termsApi';
import { reservationAmount, reservationDateOnly } from '@/lib/customerReservationDisplay';

import { minimumBookingStartDate, bookingStartDateError, readBookingPeriod, selectedPayload, cellBookingReason, cellVolume, volumeText, verifiedCellQuote, matchesCellReservation } from '@/lib/managedCellBooking';

import { validateRackDetail } from '@/lib/warehouseMap';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { Checkbox } from '@/components/ui/checkbox';

import { Dialog } from '@/components/ui/dialog';
import TermsModal from '@/components/customer/terms/TermsModal';

import { useBackend, record, rows, LoadState, Message, Link, ManagedFinancialSummary, rentalError as bookingError } from '../RentalBackendUI';



// Compatibility helpers for this page's Managed V2 booking flow.
// The current customerReservationService.js in this checkout does not export
// these functions. Keep the idempotency key stable until a confirmed success.
const MANAGED_BOOKING_KEY_PREFIX = "vaultspace:managed-v2:create:v1:";
const managedBookingKeyCache = new Map();

function managedDate(value) {
  if (typeof value !== 'string') return 'Chưa xác định';
  const date = value.slice(0, 10);
  return reservationDateOnly(date) || 'Chưa xác định';
}

function managedMoney(value, currency) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Chưa có thông tin';
  return typeof currency === 'string' ? reservationAmount(value, currency) : 'Chưa xác định tiền tệ';
}

function managedTermUnit(value) {
  return ({ DAY: 'ngày', MONTH: 'tháng', YEAR: 'năm' })[value] || 'chưa xác định';
}

function canonicalBookingValue(value) {
  if (Array.isArray(value)) return value.map(canonicalBookingValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalBookingValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function managedBookingFingerprint(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("A validated reservation payload is required.");
  }
  const canonical = JSON.stringify(canonicalBookingValue(payload));
  if (!canonical) throw new Error("A valid reservation payload is required.");
  // Stable 64-bit fingerprint for a storage key (not a security signature).
  // Never store the actual reservation payload in sessionStorage.
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= BigInt(canonical.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${canonical.length}:${hash.toString(16).padStart(16, "0")}`;
}

function managedBookingStorageKey(payload, owner) {
  if (!owner) throw new Error("Booking owner must be verified.");
  return `${MANAGED_BOOKING_KEY_PREFIX}${managedBookingFingerprint({ owner, payload })}`;
}

function newManagedBookingRequestId() {
  const secureCrypto = globalThis.crypto;
  if (typeof secureCrypto?.randomUUID === "function") return secureCrypto.randomUUID();
  if (typeof secureCrypto?.getRandomValues !== "function") {
    throw new Error("Secure browser randomness is required before booking.");
  }
  const data = secureCrypto.getRandomValues(new Uint8Array(16));
  data[6] = (data[6] & 0x0f) | 0x40;
  data[8] = (data[8] & 0x3f) | 0x80;
  const hex = Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function managedBookingIdempotencyKey(payload, owner) {
  const key = managedBookingStorageKey(payload, owner);
  const cached = managedBookingKeyCache.get(key);
  if (cached) return cached;

  let stored = null;
  try { stored = globalThis.sessionStorage.getItem(key); }
  catch { throw new Error("Browser session storage is required for safe reservation retries."); }
  if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
    managedBookingKeyCache.set(key, stored);
    return stored;
  }

  const fresh = newManagedBookingRequestId();
  try { globalThis.sessionStorage.setItem(key, fresh); }
  catch { throw new Error("Unable to retain a safe booking retry key. Check browser storage settings."); }
  managedBookingKeyCache.set(key, fresh);
  return fresh;
}

function clearManagedBookingIdempotencyKey(payload, owner) {
  const key = managedBookingStorageKey(payload, owner);
  managedBookingKeyCache.delete(key);
  try { globalThis.sessionStorage?.removeItem(key); } catch { /* Storage unavailable. */ }
}

function managedCreation(response) {
  // Support common Axios API envelopes without assuming creation succeeded.
  // The existing matchesCellReservation() check MUST still validate the result.
  const body = response?.data ?? response;
  const candidates = [
    body?.reservation,
    body?.data?.reservation,
    body?.data?.data?.reservation,
    body?.result?.reservation,
    body?.data?.result?.reservation,
    body?.data?.data,
    body?.data,
    body,
  ];
  const reservation = candidates.find(value =>
    value && typeof value === "object" &&
    typeof value._id === "string" && /^[a-f\d]{24}$/i.test(value._id)
  );
  if (!reservation) {
    // Fail closed. The caller will mark the POST outcome uncertain rather
    // than blindly retry a potentially successful reservation creation.
    throw new Error("The create response did not contain a verified reservation ID. Check booking records before retrying.");
  }
  return { reservation };
}


// UI basket only, in memory. No reservation/token/payment is persisted here.

let basketOwner = '', basketRows = [], basketAttempt = null;



export function useManagedCellBooking(facilityId) {

  const session = useAuthSession(), [params, setParams] = useSearchParams(), nav = useNavigate();

  const [clock, setClock] = useState(Date.now);

  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(timer); }, []);

  const period = readBookingPeriod(params), rangeKey = JSON.stringify(period.range), scope = `${session.accessToken}:${facilityId}:${rangeKey}`;

  const owner = `${session.accessToken}:${facilityId}`;

  const [selection, setSelection] = useState(() => { if (basketOwner !== owner) { basketOwner = owner; basketRows = []; basketAttempt = null; } return basketRows.map(row => ({ ...row, availabilityKey: '' })); }), [revision, setRevision] = useState(0), [open, setOpen] = useState(false), [quote, setQuote] = useState(null), [confirmed, setConfirmed] = useState(false), [termsAccepted, setTermsAccepted] = useState(false), [termsOpen, setTermsOpen] = useState(false), [pending, setPending] = useState(''), [error, setError] = useState(''), [uncertain, setUncertain] = useState(() => basketAttempt), [checking, setChecking] = useState(false);

  useEffect(() => { basketOwner = owner; basketRows = selection; }, [selection, owner]);

  useEffect(() => { basketAttempt = uncertain; }, [uncertain]);

  const busy = useRef(false), active = useRef(scope), alive = useRef(true); active.current = scope;

  useEffect(() => { alive.current = true; return () => { alive.current = false; if (getAccessToken() !== session.accessToken) { basketOwner = ''; basketRows = []; basketAttempt = null; } }; }, []);

  const profile = useBackend(config => open ? customerProfileApi.get(config).then(record) : Promise.resolve(null), [open]);
  const terms = useBackend(config => termsApi.current('MANAGED_INVENTORY', config).then(record), [], true);

  const racksKey = JSON.stringify([...new Set(selection.map(x => x.rack._id))].sort());

  const validScope = key => alive.current && active.current === key && getAccessToken() === session.accessToken;

  async function freshSelection(entries, range, config = {}) {

    if (!range) throw Error('Choose a valid rental interval.');

    const racks = await Promise.all([...new Set(entries.map(x => x.rack._id))].map(async rackId => validateRackDetail(record(await warehouseMapApi.getRackDetailMap(rackId, config, range)), facilityId, rackId)));

    return entries.map(entry => { const data = racks.find(d => d.rack._id === entry.rack._id), level = data.levels.find(l => l.cells.some(c => c._id === entry.cell._id)), cell = level?.cells.find(c => c._id === entry.cell._id); return cell ? { cell, level: { levelNumber: level.levelNumber }, rack: data.rack, availabilityKey: JSON.stringify(range), reason: cellBookingReason(cell, data.rack, range) } : { ...entry, availabilityKey: '', reason: 'Cell is no longer returned by this Rack. Remove it and refresh.' }; });

  }

  useEffect(() => {

    setQuote(null); setConfirmed(false);

    if (!selection.length || !period.range) { setChecking(false); return; }

    const abort = new AbortController(), key = scope; setChecking(true);

    freshSelection(selection, period.range, { signal: abort.signal }).then(fresh => { if (!abort.signal.aborted && validScope(key)) setSelection(current => current.map(x => fresh.find(f => f.cell._id === x.cell._id) || x)); }).catch(e => { if (!abort.signal.aborted && validScope(key)) { setError(bookingError(e)); setSelection(current => current.map(x => ({ ...x, availabilityKey: '', reason: 'Availability could not be refreshed.' }))); } }).finally(() => { if (!abort.signal.aborted && validScope(key)) setChecking(false); });

    return () => abort.abort();

  }, [rangeKey, revision, racksKey]);

  const selectionKey = JSON.stringify(selection.map(x => [x.cell._id, x.availabilityKey, x.reason, x.cell.dimensions]));

  const requestKey = `${scope}:${selectionKey}`; const requestRef = useRef(requestKey); requestRef.current = requestKey;

  useEffect(() => { setQuote(null); setConfirmed(false); setTermsAccepted(false); }, [requestKey, terms.data?.versionId]);

  let payload = null; try { if (!checking && selection.every(x => x.availabilityKey === rangeKey && !x.reason)) payload = selectedPayload(facilityId, selection, period.range, period.term); } catch {/* Invalid selection stays readable but cannot be bought. */ }

  const review = quote?.key === requestKey ? quote.data : null;

  function changePeriod(key, value) { if (busy.current || uncertain) return; const next = new URLSearchParams(params); next.set(key, String(value)); next.delete('startDate'); next.delete('endDate'); setSelection(current => current.map(row => ({ ...row, availabilityKey: '' }))); setParams(next, { replace: true }); setQuote(null); setConfirmed(false); setError(''); }

  function toggle(cell, level, rack) { if (busy.current || uncertain) return; setQuote(null); setConfirmed(false); setError(''); setSelection(current => { if (current.some(x => x.cell._id === cell._id)) return current.filter(x => x.cell._id !== cell._id); if (current.length >= 100) { setError('At most 100 Cells can be selected.'); return current; } const reason = rack?.facilityId !== facilityId ? 'Cell belongs to a different Facility.' : cellBookingReason(cell, rack, period.range); if (reason) { setError(reason); return current; } return [...current, { cell, level: { levelNumber: level.levelNumber }, rack, availabilityKey: rangeKey, reason: '' }]; }); }

  function clear() { if (busy.current || uncertain) return; setSelection([]); setQuote(null); setConfirmed(false); setError(''); }

  async function resolveQuote() {
    if (busy.current || !payload || uncertain) return; busy.current = true; setPending('quote'); setError(''); setQuote(null); setConfirmed(false); const key = scope, rkey = requestKey;

    try { const current = selectedPayload(facilityId, selection, period.range, period.term); const data = verifiedCellQuote(record(await managedApi.quote(current)), current, period.range); if (validScope(key) && requestRef.current === rkey) setQuote({ key: rkey, data }); }

    catch (e) { if (validScope(key)) setError(bookingError(e)); } finally { busy.current = false; if (validScope(key)) setPending(''); }
  }

  async function reconcile(attempt) {
    if (busy.current) return; busy.current = true; setPending('reconcile'); setError(''); const key = scope;

    try {
      const owned = rows(await reservationApi.mineReal()); if (!validScope(key)) return; const found = owned.filter(r => !attempt.known.includes(r._id) && matchesCellReservation(r, attempt.payload, attempt.range));

      if (found.length === 1) { basketRows = []; basketAttempt = null; setUncertain(null); setSelection([]); clearMapAvailability(); nav(`/portal/payments/${found[0]._id}`, { state: { startFullRentAfterBooking: true } }); return; }

      if (found.length > 1) throw Error('Multiple matching records were returned. Check My Storage before making another reservation.');

      setUncertain(null); setQuote(null); setConfirmed(false); setRevision(v => v + 1); setError('No new matching reservation was returned by your account. Availability must refresh and you must obtain a new quote before an explicit manual retry. No request was repeated.');

    } catch (e) { if (validScope(key)) setError(`${bookingError(e)} Booking remains uncertain; automatic retry is disabled.`); } finally { busy.current = false; if (validScope(key)) setPending(''); }
  }

  async function create() {
    if (busy.current || !payload || !review || !confirmed || !termsAccepted || !terms.data?.versionId || profile.data?.verificationStatus !== 'VERIFIED' || uncertain) return; busy.current = true; setPending('create'); setError(''); const key = scope, rkey = requestKey; let sent = false, attempt;

    try {

      const eligibility = record(await customerProfileApi.get()); if (!validScope(key)) return; if (eligibility.verificationStatus !== 'VERIFIED') throw Error('A VERIFIED Customer Profile is required.');

      const fresh = await freshSelection(selection, period.range); if (!validScope(key) || requestRef.current !== rkey) return;

      const latest = selectedPayload(facilityId, fresh, period.range, period.term); if (Math.abs(latest.allocatedCapacityM3 - payload.allocatedCapacityM3) > 1e-6 || fresh.some(x => x.reason)) { setSelection(fresh); setQuote(null); setConfirmed(false); throw Error('Cell dimensions or availability changed. Review the refreshed selection and request a new quote.'); }

      const updated = verifiedCellQuote(record(await managedApi.quote(latest)), latest, period.range); if (!validScope(key) || requestRef.current !== rkey) return;

      if (JSON.stringify(updated) !== JSON.stringify(review)) { setQuote({ key: rkey, data: updated }); setConfirmed(false); setError('The quote changed. Review the updated charges and confirm again.'); return; }

      const latestTerms = record(await termsApi.current('MANAGED_INVENTORY'));
      if (!validScope(key) || requestRef.current !== rkey) return;
      if (!termsAccepted || latestTerms?.versionId !== terms.data?.versionId) {
        setTermsAccepted(false); terms.retry();
        throw Error('Điều khoản đã thay đổi hoặc chưa được xác nhận. Vui lòng xem và tích lại phiên bản hiện hành trước khi đặt thuê.');
      }

      const owned = rows(await reservationApi.mineReal()); if (!validScope(key) || requestRef.current !== rkey) return;

      selectedPayload(facilityId, fresh, period.range, period.term);

      attempt = { payload: latest, range: period.range, known: owned.map(r => r._id) };

      const idempotencyKey = managedBookingIdempotencyKey(latest, owner);
      sent = true;

      const result = managedCreation(await managedApi.create({ ...latest, termsAccepted, termsVersionId: latestTerms.versionId }, { headers: { 'Idempotency-Key': idempotencyKey } })); if (!validScope(key)) return;

      if (!matchesCellReservation(result.reservation, latest, period.range)) throw Error('The returned reservation did not match the selected Cells and period.');

      clearManagedBookingIdempotencyKey(latest, owner);

      basketRows = []; basketAttempt = null; setSelection([]); clearMapAvailability(); nav(`/portal/payments/${result.reservation._id}`, { state: { startFullRentAfterBooking: true } });

    } catch (e) {
      if (!validScope(key)) return; setConfirmed(false); setQuote(null); const status = e.response?.status;

      if (sent && (!status || status >= 500)) { setUncertain(attempt); setError('The creation result is uncertain. Check your own reservation records before any manual retry. No automatic POST will be sent.'); }

      else { setError(bookingError(e)); setRevision(v => v + 1); clearMapAvailability(); }

    } finally { busy.current = false; if (validScope(key)) setPending(''); }
  }

  return { period, minimumStart: minimumBookingStartDate(clock), startError: bookingStartDateError(period.start, clock), rangeKey, selection, payload, profile, terms, termsAccepted, setTermsAccepted, termsOpen, setTermsOpen, open, setOpen, review, confirmed, setConfirmed, pending, error, uncertain, checking, changePeriod, toggle, clear, resolveQuote, create, reconcile, refresh: () => setRevision(v => v + 1), locked: !!pending || !!uncertain };

}



export const clearMapAvailability = () => window.dispatchEvent(new Event('vaultspace:map-refresh'));

/** Date inputs remain bound to the same URL-search-param booking controller.
 * End date is a derived, read-only value: the API books by start + term.
 */
export function BookingPeriodFields({ booking: b }) {
  const interval = b.period.range;
  const endDate = interval?.endDate ? managedDate(interval.endDate) : "";

  return (
    <div className="wm-v5-period" aria-label="Thiết lập kỳ thuê">
      <label className="wm-v5-period-field">
        <span>Ngày bắt đầu <small>(giờ Việt Nam)</small></span>
        <Input
          aria-label="Ngày bắt đầu thuê (giờ Việt Nam)"
          type="date"
          min={b.minimumStart}
          value={b.period.start || ""}
          disabled={b.locked}
          aria-invalid={Boolean(b.period.start && b.startError)}
          onChange={(event) => b.changePeriod("start", event.target.value)}
        />
      </label>
      <label className="wm-v5-period-field wm-v5-term-value">
        <span>Thời hạn</span>
        <Input
          aria-label="Số lượng thời hạn thuê"
          type="number"
          min="1"
          step="1"
          value={b.period.term.value || ""}
          disabled={b.locked}
          onChange={(event) => b.changePeriod("termValue", event.target.value)}
        />
      </label>
      <label className="wm-v5-period-field wm-v5-term-unit">
        <span>Đơn vị</span>
        <select
          className="customer-select"
          aria-label="Đơn vị thời hạn thuê"
          value={b.period.term.unit}
          disabled={b.locked}
          onChange={(event) => b.changePeriod("termUnit", event.target.value)}
        >
          <option value="DAY">Ngày</option>
          <option value="MONTH">Tháng</option>
          <option value="YEAR">Năm</option>
        </select>
      </label>
      <div className="wm-v5-period-field wm-v5-period-end" aria-live="polite">
        <span>Ngày kết thúc <small>(tự tính)</small></span>
        <output aria-label="Ngày kết thúc kỳ thuê">
          {endDate || "Chưa xác định"}
        </output>
      </div>
      <div className="wm-v5-period-note" aria-live="polite">
        {b.period.start && b.startError ? (
          <span role="alert" className="wm-v5-period-error">{b.startError}</span>
        ) : (
          <span>
            {interval
              ? "Đã thiết lập kỳ thuê. Hãy chọn các ô trống trên sơ đồ."
              : "Ngày bắt đầu phải ở tương lai. Kỳ thuê tính từ 00:00 UTC (07:00 giờ Việt Nam)."}
          </span>
        )}
      </div>
    </div>
  );
}

function SelectedList({ selection }) {
  if (!selection.length) {
    return <p className="wm-v5-empty-basket">Chưa chọn ô lưu trữ.</p>;
  }
  return (
    <ul className="wm-booking-list">
      {selection.map((entry) => (
        <li key={entry.cell._id}>
          <strong>{entry.cell.code || entry.cell._id}</strong>
          <span>
            {entry.rack.rackCode || entry.rack._id} · {entry.rack.zoneCode || entry.rack.zoneId || "Không có khu vực"} · Tầng {entry.level.levelNumber}
          </span>
          <span>
            {entry.cell.dimensions?.widthM} × {entry.cell.dimensions?.depthM} × {entry.cell.dimensions?.usableHeightM ?? "?"} m
            {" · "}
            {(() => {
              try { return volumeText(cellVolume(entry.cell)); }
              catch { return "Chưa đủ dữ liệu thể tích"; }
            })()}
          </span>
          {entry.reason && <span className="text-orange-600">{entry.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

function BookingReview({ booking: b, facilityId, facilityName }) {
  if (!b.open) return null;
  const close = () => { b.setOpen(false); b.setConfirmed(false); };
  return (
    <Dialog
      title="Kiểm tra & xác nhận thuê ô"
      description="Xem lại ô đã chọn và báo giá. Ô chỉ được giữ khi backend tạo đơn đặt thuê thành công."
      busy={Boolean(b.pending)}
      onClose={close}
    >
      <div className="wm-v5-review-content">
        <p><strong>{facilityName || facilityId}</strong> · {b.period.term.value} {managedTermUnit(b.period.term.unit)}</p>
        <p className="text-sm">{managedDate(b.period.range?.startDate)} → {managedDate(b.period.range?.endDate)}</p>
        <SelectedList selection={b.selection} />
        <p>Tổng thể tích: {b.payload ? volumeText(b.payload.allocatedCapacityM3) : "Đang kiểm tra tính hợp lệ"}</p>
        <LoadState resource={b.profile} />
        {b.profile.data?.verificationStatus !== "VERIFIED" && (
          <p className="text-sm text-orange-700">Cần xác minh hồ sơ khách hàng trước khi tạo đơn thuê.</p>
        )}
        <Button disabled={!b.payload || b.locked} onClick={b.resolveQuote}>
          {b.pending === "quote" ? "Đang lấy báo giá…" : "Lấy báo giá"}
        </Button>
        {b.review && (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["Đơn giá / m³", b.review.pricing.ratePerM3],
                ["Tiền thuê dự kiến", b.review.pricing.estimatedRent],
                ["Thanh toán 100% tiền thuê", b.review.payment.amount],
                ["Thuế", b.review.taxAmount],
                ["Tiền tệ", b.review.pricing.currency],
                ["Quy tắc giá", b.review.pricing.ruleId],
                ["Phiên bản giá", b.review.pricing.version],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 break-words">
                  <dt>{label}</dt><dd className="font-semibold">{label === 'Tiền tệ'
                    ? value === 'VND' ? 'Đồng Việt Nam (VND)' : value ?? 'Chưa có dữ liệu'
                    : ['Đơn giá / m³', 'Tiền thuê dự kiến', 'Thanh toán 100% tiền thuê', 'Thuế'].includes(label)
                      ? managedMoney(value, b.review.pricing.currency)
                      : value ?? "Chưa có dữ liệu"}</dd>
                </div>
              ))}
            </dl>
            {b.review.bookingFlowVersion === 2 && <ManagedFinancialSummary quote={b.review} localizeCurrency />}
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                aria-label="Xác nhận đã xem kỳ thuê, các ô và chi phí"
                checked={b.confirmed}
                disabled={b.locked}
                onCheckedChange={(value) => b.setConfirmed(value === true)}
              />
              <span>Tôi đã kiểm tra các ô đã chọn, thời gian thuê và các khoản phí dự kiến.</span>
            </label>
            {b.terms.data && <div className="space-y-2 text-sm"><label className="flex cursor-pointer items-start gap-3"><Checkbox aria-label={`Chấp nhận điều khoản phiên bản ${b.terms.data.version}`} checked={b.termsAccepted} disabled={b.locked} onCheckedChange={value => b.setTermsAccepted(value === true)} /><span>Tôi đã đọc và đồng ý với Điều khoản &amp; Chính sách phiên bản {b.terms.data.version}.</span></label><button type="button" className="ml-8 font-medium text-emerald-800 underline underline-offset-2" onClick={() => b.setTermsOpen(true)}>Xem điều khoản &amp; chính sách</button></div>}
          </>
        )}
        <Message error={b.error} />
        <div className="wm-v5-review-actions">
          <Button variant="outline" disabled={Boolean(b.pending)} onClick={close}>Quay lại chọn ô</Button>
          <Button
            variant="orange"
            disabled={!b.payload || !b.review || !b.confirmed || !b.termsAccepted || !b.terms.data?.versionId || b.profile.data?.verificationStatus !== "VERIFIED" || b.locked}
            onClick={b.create}
          >
            {b.pending === "create" ? "Đang tạo đơn…" : "Xác nhận đặt thuê"}
          </Button>
        </div>
        {b.uncertain && (
          <Button disabled={Boolean(b.pending)} onClick={() => b.reconcile(b.uncertain)}>
            Kiểm tra kết quả đặt thuê
          </Button>
        )}
      </div>
      <TermsModal open={b.termsOpen} onClose={() => b.setTermsOpen(false)} serviceType="MANAGED_INVENTORY" initialTerms={b.terms.data} />
    </Dialog>
  );
}

/** A compact persistent cart dock for the Warehouse Map.
 * Standalone mode remains supported for other existing callers.
 */
export function CellBookingPanel({ booking: b, facilityId, facilityName, compact = false }) {
  const count = b.selection.length;
  const availableForCheckout = count > 0 && Boolean(b.payload) && !b.locked && !b.checking;
  return (
    <section className={`wm-booking-panel ${compact ? "wm-booking-panel--dock" : ""}`} aria-label="Giỏ thuê ô lưu trữ">
      {!compact && (
        <>
          <h2 className="text-lg font-bold">Chọn ô lưu trữ để thuê</h2>
          <p className="mt-2 text-sm">{facilityName || facilityId} · Giá và tình trạng ô sẽ được xác minh trước khi đặt thuê.</p>
          <BookingPeriodFields booking={b} />
          <h3 className="mt-4 font-bold">Ô đã chọn ({count})</h3>
          <SelectedList selection={b.selection} />
        </>
      )}
      <div className="wm-v5-basket-bar">
        <div className="wm-v5-basket-info">
          <strong>Giỏ thuê: {count} ô</strong>
          <span>
            {!b.period.range
              ? "Chọn ngày và thời hạn ở thanh trên"
              : count === 0
                ? "Chọn ô còn trống từ sơ đồ kho"
                : b.checking
                  ? "Đang cập nhật khả dụng…"
                  : b.payload
                    ? `Tổng thể tích: ${volumeText(b.payload.allocatedCapacityM3)}`
                    : "Có ô cần kiểm tra lại khả dụng"}
          </span>
        </div>
        <div className="wm-v5-basket-actions">
          {count > 0 && <Button variant="outline" disabled={b.locked} onClick={b.clear}>Bỏ chọn tất cả</Button>}
          <Button
            variant="orange"
            disabled={!availableForCheckout}
            onClick={() => b.setOpen(true)}
          >
            Xem báo giá & đặt thuê
          </Button>
        </div>
      </div>
      {count > 0 && compact && (
        <details className="wm-v5-basket-details">
          <summary>Xem {count} ô đã chọn</summary>
          <SelectedList selection={b.selection} />
        </details>
      )}
      <Message error={b.error} />
      {b.uncertain && (
        <div className="wm-v5-uncertain-actions">
          <Button disabled={Boolean(b.pending)} onClick={() => b.reconcile(b.uncertain)}>
            Kiểm tra kết quả đặt thuê
          </Button>
          <Button asChild variant="outline"><Link to="/portal">Xem kho của tôi</Link></Button>
        </div>
      )}
      <BookingReview booking={b} facilityId={facilityId} facilityName={facilityName} />
    </section>
  );
}
