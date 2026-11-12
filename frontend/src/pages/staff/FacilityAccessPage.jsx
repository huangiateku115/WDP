import {useCallback,useRef,useState} from 'react';
import client from '@/api/axiosClient';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource from '@/lib/useFacilityResource';
import {apiRows,apiRecord,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {Screen,Panel,Select,Field,Input,Details,Status,Button,Message,Dialog} from '@/components/manager/ManagerUI';

export default function FacilityAccessPage({manager=false}) {
  const {user}=useAuthSession(),[selected,setSelected]=useState(''),[search,setSearch]=useState('');
  const permitted=user?.role===(manager?'FACILITY_MANAGER':'FACILITY_STAFF')&&objectId(user?.assignedFacilityId);
  const load=useCallback(async signal=>apiRows(await facilityReservationApi.list(user.assignedFacilityId,{signal})).filter(r=>recordId(r.facilityId)===user.assignedFacilityId&&r.serviceType==='SELF_STORAGE'),[user?.assignedFacilityId]);
  const resource=useFacilityResource(load,permitted);
  const rows=(resource.data||[]).filter(r=>`${r.reservationCode} ${r.customerId?.email||''}`.toLowerCase().includes(search.toLowerCase()));
  return <Screen title="Mô phỏng mở cửa" notice="Mô phỏng bằng phần mềm. Nhập mã PIN 6 chữ số cấp cho đơn thuê." action={<Button variant="outline" onClick={resource.reload}>Tải lại danh sách</Button>}>
    {!permitted?<Panel title="Cần tài khoản có quyền và được phân công cơ sở"/>:<>
    <Message error={resource.error}/>{resource.loading?<p role="status">Đang tải đơn thuê…</p>:<Panel title="Chọn đơn thuê trong cơ sở"><Field label="Tìm mã đơn hoặc email"><Input value={search} onChange={e=>setSearch(e.target.value)}/></Field><Select label="Đơn thuê cần truy cập" value={rows.some(r=>recordId(r)===selected)?selected:''} onChange={setSelected} options={[['',"Chọn một đơn thuê"],...rows.map(r=>[recordId(r),`${r.reservationCode} · ${r.status}`])]}/>{!rows.length&&<p>Không có đơn thuê phù hợp trong dữ liệu đã tải.</p>}</Panel>}
    {!resource.loading&&!resource.error&&resource.data?.some(r=>recordId(r)===selected)&&<AccessRecord key={`${user.id}:${user.assignedFacilityId}:${selected}`} id={selected} user={user}/>}
    <Panel title="Chức năng hiện có"><p>Chưa có chức năng cấp, đổi, thu hồi PIN và nhật ký truy cập cơ sở. Trang này kiểm tra trạng thái đơn và mô phỏng mở khóa. PIN không được lưu trên trình duyệt.</p></Panel>
    </>}
  </Screen>;
}
function AccessRecord({id,user}) {
  const [pin,setPin]=useState(''),[confirmation,setConfirmation]=useState(false),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState({}),busy=useRef(false);
  const load=useCallback(async signal=>{
    const row=apiRecord(await facilityReservationApi.detail(id,false,{signal}));
    if(recordId(row)!==id||recordId(row.facilityId)!==user.assignedFacilityId||row.serviceType!=='SELF_STORAGE'||!objectId(recordId(row.storageUnitId))||!row.reservationCode)throw Error("Đơn ngoài cơ sở của bạn hoặc thiếu thông tin kho.");
    return row;
  },[id,user.assignedFacilityId]);
  const resource=useFacilityResource(load,true),row=resource.data;
  async function unlock(e) {
    e.preventDefault();if(busy.current)return;busy.current=true;setSaving(true);setFeedback({});
    try {
      const fresh=await load();
      if(fresh.status!=='ACTIVE')throw Error("Đơn không còn ở trạng thái đang sử dụng. Tải lại trước khi tiếp tục.");
      if(!/^\d{4,6}$/.test(pin))throw Error("Nhập mã PIN mô phỏng gồm 4-6 chữ số.");
      let response;
      try{response=await client.post('/access/simulate-unlock',{reservationCode:fresh.reservationCode,pinCode:pin});}
      catch(error){const log=error?.response?.data?.data;if(error?.response?.status===401&&log?.action==='UNLOCK_FAILED'&&recordId(log.reservationId)===id)throw Error("Sai mã PIN. Không cho phép mở khóa. Phiên đăng nhập vẫn hoạt động.");throw error;}
      const log=apiRecord(response);
      if(log.action!=='UNLOCK_SUCCESS'||recordId(log.reservationId)!==id||recordId(log.storageUnitId)!==recordId(fresh.storageUnitId)||recordId(log.customerId)!==recordId(fresh.customerId))throw Error("Chưa xác nhận mở khóa cho đơn và kho đã chọn.");
      setFeedback({success:'The server recorded UNLOCK_SUCCESS for reservation '+fresh.reservationCode+'. This is a simulation result.'});setConfirmation(false);
    }catch(error){setFeedback({error:reviewError(error)});}finally{setPin('');resource.reload();busy.current=false;setSaving(false);}
  }
  return <Panel title="Trạng thái truy cập"><Message error={resource.error}/><Message {...feedback}/>{resource.loading&&<p role="status">Đang kiểm tra trạng thái…</p>}{row&&<><Details values={[["Đơn thuê",row.reservationCode],["Trạng thái",<Status value={row.status}/>],['Unit',row.storageUnitId?.unitCode||recordId(row.storageUnitId)],["Điều kiện truy cập",row.status==='ACTIVE'?"Đủ điều kiện kiểm tra PIN":row.status==='OVERDUE'?"Bị chặn do thanh toán quá hạn":"Chưa kích hoạt hoặc đã kết thúc"]]}/>{row.status==='ACTIVE'&&<div className="mt-4 space-y-4"><Field label="Mã PIN mô phỏng"><Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} disabled={saving} onChange={e=>{setPin(e.target.value);setFeedback({});}}/></Field><Button disabled={saving||!/^\d{4,6}$/.test(pin)} onClick={()=>setConfirmation(true)}>Mô phỏng mở khóa</Button></div>}</>}
    {confirmation&&<Dialog title="Xác nhận mô phỏng" onClose={()=>{if(!busy.current){setConfirmation(false);setPin('');}}}><form onSubmit={unlock}><p className="mb-4">Mô phỏng mở khóa cho đơn đã chọn. Máy chủ sẽ lưu kết quả.</p><Message {...feedback}/><Button disabled={saving||!pin}>{saving?"Đang kiểm tra…":"Xác nhận mở khóa"}</Button></form></Dialog>}
  </Panel>;
}
