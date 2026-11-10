import QueuePagination from '@/components/staff/QueuePagination';
import { inventoryQueuePage } from '@/lib/inventoryQueuePage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const field = 'mt-1 w-full rounded border border-slate-300 p-2';
const message = error => error?.response?.data?.message || error?.message || 'The outbound request could not be completed.';
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
      if (response.data?.success !== true || value?.request?._id !== row._id || value.request.facilityId !== session.user?.assignedFacilityId || value.item?._id !== value.request.itemId) throw Error('Outbound detail does not match this request and Facility.');
      setDetail(value); setQuantity(String(value.request.state === 'PENDING' ? value.request.requestedQuantity : value.request.confirmedQuantity ?? ''));
      setHandoverConfirmed(false); setNote('');
      const saved = sessionStorage.getItem(operationStore(row._id, session.user?.id));
      try {
        const operation = saved ? JSON.parse(saved) : null;
        if (saved && (!operation || typeof operation.key !== 'string' || !operation.key.trim() || !Number.isSafeInteger(operation.version) || operation.version < 0 || !Number.isSafeInteger(operation.payload?.actualDeliveredQty) || operation.payload.actualDeliveredQty <= 0 || operation.payload.handoverConfirmed !== true || !operation.payload.handoverNote?.trim())) throw Error('Invalid saved operation');
        confirmationKey.current = operation?.key || null;
        confirmationPayload.current = operation?.payload || null;
        confirmationVersion.current = Number.isSafeInteger(operation?.version) ? operation.version : null;
        if (operation?.payload) {
          setQuantity(String(operation.payload.actualDeliveredQty));
          setHandoverConfirmed(operation.payload.handoverConfirmed === true);
          setNote(operation.payload.handoverNote || '');
          setError('A prior confirmation result may be uncertain. Retry the saved confirmation exactly or refresh the request before starting a new action.');
        }
      } catch { setDetail(null); throw Error('The saved confirmation cannot be verified. Reconcile this request before submitting again.'); }
    } catch (e) { if (sequence === detailSequence.current && token === getAccessToken()) setError(message(e)); }
  };

  const confirm = async retry => {
    if (busyRef.current || !detail || selected !== detail.request._id) return;
    const savedPayload = retry ? confirmationPayload.current : null;
    if (retry && (!savedPayload || !confirmationKey.current || !Number.isSafeInteger(confirmationVersion.current))) return;
    const delivered = Number(savedPayload?.actualDeliveredQty ?? quantity);
    if (!Number.isSafeInteger(delivered) || delivered <= 0) { setError('Enter a positive whole quantity.'); return; }
    if (!retry && (detail.request.state !== 'PENDING' || !handoverConfirmed || !note.trim() || delivered > detail.request.heldQuantity)) { setError('Review the pending request and its held quantity.'); return; }
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
      if (response.data?.success !== true || result?._id !== selected || !['CONFIRMED', 'PARTIALLY_FULFILLED'].includes(result.state) || result.confirmedQuantity !== payload.actualDeliveredQty) throw Error('Delivery result is unverified. Retry the same confirmation.');
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
      if (refreshed.some(result => result.status === 'rejected')) setError('Delivery was confirmed, but one or more follow-up reads failed. Refresh the request and stock before continuing.');
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

  return <main className="space-y-5 p-5" aria-label="Canonical outbound queue">
    <header><h1 className="text-2xl font-bold">Managed Inventory outbound</h1><p className="mt-1 text-sm text-slate-600">Facility-scoped queue. Confirm only the quantity physically handed over to the Customer.</p></header>
    <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4"><label className="text-sm">Request state<select className={field} value={stateFilter} disabled={busy} onChange={e => { setPage(1); setStateFilter(e.target.value); }}><option value="PENDING">Pending handover</option><option value="CONFIRMED">Confirmed</option><option value="PARTIALLY_FULFILLED">Partially fulfilled</option><option value="CANCELLED">Cancelled</option></select></label><button className="rounded border px-4 py-2" disabled={loading} onClick={loadQueue}>Refresh queue</button></section>
    <QueuePagination page={page} pagination={pagination} loading={loading || busy} onPageChange={setPage} />
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    {detail && detail.request.state !== 'PENDING' && <section className="rounded-lg border bg-white p-4" aria-label="Completed outbound result"><h2 className="font-semibold">Recorded delivery</h2><p>Requested {detail.request.requestedQuantity} {detail.request.quantityUnit}</p><p>Actually delivered {detail.request.confirmedQuantity ?? 'Not returned'} {detail.request.quantityUnit}</p><p>Movement {detail.request.confirmedMovementId || 'No delivery movement'}</p></section>}
    {detail && confirmationKey.current && <button className="rounded border px-4 py-2" disabled={busy} onClick={() => confirm(true)}>Retry same confirmation</button>}
    {detail && <a className="manager-link" href={`/staff/inventory/stock?itemId=${detail.item._id}`}>View stock balance and receipt batches</a>}
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]"><section className="space-y-2">{loading && <p role="status">Loading outbound requests…</p>}{rows.map(row => <button key={row._id} className={`w-full rounded-lg border bg-white p-4 text-left ${selected === row._id ? 'border-emerald-700 bg-emerald-50' : ''}`} disabled={busy} onClick={() => open(row)}><b>{row.item?.itemCode} · {row.requestedQuantity} {row.quantityUnit}</b><span className="mt-1 block text-sm">{row.state} · held {row.heldQuantity}</span><span className="block text-xs text-slate-500">{row.item?.name} · v{row.version}</span></button>)}{!loading && rows.length === 0 && <p className="rounded border bg-white p-4 text-sm">No requests match this state in the assigned Facility.</p>}</section>
    <section className="rounded-lg border bg-white p-5">{!detail ? <p>Select an outbound request.</p> : <><h2 className="text-xl font-bold">{detail.item.itemCode} · {detail.item.name}</h2><p className="mt-1 text-sm">{detail.request.state} · request v{detail.request.version} · current {detail.stock?.currentQty ?? 'unknown'} · held {detail.stock?.heldQty ?? 'unknown'} · available {detail.stock?.availableQty ?? 'unknown'}</p><p className="mt-2 break-all text-xs text-slate-500">Item {detail.item._id} · Cell {detail.item.currentCellId || 'none'}</p><div className="mt-4 space-y-3"><label className="block text-sm">Actual quantity handed over<input className={field} type="number" min="1" max={detail.request.heldQuantity} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy || detail.request.state !== 'PENDING' || !!confirmationKey.current} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={handoverConfirmed} onChange={e => setHandoverConfirmed(e.target.checked)} disabled={detail.request.state !== 'PENDING' || !!confirmationKey.current} />I confirm physical handover to the Customer</label><label className="block text-sm">Handover note<textarea className={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} disabled={detail.request.state !== 'PENDING' || !!confirmationKey.current} /></label>{detail.request.state === 'PENDING' && <div className="flex flex-wrap gap-2"><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !!confirmationKey.current || !handoverConfirmed || !note.trim()} onClick={() => confirm(false)}>{busy ? 'Confirming…' : 'Confirm delivery and release unused hold'}</button></div>}</div></>}</section></div>
  </main>;
}
