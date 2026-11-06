import {useLocalSearchParams,useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {useManagedBookingStore} from '../state/useManagedBookingStore';
import {useBookingStore} from '../state/useBookingStore';
import {AppText,Button,Card,Chip,FixtureNotice,Screen,StateCard,ui} from '../components/ui';
import {BackAction,Value} from '../components/booking';
import {WarehouseArt} from '../components/WarehouseArt';
import {facilityDetails,storageUnits} from '../fixtures/booking';
import {money,serviceLabel} from '../domain/models';
export default function FacilityDetailScreen({loading=false}:{loading?:boolean}){
 const {id}=useLocalSearchParams<{id:string}>(),router=useRouter(),data=useCustomerStore(s=>s.fixtures),begin=useBookingStore(s=>s.begin);
 const f=typeof id==='string'?data.facilities.find(f=>f.id===id):undefined,info=f?facilityDetails[f.id]:undefined;
 const prices=storageUnits.filter(u=>u.facilityId===f?.id&&u.monthlyPrice!==null).map(u=>u.monthlyPrice!);
 return <Screen safeTop={false} testID="screen-detail"><FixtureNotice/>{loading?<StateCard kind="loading" title="Đang chuẩn bị cơ sở mẫu"/>:!f?<StateCard title="Không tìm thấy cơ sở mẫu" description="Đường dẫn không hợp lệ hoặc cơ sở không còn trong bộ dữ liệu."/>:<><WarehouseArt variant={f.illustration} height={210}/><Chip label={f.district}/><AppText variant="title">{f.name}</AppText><AppText style={ui.muted}>{f.address}</AppText><Card><Value label="Khung giờ hỗ trợ mẫu" value={info?.hours||'Chưa có thông tin'}/><AppText>{f.description}</AppText></Card><AppText variant="card">Dịch vụ lưu trữ</AppText>{f.services.map(service=><Card key={service}><Chip label={serviceLabel(service)}/><AppText>{service==='SELF_STORAGE'?'Một kho riêng cho một kỳ thuê. Chọn kích cỡ phù hợp với đồ dùng của bạn.':'Hàng hóa lưu tại các ô kệ được phân bổ; nhân viên phụ trách tiếp nhận và xuất hàng.'}</AppText>{service==='SELF_STORAGE'&&<><AppText variant="heading">{prices.length?'Từ '+money(Math.min(...prices))+' / tháng':'Chưa có giá kho tự quản mẫu'}</AppText><AppText variant="caption" style={ui.muted}>{storageUnits.filter(u=>u.facilityId===f.id).length} kho minh họa · chưa xác minh chỗ trống trực tuyến</AppText><Button label="Khám phá kho tự quản" onPress={()=>{begin(f.id);router.push({pathname:'/booking/[facilityId]/units',params:{facilityId:f.id}});}}/></>}{service==='MANAGED_INVENTORY'&&<Button label="Chọn ô trên bản đồ kho" variant="outline" onPress={()=>{if(useManagedBookingStore.getState().begin(f.id))router.push({pathname:'/managed/[facilityId]/map',params:{facilityId:f.id}});}}/>}</Card>)}<Card><AppText variant="card">Tiện ích mẫu</AppText>{info?.amenities.map(a=><AppText key={a}>✓ {a}</AppText>)||<AppText>Chưa có thông tin tiện ích.</AppText>}<AppText variant="caption" style={ui.muted}>Giờ hoạt động và tiện ích chỉ minh họa; chưa xác nhận dịch vụ thực tế.</AppText></Card></>}<BackAction/></Screen>;
}
