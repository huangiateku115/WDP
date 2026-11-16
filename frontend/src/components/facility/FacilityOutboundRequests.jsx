import { useCallback } from 'react';
import { managedInventoryV3Api } from '@/api/managedInventoryV3Api';
import useFacilityResource from '@/lib/useFacilityResource';

const date = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có thời gian';
const refId = value => String(value?._id ?? value?.id ?? value ?? '');

/** Facility view is read-only: Staff escorts and monitors; Customer confirms stock removal. */
export default function FacilityOutboundRequests({ role, facilityId }) {
  const load = useCallback(async () => {
    const response = await managedInventoryV3Api.facilityOverview();
    const body = response.data?.data || {};
    if (String(body.facilityId) !== String(facilityId)) throw new Error('Facility scope không khớp.');
    const rows = (body.rows || []).flatMap(row => (row.recentMovements || [])
      .filter(movement => movement.type === 'OUTBOUND' && movement.schemaVersion === 4 && movement.stockEffect?.action === 'REMOVE')
      .map(movement => ({ sku: row.item, movement })));
    return rows.sort((a, b) => Date.parse(b.movement.performedAt) - Date.parse(a.movement.performedAt));
  }, [facilityId]);
  const resource = useFacilityResource(load);
  return <section className="min-w-0 rounded-xl border bg-white p-4" aria-label="Lịch sử xuất kho">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Lịch sử Customer xuất kho</h2><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={resource.loading} onClick={resource.reload}>Tải lại lịch sử</button></div>
    <p className="mt-2 text-sm text-slate-600">{role === 'staff' ? 'Theo dõi hoạt động xuất kho trong Facility được phân công.' : 'Giám sát Movement OUT đã được Customer xác nhận.'} Staff hộ tống và hỗ trợ an toàn; không tự xác nhận hoặc giảm tồn.</p>
    {resource.loading && <p role="status" className="mt-3">Đang tải lịch sử xuất kho…</p>}
    {resource.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">Không tải được lịch sử xuất kho. {resource.error}</p>}
    {!resource.loading && !resource.error && resource.data?.length === 0 && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Chưa có Movement OUT đã xác nhận.</p>}
    {!resource.loading && !resource.error && <div className="mt-3 space-y-3">{(resource.data || []).map(({ sku, movement }) => <article key={refId(movement)} className="rounded-lg border p-3">
      <div className="flex flex-wrap justify-between gap-2"><strong>{sku?.name || sku?.itemCode || 'SKU Managed'} · {movement.quantity} {movement.quantityUnit}</strong><span className="text-sm">{date(movement.performedAt)}</span></div>
      <p className="mt-1 break-all text-xs text-slate-600">{movement.movementCode || refId(movement)} · Reservation {refId(movement.managedReservationId)}</p>
      <div className="mt-2 space-y-1 text-sm">{(movement.stockEffect?.source || []).map((line, index) => <p key={`${line.receiptId}:${line.cellId}:${index}`}>Cell {refId(line.cellId)} · {line.quantity} {line.quantityUnitSnapshot || movement.quantityUnit} · receipt {line.receiptId} · {line.allocatedWeightKg} kg / {line.allocatedVolumeM3} m³</p>)}</div>
      <p className="mt-2 text-xs text-slate-600">Customer attestation: {movement.inspectionNote || 'Không có nội dung attestation.'}</p>
    </article>)}</div>}
  </section>;
}
