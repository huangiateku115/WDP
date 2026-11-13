import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {volumeText,canonicalRange} from '@/lib/managedCellBooking';
export default function ManagedCellSummary({reservation,cellLabels}){
  if(reservation?.serviceType!=='MANAGED_INVENTORY')return null;
  const ids=Array.isArray(reservation.allocatedCellIds)?reservation.allocatedCellIds.map(x=>typeof x==='string'?x:x?._id).filter(Boolean):[],snapshot=reservation.managedPricingSnapshot?.selectedCells;
  const facilityId=typeof reservation.facilityId==='string'?reservation.facilityId:reservation.facilityId?._id;
  let query='';try{const params=new URLSearchParams(canonicalRange({startDate:reservation.startDate,endDate:reservation.endDate}));const term=reservation.managedPricingSnapshot?.term;if(term){params.set('termValue',String(term.value));params.set('termUnit',term.unit);}query=params.toString();}catch{/* Older records without valid dates remain readable. */}
  const customerView=cellLabels!==undefined;
  return <section className={customerView?'min-w-0 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 via-white to-orange-50/50 p-5 shadow-sm':'soft-panel min-w-0 p-5'} aria-label={customerView?'Các ô kệ được phân bổ':'Managed allocated Cells'}>
    <h2 className="text-lg font-bold text-emerald-950">{customerView?'Ô kệ được phân bổ':`Allocated Cells (${ids.length})`}</h2>
    <p className="mt-2">{customerView?'Sức chứa của đơn thuê:':'Allocated capacity:'} {volumeText(reservation.allocatedCapacity)}{customerView&&ids.length>0?` · ${ids.length} ô kệ`:''}</p>
    {!ids.length?<p className="mt-3 text-sm">{customerView?'Đơn thuê hiện chưa trả về danh sách ô kệ được phân bổ.':'This existing reservation has no selected Cell IDs returned by the server.'}</p>:<ul className="mt-3 grid gap-3 sm:grid-cols-2">{ids.map((id,index)=><li key={id} className="min-w-0 rounded-xl border border-emerald-100 bg-white p-4 text-sm shadow-sm"><strong>{customerView?cellLabels[id]||`Ô kệ ${index+1} (đang tải tên vị trí)`:`Cell ID: ${id}`}</strong>{Array.isArray(snapshot)&&snapshot.find(x=>x.cellId===id)&&<p className="mt-1 text-slate-600">{customerView?'Thể tích trong báo giá:':'Snapshot volume:'} {volumeText(snapshot.find(x=>x.cellId===id).volumeM3)}</p>}</li>)}</ul>}
    <p className="mt-3 text-sm text-slate-600">{customerView?'Phân bổ trong đơn thuê chưa xác nhận hàng đã được nhập thực tế.':'Reservation allocation and payment do not confirm physical inventory occupancy. Cell labels are available on the warehouse map.'}</p>
    {/^[a-f\d]{24}$/i.test(facilityId||'')&&<Button asChild variant="outline" className="mt-4"><Link to={`/portal/warehouse-map/${facilityId}${query?`?${query}`:''}`}>{customerView?'Xem vị trí trên sơ đồ kho':'View allocated Cells on map'}</Link></Button>}
  </section>;
}

