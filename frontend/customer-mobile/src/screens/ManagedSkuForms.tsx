import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {mobileRepo} from '../api/mobileRepository';
import {lifecycle} from '../api/contracts/customer';
import {managedInventory} from '../api/managedInventory';
import {managedSkuEligible} from '../api/managedSkuV3';
import {refId} from '../api/contracts/core';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {ManagedSkuEditor} from '../components/ManagedSkuEditor';

export function RegisterManagedSku(){
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();const {reservationId}=useLocalSearchParams<{reservationId?:string}>();
  const rentals=useResource(owner,signal=>mobileRepo.rentals(owner,signal).then(rows=>rows.filter(r=>r.serviceType==='MANAGED_INVENTORY'&&managedSkuEligible(r))));
  const selectedRental=rentals.data?.find(r=>r._id===reservationId);
  if(reservationId){
    if(rentals.loading||rentals.error||!selectedRental)return <LiveScreen title="Khai báo hàng hóa" eyebrow="KHO KÝ GỬI"><ResourceState {...rentals}/>{!rentals.loading&&!rentals.error&&!selectedRental&&<StateCard title="Đơn thuê chưa đủ điều kiện" description="Không tìm thấy đơn thuê phù hợp để khai báo hàng hóa."/>}<Button label="Quay lại đơn thuê" variant="outline" onPress={()=>router.back()}/></LiveScreen>;
    return <ManagedSkuEditor key={selectedRental._id} r={selectedRental} onSaved={row=>router.replace({pathname:'/inventory/[id]',params:{id:row._id}} as unknown as Href)}/>;
  }
  return <LiveScreen title="Khai báo hàng hóa" eyebrow="KHO KÝ GỬI" subtitle="Chọn đơn thuê còn hiệu lực.">
    <ResourceState {...rentals}/>{rentals.data?.length===0&&<StateCard title="Chưa có đơn thuê phù hợp" description="Bạn cần một đơn kho ký gửi còn hiệu lực để khai báo hàng hóa."/>}
    {rentals.data?.map(r=><Card key={r._id}><AppText variant="card">{r.reservationCode}</AppText><AppText>{typeof r.facilityId==='object'&&'name' in r.facilityId&&typeof r.facilityId.name==='string'?r.facilityId.name:'Kho ký gửi'} · {lifecycle(r).label}</AppText>
      <Button label="Khai báo hàng hóa cho đơn này" onPress={()=>router.push({pathname:'/inventory/register',params:{reservationId:r._id}})}/></Card>)}
  </LiveScreen>;
}
export function EditManagedSku(){
  const {id}=useLocalSearchParams<{id:string}>();const owner=useLiveSession(s=>s.user?._id??'');const router=useRouter();
  const item=useResource(owner+':'+id,signal=>mobileRepo.item(id,owner,signal));
  const rental=useResource(owner+':'+id+':rental',signal=>item.data?managedInventory.rental(refId(item.data.managedReservationId),owner,refId(item.data.facilityId),signal):Promise.resolve(null));
  if(item.loading||item.error||!item.data)return <LiveScreen title="Sửa thông tin hàng hóa" eyebrow="KHO KÝ GỬI"><ResourceState {...item}/></LiveScreen>;
  if(rental.loading||rental.error||!rental.data)return <LiveScreen title="Sửa thông tin hàng hóa" eyebrow="KHO KÝ GỬI"><ResourceState {...rental}/></LiveScreen>;
  if(item.data.inventorySchemaVersion!==3)return <LiveScreen title="Sửa thông tin hàng hóa" eyebrow="KHO KÝ GỬI"><StateCard title="Không thể sửa hàng hóa này" description="Hồ sơ này không hỗ trợ chỉnh sửa trong ứng dụng."/></LiveScreen>;
  return <ManagedSkuEditor key={item.data._id} item={item.data} r={rental.data} onSaved={row=>router.replace({pathname:'/inventory/[id]',params:{id:row._id}} as unknown as Href)}/>;
}
