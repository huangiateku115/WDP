import {useEffect,useState} from 'react';
import {View} from 'react-native';
import type {ReservationDto} from '../api/contracts/customer';
import {contractDeadlineLabel,contractDeadlineState} from '../domain/contractSigning';
import {colors} from '../theme/tokens';
import {AppText,Icon} from './ui';

export function ContractSigningNotice({reservation}:{reservation:ReservationDto}){
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    if(reservation.status!=='PAID'||reservation.serviceType!=='SELF_STORAGE'||reservation.rentalPaymentFlow!=='FULL_UPFRONT_V1')return;
    const timer=setInterval(()=>setNow(Date.now()),60_000);
    return ()=>clearInterval(timer);
  },[reservation._id,reservation.status,reservation.serviceType,reservation.rentalPaymentFlow]);
  if(reservation.status!=='PAID'||reservation.serviceType!=='SELF_STORAGE'||reservation.rentalPaymentFlow!=='FULL_UPFRONT_V1')return null;

  const state=contractDeadlineState(reservation.signingDeadline??undefined,now);
  const facility=typeof reservation.facilityId==='object'&&typeof reservation.facilityId.name==='string'
    ?reservation.facilityId.name:'Chưa có thông tin cơ sở';
  const expired=state.kind==='expired';
  return <View accessibilityRole="summary" style={{padding:14,borderRadius:14,backgroundColor:expired?colors.dangerTint:colors.orangeTint,borderWidth:1,borderColor:expired?'#efc2bd':'#f2d6b6',gap:7}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
      <Icon name={expired?'alert-circle-outline':'time-outline'} color={expired?colors.danger:colors.orangeText} size={19}/>
      <AppText variant="label" style={{color:expired?colors.danger:colors.orangeText}}>Cần đến cơ sở ký hợp đồng</AppText>
    </View>
    <AppText variant="caption">Cơ sở: {facility}</AppText>
    {state.kind==='remaining'&&<>
      <AppText variant="caption">Hạn chót ký: {contractDeadlineLabel(state.deadlineAt)}</AppText>
      <AppText variant="label" style={{color:colors.orangeText}}>{state.label}</AppText>
    </>}
    {state.kind==='expired'&&<>
      <AppText variant="caption" style={{color:colors.danger}}>Hạn chót ký đã qua. Trạng thái đơn đang chờ cơ sở cập nhật.</AppText>
    </>}
    {(state.kind==='missing'||state.kind==='invalid')&&<AppText variant="caption">Hạn chót chưa được cập nhật. Vui lòng liên hệ cơ sở để xác nhận thời hạn ký.</AppText>}
  </View>;
}
