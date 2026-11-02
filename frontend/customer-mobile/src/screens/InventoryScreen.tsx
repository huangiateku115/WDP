import {inventoryDetails} from '../fixtures/inventory';
import {useRouter} from 'expo-router';
import {useState} from 'react';
import {View} from 'react-native';
import {useCustomerStore} from '../state/useCustomerStore';
import {AppText,Button,Card,Chip,Filter,FixtureNotice,Icon,Input,Screen,StateCard,ui} from '../components/ui';
import {CustomerHeader,InventoryCard} from '../components/customer';
import {colors} from '../theme/tokens';

export default function InventoryScreen(){
 const router=useRouter();
 const data=useCustomerStore(s=>s.fixtures);const items=data.items.filter(i=>inventoryDetails.some(d=>d.itemId===i.id&&d.ownerId===data.customer?.id));const [query,setQuery]=useState(''),[category,setCategory]=useState('Tất cả');
 const categories=['Tất cả',...new Set(items.map(i=>i.category))];const rows=items.filter(i=>(category==='Tất cả'||i.category===category)&&`${i.name} ${i.code}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')));
 return <Screen testID="screen-inventory"><CustomerHeader/><AppText variant="title">Hàng hóa ký gửi</AppText><AppText style={ui.muted}>Theo dõi từng mã hàng, vị trí và số lượng lưu kho.</AppText><FixtureNotice/><Card style={{backgroundColor:colors.primary,borderColor:colors.primary}}><View style={ui.row}><Icon name="file-tray-stacked-outline" color={colors.white}/><AppText variant="label" style={{color:colors.white}}>DANH MỤC HÀNG MẪU</AppText></View><AppText variant="heading" style={{color:colors.white}}>{items.length} mã hàng</AppText><AppText style={{color:'#c1e7cf'}}>Không cộng gộp số lượng có đơn vị khác nhau. Số lượng khai báo không thay cho tồn kho thực tế.</AppText></Card><Button label="Đăng ký hàng hóa · bản nháp" variant="outline" onPress={()=>router.push('/inventory/register')}/><Input label="Tìm mã hàng" placeholder="Tên hàng hoặc mã hàng" value={query} onChangeText={setQuery}/><View style={ui.wrap}>{categories.map(value=><Filter key={value} label={value} selected={category===value} onPress={()=>setCategory(value)}/>)}</View>{rows.length?rows.map(i=><InventoryCard key={i.id} item={i}/>):<StateCard title="Chưa có hàng hóa phù hợp" description="Thử thay đổi từ khóa hoặc nhóm hàng." onRetry={()=>{setQuery('');setCategory('Tất cả');}}/>}<View style={ui.row}><Chip label="Chỉ xem dữ liệu mẫu" tone="orange"/></View><AppText variant="caption" style={ui.muted}>Nhập/xuất và di chuyển vật lý chưa khả dụng. Biểu mẫu chỉ lưu nháp trong bộ nhớ, không tạo hàng thật. Nhân viên kho thực hiện việc bàn giao thực tế.</AppText></Screen>;
}
