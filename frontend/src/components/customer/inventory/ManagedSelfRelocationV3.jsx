import { useCallback, useEffect, useState } from 'react';
import { managedAccessApi, notifyManagedAccessSessionUpdated } from '@/api/managedAccessApi';
import { managedInventoryV3Api } from '@/api/managedInventoryV3Api';
import { managedInventoryV3RelocationApi } from '@/api/managedInventoryV3RelocationApi';
import warehouseMapApi from '@/api/warehouseMapApi';
import { formatInventoryDateTime } from './inventoryUiFormat';
import { Link } from 'react-router-dom';

const ref = value => String(value?._id || value?.id || value || '');
const newId = () => globalThis.crypto?.randomUUID?.() || `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const message = error => error?.response?.data?.message || error?.message || 'Không thể chuyển vị trí hàng hóa.';
const lineTemplate = () => ({ lineId: newId(), itemSpecId: '', stockKind: '', sourceCellId: '', sourceReservationId: '', destinationCellId: '', destinationReservationId: '', quantity: 1, itemInstanceId: '', destinationAllocations: [] });
const availableStockKinds = spec => [
  ...(spec?.receipts?.some(row => Number(row.quantityAvailable) > 0) ? ['LOT'] : []),
  ...(spec?.instances?.some(row => Number(row.quantity) === 1) ? ['INSTANCE'] : []),
];
const preferredStockKind = spec => availableStockKinds(spec)[0] || '';

export default function ManagedSelfRelocationV3({ item, rental, onRefresh, initialSessionId = '' }) {
  const skuId = ref(item);
  const [context, setContext] = useState(null), [sessions, setSessions] = useState([]), [sessionId, setSessionId] = useState('');
  const [lines, setLines] = useState([lineTemplate()]), [notes, setNotes] = useState(''), [attested, setAttested] = useState(false);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState(() => managedInventoryV3RelocationApi.pending(skuId));
  const reload = useCallback(async () => {
    setError(''); setPreview(null); setPending(managedInventoryV3RelocationApi.pending(skuId));
    try {
      const [contextResponse, sessionsResponse] = await Promise.all([managedInventoryV3RelocationApi.context(skuId), managedAccessApi.mySessions()]);
      const next = contextResponse.data?.data;
      if (ref(next?.sku?.id) !== skuId) throw new Error('Dữ liệu tồn kho không khớp mặt hàng đang mở.');
      setContext(next); setSessions(sessionsResponse.data?.data || []);
      setLines(current => current.map(line => {
        if (line.itemSpecId) return line;
        const first = next.itemSpecifications?.find(spec => spec.availableQuantity > 0);
        return first ? { ...line, itemSpecId: ref(first.itemSpecId), stockKind: preferredStockKind(first) } : line;
      }));
    } catch (failure) { setError(message(failure)); }
  }, [skuId]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { const refreshSession = () => { void managedAccessApi.mySessions().then(response => setSessions(response.data?.data || [])).catch(() => {}); }; window.addEventListener('managed-access-session-updated', refreshSession); return () => window.removeEventListener('managed-access-session-updated', refreshSession); }, []);

  const specs = context?.itemSpecifications || [], cells = context?.cells || [];
  const sessionsForScope = sessions.filter(session => session.status === 'ACTIVE' && session.allowedPurposes?.includes('RELOCATION') &&
    Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > Date.now());
  useEffect(() => { if (!sessionId && initialSessionId && sessionsForScope.some(session => ref(session) === initialSessionId)) setSessionId(initialSessionId); }, [initialSessionId, sessionId, sessionsForScope]);
  const chosenSession = sessionsForScope.find(session => ref(session) === sessionId);
  const reservationsForScope = context?.reservations || [];
  const sourceReservationForVisit = ref(rental || item?.reservationId || item?.managedReservationId);
  const visitBookingUrl = `/portal/managed-access?reservationId=${encodeURIComponent(sourceReservationForVisit)}`;
  const neededCellIds = [...new Set(lines.flatMap(line => {
    const selectedSpec = specs.find(row => ref(row.itemSpecId) === line.itemSpecId);
    const selectedInstance = line.stockKind === 'INSTANCE' && selectedSpec?.instances?.find(row => row.itemInstanceId === line.itemInstanceId);
    return selectedInstance
      ? [...(selectedInstance.allocations || []).map(allocation => ref(allocation.cellId)), ...line.destinationAllocations.map(allocation => allocation.cellId).filter(Boolean)]
      : [line.sourceCellId, line.destinationCellId].filter(Boolean);
  }))];
  const neededReservationIds = [...new Set(lines.flatMap(line => [line.sourceReservationId, line.destinationReservationId, ...line.destinationAllocations.map(row => row.reservationId)].filter(Boolean)))];
  const scopedReservationIds = (chosenSession?.scopedReservationIds || [chosenSession?.reservationId]).map(ref);
  const chosenSessionCoversSelectedCells = !!chosenSession && neededCellIds.length > 0 && neededCellIds.every(cellId => (chosenSession.allowedCellIds || []).map(ref).includes(cellId)) && neededReservationIds.every(id => scopedReservationIds.includes(id));
  const canUseRental = rental?.status === 'ACTIVE' && Date.parse(rental.startDate) <= Date.now() && Date.parse(rental.endDate) > Date.now();
  const patchLine = (lineId, patch) => { setPreview(null); setLines(rows => rows.map(line => line.lineId === lineId ? { ...line, ...patch } : line)); };
  const payloadLines = lines.map(line => {
    const spec = specs.find(row => ref(row.itemSpecId) === line.itemSpecId), unitStock = line.stockKind;
    if (!spec) return null;
    if (unitStock === 'INSTANCE') return line.itemInstanceId ? { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: spec.revision,
      sourceReservationId: line.sourceReservationId || spec.instances.find(row => row.itemInstanceId === line.itemInstanceId)?.reservationId,
      destinationReservationId: line.destinationReservationId,
      quantity: 1, itemInstanceId: line.itemInstanceId, destinationAllocations: line.destinationAllocations } : null;
    return line.sourceCellId && line.destinationCellId && Number.isSafeInteger(Number(line.quantity)) && Number(line.quantity) > 0
      ? { lineId: line.lineId, itemSpecId: line.itemSpecId, itemSpecRevision: spec.revision, sourceCellId: line.sourceCellId, destinationCellId: line.destinationCellId,
        sourceReservationId: line.sourceReservationId, destinationReservationId: line.destinationReservationId, quantity: Number(line.quantity) } : null;
  });
  const allLinesValid = payloadLines.length > 0 && payloadLines.every(Boolean);
  const payload = chosenSessionCoversSelectedCells && context ? { accessSessionId: ref(chosenSession), sessionRevision: chosenSession.revision, skuRevision: context.sku.revision,
    lines: payloadLines, notes: notes.trim(), customerAttestation: attested ? 'CONFIRMED' : 'NOT_CONFIRMED' } : null;

  const fetchPreview = async () => {
    if (!canUseRental || !payload || !allLinesValid) { setError(chosenSession && !chosenSessionCoversSelectedCells
      ? 'Phiên RELOCATION đã chọn chưa bao phủ tất cả ô nguồn và ô đích. Hãy chọn phiên có đúng phạm vi hoặc đặt lại lịch.'
      : 'Chọn đơn thuê đang hoạt động, phiên đến kho còn quyền di chuyển hàng và hoàn tất các dòng chuyển.'); return; }
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try { const response = await managedInventoryV3RelocationApi.preview(skuId, payload); setPreview({ payload, result: response.data?.data }); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  const confirm = async candidate => {
    if (!candidate || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await managedInventoryV3RelocationApi.confirm(skuId, candidate), result = response.data?.data;
      notifyManagedAccessSessionUpdated(candidate.accessSessionId);
      if (result?.status !== 'COMMITTED' || result?.movement?.type !== 'RELOCATION' || result?.movement?.stockEffect?.action !== 'MOVE') throw new Error('Chưa xác nhận được kết quả phiếu chuyển.');
      managedInventoryV3RelocationApi.clearPending(skuId); setPending(null); setPreview(null); setNotes(''); setAttested(false);
      setNotice(`Đã chuyển hàng thành công. Mã phiếu ${result.movementCode || result.movementId || 'đã được ghi nhận'}.`);
      const facilityId = ref(rental?.facilityId || item?.facilityId || item?.managedReservationId?.facilityId);
      await Promise.all([
        reload(),
        managedInventoryV3Api.stock(skuId),
        managedInventoryV3Api.cellStock(skuId),
        ...specs.map(spec => managedInventoryV3Api.itemSpecificationStock(skuId, ref(spec.itemSpecId))),
        managedInventoryV3Api.movements(skuId),
        facilityId && /^[a-f\d]{24}$/i.test(facilityId)
          ? warehouseMapApi.getWarehouseMap(facilityId)
          : Promise.resolve(null),
      ]);
      onRefresh?.();
    } catch (failure) { setPending(managedInventoryV3RelocationApi.pending(skuId)); setError(message(failure)); }
    finally { setBusy(false); }
  };
  const recover = async () => {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try { const response = await managedInventoryV3RelocationApi.operation(skuId, pending.key), result = response.data?.data;
      notifyManagedAccessSessionUpdated(pending.payload?.accessSessionId);
      managedInventoryV3RelocationApi.clearPending(skuId); setPending(null); setNotice(`Đã đối soát phiếu chuyển ${result?.movementCode || ref(result?.movement) || 'đã được ghi nhận'}.`); await reload(); onRefresh?.();
    } catch (failure) { setError(failure?.response?.status === 404 ? 'Chưa tìm thấy kết quả đã commit. Có thể gửi lại đúng phiếu đang lưu bằng cùng mã đối soát.' : message(failure)); }
    finally { setBusy(false); }
  };
  const retry = () => pending?.payload && confirm(pending.payload);

  return <section className="mt-6 space-y-4 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm" aria-labelledby="managed-relocation-title">
    <header><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Kho hàng Managed</p><h2 id="managed-relocation-title" className="mt-1 text-xl font-bold text-slate-900">Chuyển vị trí hàng hóa</h2>
      <p className="mt-1 text-sm text-slate-600">Chuyển một phần hàng theo lô hoặc chuyển trọn món hàng giữa các ô đã cấp của những đơn thuê kho quản lý đang hoạt động tại cùng cơ sở. Lượt đến kho sẽ áp dụng cho các đơn thuê đủ điều kiện tại thời điểm đặt lịch.</p>
      <p className="mt-1 text-sm text-amber-800">Đơn thuê nhận hàng phải còn ít nhất {context?.minimumDestinationRemainingDays || 7} ngày thuê khi xác nhận. Bạn vẫn có thể chuyển hàng ra khỏi đơn thuê sắp hết hạn.</p></header>
    <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3"><div><span className="text-slate-500">Đơn thuê</span><p className="font-semibold">{rental?.reservationCode || 'Đơn thuê đã liên kết'}</p></div>
      <div><span className="text-slate-500">Trạng thái</span><p className="font-semibold">{canUseRental ? 'Đang thuê' : 'Chưa đủ điều kiện chuyển'}</p></div>
      <label>Phiên đến kho<select className="mt-1 w-full rounded-lg border bg-white p-2" value={sessionId} onChange={event => { setSessionId(event.target.value); setPreview(null); }}><option value="">Chọn phiên đang hoạt động có quyền di chuyển hàng</option>
        {sessionsForScope.map(session => <option key={ref(session)} value={ref(session)}>{formatInventoryDateTime(session.startedAt)} · hết hạn {formatInventoryDateTime(session.expiresAt)}</option>)}</select></label></div>
    {!sessionsForScope.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Cần đặt lượt đến kho và được nhân viên xác nhận. Phiên đến kho sẽ áp dụng cho các đơn thuê kho quản lý đang hoạt động tại cùng cơ sở.</p>}
    {reservationsForScope.length > 1 && <Link className="inline-flex rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-900" to={visitBookingUrl}>Đặt lượt đến kho để chuyển giữa các đơn thuê cùng cơ sở</Link>}
    {pending && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><strong>Phiếu chuyển cần đối soát</strong><p className="mt-1">Không tạo phiếu mới; hãy kiểm tra kết quả hoặc gửi lại chính yêu cầu đã lưu.</p><div className="mt-2 flex gap-2"><button type="button" className="rounded border bg-white px-3 py-2" disabled={busy} onClick={recover}>Đối soát kết quả</button><button type="button" className="rounded border bg-white px-3 py-2" disabled={busy || !pending.payload} onClick={retry}>Gửi lại đúng yêu cầu đang chờ</button></div></div>}
    {context && <div className="space-y-4">{lines.map((line, index) => {
      const spec = specs.find(row => ref(row.itemSpecId) === line.itemSpecId), stockKinds = availableStockKinds(spec), instanceMode = line.stockKind === 'INSTANCE';
      const sources = instanceMode ? [] : [...new Map((spec?.receipts || []).filter(row => row.quantityAvailable > 0).map(row => [`${ref(row.reservationId)}:${ref(row.cellId)}`, row])).values()];
      const sourceReceipts = (spec?.receipts || []).filter(row => ref(row.cellId) === line.sourceCellId && ref(row.reservationId) === line.sourceReservationId && row.quantityAvailable > 0);
      const available = sourceReceipts.reduce((sum, row) => sum + row.quantityAvailable, 0);
      return <article key={line.lineId} className="space-y-3 rounded-xl border p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Dòng chuyển {index + 1}</h3>
        {lines.length > 1 && <button type="button" className="text-sm text-red-700 underline" onClick={() => { setLines(rows => rows.filter(row => row.lineId !== line.lineId)); setPreview(null); }}>Xóa dòng</button>}</div>
        <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Loại hàng<select className="mt-1 w-full rounded-lg border p-2" value={line.itemSpecId} onChange={event => { const selected = specs.find(row => ref(row.itemSpecId) === event.target.value); patchLine(line.lineId, { itemSpecId: event.target.value, stockKind: preferredStockKind(selected), sourceCellId: '', destinationCellId: '', itemInstanceId: '', destinationAllocations: [] }); }}>
          <option value="">Chọn quy cách hàng</option>{specs.filter(row => row.availableQuantity > 0).map(row => <option key={ref(row.itemSpecId)} value={ref(row.itemSpecId)}>{row.code} · {row.name} · khả dụng {row.availableQuantity} {row.quantityUnit}</option>)}</select></label>
          {stockKinds.length > 1 && <label className="text-sm">Cách chuyển<select className="mt-1 w-full rounded-lg border p-2" value={line.stockKind} onChange={event => patchLine(line.lineId, { stockKind: event.target.value, sourceCellId: '', destinationCellId: '', itemInstanceId: '', destinationAllocations: [] })}><option value="LOT">Theo số lượng trong lô</option><option value="INSTANCE">Món nguyên vẹn</option></select></label>}
          {instanceMode ? <label className="text-sm">Món nguyên vẹn<select className="mt-1 w-full rounded-lg border p-2" value={line.itemInstanceId} onChange={event => { const selected = spec.instances.find(row => row.itemInstanceId === event.target.value), target = cells.find(cell => !selected?.allocations?.some(allocation => ref(allocation.cellId) === ref(cell.id))); patchLine(line.lineId, { itemInstanceId: event.target.value, sourceReservationId: selected?.reservationId || '', destinationAllocations: selected && target ? [{ cellId: ref(target.id), reservationId: ref(target.reservationId), weightKg: selected.weightKg, volumeM3: selected.volumeM3 }] : [] }); }}>
            <option value="">Chọn món cần chuyển</option>{spec.instances.map((row, instanceIndex) => <option key={row.itemInstanceId} value={row.itemInstanceId}>Món nguyên vẹn {instanceIndex + 1} · {row.weightKg} kg · {row.volumeM3} m³ · đang ở {(row.allocations || []).map(a => a.cellCode || 'Chưa có thông tin vị trí').join(', ')}</option>)}</select></label>
            : <label className="text-sm">Ô nguồn<select className="mt-1 w-full rounded-lg border p-2" value={line.sourceReservationId && line.sourceCellId ? `${line.sourceReservationId}:${line.sourceCellId}` : ''} onChange={event => { const [sourceReservationId, sourceCellId] = event.target.value.split(':'); patchLine(line.lineId, { sourceReservationId: sourceReservationId || '', sourceCellId: sourceCellId || '', destinationCellId: '', destinationReservationId: '', quantity: 1 }); }}><option value="">Chọn ô đang có hàng</option>{sources.map(row => <option key={`${ref(row.reservationId)}:${ref(row.cellId)}`} value={`${ref(row.reservationId)}:${ref(row.cellId)}`}>{row.reservationCode || 'Đơn thuê'} · {row.cellCode || 'Chưa có thông tin vị trí'} · khả dụng {row.quantityAvailable}</option>)}</select></label>}
        </div>
          {instanceMode ? line.itemInstanceId && <div className="rounded-lg bg-blue-50 p-3 text-sm"><p>Món nguyên vẹn luôn chuyển với số lượng 1; không thể chia nhỏ.</p><p className="mt-1">Phân bổ tải tại các ô đích phải giữ đúng tổng {spec.instances.find(row => row.itemInstanceId === line.itemInstanceId)?.weightKg} kg và {spec.instances.find(row => row.itemInstanceId === line.itemInstanceId)?.volumeM3} m³.</p>
          {line.destinationAllocations.map((allocation, allocationIndex) => <div key={`${line.lineId}-${allocationIndex}`} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><label>Ô đích<select className="mt-1 w-full rounded border p-2" value={allocation.reservationId && allocation.cellId ? `${allocation.reservationId}:${allocation.cellId}` : ''} onChange={event => { const [targetReservationId, targetCellId] = event.target.value.split(':'); patchLine(line.lineId, { destinationReservationId: targetReservationId || '', destinationAllocations: line.destinationAllocations.map((row, i) => i === allocationIndex ? { ...row, reservationId: targetReservationId || '', cellId: targetCellId || '' } : row) }); }}><option value="">Chọn ô đích</option>{cells.filter(cell => !line.destinationAllocations.some((row, i) => i !== allocationIndex && row.cellId === ref(cell.id))).map(cell => <option key={`${ref(cell.reservationId)}:${ref(cell.id)}`} disabled={!cell.canReceiveRelocation} value={`${ref(cell.reservationId)}:${ref(cell.id)}`}>{cell.reservationCode} · {cell.code} · {cell.canReceiveRelocation ? `còn ${Math.max(0, cell.maxWeightKg - cell.usedWeightKg)} kg / ${Math.max(0, cell.maxVolumeM3 - cell.usedVolumeM3)} m³` : 'không đủ 7 ngày thuê để nhận hàng'}</option>)}</select></label>
            <label>Tải trọng kg<input type="number" min="0.001" step="0.001" className="mt-1 w-full rounded border p-2" value={allocation.weightKg} onChange={event => patchLine(line.lineId, { destinationAllocations: line.destinationAllocations.map((row, i) => i === allocationIndex ? { ...row, weightKg: Number(event.target.value) } : row) })}/></label>
            <label>Thể tích m³<input type="number" min="0.000001" step="0.000001" className="mt-1 w-full rounded border p-2" value={allocation.volumeM3} onChange={event => patchLine(line.lineId, { destinationAllocations: line.destinationAllocations.map((row, i) => i === allocationIndex ? { ...row, volumeM3: Number(event.target.value) } : row) })}/></label>
            {line.destinationAllocations.length > 1 && <button type="button" className="self-end rounded border px-3 py-2" onClick={() => patchLine(line.lineId, { destinationAllocations: line.destinationAllocations.filter((_, i) => i !== allocationIndex) })}>Gỡ</button>}</div>)}
          <button type="button" className="mt-2 rounded border bg-white px-3 py-2" onClick={() => patchLine(line.lineId, { destinationAllocations: [...line.destinationAllocations, { cellId: '', weightKg: 0, volumeM3: 0 }] })}>Thêm ô đích</button></div>
          : <div className="grid gap-3 md:grid-cols-3"><label className="text-sm">Số lượng chuyển<input type="number" min="1" step="1" max={available} className="mt-1 w-full rounded-lg border p-2" value={line.quantity} onChange={event => patchLine(line.lineId, { quantity: Number(event.target.value) })}/><small className="text-slate-500">Khả dụng tại nguồn: {available} {spec?.quantityUnit}</small></label>
            <label className="text-sm">Ô đích<select className="mt-1 w-full rounded-lg border p-2" value={line.destinationReservationId && line.destinationCellId ? `${line.destinationReservationId}:${line.destinationCellId}` : ''} onChange={event => { const [destinationReservationId, destinationCellId] = event.target.value.split(':'); patchLine(line.lineId, { destinationReservationId: destinationReservationId || '', destinationCellId: destinationCellId || '' }); }}><option value="">Chọn ô đã cấp</option>{cells.filter(cell => ref(cell.id) !== line.sourceCellId).map(cell => <option key={`${ref(cell.reservationId)}:${ref(cell.id)}`} disabled={!cell.canReceiveRelocation} value={`${ref(cell.reservationId)}:${ref(cell.id)}`}>{cell.reservationCode} · {cell.code} · {cell.canReceiveRelocation ? `tải ${cell.usedWeightKg}/${cell.maxWeightKg} kg · thể tích ${cell.usedVolumeM3}/${cell.maxVolumeM3} m³` : 'không đủ 7 ngày thuê để nhận hàng'}</option>)}</select></label>
            <p className="self-center text-sm text-slate-600">Khối lượng và thể tích lấy từ từng lô hàng, không tính lại theo thông số hiện tại.</p></div>}
      </article>;
    })}
      <button type="button" className="rounded-lg border px-4 py-2 text-sm" disabled={!specs.length} onClick={() => { setLines(rows => [...rows, lineTemplate()]); setPreview(null); }}>Thêm dòng chuyển</button>
      <label className="block text-sm">Ghi chú<textarea maxLength="1000" className="mt-1 w-full rounded-lg border p-2" rows="2" value={notes} onChange={event => { setNotes(event.target.value); setPreview(null); }}/></label>
      <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><input type="checkbox" checked={attested} onChange={event => { setAttested(event.target.checked); setPreview(null); }}/><span>Tôi đã trực tiếp thực hiện việc chuyển hàng theo phiếu này tại kho trong phiên có nhân viên hỗ trợ. Tôi hiểu hệ thống kiểm tra dung lượng số học, còn cách sắp xếp thực tế cần bảo đảm an toàn tại chỗ.</span></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded-lg border px-4 py-2" disabled={busy || !payload || !allLinesValid} onClick={fetchPreview}>{busy ? 'Đang xử lý…' : 'Xem trước phiếu chuyển'}</button>
        <button type="button" className="rounded-lg bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !preview?.result?.canConfirm || !attested} onClick={() => confirm(preview.payload)}>Xác nhận chuyển vị trí</button>
        <button type="button" className="rounded-lg border px-4 py-2" disabled={busy} onClick={reload}>Tải lại tồn và vị trí</button></div>
    </div>}
    {preview?.result && <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"><h3 className="font-semibold">Xem trước · {preview.result.totalQuantity} món · {preview.result.totalWeightKg} kg · {preview.result.totalVolumeM3} m³</h3>
      {preview.result.lines.map(line => <article key={line.lineId} className="rounded-lg bg-white p-3"><strong>{line.itemSpecName} · {line.quantity} · {line.weightKg} kg / {line.volumeM3} m³</strong>
        <p className="mt-1">Nguồn: {line.source.map(row => `${row.cellCode || 'Chưa có thông tin vị trí'}${row.quantity ? ` · ${row.quantity}` : ''}`).join(', ')}</p><p>Đích: {line.destination.map(row => `${row.cellCode || 'Chưa có thông tin vị trí'}${row.quantity ? ` · ${row.quantity}` : ''}`).join(', ')}</p></article>)}
      <p className="font-medium">Sức chứa được kiểm tra tại các vị trí và theo dung lượng đơn thuê nguồn, đơn thuê nhận hàng.</p></div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  </section>;
}
