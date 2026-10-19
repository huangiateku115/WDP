import {useEffect,useRef,useState} from 'react';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {inventoryId,inventoryRecord} from '@/lib/inventoryRegistration';
import {outboundEligible,outboundError} from '@/lib/customerOutbound';
import {inventoryApi,useInventoryBackend} from './InventoryBackendUI';
import {managedInventoryReservation} from './managedInventoryContext';
import {Dialog} from '@/components/ui/dialog';
import {Button,Link,Details,LoadState,Card,CardContent,CustomerScreen} from '../RentalBackendUI';
import InventoryStatus from './InventoryStatus';

export function CustomerOutboundAction({item,rental,loading,onRefresh}){
  const {accessToken,user}=useAuthSession();
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState(null);
  const busy=useRef(false),mounted=useRef(false),controller=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  const allowed=!!accessToken&&user?.role==='CUSTOMER'&&outboundEligible(item,rental)&&!loading&&!pending&&!locked;
  async function submit(){
    if(busy.current||!allowed)return;
    busy.current=true;setPending(true);setMessage(null);
    const token=accessToken,id=inventoryId(item),request=new AbortController();controller.current=request;
    const current=()=>mounted.current&&getAccessToken()===token&&!request.signal.aborted;
    try{
      const fresh=inventoryRecord(await inventoryApi.get(id,{signal:request.signal}));
      const reservation=await managedInventoryReservation(inventoryId(fresh.managedReservationId),{signal:request.signal});
      if(!current())return;
      if(inventoryId(fresh)!==id||!outboundEligible(fresh,reservation)){
        const error=Error();error.response={status:409};throw error;
      }
      const saved=inventoryRecord(await inventoryApi.requestOutbound(id,{signal:request.signal}));
      if(!current())return;
      if(inventoryId(saved)!==id||saved.status!=='PENDING_OUTBOUND'||inventoryId(saved.managedReservationId)!==inventoryId(fresh.managedReservationId)||inventoryId(saved.facilityId)!==inventoryId(fresh.facilityId))throw Error('Unverified response');
      setMessage({success:true,text:'Yêu cầu xuất kho đã được gửi. Đang chờ nhân viên xử lý và xác nhận bàn giao.'});
      setLocked(true);onRefresh();
    }catch(error){
      if(current()){setLocked(true);setMessage({success:false,text:outboundError(error)});onRefresh();}
    }finally{
      busy.current=false;
      if(current()){setPending(false);setOpen(false);}
    }
  }
  return <section className="space-y-3" aria-label="Customer outbound request">
    {message&&<div role={message.success?'status':'alert'} aria-live="polite" className={`relative z-50 w-full sm:fixed sm:bottom-4 sm:right-4 sm:max-w-md rounded-xl border p-4 text-sm shadow-lg ${message.success?'border-green-200 bg-green-50 text-green-800':'border-orange-200 bg-orange-50 text-orange-900'}`}>{message.text}<Button type="button" variant="ghost" size="sm" className="mt-2" onClick={()=>setMessage(null)}>Dismiss notification</Button></div>}
    {item?.status==='PENDING_OUTBOUND'&&<p role="status" className="text-sm text-orange-800">Đang chờ xuất kho. Nhân viên sẽ xác nhận bàn giao; chưa có movement OUTBOUND ở bước yêu cầu.</p>}
    {item?.status==='CHECKED_OUT'&&<p className="text-sm text-brand">Mặt hàng đã xuất kho. Trạng thái này không có nghĩa kỳ thuê đã kết thúc.</p>}
    <div className="flex flex-wrap gap-3">
      {item?.status==='IN_STORAGE'&&<Button variant="orange" disabled={!allowed} onClick={()=>setOpen(true)}>Request Outbound</Button>}
      <Button variant="outline" disabled={pending||loading} onClick={()=>{setLocked(false);onRefresh();}}>Refresh outbound status</Button>
    </div>
    {item?.status==='IN_STORAGE'&&!outboundEligible(item,rental)&&<p className="text-sm text-orange-800">Xuất kho yêu cầu vị trí Cell hợp lệ và kỳ thuê ACTIVE còn hiệu lực.</p>}
    {open&&item&&<Dialog title="Request Outbound" description="Bạn có chắc muốn yêu cầu xuất mặt hàng này khỏi kho? Nhân viên kho sẽ xử lý và xác nhận bàn giao." busy={pending} onClose={()=>setOpen(false)}>
      <Details values={[["Item",`${item.itemCode} · ${item.name}`],["Quantity",`${item.quantity} ${item.quantityUnit}`],["Status",<InventoryStatus status={item.status}/>],["Current Cell",inventoryId(item.currentCellId)||'Not assigned']]}/>
      <p className="text-sm text-slate-600">Yêu cầu này không xác nhận xuất kho thực tế và không kết thúc reservation.</p>
      <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={pending} onClick={()=>setOpen(false)}>Cancel</Button><Button variant="orange" disabled={!allowed} onClick={submit}>{pending?'Submitting…':'Confirm Outbound Request'}</Button></div>
    </Dialog>}
  </section>;
}

export default function CustomerOutboundPage({id}){
  const {accessToken}=useAuthSession();
  return <OutboundPage key={`${accessToken}:${id}`} id={id}/>;
}
function OutboundPage({id}){
  const resource=useInventoryBackend(async config=>{
    const item=inventoryRecord(await inventoryApi.get(id,config));
    if(inventoryId(item)!==id)throw Error('Inventory response does not match this item.');
    return item;
  },[id]);
  const item=resource.data;
  return <CustomerScreen title="Request Outbound" description="Yêu cầu nhân viên xuất và bàn giao hàng đang lưu kho." action={<Button asChild variant="outline"><Link to="/portal/inventory">My Inventory</Link></Button>}>
    <LoadState resource={resource}/>
    {item&&<Card><CardContent><h2 className="text-xl font-bold">{item.itemCode} · {item.name}</h2><div className="my-4"><InventoryStatus status={item.status}/></div><Details values={[["Quantity",`${item.quantity} ${item.quantityUnit}`],["Current Cell",inventoryId(item.currentCellId)||'Not assigned']]}/><div className="mt-4 flex flex-wrap gap-3"><Link className="text-brand underline" to={`/portal/inventory/${id}`}>Item details</Link><Link className="text-brand underline" to={`/portal/inventory/${id}/history`}>View Movement History</Link><Link className="text-brand underline" to={`/portal/reservations/${inventoryId(item.managedReservationId)}`}>View Managed Reservation</Link></div></CardContent></Card>}
    <CustomerOutboundAction item={item} loading={resource.loading||!!resource.error} onRefresh={resource.retry}/>
  </CustomerScreen>;
}
