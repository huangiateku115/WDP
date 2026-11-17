import type {PropsWithChildren} from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors,radius} from '../theme/tokens';
import {AppText,Button,Card,Chip,Icon} from './ui';

export function TermsReviewCard({title,version,accepted,onOpen}:{title:string;version?:string;accepted:boolean;onOpen:()=>void}){
  return <Card>
    <View style={styles.summaryHeading}>
      <View style={styles.summaryCopy}>
        <AppText variant="card">{title}</AppText>
        {!!version&&<AppText variant="caption" style={styles.muted}>Phiên bản {version}</AppText>}
      </View>
      <Chip label={accepted?'Đã đồng ý':'Chưa xác nhận'} tone={accepted?'green':'orange'}/>
    </View>
    <AppText style={styles.muted}>Vui lòng xem và xác nhận điều khoản hiện hành trước khi tạo đơn thuê.</AppText>
    <Button label="Xem điều khoản" variant="outline" icon="document-text-outline" onPress={onOpen}/>
  </Card>;
}

export function TermsModal({visible,title,version,onClose,onAccept,disabled=false,children}:PropsWithChildren<{
  visible:boolean;title:string;version?:string;onClose:()=>void;onAccept:()=>void;disabled?:boolean;
}>){
  return <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <SafeAreaView edges={['top','bottom']} style={styles.safeArea}>
        <View style={styles.panel} testID="terms-modal">
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <AppText variant="card" accessibilityRole="header">{title}</AppText>
              {!!version&&<AppText variant="caption" style={styles.muted}>Phiên bản {version}</AppText>}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Đóng điều khoản" onPress={onClose} style={styles.close}>
              <Icon name="close" size={22}/>
            </Pressable>
          </View>
          <ScrollView testID="terms-modal-scroll" style={styles.scroll} contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
          <View style={styles.footer}>
            <Button label="Đồng ý điều khoản" disabled={disabled} onPress={onAccept}/>
            <Button label="Đóng" variant="outline" disabled={disabled} onPress={onClose}/>
          </View>
        </View>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles=StyleSheet.create({
  summaryHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  summaryCopy:{flex:1,gap:3},muted:{color:colors.muted},
  backdrop:{flex:1,backgroundColor:'rgba(10,35,24,0.56)',justifyContent:'center',alignItems:'center',padding:12},
  safeArea:{width:'100%',maxWidth:640,height:'92%',maxHeight:820},
  panel:{flex:1,minHeight:0,backgroundColor:colors.white,borderRadius:radius.lg,overflow:'hidden'},
  header:{minHeight:70,paddingHorizontal:18,paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.line,flexDirection:'row',alignItems:'center',gap:12},
  headerCopy:{flex:1,gap:2},close:{width:44,height:44,borderRadius:radius.pill,backgroundColor:colors.soft,alignItems:'center',justifyContent:'center'},
  scroll:{flex:1},content:{padding:18,gap:16},
  footer:{padding:14,gap:8,borderTopWidth:1,borderTopColor:colors.line,backgroundColor:colors.white},
});
