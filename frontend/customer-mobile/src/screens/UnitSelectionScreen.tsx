import {useEffect,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {useBookingStore} from '../state/useBookingStore';
import {storageUnits,unitIntervals} from '../fixtures/booking';
import {unitAvailable,type UnitSize} from '../domain/booking';
import {AppText,Button,FixtureNotice,Screen,StateCard,ui} from '../components/ui';
import {BackAction,BookingSteps,UnitCard,UnitSizeFilter} from '../components/booking';
import {RentalPeriodSelector} from '../components/RentalPeriodSelector';
export default function UnitSelectionScreen(){
 const {facilityId}=useLocalSearchParams<{facilityId:string}>(),r=useRouter(),f=useCustomerStore(s=>s.fixtures.facilities.find(f=>f.id===facilityId)),{draft,begin,select,setPeriod,previewedUnits}=useBookingStore(),[size,setSize]=useState<'ALL'|UnitSize>('ALL');
 useEffect(()=>{if(f?.services.includes('SELF_STORAGE'))begin(f.id);},[f,begin]);
 const valid=f?.services.includes('SELF_STORAGE')&&draft?.facilityId===facilityId;
 const units=storageUnits.filter(u=>u.facilityId===facilityId&&(size==='ALL'||u.size===size)),selected=storageUnits.find(u=>u.id===draft?.unitId);
 const canContinue=!!valid&&!!draft&&!!selected&&!previewedUnits.includes(selected.id)&&unitAvailable(selected,draft.start,draft.months,unitIntervals);
 return <Screen safeTop={false} testID="screen-units"><FixtureNotice/>{!f?.services.includes('SELF_STORAGE')?<StateCard title="Không tìm thấy kho tự quản"/>:!valid||!draft?<StateCard kind="loading" title="Đang chuẩn bị lựa chọn mẫu"/>:<><BookingSteps step={1}/><AppText variant="title">Chọn kho riêng của bạn</AppText><AppText variant="medium">{f.name}</AppText><RentalPeriodSelector key={facilityId} draft={draft} onChange={setPeriod}/><AppText variant="card">Kích cỡ phù hợp</AppText><UnitSizeFilter value={size} onChange={setSize}/>{units.length?units.map(u=><UnitCard key={u.id} unit={u} selected={draft.unitId===u.id} available={!previewedUnits.includes(u.id)&&unitAvailable(u,draft.start,draft.months,unitIntervals)} onSelect={()=>select(u.id)}/>):<StateCard title="Chưa có kho ở kích cỡ này"/>}<AppText variant="caption" style={ui.muted}>Chỉ chọn một kho. Kho đã dùng trong bản xem trước của phiên này sẽ bị khóa để tránh lặp thao tác; không có HOLD thực tế.</AppText><Button label="Tiếp tục xem kỳ thuê & giá" disabled={!canContinue} onPress={()=>{if(canContinue)r.push({pathname:'/booking/[facilityId]/review',params:{facilityId:f.id}});}}/></>}<BackAction/></Screen>;
}
