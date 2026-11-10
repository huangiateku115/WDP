import {facilityLabel} from '@/lib/facilityLabels';
import QueuePagination from '@/components/staff/QueuePagination';
import { inventoryQueuePage } from '@/lib/inventoryQueuePage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const field = 'mt-1 w-full rounded border border-slate-300 p-2';
const message = error => error?.response?.data?.message || error?.message || "Không thể hoàn tất yêu cầu xuất hàng.";
const body = response => response?.data?.data;
const operationStore = (requestId, actorId) => `wdp:mi06:outbound:confirm:${actorId || 'unknown'}:${requestId}`;

export default function CanonicalOutboundQueuePage() {
  const session = useAuthSession();
  const [rows, setRows] = useState([]), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [stateFilter, setStateFilter] = useState('PENDING'), [quantity, setQuantity] = useState(''), [handoverConfirmed, setHandoverConfirmed] = useState(false), [note, setNote] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const confirmationKey = useRef(null), confirmationPayload = useRef(null), confirmationVersion = useRef(null), busyRef = useRef(false);

  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const queueSequence = useRef(0);
  const detailSequence = useRef(0);
  const loadQueue = useCallback(async () => {
    const sequence = ++queueSequence.current;
    const token = getAccessToken(); setLoading(true); setRows([]); setError('');
    try {
      const response = await inventoryApi.canonicalOutboundStaffQueue({ state: stateFilter || undefined, page, limit: 20 });
      if (sequence !== queueSequence.current || token !== getAccessToken()) return;
      const value = inventoryQueuePage(response, page);
      if (page > Math.max(1, value.pagination.totalPages)) { setPage(Math.max(1, value.pagination.totalPages)); return; }
      setRows(value.data);
      setPagination(value.pagination);
    } catch (failure) {
      if (sequence === queueSequence.current && token === getAccessToken()) { setPagination({ total: 0, totalPages: 0 }); setError(message(failure)); }
    } finally {
      if (sequence === queueSequence.current && token === getAccessToken()) setLoading(false);
    }
  }, [stateFilter, page]);

  useEffect(() => { ++detailSequence.current; busyRef.current = false; setBusy(false); setSelected(null); setDetail(null); setError(''); setNotice(''); confirmationKey.current = null; confirmationPayload.current = null; confirmationVersion.current = null; loadQueue(); }, [loadQueue, session.accessToken]);

  const open = async row => {
    if (busyRef.current) return;
    const sequence = ++detailSequence.current;
    const token = getAccessToken(); setSelected(row._id); setDetail(null); setError(''); setNotice('');
    try {
      const response = await inventoryApi.canonicalOutboundStaffDetail(row._id);
      if (sequence !== detailSequence.current || token !== getAccessToken()) return;
      const value = body(response);
      if (response.data?.success !== true || value?.request?._id !== row._id || value.request.facilityId !== session.user?.assignedFacilityId || value.item?._id !== value.request.itemId) throw Error("Chi tiết xuất hàng không khớp yêu cầu và cơ sở.");
      setDetail(value); setQuantity(String(value.request.state === 'PENDING' ? value.request.requestedQuantity : value.request.confirmedQuantity ?? ''));
      setHandoverConfirmed(false); setNote('');
      const saved = sessionStorage.getItem(operationStore(row._id, session.user?.id));
      try {
        const operation = saved ? JSON.parse(saved) : null;
        if (saved && (!operation || typeof operation.key !== 'string' || !operation.key.trim() || !Number.isSafeInteger(operation.version) || operation.version < 0 || !Number.isSafeInteger(operation.payload?.actualDeliveredQty) || operation.payload.actualDeliveredQty <= 0 || operation.payload.handoverConfirmed !== true || !operation.payload.handoverNote?.trim())) throw Error("Thao tác đã lưu không hợp lệ");
        confirmationKey.current = operation?.key || null;
        confirmationPayload.current = operation?.payload || null;
        confirmationVersion.current = Number.isSafeInteger(operation?.version) ? operation.version : null;
        if (operation?.payload) {
          setQuantity(String(operation.payload.actualDeliveredQty));
          setHandoverConfirmed(operation.payload.handoverConfirmed === true);
          setNote(operation.payload.handoverNote || '');
          setError("Chưa xác định kết quả xác nhận trước. Thử lại cùng xác nhận đã lưu hoặc tải lại yêu cầu trước khi thao tác mới.");
        }
      } catch { setDetail(null); throw Error("Không xác minh được xác nhận đã lưu. Cần đối chiếu yêu cầu trước khi gửi lại."); }
    } catch (e) { if (sequence === detailSequence.current && token === getAccessToken()) setError(message(e)); }
  };

  const confirm = async retry => {
    if (busyRef.current || !detail || selected !== detail.request._id) return;
    const savedPayload = retry ? confirmationPayload.current : null;
    if (retry && (!savedPayload || !confirmationKey.current || !Number.isSafeInteger(confirmationVersion.current))) return;
    const delivered = Number(savedPayload?.actualDeliveredQty ?? quantity);
    if (!Number.isSafeInteger(delivered) || delivered <= 0) { setError("Nhập số lượng nguyên dương."); return; }
    if (!retry && (detail.request.state !== 'PENDING' || !handoverConfirmed || !note.trim() || delivered > detail.request.heldQuantity)) { setError("Kiểm tra yêu cầu đang chờ và lượng hàng đang giữ."); return; }
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const token = getAccessToken(), keyStore = operationStore(selected, session.user?.id);
    const key = retry ? confirmationKey.current : (confirmationKey.current || newKey());
    const payload = retry && confirmationPayload.current ? confirmationPayload.current : {
      actualDeliveredQty: delivered, handoverConfirmed: true, handoverNote: note.trim(),
    };
    const expectedVersion = retry && Number.isSafeInteger(confirmationVersion.current) ? confirmationVersion.current : detail.request.version;
    try {
      sessionStorage.setItem(keyStore, JSON.stringify({ key, payload, version: expectedVersion }));
      confirmationKey.current = key; confirmationPayload.current = payload; confirmationVersion.current = expectedVersion;
      const response = await inventoryApi.confirmCanonicalOutbound(selected, payload, expectedVersion, key);
      if (token !== getAccessToken()) return;
      const result = body(response);
      if (response.data?.success !== true || result?._id !== selected || !['CONFIRMED', 'PARTIALLY_FULFILLED'].includes(result.state) || result.confirmedQuantity !== payload.actualDeliveredQty) throw Error("Chưa xác minh kết quả giao hàng. Thử lại cùng xác nhận.");
      sessionStorage.removeItem(keyStore); confirmationKey.current = null; confirmationPayload.current = null; confirmationVersion.current = null;
      setNotice(`Handover confirmed: ${result?.confirmedQuantity ?? payload.actualDeliveredQty} units delivered; request status ${result?.state || 'updated'}.`);
      const refreshed = await Promise.allSettled([
        inventoryApi.canonicalOutboundStaffDetail(selected), inventoryApi.stockBalance(detail.item._id),
        inventoryApi.get(detail.item._id), inventoryApi.movements(detail.item._id),
      ]);
      if (token !== getAccessToken()) return;
      if (refreshed[0].status === 'fulfilled') {
        setDetail(body(refreshed[0].value)); setQuantity(String(body(refreshed[0].value).request.confirmedQuantity ?? ''));
      }
      await loadQueue();
      if (refreshed.some(result => result.status === 'rejected')) setError("Đã xác nhận giao hàng nhưng chưa tải lại được đầy đủ dữ liệu. Tải lại yêu cầu và tồn kho trước khi tiếp tục.");
    } catch (e) {
      if (token !== getAccessToken()) return;
      setError(message(e));
      const status = e?.response?.status;
      if (status === 409) {
        sessionStorage.removeItem(keyStore); confirmationKey.current = null; confirmationPayload.current = null; confirmationVersion.current = null;
        busyRef.current = false; await open({ _id: selected }); await loadQueue(); setError(message(e));
      } else if (status && status < 500) {
        sessionStorage.removeItem(keyStore); confirmationKey.current = null; confirmationPayload.current = null; confirmationVersion.current = null;
      }
    } finally { if (token === getAccessToken()) { busyRef.current = false; setBusy(false); } }
  };

  return <main className="space-y-5 p-5" aria-label="Hàng chờ xuất theo sổ tồn chuẩn">
    <header><h1 className="text-2xl font-bold">Xuất hàng hóa</h1><p className="mt-1 text-sm text-slate-600">Hàng chờ trong cơ sở. Xác nhận số lượng đã thực giao cho khách.</p></header>
    <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"><label className="text-sm">Trạng thái yêu cầu<select className={field} value={stateFilter} disabled={busy} onChange={e => { setPage(1); setStateFilter(e.target.value); }}><option value="PENDING">Chờ giao hàng</option><option value="CONFIRMED">Đã xác nhận</option><option value="PARTIALLY_FULFILLED">Đã đáp ứng một phần</option><option value="CANCELLED">Đã hủy</option></select></label><button className="rounded border px-4 py-2" disabled={loading} onClick={loadQueue}>Tải lại hàng chờ</button></section>
    <QueuePagination page={page} pagination={pagination} loading={loading || busy} onPageChange={setPage} />
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    {detail && detail.request.state !== 'PENDING' && <section className="rounded-lg border bg-white p-4" aria-label="Kết quả xuất hàng đã xử lý"><h2 className="font-semibold">Giao hàng đã ghi nhận</h2><p>Yêu cầu {detail.request.requestedQuantity} {facilityLabel(detail.request.quantityUnit)}</p><p>Thực giao {detail.request.confirmedQuantity ?? "Máy chủ chưa trả dữ liệu"} {facilityLabel(detail.request.quantityUnit)}</p><p>Biến động {detail.request.confirmedMovementId || "Chưa có biến động giao hàng"}</p></section>}
    {detail && confirmationKey.current && <button className="rounded border px-4 py-2" disabled={busy} onClick={() => confirm(true)}>Thử lại cùng xác nhận</button>}
    {detail && <a className="manager-link" href={`/staff/inventory/stock?itemId=${detail.item._id}`}>Xem tồn kho và các lô nhập</a>}
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]"><section className="space-y-2">{loading && <p role="status">Đang tải yêu cầu xuất hàng…</p>}{rows.map(row => <button key={row._id} className={`w-full rounded-lg border bg-white p-4 text-left ${selected === row._id ? 'border-emerald-700 bg-emerald-50' : ''}`} disabled={busy} onClick={() => open(row)}><b>{row.item?.itemCode} · {row.requestedQuantity} {facilityLabel(row.quantityUnit)}</b><span className="mt-1 block text-sm">{facilityLabel(row.state)} · đang giữ {row.heldQuantity}</span><span className="block text-xs text-slate-500">{row.item?.name} · phiên bản{row.version}</span></button>)}{!loading && rows.length === 0 && <p className="rounded border bg-white p-4 text-sm">Không có yêu cầu khớp trạng thái tại cơ sở được phân công.</p>}</section>
    <section className="rounded-lg border bg-white p-5">{!detail ? <p>Chọn yêu cầu xuất hàng.</p> : <><h2 className="text-xl font-bold">{detail.item.itemCode} · {detail.item.name}</h2><p className="mt-1 text-sm">{facilityLabel(detail.request.state)} · phiên bản yêu cầu{detail.request.version} · hiện có {detail.stock?.currentQty ?? 'unknown'} · đang giữ {detail.stock?.heldQty ?? 'unknown'} · khả dụng {detail.stock?.availableQty ?? 'unknown'}</p><p className="mt-2 break-all text-xs text-slate-500">Mặt hàng {detail.item._id} · ô {detail.item.currentCellId || 'none'}</p><div className="mt-4 space-y-3"><label className="block text-sm">Số lượng thực giao<input className={field} type="number" min="1" max={detail.request.heldQuantity} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy || detail.request.state !== 'PENDING' || !!confirmationKey.current} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={handoverConfirmed} onChange={e => setHandoverConfirmed(e.target.checked)} disabled={detail.request.state !== 'PENDING' || !!confirmationKey.current} />Tôi xác nhận đã giao hàng thực tế cho khách</label><label className="block text-sm">Ghi chú giao hàng<textarea className={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} disabled={detail.request.state !== 'PENDING' || !!confirmationKey.current} /></label>{detail.request.state === 'PENDING' && <div className="flex flex-wrap gap-2"><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !!confirmationKey.current || !handoverConfirmed || !note.trim()} onClick={() => confirm(false)}>{busy ? "Đang xác nhận…" : "Xác nhận giao hàng và giải phóng lượng giữ dư"}</button></div>}</div></>}</section></div>
  </main>;
}
