import {ManagedSkuEditor} from '../components/ManagedSkuEditor';
import {ManagedReservationOperations} from '../components/ManagedReservationOperations';
import {ManagedPaymentCard} from '../components/ManagedPaymentCard';
import {CardHeading} from '../components/livePresentation';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {StyleSheet,View} from 'react-native';
import {managedInventory} from '../api/managedInventory';
import {mobileRepo} from '../api/mobileRepository';
import {lifecycle,type ReservationDto} from '../api/contracts/customer';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Input,StateCard,ui} from '../components/ui';
import {ManagedFacilityVisual} from '../components/ManagedFacilityVisual';
import {managedPaperContractNextStep,type ManagedPaymentProgress} from '../domain/managedV3RentalProgress';
import {ManagedRentalProgress} from '../components/ManagedRentalProgress';
import type {ManagedOperationProgress} from '../components/ManagedReservationOperations';
import {colors} from '../theme/tokens';
import {dateLabel,money,LiveScreen,ResourceState,useResource} from '../components/liveUI';

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
  return <LiveScreen title="Tìm kho ký gửi" eyebrow="KHÁM PHÁ CƠ SỞ" subtitle="Tìm theo tên hoặc địa chỉ cơ sở." onRefresh={data.reload} refreshing={data.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
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
  const [paymentProgress,setPaymentProgress]=useState<ManagedPaymentProgress>('NONE');
  const [operationProgress,setOperationProgress]=useState<ManagedOperationProgress>({});
  const refreshedContractState=useRef('');
  const receivePaymentProgress=useCallback((value:ManagedPaymentProgress)=>setPaymentProgress(current=>current===value?current:value),[]);
  const receiveOperationProgress=useCallback((value:ManagedOperationProgress)=>setOperationProgress(current=>{
    const next={...current,...value};
    return Object.keys(next).every(key=>current[key as keyof ManagedOperationProgress]===next[key as keyof ManagedOperationProgress])?current:next;
  }),[]);
  useEffect(()=>{setPaymentProgress('NONE');setOperationProgress({});},[owner,reservationId]);
  const state=r?rentalStatusLabel(r):undefined;
  const contractRecord=contract.data as (NonNullable<typeof contract.data>&{verifiedAt?:unknown;signedProofPublicId?:unknown})|null|undefined;
  const paperContractVerified=contractRecord?.status==='SIGNED'&&typeof contractRecord.verifiedAt==='string'&&!!contractRecord.signedProofPublicId;
  const contractLabel=paperContractVerified?'Đã được cơ sở xác minh':contractRecord?.status==='SIGNED'?'Đã ký · chờ cơ sở xác minh':contractRecord?.status==='EXPIRED'?'Đã hết hạn':contractRecord?.status==='TERMINATED'?'Đã kết thúc':'Đang chờ ký';
  useEffect(()=>{
    const key=owner+':'+reservationId;
    if(r?.status==='PAID'&&paperContractVerified&&refreshedContractState.current!==key){refreshedContractState.current=key;data.reload();}
  },[owner,reservationId,r?.status,paperContractVerified,data.reload]);
  return <LiveScreen title="Đơn thuê kho ký gửi" eyebrow="HỒ SƠ THUÊ" onRefresh={()=>{data.reload();facility.reload();contract.reload();}} refreshing={data.loading||facility.loading||contract.loading}>
    <Button label="Quay lại" variant="quiet" onPress={()=>router.back()}/>
    <ResourceState {...data}/>
    {r&&<Card>
      <CardHeading icon="key-outline" title={r.reservationCode}/>
      <AppText>{facility.data?.name??'Cơ sở kho ký gửi'}</AppText>
      <AppText>{state}</AppText>
      <AppText>{dateLabel(r.startDate)} – {dateLabel(r.endDate)}</AppText>
      {r.bookingFlowVersion===3?<AppText>Thanh toán toàn bộ tiền thuê</AppText>:r.bookingFlowVersion!==2?<AppText>Đơn kho ký gửi theo quy trình trước đây.</AppText>:null}
      {r.allocatedCapacity!==undefined&&<AppText>Dung tích được cấp: {r.allocatedCapacity} m³</AppText>}
      {r.usedCapacityM3!==undefined&&<AppText>Dung tích đã dùng: {r.usedCapacityM3} m³</AppText>}
      {r.allocatedCellIds&&<AppText>Số ô được cấp: {r.allocatedCellIds.length}</AppText>}
      {r.bookingFlowVersion===3&&typeof r.estimatedRent==='number'&&Number.isFinite(r.estimatedRent)&&
        <AppText>Tiền thuê dự kiến: {money(r.estimatedRent)}</AppText>}
      {r.bookingFlowVersion!==3&&!!r.signingDeadline&&<AppText>Hạn ký: {dateLabel(r.signingDeadline)}</AppText>}
      <Button label="Xem sơ đồ kho" variant="outline" onPress={()=>router.push({pathname:'/managed/[facilityId]/map',params:{facilityId}})}/>
    </Card>}
    {r?.bookingFlowVersion===3&&<ResourceState {...contract}/>}
    {r?.bookingFlowVersion===3&&r.rentalPaymentFlow==='FULL_UPFRONT_V1'&&<ManagedPaymentCard key={owner+':'+r._id} r={r} owner={owner} reload={data.reload} onProgress={receivePaymentProgress}/>}
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
      visitEligible={['CHECKIN_READY','ACTIVE'].includes(r.status)&&Date.parse(r.endDate)>Date.now()} {...operationProgress}/>}
    {r?.bookingFlowVersion===3&&r.status!=='PAID'&&contract.data&&<Card><AppText variant="medium">Hợp đồng</AppText>
      <AppText>{contractLabel}</AppText>
      <Button label="Xem hợp đồng" variant="outline" onPress={()=>router.push({pathname:'/rentals/[id]/contract',params:{id:r._id}})}/>
    </Card>}
    {r?.bookingFlowVersion===3&&<ManagedReservationOperations key={'ops:'+owner+':'+r._id} r={r} owner={owner} onProgress={receiveOperationProgress}/>}
    {r?.bookingFlowVersion===3&&<ManagedSkuEditor key={'sku:'+owner+':'+r._id} r={r} owner={owner} onSaved={item=>router.push({pathname:'/preview/[kind]/[id]',params:{kind:'inventory',id:item._id}})}/>}
  </LiveScreen>;
}
