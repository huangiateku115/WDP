import {useState} from 'react';
import {Modal,Platform,Pressable,StyleSheet,View} from 'react-native';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import {AppText,Button} from './ui';
import {colors} from '../theme/tokens';

const dateParts=(date:Date)=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(value=>value.type===type)?.value??'';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const dateAtHcmNoon=(value:string)=>{const [year,month,day]=value.split('-').map(Number);return new Date(Date.UTC(year!,month!-1,day!,5));};
const calendarDate=(date:Date)=>`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
const calendarMonthLabel=(month:string)=>new Intl.DateTimeFormat('vi-VN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
const calendarDays=(month:string)=>{const [year,monthNumber]=month.split('-').map(Number),first=new Date(Date.UTC(year!,monthNumber!-1,1)),offset=(first.getUTCDay()+6)%7;return Array.from({length:42},(_,index)=>{const date=new Date(Date.UTC(year!,monthNumber!-1,1+index-offset));return {date:calendarDate(date),day:date.getUTCDate(),inMonth:date.getUTCMonth()===monthNumber!-1};});};
const displayDate=(value:string)=>new Intl.DateTimeFormat('vi-VN',{dateStyle:'full',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));

export function ManagedVisitDatePicker({value,disabled,onChange}:{value:string;disabled?:boolean;onChange:(date:string)=>void}){
  const [open,setOpen]=useState(false),[month,setMonth]=useState(()=>value.slice(0,7));
  const today=dateParts(new Date()),days=calendarDays(month);
  const choose=(next:string)=>{if(next<today)return;onChange(next);setOpen(false);};
  const changeMonth=(offset:number)=>{const [year,monthNumber]=month.split('-').map(Number),next=new Date(Date.UTC(year!,monthNumber!-1+offset,1));setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,'0')}`);};
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Chọn ngày đến kho" disabled={disabled} onPress={()=>{setMonth(value.slice(0,7));setOpen(true);}} style={styles.dateButton}>
      <AppText variant="medium">{displayDate(value)}</AppText><AppText style={{color:colors.primary}}>Chọn ngày</AppText>
    </Pressable>
    {open&&Platform.OS==='web'?<Modal transparent animationType="fade" onRequestClose={()=>setOpen(false)}><View style={styles.backdrop}><View style={styles.webCalendar}>
      <View style={styles.header}><Button label="Tháng trước" variant="quiet" disabled={month<=today.slice(0,7)} onPress={()=>changeMonth(-1)}/><AppText variant="card">{calendarMonthLabel(month)}</AppText><Button label="Tháng sau" variant="quiet" onPress={()=>changeMonth(1)}/></View>
      <View style={styles.grid}>{['T2','T3','T4','T5','T6','T7','CN'].map(day=><AppText key={day} variant="caption" style={styles.weekday}>{day}</AppText>)}{days.map(cell=><Pressable key={cell.date} accessibilityRole="button" accessibilityLabel={`Chọn ngày ${cell.date}`} accessibilityState={{selected:value===cell.date,disabled:!cell.inMonth||cell.date<today}} disabled={!cell.inMonth||cell.date<today} onPress={()=>choose(cell.date)} style={[styles.day,value===cell.date&&styles.selected,(!cell.inMonth||cell.date<today)&&styles.disabledDay]}><AppText variant="medium" style={{color:value===cell.date?colors.white:cell.inMonth&&cell.date>=today?colors.primary:colors.inactive}}>{cell.day}</AppText></Pressable>)}</View>
      <Button label="Đóng lịch" variant="outline" onPress={()=>setOpen(false)}/>
    </View></View></Modal>:open&&Platform.OS==='ios'?<Modal transparent animationType="slide" onRequestClose={()=>setOpen(false)}><View style={styles.backdrop}><View style={styles.nativeCard}><View style={styles.header}><AppText variant="card">Chọn ngày</AppText><Button label="Xong" variant="quiet" onPress={()=>setOpen(false)}/></View><DateTimePicker mode="date" display="inline" locale="vi_VN" timeZoneName="Asia/Ho_Chi_Minh" value={dateAtHcmNoon(value)} minimumDate={dateAtHcmNoon(today)} accentColor={colors.primary} onValueChange={(_,date)=>choose(dateParts(date))}/></View></View></Modal>:open?<DateTimePicker mode="date" presentation="dialog" display="default" locale="vi_VN" is24Hour timeZoneName="Asia/Ho_Chi_Minh" value={dateAtHcmNoon(value)} minimumDate={dateAtHcmNoon(today)} accentColor={colors.primary} positiveButton={{label:'Chọn'}} negativeButton={{label:'Hủy'}} onValueChange={(_,date)=>choose(dateParts(date))} onDismiss={()=>setOpen(false)}/>:null}
  </>;
}

const styles=StyleSheet.create({dateButton:{minHeight:54,paddingHorizontal:14,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.soft,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},backdrop:{flex:1,justifyContent:'flex-end',backgroundColor:'#103D2B88'},nativeCard:{backgroundColor:colors.card,borderTopLeftRadius:20,borderTopRightRadius:20,padding:16,gap:12},webCalendar:{alignSelf:'center',width:'100%',maxWidth:440,backgroundColor:colors.card,borderRadius:18,padding:16,gap:12},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between'},weekday:{width:'14.2%',height:34,textAlign:'center',textAlignVertical:'center',color:colors.muted},day:{width:'14.2%',height:42,alignItems:'center',justifyContent:'center',borderRadius:10},selected:{backgroundColor:colors.primary,borderColor:colors.primary},disabledDay:{opacity:.5,backgroundColor:colors.surface}});
