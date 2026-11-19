import {useEffect,useSyncExternalStore,useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {apiIssue} from '../api/client';
import {mobileRepo} from '../api/mobileRepository';
import {managedReservationReads,type ManagedVisit} from '../api/managedReservationReads';
import {managedInventory} from '../api/managedInventory';
import {refId} from '../api/contracts/core';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Screen,StateCard} from '../components/ui';
import {ScreenHeading} from '../components/livePresentation';
import {CustomerBackButton} from '../components/CustomerBackButton';
import {useResource,useScreenActive} from '../components/liveUI';
import {colors} from '../theme/tokens';
import {dismissVisitSuccessFeedback,getVisitSuccessFeedback,subscribeVisitSuccessFeedback} from '../state/visitSuccessFeedback';
import {readManagedAccessSession,rememberManagedAccessSession} from '../state/managedAccessSessionMemory';
import {managedReservationDetailTarget,managedReservationInventoryTarget} from '../domain/managedInventoryNavigation';
import {ManagedCellLocationCard} from '../components/ManagedCellLocationCard';

const vnDateTime=new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
const purposeLabel={INBOUND:'Nhập hàng',OUTBOUND:'Xuất hàng',RELOCATION:'Chuyển vị trí',INSPECTION:'Kiểm tra hàng',WAREHOUSE_VISIT:'Lượt đến kho'} as const;
const visitStatusLabel={SCHEDULED:'Đã lên lịch',CHECKED_IN:'Đã đến kho',COMPLETED:'Hoàn tất',CANCELLED:'Đã hủy',MISSED:'Đã lỡ lịch'} as const;
const sessionStatusLabel={ACTIVE:'Đang hoạt động',CHECKED_OUT:'Đã kết thúc',REVOKED:'Đã thu hồi',EXPIRED:'Đã hết hạn'} as const;
function AccessLoadState({loading,error,httpStatus,reload,label}:{loading:boolean;error?:string;httpStatus?:number;reload:()=>void;label:string}){
  if(loading)return <StateCard kind="loading" title={`Đang tải ${label}`}/>;
  if(!error)return null;
  const denied=httpStatus===403,expired=httpStatus===401;
  return <Card><StateCard kind="error" title={denied?'Không có quyền truy cập':expired?'Phiên đăng nhập đã hết hạn':`Không tải được ${label}`} description={error}/>
    <Button label="Tải lại" variant="outline" onPress={reload}/></Card>;
}

export function ManagedVisitActivityScreen(){
  const {reservationId}=useLocalSearchParams<{reservationId:string}>();
  const owner=useLiveSession(state=>state.user?._id??''),router=useRouter();
  const feedback=useSyncExternalStore(subscribeVisitSuccessFeedback,getVisitSuccessFeedback,getVisitSuccessFeedback);
  const [tab,setTab]=useState<'VISITS'|'SESSIONS'>('VISITS'),[cancelId,setCancelId]=useState(''),[error,setError]=useState('');
  const screenActive=useScreenActive();
  const rental=useResource(owner+':'+reservationId,signal=>mobileRepo.rental(reservationId,owner,signal));
  const r=rental.data;
  const facility=useResource(r?owner+':access-facility:'+r._id:'',signal=>r?managedInventory.facility(refId(r.facilityId),signal):Promise.resolve(null));
  const reservations=useResource(owner+':access-reservations',signal=>mobileRepo.rentals(owner,signal));
  const visits=useResource(r?owner+':activity-visits:'+r._id:'',signal=>r?managedReservationReads.visits(r,owner,signal):Promise.resolve(null));
  const sessions=useResource(r?owner+':activity-sessions:'+r._id:'',async signal=>{
    if(!r)return null;
    const rows=await managedReservationReads.sessions(r,owner,signal);
    const active=rows.find(session=>session.status==='ACTIVE'&&Date.parse(session.startedAt)<=Date.now()&&Date.parse(session.expiresAt)>Date.now());
    if(active){await rememberManagedAccessSession(owner,r._id,active._id).catch(()=>undefined);return rows;}
    const lastId=await readManagedAccessSession(owner,r._id).catch(()=>null);
    if(!lastId)return rows;
    const detail=await managedReservationReads.session(r,owner,lastId,signal);
    return detail?[detail,...rows.filter(session=>session._id!==detail._id)]:rows;
  });
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  async function cancelVisit(visit:ManagedVisit){
    if(busy||!r)return;setBusy(true);setError('');
    try{await managedReservationReads.cancelVisit(r,owner,visit);setCancelId('');visits.reload();}
    catch(cause){setError(apiIssue(cause));}
    finally{setBusy(false);}
  }
  const visitList=visits.data??[];
  const sessionList=sessions.data??[];
  const needsSessionClock=sessionList.some(session=>session.status==='ACTIVE');
  useEffect(()=>{
    if(!screenActive||!needsSessionClock)return;
    const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);
  },[screenActive,needsSessionClock]);
  useEffect(()=>{
    if(!screenActive)return;
    const needsRefresh=tab==='VISITS'?visitList.some(visit=>visit.status==='SCHEDULED'):r?.status==='ACTIVE';
    if(!needsRefresh)return;
    const timer=setInterval(()=>{if(tab==='VISITS')visits.reload();else sessions.reload();},60000);
    return()=>clearInterval(timer);
  },[screenActive,tab,visitList,r?.status,visits.reload,sessions.reload]);
  const scopedCellIds=[...new Set(sessionList.flatMap(session=>session.allowedCellIds.map(refId)))];
  const cellLabels=useResource(r&&scopedCellIds.length?owner+':access-cells:'+scopedCellIds.join(','):'',signal=>r&&scopedCellIds.length
    ?managedInventory.cellLocations(refId(r.facilityId),scopedCellIds,signal):Promise.resolve({} as Awaited<ReturnType<typeof managedInventory.cellLocations>>));
  const confirmedVisitVisible=!!feedback&&visitList.some(visit=>visit._id===feedback.visitId);
  useEffect(()=>{if(r&&feedback?.reservationId===r._id&&confirmedVisitVisible)dismissVisitSuccessFeedback(r._id);},[r,feedback,confirmedVisitVisible]);
  const purposes=(values:ManagedVisit['purpose'][]|string[])=>values.map(value=>purposeLabel[value as keyof typeof purposeLabel]??value).join(' · ');
  const staffName=(visit:ManagedVisit)=>typeof visit.assignedStaffId==='object'&&visit.assignedStaffId&&'displayName' in visit.assignedStaffId?String(visit.assignedStaffId.displayName??'Nhân viên được phân công'):visit.assignedStaffId?'Đã phân công nhân viên':'Chưa phân công nhân viên';
  const checkInStaff=(visit:ManagedVisit)=>typeof visit.checkedInByStaffId==='object'&&visit.checkedInByStaffId&&'displayName' in visit.checkedInByStaffId?String(visit.checkedInByStaffId.displayName??'Nhân viên kho'):visit.checkedInByStaffId?'Nhân viên kho đã xác nhận':'Chưa check-in';
  const sessionStaff=(session:NonNullable<typeof sessions.data>[number])=>typeof session.assignedStaffId==='object'&&session.assignedStaffId&&'displayName' in session.assignedStaffId?String(session.assignedStaffId.displayName??'Nhân viên kho'):'Nhân viên kho đã xác nhận';
  const refreshAll=()=>{rental.reload();facility.reload();reservations.reload();visits.reload();sessions.reload();cellLabels.reload();};
  return <Screen>
    <ScreenHeading title="Lịch và phiên truy cập" eyebrow="KHO KÝ GỬI" subtitle={r?`Mã đơn thuê · ${r.reservationCode}`:'Đang tải đơn thuê'}
      leading={<CustomerBackButton disabled={!r} onPress={()=>r&&router.replace(managedReservationDetailTarget(r._id,refId(r.facilityId)))}/>}/>
    <Button label="Tải lại lịch và phiên" variant="outline" onPress={refreshAll}/>
    <AccessLoadState loading={rental.loading} error={rental.error} httpStatus={rental.httpStatus} reload={rental.reload} label="đơn thuê"/>
    {r&&<>
      <Card><Button label="Đặt lịch đến kho" onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId:r._id}})}/></Card>
      {!!facility.data&&<AppText>Cơ sở · {facility.data.name}</AppText>}
      {feedback?.reservationId===r._id&&tab==='VISITS'&&!visits.loading&&!visits.error&&!confirmedVisitVisible&&<Card testID="visit-list-refresh-status" style={{borderColor:colors.orange,backgroundColor:colors.orangeTint}}>
        <AppText>Danh sách chưa hiển thị lịch vừa đặt. Bạn có thể tải lại để kiểm tra.</AppText><Button label="Tải lại danh sách" variant="outline" onPress={visits.reload}/>
      </Card>}
      <Card><View style={{flexDirection:'row',gap:8}}>
        <Button label="Lịch đến kho" variant={tab==='VISITS'?'primary':'outline'} onPress={()=>setTab('VISITS')}/>
        <Button label="Phiên truy cập" variant={tab==='SESSIONS'?'primary':'outline'} onPress={()=>setTab('SESSIONS')}/>
      </View></Card>
      {tab==='VISITS'?<>
        <AccessLoadState loading={visits.loading} error={visits.error} httpStatus={visits.httpStatus} reload={visits.reload} label="lịch đến kho"/>
        {!visits.loading&&!visits.error&&visitList.length===0&&feedback?.reservationId!==r._id&&<StateCard title="Chưa có lịch đến kho" description="Các lịch đã đặt sẽ hiển thị tại đây."/>}
        {!visits.loading&&!visits.error&&visitList.map(visit=><Card key={visit._id}>
          <AppText variant="card">{purposeLabel[visit.purpose]} · {visitStatusLabel[visit.status]}</AppText>
          <AppText>Cơ sở · {facility.data?.name??'Đang tải cơ sở'}</AppText>
          <AppText>Đơn thuê · {reservations.data?.find(row=>row._id===refId(visit.reservationId))?.reservationCode??(refId(visit.reservationId)===r._id?r.reservationCode:'Đơn thuê liên quan')}</AppText>
          <AppText>{vnDateTime.format(new Date(visit.startsAt))} – {vnDateTime.format(new Date(visit.endsAt))}</AppText>
          <AppText>{staffName(visit)}</AppText>
          {visit.checkedInAt&&<><AppText>Nhân viên check-in · {checkInStaff(visit)}</AppText><AppText>Thời điểm check-in · {vnDateTime.format(new Date(visit.checkedInAt))}</AppText></>}
          {!!visit.note&&<AppText>{visit.note}</AppText>}
          {visit.scopedReservationIds&&visit.scopedReservationIds.length>1&&<AppText variant="caption" style={{color:colors.muted}}>Lịch này áp dụng cho {visit.scopedReservationIds.length} đơn thuê.</AppText>}
          {visit.status==='SCHEDULED'&&(cancelId===visit._id?<><AppText accessibilityRole="alert">Hủy lịch này?</AppText><Button label="Giữ lịch" variant="quiet" disabled={busy} onPress={()=>setCancelId('')}/><Button label="Xác nhận hủy lịch" variant="danger" loading={busy} onPress={()=>void cancelVisit(visit)}/></>:<View style={{gap:8}}><Button label="Sửa lịch" variant="outline" disabled={busy} onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId:r._id,visitId:visit._id}})}/><Button label="Hủy lịch" variant="quiet" disabled={busy} onPress={()=>setCancelId(visit._id)}/></View>)}
        </Card>)}
      </>:<>
        <AccessLoadState loading={sessions.loading} error={sessions.error} httpStatus={sessions.httpStatus} reload={sessions.reload} label="phiên truy cập"/>
        {!sessions.loading&&!sessions.error&&sessionList.length===0&&<StateCard title="Chưa có phiên truy cập đang hoạt động" description="Phiên truy cập sẽ hiển thị tại đây khi được cấp cho đơn thuê."/>}
        {!sessions.loading&&!sessions.error&&sessionList.map(session=><Card key={session._id}>
          <AppText variant="card">{session.status==='ACTIVE'?(Date.parse(session.startedAt)>now?'Chưa bắt đầu':Date.parse(session.expiresAt)<=now?'Đã hết hạn':'Phiên vào kho đang hoạt động'):sessionStatusLabel[session.status]}</AppText>
          <AppText>Nhân viên xác nhận · {sessionStaff(session)}</AppText>
          <AppText>Bắt đầu · {vnDateTime.format(new Date(session.startedAt))}</AppText><AppText>Hết hạn · {vnDateTime.format(new Date(session.expiresAt))}</AppText>
          <AppText>Cơ sở · {facility.data?.name??'Đang tải cơ sở'}</AppText>
          <AppText>Mục đích · {purposes(session.allowedPurposes)}</AppText><AppText variant="label">Vị trí được phép</AppText>
          {session.allowedCellIds.map(cell=><ManagedCellLocationCard key={refId(cell)} cellId={refId(cell)} location={cellLabels.data?.[refId(cell)]}/>)}
          {session.scopedReservationIds&&<AppText>Đơn thuê áp dụng · {session.scopedReservationIds.length}</AppText>}
          {session.status==='ACTIVE'&&session.allowedPurposes.filter(purpose=>purpose!=='INSPECTION').map(purpose=><Button key={purpose} label={purpose==='INBOUND'?'Chọn hàng hóa nhập kho':purpose==='OUTBOUND'?'Chọn hàng hóa xuất kho':'Chọn hàng hóa chuyển vị trí'} variant="outline"
            disabled={Date.parse(session.startedAt)>now||Date.parse(session.expiresAt)<=now||(purpose==='INBOUND'&&refId(session.reservationId)!==r._id)}
            onPress={()=>purpose==='INBOUND'?router.push({pathname:'/managed/inbound/[reservationId]',params:{reservationId:r._id,sessionId:session._id}}):router.push(managedReservationInventoryTarget(r._id,refId(r.facilityId),{sessionId:session._id,operation:purpose}))}/>) }
          {session.allowedPurposes.includes('INBOUND')&&refId(session.reservationId)!==r._id&&<AppText variant="caption" style={{color:colors.muted}}>Backend hiện chỉ hỗ trợ Inbound trên Reservation chính của phiên. Outbound và Relocation tiếp tục được kiểm tra theo Reservation và Cell scope.</AppText>}
        </Card>)}
      </>}
      {!!error&&<AppText accessibilityRole="alert" style={{color:colors.danger}}>{error}</AppText>}
    </>}
  </Screen>;
}
