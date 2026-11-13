import {apiIssue} from '../api/client';
import {useLiveSession} from '../state/useLiveSession';
import {useEffect,useRef,useState} from 'react';
import type {ReservationDto} from '../api/contracts/customer';
import {managedReservationReads} from '../api/managedReservationReads';
import type {ManagedVisit} from '../api/managedReservationReads';
import {eligibleInboundCells} from '../api/managedInboundPreview';
import {journal,newAttempt} from '../state/attemptJournal';
import axios from 'axios';
import {useRouter} from 'expo-router';
import {AppText,Button,Card,Input} from './ui';
import {ResourceState,useResource} from './liveUI';

const time=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
const purpose={INBOUND:'Nhập hàng',OUTBOUND:'Xuất hàng',RELOCATION:'Chuyển vị trí',INSPECTION:'Kiểm tra hàng'};
const visitState={SCHEDULED:'Đã lên lịch',CHECKED_IN:'Đã đến kho',COMPLETED:'Hoàn tất',CANCELLED:'Đã hủy'};
const sessionState={ACTIVE:'Đang hoạt động',CHECKED_OUT:'Đã kết thúc',REVOKED:'Đã thu hồi',EXPIRED:'Đã hết hạn'};
const readinessState={UNKNOWN:'Chưa đủ dữ liệu',READY:'Sẵn sàng theo đánh giá',BLOCKED:'Còn điều kiện chưa hoàn tất'};
const visitPurposes=['INBOUND','OUTBOUND','RELOCATION','INSPECTION'] as const;
const dateInVietnam=(value:string)=>{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(row=>row.type===type)?.value??'';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const todayInVietnam=()=>dateInVietnam(new Date().toISOString());
const timeOnly=new Intl.DateTimeFormat('vi-VN',{timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});

export function ManagedReservationOperations({r,owner}:{r:ReservationDto;owner:string}){
  const router=useRouter();
  const [open,setOpen]=useState(false),[showReadiness,setShowReadiness]=useState(false),[scheduleOpen,setScheduleOpen]=useState(false);
  const [cancel,setCancel]=useState(''),[editing,setEditing]=useState(''),[detail,setDetail]=useState<ManagedVisit>(),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [purposeValue,setPurposeValue]=useState<(typeof visitPurposes)[number]>('INBOUND'),[date,setDate]=useState(todayInVietnam),[note,setNote]=useState(''),[selectedSlot,setSelectedSlot]=useState('');
  const busy=useRef(false);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!open)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[open]);
  const scope=owner+':'+r._id;
  const visits=useResource(open?scope:'',signal=>open?managedReservationReads.visits(r,owner,signal):Promise.resolve(null));
  const sessions=useResource(open?scope:'',signal=>open?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const readiness=useResource(showReadiness?scope:'',signal=>showReadiness?managedReservationReads.readiness(r,owner,signal):Promise.resolve(null));
  const createAttempt=useResource(scope,()=>journal('managed-v3-visit-create',owner,r._id).then(store=>store.read()));
  const amendAttempt=useResource(editing?scope+':'+editing:'',()=>editing?journal('managed-v3-visit-amend',owner,editing).then(store=>store.read()):Promise.resolve(null));
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00+07:00'));
  const availability=useResource(scheduleOpen&&validDate?scope+':availability:'+date:'',signal=>scheduleOpen&&validDate
    ?managedReservationReads.visitAvailability(r,owner,date,signal):Promise.resolve(null));
  const slots=availability.data?.slots??[];
  const createEligible=['CHECKIN_READY','ACTIVE'].includes(r.status)&&Date.parse(r.endDate)>Date.now();
  async function createVisit(recover:boolean){
    if(busy.current||useLiveSession.getState().user?._id!==owner)return;
    busy.current=true;setPending(true);setError('');
    try{
      const store=await journal('managed-v3-visit-create',owner,r._id);
      let saved=await store.read();
      if(!recover){
        if(saved)throw new Error('Đang có yêu cầu đặt lịch chưa rõ kết quả. Hãy khôi phục đúng yêu cầu đã lưu.');
        const slot=slots.find(row=>row.startsAt===selectedSlot);
        if(!createEligible||!slot||Date.parse(slot.startsAt)<=Date.now())throw new Error('Chọn một khung giờ còn hiệu lực do cơ sở cung cấp.');
        const visitBody={reservationId:r._id,purpose:purposeValue,startsAt:slot.startsAt,endsAt:slot.endsAt,...(note.trim()?{note:note.trim()}:{})};
        saved={...newAttempt(),visitBody};
        if(!await store.claim(saved))throw new Error('Yêu cầu đặt lịch đang được xử lý.');
      }
      if(!saved?.visitBody||useLiveSession.getState().user?._id!==owner)throw new Error('Không có yêu cầu đặt lịch để khôi phục.');
      const created=await managedReservationReads.createVisit(r,owner,saved.visitBody,saved.key);
      if(useLiveSession.getState().user?._id!==owner)return;
      await store.clear();setScheduleOpen(false);setSelectedSlot('');visits.reload();createAttempt.reload();
      setDetail(created);
    }catch(cause){
      if(useLiveSession.getState().user?._id===owner){
        if(axios.isAxiosError(cause)&&[400,403,404,409,422].includes(cause.response?.status??0)){
          await journal('managed-v3-visit-create',owner,r._id).then(store=>store.clear());createAttempt.reload();availability.reload();
        }
        setError(apiIssue(cause));
      }
    }finally{busy.current=false;if(useLiveSession.getState().user?._id===owner){setPending(false);visits.reload();createAttempt.reload();}}
  }
  function beginAmend(visit:ManagedVisit){
    setEditing(visit._id);setPurposeValue(visit.purpose);setDate(dateInVietnam(visit.startsAt));setSelectedSlot(visit.startsAt);setNote(visit.note??'');setScheduleOpen(true);setError('');
  }
  async function amendVisit(visit:ManagedVisit,recover:boolean){
    if(busy.current||useLiveSession.getState().user?._id!==owner)return;
    busy.current=true;setPending(true);setError('');
    try{
      const store=await journal('managed-v3-visit-amend',owner,visit._id);
      let saved=await store.read();
      if(!recover){
        if(saved)throw new Error('Đang có yêu cầu sửa lịch chưa rõ kết quả. Hãy khôi phục đúng yêu cầu đã lưu.');
        const slot=slots.find(row=>row.startsAt===selectedSlot);
        if(!slot||Date.parse(slot.startsAt)<=Date.now())throw new Error('Chọn khung giờ còn hiệu lực do cơ sở cung cấp.');
        const visitBody={reservationId:r._id,purpose:purposeValue,startsAt:slot.startsAt,endsAt:slot.endsAt,...(note.trim()?{note:note.trim()}:{})};
        saved={...newAttempt(),resourceId:visit._id,visitRevision:visit.revision,visitBody};
        if(!await store.claim(saved))throw new Error('Yêu cầu sửa lịch đang được xử lý.');
      }
      if(!saved?.visitBody||saved.resourceId!==visit._id||saved.visitRevision===undefined||useLiveSession.getState().user?._id!==owner)
        throw new Error('Không thể xác minh yêu cầu sửa lịch đã lưu.');
      const {reservationId:_,...body}=saved.visitBody;
      const updated=await managedReservationReads.amendVisit(r,owner,{...visit,revision:saved.visitRevision},body,saved.key);
      if(useLiveSession.getState().user?._id!==owner)return;
      await store.clear();setEditing('');setScheduleOpen(false);setDetail(updated);amendAttempt.reload();visits.reload();
    }catch(cause){
      if(useLiveSession.getState().user?._id===owner){
        if(axios.isAxiosError(cause)&&[400,403,404,409,412,422].includes(cause.response?.status??0)){
          await journal('managed-v3-visit-amend',owner,visit._id).then(store=>store.clear());amendAttempt.reload();visits.reload();availability.reload();
        }
        setError(apiIssue(cause));
      }
    }finally{busy.current=false;if(useLiveSession.getState().user?._id===owner){setPending(false);amendAttempt.reload();}}
  }
  async function loadVisit(visit:ManagedVisit){
    try{const row=await managedReservationReads.visit(r,owner,visit._id);if(useLiveSession.getState().user?._id===owner)setDetail(row);}
    catch(cause){if(useLiveSession.getState().user?._id===owner)setError(apiIssue(cause));}
  }
  async function cancelVisit(visit:NonNullable<typeof visits.data>[number]){
    if(busy.current||useLiveSession.getState().user?._id!==owner)return;
    busy.current=true;setPending(true);setError('');
    try{await managedReservationReads.cancelVisit(r,owner,visit);}
    catch(cause){if(useLiveSession.getState().user?._id===owner)setError(apiIssue(cause));}
    finally{
      busy.current=false;
      if(useLiveSession.getState().user?._id===owner){setPending(false);setCancel('');visits.reload();}
    }
  }
  return <>
    <Card>
      <Button label={open?'Ẩn lịch và phiên truy cập':'Xem lịch và phiên truy cập'} variant="outline" onPress={()=>setOpen(!open)}/>
      {open&&<>
        <AppText variant="medium">Lịch đến kho</AppText>
        {createEligible&&<Button label={scheduleOpen?'Đóng đặt lịch':'Đặt lịch đến kho'} variant="outline" disabled={pending||createAttempt.loading||!!createAttempt.error||!!createAttempt.data} onPress={()=>{setEditing('');setScheduleOpen(!scheduleOpen);setError('');}}/>}
        {createAttempt.data&&<Card><AppText>Yêu cầu đặt lịch trước chưa rõ kết quả. Hệ thống sẽ gửi lại đúng nội dung với cùng mã idempotency.</AppText>
          <Button label="Khôi phục yêu cầu đặt lịch" loading={pending} onPress={()=>void createVisit(true)}/></Card>}
        {createAttempt.error&&<ResourceState {...createAttempt}/>}
        {scheduleOpen&&<Card>
          <AppText variant="medium">{editing?'Sửa lịch đến kho':'Chọn lịch đến kho'}</AppText>
          <Input label="Ngày đến kho (YYYY-MM-DD)" value={date} onChangeText={value=>{setDate(value);setSelectedSlot('');}} editable={!pending} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD"/>
          <AppText>Giờ hiển thị theo múi giờ Việt Nam (Asia/Ho_Chi_Minh).</AppText>
          {visitPurposes.map(value=><Button key={value} label={purpose[value]} variant={purposeValue===value?'primary':'outline'} disabled={pending} onPress={()=>setPurposeValue(value)}/>)}
          {validDate&&<ResourceState {...availability}/>}
          {availability.data&&slots.length===0&&<AppText>Ngày này chưa có khung giờ do cơ sở cung cấp.</AppText>}
          {slots.map(slot=><Button key={slot.startsAt} label={timeOnly.format(new Date(slot.startsAt))+' – '+timeOnly.format(new Date(slot.endsAt))}
            variant={selectedSlot===slot.startsAt?'primary':'outline'} disabled={pending||Date.parse(slot.startsAt)<=Date.now()} onPress={()=>setSelectedSlot(slot.startsAt)}/>)}
          <Input label="Ghi chú (không bắt buộc)" value={note} onChangeText={setNote} maxLength={500} editable={!pending}/>
          {editing?(()=>{const target=visits.data?.find(row=>row._id===editing);return target?<>
            <ResourceState {...amendAttempt}/>
            {amendAttempt.data?<Button label="Khôi phục sửa lịch đã lưu" loading={pending} onPress={()=>void amendVisit(target,true)}/>
              :<Button label="Lưu thay đổi lịch" loading={pending} disabled={amendAttempt.loading||!!amendAttempt.error||!availability.data||!selectedSlot} onPress={()=>void amendVisit(target,false)}/>}
          </>:null})():<Button label="Tạo lịch đến kho" loading={pending} disabled={!createEligible||createAttempt.loading||!!createAttempt.error||!availability.data||!selectedSlot||!!createAttempt.data}
            onPress={()=>void createVisit(false)}/>}
        </Card>}
        <ResourceState {...visits}/>
        {visits.data?.length===0&&<AppText>Chưa có lịch cho đơn thuê.</AppText>}
        {visits.data?.map(visit=><Card key={'visit:'+visit._id}>
          <AppText>{purpose[visit.purpose]} · {visitState[visit.status]}</AppText>
          <AppText>{time.format(new Date(visit.startsAt))} – {time.format(new Date(visit.endsAt))}</AppText>
          <AppText>{visit.assignedStaffId?'Đã phân công nhân viên':'Chưa phân công nhân viên'}</AppText>
          {!!visit.note&&<AppText>{visit.note}</AppText>}
          {detail?._id===visit._id&&<AppText accessibilityRole="summary">Chi tiết lịch đã được tải lại: {purpose[detail.purpose]} · {time.format(new Date(detail.startsAt))} – {time.format(new Date(detail.endsAt))} · phiên bản {detail.revision}</AppText>}
          <Button label="Tải chi tiết lịch" variant="quiet" disabled={pending} onPress={()=>void loadVisit(visit)}/>
          {visit.status==='SCHEDULED'&&<Button label="Sửa lịch" variant="outline" disabled={pending||!!amendAttempt.data} onPress={()=>beginAmend(visit)}/>}
          {visit.status==='SCHEDULED'&&(cancel===visit._id
            ? <><AppText>Xác nhận hủy lịch đến kho này?</AppText>
                <Button label="Giữ lịch" variant="quiet" disabled={pending} onPress={()=>setCancel('')}/>
                <Button label="Xác nhận hủy lịch" variant="danger" loading={pending} onPress={()=>void cancelVisit(visit)}/></>
            : <Button label="Hủy lịch" variant="outline" disabled={pending} onPress={()=>setCancel(visit._id)}/>)}
        </Card>)}
        {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}<AppText variant="medium">Phiên truy cập</AppText>
        <ResourceState {...sessions}/>
        {sessions.data?.length===0&&<AppText>Chưa có phiên truy cập cho đơn thuê.</AppText>}
        {sessions.data?.map(session=><Card key={'session:'+session._id}>
          <AppText>{sessionState[session.status==='ACTIVE'&&Date.parse(session.expiresAt)<=now?'EXPIRED':session.status]}</AppText>
          <AppText>{session.allowedPurposes.map(value=>purpose[value]).join(', ')}</AppText>
          <AppText>Đơn {r.reservationCode} · Lịch {typeof session.visitId==='string'?session.visitId:session.visitId._id}</AppText>
          <AppText>Phiên {session._id} · Nhân viên {typeof session.assignedStaffId==='string'?session.assignedStaffId:session.assignedStaffId._id}</AppText>
          <AppText>Bắt đầu: {time.format(new Date(session.startedAt))}</AppText>
          {session.status==='ACTIVE'&&Date.parse(session.expiresAt)>now&&<AppText>Còn {Math.ceil((Date.parse(session.expiresAt)-now)/1000)} giây</AppText>}
          <AppText>Hết hạn: {time.format(new Date(session.expiresAt))}</AppText>
          {eligibleInboundCells(r,session,now).length>0&&<Button label="Chọn hàng hóa để nhập" variant="outline" onPress={()=>router.push({pathname:'/managed/inbound/[reservationId]',params:{reservationId:r._id,sessionId:session._id}})}/>}
        </Card>)}
      </>}
    </Card>
    <Card>
      <Button label={showReadiness?'Ẩn đánh giá kết thúc thuê':'Xem đánh giá kết thúc thuê'} variant="outline"
        onPress={()=>setShowReadiness(!showReadiness)}/>
      {showReadiness&&<>
        <ResourceState {...readiness}/>
        {readiness.data&&<>
          <AppText>{readinessState[readiness.data.overallReadiness]}</AppText>
          <AppText>Số lượng còn lưu: {readiness.data.stockSummary?.currentQuantity??'Chưa xác minh'}</AppText>
          <AppText>Số lượng đang giữ: {readiness.data.stockSummary?.heldQuantity??'Chưa xác minh'}</AppText>
          <AppText>Yêu cầu nhập còn mở: {readiness.data.outstandingRequestSummary?.inbound.unresolvedCount??'Chưa xác minh'}</AppText>
          <AppText>Yêu cầu xuất còn mở: {readiness.data.outstandingRequestSummary?.outbound.unresolvedCount??'Chưa xác minh'}</AppText>
          {readiness.data.blockers.map((row,index)=><AppText key={row.code+':'+row.scope+':'+index}>{row.message}</AppText>)}
          <AppText>Đánh giá chỉ để tham khảo. Liên hệ cơ sở để xử lý các điều kiện còn thiếu.</AppText>
        </>}
      </>}
    </Card>
  </>;
}
