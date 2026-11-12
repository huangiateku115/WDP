import type {ReactNode} from 'react';
import {StyleSheet,View} from 'react-native';
import {AppText,Button,Card,Chip,Icon} from './ui';
import {CardHeading} from './livePresentation';
import {colors,radius} from '../theme/tokens';
import type {ReservationProgress} from '../domain/reservationProgress';

const labels={COMPLETED:'Hoàn thành',CURRENT:'Đang thực hiện',UPCOMING:'Chưa đến',BLOCKED:'Tạm dừng',FAILED:'Thất bại',SKIPPED:'Bỏ qua'} as const;
const nextLabels={CUSTOMER_ACTION_REQUIRED:'Bạn cần thực hiện',WAITING_FOR_SYSTEM:'Chờ hệ thống',WAITING_FOR_STAFF:'Chờ nhân viên',
  BLOCKED:'Cần kiểm tra',COMPLETED:'Đã hoàn tất'} as const;
type Action=NonNullable<NonNullable<ReservationProgress['next']>['action']>;

export function ReservationProgressTracker({progress,onAction,paymentScreen=false,paymentPurpose='DEPOSIT',children}:{progress:ReservationProgress;onAction:(action:Action)=>void;paymentScreen?:boolean;paymentPurpose?:'DEPOSIT'|'BALANCE';children?:ReactNode}){
  const {steps,next}=progress;
  const action=next?.action;
  return <Card>
    <CardHeading icon="git-commit-outline" title="Tiến độ đơn thuê"/>
    {steps.map((step,index)=>{
      const status=step.id==='contract'&&step.state==='CURRENT'
        ?next?.mode==='WAITING_FOR_STAFF'?'Chờ xác minh':next?.mode==='CUSTOMER_ACTION_REQUIRED'?'Cần thực hiện':labels[step.state]
        :step.id==='balance'&&step.state==='CURRENT'&&next?.mode==='CUSTOMER_ACTION_REQUIRED'?'Cần thanh toán':labels[step.state];
      const warning=step.state==='BLOCKED'||step.state==='FAILED';
      const active=step.state==='CURRENT'||step.state==='COMPLETED';
      return <View style={styles.row} key={step.id} accessible accessibilityLabel={step.title+'. '+status+'. '+step.description}>
        <View style={styles.rail}>
        {index<steps.length-1&&<View style={styles.connector}/>}
        <View style={[styles.marker,{backgroundColor:warning?colors.orangeTint:active?colors.mint:colors.soft}]}>
          {step.state==='COMPLETED'?<Icon name="checkmark" size={17}/>:warning?<Icon name="alert" size={17} color={colors.orangeText}/>:<AppText variant="label">{index+1}</AppText>}
        </View></View>
        <View style={[styles.step,step.state==='CURRENT'&&styles.currentStep]}>
          <AppText variant="medium" style={active&&step.state==='CURRENT'?styles.current:undefined}>{step.title}</AppText>
          <AppText variant="label" style={{color:warning?colors.orangeText:active?colors.primary:colors.muted}}>{status}</AppText>
          <AppText style={{color:colors.muted}}>{step.description}</AppText>
        </View>
      </View>;
    })}
    {next&&<View style={styles.next}>
      <AppText variant="label">Bước tiếp theo</AppText>
      <Chip label={nextLabels[next.mode]} tone={next.mode==='BLOCKED'?'orange':'neutral'}/>
      {next.description!==steps.find(s=>s.state==='CURRENT')?.description&&<AppText accessibilityLiveRegion="polite">{next.description}</AppText>}
      {action&&!(paymentScreen&&action.destination==='PAYMENT'&&(action.purpose??'DEPOSIT')===paymentPurpose)&&<Button label={action.label} variant="outline" onPress={()=>onAction(action)}/>}
      {children}
    </View>}
  </Card>;
}

const styles=StyleSheet.create({
  row:{flexDirection:'row',alignItems:'flex-start',gap:12},
  rail:{alignSelf:'stretch',alignItems:'center',width:32},connector:{position:'absolute',top:32,bottom:-12,width:2,backgroundColor:colors.line},
  marker:{width:32,height:32,borderRadius:16,alignItems:'center',justifyContent:'center'},
  step:{flex:1,minWidth:0,gap:2,paddingBottom:6},
  currentStep:{padding:10,borderRadius:radius.md,backgroundColor:colors.soft},
  current:{color:colors.primary},
  next:{gap:8,padding:12,borderRadius:radius.md,backgroundColor:colors.mint},
});
