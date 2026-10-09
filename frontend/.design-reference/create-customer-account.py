from pathlib import Path
files={}
files['src/pages/customer/ProfilePage.jsx']=r'''
import { useEffect, useState } from 'react';
import { UserRound, LockKeyhole, Pencil } from 'lucide-react';
import authApi from '@/api/authApi';
import { useCustomerData, saveDemoProfile, customerDemoEnabled } from '@/lib/customerDemoStore';
import { CustomerScreen, Field, Details, Message } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function ProfilePage(){
 const data=useCustomerData();const [profile,setProfile]=useState(data.profile);const [editing,setEditing]=useState(false);const [passwordEntry,setPasswordEntry]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
 useEffect(()=>{if(customerDemoEnabled){setProfile(data.profile);return;}let active=true;authApi.me().then(({data})=>{if(active)setProfile({...profile,...data});}).catch(()=>{if(active)setError('Unable to load your profile. Please try again later.');});return()=>{active=false;};},[data.profile]);
 const save=event=>{event.preventDefault();setError('');try{if(!profile.fullName.trim()||!profile.phone.trim())throw new Error('Full name and phone are required.');saveDemoProfile({...profile,fullName:profile.fullName.trim()});setEditing(false);setMessage('Preview profile saved in this browser. Your login credentials have not changed.');}catch(error){setError(error.message);}};
 const change=(field,value)=>setProfile(current=>({...current,[field]:value}));
 return <CustomerScreen title="My Profile" description="Manage your contact information and account preferences." action={<Button variant="orange" disabled={!customerDemoEnabled||editing} onClick={()=>{setEditing(true);setMessage('');}}><Pencil size={16}/>Edit profile</Button>}>
  <Message error={error} success={message}/><div className="grid gap-6 lg:grid-cols-[300px_1fr]"><Card><CardContent className="text-center"><div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#EAF5EE] text-[#176B3A]"><UserRound size={40}/></div><h2 className="mt-5 text-xl font-bold">{profile.fullName||'Customer'}</h2><p className="mt-2 break-all text-sm text-slate-500">{profile.email||'Profile unavailable'}</p><p className="mt-5 label text-sky-700">CUSTOMER ACCOUNT</p></CardContent></Card>
  <Card><CardContent><h2 className="text-xl font-bold">Contact details</h2>{editing?<form onSubmit={save} className="mt-6 space-y-5"><div className="grid gap-5 sm:grid-cols-2">{[['fullName','Full name','text'],['email','Email','email'],['phone','Phone','tel'],['company','Company (optional)','text'],['address','Address / contact information','text']].map(([field,label,type])=><Field key={field} id={`profile-${field}`} label={label}><Input id={`profile-${field}`} type={type} required={['fullName','email','phone'].includes(field)} value={profile[field]||''} maxLength={200} onChange={event=>change(field,event.target.value)}/></Field>)}</div><div className="flex flex-wrap gap-3"><Button type="submit" variant="orange">Save preview profile</Button><Button type="button" variant="outline" onClick={()=>{setEditing(false);setProfile(data.profile);setError('');}}>Cancel</Button></div></form>:<div className="mt-6"><Details values={[["Full name",profile.fullName],["Email",profile.email],["Phone",profile.phone],["Address",profile.address||'Not provided'],['Company',profile.company||'Not provided']]}/></div>}</CardContent></Card></div>
  <Card><CardContent><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-bold">Account security</h2><p className="mt-2 text-sm text-slate-500">Password management uses your existing authentication service.</p></div><Button variant="outline" onClick={()=>setPasswordEntry(value=>!value)} aria-expanded={passwordEntry}><LockKeyhole size={16}/>Change password</Button></div>{passwordEntry&&<div className="soft-panel mt-5 p-5"><p className="text-sm">Password updates are not available in the current auth API. This entry is ready to connect when that endpoint is supported.</p><Button disabled variant="outline" className="mt-4">Password update unavailable</Button></div>}</CardContent></Card>
 </CustomerScreen>;
}
'''
files['src/pages/customer/PaymentHistoryPage.jsx']=r'''
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ReceiptText } from 'lucide-react';
import { useCustomerData, customerDemoEnabled, timestampLabel } from '@/lib/customerDemoStore';
import { formatMoney } from '@/lib/booking';
import { CustomerScreen, StatusBadge, EmptyState, Details, Select } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export default function PaymentHistoryPage(){
 const data=useCustomerData();const [query,setQuery]=useState('');const [status,setStatus]=useState('All');const [params,setParams]=useSearchParams();
 const payments=useMemo(()=>{const saved=[];if(customerDemoEnabled){for(let index=0;index<sessionStorage.length;index++){const key=sessionStorage.key(index);if(!key?.startsWith('payment_'))continue;try{const payment=JSON.parse(sessionStorage.getItem(key));if(payment?.id)saved.push({...payment,reference:payment.reference||payment.id,rentalId:payment.rentalId||payment.reservationId,type:payment.type||'Reservation payment',date:payment.paidAt||payment.createdAt});}catch{/* Ignore malformed old demo payments. */}}}return [...saved,...data.payments.filter(payment=>!saved.some(savedPayment=>savedPayment.id===payment.id))];},[data.payments]);
 const filtered=payments.filter(payment=>(status==='All'||payment.status===status)&&[payment.id,payment.reference,payment.rentalId,payment.contract,payment.type].join(' ').toLowerCase().includes(query.toLowerCase()));
 const selected=payments.find(payment=>payment.id===params.get('receipt'));
 return <CustomerScreen title="Payments & Receipts" description="Track your payment history, rental invoices and financial adjustments.">
  <div className="grid gap-4 sm:grid-cols-[1fr_220px]"><Input aria-label="Search payments" placeholder="Search payment reference, rental or contract…" value={query} onChange={event=>setQuery(event.target.value)}/><Select label="Payment status" value={status} onChange={event=>setStatus(event.target.value)} options={['All','PAID','PENDING','FAILED','REFUNDED']}/></div>
  {selected&&<Card><CardContent><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-bold"><ReceiptText className="mr-2 inline" size={22}/>{selected.status==='PAID'?'Payment receipt':'Payment details'}</h2><Button variant="ghost" onClick={()=>setParams({})}>Close detail</Button></div><div className="mt-5"><Details values={[["Reference",selected.reference],["Payment ID",selected.id],["Rental / reservation",selected.rentalId],["Contract",selected.contract||'Not provided'],["Payment type",selected.type],["Amount",`${formatMoney(selected.amount)} VND`],["Status",<StatusBadge status={selected.status}/>],["Payment date",timestampLabel(selected.date)],["Provider",selected.provider||'Not provided']]}/></div>{selected.status!=='PAID'&&<p className="mt-5 text-sm text-slate-500">A settled receipt is available only after payment is completed.</p>}</CardContent></Card>}
  {params.has('receipt')&&!selected&&<EmptyState title="Payment not found" description="This receipt is not available in the current customer workspace."/>}
  {filtered.length?<Card><div className="customer-table-scroll"><table className="customer-table"><caption className="sr-only">Customer payment history</caption><thead><tr>{['Reference / rental','Type','Amount','Status','Date','Provider','Detail'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map(payment=><tr key={payment.id}><td><b>{payment.reference}</b><div className="mt-1 text-xs text-slate-500">{payment.rentalId}<br/>{payment.contract}</div></td><td>{payment.type}</td><td className="font-bold">{formatMoney(payment.amount)} VND</td><td><StatusBadge status={payment.status}/></td><td>{timestampLabel(payment.date)}</td><td>{payment.provider||'—'}</td><td><Button variant="outline" size="sm" onClick={()=>setParams({receipt:payment.id})}>{payment.status==='PAID'?'View receipt':'View detail'}</Button></td></tr>)}</tbody></table></div></Card>:<EmptyState title="No payments found" description="Try another search or status filter. Payment history will appear here when available."/>}
  <Card><CardContent><h2 className="text-xl font-bold">Refunds & additional charges</h2><p className="mt-2 text-sm text-slate-500">Review adjustment status and any additional payment requirements.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{data.refunds.map(item=><Link className="soft-panel p-4" key={item.id} to={`/portal/refunds/${item.id}`}><b>{item.reference} · Refund</b><div className="mt-2 flex flex-wrap justify-between gap-2"><span>{formatMoney(item.amount)} VND</span><StatusBadge status={item.status}/></div></Link>)}{data.charges.map(item=><Link className="soft-panel p-4" key={item.id} to={`/portal/charges/${item.id}`}><b>{item.reference} · {item.type}</b><div className="mt-2 flex flex-wrap justify-between gap-2"><span>{formatMoney(item.amount)} VND</span><StatusBadge status={item.status}/></div></Link>)}</div>{!data.refunds.length&&!data.charges.length&&<p className="mt-4 text-sm text-slate-500">No financial adjustments to display.</p>}</CardContent></Card>
 </CustomerScreen>;
}
'''
files['src/pages/customer/NotificationsPage.jsx']=r'''
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useCustomerData, customerDemoEnabled, markDemoNotification, markAllDemoNotifications, timestampLabel } from '@/lib/customerDemoStore';
import { CustomerScreen, EmptyState, Select, Message } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
export default function NotificationsPage(){
 const data=useCustomerData();const [filter,setFilter]=useState('All');const [category,setCategory]=useState('All categories');const [error,setError]=useState('');
 const unread=data.notifications.filter(item=>!item.read).length;
 const visible=data.notifications.filter(item=>(filter==='All'||!item.read)&&(category==='All categories'||item.category===category)).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
 const act=fn=>{try{fn();setError('');}catch(error){setError(error.message);}};
 return <CustomerScreen title="Notifications" description="Reservation, payment, rental and inventory updates in one place." action={<Button variant="orange" disabled={!customerDemoEnabled||!unread} onClick={()=>act(markAllDemoNotifications)}><CheckCheck size={16}/>Mark all as read</Button>}>
  <Message error={error}/><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex gap-2">{['All','Unread'].map(value=><Button key={value} variant={filter===value?'default':'outline'} onClick={()=>setFilter(value)} aria-pressed={filter===value}>{value}{value==='Unread'?` (${unread})`:''}</Button>)}</div><div className="w-full sm:w-64"><Select label="Notification category" value={category} onChange={event=>setCategory(event.target.value)} options={['All categories',...new Set(data.notifications.map(item=>item.category))]}/></div></div>
  {visible.length?<div className="space-y-3">{visible.map(item=><Card key={item.id} className={!item.read?'border-l-4 border-l-[#F28C28]':''}><CardContent><div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-sky-700"><Bell size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><Badge variant="sky">{item.category}</Badge>{!item.read&&<Badge variant="orange">UNREAD</Badge>}<time className="text-xs text-slate-500" dateTime={item.timestamp}>{timestampLabel(item.timestamp)}</time></div><h2 className="mt-3 text-lg font-bold">{item.title}</h2><p className="mt-2 text-sm text-slate-500">{item.message}</p><div className="mt-4 flex flex-wrap gap-3"><Button asChild variant="outline" size="sm"><Link to={item.href}>View update</Link></Button>{!item.read&&<Button variant="ghost" size="sm" disabled={!customerDemoEnabled} onClick={()=>act(()=>markDemoNotification(item.id))}>Mark as read</Button>}</div></div></div></CardContent></Card>)}</div>:<EmptyState title="You're all caught up" description="There are no notifications matching this filter."/>}
 </CustomerScreen>;
}
'''
for path,content in files.items():Path(path).write_text(content.strip()+'\n',encoding='utf-8')
