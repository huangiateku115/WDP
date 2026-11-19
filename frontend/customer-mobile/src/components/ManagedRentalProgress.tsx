import {StyleSheet,View} from 'react-native';
import type {ManagedPaymentProgress} from '../domain/managedV3RentalProgress';
import {managedRentalProgress} from '../domain/managedV3RentalProgress';
import type {ReservationDto} from '../api/contracts/customer';
import {colors} from '../theme/tokens';
import {AppText,Card,Icon} from './ui';

const stateLabel={COMPLETED:'Hoàn tất',CURRENT:'Đang thực hiện',PENDING:'Chưa đến bước này',BLOCKED:'Đang bị gián đoạn'} as const;
const stateTone={COMPLETED:colors.primary,CURRENT:colors.orange,BLOCKED:colors.danger,PENDING:colors.inactive} as const;
const stateIcon={COMPLETED:'checkmark',CURRENT:'ellipse',PENDING:'ellipse-outline',BLOCKED:'alert-circle-outline'} as const;

export function ManagedRentalProgress({reservation,payment='NONE',visitEligible,hasVisit,hasInboundSession,hasStoredItems,handoverComplete}:{
  reservation:ReservationDto;payment?:ManagedPaymentProgress;visitEligible?:boolean;hasVisit?:boolean;hasInboundSession?:boolean;hasStoredItems?:boolean;handoverComplete?:boolean;
}){
  const steps=managedRentalProgress({reservationStatus:reservation.status,payment,visitEligible,hasVisit,hasInboundSession,hasStoredItems,handoverComplete});
  return <Card>
    <AppText variant="card">Tiến trình thuê kho</AppText>
    <View style={styles.list}>{steps.map((step,index)=>{
      const tone=stateTone[step.state];
      return <View key={step.key} style={styles.row}>
        <View style={styles.markerColumn}>
          <View style={[styles.marker,{borderColor:tone,backgroundColor:step.state==='COMPLETED'?tone:colors.card}]}>
            <Icon name={stateIcon[step.state]} size={14} color={step.state==='COMPLETED'?colors.white:tone}/>
          </View>
          {index<steps.length-1&&<View style={styles.line}/>}
        </View>
        <View style={styles.copy}>
          <View style={styles.heading}><AppText variant="medium" style={styles.title}>{index+1}. {step.title}</AppText>
            <AppText variant="caption" style={{color:tone}}>{step.key==='payment'&&payment==='UNSYNCED'?'Chưa xác minh thanh toán':stateLabel[step.state]}</AppText></View>
          <AppText variant="caption" style={styles.detail}>{step.detail}</AppText>
        </View>
      </View>;
    })}</View>
  </Card>;
}

const styles=StyleSheet.create({
  list:{gap:0},row:{minHeight:68,flexDirection:'row',gap:12},markerColumn:{width:24,alignItems:'center'},
  marker:{width:22,height:22,borderRadius:11,borderWidth:2,alignItems:'center',justifyContent:'center'},
  line:{flex:1,width:2,backgroundColor:colors.line,marginVertical:3},copy:{flex:1,paddingBottom:14,gap:3},
  heading:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between',gap:8},title:{flexShrink:1},detail:{color:colors.muted},
});
