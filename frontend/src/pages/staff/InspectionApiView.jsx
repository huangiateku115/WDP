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
  if(completed.id!==row.id||completed.status!=='COMPLETED'||completed.type!=='CHECK_IN'||completed.reservation!==row.reservation||completed.unit!==row.unit||completed.facility!==facilityId)throw Error('The completed inspection could not be verified. Check-in is not confirmed.');
  setModal(false);announceReviewChange();
  // Verify one record at a time instead of firing both GETs together (keeps backend load low).
  const reservationResponse=await facilityReservationApi.detail(row.reservation,false);
  const unitResponse=await storageApi.unitDetail(row.unit);
  const rental=apiRecord(reservationResponse),unit=apiRecord(unitResponse);
  if(recordId(rental)!==row.reservation||recordId(rental.facilityId)!==facilityId||recordId(unit)!==row.unit||recordId(unit.facilityId)!==facilityId||rental.status!=='ACTIVE'||unit.status!=='OCCUPIED')throw Error('The inspection is COMPLETED but ACTIVE/OCCUPIED states were not confirmed. Do not complete it again; contact support.');
  setFeedback({success:'Confirmed: inspection COMPLETED, reservation ACTIVE and unit OCCUPIED.'});
 });};
 const create=async event=>{event.preventDefault();if(!isManager||!checks.every(Boolean)||!notes.trim())return;await run(async()=>{
  const urls=imageUrls(images),eligible=await checkInEligibility({reservationId,facilityId});
  if(!inspectionConditions.includes(condition))throw Error('Invalid unit condition.');
  const body={reservationId,facilityId,storageUnitId:recordId(eligible.unit),type:'CHECK_IN',condition,notes:notes.trim()+'\nChecklist:\n'+checkInChecklist.map(text=>'- '+text+': checked').join('\n'),images:urls};
  const created=inspectionRecord(apiRecord(await inspectionApi.create(body)));
  if(!objectId(created.id)||created.status!=='DRAFT'||created.type!=='CHECK_IN'||created.reservation!==reservationId||created.facility!==facilityId||created.unit!==recordId(eligible.unit))throw Error('The draft inspection was not confirmed for this reservation and unit. Refresh before creating another.');
  announceReviewChange();nav(`${base}/${created.id}`);
 });};
 const checklist=<div className="space-y-3">{checkInChecklist.map((text,index)=><label className="flex items-start gap-3 text-sm" key={text}><input type="checkbox" checked={checks[index]} disabled={saving} onChange={event=>setChecks(values=>values.map((value,i)=>i===index?event.target.checked:value))}/>{text}</label>)}</div>;
 return <Screen title={type==='CHECK_IN'?'Check-in':'Unit inspections'} code={type==='CHECK_IN'?'P025':'P030'} notice="Check-in inspections for legacy reservations. Use Handover for reservations with a signed paper contract." action={<Button disabled={saving} variant="outline" onClick={resource.reload}>Refresh inspections</Button>}>
 {!hasFacility?<Panel title="No facility assigned"><p role="alert">Your account needs an assigned facility to view inspections.</p></Panel>:!valid?<Panel title="Invalid Inspection ID"><p role="alert">Use the Inspection ID in the detail URL, not a reservation or demo task ID.</p></Panel>:<>
 <Panel title="Requirements and limitations"><p>Check-in requires a PAID Self Storage reservation, a matching SIGNED contract and an available unit in your facility. Details are checked again before confirmation.</p></Panel>
 {resource.loading&&<p role="status">Loading inspections…</p>}<Message error={resource.error}/><Message {...feedback}/><Message error={contractResource.error}/>
 {!id&&<><Panel title="Filter inspections"><form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();if(reservationId&&!objectId(reservationId)||unitFilter&&!objectId(unitFilter)){setFeedback({error:'Filters require a valid 24-character record ID.'});return;}setFeedback({});setFilters({...reservationId&&{reservationId},...unitFilter&&{storageUnitId:unitFilter}});}}><Input aria-label="Filter by Reservation ID" placeholder="Reservation ID" value={reservationId} disabled={saving} onChange={e=>setReservation(e.target.value.trim())}/><Input aria-label="Filter by Storage Unit ID" placeholder="Storage Unit ID" value={unitFilter} disabled={saving} onChange={e=>setUnitFilter(e.target.value.trim())}/><Button type="submit" disabled={saving}>Filter inspections</Button></form></Panel>
 {resource.data&&<Panel title="Facility inspections"><Table rows={resource.data} columns={[{key:'id',label:'Inspection',render:r=><OpenLink to={`${base}/${r.id}`}>{r.id}</OpenLink>},{key:'reservationCode',label:'Reservation'},{key:'unitCode',label:'Unit'},{key:'type',label:'Type'},{key:'status',label:'Status',render:r=><Status value={r.status}/>},{key:'condition',label:'Condition'},{key:'actor',label:'Created by'}]}/></Panel>}
 {isManager&&<Panel title="Create draft CHECK_IN inspection"><Message error={reservations.error}/>{reservations.loading&&<p role="status">Loading eligible reservations…</p>}<form className="space-y-4" onSubmit={create}><Select label="Select a PAID reservation" disabled={saving} value={reservationId} onChange={setReservation} options={ [['','Select a paid Self Storage reservation'],...(reservations.data||[]).filter(r=>r.status==='PAID'&&recordId(r.facilityId)===facilityId).map(r=>[recordId(r),r.reservationCode||recordId(r)])]}/><Field label="Signed Contract ID"><Input aria-label="Signed Contract ID" value={contractId} readOnly disabled={saving} placeholder="Contract ID from server"/></Field><p className="text-sm">The contract is loaded automatically for the reservation.</p><Select label="Unit condition" value={condition} onChange={setCondition} disabled={saving} options={inspectionConditions}/>{checklist}<Field label="Condition notes"><Textarea aria-label="Condition notes" required maxLength={2000} value={notes} disabled={saving} onChange={e=>setNotes(e.target.value)}/></Field><Field label="Evidence image URLs"><Textarea aria-label="Evidence image URLs" value={images} disabled={saving} onChange={e=>setImages(e.target.value)} placeholder="One HTTP/HTTPS URL per line; direct image upload is unavailable"/></Field><p className="text-sm">The checklist is saved with inspection notes. Saving a draft does not create charges or complete check-in.</p><Button type="submit" disabled={saving||!checks.every(Boolean)||!notes.trim()||!objectId(reservationId)||!objectId(contractId)}>{saving?'Submitting…':'Save draft inspection'}</Button></form></Panel>}</>}
 {id&&resource.data&&!row&&<Panel title="Inspection not found"><p role="alert">The inspection does not exist or is outside your assigned facility.</p></Panel>}
 {row&&<><Panel title="Inspection details"><Details values={[["Inspection ID",row.id],['Reservation',row.reservationCode],['Storage Unit',row.unitCode],['Type',row.type],['Status',<Status value={row.status}/>],['Condition',row.condition],['Created by',row.actor],['Recorded at',row.createdAt?new Date(row.createdAt).toLocaleString('en-GB'):'Not provided'],['Notes',<span className="whitespace-pre-wrap">{row.notes||'—'}</span>]]}/>{row.images?.length>0&&<ul className="mt-4 space-y-2">{row.images.filter(url=>/^https?:\/\//i.test(url)).map((url,i)=><li key={i}><a className="manager-link break-all" href={url} target="_blank" rel="noopener noreferrer">Evidence image {i+1}</a></li>)}</ul>}</Panel>
 {row.status==='DRAFT'&&row.type==='CHECK_IN'&&isManager?<Panel title="Complete inspection and check in"><Field label="Signed Contract ID"><Input aria-label="Signed Contract ID" value={contractId} readOnly disabled={saving}/></Field>{checklist}<Button className="mt-4" disabled={saving||!objectId(contractId)||!checks.every(Boolean)||!['GOOD','EXCELLENT'].includes(row.condition)} onClick={()=>setModal(true)}>Review and check in</Button>{!['GOOD','EXCELLENT'].includes(row.condition)&&<p role="alert">Damaged units or units requiring cleaning cannot be checked in. Draft inspection editing is not available yet.</p>}</Panel>:<Panel title="Action"><p>{row.status==='COMPLETED'?'This inspection is complete. Do not complete it again.':row.type==='CHECK_OUT'?<OpenLink to={`${manager?'/manager/work/CHECKOUT':'/staff/checkouts'}/${row.id}`}>Open checkout workflow</OpenLink>:'No action is available for the current status.'}</p></Panel>}
 </>}
 {modal&&row&&<Dialog title="Confirm CHECK_IN" onClose={()=>{if(!busy.current)setModal(false);}}><form className="space-y-4" onSubmit={complete}><p>The reservation, contract, unit and inspection will be checked again before completing inspection {row.id}. This activates the reservation and marks the unit as occupied.</p><Message error={feedback.error}/><Button type="submit" disabled={saving}>{saving?'Checking in…':'Confirm check-in'}</Button></form></Dialog>}
 </>}
 </Screen>;
}
