import {CardHeading,MetricTile,TintedPanel} from '../components/livePresentation';
import {useState} from 'react';
import {useRouter} from 'expo-router';
import {View} from 'react-native';
import {refId} from '../api/contracts/core';
import {lifecycle} from '../api/contracts/customer';
import {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard,ui} from '../components/ui';
import {dateLabel,LiveScreen,ResourceState,useResource} from '../components/liveUI';

const movementLabel={INBOUND:'Nhập kho',OUTBOUND:'Xuất kho',RELOCATION:'Di chuyển'};
const pendingStatuses=new Set(['RESERVED','CONTRACTED','DEPOSIT_PAID','CHECKIN_READY','PAID']);
export function ManagedDashboard(){
  const owner=useLiveSession(s=>s.user?._id??'');
  const router=useRouter();
  const [page,setPage]=useState(1),[stockItem,setStockItem]=useState('');
  const rentals=useResource(owner,signal=>mobileRepo.rentals(owner,signal).then(rows=>rows.filter(r=>r.serviceType==='MANAGED_INVENTORY')));
  const inventory=useResource(owner+':'+page,signal=>mobileRepo.inventory(owner,page,signal));
  const items=inventory.data?.items;
  const preview=items?.slice(0,3);
  const inspected=items?.find(item=>item._id===stockItem);
  const stock=useResource(owner+':'+(inspected?._id??''),signal=>inspected?mobileRepo.stock(inspected,owner,signal):Promise.resolve(null));
  const activity=useResource(owner+':'+(preview?.map(item=>item._id).join(',')??''),async signal=>{
    const results=await Promise.allSettled((preview??[]).map(item=>mobileRepo.movements(item,owner,signal)
      .then(moves=>moves.map(move=>({...move,itemName:item.name})))));
    return {partial:results.some(result=>result.status==='rejected'),rows:results.flatMap(result=>result.status==='fulfilled'?result.value:[])
      .sort((a,b)=>Date.parse(b.performedAt)-Date.parse(a.performedAt)).slice(0,5)};
  });
  function refresh(){rentals.reload();inventory.reload();activity.reload();stock.reload();}
  return <LiveScreen title="Kho hàng của tôi" eyebrow="KHO KÝ GỬI" subtitle="Theo dõi đơn thuê kho ký gửi và hàng hóa đã đăng ký của bạn." onRefresh={refresh} refreshing={rentals.loading||inventory.loading}>
    <TintedPanel><CardHeading icon="business-outline" title="Không gian kho ký gửi" subtitle="Khám phá các cơ sở đang cung cấp dịch vụ."/>
    <Button label="Tìm kho ký gửi" icon="compass-outline" onPress={()=>router.push('/managed/facilities')}/></TintedPanel>
    <Button label="Làm mới kho hàng" variant="quiet" onPress={refresh}/>
    <ResourceState {...rentals}/>
    {rentals.data&&<Card>
      <CardHeading icon="key-outline" title="Đơn thuê kho ký gửi"/>
      <View style={ui.wrap}><MetricTile icon="business-outline" label="Kho đang sử dụng" value={new Set(rentals.data.filter(r=>r.status==='ACTIVE').map(r=>refId(r.facilityId))).size}/>
      <MetricTile icon="time-outline" label="Đơn đang xử lý" value={rentals.data.filter(r=>pendingStatuses.has(r.status)).length}/></View>
    </Card>}
    {rentals.data?.length===0&&<StateCard title="Bạn chưa có kho ký gửi nào."/>}
    {rentals.data?.map(r=><Card key={r._id}>
      <CardHeading icon="key-outline" title={r.reservationCode}/>
      <AppText>{typeof r.facilityId==='object'&&typeof r.facilityId.name==='string'?r.facilityId.name:'Kho ký gửi'}</AppText>
      <AppText>{lifecycle(r).label===r.status?({CANCELLED:'Đã hủy',OVERDUE:'Quá hạn',CLOSED:'Đã đóng',CHECKED_OUT:'Đã trả kho'}[r.status as string]??'Đang cập nhật'):lifecycle(r).label}</AppText>
      <AppText>{dateLabel(r.startDate)} – {dateLabel(r.endDate)}</AppText>
      <Button label="Xem đơn kho ký gửi" variant="outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/confirmation',
        params:{facilityId:refId(r.facilityId),reservationId:r._id}})}/>
    </Card>)}
    <AppText variant="heading">Hàng hóa đã đăng ký</AppText>
    <ResourceState {...inventory}/>
    {inventory.data&&<AppText>Số hồ sơ hàng: {inventory.data.pagination.total}</AppText>}
    {items?.length===0&&<StateCard title="Chưa có hàng hóa"/>}
    {items?.map(item=><Card key={item._id}>
      <CardHeading icon="cube-outline" title={item.name}/>
      <AppText>Mã hàng {item.itemCode} · Đăng ký {item.quantity} {item.quantityUnit}</AppText>
      <Button label={stockItem===item._id?'Ẩn tồn kho':'Xem tồn kho'} variant="quiet" onPress={()=>setStockItem(stockItem===item._id?'':item._id)}/>
      {inspected?._id===item._id&&<>
        <ResourceState {...stock}/>
        {stock.data&&<>
          <AppText variant="caption">{stock.data.source==='LEDGER_V2'?'Sổ tồn kho theo lô':'Số liệu đã đối chiếu từ dữ liệu cũ'}</AppText>
          <AppText>Đang lưu: {stock.data.onHandQuantity} {stock.data.quantityUnit}</AppText>
          <AppText>Đang giữ: {stock.data.heldQuantity} {stock.data.quantityUnit}</AppText>
          <AppText>Khả dụng: {stock.data.availableQuantity===undefined?'Chưa có xác nhận':stock.data.availableQuantity+' '+stock.data.quantityUnit}</AppText>
        </>}
      </>}
      <Button label="Xem hàng hóa" variant="outline" onPress={()=>router.push({pathname:'/preview/[kind]/[id]',params:{kind:'inventory',id:item._id}})}/>
    </Card>)}
    {inventory.data&&inventory.data.pagination.totalPages>1&&<View style={ui.between}>
      <Button label="Trang trước" variant="quiet" disabled={page<=1} onPress={()=>{setStockItem('');setPage(page-1);}}/>
      <AppText>{page}/{inventory.data.pagination.totalPages}</AppText>
      <Button label="Trang sau" variant="quiet" disabled={page>=inventory.data.pagination.totalPages} onPress={()=>{setStockItem('');setPage(page+1);}}/>
    </View>}
    {!!preview?.length&&<Card>
      <CardHeading icon="time-outline" title="Hoạt động gần đây"/>
      <AppText variant="caption">Từ {preview.length} hồ sơ đầu trên trang hiện tại.</AppText>
      <ResourceState {...activity}/>
      {activity.data?.partial&&<AppText>Chưa tải được lịch sử của một số hồ sơ.</AppText>}
      {activity.data?.rows.length===0&&!activity.data.partial&&<AppText>Chưa có hoạt động cho các hồ sơ này.</AppText>}
      {activity.data?.rows.map(move=><AppText key={move._id}>{movementLabel[move.type]} · {move.itemName} · {dateLabel(move.performedAt)}</AppText>)}
    </Card>}
  </LiveScreen>;
}
