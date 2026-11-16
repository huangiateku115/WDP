import {useRouter} from 'expo-router';
import {MobileInputError} from '../api/client';
import {refId} from '../api/contracts/core';
import {mobileRepo} from '../api/mobileRepository';
import {eligibleInboundCells} from '../api/managedInboundPreview';
import {managedReservationReads} from '../api/managedReservationReads';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';

export function ManagedSessionSkuPicker({reservationId,sessionId}:{reservationId:string;sessionId:string}){
  const owner=useLiveSession(state=>state.user?._id??''),router=useRouter();
  const data=useResource(owner+':'+reservationId+':'+sessionId,async signal=>{
    const reservation=await mobileRepo.rental(reservationId,owner,signal);
    if(reservation.serviceType!=='MANAGED_INVENTORY'||reservation.bookingFlowVersion!==3||reservation.status!=='ACTIVE')
      throw new MobileInputError('Đơn thuê không đủ điều kiện nhập hàng V3.');
    const sessions=await managedReservationReads.sessions(reservation,owner,signal);
    const session=sessions.find(row=>row._id===sessionId);
    if(!session||!session.allowedPurposes.includes('INBOUND')||!eligibleInboundCells(reservation,session).length)
      throw new MobileInputError('Phiên INBOUND không thuộc đơn thuê hoặc đã hết hiệu lực.');
    const first=await mobileRepo.inventory(owner,1,signal);
    if(first.pagination.totalPages>100)throw new MobileInputError('Danh sách hàng hóa quá lớn để xác minh an toàn.');
    const items=[...first.items];
    for(let page=2;page<=first.pagination.totalPages;page++)items.push(...(await mobileRepo.inventory(owner,page,signal)).items);
    const skus=items.filter(item=>item.inventorySchemaVersion===3&&item.status==='REGISTERED'&&item.currentCellId==null&&
      refId(item.managedReservationId)===reservation._id&&refId(item.facilityId)===refId(reservation.facilityId));
    return {reservation,session,skus,cellCount:eligibleInboundCells(reservation,session).length};
  });
  return <LiveScreen title="Chọn hàng hóa nhập kho" eyebrow="PHIÊN ĐẾN KHO" subtitle="Chọn SKU thuộc đúng đơn thuê để tiếp tục kiểm tra nhập hàng."
    onRefresh={data.reload} refreshing={data.loading}>
    <Button label="Quay lại đơn thuê" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...data}/>
    {data.data&&<Card>
      <AppText variant="medium">{data.data.reservation.reservationCode}</AppText>
      <AppText>Phiên INBOUND đang hiệu lực · {data.data.cellCount} ô được phép sử dụng.</AppText>
      <AppText>Phiên sẽ được xác minh lại trước khi xem trước và xác nhận nhập.</AppText>
    </Card>}
    {data.data?.skus.length===0&&<StateCard title="Chưa có SKU đủ điều kiện nhập" description="Chỉ hiển thị hàng đã đăng ký, chưa được đặt vào ô và thuộc đơn thuê này."/>}
    {data.data?.skus.map(item=><Card key={item._id}>
      <AppText variant="card">{item.name}</AppText>
      <AppText>Mã hàng: {item.itemCode}</AppText>
      <AppText>Đăng ký: {item.quantity} {item.quantityUnit}</AppText>
      <Button label="Mở kiểm tra nhập hàng" variant="outline" onPress={()=>router.push({pathname:'/preview/[kind]/[id]',params:{kind:'inventory',id:item._id,accessSessionId:data.data!.session._id}})}/>
    </Card>)}
  </LiveScreen>;
}
