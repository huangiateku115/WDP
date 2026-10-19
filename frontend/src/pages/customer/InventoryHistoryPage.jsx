import { Link, useParams } from 'react-router-dom';
import {inventoryRecord,inventoryId} from '@/lib/inventoryRegistration';
import {inventoryMovements} from '@/lib/inventoryMovementHistory';
import {reservationVietnamTime} from '@/lib/customerReservationDisplay';
import {weightText} from '@/lib/warehouseMap';
import {volumeText} from '@/lib/managedCellBooking';
import {inventoryApi,useInventoryBackend} from '@/components/customer/inventory/InventoryBackendUI';
import {LoadState} from '@/components/customer/RentalBackendUI';
import { CustomerScreen, EmptyState } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
export default function InventoryHistoryPage(){
 const {id}=useParams();
 const resource=useInventoryBackend(async config=>{
   const item=inventoryRecord(await inventoryApi.get(id,config));
   if(inventoryId(item)!==id)throw Error('Inventory response does not match the requested item.');
   return {item,movements:inventoryMovements(await inventoryApi.movements(id,config),item)};
 },[id]);
 const item=resource.data?.item,movements=resource.data?.movements;
 const cell=value=>value===null?'Outside / no Cell':inventoryId(value);
 return <CustomerScreen title="Movement history" description={item?`${item.itemCode} · ${item.name}. Completed movements are read-only; pending requests are not movement records.`:'Immutable inventory movements.'} notice="Backend movement history · Read-only records returned for your inventory item." action={<Button asChild variant="outline"><Link to={`/portal/inventory/${id}`}>Item details</Link></Button>}>
  <LoadState resource={resource}/>
  {movements?.length>0&&<Card className="min-w-0 overflow-hidden"><div className="customer-table-scroll"><table className="customer-table"><caption className="sr-only">Immutable item movements</caption><thead><tr>{['Movement','Quantity','Source Cell','Destination Cell','Actual weight / volume','Date/time (Vietnam)','Notes'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{movements.map(m=><tr key={inventoryId(m)}><td><Badge variant={m.type==='OUTBOUND'?'orange':'green'}>{m.type}</Badge><p className="mt-2 break-all text-xs text-slate-500">{inventoryId(m)}</p></td><td>{m.quantity} {m.quantityUnit}</td><td className="break-all">{cell(m.sourceCellId)}</td><td className="break-all">{cell(m.destinationCellId)}</td><td><p>Total weight: {weightText(m.actualTotalWeightKg)}</p><p>Unit weight: {weightText(m.actualUnitWeightKg)}</p><p>Total volume: {volumeText(m.actualTotalVolumeM3)}</p><p className="mt-2 text-xs">{m.actualUnitDimensionsM.widthM} × {m.actualUnitDimensionsM.depthM} × {m.actualUnitDimensionsM.heightM} m</p></td><td><time dateTime={m.performedAt}>{reservationVietnamTime(m.performedAt)}</time></td><td className="whitespace-pre-wrap break-words">{m.inspectionNote&&<p>Inspection: {m.inspectionNote}</p>}{m.handoverNote&&<p>Handover: {m.handoverNote}</p>}{m.relocationNote&&<p>Relocation: {m.relocationNote}</p>}{!m.inspectionNote&&!m.handoverNote&&!m.relocationNote&&'—'}</td></tr>)}</tbody></table></div></Card>}
  {movements?.length===0&&<EmptyState title="No completed movements" description="The Backend returned no completed movements for this item. Pending requests are separate from movement records."/>}
  <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={resource.loading} onClick={resource.retry}>Refresh movement history</Button><Button asChild variant="outline"><Link to="/portal/inventory">My Inventory</Link></Button></div>
  <Card><CardContent><h2 className="text-lg font-bold">Movement types</h2><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><b>INBOUND</b><p className="mt-2 text-sm text-slate-500">Outside → Shelf</p></div><div><b>RELOCATION</b><p className="mt-2 text-sm text-slate-500">Shelf A → Shelf B</p></div><div><b>OUTBOUND</b><p className="mt-2 text-sm text-slate-500">Shelf → Outside</p></div></div></CardContent></Card>
 </CustomerScreen>;
}
