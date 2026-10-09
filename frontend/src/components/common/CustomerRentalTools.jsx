import { Link } from 'react-router-dom';
import { useCustomerData, customerDemoEnabled } from '@/lib/customerDemoStore';
import { formatDate } from '@/lib/booking';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/CustomerScreen';
export default function CustomerRentalTools(){
 const {rentals}=useCustomerData();
 if(!customerDemoEnabled)return null;
 return <section className="mt-8"><h2 className="text-2xl font-bold">Rental requests & access</h2><p className="mt-2 text-sm text-slate-500">Preview rentals for Self-Storage and Managed Inventory. Requests are saved locally for demonstration.</p><div className="mt-5 grid gap-5 md:grid-cols-2">{rentals.map(rental=><Card key={rental.id}><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">{rental.model==='SELF_STORAGE'?`Unit ${rental.unitCode}`:'Managed Inventory'}</h3><StatusBadge status={rental.status}/></div><p className="mt-3 text-sm text-slate-500">{rental.facility} · Ends {formatDate(rental.endDate)}</p><p className="mt-2 text-xs text-slate-500">{rental.id}</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild variant="orange"><Link to={`/portal/rentals/${rental.id}/extend`}>{rental.model==='SELF_STORAGE'?'Extend rental':'Time / capacity request'}</Link></Button><Button asChild variant="outline"><Link to={rental.model==='SELF_STORAGE'?`/portal/rentals/${rental.id}/access`:'/portal/inventory'}>{rental.model==='SELF_STORAGE'?'Unit access':'My Inventory'}</Link></Button></div></CardContent></Card>)}</div></section>;
}
