import {useLocalSearchParams,useRouter} from 'expo-router';
import {useState} from 'react';
import {mobileRepo} from '../api/mobileRepository';
import {managedInventory} from '../api/managedInventory';
import {refId} from '../api/contracts/core';
import {ManagedInboundPreviewCard} from '../components/ManagedInboundPreviewCard';
import {AppText} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {useLiveSession} from '../state/useLiveSession';

export function ManagedInboundScreen(){
  const {id='',accessSessionId,operation}=useLocalSearchParams<{id:string;accessSessionId?:string|string[];operation?:string|string[]}>();
  const session=Array.isArray(accessSessionId)?accessSessionId[0]:accessSessionId;
  const requestedOperation=Array.isArray(operation)?operation[0]:operation;
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();
  const [refreshRevision,setRefreshRevision]=useState(0);
  const item=useResource(owner+':inbound:'+id,signal=>mobileRepo.item(id,owner,signal));
  const reservationId=item.data?refId(item.data.managedReservationId):'';
  const facilityId=item.data?refId(item.data.facilityId):'';
  const rental=useResource(owner+':inbound-rental:'+reservationId+':'+facilityId,
    signal=>reservationId&&facilityId?managedInventory.rental(reservationId,owner,facilityId,signal):Promise.resolve(null));
  return <LiveScreen title="Nhập hàng vào kho" eyebrow="KHO KÝ GỬI" subtitle="Chọn phiên đến kho và phân bổ số lượng theo từng vị trí. Bước xem trước chưa thay đổi tồn kho."
    backButton={{disabled:!item.data,onPress:()=>item.data&&router.replace({pathname:'/inventory/[id]',params:{id:item.data._id,...(session?{accessSessionId:session}:{}),...(requestedOperation?{operation:requestedOperation}:{})}} as never)}}
    onRefresh={()=>{item.reload();rental.reload();setRefreshRevision(value=>value+1);}} refreshing={item.loading||rental.loading}>
    <ResourceState {...item} resource="hàng hóa"/>
    <ResourceState {...rental} resource="đơn thuê"/>
    {item.data&&rental.data&&<><AppText>{item.data.itemCode} · {item.data.name}</AppText>
      <ManagedInboundPreviewCard item={item.data} r={rental.data} owner={owner} onCommitted={()=>{item.reload();rental.reload();setRefreshRevision(value=>value+1);}}
        initialSessionId={Array.isArray(accessSessionId)?accessSessionId[0]:accessSessionId} screenMode refreshRevision={refreshRevision}/>
    </>}
  </LiveScreen>;
}
