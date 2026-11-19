import {ManagedReservationOperations} from '../components/ManagedReservationOperations';
import {ManagedPaymentCard} from '../components/ManagedPaymentCard';
import {CardHeading} from '../components/livePresentation';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {StyleSheet,View} from 'react-native';
import {managedInventory} from '../api/managedInventory';
import {mobileRepo} from '../api/mobileRepository';
import {refId} from '../api/contracts/core';
import {lifecycle,type ReservationDto} from '../api/contracts/customer';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Input,StateCard,NavigationRow,ui} from '../components/ui';
import {ManagedFacilityVisual} from '../components/ManagedFacilityVisual';
import {managedHandoverVerified,managedPaperContractNextStep,type ManagedPaymentProgress} from '../domain/managedV3RentalProgress';
import {managedSkuEligible} from '../api/managedSkuV3';
import {ManagedRentalProgress} from '../components/ManagedRentalProgress';
import {claimRequestOnce} from '../domain/requestLifecycle';
import type {ManagedOperationProgress} from '../components/ManagedReservationOperations';
import {colors} from '../theme/tokens';
import {dateLabel,money,LiveScreen,ResourceState,useResource} from '../components/liveUI';
import {managedRentalListTarget,managedReservationInventoryTarget} from '../domain/managedInventoryNavigation';

function rentalStatusLabel(r:ReservationDto){
  const value=lifecycle(r).label;
  if(value!==r.status)return value;
  const labels:Record<string,string>={RESERVED:'Đang chờ xác nhận thanh toán',CONTRACTED:'Đang chuẩn bị hợp đồng',DEPOSIT_PAID:'Đang cập nhật thanh toán',
    CHECKIN_READY:'Đã xác minh hợp đồng · chờ bàn giao',PAID:'Đã thanh toán · chờ hợp đồng giấy',ACTIVE:'Đang thuê ký gửi',
    OVERDUE:'Quá hạn',CHECKED_OUT:'Đã trả kho',CLOSED:'Đã kết thúc',CANCELLED:'Đã hủy'};
  return labels[r.status]??'Đang cập nhật';
}

export function ManagedFacilities(){
  const router=useRouter();
  const [text,setText]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
  const data=useResource(search+':'+page,signal=>managedInventory.facilities(page,search,signal));
  const result=data.data;
  function apply(){setSearch(text.trim());setPage(1);}
  return <LiveScreen title="Tìm kho ký gửi" eyebrow="KHÁM PHÁ CƠ SỞ" subtitle="Tìm theo tên hoặc địa chỉ cơ sở." onRefresh={data.reload} refreshing={data.loading}
    backButton={{onPress:()=>router.replace('/(tabs)/inventory')}}>
    <Card style={facilityListStyles.searchCard}>
      <CardHeading icon="search-outline" title="Tìm cơ sở phù hợp" subtitle="Kết quả lấy trực tiếp từ danh sách cơ sở."/>
      <Input label="Tên cơ sở hoặc khu vực" placeholder="Nhập tên, quận hoặc thành phố" maxLength={100}
        value={text} onChangeText={setText} onSubmitEditing={apply} returnKeyType="search"/>
      <Button label="Tìm kiếm cơ sở" icon="search-outline" onPress={apply}/>
    </Card>
    <ResourceState {...data}/>
    {result&&<View style={facilityListStyles.resultsHeading}>
      <AppText variant="card">Cơ sở kho ký gửi</AppText>
      <AppText variant="caption" style={ui.muted}>{result.pagination.total} kết quả</AppText>
    </View>}
    {result?.items.length===0&&<StateCard title="Chưa tìm thấy cơ sở phù hợp" description="Thử một tên hoặc khu vực khác." onRetry={()=>{setText('');setSearch('');setPage(1);}}/>}
    {result?.items.map(f=><Card key={f._id} style={facilityListStyles.facilityCard}>
      <ManagedFacilityVisual facility={f}/>
      <View style={facilityListStyles.cardFooter}>
        <AppText variant="caption" style={ui.muted}>Khám phá cơ sở và chọn thời hạn thuê phù hợp.</AppText>
        <Button label="Xem chi tiết cơ sở" variant="outline" icon="arrow-forward-outline"
          onPress={()=>router.push({pathname:'/managed/[facilityId]/review',params:{facilityId:f._id}})}/>
      </View>
    </Card>)}
    {result&&result.pagination.totalPages>1&&<View style={ui.between}>
      <Button label="Trang trước" variant="quiet" disabled={page<=1} onPress={()=>setPage(page-1)}/>
      <AppText>{page}/{result.pagination.totalPages}</AppText>
      <Button label="Trang sau" variant="quiet" disabled={page>=result.pagination.totalPages} onPress={()=>setPage(page+1)}/>
    </View>}
  </LiveScreen>;
}

const facilityListStyles=StyleSheet.create({
  searchCard:{backgroundColor:colors.soft,borderColor:colors.line},
  resultsHeading:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between',gap:10,paddingHorizontal:2},
  facilityCard:{padding:12,gap:12},
  cardFooter:{gap:10,paddingHorizontal:2},
});

export function ManagedRentalDetail(){
  const {facilityId,reservationId}=useLocalSearchParams<{facilityId:string;reservationId:string}>();
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();
  const data=useResource(owner+':'+facilityId+':'+reservationId,signal=>managedInventory.rental(reservationId,owner,facilityId,signal));
  const facility=useResource(facilityId,signal=>managedInventory.facility(facilityId,signal));
  const r=data.data;
  const contract=useResource(owner+':contract:'+reservationId+':'+(r?.status??''),signal=>r?.bookingFlowVersion===3
    ?mobileRepo.contract(r,owner,signal):Promise.resolve(null));
  const allocatedCellIds=(r?.allocatedCellIds??[]).map(refId);
  const cells=useResource(owner+':allocated-cells:'+reservationId+':'+allocatedCellIds.join(','),signal=>r
    ?managedInventory.cellLabels(refId(r.facilityId),allocatedCellIds,signal):Promise.resolve({} as Record<string,string>));
  const [paymentProgress,setPaymentProgress]=useState<ManagedPaymentProgress>('NONE');
  const [operationProgress,setOperationProgress]=useState<ManagedOperationProgress>({});
  const refreshedContractState=useRef('');
  const refreshedAppliedPayments=useRef(new Set<string>());
  const receivePaymentProgress=useCallback((value:ManagedPaymentProgress)=>setPaymentProgress(current=>current===value?current:value),[]);
  const refreshAppliedPayment=useCallback((paymentId:string)=>{
    const key=owner+':'+reservationId+':'+paymentId;
    if(!claimRequestOnce(refreshedAppliedPayments.current,key))return;
    data.reload();
  },[owner,reservationId,data.reload]);
  const receiveOperationProgress=useCallback((value:ManagedOperationProgress)=>setOperationProgress(current=>{
    const next={...current,...value};
    return Object.keys(next).every(key=>current[key as keyof ManagedOperationProgress]===next[key as keyof ManagedOperationProgress])?current:next;
  }),[]);
  useEffect(()=>{setPaymentProgress('NONE');setOperationProgress({});},[owner,reservationId]);
  const state=r?rentalStatusLabel(r):undefined;
  const contractRecord=contract.data as (NonNullable<typeof contract.data>&{verifiedAt?:unknown;signedProofPublicId?:unknown})|null|undefined;
  const paperContractVerified=contractRecord?.status==='SIGNED'&&typeof contractRecord.verifiedAt==='string'&&!!contractRecord.signedProofPublicId;
  const handoverComplete=r?managedHandoverVerified(r):false;
  const contractLabel=contract.loading?'Đang tải trạng thái':contract.error?'Chưa xác minh được trạng thái':!contract.data
    ?r?.status==='RESERVED'?'Chưa tạo · chờ thanh toán':'Chưa có hợp đồng'
    :paperContractVerified?'Đã được cơ sở xác minh':contractRecord?.status==='SIGNED'?'Đã ký · chờ cơ sở xác minh':contractRecord?.status==='EXPIRED'?'Đã hết hạn':contractRecord?.status==='TERMINATED'?'Đã kết thúc':'Đang chờ ký';
  useEffect(()=>{
    const key=owner+':'+reservationId;
    if(r?.status==='PAID'&&paperContractVerified&&refreshedContractState.current!==key){refreshedContractState.current=key;data.reload();}
  },[owner,reservationId,r?.status,paperContractVerified,data.reload]);
  return <LiveScreen title="Đơn thuê kho ký gửi" eyebrow="HỒ SƠ THUÊ" onRefresh={()=>{data.reload();facility.reload();contract.reload();}} refreshing={data.loading||data.refreshing||facility.loading||facility.refreshing||contract.loading||contract.refreshing}
    backButton={{onPress:()=>router.replace(managedRentalListTarget())}}>
    <ResourceState {...data}/>
    {r&&<Card>
      <CardHeading icon="key-outline" title={r.reservationCode}/>
      <AppText>{facility.data?.name??'Cơ sở kho ký gửi'}</AppText>
      {!!facility.data?.address&&<AppText>{[facility.data.address.street,facility.data.address.district,facility.data.address.city].filter((value):value is string=>typeof value==='string'&&!!value.trim()).join(', ')}</AppText>}
      <AppText>{state}</AppText>
      <AppText>{dateLabel(r.startDate)} – {dateLabel(r.endDate)}</AppText>
      {r.bookingFlowVersion===3?<AppText>Thanh toán toàn bộ tiền thuê</AppText>:r.bookingFlowVersion!==2?<AppText>Đơn kho ký gửi theo quy trình trước đây.</AppText>:null}
      {r.allocatedCapacity!==undefined&&<AppText>Dung tích được cấp: {r.allocatedCapacity} m³</AppText>}
      {r.usedCapacityM3!==undefined&&<AppText>Dung tích đã dùng: {r.usedCapacityM3} m³</AppText>}
      {r.allocatedCellIds&&<AppText>Số ô được cấp: {r.allocatedCellIds.length}</AppText>}
      {!!allocatedCellIds.length&&<>
        <ResourceState {...cells} resource="thông tin ô thuê"/>
        {allocatedCellIds.map((cellId,index)=><AppText key={cellId}>Ô thuê {index+1}: {cells.data?.[cellId]??(cells.loading?'Đang tải mã ô':'Chưa có thông tin vị trí')}</AppText>)}
      </>}
      {r.bookingFlowVersion===3&&typeof r.estimatedRent==='number'&&Number.isFinite(r.estimatedRent)&&
        <AppText>Tiền thuê dự kiến: {money(r.estimatedRent)}</AppText>}
      {r.bookingFlowVersion!==3&&!!r.signingDeadline&&<AppText>Hạn ký: {dateLabel(r.signingDeadline)}</AppText>}
      <NavigationRow label="Xem sơ đồ kho" icon="map-outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/map',params:{facilityId}})}/>
    </Card>}
    {r?.bookingFlowVersion===3&&<ResourceState {...contract}/>}
    {r?.bookingFlowVersion===3&&r.status==='RESERVED'&&!contract.data&&!contract.error&&<Card>
      <CardHeading icon="document-text-outline" title="Hợp đồng chưa được tạo" tone="amber"/>
      <AppText>Hợp đồng sẽ xuất hiện sau khi khoản thanh toán được xác nhận đầy đủ.</AppText>
    </Card>}
    {r?.bookingFlowVersion===3&&r.rentalPaymentFlow==='FULL_UPFRONT_V1'&&<ManagedPaymentCard key={owner+':'+r._id} r={r} owner={owner} reload={data.reload} refreshAppliedPayment={refreshAppliedPayment} onProgress={receivePaymentProgress}/>}
    {r?.bookingFlowVersion===3&&managedPaperContractNextStep(r.status,paymentProgress)&&<Card>
      <CardHeading icon="document-text-outline" title={paperContractVerified?'Hợp đồng đã được cơ sở xác minh':'Bước tiếp theo: Ký hợp đồng tại cơ sở'} tone="amber"/>
      <AppText>{paperContractVerified?'Đang cập nhật tiến độ đơn thuê đã được cơ sở xác nhận.':'Vui lòng đến cơ sở để hoàn tất ký hợp đồng trước thời hạn quy định.'}</AppText>
      {!!facility.data?.name&&<AppText variant="medium">{facility.data.name}</AppText>}
      {!!facility.data?.address&&<AppText>{[facility.data.address.street,facility.data.address.district,facility.data.address.city].filter(Boolean).join(', ')}</AppText>}
      {!!r.signingDeadline&&<AppText>Hạn ký: {dateLabel(r.signingDeadline)}</AppText>}
      <AppText>Trạng thái hợp đồng: {contractLabel}</AppText>
      {contract.data&&<Button label="Xem hợp đồng" variant="primary" onPress={()=>router.push({pathname:'/rentals/[id]/contract',params:{id:r._id}})}/>}
    </Card>}
    {r?.bookingFlowVersion===3&&<ManagedRentalProgress reservation={r} payment={paymentProgress}
      visitEligible={['CHECKIN_READY','ACTIVE'].includes(r.status)&&Date.parse(r.endDate)>Date.now()} handoverComplete={handoverComplete} {...operationProgress}/>}
    {r?.bookingFlowVersion===3&&<Card>
      <CardHeading icon="cube-outline" title="Bàn giao tại cơ sở" tone={handoverComplete?'green':'amber'}/>
      {handoverComplete?<AppText>Nhân viên đã bàn giao vào {dateLabel((r as ReservationDto&{handoverAt:string}).handoverAt)}. Đơn thuê đang hoạt động.</AppText>:
        r.status==='ACTIVE'?<AppText>Đơn thuê đang hoạt động nhưng thông tin bàn giao chưa được xác minh đầy đủ. Hãy tải lại hoặc liên hệ cơ sở để được hỗ trợ.</AppText>:
        ['PAID','CHECKIN_READY'].includes(r.status)?<AppText>Đang chờ nhân viên cơ sở hoàn tất bàn giao. Khách hàng không xác nhận bàn giao trong ứng dụng.</AppText>:
        <AppText>Trạng thái bàn giao sẽ cập nhật sau khi hoàn tất thanh toán và hợp đồng giấy.</AppText>}
      {r.status==='ACTIVE'&&handoverComplete&&<NavigationRow label="Xem hàng hóa" icon="file-tray-stacked-outline" onPress={()=>router.push(managedReservationInventoryTarget(r._id,facilityId) as unknown as Href)}/>}
    </Card>}
    {r?.bookingFlowVersion===3&&r.status!=='PAID'&&contract.data&&<Card><AppText variant="medium">Hợp đồng</AppText>
      <AppText>{contractLabel}</AppText>
      <Button label="Xem hợp đồng" variant="outline" onPress={()=>router.push({pathname:'/rentals/[id]/contract',params:{id:r._id}})}/>
    </Card>}
    {r?.bookingFlowVersion===3&&<ManagedReservationOperations key={'ops:'+owner+':'+r._id} r={r} owner={owner} onProgress={receiveOperationProgress}/>}
    {r?.bookingFlowVersion===3&&managedSkuEligible(r)&&<Card><Button label="Khai báo SKU" icon="add-circle-outline" onPress={()=>router.push({pathname:'/inventory/register',params:{reservationId:r._id}})}/></Card>}
  </LiveScreen>;
}
