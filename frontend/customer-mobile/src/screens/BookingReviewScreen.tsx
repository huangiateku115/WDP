import {useState} from 'react';
import {Pressable} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {useBookingStore} from '../state/useBookingStore';
import {storageUnits,unitIntervals} from '../fixtures/booking';
import {demoQuote,unitAvailable,dayLabel,endDay} from '../domain/booking';
import {AppText,Button,Card,FixtureNotice,Screen,StateCard,ui} from '../components/ui';
import {BackAction,BookingSteps,PricingSummary,Value} from '../components/booking';
import {RentalPeriodSelector} from '../components/RentalPeriodSelector';
export default function BookingReviewScreen(){
 const {facilityId}=useLocalSearchParams<{facilityId:string}>(),r=useRouter(),{draft,setPeriod,preview,previewedUnits}=useBookingStore(),f=useCustomerStore(s=>s.fixtures.facilities.find(f=>f.id===facilityId)),[accepted,setAccepted]=useState(false),[error,setError]=useState('');
 const u=storageUnits.find(u=>u.id===draft?.unitId&&u.facilityId===facilityId),valid=!!f&&!!u&&draft?.facilityId===facilityId,quote=demoQuote(u,draft?.months||0);
 const eligible=!!valid&&!!draft&&!!u&&!!quote&&!previewedUnits.includes(u.id)&&unitAvailable(u,draft.start,draft.months,unitIntervals);
 return <Screen safeTop={false} testID="screen-review"><FixtureNotice/>{!valid||!draft||!u?<StateCard title="Chưa có lựa chọn kho hợp lệ" description="Hãy quay lại cơ sở và chọn một kho mẫu."/>:<><BookingSteps step={2}/><AppText variant="title">Kỳ thuê & báo giá</AppText><Card><AppText variant="card">{f.name}</AppText><Value label="Kho tự quản riêng" value={u.code+' · '+u.dimensions}/><AppText>{u.volumeM3.toLocaleString('vi-VN')} m³</AppText></Card><RentalPeriodSelector draft={draft} onChange={(start,months)=>{setAccepted(false);setError('');setPeriod(start,months);}}/><PricingSummary quote={quote}/><AppText variant="medium">{dayLabel(draft.start)} – {dayLabel(endDay(draft.start,draft.months)||'')}</AppText>{!eligible&&<AppText accessibilityRole="alert">Lựa chọn không còn hợp lệ với kỳ thuê này, thiếu báo giá hoặc đã được xem trước. Hãy kiểm tra ngày và chọn lại kho.</AppText>}<Card><AppText variant="card">Trước khi tiếp tục</AppText><AppText>Đơn giá mẫu × số tháng; không chiết khấu, phụ phí hay chính sách hoàn hủy giả định. Báo giá thực tế sẽ phụ thuộc Backend ở giai đoạn sau.</AppText><Pressable accessibilityRole="checkbox" accessibilityLabel="Tôi hiểu đây chỉ là bản xem trước" accessibilityState={{checked:accepted}} onPress={()=>setAccepted(v=>!v)} style={{minHeight:50,paddingVertical:12}}><AppText variant="medium">{accepted?'☑':'☐'} Tôi hiểu đây chỉ là bản xem trước</AppText></Pressable></Card>{!!error&&<AppText accessibilityRole="alert">{error}</AppText>}<Button label="Xem trước xác nhận đặt chỗ" disabled={!eligible||!accepted} onPress={()=>{if(preview())r.push({pathname:'/booking/[facilityId]/confirmation',params:{facilityId}});else setError('Dữ liệu mẫu đã thay đổi. Vui lòng chọn lại kho.');}}/></>}<BackAction/></Screen>;
}
