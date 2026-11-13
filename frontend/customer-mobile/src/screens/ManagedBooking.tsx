import {CardHeading,TintedPanel} from '../components/livePresentation';
import {useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {managedInventory} from '../api/managedInventory';
import {BookingCalendar,bookingDateLabel} from '../components/BookingCalendar';
import {AppText,Button,Card,Filter,ui} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {rentalEndDate,termKey,termLabels,utcToday} from '../domain/liveBooking';
import {useLiveSession} from '../state/useLiveSession';
import {ManagedMapPanel} from './ManagedWarehouse';

export function ManagedReview(){
  const {facilityId}=useLocalSearchParams<{facilityId:string}>();
  const owner=useLiveSession(s=>s.user?._id??'');
  return <ManagedBooking key={owner+':'+facilityId} facilityId={facilityId} owner={owner}/>;
}

function ManagedBooking({facilityId,owner}:{facilityId:string;owner:string}){
  const router=useRouter();
  const [start,setStart]=useState(''),[selected,setSelected]=useState('');
  const [open,setOpen]=useState(false),[month,setMonth]=useState(()=>utcToday().slice(0,7));
  const [revision,setRevision]=useState(0);
  const facility=useResource(facilityId,signal=>managedInventory.facility(facilityId,signal));
  const ready=!!facility.data&&!!owner&&start>utcToday();
  const terms=useResource(owner+':'+facilityId+':'+(ready?start:''),signal=>ready?managedInventory.terms(facilityId,start,signal):Promise.resolve([]));
  const term=terms.data?.find(value=>termKey(value)===selected);
  const end=term?rentalEndDate(start,term):undefined;
  const range=ready&&end?{startDate:start+'T00:00:00.000Z',endDate:end+'T00:00:00.000Z'}:undefined;
  const rangeKey=range?.startDate+':'+range?.endDate;
  const capacity=useResource(owner+':'+facilityId+':'+rangeKey,signal=>range?managedInventory.capacity(facilityId,range,signal):Promise.resolve(null));
  function refresh(){setRevision(value=>value+1);facility.reload();terms.reload();capacity.reload();}

  return <LiveScreen title="Thuê kho ký gửi" eyebrow="ĐẶT KHO KÝ GỬI" subtitle="Chọn kỳ thuê, xem vị trí và kiểm tra báo giá theo ô." onRefresh={refresh} refreshing={facility.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...facility}/>
    {facility.data&&<>
      <Card>
        <CardHeading icon="business-outline" title={facility.data.name}/>
        <AppText>{[facility.data.address.line1??facility.data.address.street,facility.data.address.district,facility.data.address.city].filter(Boolean).join(', ')}</AppText>
        <AppText>Dịch vụ kho ký gửi</AppText>
        {facility.data.description?<AppText>{facility.data.description}</AppText>:null}
        <Button label="Xem sơ đồ kho" variant="outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/map',params:{facilityId}})}/>
      </Card>
      <Card>
        <CardHeading icon="calendar-outline" title="Chọn kỳ thuê"/>
        <AppText>Chọn ngày bắt đầu để xem kỳ hạn có bảng giá. Ngày được tính theo lịch UTC của máy chủ.</AppText>
        <Button label={open?'Đóng lịch':start?bookingDateLabel(start):'Chọn ngày bắt đầu kho ký gửi'} variant="outline" onPress={()=>setOpen(!open)}/>
        {open&&<BookingCalendar month={month} setMonth={setMonth} selected={start} onSelect={date=>{
          if(date<=utcToday())return;
          setStart(date);setSelected('');setOpen(false);
        }}/>}
        {!!start&&<><ResourceState {...terms}/>
          {terms.data?.length===0&&<AppText>Không có kỳ hạn có hiệu lực vào ngày đã chọn.</AppText>}
          <View style={ui.wrap}>{terms.data?.map(value=><Filter key={termKey(value)} label={value.value+' '+termLabels[value.unit].toLowerCase()}
            selected={termKey(value)===selected} onPress={()=>setSelected(termKey(value))}/>)}</View>
        </>}
        {!!end&&<AppText>Ngày kết thúc: {bookingDateLabel(end)}</AppText>}
        {range&&<ResourceState {...capacity}/>}
        {capacity.data&&<TintedPanel><AppText variant="label">Dung tích còn khả dụng tại cơ sở trong kỳ thuê</AppText><AppText variant="heading">{capacity.data.availableCapacityM3} m³</AppText></TintedPanel>}
      </Card>
      {range&&term&&<ManagedMapPanel key={rangeKey+':'+selected+':'+revision} facilityId={facilityId} range={range} term={term}/>}
    </>}
  </LiveScreen>;
}
