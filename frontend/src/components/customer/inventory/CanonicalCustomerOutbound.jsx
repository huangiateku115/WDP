import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import { getAccessToken, useAuthSession } from '@/lib/authSession';
import { CustomerOutboundAction } from './CustomerOutbound';
import { validInventoryId,inventoryId } from '@/lib/inventoryRegistration';

const newKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const idKey = itemId => `wdp:mi06:outbound:create:${itemId}`;
const payloadKey = itemId => `${idKey(itemId)}:payload`;
const cancelKey = requestId => `wdp:mi06:outbound:cancel:${requestId}`;
const errorText = error => error?.response?.data?.message || error?.message || 'The request could not be completed.';
const payloadData = response => {if(response?.data?.success!==true)throw Error('The Backend response envelope is invalid.');return response.data.data;};
export function verifiedStock(value,item){
  const integer=n=>Number.isSafeInteger(n)&&n>=0;
  if(!value||![item._id,inventoryId(item.customerId),inventoryId(item.managedReservationId),inventoryId(item.facilityId)].every(validInventoryId)||typeof item.quantityUnit!=='string'||!item.quantityUnit.trim()||inventoryId(value.itemId)!==item._id||inventoryId(value.customerId)!==inventoryId(item.customerId)||inventoryId(value.managedReservationId)!==inventoryId(item.managedReservationId)||inventoryId(value.facilityId)!==inventoryId(item.facilityId)||!integer(value.onHandQuantity)||!integer(value.heldQuantity)||value.heldQuantity>value.onHandQuantity||!['LEDGER_V2','LEGACY_RECONCILED'].includes(value.source)||!Array.isArray(value.batches))throw Error('Canonical stock could not be verified. Availability is unknown.');
  let total=0,held=0;const ids=new Set();
  for(const batch of value.batches){
    if(typeof batch.batchId!=='string'||!batch.batchId||ids.has(batch.batchId)||!validInventoryId(inventoryId(batch.receiptMovementId))||!integer(batch.quantity)||batch.quantity===0||!integer(batch.heldQuantity)||batch.heldQuantity>batch.quantity||batch.quantityUnit!==item.quantityUnit)throw Error('Stock batch quantities or units did not reconcile.');
    ids.add(batch.batchId);total+=batch.quantity;held+=batch.heldQuantity;
  }
  if(total!==value.onHandQuantity||held!==value.heldQuantity||!Number.isSafeInteger(total)||!Number.isSafeInteger(held)||(value.onHandQuantity>0&&inventoryId(value.currentCellId)!==inventoryId(item.currentCellId)))throw Error('Stock batches and current placement did not reconcile.');
  return value;
}
export function verifiedOutbound(value,item){
  if(!validInventoryId(value?._id)||value.itemId!==item._id||value.reservationId!==inventoryId(item.managedReservationId)||value.facilityId!==inventoryId(item.facilityId)||!['PENDING','CONFIRMED','PARTIALLY_FULFILLED','CANCELLED'].includes(value.state)||!Number.isSafeInteger(value.version)||value.version<0||!Number.isSafeInteger(value.requestedQuantity)||value.requestedQuantity<=0||!Number.isSafeInteger(value.heldQuantity)||value.heldQuantity!==(value.state==='PENDING'?value.requestedQuantity:0)||value.quantityUnit!==item.quantityUnit)throw Error('Outbound request identity, quantity or version could not be verified.');
  return value;
}
export function canonicalEligible(item,rental,user,now=Date.now()){
  return user?.role==='CUSTOMER'&&inventoryId(user)===inventoryId(item.customerId)&&item.status==='IN_STORAGE'&&validInventoryId(inventoryId(item.currentCellId))&&rental?.serviceType==='MANAGED_INVENTORY'&&inventoryId(rental)===inventoryId(item.managedReservationId)&&inventoryId(rental.facilityId)===inventoryId(item.facilityId)&&rental.status==='ACTIVE'&&Date.parse(rental.startDate)<=now&&Date.parse(rental.endDate)>now;
}

export default function CanonicalCustomerOutbound({ item, rental, loading, onRefresh }) {
  if (!validInventoryId(item?._id)) return null;
  return <LoadedCanonicalCustomerOutbound key={item._id} item={item} rental={rental} loading={loading} onRefresh={onRefresh}/>;
}

function LoadedCanonicalCustomerOutbound({ item, rental, loading, onRefresh }) {
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
  const operationBusy=useRef(false),readSequence=useRef(0);
  const [reading,setReading]=useState(false),[page,setPage]=useState(1),[pagination,setPagination]=useState(null);

  const refresh = async (signal,targetPage=page) => {
    const sequence=++readSequence.current;
    setReading(true);setBalance(null);setRows([]);
    const token = getAccessToken();
    const movementResponse = await inventoryApi.movements(item._id, { signal });
    if (!alive.current || token !== getAccessToken()||sequence!==readSequence.current) return;
    const movementRows = movementResponse?.data?.data;
    if (!Array.isArray(movementRows)) throw new Error('The movement history response is invalid.');
    const isCanonical = movementRows.some(m => m?.schemaVersion === 2 || m?.arithmeticPolicy === 'CANONICAL_V1');
    setMode(isCanonical ? 'canonical' : 'legacy');
    if (!isCanonical) {
      try{const response=await inventoryApi.stockBalance(item._id,{signal});if(alive.current&&token===getAccessToken()&&sequence===readSequence.current)setBalance(verifiedStock(payloadData(response),item));}
      catch(e){if(alive.current&&token===getAccessToken()&&sequence===readSequence.current)setError(e?.response?.status===404?'No stock ledger has been initialized. Physical availability is unknown.':errorText(e));}
      if(sequence===readSequence.current)setReading(false);return;
    }
    const [balanceResponse, historyResponse] = await Promise.all([
      inventoryApi.stockBalance(item._id, { signal }),
      inventoryApi.canonicalOutboundHistory(item._id, { page: targetPage, limit: 50 }, { signal }),
    ]);
    if (!alive.current || token !== getAccessToken()||sequence!==readSequence.current) return;
    const nextBalance = payloadData(balanceResponse);
    const history = payloadData(historyResponse);
    verifiedStock(nextBalance,item);
    if (!Array.isArray(history?.data)||!history.pagination||!Number.isSafeInteger(history.pagination.page)||history.pagination.page<1||!Number.isSafeInteger(history.pagination.totalPages)||history.pagination.totalPages<0) {
      throw new Error('Canonical stock or outbound history did not reconcile. Refresh before continuing.');
    }
    history.data.forEach(row=>verifiedOutbound(row,item));
    if(detail)setDetail(history.data.find(row=>row._id===detail._id)||null);
    setBalance(nextBalance);setRows(history.data);setPagination(history.pagination);setPage(targetPage);setReading(false);
  };

  useEffect(() => {
    alive.current = true;
    setBusy(false); setError(''); setNotice(''); setDetail(null);
    try{createKey.current = sessionStorage.getItem(idKey(item._id));}catch{setMode('error');setError('Safe operation storage is unavailable. No outbound request can be submitted.');return;}
    try { createPayload.current = JSON.parse(sessionStorage.getItem(payloadKey(item._id)) || 'null'); } catch { createPayload.current = null; }
    if(createKey.current&&(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(createKey.current)||!Number.isSafeInteger(createPayload.current?.requestedQuantity)||createPayload.current.requestedQuantity<=0||Object.keys(createPayload.current).length!==1)){setMode('error');setError('Saved outbound operation cannot be verified. Do not start another request; reconcile its history first.');return;}
    if (createPayload.current?.requestedQuantity) setQuantity(String(createPayload.current.requestedQuantity));
    const controller = new AbortController();
    refresh(controller.signal).catch(e => {
      if (!controller.signal.aborted && getAccessToken() === session.accessToken) {
        setMode('error'); setError(errorText(e));
      }
    });
    return () => { alive.current = false;readSequence.current++; controller.abort(); };
  }, [item._id, session.accessToken]);

  if (mode === 'loading') return <p role="status" className="mt-4 text-sm text-slate-600">Checking stock ledger and outbound history…</p>;
  if (mode === 'legacy') return <section aria-label="Legacy stock and outbound" className="mt-4 space-y-3"><p className="text-sm">Registered quantity (metadata): {item.quantity??'Not returned'} {item.quantityUnit}</p>{reading?<p role="status">Loading stock balance…</p>:balance?<dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3"><div><dt>On hand</dt><dd>{balance.onHandQuantity} {item.quantityUnit}</dd></div><div><dt>Held</dt><dd>{balance.heldQuantity} {item.quantityUnit}</dd></div><div><dt>Available</dt><dd>{balance.onHandQuantity-balance.heldQuantity} {item.quantityUnit}</dd></div></dl>:<p role="status">Physical stock unavailable. Registered quantity is not a stock balance.</p>}{balance&&<p className="text-xs">Stock source: {balance.source}</p>}{error&&<p role="note" className="text-sm text-orange-800">{error}</p>}<CustomerOutboundAction item={item} rental={rental} loading={loading||reading} onRefresh={onRefresh} /></section>;
  if (mode === 'error') return <section aria-label="Canonical outbound" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><p role="alert">{error}</p><button className="mt-3 rounded border px-3 py-2" onClick={() => { setMode('loading'); refresh().catch(e => { setMode('error'); setError(errorText(e)); }); }}>Retry stock read</button></section>;

  const runRefresh = async () => {
    try { await refresh(); }
    catch (e) { setError(errorText(e)); }
    // Holds/cancellations do not change physical Item stock. Re-fetch these two
    // resources locally so a parent Item reload cannot erase conflict/retry state.
  };
  const available=balance?balance.onHandQuantity-balance.heldQuantity:null;
  const owner=!!session.accessToken&&session.user?.role==='CUSTOMER'&&inventoryId(session.user)===inventoryId(item.customerId);
  const eligible=canonicalEligible(item,rental,session.user)&&!loading&&import.meta.env?.PROD!==true;
  const validQuantity=Number.isSafeInteger(Number(quantity))&&Number(quantity)>0&&available!==null&&Number(quantity)<=available;
  const create = async retry => {
    if (!owner||operationBusy.current||busy||(!retry&&(!eligible||reading||!validQuantity||(balance?.heldQuantity>0||rows.some(row=>row.state==='PENDING'))))||retry&&(!createKey.current||!createPayload.current)) return;
    operationBusy.current=true;
    setBusy(true); setError(''); setNotice('');
    const token = getAccessToken();
    const key = retry ? createKey.current : (createKey.current || newKey());
    const operationPayload = createKey.current && createPayload.current ? createPayload.current : { requestedQuantity: Number(quantity) };
    createKey.current = key; createPayload.current = operationPayload;
    try {
      sessionStorage.setItem(idKey(item._id), key); sessionStorage.setItem(payloadKey(item._id), JSON.stringify(operationPayload));
      const response = await inventoryApi.createCanonicalOutbound(item._id, operationPayload, key);
      if (token !== getAccessToken()) return;
      const result = verifiedOutbound(payloadData(response),item);
      if(result.requestedQuantity!==operationPayload.requestedQuantity)throw Error('Returned outbound quantity does not match the saved request.');
      createKey.current = null; createPayload.current = null; sessionStorage.removeItem(idKey(item._id)); sessionStorage.removeItem(payloadKey(item._id)); setQuantity('');
      setNotice(response.status === 200 ? 'Existing outbound request restored from its idempotent result.' : 'Outbound quantity reserved. Staff must confirm handover.');
      if (result?._id) setDetail(result);
      await runRefresh();
    } catch (e) {
      if (token !== getAccessToken()) return;
      setError(errorText(e));
      const status = e?.response?.status;
      if(e?.response?.data?.code==='OUTBOUND_REQUEST_FEATURE_DISABLED'){
        setError('Canonical outbound creation is disabled by Backend configuration. No legacy mutation was attempted. The saved key is retained for the same request only.');
      }else if (!status || status >= 500) {
        setError('The server result is uncertain. Retry the same request with the saved quantity, or refresh history before starting another request.');
      } else { createKey.current = null; createPayload.current = null; sessionStorage.removeItem(idKey(item._id)); sessionStorage.removeItem(payloadKey(item._id)); await runRefresh(); }
    } finally { operationBusy.current=false;if (alive.current&&token === getAccessToken()) setBusy(false); }
  };
  const cancel = async row => {
    if (!owner||operationBusy.current||busy||reading||row.state!=='PENDING'||!Number.isSafeInteger(row.version)||row.version<0) return;
    operationBusy.current=true;
    setBusy(true); setError(''); setNotice('');
    const token = getAccessToken(), storageKey = cancelKey(row._id);
    let savedOperation = null;
    try { savedOperation = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { savedOperation = null; }
    const key = savedOperation?.key || newKey();
    const expectedVersion = Number.isSafeInteger(savedOperation?.version) ? savedOperation.version : row.version;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ key, version: expectedVersion }));
      const result=verifiedOutbound(payloadData(await inventoryApi.cancelCanonicalOutbound(row._id, expectedVersion, key)),item);
      if(result._id!==row._id||result.state!=='CANCELLED')throw Error('Cancellation response is uncertain. Refresh before retrying.');
      if (token !== getAccessToken()) return;
      sessionStorage.removeItem(storageKey); setNotice('Outbound hold released.'); await runRefresh();
    } catch (e) {
      if (token !== getAccessToken()) return;
      setError([409,428].includes(e?.response?.status)?`${errorText(e)} Request version changed. Refresh and review the latest state; no version is overwritten.`:errorText(e));
      const status = e?.response?.status;
      if (status && status < 500) sessionStorage.removeItem(storageKey);
      else setError('The cancellation result is uncertain. Retry the saved cancellation or check request history before acting again.');
      await runRefresh();
    } finally {operationBusy.current=false; if (alive.current&&token === getAccessToken()) setBusy(false); }
  };
  const showDetail = async row => {
    if(operationBusy.current)return;operationBusy.current=true;setBusy(true); setError('');
    try { const response = await inventoryApi.canonicalOutboundDetail(row._id); if (alive.current&&getAccessToken() === session.accessToken){const result=verifiedOutbound(payloadData(response),item);if(result._id!==row._id)throw Error('Outbound detail does not match this request.');setDetail(result);} }
    catch (e) { if (getAccessToken() === session.accessToken) setError(errorText(e)); }
    finally {operationBusy.current=false; if (alive.current&&getAccessToken() === session.accessToken) setBusy(false); }
  };

  return <section aria-label="Canonical outbound" className="mt-5 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-bold">Partial outbound</h2>
    <p className="mt-1 text-sm text-slate-600">Stock is reconciled from the immutable movement ledger. Registered quantity is not a stock limit.</p>
    <p className="mt-2 text-sm">Registered quantity (metadata): {item.quantity ?? 'Not returned'} {item.quantityUnit} · Item status: {item.status}</p>
    {reading&&<p role="status" className="mt-2 text-sm">Refreshing verified stock…</p>}
    {balance ? <><dl className="my-4 grid grid-cols-1 gap-3 rounded bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><dt>On hand</dt><dd className="font-semibold">{balance.onHandQuantity} {item.quantityUnit}</dd></div><div><dt>Held</dt><dd className="font-semibold">{balance.heldQuantity} {item.quantityUnit}</dd></div><div><dt>Available</dt><dd className="font-semibold">{available} {item.quantityUnit}</dd></div></dl>
      <p className="text-xs text-slate-600">Stock source: {balance.source} · {balance.onHandQuantity===0?'Empty physical stock':'Physical stock on hand'}</p>
      {balance.batches.length>0&&<details className="my-3 text-sm"><summary className="cursor-pointer">Receipt batches ({balance.batches.length})</summary><ul className="mt-2 space-y-2">{balance.batches.map(batch=><li key={batch.batchId} className="break-words rounded border p-2">{batch.batchId} · {batch.quantity} {batch.quantityUnit} on hand · {batch.heldQuantity} held<br/><span className="break-all text-xs">Receipt {inventoryId(batch.receiptMovementId)}</span></li>)}</ul></details>}
    </>:<p role="status" className="my-3 text-sm text-orange-800">Stock unavailable. Availability is unknown; registered quantity is not used as a substitute.</p>}
    {!eligible&&<p className="my-2 text-sm text-orange-800">New outbound requests require your IN_STORAGE item and an in-term ACTIVE Managed reservation. Canonical creation is unavailable in production; Backend feature gates and allocation checks still apply.</p>}
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 text-sm">Quantity to withdraw<input aria-label="Quantity to withdraw" className="mt-1 block w-full max-w-full rounded border p-2" type="number" min="1" step="1" max={available??undefined} value={quantity} disabled={busy || !!createKey.current} onChange={e => setQuantity(e.target.value)} /></label><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy||reading||!!createKey.current||!eligible||!validQuantity||!!balance?.heldQuantity} onClick={() => create(false)}>{busy ? 'Submitting…' : 'Request outbound'}</button>{createKey.current && <button className="rounded border px-3 py-2" disabled={busy||!owner||!createPayload.current} onClick={() => create(true)}>Retry same request</button>}<button className="rounded border px-3 py-2" disabled={busy} onClick={()=>{setError('');runRefresh();}}>Refresh stock</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    <h3 className="mt-5 font-semibold">Outbound history</h3>
    {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">No canonical outbound requests.</p> : <ul className="mt-2 space-y-2">{rows.map(row => <li key={row._id} className="rounded border p-3"><div className="flex flex-wrap justify-between gap-2"><b>{row.requestedQuantity} {row.quantityUnit} · {row.state}</b><span className="text-xs">Held {row.heldQuantity}</span></div><p className="mt-1 text-xs text-slate-500">Version {row.version}</p><div className="mt-2 flex gap-2"><button className="rounded border px-3 py-1" disabled={busy} onClick={() => showDetail(row)}>Details</button>{row.state === 'PENDING' && <button className="rounded border px-3 py-1" disabled={busy||!owner} onClick={() => cancel(row)}>Cancel and release hold</button>}</div></li>)}</ul>}
    {pagination&&pagination.totalPages>1&&<nav aria-label="Outbound history pages" className="mt-3 flex flex-wrap items-center gap-3"><button disabled={busy||reading||page<=1} onClick={()=>refresh(undefined,page-1).catch(e=>setError(errorText(e)))}>Previous requests</button><span>Page {page} of {pagination.totalPages}</span><button disabled={busy||reading||page>=pagination.totalPages} onClick={()=>refresh(undefined,page+1).catch(e=>setError(errorText(e)))}>Next requests</button></nav>}
    {detail && <article className="mt-4 rounded border bg-slate-50 p-3"><h3 className="font-semibold">Request detail · {detail.state}</h3><p className="mt-1 text-sm">Requested {detail.requestedQuantity} · held {detail.heldQuantity} · confirmed {Number.isSafeInteger(detail.confirmedQuantity)?detail.confirmedQuantity:'Not returned'}</p>{detail.confirmedMovementId && <p className="mt-1 break-all text-xs">REMOVE movement {inventoryId(detail.confirmedMovementId)}</p>}</article>}
  </section>;
}
