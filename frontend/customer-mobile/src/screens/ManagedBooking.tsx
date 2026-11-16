import {CardHeading,TintedPanel} from '../components/livePresentation';
import {useState} from 'react';
import {Pressable,StyleSheet,View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {managedInventory} from '../api/managedInventory';
import {BookingCalendar,bookingDateLabel} from '../components/BookingCalendar';
import {AppText,Button,Card,Chip,Icon,ui} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {rentalEndDate,termKey,termLabels,utcToday} from '../domain/liveBooking';
import {useLiveSession} from '../state/useLiveSession';
import {ManagedMapPanel} from './ManagedWarehouse';
import {ManagedFacilityVisual} from '../components/ManagedFacilityVisual';
import {colors,radius} from '../theme/tokens';

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

  return <LiveScreen title="Đặt kho ký gửi" eyebrow="KHO KÝ GỬI" subtitle="Chọn kỳ thuê, kiểm tra từng ô và xem báo giá." onRefresh={refresh} refreshing={facility.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...facility}/>
    {facility.data&&<>
      <Card style={styles.facilityCard}>
        <ManagedFacilityVisual facility={facility.data} variant="detail"/>
        <View style={styles.facilityActions}>
          <AppText variant="caption" style={styles.dataNote}>Thông tin và dịch vụ của cơ sở.</AppText>
          <Button label="Xem sơ đồ kho" variant="outline" icon="map-outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/map',params:{facilityId}})}/>
        </View>
      </Card>
      <Card style={styles.periodCard}>
        <CardHeading icon="calendar-outline" title="Chọn thời hạn thuê" subtitle="Bảng giá và sức chứa sẽ được kiểm tra theo ngày đã chọn."/>
        <View style={styles.datePanel}>
          <AppText variant="label" style={styles.dateEyebrow}>NGÀY BẮT ĐẦU</AppText>
          <AppText variant="card">{start?bookingDateLabel(start):'Chọn ngày bắt đầu'}</AppText>
          <AppText variant="caption" style={styles.dataNote}>Ngày bắt đầu thuê cần từ ngày mai trở đi.</AppText>
          <Button label={open?'Đóng lịch':start?'Thay đổi ngày bắt đầu':'Chọn ngày bắt đầu'} icon="calendar-outline"
            variant="outline" onPress={()=>setOpen(!open)}/>
        </View>
        {open&&<BookingCalendar month={month} setMonth={setMonth} selected={start} onSelect={date=>{
          if(date<=utcToday())return;
          setStart(date);setSelected('');setOpen(false);
        }}/>}
        {!!start&&<><ResourceState {...terms}/>
          {terms.data?.length===0&&<AppText>Không có kỳ hạn có hiệu lực vào ngày đã chọn.</AppText>}
          {!!terms.data?.length&&<AppText variant="label">CHỌN KỲ HẠN CÓ HIỆU LỰC</AppText>}
          <View style={styles.termList}>{terms.data?.map(value=>{
            const active=termKey(value)===selected;
            return <Pressable key={termKey(value)} accessibilityRole="button" accessibilityLabel={value.value+' '+termLabels[value.unit].toLowerCase()}
              accessibilityState={{selected:active}} onPress={()=>setSelected(termKey(value))} style={[styles.termOption,active&&styles.termOptionActive]}>
              <View style={styles.termCopy}>
                <AppText variant="card" style={active?styles.termSelectedText:undefined}>{value.value} {termLabels[value.unit].toLowerCase()}</AppText>
                <AppText variant="caption" style={active?styles.termSelectedText:styles.dataNote}>Kỳ hạn có giá áp dụng tại cơ sở</AppText>
              </View>
              <View style={[styles.radio,active&&styles.radioActive]}>{active&&<Icon name="checkmark" size={15} color={colors.white}/>}</View>
            </Pressable>;
          })}</View>
        </>}
        {!!end&&<View style={styles.endDatePanel}>
          <Icon name="calendar-clear-outline" size={18} color={colors.primary}/>
          <View style={styles.endDateCopy}><AppText variant="caption" style={styles.dataNote}>NGÀY KẾT THÚC DỰ KIẾN</AppText><AppText variant="medium">{bookingDateLabel(end)}</AppText></View>
          <Chip label="Từ kỳ hạn đã chọn"/>
        </View>}
        {range&&<ResourceState {...capacity}/>}
        {capacity.data&&<TintedPanel><AppText variant="label">Dung tích khả dụng tại cơ sở · kỳ thuê này</AppText><AppText variant="heading">{capacity.data.availableCapacityM3} m³</AppText><AppText variant="caption">Khả dụng của từng ô sẽ được kiểm tra riêng trên sơ đồ.</AppText></TintedPanel>}
      </Card>
      {range&&term&&<ManagedMapPanel key={rangeKey+':'+selected+':'+revision} facilityId={facilityId} range={range} term={term} onChangePeriod={()=>setOpen(true)}/>}
    </>}
  </LiveScreen>;
}

const styles=StyleSheet.create({
  facilityCard:{padding:12,overflow:'hidden'},
  facilityActions:{gap:8},
  periodCard:{backgroundColor:colors.soft,borderColor:colors.line},
  datePanel:{padding:14,gap:8,borderRadius:radius.md,backgroundColor:colors.white,borderWidth:1,borderColor:colors.line},
  dateEyebrow:{color:colors.primary,letterSpacing:1},
  dataNote:{color:colors.muted},
  termList:{gap:8},
  termOption:{minHeight:76,paddingHorizontal:14,paddingVertical:12,backgroundColor:colors.white,borderColor:colors.line,borderWidth:1,borderRadius:radius.md,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  termOptionActive:{backgroundColor:colors.mint,borderColor:colors.primary,borderWidth:2},
  termCopy:{flex:1,gap:3},
  termSelectedText:{color:colors.deep},
  radio:{width:24,height:24,borderRadius:12,borderWidth:1.5,borderColor:colors.inactive,alignItems:'center',justifyContent:'center'},
  radioActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  endDatePanel:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderRadius:radius.md,backgroundColor:colors.mint},
  endDateCopy:{flex:1,gap:2},
});
