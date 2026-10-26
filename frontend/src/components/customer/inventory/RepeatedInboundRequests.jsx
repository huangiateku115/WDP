import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from './InventoryBackendUI';
import { getAccessToken, useAuthSession } from '@/lib/authSession';

const states = ['PENDING_INSPECTION', 'DISCREPANCY', 'ACCEPTED_PENDING_CONFIRMATION', 'RETURN_PENDING', 'REJECTED', 'CONFIRMED', 'CANCELLED'];
const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const message = error => error?.response?.data?.message || error?.message || 'Request failed.';

export default function RepeatedInboundRequests({ item }) {
  const session = useAuthSession();
  return <Requests key={`${session.accessToken}:${item._id}`} item={item}/>;
}
function Requests({ item }) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [quantity, setQuantity] = useState('1'), [weight, setWeight] = useState(String(item.unitWeightKg || ''));
  const [width, setWidth] = useState(String(item.unitDimensionsM?.widthM || '')), [depth, setDepth] = useState(String(item.unitDimensionsM?.depthM || '')), [height, setHeight] = useState(String(item.unitDimensionsM?.heightM || ''));
  const [pending, setPending] = useState(false), [editing, setEditing] = useState(null), [detail, setDetail] = useState(null), busy = useRef(false), pendingKey = useRef(null), pendingPayload = useRef(null), tokenAtStart = useRef(null);
  const refresh = async () => {
    const token = getAccessToken();
    try { const response = await inventoryApi.repeatedInboundHistory(item._id, { page: 1, limit: 50 }); if (getAccessToken() !== token) return; setRows(response.data?.data || []); }
    catch (e) { if (getAccessToken() === token) setError(message(e)); }
    finally { if (getAccessToken() === token) setLoading(false); }
  };
  useEffect(() => { let live = true; const token = getAccessToken(); inventoryApi.repeatedInboundHistory(item._id, { page: 1, limit: 50 }).then(r => { if (live && token === getAccessToken()) setRows(r.data?.data || []); }).catch(e => { if (live && token === getAccessToken()) setError(message(e)); }).finally(() => { if (live && token === getAccessToken()) setLoading(false); }); return () => { live = false; }; }, [item._id]);
  const submit = async retry => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    const token = getAccessToken(); tokenAtStart.current = token;
    const body = retry && pendingPayload.current ? pendingPayload.current : { requestedQuantity: Number(quantity), quantityUnit: item.quantityUnit, declaredUnitWeightKg: Number(weight), declaredUnitDimensionsM: { widthM: Number(width), depthM: Number(depth), heightM: Number(height) } };
    const idem = retry && pendingKey.current ? pendingKey.current : (pendingKey.current = key());
    pendingPayload.current = body;
    try {
      if (editing) {
        await inventoryApi.amendRepeatedInbound(editing._id, body, editing.version, idem);
        if (getAccessToken() !== token) return;
        pendingKey.current = null; pendingPayload.current = null; setEditing(null); setNotice('Receipt request amended.'); await refresh(); return;
      }
      const response = await inventoryApi.createRepeatedInbound(item._id, body, idem);
      if (getAccessToken() !== token) return;
      pendingKey.current = null; pendingPayload.current = null;
      setNotice(response.status === 200 ? 'Original receipt request replayed.' : 'Receipt request created. Facility Staff must inspect the goods.');
      await refresh();
    } catch (e) {
      if (getAccessToken() !== token) return;
      if (e.response?.status === 409) { pendingKey.current = null; pendingPayload.current = null; }
      setError(e.response?.status === 503 ? `${message(e)} Retry with the same key.` : message(e));
    } finally { if (getAccessToken() === tokenAtStart.current) { busy.current = false; setPending(false); } }
  };
  const amend = row => { setEditing(row); setQuantity(String(row.requestedQuantity)); setWeight(String(row.declaredUnitWeightKg)); setWidth(String(row.declaredUnitDimensionsM.widthM)); setDepth(String(row.declaredUnitDimensionsM.depthM)); setHeight(String(row.declaredUnitDimensionsM.heightM)); setError(''); };
  const cancel = async row => { setError(''); try { await inventoryApi.cancelRepeatedInbound(row._id, row.version, key()); setNotice('Receipt request cancelled.'); await refresh(); } catch (e) { setError(message(e)); } };
  const view = async row => { const token = getAccessToken(); setDetail(null); try { const r = await inventoryApi.repeatedInboundDetail(row._id); if (token === getAccessToken()) setDetail(r.data?.data); } catch (e) { if (token === getAccessToken()) setError(message(e)); } };
  const allowed = ['IN_STORAGE', 'CHECKED_OUT'].includes(item.status);
  return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Repeated inbound requests">
    <h2 className="text-lg font-bold">Additional receipt requests</h2>
    <p className="mt-1 text-sm text-slate-600">Registered quantity remains item metadata. Enter the quantity in this new delivery batch.</p>
    {allowed && <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); submit(false); }}>
      <label className="text-sm">Receipt quantity ({item.quantityUnit})<input className="mt-1 w-full rounded border p-2" type="number" min="1" step="1" required value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
      <label className="text-sm">Actual unit weight (kg)<input className="mt-1 w-full rounded border p-2" type="number" min="0.000001" step="any" required value={weight} onChange={e => setWeight(e.target.value)} /></label>
      {[['Width (m)', width, setWidth], ['Depth (m)', depth, setDepth], ['Height (m)', height, setHeight]].map(([label, value, setter]) => <label className="text-sm" key={label}>{label}<input className="mt-1 w-full rounded border p-2" type="number" min="0.000001" step="any" required value={value} onChange={e => setter(e.target.value)} /></label>)}
      <div className="sm:col-span-2 flex flex-wrap gap-2"><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={pending}>{pending ? 'Submitting…' : editing ? 'Save amendment' : 'Create receipt request'}</button>{editing && <button type="button" className="rounded border px-4 py-2" disabled={pending} onClick={() => setEditing(null)}>Stop editing</button>}{pendingKey.current && error && <button type="button" className="rounded border px-4 py-2" disabled={pending} onClick={() => submit(true)}>Retry same request</button>}</div>
    </form>}
    {!allowed && <p className="mt-3 text-sm text-slate-600">Additional receipts require an Item in storage or a fully checked-out Item.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    <div className="mt-5 space-y-3">{loading ? <p>Loading receipt history…</p> : rows.length === 0 ? <p className="text-sm text-slate-500">No additional receipts yet.</p> : rows.map(row => <article key={row._id} className="rounded-lg bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2"><b>{row.requestedQuantity} {row.quantityUnit}</b><span className="text-sm font-semibold">{states.includes(row.state) ? row.state.replaceAll('_', ' ') : 'Unknown'}</span></div><p className="mt-1 text-xs text-slate-500">Version {row.version} · {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ''}</p><div className="mt-3 flex gap-2"><button className="rounded border px-3 py-1" disabled={pending} onClick={() => view(row)}>Details</button>{row.state === 'PENDING_INSPECTION' && row.custodyState === 'NOT_TAKEN' && <><button className="rounded border px-3 py-1" disabled={pending} onClick={() => amend(row)}>Amend</button><button className="rounded border px-3 py-1" disabled={pending} onClick={() => cancel(row)}>Cancel</button></>}</div></article>)}</div>
    {detail && <article className="mt-4 rounded-lg border p-4"><h3 className="font-semibold">Request details · {detail.state}</h3><p className="mt-1 text-sm">{detail.requestedQuantity} {detail.quantityUnit}; {detail.declaredUnitWeightKg} kg/unit; {detail.declaredUnitDimensionsM.widthM} × {detail.declaredUnitDimensionsM.depthM} × {detail.declaredUnitDimensionsM.heightM} m</p>{detail.confirmedMovementId && <p className="mt-2 break-all text-xs">Confirmed movement: {detail.confirmedMovementId}</p>}</article>}
  </section>;
}
