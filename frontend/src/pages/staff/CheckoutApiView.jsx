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
  if(!notes.trim()||!inspectionConditions.includes(condition))throw Error('Notes and a valid condition are required.');
  const urls=imageUrls(images),fresh=await checkOutEligibility({reservationId,facilityId});
  const created=inspectionRecord(apiRecord(await inspectionApi.create({reservationId,facilityId,storageUnitId:recordId(fresh.unit),type:'CHECK_OUT',condition,notes:notes.trim()+'\nChecklist:\n'+checkOutChecklist.map(s=>'- '+s+': checked').join('\n'),images:urls})));
  if(!objectId(created.id)||created.type!=='CHECK_OUT'||created.status!=='DRAFT'||created.reservation!==reservationId||created.facility!==facilityId||created.unit!==recordId(fresh.unit)||created.condition!==condition)throw Error('The checkout inspection could not be verified. Refresh before creating another.');
  announceReviewChange();nav(`${base}/${created.id}`);
 });}
 async function complete(event){event.preventDefault();if(!permitted||!row||row.status!=='DRAFT'||!checks.every(Boolean))return;await run(async()=>{
  const fresh=await checkOutEligibility({reservationId:row.reservation,facilityId,inspectionId:row.id});
  if(fresh.inspection.condition!==row.condition)throw Error('The inspection condition has changed. Review it again.');
  const completed=inspectionRecord(apiRecord(await inspectionApi.complete(row.id)));
  if(completed.id!==row.id||completed.type!=='CHECK_OUT'||completed.status!=='COMPLETED'||completed.reservation!==row.reservation||completed.unit!==row.unit||completed.facility!==facilityId||completed.condition!==row.condition)throw Error('The completed inspection could not be verified. Refresh instead of submitting again.');
  setModal(false);announceReviewChange();
  const [rentalResponse,unitResponse]=await Promise.all([facilityReservationApi.detail(row.reservation,false),storageApi.unitDetail(row.unit)]);
  const rental=apiRecord(rentalResponse),unit=apiRecord(unitResponse),expected=returnedUnitStatus(row.condition);
  if(recordId(rental)!==row.reservation||recordId(rental.facilityId)!==facilityId||rental.status!=='CHECKED_OUT'||recordId(unit)!==row.unit||recordId(unit.facilityId)!==facilityId||unit.status!==expected)throw Error('The inspection is complete but reservation and unit states do not match. Do not submit checkout again; contact support.');
  setFeedback({success:`Confirmed CHECKED_OUT; unit ${expected}.`});
 });}
 const checklist=<div className="space-y-3">{checkOutChecklist.map((label,i)=><label key={label} className="flex gap-3"><input type="checkbox" disabled={saving} checked={checks[i]} onChange={e=>setChecks(values=>values.map((v,n)=>n===i?e.target.checked:v))}/>{label}</label>)}</div>;
 return <Screen title="Checkout" notice="Record the unit condition before completing checkout. Damaged units or units requiring cleaning will move to maintenance." action={<Button variant="outline" disabled={saving} onClick={()=>{resource.reload();rentals.reload();}}>Refresh</Button>}>
 {!permitted?<Panel title="Checkout unavailable"><p>An assigned Staff or Manager account and a valid Inspection ID are required.</p></Panel>:<>
 <Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Loading inspections…</p>}
 {!id&&<><Panel title="Checkout inspections"><Table rows={resource.data||[]} columns={[{key:'id',label:'Inspection',render:r=><OpenLink to={`${base}/${r.id}`}>{r.id}</OpenLink>},{key:'reservationCode',label:'Reservation'},{key:'unitCode',label:'Unit'},{key:'condition',label:'Condition'},{key:'status',label:'Status',render:r=><Status value={r.status}/>} ]}/></Panel>
 <Panel title="Create checkout inspection"><Message error={rentals.error}/><form className="space-y-4" onSubmit={create}><Select label="Active reservation" value={reservationId} onChange={setReservation} disabled={saving||rentals.loading} options={[['','Select an ACTIVE or OVERDUE reservation'],...(rentals.data||[]).map(r=>[recordId(r),r.reservationCode||recordId(r)])]}/><Select label="Checkout condition" value={condition} onChange={setCondition} disabled={saving} options={inspectionConditions}/><Field label="Checkout notes"><Textarea required maxLength={2000} value={notes} disabled={saving} onChange={e=>setNotes(e.target.value)}/></Field><Field label="Checkout image URLs"><Textarea value={images} disabled={saving} onChange={e=>setImages(e.target.value)} placeholder="Up to 3 HTTP/HTTPS URLs of saved images"/></Field>{checklist}<Button disabled={saving||!objectId(reservationId)||!notes.trim()||!checks.every(Boolean)}>Save checkout inspection</Button></form></Panel></>}
 {id&&resource.data&&!row&&<Panel title="Inspection not found"><p>The inspection is unavailable, has a different type or belongs to another facility.</p></Panel>}
 {row&&<Panel title="Checkout details"><Details values={ [['Inspection ID',row.id],['Reservation',row.reservationCode],['Unit',row.unitCode],['Condition',row.condition],['Status',<Status value={row.status}/>],['Created by',row.actor],['Notes',row.notes||'—']]}/>{row.images?.filter(url=>/^https?:\/\//i.test(url)).map((url,i)=><p key={url}><a className="manager-link break-all" href={url} target="_blank" rel="noopener noreferrer">Checkout image {i+1}</a></p>)}{row.status==='DRAFT'?<div className="mt-5 space-y-4"><p>After checkout: reservation CHECKED_OUT, unit {returnedUnitStatus(row.condition)}.</p>{checklist}<Button disabled={saving||!checks.every(Boolean)} onClick={()=>setModal(true)}>Complete checkout</Button></div>:<p className="mt-4">This inspection is complete. Do not check out again.</p>}</Panel>}
 <Panel title="Processing scope"><p>Checkout does not include refunds, deposit settlement or damage charges. These require separate workflows.</p></Panel>
 {modal&&row&&<Dialog title="Confirm checkout" onClose={()=>{if(!busy.current)setModal(false);}}><form onSubmit={complete}><p className="mb-4">Confirm that the unit has been returned and inspected. This ends use of the unit.</p><Message error={feedback.error}/><Button disabled={saving}>{saving?'Checking out…':'Confirm checkout'}</Button></form></Dialog>}
 </>}
 </Screen>;
}
