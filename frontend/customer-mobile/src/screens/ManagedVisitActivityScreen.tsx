import {useEffect,useSyncExternalStore,useState} from 'react';
import {View} from 'react-native';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {apiIssue} from '../api/client';
import {mobileRepo} from '../api/mobileRepository';
import {managedReservationReads,type ManagedVisit} from '../api/managedReservationReads';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Screen,StateCard} from '../components/ui';
import {ScreenHeading} from '../components/livePresentation';
import {useResource} from '../components/liveUI';
import {colors} from '../theme/tokens';
import {dismissVisitSuccessFeedback,getVisitSuccessFeedback,subscribeVisitSuccessFeedback} from '../state/visitSuccessFeedback';

const vnDateTime=new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
const purposeLabel={INBOUND:'Nhập hàng',OUTBOUND:'Xuất hàng',RELOCATION:'Chuyển vị trí',INSPECTION:'Kiểm tra hàng'} as const;
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
  const rental=useResource(owner+':'+reservationId,signal=>mobileRepo.rental(reservationId,owner,signal));
  const r=rental.data;
  const visits=useResource(r?owner+':activity-visits:'+r._id:'',signal=>r?managedReservationReads.visits(r,owner,signal):Promise.resolve(null));
  const sessions=useResource(r?owner+':activity-sessions:'+r._id:'',signal=>r?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const [busy,setBusy]=useState(false);
  async function cancelVisit(visit:ManagedVisit){
    if(busy||!r)return;setBusy(true);setError('');
    try{await managedReservationReads.cancelVisit(r,owner,visit);setCancelId('');visits.reload();}
    catch(cause){setError(apiIssue(cause));}
    finally{setBusy(false);}
  }
  const visitList=visits.data??[];
  const sessionList=sessions.data??[];
  const confirmedVisitVisible=!!feedback&&visitList.some(visit=>visit._id===feedback.visitId);
  useEffect(()=>{if(r&&feedback?.reservationId===r._id&&confirmedVisitVisible)dismissVisitSuccessFeedback(r._id);},[r,feedback,confirmedVisitVisible]);
  const purposes=(values:ManagedVisit['purpose'][]|string[])=>values.map(value=>purposeLabel[value as keyof typeof purposeLabel]??value).join(' · ');
  const staffName=(visit:ManagedVisit)=>typeof visit.assignedStaffId==='object'&&visit.assignedStaffId&&'displayName' in visit.assignedStaffId?String(visit.assignedStaffId.displayName??'Nhân viên được phân công'):visit.assignedStaffId?'Đã phân công nhân viên':'Chưa phân công nhân viên';
  return <Screen>
    <ScreenHeading title="Lịch và phiên truy cập" eyebrow="KHO KÝ GỬI" subtitle={r?`Mã đơn thuê · ${r.reservationCode}`:'Đang tải đơn thuê'}/>
    <Button label="Quay lại đơn thuê" variant="quiet" onPress={()=>router.back()}/>
    <AccessLoadState loading={rental.loading} error={rental.error} httpStatus={rental.httpStatus} reload={rental.reload} label="Reservation"/>
    {r&&<>
      <Card><Button label="Đặt lịch đến kho" onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId:r._id}})}/></Card>
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
          <AppText>{vnDateTime.format(new Date(visit.startsAt))} – {vnDateTime.format(new Date(visit.endsAt))}</AppText>
          <AppText>{staffName(visit)}</AppText>
          {!!visit.note&&<AppText>{visit.note}</AppText>}
          {visit.scopedReservationIds&&visit.scopedReservationIds.length>1&&<AppText variant="caption" style={{color:colors.muted}}>Phạm vi gồm {visit.scopedReservationIds.length} Reservation (bao gồm đơn chính).</AppText>}
          {visit.status==='SCHEDULED'&&(cancelId===visit._id?<><AppText accessibilityRole="alert">Hủy lịch này?</AppText><Button label="Giữ lịch" variant="quiet" disabled={busy} onPress={()=>setCancelId('')}/><Button label="Xác nhận hủy lịch" variant="danger" loading={busy} onPress={()=>void cancelVisit(visit)}/></>:<View style={{gap:8}}><Button label="Sửa lịch" variant="outline" disabled={busy} onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId:r._id,visitId:visit._id}})}/><Button label="Hủy lịch" variant="quiet" disabled={busy} onPress={()=>setCancelId(visit._id)}/></View>)}
        </Card>)}
      </>:<>
        <AccessLoadState loading={sessions.loading} error={sessions.error} httpStatus={sessions.httpStatus} reload={sessions.reload} label="phiên truy cập"/>
        {!sessions.loading&&!sessions.error&&sessionList.length===0&&<StateCard title="Chưa có phiên truy cập đang hoạt động" description="Phiên truy cập sẽ hiển thị tại đây khi được cấp cho đơn thuê."/>}
        {!sessions.loading&&!sessions.error&&sessionList.map(session=><Card key={session._id}>
          <AppText variant="card">{sessionStatusLabel[session.status]}</AppText>
          <AppText>Bắt đầu · {vnDateTime.format(new Date(session.startedAt))}</AppText><AppText>Hết hạn · {vnDateTime.format(new Date(session.expiresAt))}</AppText>
          <AppText>Mục đích · {purposes(session.allowedPurposes)}</AppText><AppText>Phạm vi ô kho · {session.allowedCellIds.length} ô được phép</AppText>
          {session.scopedReservationIds&&<AppText>Reservation trong phạm vi · {session.scopedReservationIds.length}</AppText>}
        </Card>)}
      </>}
      {!!error&&<AppText accessibilityRole="alert" style={{color:colors.danger}}>{error}</AppText>}
    </>}
  </Screen>;
}
