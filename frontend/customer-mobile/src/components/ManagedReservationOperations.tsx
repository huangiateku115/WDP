import {apiIssue} from '../api/client';
import {useLiveSession} from '../state/useLiveSession';
import {useRef,useState} from 'react';
import type {ReservationDto} from '../api/contracts/customer';
import {managedReservationReads} from '../api/managedReservationReads';
import {AppText,Button,Card} from './ui';
import {ResourceState,useResource} from './liveUI';

const time=new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
const purpose={INBOUND:'Nhập hàng',OUTBOUND:'Xuất hàng',RELOCATION:'Chuyển vị trí',INSPECTION:'Kiểm tra hàng'};
const visitState={SCHEDULED:'Đã lên lịch',CHECKED_IN:'Đã đến kho',COMPLETED:'Hoàn tất',CANCELLED:'Đã hủy'};
const sessionState={ACTIVE:'Đang hoạt động',CHECKED_OUT:'Đã kết thúc',REVOKED:'Đã thu hồi',EXPIRED:'Đã hết hạn'};
const readinessState={UNKNOWN:'Chưa đủ dữ liệu',READY:'Sẵn sàng theo đánh giá',BLOCKED:'Còn điều kiện chưa hoàn tất'};

export function ManagedReservationOperations({r,owner}:{r:ReservationDto;owner:string}){
  const [open,setOpen]=useState(false),[showReadiness,setShowReadiness]=useState(false);
  const [cancel,setCancel]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const busy=useRef(false);
  const scope=owner+':'+r._id;
  const visits=useResource(open?scope:'',signal=>open?managedReservationReads.visits(r,owner,signal):Promise.resolve(null));
  const sessions=useResource(open?scope:'',signal=>open?managedReservationReads.sessions(r,owner,signal):Promise.resolve(null));
  const readiness=useResource(showReadiness?scope:'',signal=>showReadiness?managedReservationReads.readiness(r,owner,signal):Promise.resolve(null));
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
        <ResourceState {...visits}/>
        {visits.data?.length===0&&<AppText>Chưa có lịch cho đơn thuê.</AppText>}
        {visits.data?.map(visit=><Card key={'visit:'+visit._id}>
          <AppText>{purpose[visit.purpose]} · {visitState[visit.status]}</AppText>
          <AppText>{time.format(new Date(visit.startsAt))} – {time.format(new Date(visit.endsAt))}</AppText>
          <AppText>{visit.assignedStaffId?'Đã phân công nhân viên':'Chưa phân công nhân viên'}</AppText>
          {!!visit.note&&<AppText>{visit.note}</AppText>}
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
          <AppText>{sessionState[session.status==='ACTIVE'&&Date.parse(session.expiresAt)<=Date.now()?'EXPIRED':session.status]}</AppText>
          <AppText>{session.allowedPurposes.map(value=>purpose[value]).join(', ')}</AppText>
          <AppText>Hết hạn: {time.format(new Date(session.expiresAt))}</AppText>
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
