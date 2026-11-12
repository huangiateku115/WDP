import {useCallback,useEffect,useRef,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import inspectionApi from '@/api/inspectionApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,apiRows,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {checkInEligibility,inspectionRecord,inspectionConditions,checkInChecklist,imageUrls} from '@/lib/inspectionReview';
import {Screen,Panel,Table,OpenLink,Input,Field,Details,Status,Select,Textarea,Message,Button,Dialog} from '@/components/manager/ManagerUI';

export default function InspectionApiView({type,manager=false}){const {id}=useParams();return <InspectionContent key={(id||'list')+type} type={type} manager={manager}/>;}
function InspectionContent({type,manager}){
 const {id}=useParams(),nav=useNavigate(),{user}=useAuthSession(),facilityId=user?.assignedFacilityId;
 const base=manager?`/manager/work/${type}`:type==='CHECK_IN'?'/staff/check-ins':'/staff/inspections';
 const [reservationId,setReservation]=useState(''),[unitFilter,setUnitFilter]=useState(''),[filters,setFilters]=useState({}),[contractId,setContract]=useState(''),[condition,setCondition]=useState('GOOD'),[notes,setNotes]=useState(''),[images,setImages]=useState(''),[checks,setChecks]=useState(checkInChecklist.map(()=>false)),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState({}),[modal,setModal]=useState(false),busy=useRef(false);
 const hasFacility=objectId(facilityId),isManager=['FACILITY_MANAGER','FACILITY_STAFF'].includes(user?.role),valid=!id||objectId(id);
 const load=useCallback(async signal=>apiRows(await inspectionApi.list(filters,{signal})).map(inspectionRecord).filter(r=>r.facility===facilityId),[filters,facilityId]);
 const resource=useFacilityResource(load,hasFacility&&valid);
 const row=resource.data?.find(r=>r.id===id);
 const loadReservations=useCallback(async signal=>apiRows(await facilityReservationApi.list(facilityId,{signal})),[facilityId]);
 const reservations=useFacilityResource(loadReservations,hasFacility&&isManager&&!id);
 const linkedReservation=id?row?.reservation:reservationId;
 const contractLoad=useCallback(async signal=>apiRecord(await inspectionApi.contractByReservation(linkedReservation,{signal})),[linkedReservation]);
 const contractResource=useFacilityResource(contractLoad,hasFacility&&objectId(linkedReservation));
 useEffect(()=>{setContract(contractResource.data&&recordId(contractResource.data.reservationId)===linkedReservation?recordId(contractResource.data):'');},[contractResource.data,linkedReservation]);
 const run=async work=>{if(busy.current)return;busy.current=true;setSaving(true);setFeedback({});try{await work();}catch(error){setFeedback({error:reviewError(error)});if([404,409].includes(error?.response?.status))resource.reload();}finally{busy.current=false;setSaving(false);}};
 const complete=async event=>{event.preventDefault();if(!row||!isManager||!checks.every(Boolean)||row.status!=='DRAFT'||row.type!=='CHECK_IN')return;await run(async()=>{
  await checkInEligibility({reservationId:row.reservation,facilityId,inspectionId:row.id});
  const completed=inspectionRecord(apiRecord(await inspectionApi.complete(row.id)));
  if(completed.id!==row.id||completed.status!=='COMPLETED'||completed.type!=='CHECK_IN'||completed.reservation!==row.reservation||completed.unit!==row.unit||completed.facility!==facilityId)throw Error("Chưa xác minh được biên bản hoàn tất. Nhận kho chưa được xác nhận.");
  setModal(false);announceReviewChange();
  // Verify one record at a time instead of firing both GETs together (keeps backend load low).
  const reservationResponse=await facilityReservationApi.detail(row.reservation,false);
  const unitResponse=await storageApi.unitDetail(row.unit);
  const rental=apiRecord(reservationResponse),unit=apiRecord(unitResponse);
  if(recordId(rental)!==row.reservation||recordId(rental.facilityId)!==facilityId||recordId(unit)!==row.unit||recordId(unit.facilityId)!==facilityId||rental.status!=='ACTIVE'||unit.status!=='OCCUPIED')throw Error('The inspection is COMPLETED but ACTIVE/OCCUPIED states were not confirmed. Do not complete it again; contact support.');
  setFeedback({success:"Đã xác nhận biên bản hoàn tất, đơn đang sử dụng và kho đã có khách thuê."});
 });};
 const create=async event=>{event.preventDefault();if(!isManager||!checks.every(Boolean)||!notes.trim())return;await run(async()=>{
  const urls=imageUrls(images),eligible=await checkInEligibility({reservationId,facilityId});
  if(!inspectionConditions.includes(condition))throw Error("Tình trạng kho không hợp lệ.");
  const body={reservationId,facilityId,storageUnitId:recordId(eligible.unit),type:'CHECK_IN',condition,notes:notes.trim()+'\nChecklist:\n'+checkInChecklist.map(text=>'- '+text+': checked').join('\n'),images:urls};
  const created=inspectionRecord(apiRecord(await inspectionApi.create(body)));
  if(!objectId(created.id)||created.status!=='DRAFT'||created.type!=='CHECK_IN'||created.reservation!==reservationId||created.facility!==facilityId||created.unit!==recordId(eligible.unit))throw Error("Chưa xác nhận biên bản nháp cho đơn và kho này. Tải lại trước khi tạo thêm.");
  announceReviewChange();nav(`${base}/${created.id}`);
 });};
 const checklist=<div className="space-y-3">{checkInChecklist.map((text,index)=><label className="flex items-start gap-3 text-sm" key={text}><input type="checkbox" checked={checks[index]} disabled={saving} onChange={event=>setChecks(values=>values.map((value,i)=>i===index?event.target.checked:value))}/>{text}</label>)}</div>;
 return <Screen title={type==='CHECK_IN'?"Tiếp nhận khách":"Kiểm tra kho"} code={type==='CHECK_IN'?'P025':'P030'} notice="Biên bản nhận kho cho đơn cũ. Dùng Bàn giao cho đơn đã ký hợp đồng giấy." action={<Button disabled={saving} variant="outline" onClick={resource.reload}>Tải lại biên bản</Button>}>
 {!hasFacility?<Panel title="Chưa được phân công cơ sở"><p role="alert">Tài khoản cần được phân công cơ sở để xem biên bản.</p></Panel>:!valid?<Panel title="Mã biên bản không hợp lệ"><p role="alert">Nhập mã biên bản ở đường dẫn chi tiết thay cho mã đơn hoặc công việc trình diễn.</p></Panel>:<>
 <Panel title="Điều kiện và giới hạn"><p>Nhận kho cần đơn thuê kho riêng đã thanh toán, hợp đồng đã ký khớp đơn và kho khả dụng trong cơ sở. Dữ liệu được kiểm tra lại trước khi xác nhận.</p></Panel>
 {resource.loading&&<p role="status">Đang tải biên bản…</p>}<Message error={resource.error}/><Message {...feedback}/><Message error={contractResource.error}/>
 {!id&&<><Panel title="Lọc biên bản"><form className="facility-filter-row" onSubmit={e=>{e.preventDefault();if(reservationId&&!objectId(reservationId)||unitFilter&&!objectId(unitFilter)){setFeedback({error:'Filters require a valid 24-character record ID.'});return;}setFeedback({});setFilters({...reservationId&&{reservationId},...unitFilter&&{storageUnitId:unitFilter}});}}><Input aria-label="Lọc theo mã định danh đơn thuê" placeholder="Mã định danh đơn thuê" value={reservationId} disabled={saving} onChange={e=>setReservation(e.target.value.trim())}/><Input aria-label="Lọc theo mã kho riêng" placeholder="Mã kho riêng" value={unitFilter} disabled={saving} onChange={e=>setUnitFilter(e.target.value.trim())}/><Button type="submit" disabled={saving}>Lọc biên bản</Button></form></Panel>
 {resource.data&&<Panel title="Biên bản tại cơ sở"><Table rows={resource.data} columns={[{key:'id',label:"Kiểm tra kho",render:r=><OpenLink to={`${base}/${r.id}`}>{r.id}</OpenLink>},{key:'reservationCode',label:"Đơn thuê"},{key:'unitCode',label:"Kho"},{key:'type',label:"Loại"},{key:'status',label:"Trạng thái",render:r=><Status value={r.status}/>},{key:'condition',label:"Tình trạng"},{key:'actor',label:"Người tạo"}]}/></Panel>}
 {isManager&&<Panel title="Tạo biên bản nhận kho nháp"><Message error={reservations.error}/>{reservations.loading&&<p role="status">Đang tải đơn đủ điều kiện…</p>}<form className="space-y-4" onSubmit={create}><Select label="Chọn đơn đã thanh toán" disabled={saving} value={reservationId} onChange={setReservation} options={ [['','Select a paid Self Storage reservation'],...(reservations.data||[]).filter(r=>r.status==='PAID'&&recordId(r.facilityId)===facilityId).map(r=>[recordId(r),r.reservationCode||recordId(r)])]}/><Field label="Mã hợp đồng đã ký"><Input aria-label="Mã hợp đồng đã ký" value={contractId} readOnly disabled={saving} placeholder="Mã hợp đồng từ máy chủ"/></Field><p className="text-sm">Hợp đồng được tự động tải theo đơn thuê.</p><Select label="Tình trạng kho" value={condition} onChange={setCondition} disabled={saving} options={inspectionConditions}/>{checklist}<Field label="Ghi chú tình trạng"><Textarea aria-label="Ghi chú tình trạng" required maxLength={2000} value={notes} disabled={saving} onChange={e=>setNotes(e.target.value)}/></Field><Field label="Địa chỉ ảnh bằng chứng"><Textarea aria-label="Địa chỉ ảnh bằng chứng" value={images} disabled={saving} onChange={e=>setImages(e.target.value)} placeholder="Mỗi dòng một địa chỉ ảnh HTTP/HTTPS. Chưa hỗ trợ tải ảnh trực tiếp tại đây"/></Field><p className="text-sm">Danh sách kiểm tra được lưu cùng ghi chú. Lưu bản nháp chưa hoàn tất nhận kho hoặc tạo phí.</p><Button type="submit" disabled={saving||!checks.every(Boolean)||!notes.trim()||!objectId(reservationId)||!objectId(contractId)}>{saving?'Submitting…':"Lưu biên bản nháp"}</Button></form></Panel>}</>}
 {id&&resource.data&&!row&&<Panel title="Không tìm thấy biên bản"><p role="alert">Biên bản không tồn tại hoặc ngoài cơ sở được phân công.</p></Panel>}
 {row&&<><Panel title="Chi tiết biên bản"><Details values={[["Mã biên bản",row.id],["Đơn thuê",row.reservationCode],['Storage Unit',row.unitCode],["Loại",row.type],["Trạng thái",<Status value={row.status}/>],["Tình trạng",row.condition],["Người tạo",row.actor],["Thời điểm ghi nhận",row.createdAt?new Date(row.createdAt).toLocaleString('vi-VN'):"Chưa cung cấp"],["Ghi chú",<span className="whitespace-pre-wrap">{row.notes||'—'}</span>]]}/>{row.images?.length>0&&<ul className="mt-4 space-y-2">{row.images.filter(url=>/^https?:\/\//i.test(url)).map((url,i)=><li key={i}><a className="manager-link break-all" href={url} target="_blank" rel="noopener noreferrer">Ảnh bằng chứng {i+1}</a></li>)}</ul>}</Panel>
 {row.status==='DRAFT'&&row.type==='CHECK_IN'&&isManager?<Panel title="Hoàn tất kiểm tra và nhận kho"><Field label="Mã hợp đồng đã ký"><Input aria-label="Mã hợp đồng đã ký" value={contractId} readOnly disabled={saving}/></Field>{checklist}<Button className="mt-4" disabled={saving||!objectId(contractId)||!checks.every(Boolean)||!['GOOD','EXCELLENT'].includes(row.condition)} onClick={()=>setModal(true)}>Kiểm tra và nhận kho</Button>{!['GOOD','EXCELLENT'].includes(row.condition)&&<p role="alert">Kho hư hỏng hoặc cần vệ sinh chưa thể bàn giao nhận kho. Chưa hỗ trợ sửa biên bản nháp.</p>}</Panel>:<Panel title="Thao tác"><p>{row.status==='COMPLETED'?"Biên bản đã hoàn tất.":row.type==='CHECK_OUT'?<OpenLink to={`${manager?'/manager/work/CHECKOUT':'/staff/checkouts'}/${row.id}`}>Mở luồng trả kho</OpenLink>:'No action is available for the current status.'}</p></Panel>}
 </>}
 {modal&&row&&<Dialog title="Xác nhận nhận kho" onClose={()=>{if(!busy.current)setModal(false);}}><form className="space-y-4" onSubmit={complete}><p>Đơn thuê, hợp đồng, kho và biên bản sẽ được kiểm tra lại trước khi hoàn tất {row.id}. Thao tác kích hoạt đơn thuê và ghi nhận kho đang được sử dụng.</p><Message error={feedback.error}/><Button type="submit" disabled={saving}>{saving?'Checking in…':'Confirm check-in'}</Button></form></Dialog>}
 </>}
 </Screen>;
}
