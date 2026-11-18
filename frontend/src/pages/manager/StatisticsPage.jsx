import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {managerStatisticsApi as api} from '@/api/managerStatisticsApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource from '@/lib/useFacilityResource';
import {reviewError,objectId} from '@/lib/facilityReview';
import {statisticsReports,snapshotReports,exportReports,reportFields,statisticsQuery,scopedStatistics,statisticLabel,statisticValue,reportChart} from '@/lib/managerStatistics';
import {Screen,Panel,Field,Input,Select,Button,Message,Details,Table} from '@/components/manager/ManagerUI';
import {Kpis} from '@/components/bom/BomUI';
import {facilityLabel} from '@/lib/facilityLabels';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const initialFilters=()=>({fromDate:today().slice(0,7)+'-01',toDate:today(),serviceType:'',granularity:'day',unitSize:'',status:'',paymentStatus:'',action:'',expiringWithinDays:'7',comparePrevious:false});
const excluded=key=>['page','limit','totalPages','sortBy','sortOrder'].includes(key)||/Pagination$|Reason$|NotCounted|UnavailableReason$/.test(key);
const scalar=value=>value==null||typeof value!=='object';
const display=(value,key)=>/bucketStart|At$|Date$/.test(key)&&typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):typeof value==='string'?facilityLabel(statisticValue(value)):statisticValue(value);

function DataSections({data,depth=0}){
 if(!data||typeof data!=='object'||depth>3)return null;
 return Object.entries(data).filter(([key,value])=>!excluded(key)&&value!==null&&typeof value==='object').map(([key,value])=>{
  if(Array.isArray(value)){
   if(value.every(scalar))return <section key={key}><h3 className="mb-3 font-semibold">{statisticLabel(key)}</h3><p>{value.length?value.map(item=>display(item,key)).join(', '):'Chưa có dữ liệu trong phạm vi đã chọn.'}</p></section>;
   const columns=[...new Set(value.flatMap(row=>Object.keys(row||{})))].filter(column=>!excluded(column)&&value.every(row=>scalar(row?.[column])));
   return <section key={key} className="min-w-0"><h3 className="mb-3 font-semibold">{statisticLabel(key)}</h3><Table label={statisticLabel(key)} rows={value.map((row,index)=>({...row,id:`${key}:${index}`}))} columns={columns.map(column=>({key:column,label:statisticLabel(column),render:row=>display(row[column],column)}))} empty="Chưa có dữ liệu trong phạm vi đã chọn."/>{value.some(row=>Object.values(row||{}).some(child=>child&&typeof child==='object'))&&value.map((row,index)=><div key={index} className="mt-4 rounded-lg border p-3"><DataSections data={row} depth={depth+1}/></div>)}</section>;
  }
  const values=Object.entries(value).filter(([child,entry])=>scalar(entry)&&!excluded(child));
  return <section key={key} className="space-y-4"><h3 className="font-semibold">{statisticLabel(key)}</h3>{values.length>0&&<Details values={values.map(([child,entry])=>[statisticLabel(child),display(entry,child)])}/>}<DataSections data={value} depth={depth+1}/></section>;
 });
}
function ReportChart({report,data}){
 const chart=reportChart(report,data);
 if(!chart)return null;
 const total=chart.rows.reduce((sum,row)=>sum+row.value,0),max=Math.max(0,...chart.rows.map(row=>row.value));
 const colors=['#176b3a','#f28c28','#327b9d','#8556a0','#b44b53'];
 let offset=0;
 return <Panel title={chart.title} subtitle={chart.type==='pie'?'Tỷ trọng trong tổng số của phạm vi đang xem':'So sánh trên cùng đơn vị đo'}>
  {chart.unknown?<p role="status">Chưa đủ dữ liệu xác minh để vẽ biểu đồ.</p>:total===0?<p>Chưa phát sinh số liệu trong phạm vi đã chọn.</p>:chart.type==='pie'?<div className="grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
   <svg viewBox="0 0 120 120" className="mx-auto w-full max-w-[200px]" role="img" aria-label={`${chart.title}. Tổng ${statisticValue(total)}. ${chart.rows.map(row=>`${row.label}: ${statisticValue(row.value)}`).join('; ')}`}>
    {chart.rows.map((row,index)=>{const share=row.value/total*100,start=offset;offset+=share;return <circle key={row.label} cx="60" cy="60" r="44" fill="none" stroke={colors[index%colors.length]} strokeWidth="22" pathLength="100" strokeDasharray={`${share} ${100-share}`} strokeDashoffset={-start} transform="rotate(-90 60 60)"/>;})}
    <text x="60" y="57" textAnchor="middle" fontSize="9" fill="#627168">Tổng</text><text x="60" y="71" textAnchor="middle" fontSize="12" fontWeight="700" fill="#173d28">{statisticValue(total)}</text>
   </svg>
   <ul className="space-y-3">{chart.rows.map((row,index)=><li key={row.label} className="flex flex-wrap items-center gap-2 text-sm"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded" style={{background:colors[index%colors.length]}}/><span className="min-w-0 flex-1 break-words">{row.label}</span><b>{statisticValue(row.value)}</b><span className="text-slate-500">({statisticValue(row.value/total*100)}%)</span></li>)}</ul>
  </div>:<div className="space-y-4">{chart.rows.map(row=><div key={row.label} className="grid items-center gap-2 text-sm sm:grid-cols-[minmax(100px,180px)_minmax(0,1fr)]"><span className="break-words">{row.label}</span><div className="flex min-w-0 items-center gap-3"><div className="h-6 min-w-0 flex-1 overflow-hidden rounded bg-emerald-50" aria-hidden="true"><div className="h-full rounded bg-emerald-700" style={{width:`${row.value/max*100}%`}}/></div><b className="shrink-0">{statisticValue(row.value)} {chart.unit}</b></div></div>)}</div>}
 </Panel>;
}
function Trend({data}){
 const found=Object.entries(data).find(([key,rows])=>/Trend$|ByTime$/.test(key)&&Array.isArray(rows)&&rows.length);
 if(!found)return null;
 const [name,rows]=found,metric=['collectedAmount','total','operationCount','incidentCount','customerCount','totalContracts'].find(key=>rows.some(row=>typeof row[key]==='number'));
 if(!metric)return null;
 const max=Math.max(0,...rows.map(row=>row[metric]||0));
 return <Panel title={statisticLabel(name)} subtitle={`${statisticLabel(metric)} · giờ Việt Nam`}><div className="max-h-80 space-y-3 overflow-y-auto">{rows.map((row,index)=><div key={index} className="grid grid-cols-[100px_minmax(0,1fr)_80px] items-center gap-3 text-xs"><span>{row.bucketStart?new Date(row.bucketStart).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):index+1}{row.serviceType&&<small className="block">{facilityLabel(row.serviceType)}</small>}</span><div className="h-5 overflow-hidden rounded bg-emerald-50"><div className="h-full rounded bg-emerald-700" style={{width:`${max?Math.max(0,row[metric]||0)/max*100:0}%`}}/></div><span className="text-right">{statisticValue(row[metric])}</span></div>)}</div></Panel>;
}
export default function StatisticsPage({initialReport='overview'}){
 const {user,accessToken}=useAuthSession(),[params,setParams]=useSearchParams();
 const candidate=params.get('report')||initialReport,report=statisticsReports.some(([key])=>key===candidate)?candidate:'overview';
 if(user?.role!=='FACILITY_MANAGER'||!accessToken||!objectId(user.assignedFacilityId))return <Screen title="Thống kê và báo cáo"><Panel title="Chưa có quyền truy cập"><p>Cần tài khoản quản lý được phân công cơ sở.</p></Panel></Screen>;
 return <Statistics key={`${user.id}:${user.assignedFacilityId}:${report}`} facilityId={user.assignedFacilityId} report={report} onReport={value=>setParams({report:value})}/>;
}
function Statistics({facilityId,report,onReport}){
 const [draft,setDraft]=useState(initialFilters),[applied,setApplied]=useState(initialFilters),[page,setPage]=useState(1),[error,setError]=useState(''),[exporting,setExporting]=useState('');
 const exportController=useRef(null),exportLock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;exportController.current?.abort();};},[]);
 const filtersLoad=useCallback(async signal=>{
  const body=scopedStatistics(await api.filters(facilityId,signal),facilityId);
  if(!Array.isArray(body.data.facilities)||body.data.facilities.some(row=>row.id!==facilityId))throw Error('Danh sách lọc không khớp cơ sở.');return body.data;
 },[facilityId]);
 const filterState=useFacilityResource(filtersLoad,true,{refreshOnFocus:false});
 const query=statisticsQuery(report,applied,facilityId,{page}),requestKey=JSON.stringify(query);
 const load=useCallback(async signal=>({body:scopedStatistics(await api.report(report,JSON.parse(requestKey),signal),facilityId),requestKey}),[report,requestKey,facilityId]);
 const resource=useFacilityResource(load,true,{refreshOnFocus:false}),body=resource.data?.requestKey===requestKey?resource.data.body:null;
 const snapshot=snapshotReports.includes(report),fields=reportFields(report),title=statisticsReports.find(([key])=>key===report)[1];
 const update=(key,value)=>setDraft(previous=>({...previous,[key]:value}));
 function apply(event){event.preventDefault();try{statisticsQuery(report,draft,facilityId);setError('');setApplied({...draft});setPage(1);if(JSON.stringify(draft)===JSON.stringify(applied))resource.reload();}catch(cause){setError(cause.message);}}
 async function download(format){
  if(exportLock.current||!body)return;exportLock.current=true;setExporting(format);setError('');exportController.current=new AbortController();
  try{
   const response=await api.export(format,report,statisticsQuery(report,applied,facilityId,{exporting:true}),exportController.current.signal);
   const blob=response.data;if(!(blob instanceof Blob)||/json|html/.test(blob.type))throw Error('Không nhận được tệp báo cáo hợp lệ.');
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`bao-cao-${report}-${today()}.${format}`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(cause){let message=reviewError(cause);if(cause?.response?.data instanceof Blob){try{message=JSON.parse(await cause.response.data.text()).message||message;}catch{/* Keep the request error when the server did not send JSON. */}}if(mounted.current)setError(message);}
  finally{exportLock.current=false;if(mounted.current)setExporting('');}
 }
 const values=body?Object.entries(body.data).filter(([key,value])=>!excluded(key)&&scalar(value)&&!['financialDataStatus','financialDataReason'].includes(key)):[];
 const pagination=body?.data?.operationsByItemSpecificationPagination||body?.data;
 const totalPages=Number.isInteger(pagination?.totalPages)?pagination.totalPages:Number.isInteger(pagination?.total)&&pagination?.limit?Math.ceil(pagination.total/pagination.limit):null;
 const facility=filterState.data?.facilities?.[0];
 return <div className="manager-statistics"><Screen title="Thống kê và báo cáo" description="Số liệu của cơ sở được phân công, cập nhật từ hệ thống." action={<Button variant="outline" disabled={resource.loading||!!exporting} onClick={()=>{resource.reload();filterState.reload();}}>Tải lại</Button>}>
  <Panel title="Chọn báo cáo"><div className="flex flex-wrap gap-2">{[...new Set(statisticsReports.map(row=>row[2]))].map(group=><Button key={group} variant={statisticsReports.find(([key])=>key===report)[2]===group?'default':'outline'} onClick={()=>onReport(statisticsReports.find(row=>row[2]===group)[0])}>{group}</Button>)}</div><div className="mt-5 grid items-end gap-4 sm:grid-cols-2"><Field label="Báo cáo"><Select label="Loại báo cáo thống kê" value={report} onChange={onReport} options={statisticsReports.map(([key,label])=>[key,label])}/></Field><Field label="Cơ sở"><Input readOnly value={facility?`${facility.code} · ${facility.name}`:facilityId}/></Field></div></Panel>
  <Panel title="Bộ lọc"><form onSubmit={apply} className="space-y-4"><div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
   {!snapshot&&<><Field label="Từ ngày"><Input type="date" required value={draft.fromDate} onChange={event=>update('fromDate',event.target.value)}/></Field><Field label="Đến ngày"><Input type="date" required min={draft.fromDate} value={draft.toDate} onChange={event=>update('toDate',event.target.value)}/></Field></>}
   {fields.includes('serviceType')&&<Field label="Dịch vụ"><Select label="Dịch vụ thống kê" value={draft.serviceType} onChange={value=>update('serviceType',value)} options={ [['','Tất cả dịch vụ'],['SELF_STORAGE','Thuê kho riêng'],['MANAGED_INVENTORY','Lưu trữ hàng hóa']]}/></Field>}
   {fields.includes('granularity')&&<Field label="Nhóm thời gian"><Select label="Nhóm thời gian" value={draft.granularity} onChange={value=>update('granularity',value)} options={ [['day','Ngày'],['week','Tuần'],['month','Tháng']]}/></Field>}
   {fields.includes('unitSize')&&<Field label="Kích thước kho"><Select label="Kích thước kho" value={draft.unitSize} onChange={value=>update('unitSize',value)} options={ [['','Tất cả'],['SMALL','Nhỏ'],['MEDIUM','Vừa'],['LARGE','Lớn']]}/></Field>}
   {fields.includes('status')&&<Field label="Trạng thái"><Select label="Trạng thái báo cáo" value={draft.status} onChange={value=>update('status',value)} options={ [['','Tất cả trạng thái'],...(report==='incidents'?['OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED']:['AVAILABLE','HELD','OCCUPIED','MAINTENANCE','INACTIVE']).map(value=>[value,facilityLabel(value)])]}/></Field>}
   {fields.includes('paymentStatus')&&<Field label="Thanh toán"><Select label="Trạng thái thanh toán thống kê" value={draft.paymentStatus} onChange={value=>update('paymentStatus',value)} options={ [['','Tất cả trạng thái'],...['PENDING','SUCCEEDED','FAILED','CANCELLED','RECONCILIATION_REQUIRED'].map(value=>[value,facilityLabel(value)])]}/></Field>}
   {fields.includes('action')&&<Field label="Thao tác"><Select label="Thao tác hàng hóa" value={draft.action} onChange={value=>update('action',value)} options={ [['','Tất cả'],['ADD','Nhập'],['REMOVE','Xuất'],['MOVE','Di chuyển']]}/></Field>}
   {fields.includes('expiringWithinDays')&&<Field label="Sắp hết hạn trong"><Select label="Khoảng ngày hết hạn" value={draft.expiringWithinDays} onChange={value=>update('expiringWithinDays',value)} options={ [['7','7 ngày'],['14','14 ngày'],['30','30 ngày']]}/></Field>}
   {fields.includes('comparePrevious')&&<Field label="So sánh"><Select label="So sánh kỳ trước" value={draft.comparePrevious?'true':'false'} onChange={value=>update('comparePrevious',value==='true')} options={ [['false','Không so sánh'],['true','Kỳ liền trước']]}/></Field>}
  </div>{snapshot&&<p className="text-sm text-slate-600">Ảnh chụp số liệu hiện tại; không phải mức sử dụng trong quá khứ.</p>}<Button type="submit" disabled={!!exporting}>Áp dụng bộ lọc</Button></form></Panel>
  <Message error={error||resource.error||filterState.error}/>{resource.loading&&<p role="status">Đang tải thống kê…</p>}
  {body&&<>
   <Panel title={title} action={exportReports.includes(report)&&<div className="flex flex-wrap gap-2">{['csv','xlsx','pdf'].map(format=><Button key={format} variant="outline" disabled={!!exporting||resource.loading} onClick={()=>download(format)}>{exporting===format?'Đang xuất…':`Xuất ${format.toUpperCase()}`}</Button>)}</div>}>
    <p className="text-sm text-slate-600">{snapshot?'Số liệu hiện tại':`${applied.fromDate} → ${applied.toDate} (giờ Việt Nam)`} · Cập nhật {body.meta.generatedAt||body.meta.snapshotAt?new Date(body.meta.generatedAt||body.meta.snapshotAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'theo phản hồi hệ thống'}</p>
    <p className="mt-3 text-sm text-slate-600">“Chưa có dữ liệu” không có nghĩa bằng 0.{['revenue','payments-analysis','financial-analytics'].includes(report)&&' Tiền đã thu chỉ gồm giao dịch PayOS đã xác minh; chưa thể kết luận tiền hoàn, dòng tiền ròng hoặc doanh thu ghi nhận.'}</p>
   </Panel>
   {values.length>0&&<Kpis items={values.slice(0,12).map(([key,value])=>[statisticLabel(key),display(value,key),snapshot?'Hiện tại':'Trong phạm vi báo cáo'])}/>}
   {values.length>12&&<Panel title="Chỉ số bổ sung"><Details values={values.slice(12).map(([key,value])=>[statisticLabel(key),display(value,key)])}/></Panel>}
   <ReportChart report={report} data={body.data}/>
   <Trend data={body.data}/>
   <Panel title="Chi tiết thống kê"><div className="space-y-8"><DataSections data={body.data}/></div></Panel>
   {totalPages!==null&&<div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page<=1||resource.loading} onClick={()=>setPage(value=>value-1)}>Trang trước</Button><span>Trang {page}/{Math.max(1,totalPages)} · {pagination.total??0} bản ghi</span><Button variant="outline" disabled={page>=totalPages||resource.loading} onClick={()=>setPage(value=>value+1)}>Trang sau</Button></div>}
  </>}
 </Screen></div>;
}
