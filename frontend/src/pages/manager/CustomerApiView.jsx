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
 const submit=async event=>{event.preventDefault();if(busy.current||!note.trim()||!id||!resource.data)return;busy.current=true;setSaving(true);setFeedback({});try{const response=await customerReviewApi.verify(id,decision,note.trim());const updated=customerRecord(apiRecord(response));if(updated.id!==id||updated.verification!==decision)throw Error('The requested verification status was not confirmed.');setFeedback({success:'Verification status saved.'});setNote('');announceReviewChange();}catch(error){setFeedback({error:reviewError(error)});}finally{busy.current=false;setSaving(false);}};
 const row=id?resource.data:null,history=rentals.data?.filter(r=>r.customerUserId===row?.userId&&r.facility===facilityId&&r.serviceType==='SELF_STORAGE')||[];
 return <Screen title={id?'Customer details':'Customer'} code="P010 / P011" notice="Live customer profiles and verification status." action={<Button variant="outline" disabled={saving} onClick={()=>{resource.reload();rentals.reload();}}>Refresh</Button>}>
 {!permitted?<Panel title="Authorized account required"><p role="alert">Sign in with an authorized account to view customers.</p></Panel>:!valid?<Panel title="Invalid Customer ID"><p role="alert">Use a Customer Profile ID, not a demo customer code.</p></Panel>:<>
 <Panel title="Data scope"><p className="text-sm">Customer profiles are shared across authorized roles. Only basic information is shown; identity documents are not displayed. Rental history below is limited to your facility.</p></Panel>
 {resource.loading&&<p role="status">Loading customers…</p>}<Message error={resource.error}/><Message {...feedback}/>
 {!id&&resource.data&&<Panel title="Customer list"><Field label="Search customers"><Input aria-label="Search customers" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, email or phone number"/></Field><Table rows={resource.data.filter(r=>[r.name,r.email,r.phone].some(v=>String(v).replaceAll(' ','').toLowerCase().includes(search.replaceAll(' ','').toLowerCase())))} columns={[{key:'name',label:'Customer',render:r=><OpenLink to={`${base}/customers/${r.id}`}>{r.name}</OpenLink>},{key:'email',label:'Email'},{key:'phone',label:'Phone number'},{key:'verification',label:'Verification',render:r=><Status value={r.verification}/>}]}/></Panel>}
 {row&&<><Panel title="Customer profile"><Details values={[["Name",row.name],['Email',row.email],['Phone number',row.phone],['Address',row.address],['Status',<Status value={row.verification}/>],['Profile ID',row.id]]}/></Panel>
 <Panel title="Customer verification"><form className="space-y-4" onSubmit={submit}><Select label="Verification decision" value={decision} onChange={setDecision} disabled={saving} options={['VERIFIED','REJECTED']}/><Field label="Verification notes"><Textarea aria-label="Verification notes" required maxLength={1000} value={note} disabled={saving} onChange={e=>setNote(e.target.value)}/></Field><Button type="submit" disabled={saving||!note.trim()}>{saving?'Saving…':'Save verification'}</Button></form></Panel>
 <Panel title="Latest verification"><Details values={[["Verified by",row.verifiedBy||'Not provided'],['Recorded at',row.verifiedAt?new Date(row.verifiedAt).toLocaleString('en-GB'):'Not available'],['Notes',row.note||'Not available']]}/>{row.history.length?<Timeline entries={row.history.map(e=>({at:e.createdAt||e.at,status:e.status,note:e.note}))}/>:<p className="mt-4 text-sm">A complete verification history is not available yet.</p>}</Panel>
 <Panel title="Rentals in your assigned facility">{!canLoadRentals?<p>Rental history is unavailable for this role or no facility is assigned.</p>:<>{rentals.loading&&<p role="status">Loading rentals…</p>}<Message error={rentals.error}/>{rentals.data&&<><p className="mb-4 text-sm">{history.filter(r=>r.status==='ACTIVE').length} ACTIVE reservations. This list covers Self Storage in your assigned facility, not the entire system.</p><Table rows={history} columns={[{key:'reservationCode',label:'Rental',render:r=><OpenLink to={`${base}/reservations/${r.id}`}>{r.reservationCode||r.id}</OpenLink>},{key:'unit',label:'Unit'},{key:'status',label:'Status',render:r=><Status value={r.status}/>},{key:'startDate',label:'Start date',render:r=>new Date(r.startDate).toLocaleDateString('en-GB')},{key:'endDate',label:'End date',render:r=>new Date(r.endDate).toLocaleDateString('en-GB')}]}/></>}</>}</Panel></>}
 </>}
 </Screen>;
}
