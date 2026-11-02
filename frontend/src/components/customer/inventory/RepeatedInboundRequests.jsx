import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from './InventoryBackendUI';
import { getAccessToken, useAuthSession } from '@/lib/authSession';

import {receiptStates as states,unresolvedReceiptStates,receiptPayload,receiptList,receiptResponse,mayChangeReceipt,eligibleRepeatedReceipt} from '@/lib/customerRepeatedInbound';
import {inventoryId,validInventoryId} from '@/lib/inventoryRegistration';
import {reservationVietnamTime} from '@/lib/customerReservationDisplay';
const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const message = error => error?.response?.data?.message || error?.message || 'Request failed.';

export default function RepeatedInboundRequests({ item,rental,loading }) {
  const session = useAuthSession();
  if(!validInventoryId(item?._id))return null;
  return <Requests rental={rental} parentLoading={loading} key={`${session.accessToken}:${item._id}`} item={item}/>;
}
function Requests({ item,rental,parentLoading }) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [quantity, setQuantity] = useState('1'), [weight, setWeight] = useState(String(item.unitWeightKg || ''));
  const [width, setWidth] = useState(String(item.unitDimensionsM?.widthM || '')), [depth, setDepth] = useState(String(item.unitDimensionsM?.depthM || '')), [height, setHeight] = useState(String(item.unitDimensionsM?.heightM || ''));
  const [pending, setPending] = useState(false), [editing, setEditing] = useState(null), [detail, setDetail] = useState(null), busy = useRef(false), pendingKey = useRef(null), pendingPayload = useRef(null), tokenAtStart = useRef(null);
  const session=useAuthSession();
  const [page,setPage]=useState(1),[pagination,setPagination]=useState(null),[readError,setReadError]=useState(''),[gateBlocked,setGateBlocked]=useState(false),[storageBlocked,setStorageBlocked]=useState(false);
  const operation=useRef(null),alive=useRef(false),readSequence=useRef(0),loaded=useRef(false);
  const operationKey=`wdp:receipt-operation:${inventoryId(session.user)}:${item._id}`;
  const current=token=>alive.current&&getAccessToken()===token;
  const fill=row=>{setQuantity(String(row.requestedQuantity));setWeight(String(row.declaredUnitWeightKg));setWidth(String(row.declaredUnitDimensionsM.widthM));setDepth(String(row.declaredUnitDimensionsM.depthM));setHeight(String(row.declaredUnitDimensionsM.heightM));};
  const refresh = async (targetPage=page) => {
    const token=getAccessToken(),sequence=++readSequence.current;setLoading(true);setReadError('');setRows([]);
    try{
      const response=await inventoryApi.repeatedInboundHistory(item._id,{page:targetPage,limit:50});
      if(!current(token)||sequence!==readSequence.current)return;
      const result=receiptList(response,item,targetPage);loaded.current=true;setRows(result.rows);setPagination(result.pagination);setPage(targetPage);
      if(detail)setDetail(result.rows.find(row=>row._id===detail._id)||null);
    }catch(e){if(current(token)&&sequence===readSequence.current){loaded.current=false;setReadError(message(e));}}
    finally{if(current(token)&&sequence===readSequence.current)setLoading(false);}
  };
  useEffect(()=>{
    alive.current=true;
    try{
      const saved=JSON.parse(sessionStorage.getItem(operationKey)||'null');
      if(saved){
        if(!['CREATE','AMEND','CANCEL'].includes(saved.kind)||!(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/).test(saved.key)||saved.kind!=='CREATE'&&(!validInventoryId(saved.requestId)||!Number.isSafeInteger(saved.version)||saved.version<0))throw Error('Saved receipt operation could not be verified. Reconcile history before starting another operation.');
        if(saved.kind!=='CANCEL')receiptPayload(saved.payload,item.quantityUnit);
        operation.current=saved;pendingKey.current=saved.key;pendingPayload.current=saved.payload;if(saved.kind!=='CANCEL')fill(saved.payload);
        setError('An earlier result may be uncertain. Retry the same saved operation or inspect its history; do not start another operation.');
      }
    }catch(e){setStorageBlocked(true);setError(message(e));}
    refresh(1);
    return()=>{alive.current=false;readSequence.current++;};
  },[item._id]);
  const owner=!!session.accessToken&&session.user?.role==='CUSTOMER'&&inventoryId(session.user)===inventoryId(item.customerId);
  const allowed=eligibleRepeatedReceipt(item,rental,session.user)&&!parentLoading;
  const mayWrite=import.meta.env?.PROD!==true&&!gateBlocked;
  const clearOperation=()=>{sessionStorage.removeItem(operationKey);operation.current=null;pendingKey.current=null;pendingPayload.current=null;};
  const execute=async op=>{
    if(busy.current||!owner||storageBlocked||(op.kind!=='CANCEL'&&!mayWrite))return;
    busy.current=true;setPending(true);setError('');setNotice('');const token=getAccessToken();tokenAtStart.current=token;let sent=false;
    operation.current=op;pendingKey.current=op.key;pendingPayload.current=op.payload;
    try{
      sessionStorage.setItem(operationKey,JSON.stringify(op));
      sent=true;
      const response=op.kind==='CANCEL'
        ?await inventoryApi.cancelRepeatedInbound(op.requestId,op.version,op.key)
        :op.kind==='AMEND'?await inventoryApi.amendRepeatedInbound(op.requestId,op.payload,op.version,op.key)
        :await inventoryApi.createRepeatedInbound(item._id,op.payload,op.key);
      if(getAccessToken() !== token||!alive.current)return;
      const result=receiptResponse(response,item);
      if(op.kind!=='CREATE'&&result._id!==op.requestId||op.kind==='CANCEL'&&result.state!=='CANCELLED'||op.kind!=='CANCEL'&&['requestedQuantity','quantityUnit','declaredUnitWeightKg'].some(k=>result[k]!==op.payload[k])||op.kind!=='CANCEL'&&['widthM','depthM','heightM'].some(k=>result.declaredUnitDimensionsM[k]!==op.payload.declaredUnitDimensionsM[k]))throw Error('Receipt result did not match the saved operation. Reconcile before retrying.');
      clearOperation();setEditing(null);setDetail(result);
      setNotice(op.kind==='CANCEL'?'Receipt request cancelled.':op.kind==='AMEND'?'Receipt request amended.':response.status === 200?'Original receipt request replayed.':'Receipt request created. Facility Staff must inspect the goods.');
      await refresh(op.kind==='CREATE'?1:page);
    }catch(e){
      if(!current(token))return;
      const status=e.response?.status;
      if(!sent){setStorageBlocked(true);setError('Safe operation storage is unavailable. No receipt mutation was submitted.');}
      else if(e.response?.data?.code==='INBOUND_REQUEST_FEATURE_DISABLED'){
        clearOperation();setGateBlocked(true);setError('Repeated inbound creation/amendment is disabled by Backend configuration. No first-inbound fallback was attempted.');
      }else if(!status||e.response?.status === 503||status>=500){
        setError(`${message(e)} Outcome is uncertain. Retry with the same key, payload and version; no new request will be created automatically.`);
        await refresh(page);
      }else{
        clearOperation();setEditing(null);setDetail(null);setError([409,428].includes(status)?`${message(e)} State/version conflict. Review refreshed history before editing again; no version was overwritten.`:message(e));await refresh(page);
      }
    }finally{busy.current=false;if(current(token))setPending(false);}
  };
  const submit=async retry=>{
    if(retry){if(operation.current)await execute(operation.current);return;}
    if(busy.current||operation.current||!allowed||!loaded.current||loading||!mayWrite)return;
    if(!editing&&rows.some(row=>unresolvedReceiptStates.includes(row.state))){setError('An unresolved receipt request already exists. Inspect its state before creating another receipt.');return;}
    try{
      const body=receiptPayload({requestedQuantity:Number(quantity),quantityUnit:item.quantityUnit,declaredUnitWeightKg:Number(weight),declaredUnitDimensionsM:{widthM:Number(width),depthM:Number(depth),heightM:Number(height)}},item.quantityUnit);
      if(editing&&!mayChangeReceipt(editing))throw Error('This request can no longer be amended. Refresh its details.');
      await execute({kind:editing?'AMEND':'CREATE',requestId:editing?._id,version:editing?.version,payload:body,key:key()});
    }catch(e){setError(message(e));}
  };
  const amend=async row=>{
    if(busy.current||operation.current||!allowed||!mayWrite||!mayChangeReceipt(row))return;
    busy.current=true;setPending(true);setError('');const token=getAccessToken();
    try{const fresh=receiptResponse(await inventoryApi.repeatedInboundDetail(row._id),item);if(!current(token))return;if(fresh._id!==row._id||!mayChangeReceipt(fresh))throw Error('This request has inspection history/custody or is no longer amendable. Refresh history.');setEditing(fresh);setDetail(fresh);fill(fresh);}
    catch(e){if(current(token))setError(message(e));}
    finally{busy.current=false;if(current(token))setPending(false);}
  };
  const cancel=async row=>{
    if(busy.current||operation.current||!owner||loading||!mayChangeReceipt(row))return;
    await execute({kind:'CANCEL',requestId:row._id,version:row.version,payload:{},key:key()});
  };
  const view=async row=>{
    if(busy.current)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();
    try{const result=receiptResponse(await inventoryApi.repeatedInboundDetail(row._id),item);if(!current(token))return;if(result._id!==row._id)throw Error('Receipt detail does not match this request.');setDetail(result);}
    catch(e){if(current(token))setError(message(e));}
    finally{busy.current=false;if(current(token))setPending(false);}
  };
  return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Repeated inbound requests">
    <h2 className="text-lg font-bold">Additional receipt requests</h2>
    <p className="mt-1 text-sm text-slate-600">Registered quantity remains item metadata. Enter the quantity in this new delivery batch.</p>
    {['IN_STORAGE','CHECKED_OUT'].includes(item.status) && <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); submit(false); }}>
      <label className="text-sm">Receipt quantity ({item.quantityUnit})<input className="mt-1 w-full rounded border p-2" type="number" min="1" step="1" required disabled={pending||!!operation.current||storageBlocked} value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
      <label className="text-sm">Declared unit weight (kg)<input className="mt-1 w-full rounded border p-2" type="number" min="0" step="any" required disabled={pending||!!operation.current||storageBlocked} value={weight} onChange={e => setWeight(e.target.value)} /></label>
      {[['Width (m)', width, setWidth], ['Depth (m)', depth, setDepth], ['Height (m)', height, setHeight]].map(([label, value, setter]) => <label className="text-sm" key={label}>{label}<input className="mt-1 w-full rounded border p-2" type="number" min="0" step="any" required disabled={pending||!!operation.current||storageBlocked} value={value} onChange={e => setter(e.target.value)} /></label>)}
      <div className="sm:col-span-2 flex flex-wrap gap-2"><button className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={pending||loading||!!readError||!loaded.current||!!operation.current||storageBlocked||!allowed||!mayWrite}>{pending ? 'Submitting…' : editing ? 'Save amendment' : 'Create receipt request'}</button>{editing && <button type="button" className="rounded border px-4 py-2" disabled={pending||!!operation.current} onClick={() => setEditing(null)}>Stop editing</button>}{pendingKey.current && <button type="button" className="rounded border px-4 py-2" disabled={pending||!owner||storageBlocked||(operation.current?.kind!=='CANCEL'&&!mayWrite)} onClick={() => submit(true)}>Retry same request</button>}</div>
    </form>}
    {!allowed && <p className="mt-3 text-sm text-slate-600">Additional receipts require your eligible Item and an in-term ACTIVE Managed reservation. Physical ledger and placement reconciliation remain Backend-controlled; this does not replace first inbound.</p>}
    {!mayWrite&&<p role="note" className="mt-3 text-sm text-orange-800">Repeated inbound create/amend is unavailable in production or disabled by Backend. Reads and eligible cancellation remain separate.</p>}
    <button className="mt-3 rounded border px-3 py-2" disabled={pending||loading} onClick={()=>refresh(page)}>Refresh receipt history (GET)</button>
    {readError&&<p role="alert" className="mt-3 text-sm text-red-700">{readError}</p>}
    {operation.current&&<p role="note" className="mt-3 text-sm text-orange-800">Saved operation: {operation.current.kind}. New actions are locked until this operation is resolved.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    <div className="mt-5 space-y-3">{loading ? <p role="status">Loading receipt history…</p> : readError ? <p>Receipt history is unavailable; no empty history is inferred.</p> : rows.length === 0 ? <p className="text-sm text-slate-500">No additional receipts yet.</p> : rows.map(row => <article key={row._id} className="rounded-lg bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2"><b>{row.requestedQuantity} {row.quantityUnit}</b><span className="text-sm font-semibold">{states.includes(row.state) ? row.state.replaceAll('_', ' ') : 'Unknown'}</span></div><p className="mt-1 text-xs text-slate-500">Custody {row.custodyState} · Version {row.version} · Created {reservationVietnamTime(row.createdAt)}</p><div className="mt-3 flex gap-2"><button className="rounded border px-3 py-1" disabled={pending} onClick={() => view(row)}>Details</button>{row.state === 'PENDING_INSPECTION' && row.custodyState === 'NOT_TAKEN' && mayChangeReceipt(row) && <><button className="rounded border px-3 py-1" disabled={pending||loading||!!operation.current||!allowed||!mayWrite||storageBlocked} onClick={() => amend(row)}>Amend</button><button className="rounded border px-3 py-1" disabled={pending||loading||!!operation.current||!owner||storageBlocked} onClick={() => cancel(row)}>Cancel</button></>}</div></article>)}</div>
    {pagination&&<nav aria-label="Receipt history pages" className="mt-4 flex flex-wrap items-center gap-3 text-sm"><button disabled={pending||loading||page<=1} onClick={()=>refresh(page-1)}>Previous receipts</button><span>Page {page} of {pagination.totalPages||1} · {pagination.total} requests</span><button disabled={pending||loading||page>=pagination.totalPages} onClick={()=>refresh(page+1)}>Next receipts</button></nav>}
    <p className="mt-3 text-xs text-slate-500">Amend/cancel candidates require PENDING INSPECTION and NOT TAKEN custody. Backend also checks explicitly empty inspection history; an omitted inspection reference does not establish permission.</p>
    {detail && <article className="mt-4 rounded-lg border p-4"><h3 className="font-semibold">Request details · {detail.state}</h3><p className="mt-1 text-xs">Custody {detail.custodyState} · Version {detail.version} · Created {reservationVietnamTime(detail.createdAt)}</p><p className="mt-1 text-sm">{detail.requestedQuantity} {detail.quantityUnit}; {detail.declaredUnitWeightKg} kg/unit; {detail.declaredUnitDimensionsM.widthM} × {detail.declaredUnitDimensionsM.depthM} × {detail.declaredUnitDimensionsM.heightM} m</p>{detail.confirmedMovementId && <p className="mt-2 break-all text-xs">Confirmed movement: {inventoryId(detail.confirmedMovementId)}</p>}</article>}
  </section>;
}
