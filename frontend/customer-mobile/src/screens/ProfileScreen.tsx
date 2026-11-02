import {useRouter} from 'expo-router';
import {Alert,Switch,View} from 'react-native';
import {useCustomerStore} from '../state/useCustomerStore';
import {AppText,Button,Card,FixtureNotice,Icon,Screen,SectionTitle,StateCard,ui} from '../components/ui';
import {CustomerHeader} from '../components/customer';
import {colors} from '../theme/tokens';

export default function ProfileScreen(){
 const router=useRouter();const {fixtures,compactCards,toggleCompactCards,leaveDemo,resetFixtures}=useCustomerStore();const user=fixtures.customer;
 return <Screen testID="screen-profile"><CustomerHeader/><AppText variant="title">Tài khoản của tôi</AppText><FixtureNotice/>{user?<Card style={{alignItems:'center',paddingVertical:24}}><View style={{height:76,width:76,borderRadius:38,backgroundColor:colors.mint,alignItems:'center',justifyContent:'center'}}><AppText variant="heading" style={{color:colors.primary}}>{user.initials}</AppText></View><AppText variant="heading" style={{textAlign:'center'}}>{user.name}</AppText><AppText style={ui.muted}>{user.email}</AppText><AppText style={ui.muted}>{user.phone}</AppText><AppText variant="caption" style={ui.muted}>Hồ sơ minh họa · Chưa xác minh danh tính</AppText></Card>:<StateCard title="Chưa có hồ sơ mẫu" description="Không có dữ liệu cá nhân nào được tải từ máy chủ." onRetry={resetFixtures}/>}
  <SectionTitle title="Tiện ích quản lý"/><Card><View style={ui.between}><View style={{flex:1,gap:4}}><AppText variant="medium">Thẻ kỳ thuê gọn hơn</AppText><AppText variant="caption" style={ui.muted}>Tùy chọn cục bộ cho bản mẫu</AppText></View><Switch accessibilityLabel="Thẻ kỳ thuê gọn hơn" value={compactCards} onValueChange={toggleCompactCards} trackColor={{false:colors.line,true:colors.primaryContainer}} thumbColor={colors.white}/></View></Card>
  <SectionTitle title="Hỗ trợ & thông tin"/><Card><View style={ui.row}><Icon name="help-buoy-outline"/><AppText variant="medium">Bạn cần hỗ trợ?</AppText></View><AppText style={ui.muted}>Xem thông báo và trao đổi mẫu, hoặc chuẩn bị bản nháp hỗ trợ trong phiên. Chưa kết nối máy chủ.</AppText><Button label="Trung tâm hỗ trợ" onPress={()=>router.push('/support')}/><Button label="Trung tâm thông báo" variant="outline" onPress={()=>router.push('/notifications')}/><Button label="Thông tin bản mẫu" variant="outline" onPress={()=>Alert.alert('VaultSpace · giai đoạn 1','Ứng dụng native dành cho khách hàng. Dữ liệu chỉ nằm trên thiết bị trong phiên trải nghiệm; chưa có tài khoản, thanh toán hay yêu cầu kho thật.')}/></Card><Button label="Đăng xuất bản mẫu" variant="outline" onPress={leaveDemo}/><AppText variant="caption" style={{textAlign:'center',color:colors.muted}}>VaultSpace Việt Nam · Phiên bản giao diện 0.1.0</AppText>
 </Screen>;
}
