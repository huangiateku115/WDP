import {CardHeading} from '../components/livePresentation';
import {useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {View} from 'react-native';
import {managedInventory} from '../api/managedInventory';
import {lifecycle} from '../api/contracts/customer';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Input,StateCard,ui} from '../components/ui';
import {dateLabel,LiveScreen,ResourceState,useResource} from '../components/liveUI';

export function ManagedFacilities(){
  const router=useRouter();
  const [text,setText]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const data=useResource(search+':'+page,signal=>managedInventory.facilities(page,search,signal));
  const result=data.data;
  function apply(){setSearch(text.trim());setPage(1);}
  return <LiveScreen title="Tìm kho ký gửi" eyebrow="KHÁM PHÁ CƠ SỞ" subtitle="Tìm theo tên hoặc địa chỉ cơ sở." onRefresh={data.reload} refreshing={data.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <Card>
      <Input label="Tìm tên hoặc địa chỉ cơ sở" maxLength={100} value={text} onChangeText={setText} onSubmitEditing={apply}/>
      <Button label="Tìm kiếm" onPress={apply}/>
    </Card>
    <ResourceState {...data}/>
    {result?.items.length===0&&<StateCard title="Không tìm thấy cơ sở kho ký gửi"/>}
    {result?.items.map(f=><Card key={f._id}>
      <CardHeading icon="business-outline" title={f.name}/>
      <AppText>{[f.address.line1??f.address.street,f.address.district,f.address.city].filter(Boolean).join(', ')}</AppText>
      <AppText>Dịch vụ kho ký gửi</AppText>
      <Button label="Xem cơ sở ký gửi" variant="outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/review',params:{facilityId:f._id}})}/>
    </Card>)}
    {result&&result.pagination.totalPages>1&&<View style={ui.between}>
      <Button label="Trang trước" variant="quiet" disabled={page<=1} onPress={()=>setPage(page-1)}/>
      <AppText>{page}/{result.pagination.totalPages}</AppText>
      <Button label="Trang sau" variant="quiet" disabled={page>=result.pagination.totalPages} onPress={()=>setPage(page+1)}/>
    </View>}
  </LiveScreen>;
}

export function ManagedRentalDetail(){
  const {facilityId,reservationId}=useLocalSearchParams<{facilityId:string;reservationId:string}>();
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();
  const data=useResource(owner+':'+facilityId+':'+reservationId,signal=>managedInventory.rental(reservationId,owner,facilityId,signal));
  const facility=useResource(facilityId,signal=>managedInventory.facility(facilityId,signal));
  const r=data.data;
  const state=r?lifecycle(r).label:undefined;
  return <LiveScreen title="Đơn thuê kho ký gửi" eyebrow="HỒ SƠ THUÊ" onRefresh={()=>{data.reload();facility.reload();}} refreshing={data.loading||facility.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...data}/>
    {r&&<Card>
      <CardHeading icon="key-outline" title={r.reservationCode}/>
      <AppText>{facility.data?.name??'Cơ sở kho ký gửi'}</AppText>
      <AppText>{state===r.status?({CANCELLED:'Đã hủy',OVERDUE:'Quá hạn',CLOSED:'Đã đóng',CHECKED_OUT:'Đã trả kho'}[r.status as string]??'Đang cập nhật'):state}</AppText>
      <AppText>{dateLabel(r.startDate)} – {dateLabel(r.endDate)}</AppText>
      {r.bookingFlowVersion!==2&&<AppText>Đơn thuộc luồng kho ký gửi trước V2.</AppText>}
      {r.allocatedCapacity!==undefined&&<AppText>Dung tích được cấp: {r.allocatedCapacity} m³</AppText>}
      {r.usedCapacityM3!==undefined&&<AppText>Dung tích đã dùng: {r.usedCapacityM3} m³</AppText>}
      {r.allocatedCellIds&&<AppText>Số ô được cấp: {r.allocatedCellIds.length}</AppText>}
      <Button label="Xem sơ đồ kho" variant="outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/map',params:{facilityId}})}/>
    </Card>}
  </LiveScreen>;
}
