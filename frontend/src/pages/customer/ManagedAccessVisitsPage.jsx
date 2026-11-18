import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import reservationApi from '@/api/reservationApi';
import { managedAccessApi } from '@/api/managedAccessApi';

const stockOperations = [['INBOUND', 'Nhập kho'], ['OUTBOUND', 'Xuất kho'], ['RELOCATION', 'Chuyển vị trí']];
const VISITS_PER_PAGE = 5;
const sessionLabel = status => ({ ACTIVE: 'Đang hoạt động', EXPIRED: 'Đã hết hạn', CHECKED_OUT: 'Đã kết thúc', REVOKED: 'Đã thu hồi' })[status] || 'Không xác định';
const visitStatusLabel = status => ({ SCHEDULED: 'Chờ đến kho', CHECKED_IN: 'Đang ở kho', COMPLETED: 'Đã hoàn tất lượt đến', CANCELLED: 'Đã hủy', MISSED: 'Quá hạn · chưa check-in' })[status] || 'Cần đối soát trạng thái';
const visitDisplayStatus = (visit, now) => visit.status === 'SCHEDULED' && Date.parse(visit.endsAt) <= now ? 'MISSED' : visit.status;
const reservationId = row => row?._id || row?.id;
const messageOf = error => error?.response?.data?.message || error?.message || 'Không tải được dữ liệu. Vui lòng thử lại.';
const todayVN = () => new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
const addVNCalendarDays = (date, days) => { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const maxVisitDateVN = () => addVNCalendarDays(todayVN(), 30);
const vnDate = value => Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 7 * 60 * 60_000).toISOString().slice(0, 10) : '';
const vnClock = value => { const date = new Date(Date.parse(value) + 7 * 60 * 60_000); return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`; };
const slotKey = slot => `${slot.facilityId || ''}|${slot.startsAt}`;
const slotLabel = slot => `${vnClock(slot.startsAt)} – ${vnClock(slot.endsAt)}${slot.facilityName ? ` · ${slot.facilityName}` : ''}`;
const toIso = (date, clock) => new Date(`${date}T${clock}:00+07:00`).toISOString();
const displayDateTime = value => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

function Countdown({ expiresAt }) {
  const [left, setLeft] = useState(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  useEffect(() => { const timer = setInterval(() => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now())), 1000); return () => clearInterval(timer); }, [expiresAt]);
  return <strong>{left ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : 'Đã hết hạn'}</strong>;
}

export default function ManagedAccessVisitsPage() {
  const [visits, setVisits] = useState([]), [sessions, setSessions] = useState([]), [reservations, setReservations] = useState([]);
  const [visitPage, setVisitPage] = useState(1);
  const [date, setDate] = useState(todayVN), [selectedSlot, setSelectedSlot] = useState(''), [slots, setSlots] = useState([]), [hasEligibleScope, setHasEligibleScope] = useState(true), [availabilityBusy, setAvailabilityBusy] = useState(false), [availabilityError, setAvailabilityError] = useState('');
  const [note, setNote] = useState(''), [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pendingCreate, setPendingCreate] = useState(null), [pendingAmend, setPendingAmend] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const pendingCreateRef = useRef(null);
  const newestVisits = useMemo(() => [...visits].sort((left, right) => {
    const leftAt = Date.parse(left.createdAt || left.updatedAt || left.startsAt || '');
    const rightAt = Date.parse(right.createdAt || right.updatedAt || right.startsAt || '');
    return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
  }), [visits]);
  const visitPageCount = Math.max(1, Math.ceil(newestVisits.length / VISITS_PER_PAGE));
  const currentVisitPage = Math.min(visitPage, visitPageCount);
  const visibleVisits = newestVisits.slice((currentVisitPage - 1) * VISITS_PER_PAGE, currentVisitPage * VISITS_PER_PAGE);
  const editingExpired = !!editing && Date.parse(editing.endsAt) <= clock;

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [visitResponse, sessionResponse, reservationResponse] = await Promise.all([managedAccessApi.myVisits(), managedAccessApi.mySessions(), reservationApi.mineReal()]);
      const owned = reservationResponse.data?.data;
      if (!Array.isArray(owned)) throw Error('Dữ liệu Reservation không đúng định dạng.');
      const eligible = owned.filter(row => row.serviceType === 'MANAGED_INVENTORY' && row.bookingFlowVersion === 3 && ['CHECKIN_READY', 'ACTIVE'].includes(row.status));
      const visitRows = Array.isArray(visitResponse.data?.data) ? visitResponse.data.data : [];
      setVisits(visitRows); setSessions(Array.isArray(sessionResponse.data?.data) ? sessionResponse.data.data : []); setReservations(eligible);
      const unresolvedAmend = visitRows.map(visit => ({ visit, pending: managedAccessApi.pendingAmend(visit._id) })).find(entry => entry.pending?.payload);
      if (unresolvedAmend) { const { visit, pending } = unresolvedAmend; setPendingAmend({ visitId: visit._id, payload: pending.payload, revision: pending.expectedRevision, key: pending.key }); setEditing(visit); setDate(vnDate(pending.payload.startsAt) || vnDate(visit.startsAt)); setSelectedSlot(`${visit.facilityId || ''}|${pending.payload.startsAt || visit.startsAt}`); setNote(pending.payload.note || ''); }
    } catch (cause) { setError(messageOf(cause)); }
  }, []);
  useEffect(() => { const pending = managedAccessApi.pendingCreate(); if (pending?.payload) { pendingCreateRef.current = pending.payload; setPendingCreate(pending.payload); setDate(vnDate(pending.payload.startsAt) || todayVN()); setSelectedSlot(`${pending.payload.facilityId || ''}|${pending.payload.startsAt || ''}`); setNote(pending.payload.note || ''); } void refresh(); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    if (!date) { setSlots([]); setSelectedSlot(''); setHasEligibleScope(false); setAvailabilityError(''); return; }
    const controller = new AbortController(); let active = true;
    setSlots([]); setSelectedSlot(current => editing && vnDate(editing.startsAt) === date ? `${editing.facilityId || ''}|${editing.startsAt}` : current); setAvailabilityError(''); setAvailabilityBusy(true);
    managedAccessApi.visitAvailability(date, { facilityId: editing?.facilityId, signal: controller.signal }).then(response => {
      const data = response.data?.data;
      if (response.data?.success !== true || data?.timeZone !== 'Asia/Ho_Chi_Minh' || !Array.isArray(data.slots) || data.slots.some(slot => !slot || !Number.isFinite(Date.parse(slot.startsAt)) || !Number.isFinite(Date.parse(slot.endsAt)))) throw Error('Danh sách khung giờ không hợp lệ.');
      if (active) { setSlots(data.slots); setHasEligibleScope(data.reservationScopeAvailable !== false); setAvailabilityError(''); }
    }).catch(cause => { if (active && !controller.signal.aborted) setAvailabilityError(messageOf(cause)); })
      .finally(() => { if (active) setAvailabilityBusy(false); });
    return () => { active = false; controller.abort(); };
  }, [date, editing?.startsAt, editing?.facilityId]);

  const effectiveSlots = useMemo(() => {
    const current = editing && selectedSlot === slotKey({ facilityId: editing.facilityId, startsAt: editing.startsAt }) ? { startsAt: editing.startsAt, endsAt: editing.endsAt, facilityId: editing.facilityId } : null;
    const available = slots.filter(slot => Date.parse(slot.startsAt) > clock);
    if (current && !available.some(slot => slotKey(slot) === slotKey(current))) available.unshift(current);
    return available;
  }, [slots, clock, editing, selectedSlot]);

  const create = async event => {
    event.preventDefault(); if (editingExpired || pendingCreateRef.current || pendingAmend || busy || !selectedSlot) return;
    setBusy(true); setError(''); setNotice('');
    const chosen = effectiveSlots.find(slot => slotKey(slot) === selectedSlot);
    if (!chosen) { setError('Khung giờ đã qua hoặc không còn khả dụng. Hãy chọn lại khung giờ.'); setBusy(false); return; }
    const payload = { startsAt: chosen.startsAt, endsAt: chosen.endsAt, ...(note.trim() ? { note: note.trim() } : {}) };
    try {
      if (editing) { await managedAccessApi.amendVisit(editing._id, payload, editing.revision); setPendingAmend(null); setNotice('Đã cập nhật lịch. Manager cần phân công lại Staff hộ tống.'); }
      else {
        const request = { facilityId: chosen.facilityId, ...payload }; pendingCreateRef.current = request; setPendingCreate(request);
        const key = managedAccessApi.pendingCreateKey(); const latest = await managedAccessApi.myVisits(); const prior = (latest.data?.data || []).find(row => row.idempotencyKey === key);
        if (prior) { managedAccessApi.clearPendingCreateKey(); pendingCreateRef.current = null; setPendingCreate(null); setNotice('Lịch đã được tạo trước đó. Đã tải lại trạng thái đã lưu.'); await refresh(); return; }
        await managedAccessApi.createVisit(request); pendingCreateRef.current = null; setPendingCreate(null); setNotice('Đã gửi lịch đến kho. Session chỉ được kích hoạt sau khi Staff xác minh bạn tại Facility.');
      }
      setEditing(null); setNote(''); setSelectedSlot(''); if (!editing) setVisitPage(1); await refresh();
    } catch (cause) {
      setError(messageOf(cause));
      if (editing) {
        const saved = managedAccessApi.pendingAmend(editing._id);
        if (saved?.payload) setPendingAmend({ visitId: editing._id, payload: saved.payload, revision: saved.expectedRevision, key: saved.key });
        if (cause?.response?.status === 412) setError('Lịch đã thay đổi sau khi bạn mở biểu mẫu. Không gửi lại bằng revision mới; hãy đối soát nội dung lịch hiện tại trước.');
        else if (cause?.response?.status === 409) setError('Lịch không còn ở trạng thái có thể sửa hoặc khung giờ đã bị chiếm. Yêu cầu sửa cũ được giữ để đối soát; hãy tải lại lịch.');
      } else if (cause?.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') { const saved = managedAccessApi.pendingCreate(); if (saved?.payload) { pendingCreateRef.current = saved.payload; setPendingCreate(saved.payload); setDate(vnDate(saved.payload.startsAt) || todayVN()); setSelectedSlot(`${saved.payload.facilityId || ''}|${saved.payload.startsAt || ''}`); setNote(saved.payload.note || ''); } }
      else if (!cause?.response?.status || cause.response.status >= 500) { pendingCreateRef.current = managedAccessApi.pendingCreate()?.payload || { facilityId: chosen.facilityId, ...payload }; setPendingCreate(pendingCreateRef.current); }
      else { managedAccessApi.clearPendingCreateKey(); pendingCreateRef.current = null; setPendingCreate(null); }
    } finally { setBusy(false); }
  };
  const retryCreate = async () => {
    const request = pendingCreateRef.current; if (!request || busy) return; setBusy(true); setError('');
    try { const latest = await managedAccessApi.myVisits(); const prior = (latest.data?.data || []).find(row => row.idempotencyKey === managedAccessApi.pendingCreateKey()); if (prior) { managedAccessApi.clearPendingCreateKey(); pendingCreateRef.current = null; setPendingCreate(null); setVisitPage(1); setNotice('Lịch đã được tạo trước đó. Đã tải lại trạng thái đã lưu.'); await refresh(); return; } await managedAccessApi.createVisit(request); pendingCreateRef.current = null; setPendingCreate(null); setVisitPage(1); setNotice('Đã xác nhận tạo lịch sau khi đối chiếu trạng thái.'); await refresh(); }
    catch (cause) { setError(messageOf(cause)); await refresh(); } finally { setBusy(false); }
  };
  const retryAmend = async () => {
    if (!pendingAmend || busy) return; setBusy(true); setError('');
    try {
      if (!Number.isSafeInteger(pendingAmend.revision)) throw Error('Yêu cầu sửa lịch cũ không lưu revision gốc; không thể retry an toàn. Hãy liên hệ hỗ trợ để đối soát.');
      const latest = await managedAccessApi.myVisits();
      const current = (latest.data?.data || []).find(row => String(row._id) === String(pendingAmend.visitId));
      if (!current) throw Error('Không tìm thấy lịch để đối soát yêu cầu sửa. Không tạo yêu cầu mới.');
      const key = pendingAmend.key || managedAccessApi.pendingAmendKey(pendingAmend.visitId);
      const committed = (current.audit || []).find(entry => entry.action === 'VISIT_AMENDED' && entry.details?.idempotencyKey === key);
      if (committed) {
        const payload = pendingAmend.payload;
        const matches = Date.parse(current.startsAt) === Date.parse(payload.startsAt) && Date.parse(current.endsAt) === Date.parse(payload.endsAt) && (payload.note === undefined || current.note === payload.note);
        if (!matches) throw Error('Backend đã ghi nhận khóa sửa lịch nhưng dữ liệu hiện tại không khớp payload đã lưu. Cần hỗ trợ đối soát; không retry.');
        managedAccessApi.clearPendingAmend(pendingAmend.visitId); setPendingAmend(null); setEditing(null); setNotice('Đã xác minh yêu cầu sửa lịch đã được lưu.'); await refresh(); return;
      }
      if (Number(current.revision) !== pendingAmend.revision) throw Error('Revision lịch đã thay đổi nhưng chưa tìm thấy bằng chứng commit cho yêu cầu này. Không retry tự động; cần đối soát.');
      await managedAccessApi.amendVisit(pendingAmend.visitId, pendingAmend.payload, pendingAmend.revision); setPendingAmend(null); setEditing(null); setSelectedSlot(''); setNotice('Đã đối chiếu và lưu kết quả sửa lịch. Manager cần phân công lại Staff hộ tống nếu khung giờ đã đổi.'); await refresh();
    }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const cancel = async visit => { setBusy(true); setError(''); try { await managedAccessApi.cancelVisit(visit._id, visit.revision); await refresh(); } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); } };
  const minDate = todayVN();
  const maxDate = maxVisitDateVN();
  const isToday = date === todayVN();

  return <section className="mx-auto max-w-5xl space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-emerald-800">Kho Lưu Trữ</p><h1 className="mt-2 text-3xl font-bold text-slate-900">Lịch đến kho & quyền truy cập</h1></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error} <button className="ml-2 font-semibold underline" onClick={() => void refresh()}>Thử tải lại</button></div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}
    <div className="grid gap-5 lg:grid-cols-[1fr_1.25fr]">
      <form onSubmit={create} className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">{editing ? 'Sửa lịch đến Facility' : 'Đặt lịch đến Facility'}</h2>
        {editingExpired && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Lịch đã quá giờ mà chưa check-in. Không thể chỉnh sửa; vui lòng đóng chế độ sửa và đặt lịch mới.</p>}
        {pendingCreate && <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Kết quả gửi lịch chưa xác định. Yêu cầu và Idempotency-Key đã được giữ lại. Hãy đối chiếu trước khi thử lại.<button type="button" onClick={() => void retryCreate()} disabled={busy} className="ml-2 font-semibold underline">Kiểm tra kết quả / thử lại cùng yêu cầu</button></div>}
        {pendingAmend && <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Yêu cầu sửa lịch đang chờ đối soát (Visit {pendingAmend.visitId}, revision gốc {pendingAmend.revision ?? 'không có'}). Hệ thống chỉ retry khi revision vẫn nguyên và dùng đúng payload, khóa idempotency cùng revision ban đầu.<button type="button" onClick={() => void retryAmend()} disabled={busy || !Number.isSafeInteger(pendingAmend.revision)} className="ml-2 font-semibold underline">Đối chiếu yêu cầu sửa lịch</button></div>}
        <label className="mt-3 block text-sm font-medium">Ngày đến kho<input aria-label="Ngày đến kho" required type="date" min={minDate} max={maxDate} value={date} disabled={editingExpired || !!pendingCreate || !!pendingAmend || busy} onChange={event => { setDate(event.target.value); setSelectedSlot(''); }} className="mt-1 w-full rounded-lg border p-2" /></label>
        <p className="mt-1 text-xs text-slate-500">Chọn ngày trong 30 ngày tới. Sau khi chọn khung giờ, hệ thống tự xác định cơ sở và đưa các Reservation Managed cùng cơ sở còn hơn 7 ngày vào phạm vi Session.</p>
        <fieldset className="mt-4" disabled={editingExpired || !!pendingCreate || !!pendingAmend || busy || availabilityBusy}><legend className="text-sm font-medium">Khung giờ · múi giờ Việt Nam</legend>{availabilityBusy && <p role="status" className="mt-2 text-sm text-slate-600">Đang kiểm tra giờ hoạt động và nhân lực hộ tống ước tính…</p>}{availabilityError && <p role="alert" className="mt-2 text-sm text-red-700">{availabilityError}</p>}
          {!availabilityBusy && !availabilityError && effectiveSlots.length > 0 && <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{effectiveSlots.map(slot => <button key={slotKey(slot)} type="button" aria-pressed={selectedSlot === slotKey(slot)} onClick={() => setSelectedSlot(slotKey(slot))} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${selectedSlot === slotKey(slot) ? 'border-emerald-900 bg-emerald-900 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-emerald-700'}`}>{slotLabel(slot)}</button>)}</div>}
          {!availabilityBusy && !availabilityError && !effectiveSlots.length && <p role="status" className="mt-2 text-sm text-amber-800">{!hasEligibleScope ? 'Cần có ít nhất một Reservation Managed đang hoạt động, cùng cơ sở, đã bàn giao và còn hơn 7 ngày thuê để đặt lịch.' : isToday ? 'Hôm nay không còn khung giờ phù hợp' : 'Ngày này không còn khung giờ phù hợp.'}</p>}
        </fieldset>
        <label className="mt-3 block text-sm font-medium">Ghi chú (không bắt buộc)<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={3} disabled={editingExpired || !!pendingCreate || !!pendingAmend || busy} className="mt-1 w-full rounded-lg border p-2" /></label>
        <button disabled={editingExpired || busy || !!pendingCreate || !!pendingAmend || !selectedSlot || availabilityBusy || !!availabilityError || Date.parse(selectedSlot.split('|').at(-1)) <= clock} className="mt-4 w-full rounded-lg bg-emerald-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Đặt lịch đến kho'}</button>
        {editing && <button type="button" disabled={!!pendingAmend} onClick={() => { setEditing(null); setSelectedSlot(''); }} className="mt-2 w-full rounded-lg border px-4 py-2 disabled:opacity-50">Không sửa nữa</button>}
        <p className="mt-3 text-xs text-slate-500">Lịch chưa cấp quyền vào kho. Manager phân công Staff; Staff chỉ kích hoạt Session sau khi xác minh bạn tại Facility. Session chỉ bao phủ các Reservation Managed cùng cơ sở đủ điều kiện và còn hơn 7 ngày thuê.</p>
      </form>
      <div className="space-y-5">
        <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Session và lịch sử truy cập</h2>{sessions.length === 0 ? <p className="mt-3 text-sm text-slate-500">Chưa có Session.</p> : sessions.map(session => { const sessionCurrent = session.status === 'ACTIVE' && Date.parse(session.startedAt) <= clock && Date.parse(session.expiresAt) > clock; const sessionOperations = (session.allowedPurposes || []).filter(value => stockOperations.some(([purposeValue]) => purposeValue === value)); return <article key={session._id} className="mt-3 rounded-xl bg-emerald-50 p-4"><div className="flex justify-between gap-3"><b>{sessionLabel(sessionCurrent ? 'ACTIVE' : (session.status === 'ACTIVE' ? 'EXPIRED' : session.status))}</b>{sessionCurrent && <Countdown expiresAt={session.expiresAt} />}</div><p className="mt-2 text-sm">Bắt đầu tại Check-in: {displayDateTime(session.startedAt)}</p><p className="mt-1 text-sm">Quyền thao tác: {sessionOperations.map(purpose => stockOperations.find(entry => entry[0] === purpose)?.[1]).join(', ') || 'Không có quyền thao tác tồn kho'}</p><p className="mt-1 text-sm">Reservation trong phạm vi: {session.scopedReservationIds?.length || 1} đơn thuê</p><p className="mt-1 text-sm">Hết hạn: {displayDateTime(session.expiresAt)}</p><p className="mt-1 text-sm">Cell được phép: {session.allowedCellIds?.length ? `${session.allowedCellIds.length} Cell` : 'Không có dữ liệu Cell'}</p><p className="mt-1 break-all text-xs text-slate-500">{(session.allowedCellIds || []).join(', ')}</p>{sessionCurrent && sessionOperations.length > 0 && <nav className="mt-3 flex flex-wrap gap-2" aria-label="Thao tác trong Access Session">{sessionOperations.map(purpose => <Link key={purpose} to={`/portal/inventory?reservationId=${encodeURIComponent(String(session.reservationId))}&accessSessionId=${encodeURIComponent(String(session._id))}&operation=${purpose}`} className="rounded-lg border border-emerald-800 bg-white px-3 py-2 text-sm font-semibold text-emerald-900">{stockOperations.find(entry => entry[0] === purpose)?.[1]}</Link>)}</nav>}</article>; })}</section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Lịch của tôi</h2><button onClick={() => void refresh()} className="text-sm font-semibold text-emerald-800 underline">Làm mới</button></div>{visits.length === 0 ? <p className="mt-3 text-sm text-slate-500">Bạn chưa đặt lịch.</p> : <>{visibleVisits.map(visit => { const reservation = reservations.find(row => String(reservationId(row)) === String(visit.reservationId)); const status = visitDisplayStatus(visit, clock); return <article key={visit._id} className="mt-3 rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><b>Lượt đến kho{reservation?.reservationCode ? ` · ${reservation.reservationCode}` : ''}</b><span className={`rounded-full px-2 py-1 text-xs ${status === 'MISSED' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100'}`}>{visitStatusLabel(status)}</span></div><p className="mt-2 text-sm">{displayDateTime(visit.startsAt)} – {displayDateTime(visit.endsAt)}</p><p className="mt-1 text-sm">Nhân viên hộ tống: {visit.assignedStaffId?.displayName || 'Chưa phân công'}</p>{status === 'MISSED' && <p className="mt-2 text-sm text-rose-700">Khung giờ đã kết thúc bạn chưa checkin. Lịch này không thể chỉnh sửa; vui lòng đặt lịch mới.</p>}{status === 'SCHEDULED' && <div className="mt-3 flex gap-4"><button disabled={busy || !!pendingAmend} onClick={() => void cancel(visit)} className="text-sm font-semibold text-red-700 underline">Hủy lịch</button><button disabled={busy || !!pendingAmend} onClick={() => { setEditing(visit); setDate(vnDate(visit.startsAt)); setSelectedSlot(`${visit.facilityId || ''}|${visit.startsAt}`); setNote(visit.note || ''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-sm font-semibold text-emerald-800 underline">Sửa lịch</button></div>}</article>; })}<nav className="mt-4 flex items-center justify-between gap-3" aria-label="Phân trang lịch đến kho"><span className="text-sm text-slate-600">Trang {currentVisitPage}/{visitPageCount} · {newestVisits.length} lượt</span><div className="flex gap-2"><button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={currentVisitPage <= 1} onClick={() => setVisitPage(page => Math.max(1, page - 1))}>Trước</button><button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={currentVisitPage >= visitPageCount} onClick={() => setVisitPage(page => Math.min(visitPageCount, page + 1))}>Sau</button></div></nav></>}</section>
      </div>
    </div>
  </section>;
}
