import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { managedAccessApi } from '@/api/managedAccessApi';
import { managedInventoryV3Api } from '@/api/managedInventoryV3Api';
import { formatInventoryDateTime } from './inventoryUiFormat';
import { buildA2InboundPayload, inboundErrorMessage, inboundFieldErrors } from './managedSelfInboundV3Validation';

const valueOf = row => row?._id || row?.id || row;
const errorText = inboundErrorMessage;
const inboundFieldLabels = { accessSessionId: 'Phiên đến kho', cellIds: 'Ô kệ', quantity: 'Số lượng', quantityUnit: 'Đơn vị tính', placements: 'Phân bổ theo ô kệ', placementsTotal: 'Tổng phân bổ', actualUnitWeightKg: 'Khối lượng mỗi đơn vị', 'dimensionsM.widthM': 'Chiều rộng', 'dimensionsM.depthM': 'Chiều sâu', 'dimensionsM.heightM': 'Chiều cao' };
const idPattern = /^[a-f\d]{24}$/i;
function useRemaining(expiresAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ManagedSelfInboundV3({ item, rental, cellLabels = {}, onRefresh }) {
  const skuId = String(valueOf(item));
  const allocated = useMemo(() => (rental?.allocatedCellIds || []).map(valueOf).map(String).filter(value => idPattern.test(value)), [rental]);
  const [sessions, setSessions] = useState([]), [units, setUnits] = useState([]), [stock, setStock] = useState(null), [movements, setMovements] = useState([]);
  const [kind, setKind] = useState('A2_BATCH'), [sessionId, setSessionId] = useState(''), [cellIds, setCellIds] = useState([]);
  const [quantity, setQuantity] = useState(1), [quantities, setQuantities] = useState({}), [weight, setWeight] = useState(item.unitWeightKg || 0.1);
  const [pose, setPose] = useState({ xStartM: '', yStartM: '', rotationDeg: 0 });
  const [dimensions, setDimensions] = useState(item.unitDimensionsM || { widthM: 0.1, depthM: 0.1, heightM: 0.1 });
  const [serial, setSerial] = useState(''), [physicalUnitId, setPhysicalUnitId] = useState(''), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const refresh = useCallback(async () => {
    setError('');
    try {
      const [sessionResponse, unitResponse, stockResponse, movementResponse] = await Promise.all([
        managedAccessApi.mySessions(), managedInventoryV3Api.physicalUnits(skuId), managedInventoryV3Api.stock(skuId), managedInventoryV3Api.movements(skuId),
      ]);
      setSessions(sessionResponse.data?.data || []); setUnits(unitResponse.data?.data || []); setStock(stockResponse.data?.data || null); setMovements(movementResponse.data?.data || []);
      const saved = managedInventoryV3Api.pending(skuId); setPending(saved);
      if (saved?.payload) { setPreview({ candidate: saved.payload, result: null }); setKind(saved.payload.itemKind); setSessionId(saved.payload.accessSessionId); setCellIds(saved.payload.cellIds || saved.payload.placements?.map(line => String(line.cellId)) || []); }
    } catch (e) { setError(errorText(e)); }
  }, [skuId]);
  useEffect(() => { refresh(); }, [refresh]);
  const activeSessions = sessions.filter(session => session.status === 'ACTIVE' && new Date(session.expiresAt).getTime() > Date.now() &&
    (session.allowedPurposes || []).includes('INBOUND') && allocated.some(cellId => (session.allowedCellIds || []).map(String).includes(cellId)));
  const selectedSession = activeSessions.find(session => String(valueOf(session)) === String(sessionId));
  const canInbound = rental?.status === 'ACTIVE' && new Date(rental.startDate).getTime() <= Date.now() && new Date(rental.endDate).getTime() > Date.now();
  const sessionCountdown = useRemaining(selectedSession?.expiresAt || new Date().toISOString());
  const selectedCells = cellIds.filter(cellId => allocated.includes(cellId));
  const a2Lines = selectedCells.map(cellId => ({ cellId, quantity: Number(quantities[cellId] || 0) })).filter(line => line.quantity > 0);
  const totalQuantity = a2Lines.reduce((sum, line) => sum + line.quantity, 0);
  const a2Payload = () => buildA2InboundPayload({ sessionId, sessionRevision: selectedSession?.revision, selectedCells, quantities, quantity, quantityUnit: item.quantityUnit, weight, dimensions });
  const a1Payload = () => ({ itemKind: 'A1_PHYSICAL_UNIT', accessSessionId: sessionId, sessionRevision: selectedSession?.revision, cellIds: selectedCells,
    physicalUnitId, pose: { xStartM: Number(pose.xStartM), yStartM: Number(pose.yStartM), rotationDeg: Number(pose.rotationDeg) }, placements: selectedCells.map(cellId => ({ cellId })) });
  const prepareUnit = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const response = await managedInventoryV3Api.preparePhysicalUnit(skuId, { serial, actualUnitWeightKg: Number(weight), dimensionsM: { widthM: Number(dimensions.widthM), depthM: Number(dimensions.depthM), heightM: Number(dimensions.heightM) } });
      setPhysicalUnitId(String(valueOf(response.data?.data))); setNotice('Backend đã lưu PhysicalUnit ở trạng thái chuẩn bị; tồn kho chưa thay đổi.'); await refresh(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const getPreview = async () => {
    if (!canInbound || !selectedSession || !selectedCells.length) return;
    if (kind === 'A1_PHYSICAL_UNIT' && (pose.xStartM === '' || pose.yStartM === '')) { setError('Nhập tọa độ X và Y thực tế theo hệ tọa độ Cell trước khi kiểm tra.'); return; }
    const a2 = kind === 'A2_BATCH' ? a2Payload() : null;
    if (a2 && Object.keys(a2.errors).length) { setFieldErrors(a2.errors); setError('Vui lòng kiểm tra lại các thông tin nhập kho được đánh dấu.'); return; }
    setBusy(true); setError(''); setNotice('');
    setFieldErrors({});
    try { const body = kind === 'A1_PHYSICAL_UNIT' ? a1Payload() : a2.payload; const response = await managedInventoryV3Api.previewInbound(skuId, body); setPreview({ candidate: body, result: response.data?.data || null }); }
    catch (e) { setPreview(null); setError(errorText(e)); setFieldErrors(inboundFieldErrors(e)); } finally { setBusy(false); }
  };
  const confirm = async (payload = preview?.candidate, proof = preview?.result, allowBusy = false) => {
    if (!payload || (busy && !allowBusy)) return; setBusy(true); setError(''); setNotice('');
    try {
      const body = { ...payload, previewRevision: proof?.previewRevision ?? payload.previewRevision,
        ...(proof?.topologyCertificationIds ? { topologyCertificationIds: proof.topologyCertificationIds } : {}),
        ...(proof?.topologyRevisions ? { topologyRevisions: proof.topologyRevisions } : {}),
        ...(proof?.topologyCertificationId ? { topologyCertificationId: proof.topologyCertificationId, topologyRevision: proof.topologyRevision } : {}) };
      const response = await managedInventoryV3Api.confirmInbound(skuId, body);
      setNotice('Đã ghi nhận nhập kho thành công. Tồn kho và lịch sử đã được cập nhật.'); setPreview(null); await refresh(); onRefresh?.();
    } catch (e) { setError(errorText(e)); if (!e?.response || e.response.status >= 500) { const saved = managedInventoryV3Api.pending(skuId); setPending(saved); if (saved?.payload) setPreview({ candidate: saved.payload, result: null }); } }
    finally { setBusy(false); }
  };
  const reconcile = async () => {
    const saved = managedInventoryV3Api.pending(skuId); if (!saved?.key) return;
    setBusy(true); setError('');
    try { await managedInventoryV3Api.operation(skuId, saved.key); setNotice('Yêu cầu nhập trước đã được xác nhận. Tồn kho và lịch sử đã được cập nhật.'); managedInventoryV3Api.clearPending(skuId); setPending(null); await refresh(); onRefresh?.(); }
    catch (e) { if (e?.response?.status === 404 && saved.payload) { setPreview({ candidate: saved.payload, result: null }); await confirm(saved.payload, null, true); } else setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const toggleCell = cellId => { setPreview(null); setCellIds(current => current.includes(cellId) ? current.filter(id => id !== cellId) : [...current, cellId]); };

  return <section className="mt-6 space-y-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm" aria-labelledby="mi-v3-stock-title">
    <div className="rounded-2xl bg-gradient-to-r from-emerald-50 via-white to-orange-50 p-5"><p className="text-xs font-bold uppercase tracking-widest text-emerald-800">Kho hàng quản lý · Phiên bản 3</p><h2 id="mi-v3-stock-title" className="mt-1 text-xl font-bold text-emerald-950">Theo dõi tồn kho và nhập hàng</h2>
      <p className="mt-1 text-sm text-slate-600">SKU là thông tin hàng hóa. Chỉ thao tác nhập được xác nhận trong Access Session mới ghi tăng tồn kho.</p></div>
    {rental?.status==='ACTIVE'&&<Link className="inline-flex rounded-lg border border-emerald-800 px-3 py-2 text-sm font-semibold text-emerald-900" to={`/portal/managed-access?purpose=INBOUND&reservationId=${encodeURIComponent(valueOf(rental))}`}>Đặt lịch đến kho để nhập hàng</Link>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><p>{error}</p>{Object.entries(fieldErrors).map(([field, message])=><p key={field} className="mt-1">{inboundFieldLabels[field]||'Thông tin nhập kho'}: {message}</p>)}</div>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {stock && <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-4"><div><b>Tồn:</b> {stock.onHandQuantity} {item.quantityUnit}</div><div><b>Đang giữ:</b> {stock.heldQuantity}</div><div><b>Khối lượng:</b> {stock.totalWeightKg} kg</div><div><b>Đối soát:</b> {stock.reconciliationStatus === 'RECONCILED' ? 'Khớp sổ' : 'Cần kiểm tra'}</div></div>}
    {pending && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Kết quả lần nhập chưa xác định. Giữ nguyên hàng tại vị trí đã đặt, không nhập lại bằng yêu cầu mới. <button type="button" disabled={busy} onClick={reconcile} className="ml-2 font-bold underline">Đối soát / thử lại đúng yêu cầu</button></div>}
    {!canInbound && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Bạn có thể chuẩn bị thông tin SKU/PhysicalUnit. Ghi nhận tồn kho chỉ khả dụng khi Rental đang ACTIVE trong thời hạn thuê và có Access Session phù hợp.</p>}
    <div className="grid gap-3 md:grid-cols-2"><form onSubmit={prepareUnit} className="space-y-2 rounded-xl border p-4"><h3 className="font-semibold">Chuẩn bị PhysicalUnit (A1)</h3><p className="text-xs text-slate-600">Chỉ tạo mã nhận diện và thông số; chưa ghi tồn kho.</p>
      <input value={serial} onChange={e=>setSerial(e.target.value)} maxLength={120} placeholder="Mã định danh PhysicalUnit" className="w-full rounded border p-2" required />
      <div className="grid grid-cols-2 gap-2"><input type="number" min="0.001" step="0.001" value={weight} onChange={e=>setWeight(e.target.value)} aria-label="Khối lượng kg" className="rounded border p-2" required />
        {['widthM','depthM','heightM'].map(key=><input key={key} type="number" min="0.001" step="0.001" value={dimensions[key]} onChange={e=>setDimensions({...dimensions,[key]:e.target.value})} aria-label={`${key} (m)`} className="rounded border p-2" required />)}</div>
      <button disabled={busy||!!pending} className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Lưu thông tin PhysicalUnit</button>
      <select value={physicalUnitId} onChange={e=>setPhysicalUnitId(e.target.value)} className="w-full rounded border p-2"><option value="">Chọn PhysicalUnit đã chuẩn bị</option>{units.filter(unit=>unit.state==='PREPARED').map(unit=><option key={valueOf(unit)} value={valueOf(unit)}>{unit.serial} · {unit.weightKg} kg</option>)}</select>
    </form>
    <div className="space-y-2 rounded-xl border p-4"><h3 className="font-semibold">Thông tin lô A2</h3><p className="text-xs text-slate-600">Có thể phân bổ cùng một lần nhập sang nhiều Cell được cấp.</p>
      <label className="block text-sm">Số lượng dự kiến<input type="number" min="1" step="1" value={quantity} onChange={e=>{setQuantity(e.target.value);setFieldErrors({});}} aria-invalid={!!fieldErrors.quantity} className="mt-1 w-full rounded border p-2" />{fieldErrors.quantity&&<span className="text-xs text-red-700">{fieldErrors.quantity}</span>}</label>
      <label className="block text-sm">Khối lượng mỗi đơn vị (kg)<input type="number" min="0.001" step="0.001" value={weight} onChange={e=>{setWeight(e.target.value);setFieldErrors({});}} aria-invalid={!!fieldErrors.actualUnitWeightKg} className="mt-1 w-full rounded border p-2" />{fieldErrors.actualUnitWeightKg&&<span className="text-xs text-red-700">{fieldErrors.actualUnitWeightKg}</span>}</label>
      <div className="grid grid-cols-3 gap-2">{['widthM','depthM','heightM'].map(key=><label key={key} className="text-xs">{({widthM:'Rộng (m)',depthM:'Sâu (m)',heightM:'Cao (m)'})[key]}<input type="number" min="0.001" step="0.001" value={dimensions[key]} onChange={e=>{setDimensions({...dimensions,[key]:e.target.value});setFieldErrors({});}} aria-invalid={!!fieldErrors[`dimensionsM.${key}`]} className="mt-1 w-full rounded border p-2" />{fieldErrors[`dimensionsM.${key}`]&&<span className="text-xs text-red-700">{fieldErrors[`dimensionsM.${key}`]}</span>}</label>)}</div>
      <p className="text-xs">Khai báo: {quantity} {item.quantityUnit}</p>
    </div></div>
    <div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">Lịch đến kho và ô kệ được phân bổ</h3>
      <label className="block text-sm font-medium">Chọn phiên đến kho<select aria-label="Chọn phiên đến kho" value={sessionId} onChange={e=>{setSessionId(e.target.value);setPreview(null);}} disabled={!canInbound} className="mt-1 w-full rounded-lg border border-emerald-200 p-3 disabled:bg-slate-100"><option value="">Chọn phiên còn hiệu lực</option>{activeSessions.map(session=><option key={valueOf(session)} value={valueOf(session)}>{formatInventoryDateTime(session.expiresAt)} · còn {Math.ceil((new Date(session.expiresAt)-Date.now())/60000)} phút</option>)}</select></label>
      {selectedSession&&<p className="text-sm text-emerald-800">Phiên còn hiệu lực trong {sessionCountdown}. Phiên kết thúc khi hết hạn, lượt đến kho hoặc kỳ thuê kết thúc.</p>}
      {allocated.length===0?<p className="text-sm text-amber-800">Chưa có thông tin ô kệ được phân bổ cho đơn thuê.</p>:<div className="grid gap-2 sm:grid-cols-2">{allocated.map(cellId=><label key={cellId} className="flex items-center gap-2 rounded border p-3 text-sm"><input type="checkbox" checked={cellIds.includes(cellId)} onChange={()=>toggleCell(cellId)} disabled={!!pending||(kind==='A1_PHYSICAL_UNIT'&&cellIds.length>0&&!cellIds.includes(cellId))} /><span>{cellLabels[cellId]||'Ô kệ đang tải thông tin vị trí'}</span></label>)}</div>}
      {kind==='A1_PHYSICAL_UNIT'&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Vị trí thực tế của PhysicalUnit trong Cell</p><p className="mt-1 text-xs text-amber-900">Nhập tọa độ X/Y và góc xoay do bạn quan sát. Backend sẽ kiểm tra lại theo topology được chứng nhận tại Preview và Confirm. Đây là vị trí Customer khai báo, không phải phép đo độc lập. A1 nhiều Cell hiện chưa hỗ trợ vì thiếu chứng nhận load-sharing.</p><div className="mt-2 grid grid-cols-3 gap-2"><label className="text-xs">X (m)<input aria-label="A1 tọa độ X mét" type="number" step="0.001" value={pose.xStartM} onChange={e=>{setPose({...pose,xStartM:e.target.value});setPreview(null);}} className="mt-1 w-full rounded border p-2" required /></label><label className="text-xs">Y (m)<input aria-label="A1 tọa độ Y mét" type="number" step="0.001" value={pose.yStartM} onChange={e=>{setPose({...pose,yStartM:e.target.value});setPreview(null);}} className="mt-1 w-full rounded border p-2" required /></label><label className="text-xs">Góc xoay<select aria-label="A1 góc xoay" value={pose.rotationDeg} onChange={e=>{setPose({...pose,rotationDeg:Number(e.target.value)});setPreview(null);}} className="mt-1 w-full rounded border p-2"><option value={0}>0°</option><option value={90}>90°</option></select></label></div></div>}
      {kind==='A2_BATCH'&&selectedCells.map(cellId=><label key={cellId} className="block text-sm">Số lượng tại {cellLabels[cellId]||'ô kệ đã chọn'}<input type="number" min="0" step="1" value={quantities[cellId]??''} onChange={e=>{setQuantities({...quantities,[cellId]:e.target.value});setFieldErrors({});}} aria-invalid={!!fieldErrors.placements||!!fieldErrors.placementsTotal} className="mt-1 w-full rounded border p-2" /></label>)}
      {(fieldErrors.placements||fieldErrors.placementsTotal)&&<p role="alert" className="text-sm text-red-700">{fieldErrors.placements||fieldErrors.placementsTotal}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!canInbound||busy||!!pending||!selectedSession||!selectedCells.length||(kind==='A1_PHYSICAL_UNIT'&&(!physicalUnitId||selectedCells.length!==1||pose.xStartM===''||pose.yStartM===''))||(kind==='A2_BATCH'&&totalQuantity!==Number(quantity))} onClick={getPreview} className="rounded border px-3 py-2 text-sm font-semibold disabled:opacity-50">Kiểm tra vị trí & dung lượng</button>
      <button type="button" onClick={()=>{const next=kind==='A2_BATCH'?'A1_PHYSICAL_UNIT':'A2_BATCH';setKind(next);if(next==='A1_PHYSICAL_UNIT')setCellIds(current=>current.slice(0,1));setPreview(null);}} className="rounded border px-3 py-2 text-sm">Loại hàng: {kind==='A2_BATCH'?'A2 · theo lô':'A1 · vật thể nguyên khối'}</button></div>
    </div>
    {preview && <div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4"><h3 className="font-semibold">Xem trước — chưa ghi tồn kho</h3><p className="text-sm">{preview.result?.quantity ?? preview.candidate.quantity} {item.quantityUnit} · {preview.result?.weightKg ?? '—'} kg · {preview.result?.volumeM3 ?? '—'} m³</p>{preview.result?.poseBounds&&<p className="text-xs">Biên được chứng nhận: X {preview.result.poseBounds.xStartM}–{preview.result.poseBounds.xEndM} m; Y {preview.result.poseBounds.yStartM}–{preview.result.poseBounds.yEndM} m; cao tối đa {preview.result.poseBounds.usableHeightM} m. Góc xoay 0°/90°.</p>}{preview.result?.placements?.map(line=><p key={line.cellId} className="text-xs">{cellLabels[String(line.cellId)]||'Ô kệ đã chọn'}: tải còn {line.remainingWeightKg} kg, thể tích còn {line.remainingVolumeM3} m³ sau thao tác</p>)}
      <p className="text-xs">Xác nhận nghĩa là bạn đã tự đặt hàng vào Cell và số liệu trên phản ánh hàng thực tế.</p><button type="button" disabled={busy||!!pending||!preview.result} onClick={()=>confirm()} className="rounded bg-emerald-900 px-4 py-2 font-semibold text-white disabled:opacity-50">Xác nhận hàng đã được đặt tại kho</button></div>}
    <div className="rounded-xl border border-emerald-100 bg-white p-4"><h3 className="font-semibold text-emerald-950">Lịch sử nhập hàng gần đây</h3>{movements.length===0?<p className="mt-2 text-sm text-slate-500">Chưa có lần nhập kho nào được ghi nhận.</p>:movements.map(movement=><p key={valueOf(movement)} className="mt-2 text-sm">{formatInventoryDateTime(movement.performedAt)} · {movement.v3Effect?.action==='INBOUND'?'Nhập kho':movement.v3Effect?.action||'Biến động kho'} · {movement.quantity?.toLocaleString('vi-VN')} {movement.quantityUnit}</p>)}<button type="button" disabled={busy} onClick={refresh} className="mt-3 text-sm font-semibold text-emerald-800 underline">Làm mới tồn kho và lịch sử</button></div>
  </section>;
}
