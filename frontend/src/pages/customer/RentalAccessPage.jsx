import {AccessIntegration} from '@/components/customer/RentalLifecycleIntegration';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, LockKeyhole } from 'lucide-react';
import { useCustomerData } from '@/lib/customerDemoStore';
import { CustomerScreen, EmptyState, StatusBadge, Details } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
function RentalAccessPage(){
 const {id}=useParams();const data=useCustomerData();const rental=data.rentals.find(item=>item.id===id);const [revealed,setRevealed]=useState(false);
 if(!rental)return <CustomerScreen title="Unit access" description="Self-storage access information."><EmptyState title="Rental not found" description="Choose an active Self-Storage rental in your workspace." to="/portal"/></CustomerScreen>;
 if(rental.model!=='SELF_STORAGE')return <CustomerScreen title="Managed Inventory access" description="Your inventory is handled by the facility team."><EmptyState title="Staff-managed storage" description="Zone, Rack and Shelf credentials are not issued to Managed Inventory customers. Use inbound and outbound requests to manage your items." to="/portal/inventory" label="My Inventory"/></CustomerScreen>;
 const available=rental.status==='ACTIVE'&&rental.accessStatus==='ACTIVE';
 return <CustomerScreen title="Your unit access" description="Review your facility access status and arrival instructions."><Card><CardContent><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-bold"><KeyRound className="mr-2 inline text-sky-700"/>Unit {rental.unitCode}</h2><StatusBadge status={rental.accessStatus}/></div><div className="mt-6"><Details values={[["Facility",rental.facility],["Unit code",rental.unitCode],["Rental status",<StatusBadge status={rental.status}/>],["Access status",<StatusBadge status={rental.accessStatus}/>]]}/></div></CardContent></Card>
  {available?<Card><CardContent><h2 className="text-xl font-bold"><ShieldCheck className="mr-2 inline text-sky-700"/>Simulated digital access</h2><p className="mt-3 text-sm text-slate-500">The code below is preview information and cannot open a real facility gate.</p><div className="soft-panel mt-5 flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="label text-sky-700">DEMO ACCESS CODE</p><p className="mt-2 font-mono text-2xl font-bold tracking-widest">{revealed?rental.demoPin:'•••• ••••'}</p></div><Button variant="orange" onClick={()=>setRevealed(value=>!value)} aria-expanded={revealed}>{revealed?'Hide demo code':'Reveal demo code'}</Button></div><h3 className="mt-6 font-bold">Access instructions</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>Arrive at {rental.facility} and follow posted facility rules.</li><li>Keep your rental identification ready for verification.</li><li>Use only the access method issued by the facility for Unit {rental.unitCode}.</li><li>Contact support if your access status changes or you need entry assistance.</li></ol></CardContent></Card>:<Card><CardContent><LockKeyhole className="text-orange-600" size={32}/><h2 className="mt-4 text-xl font-bold">Access unavailable</h2><p className="mt-3 text-sm text-slate-600">{rental.status!=='ACTIVE'?'Access is available only during an active Self-Storage rental.':rental.suspensionReason||'Access is suspended. Please contact support.'}</p><Button asChild variant="orange" className="mt-5"><Link to="/portal/support">Contact support</Link></Button></CardContent></Card>}
 </CustomerScreen>;
}

// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default AccessIntegration;
