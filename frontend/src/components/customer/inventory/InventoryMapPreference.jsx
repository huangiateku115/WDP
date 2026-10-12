import {useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {getAccessToken} from '@/lib/authSession';
import {inventoryId,inventoryRecord,inventoryPreview,editableInventory,inventoryError,validInventoryId} from '@/lib/inventoryRegistration';
import {inventoryApi,inventoryRentals,useInventoryBackend} from './InventoryBackendUI';
import {Button,Link,LoadState,Message,ConfirmAction} from '../RentalBackendUI';
import {PreviewResult} from './PlacementPreview';
async function itemContext(itemId,facilityId,config){const item=inventoryRecord(await inventoryApi.get(itemId,config));if(inventoryId(item)!==itemId||inventoryId(item.facilityId)!==facilityId)throw Error('This item belongs to a different Facility. Open its Warehouse Map from My Inventory.');const rentals=await inventoryRentals(config),rental=rentals.find(r=>inventoryId(r)===inventoryId(item.managedReservationId)&&inventoryId(r.facilityId)===facilityId);return {item,rental};}
export function useInventoryMapPreference(facilityId){
  const [params]=useSearchParams(),itemId=params.get('inventoryItem')||'',resource=useInventoryBackend(config=>!itemId?Promise.resolve(null):validInventoryId(itemId)?itemContext(itemId,facilityId,config):Promise.reject(Error('Invalid inventory item context.')),[facilityId,itemId]);
  const currentItem=useRef(itemId);currentItem.current=itemId;const [resultKey,setResultKey]=useState('');
  const [pending,setPending]=useState(false),[preview,setPreview]=useState(null),[success,setSuccess]=useState(''),[error,setError]=useState(''),busy=useRef(false);
  async function action(cell,rack,save){if(busy.current)return;busy.current=true;setPending(true);setResultKey(`${itemId}:${inventoryId(cell)}`);setError('');setSuccess('');setPreview(null);const token=getAccessToken();try{
    if(!cell||rack?.facilityId!==facilityId||cell.operationalStatus!=='AVAILABLE'||rack.operationalStatus!=='AVAILABLE')throw Error('Preference/preview requires an AVAILABLE Cell and Rack in this Facility.');
    const fresh=await itemContext(itemId,facilityId);if(getAccessToken()!==token||currentItem.current!==itemId)return;
    if(!fresh.rental)throw Error('An eligible ACTIVE Managed rental is required.');
    if(save){if(!editableInventory(fresh.item,fresh.rental))throw Error('Only unplaced REGISTERED item metadata can be edited.');const saved=inventoryRecord(await inventoryApi.update(itemId,{preferredCellId:inventoryId(cell)}));if(getAccessToken()!==token||currentItem.current!==itemId)return;if(inventoryId(saved)!==itemId||inventoryId(saved.preferredCellId)!==inventoryId(cell)||saved.currentCellId!==null||saved.status!=='REGISTERED')throw Error('Backend did not confirm the requested preference. Refresh the item before retrying.');setSuccess('Backend saved the preferred Cell. No physical placement or stock change occurred.');resource.retry();}
    else{const result=inventoryPreview(await inventoryApi.preview(itemId,inventoryId(cell)),itemId,inventoryId(cell));if(getAccessToken()===token&&currentItem.current===itemId)setPreview({cellId:inventoryId(cell),data:result});}
  }catch(e){if(getAccessToken()===token&&currentItem.current===itemId){if(save)throw Error(inventoryError(e));setError(inventoryError(e));}}finally{busy.current=false;setPending(false);}}
  return {itemId,resultKey,resource,pending,preview,success,error,action};
}
export function InventoryMapContext({controller}){return controller.itemId?<div className="wm-notice"><LoadState resource={controller.resource}/>{controller.resource.data&&<p>Inventory preference context: {controller.resource.data.item.itemCode} · {controller.resource.data.item.name}. Cell selection remains advisory.</p>}<Link className="wm-inline-link" to={`/portal/inventory/${controller.itemId}`}>Back to inventory item</Link></div>:null;}
export function InventoryCellPreference({controller,cell,rack}){
  const context=controller.resource.data,available=cell.operationalStatus==='AVAILABLE'&&rack.operationalStatus==='AVAILABLE';
  if(!controller.itemId)return <p className="wm-baseline-note">To express a preference, open an eligible item in <Link className="wm-inline-link" to="/portal/inventory">My Inventory</Link> and choose its Warehouse Map.</p>;
  return <div className="mt-5 space-y-4"><h3 className="font-bold">Inventory Cell preference</h3>{context&&<><p className="text-sm">{context.item.itemCode}: preference only, not physical location.</p>{available&&context.rental?<><Button disabled={controller.pending} onClick={()=>controller.action(cell,rack,false)}>Preview fit for this Cell</Button>{editableInventory(context.item,context.rental)&&<ConfirmAction label="Use this Cell as preference" disabled={controller.pending} onAction={()=>controller.action(cell,rack,true)}/>}</>:<p className="text-sm">An AVAILABLE Cell/Rack and eligible ACTIVE Managed rental are required.</p>}{!editableInventory(context.item,context.rental)&&<p className="text-sm">Preference editing is unavailable for this item/rental.</p>}</>}<Message error={controller.resultKey===`${controller.itemId}:${inventoryId(cell)}`?controller.error:null}/><Message success={controller.resultKey===`${controller.itemId}:${inventoryId(cell)}`?controller.success:null}/>{controller.preview?.cellId===inventoryId(cell)&&<PreviewResult data={controller.preview.data}/>}</div>;
}
