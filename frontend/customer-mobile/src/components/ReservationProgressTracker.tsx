import type {ReactNode} from 'react';
import {StyleSheet,View} from 'react-native';
import {AppText,Button,Card,Chip,Icon} from './ui';
import {colors} from '../theme/tokens';
import type {ReservationProgress} from '../domain/reservationProgress';

const labels={COMPLETED:'Hoàn thành',CURRENT:'Đang thực hiện',UPCOMING:'Chưa đến',BLOCKED:'Tạm dừng',FAILED:'Thất bại',SKIPPED:'Bỏ qua'} as const;
const nextLabels={CUSTOMER_ACTION_REQUIRED:'Bạn cần thực hiện',WAITING_FOR_SYSTEM:'Chờ hệ thống',WAITING_FOR_STAFF:'Chờ nhân viên',
  BLOCKED:'Cần kiểm tra',COMPLETED:'Đã hoàn tất'} as const;
type Action=NonNullable<NonNullable<ReservationProgress['next']>['action']>;

export function ReservationProgressTracker({progress,onAction,paymentScreen=false,children}:{progress:ReservationProgress;onAction:(action:Action)=>void;paymentScreen?:boolean;children?:ReactNode}){
  const {steps,next}=progress;
  const action=next?.action;
  return <Card>
    <AppText variant="card" accessibilityRole="header">Tiến độ đơn thuê</AppText>
    {steps.map((step,index)=>{
      const warning=step.state==='BLOCKED'||step.state==='FAILED';
      const active=step.state==='CURRENT'||step.state==='COMPLETED';
      return <View style={styles.row} key={step.id} accessible accessibilityLabel={step.title+'. '+labels[step.state]+'. '+step.description}>
        <View style={[styles.marker,{backgroundColor:warning?colors.orangeTint:active?colors.mint:colors.soft}]}>
          {step.state==='COMPLETED'?<Icon name="checkmark" size={17}/>:warning?<Icon name="alert" size={17} color={colors.orangeText}/>:<AppText variant="label">{index+1}</AppText>}
        </View>
        <View style={styles.step}>
          <AppText variant="medium" style={active&&step.state==='CURRENT'?styles.current:undefined}>{step.title}</AppText>
          <AppText variant="label" style={{color:warning?colors.orangeText:active?colors.primary:colors.muted}}>{labels[step.state]}</AppText>
          <AppText style={{color:colors.muted}}>{step.description}</AppText>
        </View>
      </View>;
    })}
    {next&&<View style={styles.next}>
      <AppText variant="label">Bước tiếp theo</AppText>
      <Chip label={nextLabels[next.mode]} tone={next.mode==='BLOCKED'?'orange':'neutral'}/>
      {next.description!==steps.find(s=>s.state==='CURRENT')?.description&&<AppText accessibilityLiveRegion="polite">{next.description}</AppText>}
      {action&&!(paymentScreen&&action.destination==='PAYMENT')&&<Button label={action.label} variant="outline" onPress={()=>onAction(action)}/>}
      {children}
    </View>}
  </Card>;
}

const styles=StyleSheet.create({
  row:{flexDirection:'row',alignItems:'flex-start',gap:12},
  marker:{width:32,height:32,borderRadius:16,alignItems:'center',justifyContent:'center'},
  step:{flex:1,gap:2},
  current:{color:colors.primary},
  next:{gap:8,borderTopWidth:1,borderTopColor:colors.line,paddingTop:12},
});
