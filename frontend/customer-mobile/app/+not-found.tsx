import {useRouter} from 'expo-router';
import {Screen,StateCard,Button} from '../src/components/ui';
export default function NotFound(){const router=useRouter();return <Screen><StateCard title="Không tìm thấy màn hình" description="Đường dẫn này không có trên ứng dụng."/><Button label="Về trang đầu" onPress={()=>router.replace('/')}/></Screen>;}
