from pathlib import Path
files={}
files['src/pages/customer/RentalExtensionPage.jsx']=r'''
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCustomerData, customerDemoEnabled, requestDemoExtension, formatVolume } from '@/lib/customerDemoStore';
import { endDate, formatDate, formatMoney, localToday } from '@/lib/booking';
import { CustomerScreen, EmptyState, Field, Details, Select, Message, CapacitySummary } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
const daysBetween=(a,b)=>Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000);
export default function RentalExtensionPage(){
 const {id}=useParams();const data=useCustomerData();const rental=data.rentals.find(item=>item.id===id);
 const [branch,setBranch]=useState('TIME');const [period,setPeriod]=useState('1');const [newEnd,setNewEnd]=useState(endDate(rental?.endDate||localToday(),1));const [additional,setAdditional]=useState('1');const [notes,setNotes]=useState('');const [error,setError]=useState('');const [success,setSuccess]=useState('');
 if(!rental)return <CustomerScreen title="Rental extension" description="Extend an existing rental or request managed capacity."><EmptyState title="Rental not found" description="Open this screen from a rental in your customer workspace." to="/portal"/></CustomerScreen>;
 const managed=rental.model==='MANAGED_INVENTORY';const pending=data.requests.find(request=>request.rentalId===id&&request.type===(branch==='TIME'?'EXTENSION':'CAPACITY')&&request.status==='PENDING');
 const days=daysBetween(rental.endDate,newEnd);const remaining=Math.max(0,daysBetween(localToday(),rental.endDate));const extra=Number(additional);
 const amount=branch==='TIME'?Math.ceil(rental.monthlyRate*Math.max(0,days)/30):Math.ceil(extra*rental.capacityRatePerM3Month*remaining/30);
 const valid=branch==='TIME'?Number.isFinite(days)&&days>0:Number.isFinite(extra)&&extra>0&&extra<=1000&&remaining>0;
 const submit=event=>{event.preventDefault();setError('');setSuccess('');try{if(!valid)throw new Error('Enter a valid extension date or additional capacity.');requestDemoExtension({rentalId:id,type:branch==='TIME'?'EXTENSION':'CAPACITY',newEndDate:branch==='TIME'?newEnd:undefined,additional_capacity_m3:branch==='CAPACITY'?extra:undefined,estimatedCharge:amount,notes});setSuccess('Preview request submitted for review. The rental end date and allocated capacity update only after approval.');}catch(error){setError(error.message);}};
 return <CustomerScreen title={managed?'Extend time or capacity':'Extend your rental'} description="Review the estimate and send a request for your existing rental." action={<Button asChild variant="outline"><Link to="/portal">My Storage</Link></Button>}>
  <Card><CardContent><h2 className="text-xl font-bold">Current rental</h2><div className="mt-5"><Details values={[["Rental ID",rental.id],["Service",rental.model],["Facility",rental.facility],["Current unit",managed?'Staff-managed storage':rental.unitCode],["Current end date",formatDate(rental.endDate)],["Monthly rate",`${formatMoney(rental.monthlyRate)} VND`]]}/></div></CardContent></Card>
  {managed&&<><CapacitySummary rental={rental}/><div className="flex flex-wrap gap-3"><Button variant={branch==='TIME'?'default':'outline'} aria-pressed={branch==='TIME'} onClick={()=>{setBranch('TIME');setError('');setSuccess('');}}>Time extension</Button><Button variant={branch==='CAPACITY'?'default':'outline'} aria-pressed={branch==='CAPACITY'} onClick={()=>{setBranch('CAPACITY');setError('');setSuccess('');}}>Additional capacity</Button></div></>}
  <Message error={error} success={success}/><form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_340px]"><Card><CardContent><h2 className="text-xl font-bold">{branch==='TIME'?'Requested rental period':'Request a capacity upgrade'}</h2><div className="mt-6 space-y-5">{branch==='TIME'?<><Field id="extension-period" label="Extension period"><Select id="extension-period" value={period} onChange={event=>{setPeriod(event.target.value);setNewEnd(endDate(rental.endDate,Number(event.target.value)));}} options={[[1,'1 month'],[3,'3 months'],[6,'6 months'],[12,'12 months']]}/></Field><Field id="extension-end" label="Requested new end date"><Input id="extension-end" type="date" required min={endDate(rental.endDate,0).replace(/.*/,()=>{const date=new Date(`${rental.endDate}T12:00:00`);date.setDate(date.getDate()+1);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;})} value={newEnd} onChange={event=>setNewEnd(event.target.value)}/></Field></>:<><Details values={[["Allocated capacity",formatVolume(rental.allocated_capacity_m3)],["Used capacity",formatVolume(rental.used_capacity_m3)]]}/><Field id="additional-capacity" label="Additional capacity (m³)" hint="The request upgrades this existing managed rental; Staff reviews and allocates the capacity."><Input id="additional-capacity" type="number" step="0.001" min="0.001" max="1000" required value={additional} onChange={event=>setAdditional(event.target.value)}/></Field></>}
  <Field id="extension-notes" label="Request notes (optional)"><textarea id="extension-notes" className="customer-textarea" maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)}/></Field></div></CardContent></Card><Card className="h-fit"><CardContent><p className="label text-sky-700">ESTIMATED {branch==='TIME'?'EXTENSION':'PRORATED'} CHARGE</p><p className="price mt-3 text-3xl">{formatMoney(Number.isFinite(amount)?amount:0)} VND</p><p className="mt-4 text-xs text-slate-500">Demo estimate using a 30-day month: {branch==='TIME'?`${formatMoney(rental.monthlyRate)} VND/month × ${Math.max(0,days)||0} days ÷ 30`:`${extra||0} m³ × ${formatMoney(rental.capacityRatePerM3Month)} VND/m³/month × ${remaining} remaining days ÷ 30`}. The final charge requires approval.</p><Button className="mt-6 w-full" type="submit" variant="orange" disabled={!customerDemoEnabled||!valid||rental.status!=='ACTIVE'||Boolean(pending)}>Submit {branch==='TIME'?'extension':'capacity'} request</Button>{pending&&<p className="mt-4 text-sm text-sky-700">Request {pending.id.slice(-8)} is pending review.</p>}{rental.status!=='ACTIVE'&&<p className="mt-3 text-sm text-red-700">Only active rentals can request an extension.</p>}</CardContent></Card></form>
 </CustomerScreen>;
}
'''
files['src/pages/customer/RentalAccessPage.jsx']=r'''
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, LockKeyhole } from 'lucide-react';
import { useCustomerData } from '@/lib/customerDemoStore';
import { CustomerScreen, EmptyState, StatusBadge, Details } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export default function RentalAccessPage(){
 const {id}=useParams();const data=useCustomerData();const rental=data.rentals.find(item=>item.id===id);const [revealed,setRevealed]=useState(false);
 if(!rental)return <CustomerScreen title="Unit access" description="Self-storage access information."><EmptyState title="Rental not found" description="Choose an active Self-Storage rental in your workspace." to="/portal"/></CustomerScreen>;
 if(rental.model!=='SELF_STORAGE')return <CustomerScreen title="Managed Inventory access" description="Your inventory is handled by the facility team."><EmptyState title="Staff-managed storage" description="Zone, Rack and Shelf credentials are not issued to Managed Inventory customers. Use inbound and outbound requests to manage your items." to="/portal/inventory" label="My Inventory"/></CustomerScreen>;
 const available=rental.status==='ACTIVE'&&rental.accessStatus==='ACTIVE';
 return <CustomerScreen title="Your unit access" description="Review your facility access status and arrival instructions."><Card><CardContent><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-bold"><KeyRound className="mr-2 inline text-sky-700"/>Unit {rental.unitCode}</h2><StatusBadge status={rental.accessStatus}/></div><div className="mt-6"><Details values={[["Facility",rental.facility],["Unit code",rental.unitCode],["Rental status",<StatusBadge status={rental.status}/>],["Access status",<StatusBadge status={rental.accessStatus}/>]]}/></div></CardContent></Card>
  {available?<Card><CardContent><h2 className="text-xl font-bold"><ShieldCheck className="mr-2 inline text-sky-700"/>Simulated digital access</h2><p className="mt-3 text-sm text-slate-500">The code below is preview information and cannot open a real facility gate.</p><div className="soft-panel mt-5 flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="label text-sky-700">DEMO ACCESS CODE</p><p className="mt-2 font-mono text-2xl font-bold tracking-widest">{revealed?rental.demoPin:'•••• ••••'}</p></div><Button variant="orange" onClick={()=>setRevealed(value=>!value)} aria-expanded={revealed}>{revealed?'Hide demo code':'Reveal demo code'}</Button></div><h3 className="mt-6 font-bold">Access instructions</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>Arrive at {rental.facility} and follow posted facility rules.</li><li>Keep your rental identification ready for verification.</li><li>Use only the access method issued by the facility for Unit {rental.unitCode}.</li><li>Contact support if your access status changes or you need entry assistance.</li></ol></CardContent></Card>:<Card><CardContent><LockKeyhole className="text-orange-600" size={32}/><h2 className="mt-4 text-xl font-bold">Access unavailable</h2><p className="mt-3 text-sm text-slate-600">{rental.status!=='ACTIVE'?'Access is available only during an active Self-Storage rental.':rental.suspensionReason||'Access is suspended. Please contact support.'}</p><Button asChild variant="orange" className="mt-5"><Link to="/portal/support">Contact support</Link></Button></CardContent></Card>}
 </CustomerScreen>;
}
'''
files['src/pages/customer/FinancialDetailPage.jsx']=r'''
import { Link, useParams } from 'react-router-dom';
import { useCustomerData, timestampLabel } from '@/lib/customerDemoStore';
import { formatMoney, formatDate } from '@/lib/booking';
import { CustomerScreen, EmptyState, Details, StatusBadge } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export default function FinancialDetailPage({kind}){
 const {id}=useParams();const data=useCustomerData();const refund=kind==='refund';const record=(refund?data.refunds:data.charges).find(item=>item.id===id);
 return <CustomerScreen title={refund?'Refund details':'Additional charge'} description={refund?'Track your adjustment and refund status.':'Review extra or damage charges related to your rental.'} action={<Button asChild variant="outline"><Link to="/portal/payments">Payment history</Link></Button>}>
  {!record?<EmptyState title={refund?'Refund not found':'Charge not found'} description="The requested financial record is not available in this workspace." to="/portal/payments" label="Back to payments"/>:<><Card><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{record.reference}</h2><StatusBadge status={record.status}/></div><div className="mt-6"><Details values={[["Record ID",record.id],["Related rental",record.rentalId],["Related payment",record.paymentId||'Not provided'],["Type",refund?'Refund':record.type],["Amount",`${formatMoney(record.amount)} VND`],["Date",timestampLabel(record.date)],...(record.dueDate?[["Due date",formatDate(record.dueDate)]]:[]),["Reason",record.reason]]}/></div></CardContent></Card>{!refund&&record.status==='PAYMENT_REQUIRED'&&<Card><CardContent><h2 className="text-xl font-bold">Payment required</h2><p className="mt-3 text-sm text-slate-600">Review this charge with the facility team. Charge checkout is awaiting an API integration.</p><div className="mt-5 flex flex-wrap gap-3"><Button variant="orange" disabled>Charge checkout unavailable</Button><Button asChild variant="outline"><Link to="/portal/support">Ask about this charge</Link></Button></div></CardContent></Card>}</>}
 </CustomerScreen>;
}
'''
files['src/components/common/CustomerRentalTools.jsx']=r'''
import { Link } from 'react-router-dom';
import { useCustomerData } from '@/lib/customerDemoStore';
import { formatDate } from '@/lib/booking';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/CustomerScreen';
export default function CustomerRentalTools(){
 const {rentals}=useCustomerData();
 return <section className="mt-8"><h2 className="text-2xl font-bold">Rental requests & access</h2><p className="mt-2 text-sm text-slate-500">Preview rentals for Self-Storage and Managed Inventory. Requests are saved locally for demonstration.</p><div className="mt-5 grid gap-5 md:grid-cols-2">{rentals.map(rental=><Card key={rental.id}><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">{rental.model==='SELF_STORAGE'?`Unit ${rental.unitCode}`:'Managed Inventory'}</h3><StatusBadge status={rental.status}/></div><p className="mt-3 text-sm text-slate-500">{rental.facility} · Ends {formatDate(rental.endDate)}</p><p className="mt-2 text-xs text-slate-500">{rental.id}</p><div className="mt-5 flex flex-wrap gap-3"><Button asChild variant="orange"><Link to={`/portal/rentals/${rental.id}/extend`}>{rental.model==='SELF_STORAGE'?'Extend rental':'Time / capacity request'}</Link></Button><Button asChild variant="outline"><Link to={rental.model==='SELF_STORAGE'?`/portal/rentals/${rental.id}/access`:'/portal/inventory'}>{rental.model==='SELF_STORAGE'?'Unit access':'My Inventory'}</Link></Button></div></CardContent></Card>)}</div></section>;
}
'''
for path,content in files.items():Path(path).write_text(content.strip()+'\n',encoding='utf-8')
