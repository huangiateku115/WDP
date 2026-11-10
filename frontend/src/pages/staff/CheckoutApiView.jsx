import {useCallback,useRef,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,apiRows,objectId,recordId,reviewError} from '@/lib/facilityReview';
import {inspectionRecord,inspectionConditions,imageUrls} from '@/lib/inspectionReview';
import {checkOutChecklist,checkOutEligibility,returnedUnitStatus} from '@/lib/checkOutReview';
import {Screen,Panel,Table,OpenLink,Field,Select,Textarea,Button,Message,Details,Status,Dialog} from '@/components/manager/ManagerUI';

export default function CheckoutApiView({manager=false}){const {id}=useParams();return <Checkout key={id||'list'} manager={manager}/>;}
function Checkout({manager}){
 const {id}=useParams(),nav=useNavigate(),{user}=useAuthSession(),facilityId=user?.assignedFacilityId,base=manager?'/manager/work/CHECKOUT':'/staff/checkouts';
 const permitted=['FACILITY_MANAGER','FACILITY_STAFF'].includes(user?.role)&&objectId(facilityId)&&(!id||objectId(id));
 const [reservationId,setReservation]=useState(''),[condition,setCondition]=useState('GOOD'),[notes,setNotes]=useState(''),[images,setImages]=useState(''),[checks,setChecks]=useState(checkOutChecklist.map(()=>false)),[saving,setSaving]=useState(false),[modal,setModal]=useState(false),[feedback,setFeedback]=useState({}),busy=useRef(false);
 const load=useCallback(async signal=>apiRows(await inspectionApi.list({}, {signal})).map(inspectionRecord).filter(r=>r.facility===facilityId&&r.type==='CHECK_OUT'),[facilityId]);
 const resource=useFacilityResource(load,permitted),row=resource.data?.find(r=>r.id===id);
 const loadRentals=useCallback(async signal=>apiRows(await facilityReservationApi.list(facilityId,{signal})).filter(r=>recordId(r.facilityId)===facilityId&&r.serviceType==='SELF_STORAGE'&&['ACTIVE','OVERDUE'].includes(r.status)),[facilityId]);
 const rentals=useFacilityResource(loadRentals,permitted&&!id);
 async function run(work){if(busy.current)return;busy.current=true;setSaving(true);setFeedback({});try{await work();}catch(error){setFeedback({error:reviewError(error)});resource.reload();rentals.reload();}finally{busy.current=false;setSaving(false);}}
 async function create(event){event.preventDefault();if(!permitted||!checks.every(Boolean))return;await run(async()=>{
  if(!notes.trim()||!inspectionConditions.includes(condition))throw Error("Cần ghi chú và tình trạng hợp lệ.");
  const urls=imageUrls(images),fresh=await checkOutEligibility({reservationId,facilityId});
  const created=inspectionRecord(apiRecord(await inspectionApi.create({reservationId,facilityId,storageUnitId:recordId(fresh.unit),type:'CHECK_OUT',condition,notes:notes.trim()+'\nChecklist:\n'+checkOutChecklist.map(s=>'- '+s+': checked').join('\n'),images:urls})));
  if(!objectId(created.id)||created.type!=='CHECK_OUT'||created.status!=='DRAFT'||created.reservation!==reservationId||created.facility!==facilityId||created.unit!==recordId(fresh.unit)||created.condition!==condition)throw Error("Chưa xác minh được biên bản trả kho. Tải lại trước khi tạo thêm.");
  announceReviewChange();nav(`${base}/${created.id}`);
 });}
 async function complete(event){event.preventDefault();if(!permitted||!row||row.status!=='DRAFT'||!checks.every(Boolean))return;await run(async()=>{
  const fresh=await checkOutEligibility({reservationId:row.reservation,facilityId,inspectionId:row.id});
  if(fresh.inspection.condition!==row.condition)throw Error("Tình trạng kiểm tra đã thay đổi. Vui lòng xem lại.");
  const completed=inspectionRecord(apiRecord(await inspectionApi.complete(row.id)));
  if(completed.id!==row.id||completed.type!=='CHECK_OUT'||completed.status!=='COMPLETED'||completed.reservation!==row.reservation||completed.unit!==row.unit||completed.facility!==facilityId||completed.condition!==row.condition)throw Error("Chưa xác minh được biên bản hoàn tất. Vui lòng tải lại để kiểm tra.");
  setModal(false);announceReviewChange();
  const [rentalResponse,unitResponse]=await Promise.all([facilityReservationApi.detail(row.reservation,false),storageApi.unitDetail(row.unit)]);
  const rental=apiRecord(rentalResponse),unit=apiRecord(unitResponse),expected=returnedUnitStatus(row.condition);
  if(recordId(rental)!==row.reservation||recordId(rental.facilityId)!==facilityId||rental.status!=='CHECKED_OUT'||recordId(unit)!==row.unit||recordId(unit.facilityId)!==facilityId||unit.status!==expected)throw Error("Biên bản đã hoàn tất nhưng trạng thái đơn và kho chưa khớp. Liên hệ hỗ trợ để kiểm tra kết quả.");
  setFeedback({success:`Confirmed CHECKED_OUT; unit ${expected}.`});
 });}
 const checklist=<div className="space-y-3">{checkOutChecklist.map((label,i)=><label key={label} className="flex gap-3"><input type="checkbox" disabled={saving} checked={checks[i]} onChange={e=>setChecks(values=>values.map((v,n)=>n===i?e.target.checked:v))}/>{label}</label>)}</div>;
 return <Screen title="Trả kho" notice="Ghi nhận tình trạng kho trước khi hoàn tất trả kho. Kho hỏng hoặc cần vệ sinh sẽ chuyển sang bảo trì." action={<Button variant="outline" disabled={saving} onClick={()=>{resource.reload();rentals.reload();}}>Tải lại</Button>}>
 {!permitted?<Panel title="Không thể trả kho"><p>Cần tài khoản nhân viên hoặc quản lý được phân công cơ sở và mã biên bản hợp lệ.</p></Panel>:<>
 <Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Đang tải biên bản…</p>}
 {!id&&<><Panel title="Biên bản trả kho"><Table rows={resource.data||[]} columns={[{key:'id',label:"Kiểm tra kho",render:r=><OpenLink to={`${base}/${r.id}`}>{r.id}</OpenLink>},{key:'reservationCode',label:"Đơn thuê"},{key:'unitCode',label:"Kho"},{key:'condition',label:"Tình trạng"},{key:'status',label:"Trạng thái",render:r=><Status value={r.status}/>} ]}/></Panel>
 <Panel title="Tạo biên bản trả kho"><Message error={rentals.error}/><form className="space-y-4" onSubmit={create}><Select label="Đơn đang sử dụng" value={reservationId} onChange={setReservation} disabled={saving||rentals.loading} options={[['',"Chọn đơn đang sử dụng hoặc quá hạn"],...(rentals.data||[]).map(r=>[recordId(r),r.reservationCode||recordId(r)])]}/><Select label="Tình trạng trả kho" value={condition} onChange={setCondition} disabled={saving} options={inspectionConditions}/><Field label="Ghi chú trả kho"><Textarea required maxLength={2000} value={notes} disabled={saving} onChange={e=>setNotes(e.target.value)}/></Field><Field label="Địa chỉ ảnh trả kho"><Textarea value={images} disabled={saving} onChange={e=>setImages(e.target.value)} placeholder="Tối đa 3 địa chỉ HTTP/HTTPS của ảnh đã lưu"/></Field>{checklist}<Button disabled={saving||!objectId(reservationId)||!notes.trim()||!checks.every(Boolean)}>Lưu biên bản trả kho</Button></form></Panel></>}
 {id&&resource.data&&!row&&<Panel title="Không tìm thấy biên bản"><p>Biên bản không khả dụng, khác loại hoặc thuộc cơ sở khác.</p></Panel>}
 {row&&<Panel title="Chi tiết trả kho"><Details values={ [["Mã biên bản",row.id],["Đơn thuê",row.reservationCode],['Unit',row.unitCode],["Tình trạng",row.condition],["Trạng thái",<Status value={row.status}/>],["Người tạo",row.actor],["Ghi chú",row.notes||'—']]}/>{row.images?.filter(url=>/^https?:\/\//i.test(url)).map((url,i)=><p key={url}><a className="manager-link break-all" href={url} target="_blank" rel="noopener noreferrer">Ảnh trả kho {i+1}</a></p>)}{row.status==='DRAFT'?<div className="mt-5 space-y-4"><p>Sau trả kho: đơn đã trả kho, tình trạng kho {returnedUnitStatus(row.condition)}.</p>{checklist}<Button disabled={saving||!checks.every(Boolean)} onClick={()=>setModal(true)}>Hoàn tất trả kho</Button></div>:<p className="mt-4">Biên bản trả kho đã hoàn tất.</p>}</Panel>}
 <Panel title="Phạm vi xử lý"><p>Hoàn tiền, đối soát tiền cọc và phí hư hỏng được xử lý trong các luồng riêng.</p></Panel>
 {modal&&row&&<Dialog title="Xác nhận trả kho" onClose={()=>{if(!busy.current)setModal(false);}}><form onSubmit={complete}><p className="mb-4">Xác nhận kho đã được trả và kiểm tra. Thao tác này kết thúc quyền sử dụng kho.</p><Message error={feedback.error}/><Button disabled={saving}>{saving?"Đang hoàn tất trả kho…":"Xác nhận trả kho"}</Button></form></Dialog>}
 </>}
 </Screen>;
}
