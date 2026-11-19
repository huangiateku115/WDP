import {PrototypeConfirmationHeader} from '../components/PrototypeConfirmation';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useBookingStore} from '../state/useBookingStore';
import {useCustomerStore} from '../state/useCustomerStore';
import {storageUnits} from '../fixtures/booking';
import {demoQuote,dayLabel,endDay} from '../domain/booking';
import {AppText,Button,Card,FixtureNotice,Screen,StateCard,ui} from '../components/ui';
import {BackAction,BookingSteps,PricingSummary} from '../components/booking';
export default function BookingConfirmationScreen(){
 const {facilityId}=useLocalSearchParams<{facilityId:string}>(),r=useRouter(),{draft,previewedUnits}=useBookingStore(),f=useCustomerStore(s=>s.fixtures.facilities.find(f=>f.id===facilityId)),u=storageUnits.find(u=>u.id===draft?.unitId&&u.facilityId===facilityId),q=demoQuote(u,draft?.months||0);
 const valid=f&&u&&q&&draft?.facilityId===facilityId&&draft.previewed&&previewedUnits.includes(u.id);
 return <Screen safeTop={false} testID="screen-confirmation"><FixtureNotice/>{!valid||!draft||!f||!u?<StateCard title="Chưa có bản xem trước phù hợp"/>:<><BookingSteps step={3}/><PrototypeConfirmationHeader/><Card><AppText variant="card">{f.name}</AppText><AppText>Kho riêng {u.code} · {u.volumeM3.toLocaleString('vi-VN')} m³</AppText><AppText>{dayLabel(draft.start)} – {dayLabel(endDay(draft.start,draft.months)||'')}</AppText><AppText>{draft.months} tháng · {f.address}</AppText></Card><PricingSummary quote={q}/><Card><AppText variant="card">Các bước tiếp theo</AppText><AppText>1. Xác nhận còn chỗ và hoàn tất đặt thuê.</AppText><AppText>2. Thanh toán tiền thuê theo hướng dẫn.</AppText><AppText>3. Nhân viên xác minh hợp đồng giấy đã ký.</AppText><AppText>4. Cơ sở bàn giao kho sau khi các bước cần thiết hoàn tất.</AppText><AppText variant="caption" style={ui.muted}>Đây là chế độ xem thử. Chưa tạo đơn thuê hoặc khoản thanh toán thật.</AppText></Card><Button label="Xem kho thuê của tôi" onPress={()=>r.replace('/(tabs)/rentals')}/><Button label="Quay về Khám phá" variant="outline" onPress={()=>r.replace('/(tabs)/explore')}/></>}<BackAction/></Screen>;
}
