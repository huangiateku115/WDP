import {useState} from 'react';
import facilityApi from '@/api/facilityApi';
import {CustomerScreen,Card,CardContent,Button,Link,LoadState,useBackend,rows,recordId,validId,addressText} from '@/components/customer/RentalBackendUI';
import WarehouseBreadcrumbs from '@/components/customer/WarehouseBreadcrumbs';

export default function WarehouseFacilitySelectionPage() {
  const [page,setPage] = useState(1);
  const facilities = useBackend(async config => {
    const response = await facilityApi.publicList({...config,params:{serviceType:'MANAGED_INVENTORY',page,limit:6}});
    const items = rows(response);
    if (items.some(f=>!f || typeof f!=='object' || !validId(recordId(f)) || typeof f.name!=='string' || (f.serviceTypes!==undefined&&!Array.isArray(f.serviceTypes)))) throw Error('The facility response is invalid. Please retry.');
    const pagination = response.data.pagination;
    if (pagination && (!Number.isInteger(pagination.totalPages) || pagination.totalPages<0)) throw Error('The facility pagination response is invalid. Please retry.');
    return {items:items.filter(f=>(f.status===undefined || f.status==='ACTIVE') && (f.serviceTypes===undefined || f.serviceTypes.includes('MANAGED_INVENTORY'))),pagination};
  },[page]);
  return <CustomerScreen title="Warehouse Map" description="Explore warehouse layouts and rack capacity at our managed inventory facilities." notice="Read-only MI-01 warehouse layouts. No existing reservation is required; cell reservations and actual inventory occupancy are not available.">
    <WarehouseBreadcrumbs/><LoadState resource={facilities}/>
    <div className="grid gap-5 md:grid-cols-2">{facilities.data?.items.map(f=><Card key={recordId(f)}><CardContent><h2 className="break-words text-xl font-bold">{f.name}</h2><p className="mt-3 break-words text-sm">{addressText(f.address)}</p>{f.operatingHours && <p className="mt-3 text-sm">Operating hours: {f.operatingHours}</p>}{f.serviceTypes && <p className="mt-3 break-words text-sm">{f.serviceTypes.join(' · ')}</p>}<Button asChild variant="orange" className="mt-5"><Link to={`/portal/warehouse-map/${recordId(f)}`}>View 2D Map</Link></Button></CardContent></Card>)}</div>
    {facilities.data?.items.length===0 && <p className="soft-panel rounded-xl p-5">No active managed inventory facilities are available.</p>}
    {facilities.data?.pagination && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page<=1||facilities.loading} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page} of {Math.max(1,facilities.data.pagination.totalPages)}</span><Button variant="outline" disabled={page>=facilities.data.pagination.totalPages||facilities.loading} onClick={()=>setPage(p=>p+1)}>Next</Button></div>}
  </CustomerScreen>;
}
