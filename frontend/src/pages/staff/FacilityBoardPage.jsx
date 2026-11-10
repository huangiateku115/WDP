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
    if(result.pagination.page!==page)throw Error("Máy chủ trả sai trang công việc.");
    for(const row of result.rows)if(!seen.has(row.id)){seen.add(row.id);rows.push(row);}
    if(page>=result.pagination.totalPages)return rows;
  }
  throw Error("Danh sách vượt giới hạn tải. Mở trang nghiệp vụ tương ứng để xem đầy đủ.");
}
export default function FacilityBoardPage({manager=false,assignments=false}) {
  const {user}=useAuthSession(),role=manager?'manager':'staff';
  const [day,setDay]=useState(()=>facilityDay(new Date())),[type,setType]=useState(''),[staff,setStaff]=useState(''),[search,setSearch]=useState('');
  const permitted=objectId(user?.assignedFacilityId)&&user?.role===(manager?'FACILITY_MANAGER':'FACILITY_STAFF');
  const load=useCallback(async signal=>{
    const data={},errors=[];
    // Independent sources are isolated: one unavailable service never looks like an empty facility.
    const sources=[['reservations',()=>facilityReservationApi.list(user.assignedFacilityId,{signal}).then(apiRows)],['inspections',()=>inspectionApi.list({}, {signal}).then(apiRows)],['maintenance',()=>allTickets('maintenance',user,signal)],['support',()=>allTickets('support',user,signal)]];
    for(const [name,read] of sources){if(signal.aborted)throw new Error("Đã hủy tải");try{data[name]=await read();}catch(e){errors.push(`${name}: ${reviewError(e)}`);data[name]=[];if(e?.response?.status===401)throw e;}}
    return {rows:buildFacilityBoard(data,user,role),errors,loadedAt:new Date().toLocaleTimeString('vi-VN')};
  },[user?.id,user?.role,user?.assignedFacilityId,role]);
  const resource=useFacilityResource(load,permitted);
  useEffect(()=>{if(!permitted)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')resource.reload();},60000);return()=>clearInterval(timer);},[permitted,resource.reload]);
  const all=(resource.data?.rows||[]).filter(r=>!assignments||r.assignable),rows=boardDayRows(all,day,type,staff,search);
  const people=[...new Set(all.map(r=>r.assignee).filter(Boolean))].sort();
  const groups=[...new Set(rows.map(r=>r.assignable?r.assignee||'unassigned':'facility'))];
  return <Screen title={assignments?"Phân công nhân viên":"Công việc hằng ngày"} notice="Dữ liệu trực tiếp của cơ sở. Tự tải lại mỗi phút, khi quay lại trang và sau cập nhật." action={<Button variant="outline" disabled={resource.loading} onClick={resource.reload}>Tải lại công việc</Button>}>
    {!permitted?<Panel title="Không có quyền hoặc chưa được phân công cơ sở"/>:<>
    <Panel title="Phạm vi công việc"><p>Ngày nhận và trả kho theo kỳ thuê. Biên bản và yêu cầu dùng ngày tạo. Bao gồm việc còn mở từ ngày trước. Phiếu bảo trì và hỗ trợ chưa có thời hạn cam kết xử lý.</p><p className="mt-2">Phiếu bảo trì và hỗ trợ có thể phân công nhân viên. Người lập biên bản không tự động là người được giao việc. Mở hồ sơ để phân công hoặc xử lý.</p></Panel>
    <Message error={resource.error}/>{resource.data?.errors.map(e=><Message key={e} error={'Incomplete data — '+e}/>)}
    {resource.loading?<p role="status">Đang tải công việc…</p>:<>
    <Panel title="Bộ lọc"><div className="grid gap-4 md:grid-cols-2"><Field label="Ngày xem"><Input type="date" value={day} onChange={e=>setDay(e.target.value)}/></Field><Field label="Tìm công việc"><Input value={search} onChange={e=>setSearch(e.target.value)}/></Field><Select label="Loại công việc" value={type} onChange={setType} options={[['',"Tất cả loại"],...Object.entries(boardTypes).filter(([key])=>!assignments||['maintenance','support'].includes(key))]}/><Select label="Nhân viên được giao" value={staff} onChange={setStaff} options={[['',"Tất cả"],['unassigned',"Chưa phân công"],...people.map(id=>[id,id])]}/></div><p className="mt-3 text-sm">{rows.length} công việc được hiển thị · Tải lúc {resource.data?.loadedAt||'—'}</p></Panel>
    {!rows.length&&<Panel title={resource.error||resource.data?.errors.length?"Chưa đủ dữ liệu":"Không có công việc phù hợp"}/>}
    {groups.map(group=><Panel key={group} title={group==='facility'?"Hàng chờ chung của cơ sở":group==='unassigned'?"Chưa phân công":`Nhân viên ${group}`}><Table label={`Tasks ${group}`} rows={rows.filter(r=>(r.assignable?r.assignee||'unassigned':'facility')===group)} columns={[{key:'title',label:"Công việc",render:r=><OpenLink to={r.to}>{r.title}</OpenLink>},{key:'type',label:"Loại",render:r=>boardTypes[r.type]},{key:'status',label:"Trạng thái",render:r=><Status value={r.status}/>},{key:'date',label:"Ngày ghi nhận",render:r=><span>{r.date||"Chưa có dữ liệu"}<small className="block">{r.dateLabel}</small></span>},{key:'attention',label:"Lưu ý",render:r=><span className="text-amber-800">{boardAttention(r,day)||'—'}</span>}]}/></Panel>)}
    </>}
    </>}
  </Screen>;
}
