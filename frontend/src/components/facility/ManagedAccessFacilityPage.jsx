import {useCallback, useEffect, useRef, useState} from 'react';
import {managedAccessApi as api} from '@/api/managedAccessApi';
import {useAuthSession, getAccessToken} from '@/lib/authSession';
import useFacilityResource, {announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord, apiRows, recordId, objectId, reviewError} from '@/lib/facilityReview';
import {accessRows, scopedAccess, sessionStatus, visitInWindow, currentRevision, attestation, accessLabel} from '@/lib/managedAccessFacility';
import {Screen, Panel, Button, Field, Input, Select, Textarea, Message, Details, Table, Dialog, OpenLink} from '@/components/manager/ManagerUI';

const time = value => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
const person = value => value?.displayName || value?.email || recordId(value) || 'Chưa phân công';
export default function ManagedAccessFacilityPage({role}) {
  const auth = useAuthSession();
  return <AccessContent key={`${role}:${auth.user?.id}:${auth.user?.assignedFacilityId}:${auth.accessToken}`} role={role} />;
}
function AccessContent({role}) {
  const {user,accessToken}=useAuthSession(), manager=role==='manager';
  const permitted=!!accessToken && user?.role===(manager?'FACILITY_MANAGER':'FACILITY_STAFF') && objectId(user.assignedFacilityId) && objectId(recordId(user));
  const [action,setAction]=useState(null),[staffId,setStaffId]=useState(''),[reason,setReason]=useState('');
  const [checks,setChecks]=useState({identityVerified:false,customerPresent:false,safetyReviewed:false}),[notes,setNotes]=useState('');
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState({}),[filter,setFilter]=useState(''),[search,setSearch]=useState(''),[now,setNow]=useState(Date.now());
  const lock=useRef(false);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const load=useCallback(async()=>{
    const [v,s,t]=await Promise.all([api.facilityVisits(),api.facilitySessions(),manager?api.staff():Promise.resolve(null)]);
    const visits=accessRows(v,'visit',user),sessions=accessRows(s,'session',user),staff=t?apiRows(t):[];
    if(staff.some(row=>!objectId(recordId(row)))||new Set(staff.map(recordId)).size!==staff.length)throw Error('Danh sách nhân viên không hợp lệ.');
    return {visits,sessions,staff};
  },[manager,user?.id,user?.assignedFacilityId,accessToken]);
  const resource=useFacilityResource(load,permitted,{refreshOnFocus:!action&&!busy});
  const data=resource.data;
  function open(kind,row){
    if(lock.current)return;setFeedback({});setReason('');setStaffId(recordId(row.assignedStaffId)||'');
    const pending=kind==='checkIn'?api.pendingCheckIn(recordId(row),recordId(user)):null;
    setChecks(pending?.payload?{identityVerified:pending.payload.identityVerified===true,customerPresent:pending.payload.customerPresent===true,safetyReviewed:pending.payload.safetyReviewed===true}:{identityVerified:false,customerPresent:false,safetyReviewed:false});
    setNotes(pending?.payload?.safetyNotes||'');setAction({kind,row});
  }
  async function run(event){
    event.preventDefault();if(lock.current||!action||!permitted)return;
    lock.current=true;setBusy(true);setFeedback({});let sent=false;
    const token=getAccessToken(),checkAuth=()=>{if(!token||token!==getAccessToken())throw Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại.');};
    try{
      checkAuth();const {kind,row}=action,id=recordId(row);
      if(kind==='assign'){
        if(!manager||!data?.staff.some(staff=>recordId(staff)===staffId)||reason.trim().length<3||reason.length>500)throw Error('Chọn nhân viên trong cơ sở và nhập lý do từ 3 đến 500 ký tự.');
        const fresh=scopedAccess(apiRecord(await api.visit(id)),'visit',user);checkAuth();currentRevision(row,fresh);
        if(fresh.status!=='SCHEDULED'||Date.parse(fresh.endsAt)<=Date.now())throw Error('Lịch đã hết hạn hoặc không còn chờ phân công.');
        sent=true;const result=scopedAccess(apiRecord(await api.assign(id,staffId,reason.trim(),fresh.revision)),'visit',user);
        const verified=scopedAccess(apiRecord(await api.visit(id)),'visit',user);checkAuth();
        if(recordId(result)!==id||recordId(verified.assignedStaffId)!==staffId||verified.revision<=fresh.revision)throw Error('Chưa xác minh được nhân viên được phân công.');
        setFeedback({success:'Đã phân công nhân viên hộ tống và đọc lại lịch từ hệ thống.'});
      }else if(kind==='checkIn'){
        if(manager)throw Error('Chỉ nhân viên được phân công được xác nhận khách đến.');
        const sessions=accessRows(await api.facilitySessions(),'session',user);checkAuth();
        const previous=sessions.find(session=>recordId(session.visitId)===id);
        if(previous){
          if(sessionStatus(previous)!=='ACTIVE')throw Error('Yêu cầu trước đã kết thúc hoặc bị thu hồi; không thể báo check-in thành công.');
          const confirmed=scopedAccess(apiRecord(await api.session(recordId(previous))),'session',user);
          const visit=scopedAccess(apiRecord(await api.visit(id)),'visit',user);checkAuth();
          if(sessionStatus(confirmed)!=='ACTIVE'||visit.status!=='CHECKED_IN'||recordId(confirmed.reservationId)!==recordId(visit.reservationId))throw Error('Phiên không còn hoạt động hoặc chưa khớp lịch đến kho.');
          api.clearPendingCheckInKey(id,recordId(user));setFeedback({success:'Đã đối chiếu phiên truy cập đang hoạt động; không tạo phiên mới.'});
        }else{
          const fresh=scopedAccess(apiRecord(await api.visit(id)),'visit',user);checkAuth();currentRevision(row,fresh);
          if(!visitInWindow(fresh))throw Error('Chưa đến giờ hoặc đã quá khung giờ khách đến kho.');
          const pending=api.pendingCheckIn(id,recordId(user)),payload=pending?.payload||attestation({...checks,safetyNotes:notes});
          attestation(payload);sent=true;
          const result=apiRecord(await api.checkIn(id,payload,recordId(user)));
          const created=scopedAccess(result.session,'session',user);
          if(recordId(created.visitId)!==id||recordId(created.reservationId)!==recordId(fresh.reservationId)||sessionStatus(created)!=='ACTIVE')throw Error('Hệ thống chưa xác nhận phiên đang hoạt động cho đúng lịch.');
          const verified=scopedAccess(apiRecord(await api.session(recordId(created))),'session',user);
          const visit=scopedAccess(apiRecord(await api.visit(id)),'visit',user);checkAuth();
          if(sessionStatus(verified)!=='ACTIVE'||visit.status!=='CHECKED_IN')throw Error('Phiên và lịch đến kho chưa khớp trạng thái.');
          api.clearPendingCheckInKey(id,recordId(user));setFeedback({success:'Đã xác minh khách đến và bắt đầu phiên truy cập. Thời hạn thực tế lấy từ hệ thống, tối đa 60 phút.'});
        }
      }else{
        if(kind!=='revoke'&&kind!=='checkOut')throw Error('Thao tác không hợp lệ.');
        if(kind==='checkOut'&&manager)throw Error('Chỉ nhân viên hộ tống xác nhận khách rời kho.');
        if(kind==='revoke'&&(reason.trim().length<3||reason.length>500))throw Error('Nhập lý do thu hồi từ 3 đến 500 ký tự.');
        const fresh=scopedAccess(apiRecord(await api.session(id)),'session',user);checkAuth();currentRevision(row,fresh);
        if(sessionStatus(fresh)!=='ACTIVE')throw Error('Phiên đã hết hạn, kết thúc hoặc bị thu hồi.');
        sent=true;
        const result=scopedAccess(apiRecord(await(kind==='revoke'?api.revoke(id,fresh.revision,reason.trim()):api.checkOut(id,fresh.revision))),'session',user);
        const verified=scopedAccess(apiRecord(await api.session(id)),'session',user);
        const visit=scopedAccess(apiRecord(await api.visit(recordId(fresh.visitId))),'visit',user);checkAuth();
        const target=kind==='revoke'?'REVOKED':'CHECKED_OUT';
        if(recordId(result)!==id||![target,...(kind==='checkOut'?['EXPIRED']:[])].includes(verified.status)||visit.status!=='COMPLETED')throw Error('Chưa xác minh được phiên đã kết thúc và lịch đã hoàn tất.');
        setFeedback({success:verified.status==='EXPIRED'?'Phiên đã hết hạn; hệ thống đã ghi nhận khách rời kho.':kind==='revoke'?'Đã thu hồi phiên vì lý do an toàn.':'Đã xác nhận khách rời kho và kết thúc phiên. Hợp đồng thuê vẫn tiếp tục.'});
      }
      checkAuth();setAction(null);resource.reload();announceReviewChange();
    }catch(error){
      if(token===getAccessToken())setFeedback({error:reviewError(error)+(sent?' Kết quả có thể đã được ghi nhận. Tải lại và đối chiếu trước khi gửi tiếp.':'')});
      if(sent||[409,412].includes(error.response?.status))resource.reload();
    }finally{lock.current=false;setBusy(false);}
  }
  const pending=action?.kind==='checkIn'?api.pendingCheckIn(recordId(action.row),recordId(user)):null;
  const visits=(data?.visits||[]).filter(row=>(!filter||row.status===filter)&&`${person(row.customerId)} ${recordId(row.reservationId)} ${recordId(row)}`.toLowerCase().includes(search.toLowerCase()));
  const sessions=data?.sessions||[];
  return <Screen title={manager?'Điều phối lịch đến kho':'Tiếp nhận khách lưu trữ hàng hóa'} notice="Lượt đến kho và phiên truy cập dành cho Managed Inventory. Kết thúc phiên là khách rời kho sau một lượt đến, không phải trả kho hay kết thúc hợp đồng." action={<Button variant="outline" disabled={busy} onClick={()=>{if(!busy){setAction(null);setFeedback({});resource.reload();}}}>Tải lại</Button>}>
    {!permitted?<Panel title="Chưa có quyền truy cập"><p>Cần đúng vai trò và cơ sở được phân công.</p></Panel>:<>
      <Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Đang tải lịch và phiên truy cập…</p>}
      <Panel title="Các bước thực hiện"><p>{manager?'Khách đặt lịch → quản lý phân công nhân viên cùng cơ sở → nhân viên xác minh khách đến → theo dõi phiên và thu hồi khi cần.':'Xem lịch được giao → xác minh trực tiếp khách, danh tính và an toàn → bắt đầu phiên → hỗ trợ giám sát → xác nhận khách rời kho.'}</p><div className="mt-3 flex flex-wrap gap-4"><OpenLink to={`/${role}/managed-inventory-v3`}>Giám sát nhập hàng V3</OpenLink><OpenLink to={`/${role}/managed`}>Hồ sơ hàng hóa</OpenLink></div></Panel>
      {data&&!resource.error&&<><Panel title={manager?'Lịch khách đến cơ sở':'Lịch được phân công'}><div className="mb-4 grid items-end gap-3 sm:grid-cols-2"><Field label="Tìm khách hoặc mã định danh"><Input value={search} onChange={event=>setSearch(event.target.value)}/></Field><Field label="Trạng thái lượt đến"><Select label="Lọc trạng thái lượt đến" value={filter} onChange={setFilter} options={[["",'Tất cả'],...['SCHEDULED','CHECKED_IN','COMPLETED','CANCELLED'].map(value=>[value,accessLabel(value)])]}/></Field></div>
        {manager&&!data.staff.length&&<p className="mb-3">Chưa có nhân viên hoạt động tại cơ sở để phân công.</p>}
        {visits.length===0?<p>Không có lịch phù hợp.</p>:<div className="space-y-4">{visits.map(visit=><article key={recordId(visit)} className="rounded-xl border p-4"><h3 className="font-bold">{person(visit.customerId)} · {accessLabel(visit.purpose)}</h3><Details values={[["Trạng thái",accessLabel(visit.status)],["Thời gian",`${time(visit.startsAt)} – ${time(visit.endsAt)}`],["Nhân viên hộ tống",person(visit.assignedStaffId)],["Đơn thuê",recordId(visit.reservationId)],["Ghi chú khách",visit.note||'Không có']]} />
          <div className="mt-3 flex flex-wrap gap-3">{manager&&visit.status==='SCHEDULED'&&Date.parse(visit.endsAt)>now&&<Button disabled={busy||!data.staff.length} onClick={()=>open('assign',visit)}>Phân công hộ tống</Button>}{!manager&&visit.status==='SCHEDULED'&&<Button disabled={busy||(!visitInWindow(visit,now)&&!api.pendingCheckIn(recordId(visit),recordId(user)))} onClick={()=>open('checkIn',visit)}>Xác minh khách đến</Button>}</div>
          {!manager&&visit.status==='SCHEDULED'&&!visitInWindow(visit,now)&&<p className="mt-2 text-sm">Chỉ xác nhận trong khung giờ đã đặt.</p>}
          <AccessHistory entries={visit.assignmentHistory} assignment/><AccessHistory entries={visit.audit}/>
        </article>)}</div>}
      </Panel><Panel title="Phiên truy cập và lịch sử"><p className="mb-3">Đang hoạt động: {sessions.filter(session=>sessionStatus(session,now)==='ACTIVE').length}. Thời hạn tối đa 60 phút, giới hạn thêm theo lịch đến và hợp đồng.</p>
        {!sessions.length?<p>Chưa có phiên truy cập trong phạm vi được phép.</p>:<div className="space-y-4">{sessions.map(session=>{const status=sessionStatus(session,now);return <article key={recordId(session)} className="rounded-xl border p-4"><Details values={[["Khách",person(session.customerId)],["Trạng thái",accessLabel(status)],["Bắt đầu",time(session.startedAt)],["Hết hạn",time(session.expiresAt)],["Đã kết thúc",time(session.endedAt)],["Các ô được phép",session.allowedCellIds.map(recordId).join(', ')],["Lý do thu hồi",session.revokeReason||'Không có']]} /><div className="mt-3 flex flex-wrap gap-3">{status==='ACTIVE'&&<>{!manager&&<Button disabled={busy} onClick={()=>open('checkOut',session)}>Xác nhận khách rời kho</Button>}<Button variant="outline" disabled={busy} onClick={()=>open('revoke',session)}>Thu hồi vì an toàn</Button></>}</div><AccessHistory entries={session.audit}/></article>;})}</div>}
      </Panel></>}
    </>}
    {action&&<Dialog title={{assign:'Xác nhận phân công hộ tống',checkIn:'Xác minh khách đến kho',checkOut:'Kết thúc lượt truy cập',revoke:'Thu hồi phiên truy cập'}[action.kind]} onClose={()=>{if(!lock.current)setAction(null);}}><form onSubmit={run} className="space-y-4">
      {action.kind==='assign'&&<><Select label="Chọn nhân viên hộ tống" value={staffId} onChange={setStaffId} disabled={busy} options={[["",'Chọn nhân viên'],...(data?.staff||[]).map(row=>[recordId(row),`${person(row)} · ${row.email||''}`])]}/><Field label="Lý do phân công"><Textarea aria-label="Lý do phân công" required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></Field></>}
      {action.kind==='checkIn'&&<fieldset disabled={busy||!!pending} className="space-y-3"><p>Nhân viên xác nhận trực tiếp tại cơ sở. Đây là ghi nhận thủ công có người và thời gian, không phải bằng chứng sinh trắc học hay thiết bị.</p>{[['identityVerified','Đã xác minh danh tính'],['customerPresent','Khách có mặt trực tiếp'],['safetyReviewed','Đã hướng dẫn và rà soát an toàn']].map(([key,label])=><label key={key} className="flex gap-2"><input type="checkbox" checked={checks[key]} onChange={event=>setChecks(previous=>({...previous,[key]:event.target.checked}))}/>{label}</label>)}<Field label="Ghi chú xác minh an toàn"><Textarea aria-label="Ghi chú xác minh an toàn" required minLength={3} maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)}/></Field></fieldset>}
      {pending&&<p role="status">Đang có yêu cầu chưa đối chiếu. Giữ nguyên nội dung và dùng cùng yêu cầu để kiểm tra kết quả trước khi thử lại.</p>}
      {action.kind==='revoke'&&<Field label="Lý do thu hồi"><Textarea aria-label="Lý do thu hồi" required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></Field>}
      {action.kind==='checkOut'&&<p>Xác nhận khách đã rời kho. Chỉ kết thúc phiên truy cập này; không trả ô, xóa hàng hoặc chấm dứt hợp đồng.</p>}
      <Message {...feedback}/><Button type="submit" disabled={busy||(action.kind==='assign'&&(!staffId||reason.trim().length<3))||(action.kind==='revoke'&&reason.trim().length<3)||(action.kind==='checkIn'&&(!Object.values(checks).every(Boolean)||notes.trim().length<3))}>{busy?'Đang xác minh…':pending?'Kiểm tra kết quả / thử lại cùng yêu cầu':'Xác nhận'}</Button>
    </form></Dialog>}
  </Screen>;
}
function AccessHistory({entries=[],assignment=false}) {
  if(!entries.length)return null;
  return <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">{assignment?'Lịch sử phân công':'Lịch sử xử lý'}</summary><Table label="Lịch sử truy cập" rows={entries.map((entry,index)=>({...entry,id:String(index)}))} columns={[{key:'at',label:'Thời điểm',render:entry=>time(entry.at)},{key:'action',label:assignment?'Nhân viên':'Thao tác',render:entry=>assignment?person(entry.staffId):accessLabel(entry.action)},{key:'reason',label:'Lý do',render:entry=>entry.reason||entry.details?.reason||'—'}]}/></details>;
}
