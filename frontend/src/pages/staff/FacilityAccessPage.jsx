import {useCallback,useRef,useState} from 'react';
import client from '@/api/axiosClient';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {facilityAccessState,validFacilityPin} from '@/lib/facilityAccess';
import {facilityLabel} from '@/lib/facilityLabels';
import useFacilityResource from '@/lib/useFacilityResource';
import {apiRows,apiRecord,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {Screen,Panel,Select,Field,Input,Details,Status,Button,Message,Dialog} from '@/components/manager/ManagerUI';

export default function FacilityAccessPage({manager=false}) {
  const {user,accessToken}=useAuthSession(),[selected,setSelected]=useState(''),[search,setSearch]=useState('');
  const permitted=user?.role===(manager?'FACILITY_MANAGER':'FACILITY_STAFF')&&objectId(user?.assignedFacilityId);
  const load=useCallback(async signal=>apiRows(await facilityReservationApi.list(user.assignedFacilityId,{signal})).filter(r=>recordId(r.facilityId)===user.assignedFacilityId&&r.serviceType==='SELF_STORAGE'),[user?.assignedFacilityId,accessToken]);
  const resource=useFacilityResource(load,permitted);
  const rows=(resource.data||[]).filter(r=>`${r.reservationCode} ${r.customerId?.email||''}`.toLowerCase().includes(search.toLowerCase()));
  return <Screen title="Mô phỏng mở cửa" notice="Kiểm tra PIN mô phỏng đã được backend cấp. Đã bàn giao không đồng nghĩa đã có PIN. Trang này không điều khiển khóa cửa thật." action={<Button variant="outline" onClick={resource.reload}>Tải lại danh sách</Button>}>
    {!permitted?<Panel title="Cần tài khoản có quyền và được phân công cơ sở"/>:<>
    <Message error={/timeout/i.test(resource.error)?"Backend phản hồi quá chậm. Bấm Tải lại danh sách để thử lại.":resource.error}/>{resource.loading?<p role="status">Đang tải đơn thuê…</p>:!resource.error&&<Panel title="Chọn đơn thuê trong cơ sở"><Field label="Tìm mã đơn hoặc email"><Input value={search} onChange={e=>setSearch(e.target.value)}/></Field><Select label="Đơn thuê cần truy cập" value={rows.some(r=>recordId(r)===selected)?selected:''} onChange={setSelected} options={[['',"Chọn một đơn thuê"],...rows.map(r=>[recordId(r),`${r.reservationCode} · ${facilityLabel(r.status)}`])]}/>{!rows.length&&<p>Không có đơn thuê phù hợp trong dữ liệu đã tải.</p>}</Panel>}
    {!resource.loading&&!resource.error&&resource.data?.some(r=>recordId(r)===selected)&&<AccessRecord key={`${user.id}:${user.assignedFacilityId}:${accessToken}:${selected}`} id={selected} user={user}/>}
    <Panel title="Chức năng hiện có"><p>Trang chỉ gửi yêu cầu kiểm tra PIN và nhận kết quả từ backend. Cấp, cấp lại, thu hồi PIN và lịch sử truy cập toàn cơ sở chưa có API riêng. Không lưu PIN nhập thử vào bộ nhớ trình duyệt.</p></Panel>
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
  const resource=useFacilityResource(load,true),row=resource.data,access=facilityAccessState(row);
  async function unlock(e) {
    e.preventDefault();if(busy.current)return;busy.current=true;setSaving(true);setFeedback({});const token=getAccessToken();
    try {
      const fresh=await load();
      if(!token||token!==getAccessToken())throw Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại.');
      const latestAccess=facilityAccessState(fresh);if(!latestAccess.allowed)throw Error(latestAccess.label);
      if(!validFacilityPin(fresh,pin))throw Error(fresh.rentalPaymentFlow==='FULL_UPFRONT_V1'?'Nhập PIN mô phỏng gồm đúng 6 chữ số.':'Nhập PIN mô phỏng gồm 4 hoặc 6 chữ số.');
      let response;
      try{response=await client.post('/access/simulate-unlock',{reservationCode:fresh.reservationCode,pinCode:pin});}
      catch(error){const log=error?.response?.data?.data;if(error?.response?.status===401&&log?.action==='UNLOCK_FAILED'&&recordId(log.reservationId)===id)throw Error("Sai mã PIN. Không cho phép mở khóa. Phiên đăng nhập vẫn hoạt động.");throw error;}
      if(token!==getAccessToken())return;
      const log=apiRecord(response);
      if(log.action!=='UNLOCK_SUCCESS'||recordId(log.reservationId)!==id||recordId(log.storageUnitId)!==recordId(fresh.storageUnitId)||recordId(log.customerId)!==recordId(fresh.customerId))throw Error("Chưa xác nhận mở khóa cho đơn và kho đã chọn.");
      setFeedback({success:'Backend xác nhận mở khóa mô phỏng thành công cho đơn '+fresh.reservationCode+'. Không có khóa cửa thật được điều khiển.'});setConfirmation(false);
    }catch(error){if(token===getAccessToken())setFeedback({error:error?.response?.data?.code==='ACCESS_PROVISIONING_UNAVAILABLE'?'Backend chưa cấp PIN cho đơn này. Không thể mở khóa mô phỏng; không cần thanh toán lại.':reviewError(error)});}finally{setPin('');resource.reload();busy.current=false;setSaving(false);}
  }
  return <Panel title="Trạng thái truy cập"><Message error={resource.error}/><Message {...feedback}/>{resource.loading&&<p role="status">Đang kiểm tra trạng thái…</p>}{row&&<><Details values={[["Đơn thuê",row.reservationCode],["Trạng thái",<Status value={row.status}/>],["Kho",row.storageUnitId?.unitCode||recordId(row.storageUnitId)],["Điều kiện truy cập",access.label]]}/>{!access.allowed&&row.status==='ACTIVE'&&<p role="status" className="mt-4">{access.label}. Tải lại trạng thái sau khi backend xử lý; không tự nhập mã mặc định để thay thế.</p>}<Button variant="outline" disabled={saving} onClick={()=>{setPin('');setFeedback({});resource.reload();}}>Tải lại trạng thái truy cập</Button>{access.allowed&&<div className="mt-4 space-y-4"><Field label="Mã PIN mô phỏng"><Input type="password" inputMode="numeric" autoComplete="off" aria-label="Mã PIN mô phỏng" maxLength={6} value={pin} disabled={saving} onChange={e=>{setPin(e.target.value);setFeedback({});}}/></Field><Button disabled={saving||!validFacilityPin(row,pin)} onClick={()=>setConfirmation(true)}>Mô phỏng mở khóa</Button></div>}</>}
    {confirmation&&<Dialog title="Xác nhận mô phỏng" onClose={()=>{if(!busy.current){setConfirmation(false);setPin('');}}}><form onSubmit={unlock}><p className="mb-4">Mô phỏng mở khóa cho đơn đã chọn. Máy chủ sẽ lưu kết quả.</p><Message {...feedback}/><Button disabled={saving||!pin}>{saving?"Đang kiểm tra…":"Xác nhận mở khóa"}</Button></form></Dialog>}
  </Panel>;
}
