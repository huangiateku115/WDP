import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import { useAuthSession, getAccessToken } from '@/lib/authSession';

const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const err = e => e?.response?.data?.message || e?.message || 'Request failed.';
const field = 'mt-1 w-full rounded border border-slate-300 p-2';

export default function RepeatedInboundQueuePage() {
  const session = useAuthSession(), [rows, setRows] = useState([]), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [state, setState] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [decision, setDecision] = useState('ACCEPTED'), [receivedQuantity, setReceivedQuantity] = useState(''), [weight, setWeight] = useState(''), [width, setWidth] = useState(''), [depth, setDepth] = useState(''), [height, setHeight] = useState(''), [custodyTaken, setCustodyTaken] = useState(false), [packing, setPacking] = useState(false), [note, setNote] = useState(''), [returnNote, setReturnNote] = useState(''), [files, setFiles] = useState([]), [uploads, setUploads] = useState([]), [cellId, setCellId] = useState('');
  const inspectionKey = useRef(null), submitPayload = useRef(null), busyRef = useRef(false);
  const loadQueue = useCallback(async () => {
    const token = getAccessToken(); setLoading(true); setError('');
    try { const r = await inventoryApi.repeatedInboundQueue({ state: state || undefined, page: 1, limit: 100 }); if (token === getAccessToken()) setRows(r.data?.data?.data || []); }
    catch (e) { if (token === getAccessToken()) setError(err(e)); }
    finally { if (token === getAccessToken()) setLoading(false); }
  }, [state]);
  useEffect(() => { loadQueue(); }, [loadQueue, session.accessToken]);
  const open = async row => {
    const token = getAccessToken(); setError(''); setNotice(''); setSelected(row._id); setDetail(null); setUploads([]);
    try { const r = await inventoryApi.repeatedInboundReceivingDetail(row._id); if (token !== getAccessToken()) return; const d = r.data?.data; setDetail(d); setReceivedQuantity(String(d.request.requestedQuantity)); setWeight(String(d.request.declaredUnitWeightKg)); setWidth(String(d.request.declaredUnitDimensionsM.widthM)); setDepth(String(d.request.declaredUnitDimensionsM.depthM)); setHeight(String(d.request.declaredUnitDimensionsM.heightM)); setCellId(d.item.currentCellId || d.cells?.[0]?._id || ''); }
    catch (e) { if (token === getAccessToken()) setError(err(e)); }
  };
  const selectFiles = e => { const picked = [...e.target.files || []]; setFiles(picked.slice(0, Math.max(0, 10 - uploads.length))); e.target.value = ''; };
  const uploadFiles = async () => {
    const token = getAccessToken(), uploaded = [...uploads];
    for (const file of files) {
      try { const r = await inventoryApi.uploadRepeatedInboundEvidence(selected, file, key()); if (token !== getAccessToken()) return uploaded; uploaded.push(r.data.data); setUploads([...uploaded]); }
      catch (e) { if (token === getAccessToken()) throw e; return; }
    }
    setFiles([]);
    return uploaded;
  };
  const inspect = async retry => {
    if (busyRef.current || !detail) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); const token = getAccessToken();
    try {
      const currentUploads = files.length ? await uploadFiles() : uploads;
      if (token !== getAccessToken()) return;
      if (!currentUploads) throw new Error('Session changed during evidence upload. Sign in again before retrying.');
      const payload = submitPayload.current || { decision, receivedQuantity: Number(receivedQuantity), actualUnitWeightKg: Number(weight), actualUnitDimensionsM: { widthM: Number(width), depthM: Number(depth), heightM: Number(height) }, compatibleCellIds: cellId ? [cellId] : [], packingLayoutVerified: packing, custodyTaken, note, evidenceUploadIds: currentUploads.map(u => u.uploadId), inspectionKey: inspectionKey.current || (inspectionKey.current = key()) };
      submitPayload.current = payload;
      await inventoryApi.inspectRepeatedInbound(selected, payload, detail.request.version);
      if (token !== getAccessToken()) return;
      setNotice('Inspection and immutable evidence snapshot saved.'); submitPayload.current = null; inspectionKey.current = null; setFiles([]); setUploads([]); await open({ _id: selected }); await loadQueue();
    } catch (e) { if (token !== getAccessToken()) return; setError(`${err(e)}${e.response?.status >= 500 ? ' Retry the same inspection to recover the result.' : ''}`); }
    finally { if (token === getAccessToken()) { busyRef.current = false; setBusy(false); } }
  };
  const confirm = async () => {
    if (busyRef.current || !detail) return; busyRef.current = true; setBusy(true); setError(''); const token = getAccessToken();
    try { const payload = submitPayload.current || { destinationCellId: cellId, inspectionNote: note || 'Repeated receipt accepted', idempotencyKey: inspectionKey.current || (inspectionKey.current = key()) }; submitPayload.current = payload; await inventoryApi.confirmRepeatedInbound(selected, payload, detail.request.version); if (token !== getAccessToken()) return; submitPayload.current = null; inspectionKey.current = null; setNotice('Canonical receipt movement and stock projection committed.'); await open({ _id: selected }); await loadQueue(); }
    catch (e) { if (token === getAccessToken()) setError(`${err(e)}${e.response?.status >= 500 ? ' Retry using the same confirmation key.' : ''}`); }
    finally { if (token === getAccessToken()) { busyRef.current = false; setBusy(false); } }
  };
  const completeReturn = async () => { if (!detail || busyRef.current || !returnNote.trim()) return; busyRef.current = true; setBusy(true); try { await inventoryApi.completeRepeatedInboundReturn(selected, returnNote.trim(), detail.request.version, key()); setNotice('Return completion recorded; request is now closed as rejected.'); await open({ _id: selected }); await loadQueue(); } catch (e) { setError(err(e)); } finally { busyRef.current = false; setBusy(false); } };
  return <div className="space-y-5 p-5"><header><h1 className="text-2xl font-bold">Repeated inbound receiving</h1><p className="mt-1 text-sm text-slate-600">Facility-scoped queue for additional Managed Inventory receipt batches.</p></header>
    <section className="flex flex-wrap gap-3 rounded-lg border bg-white p-4"><label className="text-sm">Request state<select className={field} value={state} onChange={e => setState(e.target.value)}><option value="">All unresolved</option>{['PENDING_INSPECTION','DISCREPANCY','ACCEPTED_PENDING_CONFIRMATION','RETURN_PENDING'].map(s => <option key={s}>{s}</option>)}</select></label><button className="mt-5 rounded border px-4 py-2" onClick={loadQueue} disabled={loading}>Refresh queue</button></section>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]"><section className="space-y-2">{loading && <p>Loading…</p>}{rows.map(row => <button key={row._id} className={`w-full rounded-lg border p-4 text-left ${selected === row._id ? 'border-emerald-700 bg-emerald-50' : 'bg-white'}`} onClick={() => open(row)}><b>{row.requestedQuantity} {row.quantityUnit}</b><span className="block text-sm">{row.state.replaceAll('_', ' ')}</span><span className="block break-all text-xs text-slate-500">{row.itemId} · v{row.version}</span></button>)}{!loading && rows.length === 0 && <p className="rounded border bg-white p-4 text-sm">No unresolved receipt requests in this Facility.</p>}</section>
    <section className="rounded-lg border bg-white p-5">{!detail ? <p>Select a request to inspect.</p> : <><h2 className="text-xl font-bold">{detail.item.itemCode} · {detail.item.name}</h2><p className="mt-1 text-sm">{detail.request.requestedQuantity} {detail.request.quantityUnit} · request version {detail.request.version} · {detail.request.state}</p><div className="mt-4 space-y-2">{(detail.inspections || []).map(a => <article className="rounded bg-slate-50 p-3" key={a._id}><b>Attempt {a.attempt}: {a.decision}</b><p className="text-sm">Quantity {a.receivedQuantity} · custody {a.custodyTaken ? 'taken' : 'not taken'} · {a.note}</p><div className="mt-2 flex flex-wrap gap-2">{(a.images || []).map(i => <a key={i.uploadId} href={i.secureUrl} target="_blank" rel="noreferrer"><img className="h-20 w-20 rounded object-cover" src={i.secureUrl} alt="Receiving evidence" loading="lazy"/></a>)}</div></article>)}</div>
      {['PENDING_INSPECTION','DISCREPANCY'].includes(detail.request.state) && <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-sm">Decision<select className={field} value={decision} onChange={e => setDecision(e.target.value)}>{['ACCEPTED','DISCREPANCY','REJECTED'].map(s => <option key={s}>{s}</option>)}</select></label><label className="text-sm">Actual received quantity<input className={field} type="number" min="0" step="1" value={receivedQuantity} onChange={e => setReceivedQuantity(e.target.value)}/></label><label className="text-sm">Actual unit weight (kg)<input className={field} type="number" min="0.000001" step="any" value={weight} onChange={e => setWeight(e.target.value)}/></label>{[['Width m',width,setWidth],['Depth m',depth,setDepth],['Height m',height,setHeight]].map(([label,value,setter])=><label key={label} className="text-sm">{label}<input className={field} type="number" min="0.000001" step="any" value={value} onChange={e => setter(e.target.value)}/></label>)}<label className="text-sm sm:col-span-2">Allocated destination/current Cell<select className={field} value={cellId} onChange={e => setCellId(e.target.value)}><option value="">Select allocated Cell</option>{(detail.cells || []).filter(c => detail.item.status !== 'IN_STORAGE' || String(c._id) === String(detail.item.currentCellId)).map(c => <option key={c._id} value={c._id}>{c.code} · {c.usedWeightKg} kg · {c.usedVolumeM3} m³</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={custodyTaken} onChange={e => setCustodyTaken(e.target.checked)}/> Facility takes/retains custody</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={packing} onChange={e => setPacking(e.target.checked)}/> Packing layout verified</label><label className="text-sm sm:col-span-2">Inspection observations<textarea className={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)}/></label><label className="text-sm sm:col-span-2">Evidence photos (up to 10)<input className={field} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectFiles}/><span className="mt-1 block text-xs text-slate-500">Selected files: {files.length + uploads.length}/10</span></label><div className="flex flex-wrap gap-2 sm:col-span-2">{uploads.map(u => <div key={u.uploadId} className="relative"><img className="h-16 w-16 rounded object-cover" src={u.secureUrl} alt="Selected evidence"/><button type="button" className="absolute -right-2 -top-2 rounded-full bg-white px-2 shadow" onClick={() => setUploads(xs => xs.filter(x => x.uploadId !== u.uploadId))} aria-label="Remove uploaded evidence">×</button></div>)}{files.map((f,i) => <div key={`${f.name}-${i}`} className="relative"><img className="h-16 w-16 rounded object-cover" src={URL.createObjectURL(f)} alt={f.name}/><button type="button" className="absolute -right-2 -top-2 rounded-full bg-white px-2 shadow" onClick={() => setFiles(xs => xs.filter((_,j) => j !== i))} aria-label="Remove selected file">×</button></div>)}</div><button type="button" className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50 sm:col-span-2" disabled={busy} onClick={() => inspect(false)}>{busy ? 'Saving inspection…' : 'Save inspection attempt'}</button></div>}
      {detail.request.state === 'ACCEPTED_PENDING_CONFIRMATION' && <div className="mt-5 space-y-3"><label className="block text-sm">Destination/current allocated Cell<select className={field} value={cellId} onChange={e => setCellId(e.target.value)}><option value="">Select allocated Cell</option>{(detail.cells || []).filter(c => detail.item.status !== 'IN_STORAGE' || String(c._id) === String(detail.item.currentCellId)).map(c => <option key={c._id} value={c._id}>{c.code}</option>)}</select></label><button type="button" className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || cellId.length !== 24} onClick={confirm}>{busy ? 'Confirming…' : 'Confirm physical receipt'}</button></div>}
      {detail.request.state === 'RETURN_PENDING' && <div className="mt-5 space-y-2"><label className="block text-sm">Return handover evidence / note<textarea className={field} maxLength={1000} value={returnNote} onChange={e => setReturnNote(e.target.value)}/></label><button className="rounded border px-4 py-2" disabled={busy || !returnNote.trim()} onClick={completeReturn}>Record goods returned to Customer</button></div>}
    </>}</section></div>
  </div>;
}
