import {useCallback,useRef,useState} from 'react';
import {useParams} from 'react-router-dom';
import {customerReviewApi,facilityReservationApi} from '@/api/facilityReviewApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,apiRows,customerRecord,reservationRecord,objectId,reviewError} from '@/lib/facilityReview';
import {Screen,Panel,Table,OpenLink,Input,Field,Details,Status,Select,Textarea,Message,Button,Timeline} from '@/components/manager/ManagerUI';

export default function CustomerApiView({workspace='manager'}){
 const {id}=useParams(),{user,accessToken}=useAuthSession(),base='/'+workspace;
 const [search,setSearch]=useState(''),[decision,setDecision]=useState('VERIFIED'),[note,setNote]=useState(''),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState({}),busy=useRef(false);
 const permitted=!!accessToken&&['FACILITY_STAFF','FACILITY_MANAGER','ADMIN','BOM'].includes(user?.role),valid=!id||objectId(id);
 const load=useCallback(async signal=>id?customerRecord(apiRecord(await customerReviewApi.detail(id,{signal}))):apiRows(await customerReviewApi.list({signal})).map(customerRecord),[id]);
 const resource=useFacilityResource(load,permitted&&valid);
 const facilityId=user?.assignedFacilityId;
 const canLoadRentals=permitted&&['FACILITY_MANAGER','FACILITY_STAFF'].includes(user?.role)&&objectId(facilityId)&&!!id;
 const loadRentals=useCallback(async signal=>apiRows(await facilityReservationApi.list(facilityId,{signal})).map(reservationRecord),[facilityId]);
 const rentals=useFacilityResource(loadRentals,canLoadRentals);
 const submit=async event=>{event.preventDefault();if(busy.current||!note.trim()||!id||!resource.data)return;busy.current=true;setSaving(true);setFeedback({});try{const response=await customerReviewApi.verify(id,decision,note.trim());const updated=customerRecord(apiRecord(response));if(updated.id!==id||updated.verification!==decision)throw Error("Máy chủ chưa xác nhận trạng thái xác minh được yêu cầu.");setFeedback({success:"Đã lưu trạng thái xác minh."});setNote('');announceReviewChange();}catch(error){setFeedback({error:reviewError(error)});}finally{busy.current=false;setSaving(false);}};
 const row=id?resource.data:null,history=rentals.data?.filter(r=>r.customerUserId===row?.userId&&r.facility===facilityId&&r.serviceType==='SELF_STORAGE')||[];
 return <Screen title={id?"Thông tin khách hàng":"Khách hàng"} code="P010 / P011" notice="Hồ sơ khách hàng và trạng thái xác minh từ máy chủ." action={<Button variant="outline" disabled={saving} onClick={()=>{resource.reload();rentals.reload();}}>Tải lại</Button>}>
 {!permitted?<Panel title="Cần tài khoản có quyền"><p role="alert">Đăng nhập bằng tài khoản có quyền để xem khách hàng.</p></Panel>:!valid?<Panel title="Mã khách hàng không hợp lệ"><p role="alert">Nhập mã hồ sơ khách hàng hợp lệ.</p></Panel>:<>
 <Panel title="Phạm vi dữ liệu"><p className="text-sm">Hồ sơ khách được chia sẻ với các vai trò có quyền. Trang chỉ hiển thị thông tin cơ bản. Lịch sử thuê bên dưới giới hạn trong cơ sở của bạn.</p></Panel>
 {resource.loading&&<p role="status">Đang tải khách hàng…</p>}<Message error={resource.error}/><Message {...feedback}/>
 {!id&&resource.data&&<Panel title="Danh sách khách hàng"><Field label="Tìm khách hàng"><Input aria-label="Tìm khách hàng" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tên, email hoặc số điện thoại"/></Field><Table rows={resource.data.filter(r=>[r.name,r.email,r.phone].some(v=>String(v).replaceAll(' ','').toLowerCase().includes(search.replaceAll(' ','').toLowerCase())))} columns={[{key:'name',label:"Khách hàng",render:r=><OpenLink to={`${base}/customers/${r.id}`}>{r.name}</OpenLink>},{key:'email',label:"Email"},{key:'phone',label:"Số điện thoại"},{key:'verification',label:"Xác minh",render:r=><Status value={r.verification}/>}]}/></Panel>}
 {row&&<><Panel title="Hồ sơ khách hàng"><Details values={[["Tên",row.name],["Email",row.email],["Số điện thoại",row.phone],["Địa chỉ",row.address],["Trạng thái",<Status value={row.verification}/>],["Mã hồ sơ",row.id]]}/></Panel>
 <Panel title="Xác minh khách hàng"><form className="space-y-4" onSubmit={submit}><Select label="Quyết định xác minh" value={decision} onChange={setDecision} disabled={saving} options={['VERIFIED','REJECTED']}/><Field label="Ghi chú xác minh"><Textarea aria-label="Ghi chú xác minh" required maxLength={1000} value={note} disabled={saving} onChange={e=>setNote(e.target.value)}/></Field><Button type="submit" disabled={saving||!note.trim()}>{saving?"Đang lưu…":"Lưu xác minh"}</Button></form></Panel>
 <Panel title="Lần xác minh gần nhất"><Details values={[["Người xác minh",row.verifiedBy||"Chưa cung cấp"],["Thời điểm ghi nhận",row.verifiedAt?new Date(row.verifiedAt).toLocaleString('vi-VN'):"Chưa có dữ liệu"],["Ghi chú",row.note||"Chưa có dữ liệu"]]}/>{row.history.length?<Timeline entries={row.history.map(e=>({at:e.createdAt||e.at,status:e.status,note:e.note}))}/>:<p className="mt-4 text-sm">Chưa có đầy đủ lịch sử xác minh.</p>}</Panel>
 <Panel title="Đơn thuê trong cơ sở được phân công">{!canLoadRentals?<p>Không thể xem lịch sử thuê với vai trò này hoặc tài khoản chưa được phân công cơ sở.</p>:<>{rentals.loading&&<p role="status">Đang tải đơn thuê…</p>}<Message error={rentals.error}/>{rentals.data&&<><p className="mb-4 text-sm">{history.filter(r=>r.status==='ACTIVE').length} đơn đang sử dụng. Danh sách chỉ gồm thuê kho riêng trong cơ sở của bạn.</p><Table rows={history} columns={[{key:'reservationCode',label:"Đơn thuê",render:r=><OpenLink to={`${base}/reservations/${r.id}`}>{r.reservationCode||r.id}</OpenLink>},{key:'unit',label:"Kho"},{key:'status',label:"Trạng thái",render:r=><Status value={r.status}/>},{key:'startDate',label:"Ngày bắt đầu",render:r=>new Date(r.startDate).toLocaleDateString('vi-VN')},{key:'endDate',label:"Ngày kết thúc",render:r=>new Date(r.endDate).toLocaleDateString('vi-VN')}]}/></>}</>}</Panel></>}
 </>}
 </Screen>;
}
