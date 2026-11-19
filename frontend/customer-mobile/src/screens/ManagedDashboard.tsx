import {CardHeading,MetricTile,TintedPanel} from '../components/livePresentation';
import {useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {Image,View} from 'react-native';
import {refId} from '../api/contracts/core';
import {lifecycle,type ReservationDto} from '../api/contracts/customer';
import {mobileRepo} from '../api/mobileRepository';
import {ManagedSkuStockPanel} from '../components/ManagedSkuStockPanel';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard,NavigationRow,ui} from '../components/ui';
import {dateLabel,LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {managedReservationDetailTarget,managedReservationInventoryTarget} from '../domain/managedInventoryNavigation';

const pendingStatuses=new Set(['RESERVED','CONTRACTED','DEPOSIT_PAID','CHECKIN_READY','PAID']);
type ManagedDashboardProps={mode:'overview'|'reservation';reservationId?:string;facilityId?:string;sessionId?:string;operation?:string};
type InventoryItem=Awaited<ReturnType<typeof mobileRepo.inventory>>['items'][number];

export function InventoryOverview(){return <ManagedDashboard mode="overview"/>;}

export function ReservationInventoryDetail(){
  const params=useLocalSearchParams<{reservationId?:string|string[];facilityId?:string|string[];sessionId?:string|string[];operation?:string|string[]}>();
  const reservationId=Array.isArray(params.reservationId)?params.reservationId[0]??'':params.reservationId??'';
  const facilityId=Array.isArray(params.facilityId)?params.facilityId[0]??'':params.facilityId??'';
  const sessionId=Array.isArray(params.sessionId)?params.sessionId[0]:params.sessionId;
  const operation=Array.isArray(params.operation)?params.operation[0]:params.operation;
  if(!reservationId)return <LiveScreen title="Hàng hóa của đơn thuê"><StateCard kind="error" title="Thiếu mã đơn thuê" description="Hãy mở trang này từ chi tiết đơn thuê."/></LiveScreen>;
  return <ManagedDashboard mode="reservation" reservationId={reservationId} facilityId={facilityId} sessionId={sessionId} operation={operation}/>;
}

export function ManagedDashboard({mode,reservationId:scopedReservationId='',facilityId='',sessionId,operation}:ManagedDashboardProps){
  const owner=useLiveSession(s=>s.user?._id??'');
  const router=useRouter(),reservationMode=mode==='reservation',reservationId=reservationMode?scopedReservationId:'';
  const [refreshRevision,setRefreshRevision]=useState(0);
  const rentals=useResource(owner+':managed-inventory-overview',signal=>reservationMode
    ?Promise.resolve([] as Awaited<ReturnType<typeof mobileRepo.rentals>>)
    :mobileRepo.rentals(owner,signal).then(rows=>rows.filter(r=>r.serviceType==='MANAGED_INVENTORY')));
  const inventory=useResource(reservationMode?owner+':reservation-inventory:'+reservationId:owner+':overview-no-inventory',signal=>reservationMode
    ?mobileRepo.inventoryForReservation(owner,reservationId,signal,facilityId||undefined)
    :Promise.resolve(undefined));
  const selectedRental:ReservationDto|undefined=reservationMode?inventory.data?.reservation:undefined;
  const items=reservationMode?inventory.data?.items:undefined;
  function refresh(){if(reservationMode)inventory.reload();else rentals.reload();setRefreshRevision(value=>value+1);}
  function renderSku(item:InventoryItem){return <Card key={item._id}>
    <CardHeading icon="cube-outline" title={item.name}/>
    {!!item.images?.[0]&&<Image source={{uri:item.images[0]}} accessibilityLabel={`Ảnh ${item.name}`} resizeMode="cover" style={{width:'100%',height:150,borderRadius:12}}/>}
    <AppText>Mã hàng {item.itemCode}{item.inventorySchemaVersion!==3?` · Đăng ký ${item.quantity} ${item.quantityUnit}`:''}</AppText>
    {!!item.category&&<AppText>Danh mục: {item.category}</AppText>}
    {selectedRental&&<AppText>Đơn thuê: {selectedRental.reservationCode}{typeof selectedRental.facilityId==='object'&&selectedRental.facilityId!==null&&typeof selectedRental.facilityId.name==='string'?` · ${selectedRental.facilityId.name}`:''}</AppText>}
    <ManagedSkuStockPanel item={item} owner={owner} reservation={selectedRental} refreshRevision={refreshRevision}/>
    {selectedRental&&operation&&<Button label="Chọn hàng hóa" variant="outline" onPress={()=>router.push({pathname:'/inventory/[id]',params:{id:item._id,...(sessionId?{accessSessionId:sessionId}:{}),operation}} as unknown as Href)}/>}
  </Card>;}
  function backFromReservation(){
    if(selectedRental)router.replace(managedReservationDetailTarget(reservationId,refId(selectedRental.facilityId)));
  }
  return <LiveScreen title={reservationMode?'Hàng hóa của đơn thuê':'Hàng hóa'} eyebrow="KHO KÝ GỬI" subtitle={reservationMode?'Danh sách hàng hóa thuộc đơn thuê đang xem.':'Theo dõi các đơn kho ký gửi của bạn.'} onRefresh={refresh} refreshing={reservationMode?inventory.loading:rentals.loading}
    backButton={reservationMode?{onPress:backFromReservation,disabled:!selectedRental}:undefined}>
    {reservationMode?<>
      <NavigationRow label="Hàng hóa tổng quan" icon="file-tray-stacked-outline" onPress={()=>router.replace('/(tabs)/inventory')}/>
      {selectedRental&&<Card><CardHeading icon="key-outline" title={selectedRental.reservationCode} subtitle="Danh mục hàng hóa của đơn thuê này"/>
        <AppText>{dateLabel(selectedRental.startDate)} – {dateLabel(selectedRental.endDate)}</AppText>
      </Card>}
      <Button label="Đăng ký hàng hóa cho đơn này" icon="add-circle-outline" variant="outline" disabled={!selectedRental} onPress={()=>router.push({pathname:'/inventory/register',params:{reservationId}})}/>
      <ResourceState {...inventory} resource="hàng hóa của đơn thuê"/>
      {inventory.data&&<AppText>Số mặt hàng: {inventory.data.pagination.total}</AppText>}
      {items?.length===0&&<StateCard title="Đơn thuê này chưa có hàng hóa"/>}
      {items?.map(renderSku)}
    </>:<>
      <TintedPanel><CardHeading icon="business-outline" title="Không gian kho ký gửi" subtitle="Khám phá các cơ sở đang cung cấp dịch vụ."/>
        <Button label="Tìm kho ký gửi" icon="compass-outline" onPress={()=>router.push('/managed/facilities')}/>
      </TintedPanel>
      <Button label="Làm mới danh sách" variant="quiet" onPress={refresh}/>
      <ResourceState {...rentals}/>
      {rentals.data&&<Card>
        <CardHeading icon="key-outline" title="Đơn thuê kho ký gửi"/>
        <View style={ui.wrap}>
          <MetricTile icon="business-outline" label="Kho đang sử dụng" value={new Set(rentals.data.filter(r=>r.status==='ACTIVE').map(r=>refId(r.facilityId))).size}/>
          <MetricTile icon="time-outline" label="Đơn đang xử lý" value={rentals.data.filter(r=>pendingStatuses.has(r.status)).length}/>
        </View>
      </Card>}
      {rentals.data?.length===0&&<>
        <StateCard title="Bạn chưa có đơn kho ký gửi nào" description="Khám phá dịch vụ kho ký gửi để chọn cơ sở phù hợp."/>
        <Button label="Tìm kho ký gửi" icon="compass-outline" onPress={()=>router.push('/managed/facilities')}/>
      </>}
      {rentals.data?.map(r=><Card key={r._id}>
        <CardHeading icon="key-outline" title={r.reservationCode}/>
        <AppText>{typeof r.facilityId==='object'&&typeof r.facilityId.name==='string'?r.facilityId.name:'Kho ký gửi'}</AppText>
        <AppText>{lifecycle(r).label===r.status?({CANCELLED:'Đã hủy',OVERDUE:'Quá hạn',CLOSED:'Đã đóng',CHECKED_OUT:'Đã trả kho'}[r.status as string]??'Đang cập nhật'):lifecycle(r).label}</AppText>
        <AppText>{dateLabel(r.startDate)} – {dateLabel(r.endDate)}</AppText>
        <AppText>{r.usedCapacityM3==null?'Dung tích đang sử dụng chưa xác minh':`${r.usedCapacityM3} m³ đang sử dụng`} / {r.allocatedCapacity==null?'Dung tích phân bổ chưa xác minh':`${r.allocatedCapacity} m³ được phân bổ`}</AppText>
        <Button label="Xem hàng hóa" variant="quiet" onPress={()=>router.push(managedReservationInventoryTarget(r._id,refId(r.facilityId)) as Href)}/>
        <Button label="Xem đơn kho ký gửi" variant="outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/confirmation',params:{facilityId:refId(r.facilityId),reservationId:r._id}})}/>
      </Card>)}
    </>}
  </LiveScreen>;
}
