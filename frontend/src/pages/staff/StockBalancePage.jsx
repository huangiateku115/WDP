import {useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import inventoryApi from '@/api/inventoryApi';
import {getAccessToken, useAuthSession} from '@/lib/authSession';
import {inventoryId, validInventoryId} from '@/lib/inventoryRegistration';
import {Screen, Panel, Details, Table, Button, Input, OpenLink, Message} from '@/components/manager/ManagerUI';

export default function StockBalancePage() {
  const {user, accessToken} = useAuthSession();
  const [params] = useSearchParams();
  const [itemId, setItemId] = useState(params.get('itemId') || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setResult(null);
    setError('');
    setLoading(false);
    return () => { request.current += 1; };
  }, [accessToken]);

  async function load(event) {
    event.preventDefault();
    if (!validInventoryId(itemId)) {
      setError('Enter a valid Inventory Item ID.');
      return;
    }
    const currentRequest = ++request.current;
    const token = getAccessToken();
    setResult(null);
    setLoading(true);
    setError('');
    try {
      const itemResponse = await inventoryApi.get(itemId);
      const item = itemResponse.data?.data;
      if (itemResponse.data?.success !== true || inventoryId(item) !== itemId ||
          inventoryId(item.facilityId) !== inventoryId(user?.assignedFacilityId)) {
        throw Error('This Item is outside your assigned Facility.');
      }
      const response = await inventoryApi.stockBalance(itemId);
      const balance = response.data?.data;
      if (response.data?.success !== true || inventoryId(balance?.itemId) !== itemId ||
          inventoryId(balance.facilityId) !== inventoryId(user?.assignedFacilityId) ||
          !Number.isSafeInteger(balance.onHandQuantity) || !Number.isSafeInteger(balance.heldQuantity) ||
          balance.onHandQuantity < 0 || balance.heldQuantity < 0 || balance.heldQuantity > balance.onHandQuantity ||
          !Array.isArray(balance.batches)) {
        throw Error('The stock projection could not be verified. Refresh before continuing.');
      }
      if (currentRequest === request.current && token === getAccessToken()) setResult({item, balance});
    } catch (failure) {
      if (currentRequest === request.current && token === getAccessToken()) {
        setError(failure.response?.data?.message || failure.message || 'Stock balance unavailable.');
      }
    } finally {
      if (currentRequest === request.current && token === getAccessToken()) setLoading(false);
    }
  }

  const balance = result?.balance;
  return <Screen title="Stock balance" description="Current stock, quantity holds and receipt batches from the assigned Facility." notice="Refresh stock after receiving, delivery or relocation to review the latest quantities.">
    <Panel title="Find an inventory Item">
      <form className="flex flex-wrap gap-3" onSubmit={load}>
        <Input aria-label="Inventory Item ID" value={itemId} onChange={event => setItemId(event.target.value.trim())}/>
        <Button disabled={loading}>{loading ? 'Loading…' : 'Load or refresh stock'}</Button>
      </form>
    </Panel>
    <Message error={error}/>
    {result && <>
      <Panel title={`${result.item.itemCode} · ${result.item.name}`}>
        <Details values={[
          ['Item status', result.item.status], ['Current Cell', inventoryId(balance.currentCellId) || 'No placement'],
          ['Current quantity', balance.onHandQuantity], ['Held quantity', balance.heldQuantity],
          ['Available quantity', balance.onHandQuantity - balance.heldQuantity],
          ['Actual weight (kg)', balance.actualTotalWeightKg], ['Actual volume (m³)', balance.actualTotalVolumeM3],
          ['Projection source', balance.source], ['Projection version', balance.version],
        ]}/>
        <OpenLink to={`/staff/inventory/items/${inventoryId(result.item)}/history`}>Open movement history</OpenLink>
      </Panel>
      <Panel title="Receipt batches">
        <Table rows={balance.batches.map(batch => ({...batch, id: batch.batchId}))} columns={[
          {key:'batchId', label:'Batch'}, {key:'quantity', label:'Current quantity'},
          {key:'heldQuantity', label:'Held quantity'}, {key:'quantityUnit', label:'Unit'},
          {key:'actualUnitWeightKg', label:'Unit weight (kg)'}, {key:'arithmeticPolicy', label:'Accounting policy'},
          {key:'receivedAt', label:'Received at', render: batch => new Date(batch.receivedAt).toLocaleString('en-GB')},
        ]}/>
      </Panel>
    </>}
  </Screen>;
}
