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
  return <Screen title="Access simulation" notice="Software simulation only; no physical lock is controlled. The current test PIN is 1234." action={<Button variant="outline" onClick={resource.reload}>Refresh list</Button>}>
    {!permitted?<Panel title="An authorized account and assigned facility are required"/>:<>
    <Message error={resource.error}/>{resource.loading?<p role="status">Loading reservations…</p>:<Panel title="Select a facility reservation"><Field label="Search reservation code or email"><Input value={search} onChange={e=>setSearch(e.target.value)}/></Field><Select label="Access reservation" value={rows.some(r=>recordId(r)===selected)?selected:''} onChange={setSelected} options={[['','Select a reservation'],...rows.map(r=>[recordId(r),`${r.reservationCode} · ${r.status}`])]}/>{!rows.length&&<p>No matching reservations in the loaded data.</p>}</Panel>}
    {!resource.loading&&!resource.error&&resource.data?.some(r=>recordId(r)===selected)&&<AccessRecord key={`${user.id}:${user.assignedFacilityId}:${selected}`} id={selected} user={user}/>}
    <Panel title="Available features"><p>PIN issuance, reset, revocation and facility access logs are not available yet. This page checks reservation status and simulates unlocking. PINs are not saved in browser storage.</p></Panel>
    </>}
  </Screen>;
}
function AccessRecord({id,user}) {
  const [pin,setPin]=useState(''),[confirmation,setConfirmation]=useState(false),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState({}),busy=useRef(false);
  const load=useCallback(async signal=>{
    const row=apiRecord(await facilityReservationApi.detail(id,false,{signal}));
    if(recordId(row)!==id||recordId(row.facilityId)!==user.assignedFacilityId||row.serviceType!=='SELF_STORAGE'||!objectId(recordId(row.storageUnitId))||!row.reservationCode)throw Error('The reservation is outside your facility or missing unit information.');
    return row;
  },[id,user.assignedFacilityId]);
  const resource=useFacilityResource(load,true),row=resource.data;
  async function unlock(e) {
    e.preventDefault();if(busy.current)return;busy.current=true;setSaving(true);setFeedback({});
    try {
      const fresh=await load();
      if(fresh.status!=='ACTIVE')throw Error('The reservation is no longer ACTIVE. Refresh before continuing.');
      if(!/^\d{4}$/.test(pin))throw Error('Enter a 4-digit simulation PIN.');
      let response;
      try{response=await client.post('/access/simulate-unlock',{reservationCode:fresh.reservationCode,pinCode:pin});}
      catch(error){const log=error?.response?.data?.data;if(error?.response?.status===401&&log?.action==='UNLOCK_FAILED'&&recordId(log.reservationId)===id)throw Error('Incorrect PIN. Unlock denied; your session is still active.');throw error;}
      const log=apiRecord(response);
      if(log.action!=='UNLOCK_SUCCESS'||recordId(log.reservationId)!==id||recordId(log.storageUnitId)!==recordId(fresh.storageUnitId)||recordId(log.customerId)!==recordId(fresh.customerId))throw Error('Unlock was not confirmed for the selected reservation and unit.');
      setFeedback({success:'The server recorded UNLOCK_SUCCESS for reservation '+fresh.reservationCode+'. This is a simulation result.'});setConfirmation(false);
    }catch(error){setFeedback({error:reviewError(error)});}finally{setPin('');resource.reload();busy.current=false;setSaving(false);}
  }
  return <Panel title="Access status"><Message error={resource.error}/><Message {...feedback}/>{resource.loading&&<p role="status">Checking status…</p>}{row&&<><Details values={[["Reservation",row.reservationCode],['Status',<Status value={row.status}/>],['Unit',row.storageUnitId?.unitCode||recordId(row.storageUnitId)],['Access eligibility',row.status==='ACTIVE'?'Eligible for PIN verification':row.status==='OVERDUE'?'Blocked due to overdue payment':'Not activated or already ended']]}/>{row.status==='ACTIVE'&&<div className="mt-4 space-y-4"><Field label="Simulation PIN"><Input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} disabled={saving} onChange={e=>{setPin(e.target.value);setFeedback({});}}/></Field><Button disabled={saving||!/^\d{4}$/.test(pin)} onClick={()=>setConfirmation(true)}>Simulate unlock</Button></div>}</>}
    {confirmation&&<Dialog title="Confirm simulation" onClose={()=>{if(!busy.current){setConfirmation(false);setPin('');}}}><form onSubmit={unlock}><p className="mb-4">Simulate unlocking for the selected reservation. The server will record the result.</p><Message {...feedback}/><Button disabled={saving||!pin}>{saving?'Checking…':'Confirm unlock'}</Button></form></Dialog>}
  </Panel>;
}
