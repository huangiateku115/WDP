import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import warehouseMapApi from '@/api/warehouseMapApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const field = 'mt-1 w-full rounded border border-slate-300 p-2';
const message = error => error?.response?.data?.message || error?.message || 'Relocation is unavailable.';
const data = response => response?.data?.data;

export default function CanonicalRelocationPage() {
  const session = useAuthSession();
  const [itemId, setItemId] = useState('');
  const [context, setContext] = useState(null);
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [packing, setPacking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [movementId, setMovementId] = useState('');
  const operationKey = useRef(null);
  const operationPayload = useRef(null);
  const storageKeyFor = (id, actorId) => `wdp:mi06:relocate:${actorId || 'unknown'}:${id}`;

  const load = useCallback(async (id = itemId) => {
    if (!/^[a-f\d]{24}$/i.test(id)) { setError('Enter a valid inventory Item ID.'); return; }
    setBusy(true); setError(''); setNotice('');
    const token = getAccessToken();
    try {
      const response = await inventoryApi.canonicalRelocationContext(id);
      if (token !== getAccessToken()) return;
      const nextContext = data(response); setContext(nextContext); setDestination('');
      const storageKey = storageKeyFor(id, session.user?.id);
      const saved = sessionStorage.getItem(storageKey);
      try {
        const operation = saved ? JSON.parse(saved) : null;
        operationKey.current = operation?.key || null;
        operationPayload.current = operation?.payload || null;
        if (operation?.payload) {
          setDestination(operation.payload.destinationCellId);
          setNote(operation.payload.relocationNote || '');
          setPacking(operation.payload.physicalPackingConfirmed === true);
          setError('A prior relocation result may be uncertain. Retry the saved operation exactly or refresh placement before starting another move.');
        }
      } catch { operationKey.current = null; operationPayload.current = null; }
    } catch (e) { if (token === getAccessToken()) { setContext(null); setError(message(e)); } }
    finally { if (token === getAccessToken()) setBusy(false); }
  }, [itemId]);

  useEffect(() => { setContext(null); setError(''); setNotice(''); setBusy(false); operationKey.current = null; operationPayload.current = null; }, [session.accessToken]);

  const submit = async () => {
    if (!context || busy || !destination || !packing || !note.trim()) return;
    setBusy(true); setError(''); setNotice('');
    const token = getAccessToken(), storageKey = storageKeyFor(context.item._id, session.user?.id);
    const key = operationKey.current || newKey();
    const payload = operationPayload.current || {
      sourceCellId: context.currentCellId, destinationCellId: destination,
      physicalPackingConfirmed: true, relocationNote: note.trim(),
    };
    operationKey.current = key; operationPayload.current = payload;
    sessionStorage.setItem(storageKey, JSON.stringify({ key, payload }));
    try {
      const result = data(await inventoryApi.relocateCanonical(context.item._id, payload, key));
      if (token !== getAccessToken()) return;
      operationKey.current = null; operationPayload.current = null; sessionStorage.removeItem(storageKey);
      const successMessage = result?.idempotentReplay ? 'The previously committed relocation was restored.' : 'Stock was relocated. Quantity and holds are unchanged.';
      setMovementId(result?.movementId || result?.movement?._id || '');
      setNote(''); setPacking(false);
      await load(context.item._id);
      // Refresh placement, balance, movement history, map and Facility request queues after MOVE.
      const refreshResults = await Promise.allSettled([
        inventoryApi.get(context.item._id), inventoryApi.stockBalance(context.item._id), inventoryApi.movements(context.item._id),
        warehouseMapApi.getWarehouseMap(context.item.facilityId), inventoryApi.repeatedInboundQueue({ page: 1, limit: 50 }),
        ...['PENDING', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'CANCELLED'].map(state => inventoryApi.canonicalOutboundStaffQueue({ state, page: 1, limit: 50 })),
      ]);
      if (token === getAccessToken()) {
        setNotice(successMessage);
        if (refreshResults.some(result => result.status === 'rejected')) setError('Relocation committed, but one or more follow-up views could not refresh. Use Refresh placement, stock and allocations.');
      }
    } catch (e) {
      if (token !== getAccessToken()) return;
      setError(message(e));
      const status = e?.response?.status;
      if (status && status < 500) { operationKey.current = null; operationPayload.current = null; sessionStorage.removeItem(storageKey); await load(context.item._id); setError(message(e)); }
      else setError('The relocation result is uncertain. Retry the saved operation exactly, or refresh placement and movement history before any other change.');
    } finally { if (token === getAccessToken()) setBusy(false); }
  };

  return <main className="space-y-5 p-5" aria-label="Canonical inventory relocation">
    <header><h1 className="text-2xl font-bold">Managed Inventory relocation</h1><p className="mt-1 text-sm text-slate-600">Move positive stock within its active reservation. The Backend verifies allocation, movement lineage, holds, geometry and capacity before committing.</p></header>
    <form className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4" onSubmit={e => { e.preventDefault(); load(); }}>
      <label className="min-w-72 flex-1 text-sm">Inventory Item ID<input className={field} value={itemId} onChange={e => setItemId(e.target.value.trim())} required /></label>
      <button className="rounded border px-4 py-2" disabled={busy}>{busy ? 'Loading…' : 'Load relocation context'}</button>
    </form>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    {movementId && <p className="text-xs text-slate-500">Committed MOVE movement: {movementId}</p>}
    {context && <section className="space-y-4 rounded-lg border bg-white p-5">
      <div><h2 className="text-xl font-bold">{context.item.itemCode} · {context.item.name}</h2><p className="mt-1 text-sm">Source Cell {context.currentCellId} · Current {context.stock.currentQty} · Held {context.stock.heldQty} · Available {context.stock.availableQty}</p></div>
      <label className="block text-sm">Allocated destination Cell<select className={field} value={destination} disabled={!!operationKey.current} onChange={e => setDestination(e.target.value)}><option value="">Choose an active allocated Cell</option>{context.cells.filter(cell => !cell.isCurrent).map(cell => <option key={cell._id} value={cell._id}>{cell.code} · {cell.allocationStatus} · used {cell.usedWeightKg} kg / {cell.usedVolumeM3} m³</option>)}</select></label>
      <p className="text-xs text-slate-500">A listed allocation does not guarantee physical fit. Capacity and placement are revalidated by the Backend at commit time.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={packing} disabled={!!operationKey.current} onChange={e => setPacking(e.target.checked)} />Physical packing and safe movement confirmed</label>
      <label className="block text-sm">Relocation note<textarea className={field} maxLength={1000} value={note} disabled={!!operationKey.current} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !!operationKey.current || !destination || !packing || !note.trim()} onClick={submit}>{busy ? 'Committing…' : 'Confirm relocation'}</button><button className="rounded border px-4 py-2" disabled={busy} onClick={() => load(context.item._id)}>Refresh placement, stock and allocations</button>{operationKey.current && <button className="rounded border px-4 py-2" disabled={busy} onClick={submit}>Retry same relocation</button>}</div>
    </section>}
  </main>;
}
