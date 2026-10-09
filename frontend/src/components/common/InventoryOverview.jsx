import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, PackageOpen } from 'lucide-react';
import { useCustomerData, customerDemoEnabled, formatVolume, locationLabel } from '@/lib/customerDemoStore';
import { CapacitySummary, StatusBadge, Select, EmptyState } from '@/components/common/CustomerScreen';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export default function InventoryOverview(){
 const data=useCustomerData();const [query,setQuery]=useState('');const [status,setStatus]=useState('All');const [rentalId,setRentalId]=useState('All');
 const rentals=data.rentals.filter(item=>item.model==='MANAGED_INVENTORY');
 const items=data.items.filter(item=>[item.name,item.code,item.category].join(' ').toLowerCase().includes(query.toLowerCase())&&(status==='All'||item.status===status)&&(rentalId==='All'||item.rentalId===rentalId));
 return <div className="mt-6 space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{customerDemoEnabled?'Demo inventory · Requests wait for Staff review.':'Customer inventory API integration pending.'}</p><Button asChild variant="orange"><Link to="/portal/inventory/register"><Plus size={16}/>Register inventory item</Link></Button></div>
  <div className="grid gap-4 md:grid-cols-2">{rentals.filter(rental=>rentalId==='All'||rental.id===rentalId).map(rental=><div key={rental.id}><p className="mb-2 text-xs font-bold text-slate-500">{rental.id} · {rental.facility}</p><CapacitySummary rental={rental}/></div>)}</div>
  <div className="grid gap-3 md:grid-cols-[1fr_180px_240px]"><Input aria-label="Search inventory" placeholder="Search item name, code or category…" value={query} onChange={event=>setQuery(event.target.value)}/><Select label="Inventory status" value={status} onChange={event=>setStatus(event.target.value)} options={['All','Registered','InStorage','Outside']}/><Select label="Inventory rental" value={rentalId} onChange={event=>setRentalId(event.target.value)} options={[["All","All managed rentals"],...rentals.map(rental=>[rental.id,rental.id])]}/></div>
  {items.length?<Card><div className="customer-table-scroll"><table className="customer-table"><caption className="sr-only">Managed inventory items</caption><thead><tr>{['Item','Quantity','Total volume','Status','Current location','Action'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item=><tr key={item.id}><td><b>{item.name}</b><div className="mt-1 text-xs text-slate-500">{item.code} · {item.category}</div></td><td>{item.quantity} {item.unit}</td><td>{formatVolume(item.volume_m3*item.quantity)}</td><td><StatusBadge status={item.status}/>{data.requests.some(request=>request.itemId===item.id&&request.status==='PENDING')&&<div className="mt-2 text-xs text-orange-700">Request pending</div>}</td><td>{item.status==='InStorage'?locationLabel(item.current_location):'Not assigned'}</td><td><Button asChild variant="outline" size="sm"><Link to={`/portal/inventory/${item.id}`}>View item</Link></Button></td></tr>)}</tbody></table></div></Card>:data.items.length?<EmptyState title="No matching inventory" description="Try another item name, status or managed rental."/>:null}
  <p className="flex items-center gap-2 text-xs text-slate-500"><PackageOpen size={16}/>Registering an item does not assign storage space. Staff assigns Zone / Rack / Shelf after inbound approval.</p>
 </div>;
}
