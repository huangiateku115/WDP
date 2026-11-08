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
        if (!validInventoryId(requestedId)) throw Error('Enter a valid inventory Item ID.');
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
  return <Screen title="Item movement history" notice="Completed backend movements for your assigned Facility.">
    <Panel title="Find an inventory Item">
      <form onSubmit={find} className="flex flex-wrap gap-3">
        <Input aria-label="Inventory Item ID" value={input} onChange={event => setInput(event.target.value.trim())} disabled={!!id} />
        <Button disabled={loading}>{loading ? 'Loading…' : 'Load or refresh history'}</Button>
      </form>
    </Panel>
    <Message error={error} />
    {loading && <p role="status">Loading movement history…</p>}
    {result && <Panel title={`${result.item.itemCode} · ${result.item.name}`}>
      <OpenLink to={`/staff/inventory/stock?itemId=${requestedId}`}>View stock balance</OpenLink>
      <div className="my-4"><Select label="Movement type" value={type} onChange={setType} options={[
        ['', 'All movement types'], 'INBOUND', 'OUTBOUND', 'RELOCATION',
      ]} /></div>
      {!rows.length && <p>No completed movements match this filter.</p>}
      <div className="space-y-4">{rows.map(movement => <article key={inventoryId(movement)} className="rounded-xl border p-4">
        <h3 className="font-semibold">{movement.type} · {movement.quantity} {movement.quantityUnit}</h3>
        <p className="mt-2 break-all text-sm">Movement ID {inventoryId(movement)}</p>
        <p className="break-all text-sm">From {cell(movement.sourceCellId)} → To {cell(movement.destinationCellId)}</p>
        <p className="text-sm">{new Date(movement.performedAt).toLocaleString('en-GB')}</p>
        <p className="break-all text-sm">Performed by {inventoryId(movement.performedBy) || 'Not returned'}</p>
        <p className="my-2 whitespace-pre-wrap text-sm">{movement.inspectionNote || movement.handoverNote || movement.relocationNote}</p>
        <MovementMeasurements movement={movement} />
      </article>)}</div>
    </Panel>}
  </Screen>;
}
