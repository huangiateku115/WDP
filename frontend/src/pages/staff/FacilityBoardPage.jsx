import {useCallback,useEffect,useState} from 'react';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource from '@/lib/useFacilityResource';
import {apiRows,objectId,reviewError} from '@/lib/facilityReview';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import inspectionApi from '@/api/inspectionApi';
import deskApi from '@/api/serviceDeskApi';
import {deskList} from '@/lib/serviceDeskReview';
import {boardTypes,facilityDay,buildFacilityBoard,boardDayRows,boardAttention} from '@/lib/facilityBoard';
import {Screen,Panel,Field,Input,Select,Button,Table,OpenLink,Message,Status} from '@/components/manager/ManagerUI';

async function allTickets(kind,user,signal) {
  const rows = [], seen = new Set();
  for (let page=1; page<=100; page++) {
    const params={page,limit:100,...(kind==='support'&&user.role==='FACILITY_STAFF'?{}:{facilityId:user.assignedFacilityId})};
    const result=deskList(await deskApi.list(kind,params,{signal}),user,kind);
    if(result.pagination.page!==page)throw Error('The server returned the wrong page of tasks.');
    for(const row of result.rows)if(!seen.has(row.id)){seen.add(row.id);rows.push(row);}
    if(page>=result.pagination.totalPages)return rows;
  }
  throw Error('The list exceeds the loading limit. Open the relevant service page for full details.');
}
export default function FacilityBoardPage({manager=false,assignments=false}) {
  const {user}=useAuthSession(),role=manager?'manager':'staff';
  const [day,setDay]=useState(()=>facilityDay(new Date())),[type,setType]=useState(''),[staff,setStaff]=useState(''),[search,setSearch]=useState('');
  const permitted=objectId(user?.assignedFacilityId)&&user?.role===(manager?'FACILITY_MANAGER':'FACILITY_STAFF');
  const load=useCallback(async signal=>{
    const data={},errors=[];
    // Independent sources are isolated: one unavailable service never looks like an empty facility.
    const sources=[['reservations',()=>facilityReservationApi.list(user.assignedFacilityId,{signal}).then(apiRows)],['inspections',()=>inspectionApi.list({}, {signal}).then(apiRows)],['maintenance',()=>allTickets('maintenance',user,signal)],['support',()=>allTickets('support',user,signal)]];
    for(const [name,read] of sources){if(signal.aborted)throw new Error('Loading cancelled');try{data[name]=await read();}catch(e){errors.push(`${name}: ${reviewError(e)}`);data[name]=[];if(e?.response?.status===401)throw e;}}
    return {rows:buildFacilityBoard(data,user,role),errors,loadedAt:new Date().toLocaleTimeString('en-GB')};
  },[user?.id,user?.role,user?.assignedFacilityId,role]);
  const resource=useFacilityResource(load,permitted);
  useEffect(()=>{if(!permitted)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')resource.reload();},60000);return()=>clearInterval(timer);},[permitted,resource.reload]);
  const all=(resource.data?.rows||[]).filter(r=>!assignments||r.assignable),rows=boardDayRows(all,day,type,staff,search);
  const people=[...new Set(all.map(r=>r.assignee).filter(Boolean))].sort();
  const groups=[...new Set(rows.map(r=>r.assignable?r.assignee||'unassigned':'facility'))];
  return <Screen title={assignments?'Staff assignment':'Daily operations'} notice="Live data for your assigned facility. Refreshes every minute, on return to this page and after updates." action={<Button variant="outline" disabled={resource.loading} onClick={resource.reload}>Refresh tasks</Button>}>
    {!permitted?<Panel title="Access unavailable or no facility assigned"/>:<>
    <Panel title="Task scope"><p>Check-in and checkout dates follow the rental period. Inspections and requests use their creation date. Open work from earlier days is included. Maintenance and support requests do not have SLA deadlines.</p><p className="mt-2">Maintenance and support requests support staff assignment. Inspection authors are not task assignees. Open a record to assign or process it.</p></Panel>
    <Message error={resource.error}/>{resource.data?.errors.map(e=><Message key={e} error={'Incomplete data — '+e}/>)}
    {resource.loading?<p role="status">Loading tasks…</p>:<>
    <Panel title="Filters"><div className="grid gap-4 md:grid-cols-2"><Field label="View date"><Input type="date" value={day} onChange={e=>setDay(e.target.value)}/></Field><Field label="Search tasks"><Input value={search} onChange={e=>setSearch(e.target.value)}/></Field><Select label="Task type" value={type} onChange={setType} options={[['','All types'],...Object.entries(boardTypes).filter(([key])=>!assignments||['maintenance','support'].includes(key))]}/><Select label="Assigned staff" value={staff} onChange={setStaff} options={[['','All'],['unassigned','Unassigned'],...people.map(id=>[id,id])]}/></div><p className="mt-3 text-sm">{rows.length} tasks displayed · Loaded at {resource.data?.loadedAt||'—'}</p></Panel>
    {!rows.length&&<Panel title={resource.error||resource.data?.errors.length?'Insufficient data':'No matching tasks'}/>}
    {groups.map(group=><Panel key={group} title={group==='facility'?'Shared facility queue':group==='unassigned'?'Unassigned':`Staff ${group}`}><Table label={`Tasks ${group}`} rows={rows.filter(r=>(r.assignable?r.assignee||'unassigned':'facility')===group)} columns={[{key:'title',label:'Task',render:r=><OpenLink to={r.to}>{r.title}</OpenLink>},{key:'type',label:'Type',render:r=>boardTypes[r.type]},{key:'status',label:'Status',render:r=><Status value={r.status}/>},{key:'date',label:'Record date',render:r=><span>{r.date||'Not available'}<small className="block">{r.dateLabel}</small></span>},{key:'attention',label:'Attention',render:r=><span className="text-amber-800">{boardAttention(r,day)||'—'}</span>}]}/></Panel>)}
    </>}
    </>}
  </Screen>;
}
