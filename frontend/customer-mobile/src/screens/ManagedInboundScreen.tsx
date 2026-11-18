import {useLocalSearchParams,useRouter} from 'expo-router';
import {mobileRepo} from '../api/mobileRepository';
import {managedInventory} from '../api/managedInventory';
import {refId} from '../api/contracts/core';
import {ManagedInboundPreviewCard} from '../components/ManagedInboundPreviewCard';
import {AppText,Button} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {useLiveSession} from '../state/useLiveSession';

export function ManagedInboundScreen(){
  const {id='',accessSessionId}=useLocalSearchParams<{id:string;accessSessionId?:string}>();
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();
  const item=useResource(owner+':inbound:'+id,signal=>mobileRepo.item(id,owner,signal));
  const reservationId=item.data?refId(item.data.managedReservationId):'';
  const facilityId=item.data?refId(item.data.facilityId):'';
  const rental=useResource(owner+':inbound-rental:'+reservationId+':'+facilityId,
    signal=>reservationId&&facilityId?managedInventory.rental(reservationId,owner,facilityId,signal):Promise.resolve(null));
  return <LiveScreen title="Kiểm tra nhập kho" eyebrow="MANAGED INVENTORY V3" subtitle="Chọn phiên truy cập và phân bổ số lượng theo từng Cell. Xem trước không ghi tồn kho."
    onRefresh={()=>{item.reload();rental.reload();}} refreshing={item.loading||rental.loading}>
    <Button label="Quay lại SKU" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...item} resource="SKU · GET /inventory-items/{skuId}"/>
    <ResourceState {...rental} resource="Reservation · GET /reservations/managed/{reservationId}"/>
    {item.data&&rental.data&&<><AppText>{item.data.itemCode} · {item.data.name}</AppText>
      <ManagedInboundPreviewCard item={item.data} r={rental.data} owner={owner} onCommitted={()=>{item.reload();rental.reload();}}
        initialSessionId={Array.isArray(accessSessionId)?accessSessionId[0]:accessSessionId} screenMode/>
    </>}
  </LiveScreen>;
}
