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
