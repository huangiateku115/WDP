import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {volumeText,canonicalRange} from '@/lib/managedCellBooking';
export default function ManagedCellSummary({reservation}){
  if(reservation?.serviceType!=='MANAGED_INVENTORY')return null;
  const ids=Array.isArray(reservation.allocatedCellIds)?reservation.allocatedCellIds.map(x=>typeof x==='string'?x:x?._id).filter(Boolean):[],snapshot=reservation.managedPricingSnapshot?.selectedCells;
  const facilityId=typeof reservation.facilityId==='string'?reservation.facilityId:reservation.facilityId?._id;
  let query='';try{const params=new URLSearchParams(canonicalRange({startDate:reservation.startDate,endDate:reservation.endDate}));const term=reservation.managedPricingSnapshot?.term;if(term){params.set('termValue',String(term.value));params.set('termUnit',term.unit);}query=params.toString();}catch{/* Older records without valid dates remain readable. */}
  return <section className="soft-panel min-w-0 p-5" aria-label="Managed allocated Cells"><h2 className="text-lg font-bold">Allocated Cells ({ids.length})</h2><p className="mt-2">Allocated capacity: {volumeText(reservation.allocatedCapacity)}</p>{!ids.length?<p className="mt-3 text-sm">This existing reservation has no selected Cell IDs returned by the server.</p>:<ul className="mt-3 grid gap-3 sm:grid-cols-2">{ids.map(id=><li key={id} className="min-w-0 break-words rounded-xl border border-green-100 bg-white p-3 text-sm"><strong>Cell ID: {id}</strong>{Array.isArray(snapshot)&&snapshot.find(x=>x.cellId===id)&&<p>Snapshot volume: {volumeText(snapshot.find(x=>x.cellId===id).volumeM3)}</p>}</li>)}</ul>}<p className="mt-3 text-sm">Reservation allocation and payment do not confirm physical inventory occupancy. Cell labels are available on the warehouse map.</p>{/^[a-f\d]{24}$/i.test(facilityId||'')&&<Button asChild variant="outline" className="mt-4"><Link to={`/portal/warehouse-map/${facilityId}${query?`?${query}`:''}`}>View allocated Cells on map</Link></Button>}</section>;
}

