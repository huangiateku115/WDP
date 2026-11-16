import {Pressable,StyleSheet,View} from 'react-native';
import type {managedBookingPolicy} from '../api/managedBookingV3';
import {colors} from '../theme/tokens';
import {AppText,Card,Filter,Icon} from './ui';

type Policy=Awaited<ReturnType<typeof managedBookingPolicy>>;
export function ManagedTermsAccordion({version,groups,expanded,onToggleExpanded,accepted,onToggleAcceptance,disabled=false}:{
  version:string;groups:Policy['groups'];expanded:boolean;onToggleExpanded:()=>void;accepted:boolean;onToggleAcceptance:()=>void;disabled?:boolean;
}){
  return <Card style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded?'Thu gọn điều khoản':'Xem điều khoản'}
      accessibilityState={{expanded}} onPress={onToggleExpanded} style={styles.header}>
      <View style={styles.heading}><AppText variant="card">Điều khoản thuê kho ký gửi</AppText>
        {!!version&&<AppText variant="caption" style={styles.version}>Phiên bản {version}</AppText>}</View>
      <View style={styles.action}><AppText variant="label" style={styles.actionText}>{expanded?'Thu gọn điều khoản':'Xem điều khoản'}</AppText>
        <Icon name={expanded?'chevron-up':'chevron-down'} size={18}/></View>
    </Pressable>
    {expanded&&<View style={styles.content}>{groups.map(group=><View key={group.id} style={styles.group}>
      <AppText variant="medium">{group.title}</AppText>
      {group.sections.MANAGED_INVENTORY?.map((line,index)=><AppText key={index}>{line}</AppText>)}
    </View>)}</View>}
    <Filter label="Tôi chấp nhận điều khoản kho ký gửi" selected={accepted} onPress={()=>{if(!disabled)onToggleAcceptance();}}/>
  </Card>;
}

const styles=StyleSheet.create({
  card:{padding:0,overflow:'hidden'},header:{minHeight:68,paddingHorizontal:16,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  heading:{flex:1,gap:3},version:{color:colors.muted},action:{flexDirection:'row',alignItems:'center',gap:2},actionText:{color:colors.primary},
  content:{paddingHorizontal:16,paddingBottom:16,gap:12},group:{gap:8,paddingTop:12,borderTopWidth:1,borderTopColor:colors.line},
});
