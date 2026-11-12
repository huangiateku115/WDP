import {facilityLabel} from '@/lib/facilityLabels';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { inventoryApi } from '@/api/inventoryApi';
import { useAuthSession, getAccessToken } from '@/lib/authSession';
import { inventoryId, inventoryRecord, validInventoryId } from '@/lib/inventoryRegistration';
import { inventoryMovements } from '@/lib/inventoryMovementHistory';
import { MovementMeasurements } from '@/pages/customer/InventoryHistoryPage';
import { Screen, Panel, Input, Button, Message, Select, OpenLink } from '@/components/manager/ManagerUI';

export default function MovementHistoryPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { user, accessToken } = useAuthSession();
  const requestedId = id || params.get('itemId') || '';
  const [input, setInput] = useState(requestedId);
  const [result, setResult] = useState(null);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    setInput(requestedId);
    setResult(null);
    setError('');
    setLoading(false);
    if (!requestedId) return;
    const version = ++request.current;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        if (!validInventoryId(requestedId)) throw Error("Nhập mã mặt hàng hợp lệ.");
        const item = inventoryRecord(await inventoryApi.get(requestedId, { signal: controller.signal }));
        if (inventoryId(item) !== requestedId || inventoryId(item.facilityId) !== inventoryId(user?.assignedFacilityId)) {
          throw Error('This Item is outside your assigned Facility.');
        }
        const response = await inventoryApi.movements(requestedId, { signal: controller.signal });
        const movements = inventoryMovements(response, item);
        if (!controller.signal.aborted && version === request.current && accessToken === getAccessToken()) {
          setResult({ item, movements });
        }
      } catch (failure) {
        if (!controller.signal.aborted && version === request.current && accessToken === getAccessToken()) {
          setError(failure.response?.data?.message || failure.message);
        }
      } finally {
        if (!controller.signal.aborted && version === request.current) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [requestedId, accessToken, user?.assignedFacilityId, params.get('refresh')]);

  function find(event) {
    event.preventDefault();
    setParams({ itemId: input.trim(), refresh: String(Date.now()) });
  }

  const cell = value => inventoryId(value) || 'Outside / no Cell';
  const rows = result?.movements.filter(movement => !type || movement.type === type) || [];
  return <Screen title="Lịch sử biến động mặt hàng" notice="Biến động hàng đã hoàn tất trên máy chủ trong cơ sở được phân công.">
    <Panel title="Tìm mặt hàng">
      <form onSubmit={find} className="flex flex-wrap gap-3">
        <Input aria-label="Mã mặt hàng" value={input} onChange={event => setInput(event.target.value.trim())} disabled={!!id} />
        <Button disabled={loading}>{loading ? "Đang tải…" : "Tải / cập nhật lịch sử"}</Button>
      </form>
    </Panel>
    <Message error={error} />
    {loading && <p role="status">Đang tải lịch sử biến động…</p>}
    {result && <Panel title={`${result.item.itemCode} · ${result.item.name}`}>
      <OpenLink to={`/staff/inventory/stock?itemId=${requestedId}`}>Xem tồn kho</OpenLink>
      <div className="my-4"><Select label="Loại biến động" value={type} onChange={setType} options={[
        ['', "Tất cả loại biến động"], 'INBOUND', 'OUTBOUND', 'RELOCATION',
      ]} /></div>
      {!rows.length && <p>Không có biến động hoàn tất phù hợp bộ lọc.</p>}
      <div className="space-y-4">{rows.map(movement => <article key={inventoryId(movement)} className="rounded-xl border p-4">
        <h3 className="font-semibold">{facilityLabel(movement.type)} · {movement.quantity} {facilityLabel(movement.quantityUnit)}</h3>
        <p className="mt-2 break-all text-sm">Mã biến động {inventoryId(movement)}</p>
        <p className="break-all text-sm">Từ {cell(movement.sourceCellId)} → Đến {cell(movement.destinationCellId)}</p>
        <p className="text-sm">{new Date(movement.performedAt).toLocaleString('vi-VN')}</p>
        <p className="break-all text-sm">Người thực hiện {inventoryId(movement.performedBy) || "Máy chủ chưa trả dữ liệu"}</p>
        <p className="my-2 whitespace-pre-wrap text-sm">{movement.inspectionNote || movement.handoverNote || movement.relocationNote}</p>
        <MovementMeasurements movement={movement} />
      </article>)}</div>
    </Panel>}
  </Screen>;
}
