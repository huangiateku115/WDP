import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';
import { CustomerOutboundAction } from './CustomerOutbound';

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const idKey = itemId => `wdp:mi06:outbound:create:${itemId}`;
const payloadKey = itemId => `${idKey(itemId)}:payload`;
const cancelKey = requestId => `wdp:mi06:outbound:cancel:${requestId}`;
const errorText = error => error?.response?.data?.message || error?.message || 'The request could not be completed.';
const payloadData = response => response?.data?.data;

export default function CanonicalCustomerOutbound({ item, rental, loading, onRefresh }) {
  const session = useAuthSession();
  const [mode, setMode] = useState('loading');
  const [balance, setBalance] = useState(null);
  const [rows, setRows] = useState([]);
  const [quantity, setQuantity] = useState('');
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const createKey = useRef(null);
  const createPayload = useRef(null);
  const alive = useRef(false);

  const refresh = async signal => {
    const token = getAccessToken();
    const movementResponse = await inventoryApi.movements(item._id, { signal });
    if (!alive.current || token !== getAccessToken()) return;
    const movementRows = movementResponse?.data?.data;
    if (!Array.isArray(movementRows)) throw new Error('The movement history response is invalid.');
    const isCanonical = movementRows.some(m => m?.schemaVersion === 2 || m?.arithmeticPolicy === 'CANONICAL_V1');
    setMode(isCanonical ? 'canonical' : 'legacy');
    if (!isCanonical) return;
    const [balanceResponse, historyResponse] = await Promise.all([
      inventoryApi.stockBalance(item._id, { signal }),
      inventoryApi.canonicalOutboundHistory(item._id, { page: 1, limit: 50 }, { signal }),
    ]);
    if (!alive.current || token !== getAccessToken()) return;
    const nextBalance = payloadData(balanceResponse);
    const history = payloadData(historyResponse);
    if (!nextBalance || !Number.isSafeInteger(nextBalance.onHandQuantity) || !Number.isSafeInteger(nextBalance.heldQuantity) ||
        nextBalance.heldQuantity > nextBalance.onHandQuantity || !Array.isArray(history?.data)) {
      throw new Error('Canonical stock or outbound history did not reconcile. Refresh before continuing.');
    }
    setBalance(nextBalance);
    setRows(history.data);
  };

  useEffect(() => {
    alive.current = true;
    setBusy(false); setError(''); setNotice(''); setDetail(null);
    createKey.current = sessionStorage.getItem(idKey(item._id));
    try { createPayload.current = JSON.parse(sessionStorage.getItem(payloadKey(item._id)) || 'null'); } catch { createPayload.current = null; }
    if (createPayload.current?.requestedQuantity) setQuantity(String(createPayload.current.requestedQuantity));
    const controller = new AbortController();
    refresh(controller.signal).catch(e => {
      if (!controller.signal.aborted && getAccessToken() === session.accessToken) {
        setMode('error'); setError(errorText(e));
      }
    });
    return () => { alive.current = false; controller.abort(); };
  }, [item._id, session.accessToken]);

  if (mode === 'loading') return <p role="status" className="mt-4 text-sm text-slate-600">Checking stock ledger and outbound history…</p>;
  if (mode === 'legacy') return <CustomerOutboundAction item={item} rental={rental} loading={loading} onRefresh={onRefresh} />;
  if (mode === 'error') return <section aria-label="Canonical outbound" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><p role="alert">{error}</p><button className="mt-3 rounded border px-3 py-2" onClick={() => { setMode('loading'); refresh().catch(e => { setMode('error'); setError(errorText(e)); }); }}>Retry stock read</button></section>;

  const runRefresh = async () => {
    try { await refresh(); setError(''); }
    catch (e) { setError(errorText(e)); }
    onRefresh?.();
  };
  const create = async retry => {
    if (busy || !Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) return;
    setBusy(true); setError(''); setNotice('');
    const token = getAccessToken();
    const key = retry ? createKey.current : (createKey.current || newKey());
    const operationPayload = createKey.current && createPayload.current ? createPayload.current : { requestedQuantity: Number(quantity) };
    createKey.current = key; createPayload.current = operationPayload;
    sessionStorage.setItem(idKey(item._id), key); sessionStorage.setItem(payloadKey(item._id), JSON.stringify(operationPayload));
    try {
      const response = await inventoryApi.createCanonicalOutbound(item._id, operationPayload, key);
      if (token !== getAccessToken()) return;
      const result = payloadData(response);
      createKey.current = null; createPayload.current = null; sessionStorage.removeItem(idKey(item._id)); sessionStorage.removeItem(payloadKey(item._id)); setQuantity('');
      setNotice(response.status === 200 ? 'Existing outbound request restored from its idempotent result.' : 'Outbound quantity reserved. Staff must confirm handover.');
      if (result?._id) setDetail(result);
      await runRefresh();
    } catch (e) {
      if (token !== getAccessToken()) return;
      setError(errorText(e));
      const status = e?.response?.status;
      if (!status || status >= 500) {
        setError('The server result is uncertain. Retry the same request with the saved quantity, or refresh history before starting another request.');
      } else { createKey.current = null; createPayload.current = null; sessionStorage.removeItem(idKey(item._id)); sessionStorage.removeItem(payloadKey(item._id)); await runRefresh(); }
    } finally { if (token === getAccessToken()) setBusy(false); }
  };
  const cancel = async row => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    const token = getAccessToken(), storageKey = cancelKey(row._id);
    let savedOperation = null;
    try { savedOperation = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { savedOperation = null; }
    const key = savedOperation?.key || newKey();
    const expectedVersion = Number.isSafeInteger(savedOperation?.version) ? savedOperation.version : row.version;
    sessionStorage.setItem(storageKey, JSON.stringify({ key, version: expectedVersion }));
    try {
      await inventoryApi.cancelCanonicalOutbound(row._id, expectedVersion, key);
      if (token !== getAccessToken()) return;
      sessionStorage.removeItem(storageKey); setNotice('Outbound hold released.'); await runRefresh();
    } catch (e) {
      if (token !== getAccessToken()) return;
      setError(errorText(e));
      const status = e?.response?.status;
      if (status && status < 500) sessionStorage.removeItem(storageKey);
      else setError('The cancellation result is uncertain. Retry the saved cancellation or check request history before acting again.');
      await runRefresh();
    } finally { if (token === getAccessToken()) setBusy(false); }
  };
  const showDetail = async row => {
    setBusy(true); setError('');
    try { const response = await inventoryApi.canonicalOutboundDetail(row._id); if (getAccessToken() === session.accessToken) setDetail(payloadData(response)); }
    catch (e) { if (getAccessToken() === session.accessToken) setError(errorText(e)); }
    finally { if (getAccessToken() === session.accessToken) setBusy(false); }
  };

  return <section aria-label="Canonical outbound" className="mt-5 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-bold">Partial outbound</h2>
    <p className="mt-1 text-sm text-slate-600">Stock is reconciled from the immutable movement ledger. Registered quantity is not a stock limit.</p>
    {balance && <dl className="my-4 grid grid-cols-3 gap-3 rounded bg-slate-50 p-3 text-sm"><div><dt>Current</dt><dd className="font-semibold">{balance.onHandQuantity} {item.quantityUnit}</dd></div><div><dt>Held</dt><dd className="font-semibold">{balance.heldQuantity} {item.quantityUnit}</dd></div><div><dt>Available</dt><dd className="font-semibold">{balance.onHandQuantity - balance.heldQuantity} {item.quantityUnit}</dd></div></dl>}
    <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Quantity to withdraw<input className="mt-1 block rounded border p-2" type="number" min="1" step="1" max={balance?.onHandQuantity - balance?.heldQuantity} value={quantity} disabled={busy || !!createKey.current} onChange={e => setQuantity(e.target.value)} /></label><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !!createKey.current || !quantity || !balance?.onHandQuantity} onClick={() => create(false)}>{busy ? 'Submitting…' : 'Request outbound'}</button>{createKey.current && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => create(true)}>Retry same request</button>}<button className="rounded border px-3 py-2" disabled={busy} onClick={runRefresh}>Refresh stock</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    <h3 className="mt-5 font-semibold">Outbound history</h3>
    {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">No canonical outbound requests.</p> : <ul className="mt-2 space-y-2">{rows.map(row => <li key={row._id} className="rounded border p-3"><div className="flex flex-wrap justify-between gap-2"><b>{row.requestedQuantity} {row.quantityUnit} · {row.state}</b><span className="text-xs">Held {row.heldQuantity}</span></div><p className="mt-1 text-xs text-slate-500">Version {row.version}</p><div className="mt-2 flex gap-2"><button className="rounded border px-3 py-1" disabled={busy} onClick={() => showDetail(row)}>Details</button>{row.state === 'PENDING' && <button className="rounded border px-3 py-1" disabled={busy} onClick={() => cancel(row)}>Cancel and release hold</button>}</div></li>)}</ul>}
    {detail && <article className="mt-4 rounded border bg-slate-50 p-3"><h3 className="font-semibold">Request detail · {detail.state}</h3><p className="mt-1 text-sm">Requested {detail.requestedQuantity} · held {detail.heldQuantity} · confirmed {detail.confirmedQuantity || 0}</p>{detail.confirmedMovementId && <p className="mt-1 break-all text-xs">REMOVE movement {detail.confirmedMovementId}</p>}</article>}
  </section>;
}
