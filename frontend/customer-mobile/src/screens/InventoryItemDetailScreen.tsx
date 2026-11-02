import {requestContext} from '../fixtures/inventoryRequests';
import {requestEligibility} from '../domain/inventoryRequests';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useCustomerStore} from '../state/useCustomerStore';
import {inventoryDetails, inventoryRentals} from '../fixtures/inventory';
import {canEditItem, measurementText, ownItem} from '../domain/inventory';
import {AppText, Button, Card, Chip, FixtureNotice, Screen, StateCard, ui} from '../components/ui';
import {Value} from '../components/booking';
import {BatchOverview, ItemGallery, StockBalance} from '../components/inventory';

export default function InventoryItemDetailScreen({loading = false, error}: {loading?: boolean; error?: string}) {
  const {id} = useLocalSearchParams<{id: string}>(), router = useRouter(), data = useCustomerStore(s => s.fixtures);
  const record = ownItem(data, id, inventoryDetails);
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/inventory');
  const rental = inventoryRentals.find(r => r.id === record?.detail.rentalId && r.ownerId === data.customer?.id);
  const inboundContext=requestContext(data,id,'INBOUND'), outboundContext=requestContext(data,id,'OUTBOUND');
  const inbound=inboundContext?requestEligibility(inboundContext,'INBOUND'):null, outbound=outboundContext?requestEligibility(outboundContext,'OUTBOUND'):null;
  return <Screen safeTop={false} testID="screen-item-detail"><FixtureNotice/>
    {loading ? <StateCard kind="loading" title="Đang chuẩn bị hàng hóa mẫu"/> : error ? <StateCard kind="error" title="Không thể hiển thị hàng hóa" description={error}/> : !record ? <StateCard title="Không tìm thấy dữ liệu mẫu" description="Hàng không tồn tại trong danh mục của khách hàng hiện tại hoặc đường dẫn không hợp lệ."/> : <>
      <Chip label={record.item.status === 'IN_STORAGE' ? 'Đang lưu kho · mẫu' : 'Mới đăng ký · mẫu'} tone={record.item.status === 'IN_STORAGE' ? 'green' : 'orange'}/>
      <AppText variant="title">{record.item.name}</AppText><AppText variant="label" style={ui.muted}>{record.item.code}</AppText>
      <ItemGallery images={record.detail.images}/>
      <StockBalance {...record}/>
      <Card><AppText variant="card">Thông tin mặt hàng</AppText><Value label="Danh mục" value={record.item.category}/><AppText>{record.detail.description}</AppText><Value label="Kỳ thuê ký gửi mẫu" value={rental ? rental.code + ' · ' + rental.name : 'Chưa có kỳ thuê mẫu phù hợp'}/><Value label="Ô ưu tiên · chưa phải phân ô thực tế" value={record.detail.preferredCell ?? 'Không chỉ định'}/><Value label="Ô lưu trữ thực tế trong fixture" value={record.item.status === 'IN_STORAGE' ? record.item.cell ?? 'Chưa có dữ liệu vị trí' : 'Chưa xác nhận nhập kho'}/><Value label="Số đo đơn vị khai báo · chưa phải kiểm đếm" value={measurementText(record.detail.declaredMeasurements)}/></Card>
      <BatchOverview batches={record.detail.batches} unit={record.item.unit}/>
      <Card><AppText variant="card">Thao tác khách hàng</AppText><Button label="Chỉnh sửa hàng hóa" variant="outline" disabled={!canEditItem(record.item, record.detail)} onPress={() => router.push({pathname: '/inventory/edit/[id]', params: {id: record.item.id}})}/><AppText variant="caption" style={ui.muted}>{record.detail.editReason}</AppText><Button label="Lịch sử di chuyển" onPress={() => router.push({pathname: '/inventory/[id]/history', params: {id: record.item.id}})}/><Button label={inbound?.eligible?'Yêu cầu nhập thêm hàng':'Đăng ký nhập kho · chưa khả dụng'} variant="outline" disabled={!inbound?.eligible} onPress={()=>router.push({pathname:'/inventory/[id]/inbound',params:{id:record.item.id}})}/>{!inbound?.eligible&&<AppText variant="caption" style={ui.muted}>{inbound?.reason}</AppText>}<Button label={outbound?.eligible?'Yêu cầu xuất kho':'Yêu cầu xuất kho · chưa khả dụng'} variant="outline" disabled={!outbound?.eligible} onPress={()=>router.push({pathname:'/inventory/[id]/outbound',params:{id:record.item.id}})}/>{!outbound?.eligible&&<AppText variant="caption" style={ui.muted}>{outbound?.reason}</AppText>}<AppText variant="caption" style={ui.muted}>Phase này chỉ xem dữ liệu và chuẩn bị bản nháp; không gửi yêu cầu hay xác nhận thao tác vật lý.</AppText></Card>
    </>}
    <Button label="Trở về màn hình trước" variant="quiet" onPress={back}/>
  </Screen>;
}
