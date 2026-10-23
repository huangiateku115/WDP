import {Navigate} from 'react-router-dom';
import {getAccessToken} from '@/lib/authSession';
import {localToday} from '@/lib/booking';
import {useRef,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import facilityApi from '@/api/facilityApi';
import storageApi from '@/api/storageApi';
import {pricingApi} from '@/api/customerRentalApi';
import {useReservation} from '@/contexts/ReservationContext';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import Steps from '@/components/common/Steps';
import {BackendScreen,Card,CardContent,Button,Details,Message,Link,useBackend,LoadState,rows,record,recordId,validId,addressText,rentalError} from './RentalBackendUI';

export {PublicFacilityBrowser as FacilityBrowser} from './PublicFacilityCatalog';

export function StorageSelection(){const [params]=useSearchParams();return params.get('service')==='managed'?<Navigate replace to={validId(params.get('facility'))?'/portal/warehouse-map/'+params.get('facility'):'/portal/warehouse-map'}/>:<SelfStorageSelection/>;}
function SelfStorageSelection(){
 const nav=useNavigate(),[query]=useSearchParams(),{rentalDraft,updateRentalDraft}=useReservation();
 const [facilityId,setFacilityId]=useState(query.get('facility')||recordId(rentalDraft.facility)||''),[page,setPage]=useState(1),[pending,setPending]=useState(false),[error,setError]=useState(''),busy=useRef(false);
 const facilities=useBackend(async config=>{const all=[];let page=1,totalPages=1;do{const response=await facilityApi.publicList({...config,params:{page,limit:100}});all.push(...rows(response));totalPages=response.data.pagination?.totalPages??1;if(!Number.isInteger(totalPages)||totalPages<0)throw Error('Invalid Facility pagination.');page++;}while(page<=totalPages);return all.filter(f=>Array.isArray(f.serviceTypes)&&f.serviceTypes.includes('SELF_STORAGE')&&(f.status==null||f.status==='ACTIVE'));},[],true);
 const detail=useBackend(config=>validId(facilityId)?facilityApi.publicDetail(facilityId,config).then(record):Promise.resolve(null),[facilityId],true);
 const options=useBackend(async config=>{if(!validId(facilityId))return null;const [options,pricing]=await Promise.all([facilityApi.publicOptions(facilityId,config),facilityApi.publicPricing(facilityId,config)]);return {options:options.data?.success===true,pricing:pricing.data?.success===true};},[facilityId],true);
 const eligible=recordId(detail.data)===facilityId&&Array.isArray(detail.data?.serviceTypes)&&detail.data.serviceTypes.includes('SELF_STORAGE')&&(detail.data.status==null||detail.data.status==='ACTIVE');
 const units=useBackend(async config=>{if(!validId(facilityId)||!eligible)return null;const response=await storageApi.listUnits(facilityId,{...config,params:{page,limit:20}});return {units:rows(response),pagination:response.data.pagination};},[facilityId,page,eligible]);
 async function select(unit){if(busy.current)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();try{const fresh=record(await storageApi.unitDetail(recordId(unit)));if(getAccessToken()!==token)return;if(!validId(recordId(fresh))||recordId(fresh.facilityId)!==facilityId||fresh.status!=='AVAILABLE')throw Error('This storage unit is no longer available at the selected facility. Refresh the list.');if(!eligible)throw Error('Facility details must load before selecting a unit.');updateRentalDraft({facility:detail.data,unit:fresh,quote:null,startDate:'',endDate:'',term:null});nav('/portal/rent/period');}catch(e){setError(rentalError(e));}finally{busy.current=false;setPending(false);}}
 return <BackendScreen title="Choose your Self Storage" description="Select a facility and storage unit for your rental."><Steps current={1}/><LoadState resource={facilities}/><label className="block field-label">Selected Facility<select aria-label="Facility" className="customer-select mt-2" value={facilityId} disabled={pending} onChange={e=>{setFacilityId(e.target.value);setPage(1);setError('');}}><option value="">Choose a facility</option>{facilities.data?.map(f=><option key={recordId(f)} value={recordId(f)}>{f.name}</option>)}</select></label>{detail.data&&<Card><CardContent><h2 className="font-bold">{detail.data.name}</h2><p>{addressText(detail.data.address)}</p></CardContent></Card>}<LoadState resource={detail}/><LoadState resource={options}/>{options.data&&<p className="text-sm text-slate-500">Public options/pricing retrieved. Reservation selection below uses authenticated unit records only.</p>}<LoadState resource={units}/>{detail.data&&!eligible&&<Message error="This facility does not support Self Storage. Choose an eligible Self Storage facility."/>}<Message error={error}/><div className="space-y-4">{units.data?.units.map(u=><Card key={recordId(u)}><CardContent><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-bold">{u.unitCode}</h2><p className="mt-2 text-sm">{u.size} · {u.volumeM3!=null?`${u.volumeM3} m³`:''} · {u.status}</p>{u.description&&<p className="mt-2 text-sm">{u.description}</p>}</div><Button disabled={pending||u.status!=='AVAILABLE'||!validId(recordId(u))||!eligible} onClick={()=>select(u)}>{pending?'Checking unit…':'Select Unit'}</Button></div></CardContent></Card>)}</div>{units.data?.units.length===0&&<p>No storage units returned for this facility.</p>}{units.data?.pagination&&<div className="flex gap-3"><Button variant="outline" disabled={page<=1||pending} onClick={()=>setPage(p=>p-1)}>Previous units</Button><span>Page {page}</span><Button variant="outline" disabled={page>=units.data.pagination.totalPages||pending} onClick={()=>setPage(p=>p+1)}>Next units</Button></div>}</BackendScreen>;
}

export {default as RentalPeriodIntegration} from './RentalPeriodIntegration';

export {default as ReservationReviewIntegration} from './SelfStorageReservationReview';
