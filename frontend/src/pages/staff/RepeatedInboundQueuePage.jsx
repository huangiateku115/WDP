import {facilityLabel} from '@/lib/facilityLabels';
import { useSearchParams } from 'react-router-dom';
import { receiptOperation, validateReceiptOperation } from '@/lib/receiptOperation';
import { receivingCellReason } from '@/lib/receivingCellEligibility';
import QueuePagination from '@/components/staff/QueuePagination';
import { inventoryQueuePage } from '@/lib/inventoryQueuePage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryApi } from '@/api/inventoryApi';
import ReceivingEvidencePicker from '@/components/staff/ReceivingEvidencePicker';
import { useAuthSession, getAccessToken } from '@/lib/authSession';

const key = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const err = e => e?.response?.data?.message || e?.message || 'Request failed.';
const field = 'mt-1 w-full rounded border border-slate-300 p-2';

export default function RepeatedInboundQueuePage() {
  const session = useAuthSession(), [rows, setRows] = useState([]), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [state, setState] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [decision, setDecision] = useState('ACCEPTED'), [receivedQuantity, setReceivedQuantity] = useState(''), [weight, setWeight] = useState(''), [width, setWidth] = useState(''), [depth, setDepth] = useState(''), [height, setHeight] = useState(''), [custodyTaken, setCustodyTaken] = useState(false), [packing, setPacking] = useState(false), [note, setNote] = useState(''), [returnNote, setReturnNote] = useState(''), [uploads, setUploads] = useState([]), [uploadsReady, setUploadsReady] = useState(true), [cellId, setCellId] = useState('');
  const busyRef = useRef(false);
  const detailSequence = useRef(0);
  const queueSequence = useRef(0);
  const operationRef = useRef(null);
  const [operation, setOperation] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0 });
  const [params, setParams] = useSearchParams();
  const requestId = params.get('requestId') || '';
  const storageKey = id => 'wdp:mi06:receipt:' + session.user?.id + ':' + id;

  const loadQueue = useCallback(async () => {
    const sequence = ++queueSequence.current;
    const token = getAccessToken();
    setLoading(true); setRows([]);
    try {
      const response = await inventoryApi.repeatedInboundQueue({ state: state || undefined, page, limit: 20 });
      if (sequence !== queueSequence.current || token !== getAccessToken()) return;
      const value = inventoryQueuePage(response, page);
      if (page > Math.max(1, value.pagination.totalPages)) { setPage(Math.max(1, value.pagination.totalPages)); return; }
      setRows(value.data); setPagination(value.pagination);
    } catch (failure) {
      if (sequence === queueSequence.current && token === getAccessToken()) { setPagination({ total: 0, totalPages: 0 }); setError(err(failure)); }
    } finally {
      if (sequence === queueSequence.current && token === getAccessToken()) setLoading(false);
    }
  }, [state, page]);
  useEffect(() => { loadQueue(); }, [loadQueue, session.accessToken]);
  useEffect(() => {
    busyRef.current = false; operationRef.current = null;
    setOperation(null); setDetail(null); setSelected(null); setBusy(false); setNotice(''); setError('');
    ++detailSequence.current;
  }, [session.accessToken]);
  useEffect(() => () => { ++detailSequence.current; ++queueSequence.current; }, []);

  const open = async (row, preserveFeedback = false) => {
    const sequence = ++detailSequence.current;
    const token = getAccessToken();
    setSelected(row._id); setDetail(null); setUploads([]); setUploadsReady(true);
    setDecision('ACCEPTED'); setCustodyTaken(false); setPacking(false); setNote(''); setReturnNote('');
    operationRef.current = null; setOperation(null);
    if (!preserveFeedback) { setError(''); setNotice(''); }
    try {
      const response = await inventoryApi.repeatedInboundReceivingDetail(row._id);
      if (sequence !== detailSequence.current || token !== getAccessToken()) return;
      const value = response.data?.data;
      if (response.data?.success !== true || value?.request?._id !== row._id ||
          value.request.facilityId !== session.user?.assignedFacilityId || value.item?._id !== value.request.itemId) {
        throw Error("Chi tiết tiếp nhận không khớp yêu cầu và cơ sở được phân công.");
      }
      const stored = sessionStorage.getItem(storageKey(row._id));
      const saved = stored ? validateReceiptOperation(JSON.parse(stored), row._id) : null;
      operationRef.current = saved; setOperation(saved);
      setDetail(value);
      setReceivedQuantity(String(value.request.requestedQuantity));
      setWeight(String(value.request.declaredUnitWeightKg));
      setWidth(String(value.request.declaredUnitDimensionsM.widthM));
      setDepth(String(value.request.declaredUnitDimensionsM.depthM));
      setHeight(String(value.request.declaredUnitDimensionsM.heightM));
      setCustodyTaken(value.request.custodyState === 'IN_CUSTODY');
      setCellId(value.item.currentCellId || '');
    } catch (failure) {
      if (sequence === detailSequence.current && token === getAccessToken()) setError(err(failure));
    }
  };
  useEffect(() => {
    if (requestId && /^[a-f\d]{24}$/i.test(requestId)) open({ _id: requestId });
  }, [requestId, session.accessToken]);

  const onEvidenceChange = useCallback((ids, ready) => { setUploads(ids.map(uploadId => ({ uploadId }))); setUploadsReady(ready); }, []);
  const acceptedInspection = detail?.inspections?.filter(attempt => attempt.decision === 'ACCEPTED').at(-1);
  const receipt = detail?.request.state === 'ACCEPTED_PENDING_CONFIRMATION' && acceptedInspection ? {
    quantity: acceptedInspection.receivedQuantity, unitWeightKg: acceptedInspection.actualUnitWeightKg,
    unitDimensionsM: acceptedInspection.actualUnitDimensionsM,
  } : { quantity: Number(receivedQuantity), unitWeightKg: Number(weight), unitDimensionsM: { widthM: Number(width), depthM: Number(depth), heightM: Number(height) } };
  const cellReason = cell => receivingCellReason(cell, receipt, { currentCellId: detail?.item.status === 'IN_STORAGE' ? detail.item.currentCellId : null });
  const selectedCell = detail?.cells?.find(cell => cell._id === cellId);
  const selectedCellReason = selectedCell ? cellReason(selectedCell) : 'Select an allocated Cell';

  async function run(kind) {
    if (busyRef.current || !detail || !uploadsReady || selected !== detail.request._id) return;
    const saved = operationRef.current;
    if (saved && saved.kind !== kind) { setError("Khôi phục thao tác đã lưu trước khi bắt đầu thao tác mới."); return; }
    if (!saved && kind === 'inspection' && decision === 'ACCEPTED' && selectedCellReason) { setError(selectedCellReason); return; }
    if (!saved && kind === 'confirm' && selectedCellReason) { setError(selectedCellReason); return; }
    if (!saved && kind === 'return' && !returnNote.trim()) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const token = getAccessToken();
    const id = detail.request._id;
    try {
      let next = saved;
      if (!next) {
        let payload;
        if (kind === 'inspection') payload = {
          decision, receivedQuantity: Number(receivedQuantity), actualUnitWeightKg: Number(weight),
          actualUnitDimensionsM: { widthM: Number(width), depthM: Number(depth), heightM: Number(height) },
          compatibleCellIds: cellId ? [cellId] : [], packingLayoutVerified: packing, custodyTaken,
          note, evidenceUploadIds: uploads.map(upload => upload.uploadId), inspectionKey: key(),
        };
        if (kind === 'confirm') payload = { destinationCellId: cellId, inspectionNote: note || "Đã chấp nhận lô nhập thêm", idempotencyKey: key() };
        if (kind === 'return') payload = { returnNote: returnNote.trim(), idempotencyKey: key() };
        next = receiptOperation(kind, detail.request, payload);
        sessionStorage.setItem(storageKey(id), JSON.stringify(next));
        operationRef.current = next; setOperation(next);
      }
      let response;
      if (kind === 'inspection') response = await inventoryApi.inspectRepeatedInbound(id, next.payload, next.version);
      if (kind === 'confirm') response = await inventoryApi.confirmRepeatedInbound(id, next.payload, next.version);
      if (kind === 'return') response = await inventoryApi.completeRepeatedInboundReturn(id, next.payload.returnNote, next.version, next.payload.idempotencyKey);
      if (token !== getAccessToken()) return;
      if (response.data?.success !== true || response.data.data?.request?._id !== id) throw Error("Chưa xác minh được kết quả tiếp nhận. Thử lại thao tác đã lưu.");
      try { sessionStorage.removeItem(storageKey(id)); } catch { /* Backend state remains authoritative. */ }
      operationRef.current = null; setOperation(null);
      await open({ _id: id }, true);
      await loadQueue();
      setNotice(kind === 'confirm' ? 'Canonical receipt movement and stock projection committed.' : kind === 'inspection' ? "Đã lưu kiểm tra và bản chốt bằng chứng." : "Đã ghi nhận hoàn tất trả hàng.");
    } catch (failure) {
      if (token !== getAccessToken()) return;
      const status = failure.response?.status;
      if (status >= 400 && status < 500 && ![408, 429].includes(status)) {
        try { sessionStorage.removeItem(storageKey(id)); } catch { /* Preserve safe storage behavior on reload. */ }
        operationRef.current = null; setOperation(null);
        await open({ _id: id }, true);
      }
      setError(err(failure) + (operationRef.current ? ' Retry the saved operation with its original key and version.' : ' Refresh and review current request data.'));
    } finally {
      if (token === getAccessToken()) { busyRef.current = false; setBusy(false); }
    }
  }
  const inspect = () => run('inspection');
  const confirm = () => run('confirm');
  const completeReturn = () => run('return');
  return <div className="space-y-5 p-5"><header><h1 className="text-2xl font-bold">Tiếp nhận hàng nhập thêm</h1><p className="mt-1 text-sm text-slate-600">Hàng chờ các lô nhập thêm trong cơ sở được phân công.</p></header>
    <section className="flex flex-wrap gap-3 rounded-lg border bg-white p-4"><label className="text-sm">Trạng thái yêu cầu<select className={field} value={state} disabled={busy} onChange={e => { setPage(1); setState(e.target.value); }}><option value="">Tất cả yêu cầu chưa xử lý</option>{['PENDING_INSPECTION','DISCREPANCY','ACCEPTED_PENDING_CONFIRMATION','RETURN_PENDING'].map(s => <option key={s}>{s}</option>)}</select></label><button className="mt-5 rounded border px-4 py-2" onClick={loadQueue} disabled={loading}>Tải lại hàng chờ</button></section>
    <QueuePagination page={page} pagination={pagination} loading={loading || busy} onPageChange={setPage} />
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{error}</p>}{notice && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]"><section className="space-y-2">{loading && <p>Đang tải…</p>}{rows.map(row => <button key={row._id} className={`w-full rounded-lg border p-4 text-left ${selected === row._id ? 'border-emerald-700 bg-emerald-50' : 'bg-white'}`} disabled={busy} onClick={() => { if (requestId === row._id) open(row); else setParams({ requestId: row._id }); }}><b>{row.requestedQuantity} {facilityLabel(row.quantityUnit)}</b><span className="block text-sm">{row.state.replaceAll('_', ' ')}</span><span className="block break-all text-xs text-slate-500">{row.itemId} · phiên bản{row.version}</span></button>)}{!loading && rows.length === 0 && <p className="rounded border bg-white p-4 text-sm">Không còn yêu cầu nhập hàng chưa xử lý tại cơ sở này.</p>}</section>
    <section className="rounded-lg border bg-white p-5">{detail && selectedCellReason && <p role="note" className="mb-3 text-sm text-orange-700">{selectedCellReason}</p>}{!detail ? <p>Chọn yêu cầu để kiểm tra.</p> : <><h2 className="text-xl font-bold">{detail.item.itemCode} · {detail.item.name}</h2><p className="mt-1 text-sm">{detail.request.requestedQuantity} {facilityLabel(detail.request.quantityUnit)} · phiên bản yêu cầu {detail.request.version} · {facilityLabel(detail.request.state)}</p><div className="mt-4 space-y-2">{(detail.inspections || []).map(a => <article className="rounded bg-slate-50 p-3" key={a._id}><b>Lần thực hiện {a.attempt}: {facilityLabel(a.decision)}</b><p className="text-sm">Số lượng {a.receivedQuantity} · tiếp nhận giữ hàng {a.custodyTaken ? 'taken' : 'not taken'} · {a.note}</p><div className="mt-2 flex flex-wrap gap-2">{(a.images || []).map(i => <a key={i.uploadId} href={i.secureUrl} target="_blank" rel="noreferrer"><img className="h-20 w-20 rounded object-cover" src={i.secureUrl} alt="Bằng chứng tiếp nhận" loading="lazy"/></a>)}</div></article>)}</div>
      <fieldset disabled={busy || !!operation}>
      {['PENDING_INSPECTION','DISCREPANCY'].includes(detail.request.state) && <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-sm">Quyết định<select className={field} value={decision} onChange={e => setDecision(e.target.value)}>{['ACCEPTED','DISCREPANCY','REJECTED'].map(s => <option key={s}>{s}</option>)}</select></label><label className="text-sm">Số lượng thực nhận<input className={field} type="number" min="0" step="1" value={receivedQuantity} onChange={e => setReceivedQuantity(e.target.value)}/></label><label className="text-sm">Khối lượng thực tế mỗi đơn vị (kg)<input className={field} type="number" min="0.000001" step="any" value={weight} onChange={e => setWeight(e.target.value)}/></label>{[['Width m',width,setWidth],['Depth m',depth,setDepth],['Height m',height,setHeight]].map(([label,value,setter])=><label key={label} className="text-sm">{label}<input className={field} type="number" min="0.000001" step="any" value={value} onChange={e => setter(e.target.value)}/></label>)}<label className="text-sm sm:col-span-2">Ô đích / ô hiện tại đã phân bổ<select className={field} value={cellId} onChange={e => setCellId(e.target.value)}><option value="">Chọn ô đã phân bổ</option>{(detail.cells || []).filter(c => detail.item.status !== 'IN_STORAGE' || String(c._id) === String(detail.item.currentCellId)).map(c => <option key={c._id} value={c._id} disabled={!!cellReason(c)}>{c.code} · {cellReason(c) || `${c.usedWeightKg} kg / ${c.usedVolumeM3} m³ used`}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={custodyTaken} onChange={e => setCustodyTaken(e.target.checked)}/> Cơ sở tiếp nhận / tiếp tục giữ hàng</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={packing} onChange={e => setPacking(e.target.checked)}/> Đã kiểm tra bố trí hàng</label><label className="text-sm sm:col-span-2">Nhận xét kiểm tra<textarea className={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)}/></label><div className="sm:col-span-2"><ReceivingEvidencePicker key={selected + session.accessToken} itemId={selected} disabled={busy} uploadEvidence={inventoryApi.uploadRepeatedInboundEvidence} onChange={onEvidenceChange}/></div><button type="button" className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50 sm:col-span-2" disabled={busy || !uploadsReady || (decision === 'ACCEPTED' && !!selectedCellReason && !operation)} onClick={() => inspect(false)}>{busy ? "Đang lưu kiểm tra…" : "Lưu lần kiểm tra"}</button></div>}
      {detail.request.state === 'ACCEPTED_PENDING_CONFIRMATION' && <div className="mt-5 space-y-3"><label className="block text-sm">Ô đích / ô đã phân bổ hiện tại<select className={field} value={cellId} onChange={e => setCellId(e.target.value)}><option value="">Chọn ô đã phân bổ</option>{(detail.cells || []).filter(c => detail.item.status !== 'IN_STORAGE' || String(c._id) === String(detail.item.currentCellId)).map(c => <option key={c._id} value={c._id} disabled={!!cellReason(c)}>{c.code} · {cellReason(c) || "Phù hợp với số đo đã kiểm tra"}</option>)}</select></label><button type="button" className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || cellId.length !== 24 || (!!selectedCellReason && !operation)} onClick={confirm}>{busy ? "Đang xác nhận…" : "Xác nhận nhận hàng thực tế"}</button></div>}
      {detail.request.state === 'RETURN_PENDING' && <div className="mt-5 space-y-2"><label className="block text-sm">Bằng chứng / ghi chú trả hàng<textarea className={field} maxLength={1000} value={returnNote} onChange={e => setReturnNote(e.target.value)}/></label><button className="rounded border px-4 py-2" disabled={busy || !returnNote.trim()} onClick={completeReturn}>Ghi nhận đã trả hàng cho khách</button></div>}
      </fieldset>
      {operation && <div className="mt-4 rounded border border-orange-300 p-3"><p role="status">Một thao tác đã lưu {facilityLabel(operation.kind)} đang chờ đối chiếu. Biểu mẫu đã khóa chỉnh sửa.</p><button type="button" className="mt-2 rounded border px-4 py-2" disabled={busy} onClick={() => run(operation.kind)}>Thử lại thao tác đã lưu {facilityLabel(operation.kind)}</button></div>}
      <button type="button" className="mt-4 rounded border px-4 py-2" disabled={busy} onClick={() => open({ _id: selected })}>Tải lại yêu cầu</button>
    </>}</section></div>
  </div>;
}
