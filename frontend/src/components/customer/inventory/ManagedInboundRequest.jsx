import {useRef,useState} from 'react';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {inventoryId,inventoryRecord,inventoryError,eligibleV2Inbound} from '@/lib/inventoryRegistration';
import {inventoryApi,useInventoryBackend} from './InventoryBackendUI';
import {managedInventoryReservation} from './managedInventoryContext';
import {Button,Link,Message,LoadState,RentalStatus,Details,Card,CardContent} from '../RentalBackendUI';
import ManagedCellSummary from '../warehouse/ManagedCellSummary';
import {Checkbox} from '@/components/ui/checkbox';

async function context(id,config){
  const item=inventoryRecord(await inventoryApi.get(id,config));
  if(inventoryId(item)!==id)throw Error('Inventory response does not match this item.');
  const rental=await managedInventoryReservation(inventoryId(item.managedReservationId),config);
  if(inventoryId(rental.facilityId)!==inventoryId(item.facilityId))throw Error('Reservation Facility does not match the item.');
  return {item,rental};
}

export default function ManagedInboundRequest({id}){
  const session=useAuthSession();
  return <Request key={`${session.accessToken}:${id}`} id={id} customer={session.user?.role==='CUSTOMER'}/>;
}
function Request({id,customer}){
  const resource=useInventoryBackend(config=>context(id,config),[id]);
  const [pending,setPending]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[uncertain,setUncertain]=useState(false),[completed,setCompleted]=useState(false),busy=useRef(false);
  const item=resource.data?.item,rental=resource.data?.rental,allowed=customer&&eligibleV2Inbound(item,rental)&&!resource.loading&&!resource.error;
  async function submit(){
    if(busy.current||!allowed||!confirmed||uncertain||completed)return;
    busy.current=true;setPending(true);setError('');setSuccess('');const token=getAccessToken();let sent=false;
    try{
      const fresh=await context(id);
      if(getAccessToken()!==token)return;
      if(!eligibleV2Inbound(fresh.item,fresh.rental))throw Error('Item or reservation changed. Refresh before requesting inbound.');
      sent=true;
      const saved=inventoryRecord(await inventoryApi.requestInbound(id));
      if(getAccessToken()!==token)return;
      if(inventoryId(saved)!==id||inventoryId(saved.managedReservationId)!==inventoryId(fresh.rental)||inventoryId(saved.facilityId)!==inventoryId(fresh.item.facilityId)||saved.status!=='PENDING_INBOUND'||saved.currentCellId!==null)throw Error('Inbound response could not be verified.');
      setCompleted(true);setConfirmed(false);setSuccess('Backend confirmed PENDING_INBOUND. Await Facility Staff receiving inspection.');resource.retry();
    }catch(e){if(getAccessToken()!==token)return;if(sent&&(!e.response?.status||e.response.status>=500)){setUncertain(true);setError('Inbound result is unknown. Refresh item status using GET before taking any further action. No automatic POST retry will be made.');}else{setError(inventoryError(e));resource.retry();}}
    finally{busy.current=false;setPending(false);}
  }
  return <section className="space-y-5" aria-label="Managed V2 inbound request"><LoadState resource={resource}/>{item&&rental?.bookingFlowVersion===2&&<><Card><CardContent><h2 className="text-xl font-bold">Request Inbound</h2><div className="mt-3"><RentalStatus status={item.status}/></div><Details values={[["Item",`${item.itemCode} · ${item.name}`],["Quantity",`${item.quantity} ${item.quantityUnit}`],["Total volume (m³)",item.totalVolumeM3],["Facility",typeof rental.facilityId==='object'?rental.facilityId.name||inventoryId(rental.facilityId):rental.facilityId],["Reservation",rental.reservationCode||inventoryId(rental)],["Reservation status",rental.status]]}/><ManagedCellSummary reservation={rental}/><p className="mt-4 text-sm">This request does not receive stock or activate your rental. Staff inspection and physical inbound confirmation are separate steps.</p></CardContent></Card>{!allowed&&<p className="soft-panel p-4">Inbound requires an unplaced REGISTERED item and an eligible, unexpired reservation. PENDING_INBOUND items cannot be submitted again. Backend also checks unresolved overdue rentals.</p>}{allowed&&!completed&&!uncertain&&<label className="flex items-start gap-3 text-sm"><Checkbox checked={confirmed} disabled={pending} onCheckedChange={value=>setConfirmed(value===true)}/>I confirm this inbound request and understand that Staff must inspect and receive the goods.</label>}<div className="flex flex-wrap gap-3"><Button variant="orange" disabled={!allowed||!confirmed||pending||uncertain||completed} onClick={submit}>{pending?'Submitting…':'Submit inbound request'}</Button><Button variant="outline" disabled={pending||resource.loading} onClick={()=>{setConfirmed(false);resource.retry();}}>Refresh item status</Button><Button asChild variant="outline"><Link to={`/portal/inventory/${id}`}>Item details</Link></Button></div>{uncertain&&<p role="status">Submission remains locked here. Review the refreshed backend status and My Inventory before starting a new attempt.</p>}</>}{rental&&rental.bookingFlowVersion!==2&&<p>This operational action is available here for Managed Inventory V2 only. Existing legacy inventory behavior is unchanged.</p>}<Message error={error} success={success}/></section>;
}
