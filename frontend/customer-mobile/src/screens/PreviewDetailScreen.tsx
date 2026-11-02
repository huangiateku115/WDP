import FacilityDetailScreen from './FacilityDetailScreen';
import RentalDetailScreen from './RentalDetailScreen';
import InventoryItemDetailScreen from './InventoryItemDetailScreen';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {Button,FixtureNotice,Screen,StateCard} from '../components/ui';

// Keep all Phase 1 detail URLs, dispatching each completed design in place.
export default function PreviewDetailScreen(){
 const {kind}=useLocalSearchParams<{kind:string;id:string}>(),router=useRouter();
 if(kind==='facility')return <FacilityDetailScreen/>;
 if(kind==='rental')return <RentalDetailScreen/>;
 if(kind==='item')return <InventoryItemDetailScreen/>;
 return <Screen safeTop={false} testID="screen-detail"><FixtureNotice/><StateCard title="Không tìm thấy dữ liệu mẫu" description="Thông tin có thể đã thay đổi hoặc đường dẫn không hợp lệ."/><Button label="Trở về màn hình trước" variant="outline" onPress={()=>router.canGoBack()?router.back():router.replace('/(tabs)')}/></Screen>;
}
