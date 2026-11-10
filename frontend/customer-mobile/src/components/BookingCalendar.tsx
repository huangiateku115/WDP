import {Pressable,StyleSheet,View} from 'react-native';
import {AppText,Button,ui} from './ui';
import {ResourceState,type useResource} from './liveUI';
import type {mobileRepo} from '../api/mobileRepository';
import {calendarDays,canStartOn,shiftMonth,utcToday} from '../domain/liveBooking';
import {colors,radius} from '../theme/tokens';

export const bookingDateLabel=(value:string)=>value.split('-').reverse().join('/');
type Availability=Awaited<ReturnType<typeof mobileRepo.monthlyAvailability>>;

export function BookingCalendar({month,setMonth,selected,onSelect,resource}:{
  month:string;setMonth:(month:string)=>void;selected:string;onSelect:(date:string)=>void;
  resource:ReturnType<typeof useResource<Availability|null>>;
}){
  return <View style={{gap:8}}>
    <View style={ui.between}>
      <Button label="Tháng trước" variant="quiet" disabled={month<=utcToday().slice(0,7)} onPress={()=>setMonth(shiftMonth(month,-1))}/>
      <AppText variant="label">{bookingDateLabel(month)}</AppText>
      <Button label="Tháng sau" variant="quiet" onPress={()=>setMonth(shiftMonth(month,1))}/>
    </View>
    <ResourceState {...resource}/>
    {resource.data&&resource.data.availabilityState!=='VERIFIED'?<><AppText>Lịch kho chưa khả dụng. Vui lòng tải lại hoặc chọn kho khác.</AppText><Button label="Tải lại lịch" variant="outline" onPress={resource.reload}/></>:null}
    <View style={styles.grid}>
      {['T2','T3','T4','T5','T6','T7','CN'].map(label=><View style={styles.slot} key={label}><AppText variant="label">{label}</AppText></View>)}
      {calendarDays(month).map((date,i)=>{
        if(!date)return <View style={styles.slot} key={'empty'+i}/>;
        const enabled=canStartOn(date,resource.data??undefined);
        const active=date===selected;
        return <Pressable key={date} accessibilityRole="button" accessibilityLabel={'Chọn ngày '+bookingDateLabel(date)}
          accessibilityState={{disabled:!enabled,selected:active}} disabled={!enabled} onPress={()=>onSelect(date)}
          style={[styles.slot,{backgroundColor:active?colors.primary:enabled?colors.mint:colors.card}]}>
          <AppText variant="label" style={{color:active?colors.white:enabled?colors.primary:colors.inactive}}>{Number(date.slice(-2))}</AppText>
        </Pressable>;
      })}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  grid:{flexDirection:'row',flexWrap:'wrap'},
  slot:{width:'14.28%',minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:radius.sm},
});
