import { useCallback, useEffect, useMemo, useState } from 'react';
import { managedAccessApi } from '@/api/managedAccessApi';
import { managedInventoryV3OutboundApi } from '@/api/managedInventoryV3OutboundApi';
import { managedInventoryV3Api } from '@/api/managedInventoryV3Api';
import { formatInventoryDateTime } from './inventoryUiFormat';

const refId = value => String(value?._id ?? value?.id ?? value ?? '');
const makeLine = spec => ({ lineId: globalThis.crypto?.randomUUID?.() || `out-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  itemSpecId: refId(spec), itemSpecRevision: spec?.revision ?? 0, quantity: 1, cellAllocations: [], itemInstanceIds: [] });
const errorMessage = error => {
  const code = error?.response?.data?.code;
  const messages = {
    ACCESS_SESSION_SCOPE_INVALID: 'Cần phiên OUTBOUND đang hoạt động, đã check-in và được phép vào các ô nguồn.',
    OUTBOUND_QUANTITY_UNAVAILABLE: 'Số lượng khả dụng không đủ tại nguồn hàng đã chọn.',
    SOURCE_STOCK_CHANGED: 'Tồn kho vừa thay đổi. Hãy tải lại tồn kho và xem trước lại.',
    CELL_COUNTER_RECONCILIATION_UNKNOWN: 'Sức chứa ô kệ chưa khớp với sổ tồn. Facility cần đối soát trước khi xuất.',
    LEGACY_STOCK_UNRECONCILED: 'Facility còn dữ liệu tồn kho cũ chưa được đối soát.',
    TRANSACTIONS_UNAVAILABLE: 'Cơ sở dữ liệu không hỗ trợ giao dịch an toàn; chưa ghi xuất kho.',
    OUTCOME_UNKNOWN: 'Chưa xác định kết quả. Giữ nguyên phiếu và dùng chức năng đối soát bằng cùng mã thao tác.',
    STALE_SKU_REVISION: 'Tồn kho vừa được cập nhật. Hãy tải lại và xem trước phiếu mới.',
    ITEM_INSTANCE_NOT_AVAILABLE: 'Món nguyên vẹn đã thay đổi hoặc được xuất trước đó.',
    CONTRACT_NOT_SIGNED: 'Hợp đồng hiện hành chưa được ký đầy đủ.',
    RENTAL_NOT_ACTIVE: 'Đơn thuê chưa ở trạng thái hoạt động hoặc chưa hoàn tất bàn giao.',
    LEGACY_OUTBOUND_REQUEST_PENDING: 'Còn yêu cầu xuất theo quy trình cũ cần được Facility đối soát.',
    IDEMPOTENCY_CONFLICT: 'Mã thao tác đã được dùng cho nội dung khác. Không gửi lại bằng mã mới; hãy đối soát lịch sử.',
  };
  return messages[code] || error?.response?.data?.message || error?.message || 'Không thể hoàn tất xuất kho. Hãy tải lại và đối soát.';
};

function makePayload(context, session, lines) {
  const errors = {};
  if (!session) errors.accessSessionId = 'Chọn phiên OUTBOUND đang hoạt động.';
  if (!lines.length) errors.lines = 'Thêm ít nhất một loại hàng có tồn.';
  const normalized = lines.map((line, index) => {
    if (!line.itemSpecId) errors[`lines.${index}.itemSpecId`] = 'Chọn loại hàng.';
    const spec = context?.stock?.itemSpecifications?.find(row => refId(row.itemSpecId) === line.itemSpecId);
    if (!Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) < 1) errors[`lines.${index}.quantity`] = 'Nhập số lượng nguyên dương.';
    if (spec?.stockKind === 'MIXED_UNSUPPORTED') errors[`lines.${index}.itemSpecId`] = 'Loại hàng đang có lẫn lô và món nguyên khối; cần Facility đối soát.';
    if (spec?.stockKind === 'ITEM_INSTANCE') {
      const selected = (line.itemInstanceIds || []).filter(Boolean);
      if (!selected.length) errors[`lines.${index}.itemInstanceIds`] = 'Chọn nguyên món cần xuất.';
      return { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: line.itemSpecRevision, quantity: selected.length, itemInstanceIds: selected };
    }
    const cellAllocations = (line.cellAllocations || []).filter(row => row.cellId && Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0)
      .map(row => ({ cellId: row.cellId, quantity: Number(row.quantity) }));
    if (cellAllocations.length && cellAllocations.reduce((sum, row) => sum + row.quantity, 0) !== Number(line.quantity)) errors[`lines.${index}.cellAllocations`] = 'Tổng số lượng theo ô kệ phải bằng số lượng xuất.';
    return { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: line.itemSpecRevision, quantity: Number(line.quantity),
      ...(cellAllocations.length ? { cellAllocations } : {}) };
  });
  const payload = session && context ? { accessSessionId: refId(session), sessionRevision: session.revision, skuRevision: context.stock.skuRevision, lines: normalized } : null;
  return { payload, errors };
}

export default function ManagedSelfOutboundV3({ item, rental, cellLabels = {}, onRefresh }) {
  const skuId = refId(item), reservationId = refId(rental || item?.reservationId || item?.managedReservationId);
  const [context, setContext] = useState(null), [sessions, setSessions] = useState([]), [history, setHistory] = useState([]);
  const [sessionId, setSessionId] = useState(''), [lines, setLines] = useState([]), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(() => managedInventoryV3OutboundApi.pending(skuId));
  const reload = useCallback(async () => {
    if (!skuId) return;
    setError(''); setPending(managedInventoryV3OutboundApi.pending(skuId));
    try {
      const [contextResult, sessionResult, movementResult] = await Promise.all([
        managedInventoryV3OutboundApi.context(skuId), managedAccessApi.mySessions(), managedInventoryV3Api.movements(skuId),
      ]);
      const next = contextResult.data?.data || null;
      setContext(next); setSessions(sessionResult.data?.data || []); setHistory(movementResult.data?.data || []);
      setLines(current => current.length ? current : (next?.stock?.itemSpecifications || []).filter(row => row.quantityAvailable > 0).slice(0, 1).map(makeLine));
    } catch (e) { setError(errorMessage(e)); }
  }, [skuId]);
  useEffect(() => { void reload(); }, [reload]);
  const now = Date.now();
  const usableSessions = useMemo(() => sessions.filter(row => refId(row.reservationId) === reservationId && row.status === 'ACTIVE' &&
    (row.allowedPurposes || []).includes('OUTBOUND') && Date.parse(row.startedAt) <= now && Date.parse(row.expiresAt) > now), [sessions, reservationId, now]);
  const selectedSession = usableSessions.find(row => refId(row) === sessionId);
  const stockSpecs = context?.stock?.itemSpecifications || [];
  const currentPayload = makePayload(context, selectedSession, lines);
  const updateLine = (lineId, patch) => { setPreview(null); setAttested(false); setLines(rows => rows.map(row => row.lineId === lineId ? { ...row, ...patch } : row)); };
  const addLine = () => {
    const used = new Set(lines.map(row => row.itemSpecId));
    const nextSpec = stockSpecs.find(row => row.quantityAvailable > 0 && row.stockKind !== 'MIXED_UNSUPPORTED' && !used.has(refId(row.itemSpecId)));
    if (nextSpec) setLines(rows => [...rows, makeLine(nextSpec)]);
  };
  const showPreview = async () => {
    if (busy || pending) return;
    if (Object.keys(currentPayload.errors).length) { setError('Kiểm tra phiên đến kho và các dòng hàng trước khi xem trước.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { const response = await managedInventoryV3OutboundApi.preview(skuId, currentPayload.payload); setPreview({ payload: currentPayload.payload, result: response.data?.data }); }
    catch (e) { setPreview(null); setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!preview?.payload || !attested || busy || selectedSession?.revision !== preview.payload.sessionRevision) return;
    const payload = { ...preview.payload, physicalRemovalConfirmed: true,
      customerAttestation: 'Customer xác nhận đã thực tế lấy đúng hàng khỏi các ô kệ nguồn trong phiên OUTBOUND có Nhân viên giám sát.' };
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await managedInventoryV3OutboundApi.confirm(skuId, payload);
      const result = response.data?.data;
      setPending(null); setPreview(null); setAttested(false);
      setNotice(`Đã xuất kho thành công · ${result?.movement?.movementCode || result?.movement?.id || ''}`);
      await reload(); await onRefresh?.();
    } catch (e) { setPending(managedInventoryV3OutboundApi.pending(skuId)); setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const reconcile = async () => {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try {
      const found = await managedInventoryV3OutboundApi.operation(skuId, pending.key);
      managedInventoryV3OutboundApi.clearPending(skuId); setPending(null);
      setNotice(`Đã xác minh phiếu xuất ${found.data?.data?.movement?.movementCode || 'đã được ghi nhận'}.`);
      await reload(); await onRefresh?.();
    } catch (e) {
      if (e?.response?.status === 404 && pending.payload) {
        try { await managedInventoryV3OutboundApi.confirm(skuId, pending.payload); managedInventoryV3OutboundApi.clearPending(skuId); setPending(null); setNotice('Đã gửi lại đúng thao tác đang chờ bằng cùng Idempotency-Key.'); await reload(); await onRefresh?.(); }
        catch (retryError) { setError(errorMessage(retryError)); }
      } else setError(errorMessage(e));
    } finally { setPending(managedInventoryV3OutboundApi.pending(skuId)); setBusy(false); }
  };
  const eligible = rental?.status === 'ACTIVE' && Date.parse(rental.startDate) <= now && Date.parse(rental.endDate) > now;
  const addCellRow = line => updateLine(line.lineId, { cellAllocations: [...line.cellAllocations, { cellId: '', quantity: 1 }] });
  return <section className="mt-6 space-y-5 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm" aria-label="Xuất hàng tự phục vụ">
    <header className="rounded-2xl bg-gradient-to-r from-orange-50 via-white to-emerald-50 p-5"><p className="text-xs font-bold uppercase tracking-widest text-orange-800">Kho hàng quản lý</p><h2 className="mt-1 text-xl font-bold text-emerald-950">Xuất hàng khỏi kho</h2><p className="mt-2 text-sm text-slate-600">Chọn loại hàng và số lượng. Hệ thống lấy số đo từ receipt đã nhập, chọn nguồn theo FIFO và chỉ cập nhật tồn sau khi Backend xác nhận.</p></header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {!context?.stock ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Tồn kho chưa thể đối soát an toàn. Không thể xuất khi dữ liệu đang UNKNOWN.</p> : <>
      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-3"><div><span className="text-slate-500">Đơn thuê</span><p className="font-semibold">{context.reservation?.reservationCode || rental?.reservationCode || 'Đơn thuê Managed'}</p></div><div><span className="text-slate-500">Đối soát tồn</span><p className="font-semibold">{context.stock.reconciliationStatus === 'RECONCILED' ? 'Đã đối soát' : 'Chưa đối soát'}</p></div><label>Phiên đến kho OUTBOUND<select className="mt-1 w-full rounded-lg border bg-white p-2" value={sessionId} onChange={event => { setSessionId(event.target.value); setPreview(null); setAttested(false); }}><option value="">Chọn phiên đang hoạt động</option>{usableSessions.map(session => <option key={refId(session)} value={refId(session)}>{formatInventoryDateTime(session.startedAt)} · hết hạn {formatInventoryDateTime(session.expiresAt)}</option>)}</select></label></div>
      {!eligible && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Đơn thuê chưa đủ điều kiện xuất kho hoặc đã hết hạn.</p>}
      {stockSpecs.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Chưa có Item Specification được đăng ký.</p>}
      <div className="space-y-4">{lines.map((line, index) => { const spec = stockSpecs.find(row => refId(row.itemSpecId) === line.itemSpecId); const instances = spec?.instances || []; const cells = [...new Map((spec?.receipts || []).map(receipt => [refId(receipt.cellId), { id: refId(receipt.cellId), code: receipt.cellCode }])).values()]; return <article key={line.lineId} className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Dòng hàng {index + 1}</h3>{lines.length > 1 && <button type="button" className="text-sm text-red-700 underline" onClick={() => { setLines(rows => rows.filter(row => row.lineId !== line.lineId)); setPreview(null); }}>Xóa dòng</button>}</div>
        <div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Item Specification<select className="mt-1 w-full rounded-lg border p-2" value={line.itemSpecId} onChange={event => { const next = stockSpecs.find(row => refId(row.itemSpecId) === event.target.value); updateLine(line.lineId, { itemSpecId: event.target.value, itemSpecRevision: next?.revision ?? 0, quantity: 1, cellAllocations: [], itemInstanceIds: [] }); }}><option value="">Chọn loại hàng</option>{stockSpecs.filter(row => row.quantityAvailable > 0 && row.stockKind !== 'MIXED_UNSUPPORTED').map(row => <option key={refId(row.itemSpecId)} value={refId(row.itemSpecId)}>{row.code} · {row.name}</option>)}</select>{spec?.stockKind === 'MIXED_UNSUPPORTED' && <small className="text-red-700">Cần Facility đối soát kiểu tồn trước khi xuất.</small>}</label>
          <div className="text-sm"><span className="font-medium">Tồn / đang giữ / khả dụng</span><p className="mt-2">{spec?.quantityOnHand ?? '—'} / {spec?.quantityHeld ?? '—'} / {spec?.quantityAvailable ?? '—'} {spec?.quantityUnit}</p></div>
          {spec?.stockKind !== 'ITEM_INSTANCE' && <label className="text-sm">Số lượng xuất<input type="number" min="1" step="1" max={spec?.quantityAvailable ?? undefined} className="mt-1 w-full rounded-lg border p-2" value={line.quantity} onChange={event => updateLine(line.lineId, { quantity: Number(event.target.value) })}/></label>}
        </div>
        {spec?.stockKind === 'ITEM_INSTANCE' ? <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3"><legend className="text-sm font-semibold">Chọn nguyên món (không thể xuất một phần)</legend>{instances.map(instance => <label key={instance.itemInstanceId} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={line.itemInstanceIds.includes(instance.itemInstanceId)} onChange={event => updateLine(line.lineId, { itemInstanceIds: event.target.checked ? [...line.itemInstanceIds, instance.itemInstanceId] : line.itemInstanceIds.filter(value => value !== instance.itemInstanceId), quantity: event.target.checked ? line.itemInstanceIds.length + 1 : Math.max(1, line.itemInstanceIds.length - 1) })}/><span>{instance.itemInstanceId} · {instance.allocations.map(row => cellLabels[refId(row.cellId)] || row.cellCode || refId(row.cellId)).join(', ')} · {instance.weightKg} kg / {instance.volumeM3} m³</span></label>)}</fieldset> : <div className="space-y-2 rounded-lg bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">Nguồn sẽ chọn theo FIFO từ receipt cũ nhất. Có thể giới hạn nguồn ở các Cell cụ thể.</p><button type="button" className="text-sm font-semibold text-emerald-800 underline" onClick={() => addCellRow(line)}>Chọn Cell nguồn</button></div>{line.cellAllocations.map((allocation, allocationIndex) => <div key={allocationIndex} className="grid gap-2 sm:grid-cols-[1fr_130px_auto]"><select className="rounded border p-2 text-sm" value={allocation.cellId} onChange={event => updateLine(line.lineId, { cellAllocations: line.cellAllocations.map((row, i) => i === allocationIndex ? { ...row, cellId: event.target.value } : row) })}><option value="">Chọn Cell</option>{cells.map(cell => <option key={cell.id} value={cell.id}>{cellLabels[cell.id] || cell.code || cell.id}</option>)}</select><input type="number" min="1" step="1" aria-label={`Số lượng ở Cell ${allocationIndex + 1}`} className="rounded border p-2 text-sm" value={allocation.quantity} onChange={event => updateLine(line.lineId, { cellAllocations: line.cellAllocations.map((row, i) => i === allocationIndex ? { ...row, quantity: Number(event.target.value) } : row) })}/><button type="button" className="text-sm text-red-700" onClick={() => updateLine(line.lineId, { cellAllocations: line.cellAllocations.filter((_, i) => i !== allocationIndex) })}>Bỏ Cell</button></div>)}</div>}
      </article>; })}</div>
      <button type="button" onClick={addLine} disabled={lines.length >= 50 || stockSpecs.filter(row => row.quantityAvailable > 0 && row.stockKind !== 'MIXED_UNSUPPORTED').every(row => lines.some(line => line.itemSpecId === refId(row.itemSpecId)))} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50">+ Thêm loại hàng</button>
      {pending && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-semibold">Phiếu xuất đang cần đối soát</h3><p className="mt-1 text-sm">Giữ nguyên Idempotency-Key. Không bắt đầu phiếu mới nếu kết quả chưa xác định.</p><button type="button" disabled={busy} onClick={reconcile} className="mt-2 rounded border border-amber-900 px-3 py-2 text-sm font-semibold">Đối soát / gửi lại đúng thao tác</button></section>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !!pending || !eligible || Object.keys(currentPayload.errors).length > 0} onClick={showPreview} className="rounded-lg bg-emerald-900 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Đang kiểm tra…' : 'Xem trước phiếu xuất'}</button></div>
      {preview?.result && <section className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4"><h3 className="font-semibold">Xem trước — chưa ghi biến động tồn</h3>{preview.result.lines.map(line => <article key={refId(line.itemSpecId)} className="rounded-lg bg-white p-3 text-sm"><strong>{line.code} · {line.name}</strong><p>Tồn {line.quantityBefore} · xuất {line.quantityOut} · còn {line.quantityAfter} · giảm {line.weightRemovedKg} kg / {line.volumeRemovedM3} m³</p>{line.sources.map((source, sourceIndex) => <p key={`${source.receiptId}:${source.cellId}:${sourceIndex}`} className="text-xs text-slate-700">{source.receiptId} · {cellLabels[refId(source.cellId)] || source.cellCode || refId(source.cellId)} · {source.quantity} {line.quantityUnit} · {source.weightRemovedKg} kg / {source.volumeRemovedM3} m³</p>)}</article>)}<p className="font-semibold">Tổng {preview.result.totalQuantity} món · {preview.result.totalWeightKg} kg · {preview.result.totalVolumeM3} m³</p><p className="text-xs text-slate-600">Phiên OUTBOUND hết hạn: {formatInventoryDateTime(preview.result.accessSession.expiresAt)}. Backend sẽ xác minh lại mọi revision khi xác nhận.</p><label className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm"><input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)}/><span>Tôi đã thực tế lấy đúng các món hàng ở trên khỏi Cell nguồn trong phiên có Nhân viên giám sát.</span></label><button type="button" disabled={busy || !attested || !selectedSession || Date.parse(selectedSession.expiresAt) <= Date.now()} onClick={confirm} className="rounded-lg bg-orange-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Đang xác nhận…' : 'Xác nhận xuất kho'}</button></section>}
      <section className="rounded-xl border p-4"><h3 className="font-semibold">Tồn kho thực tế</h3>{stockSpecs.map(spec => <article key={refId(spec.itemSpecId)} className="mt-2 rounded-lg bg-slate-50 p-3 text-sm"><strong>{spec.code} · {spec.name}</strong><p>{spec.quantityOnHand} còn · giữ {spec.quantityHeld} · khả dụng {spec.quantityAvailable} {spec.quantityUnit}</p>{spec.receipts.map(receipt => <p key={`${receipt.receiptId}:${receipt.cellId}`} className="text-xs text-slate-600">{receipt.receiptId} · {cellLabels[refId(receipt.cellId)] || receipt.cellCode || refId(receipt.cellId)} · {receipt.quantityOnHand} món · giữ {receipt.quantityHeld} · {receipt.unitWeightKg} kg/món</p>)}{spec.instances.map(instance => <p key={instance.itemInstanceId} className="text-xs text-slate-600">{instance.itemInstanceId} · {instance.allocations.map(row => cellLabels[refId(row.cellId)] || row.cellCode || refId(row.cellId)).join(', ')} · nguyên món</p>)}</article>)}</section>
      <section className="rounded-xl border p-4"><h3 className="font-semibold">Lịch sử nhập / xuất</h3>{history.length ? history.map(movement => <article key={refId(movement)} className="mt-2 rounded-lg bg-slate-50 p-3 text-sm"><strong>{movement.type === 'OUTBOUND' ? 'Phiếu xuất kho' : movement.type === 'INBOUND' ? 'Phiếu nhập kho' : 'Di chuyển tồn kho'}</strong><p>{movement.movementCode || refId(movement)} · {formatInventoryDateTime(movement.performedAt)} · {movement.quantity} {movement.quantityUnit}</p></article>) : <p className="mt-2 text-sm text-slate-600">Chưa có lịch sử xuất kho.</p>}<button type="button" disabled={busy} onClick={reload} className="mt-3 text-sm font-semibold text-emerald-800 underline">Làm mới tồn kho và lịch sử</button></section>
    </>}
  </section>;
}
