import {View} from 'react-native';
import {useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {AppText,Button,Card,Chip,FixtureNotice,Icon,Screen,SectionTitle,StateCard,ui} from '../components/ui';
import {CustomerHeader,FacilityCard,RentalCard} from '../components/customer';
import {colors} from '../theme/tokens';

export default function DashboardScreen(){
 const router=useRouter(),data=useCustomerStore(s=>s.fixtures);
 const active=data.rentals.find(r=>r.status==='ACTIVE'),pending=data.rentals.find(r=>r.status==='RESERVED');
 const today=new Intl.DateTimeFormat('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
 return <Screen testID="screen-home"><CustomerHeader showNotifications/><View style={{gap:8}}><AppText variant="caption" style={ui.muted}>{today} · TP. Hồ Chí Minh</AppText><AppText variant="title">Xin chào, {data.customer?.name.split(' ').at(-1)||'bạn'}!</AppText><AppText style={ui.muted}>Không gian gọn gàng. An tâm mỗi ngày.</AppText><View style={ui.wrap}><Chip label={`${data.rentals.filter(r=>r.status==='ACTIVE').length} kỳ thuê đang dùng`}/><Chip label={`${data.items.length} mã hàng mẫu`} tone="neutral"/></View></View><FixtureNotice/>
  {pending&&<Card style={{backgroundColor:colors.orangeTint,borderColor:'#f2d6b6'}}><View style={ui.row}><Icon name="time-outline" color={colors.orangeText}/><AppText variant="label" style={{color:colors.orangeText}}>KỲ THUÊ CẦN THEO DÕI</AppText></View><AppText variant="card">Đang giữ chỗ tại Thủ Đức</AppText><AppText style={{color:colors.orangeText}}>Xem thông tin và các bước tiếp theo của kỳ thuê mẫu. Chưa phát sinh giao dịch thanh toán.</AppText><Button label="Xem kỳ thuê mẫu" variant="orange" onPress={()=>router.push({pathname:'/preview/[kind]/[id]',params:{kind:'rental',id:pending.id}})}/></Card>}
  <SectionTitle title="Kho đang thuê" action="Tất cả" onPress={()=>router.push('/(tabs)/rentals')}/>
  {active?<RentalCard rental={active} facility={data.facilities.find(f=>f.id===active.facilityId)}/>:<StateCard title="Chưa có kỳ thuê đang dùng" description="Khám phá các không gian lưu trữ mẫu để bắt đầu."/>}
  <View style={{flexDirection:'row',gap:12}}><Card style={{flex:1}}><Icon name="compass-outline"/><AppText variant="medium">Tìm không gian phù hợp</AppText><Button label="Khám phá kho" variant="quiet" onPress={()=>router.push('/(tabs)/explore')}/></Card><Card style={{flex:1}}><Icon name="file-tray-stacked-outline"/><AppText variant="medium">Hàng hóa trong tầm tay</AppText><Button label="Xem hàng hóa" variant="quiet" onPress={()=>router.push('/(tabs)/inventory')}/></Card></View>
  <SectionTitle title="Không gian dành cho bạn"/>{data.facilities[0]?<FacilityCard facility={data.facilities[0]}/>:<StateCard title="Chưa có cơ sở mẫu"/>}
  <SectionTitle title="Ghi chú cho trải nghiệm"/><Card><View style={ui.row}><Icon name="information-circle-outline"/><AppText variant="medium" style={{flex:1}}>Bạn đang khám phá giao diện ngoại tuyến</AppText></View><AppText style={ui.muted}>Mọi kỳ thuê, giá và số lượng hiển thị đều là dữ liệu mẫu. Chưa có thông báo giao dịch, mã mở cửa hoặc đồng bộ kho thực tế.</AppText></Card>
 </Screen>;
}
