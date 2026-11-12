import CustomerOutboundPage from '@/components/customer/inventory/CustomerOutbound';
import CanonicalCustomerOutbound from '@/components/customer/inventory/CanonicalCustomerOutbound';
import ManagedInboundRequest from '@/components/customer/inventory/ManagedInboundRequest';
import {validInventoryId} from '@/lib/inventoryRegistration';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCustomerData, customerDemoEnabled, requestDemoMovement, reservedInboundVolume, formatVolume, locationLabel } from '@/lib/customerDemoStore';
import { CustomerScreen, EmptyState, Field, Details, CapacitySummary, Message, StatusBadge } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
export default function InventoryMovementRequestPage({type}){
 const {id}=useParams();
 if(type==='OUTBOUND')return <CustomerOutboundPage id={id} outboundAction={CanonicalCustomerOutbound}/>;
 if(type==='INBOUND'&&validInventoryId(id))return <CustomerScreen title="Tự nhập hàng" description="Self-Inbound V3 sẽ được mở sau khi hoàn tất kiểm soát truy cập và ghi sổ tồn kho."><ManagedInboundRequest id={id}/></CustomerScreen>;
 return <DemoMovementRequest type={type}/>;
}
function DemoMovementRequest({type}){
 const {id}=useParams();const data=useCustomerData();const item=data.items.find(item=>item.id===id);const rental=data.rentals.find(rental=>rental.id===item?.rentalId);const [notes,setNotes]=useState('');const [confirmed,setConfirmed]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');const inbound=type==='INBOUND';
 if(!item||!rental||rental.model!=='MANAGED_INVENTORY')return <CustomerScreen title={`Request ${inbound?'inbound':'outbound'}`} description="Staff-managed inventory movement."><EmptyState title="Item not found" description="Select an item in your Managed Inventory rental." to="/portal/inventory" label="My Inventory"/></CustomerScreen>;
 const pending=data.requests.find(request=>request.itemId===id&&request.status==='PENDING');const waitingVolume=reservedInboundVolume(rental.id);const total=item.volume_m3*item.quantity;const projected=rental.used_capacity_m3+waitingVolume+(pending?.type==='INBOUND'?0:total);const available=item.status===(inbound?'Registered':'InStorage')&&rental.status==='ACTIVE';const exceeds=inbound&&projected>rental.allocated_capacity_m3+1e-9;
 const submit=event=>{event.preventDefault();setError('');try{if(!confirmed)throw new Error('Confirm the request before submitting.');requestDemoMovement(id,type,notes);setSuccess(`Preview ${inbound?'inbound':'outbound'} request received. Staff will review and complete the movement.`);setConfirmed(false);}catch(error){setError(error.message);}};
 return <CustomerScreen title={`Request ${inbound?'inbound':'outbound'}`} description={inbound?'Send registered goods to the facility team for storage.':'Ask the facility team to release your stored goods.'} action={<Button asChild variant="outline"><Link to={`/portal/inventory/${id}`}>Item details</Link></Button>}>
  <Card><CardContent><h2 className="text-xl font-bold">{item.name}</h2><div className="mt-5"><Details values={[["Item code",item.code],["Quantity",`${item.quantity} ${item.unit}`],["Item status",<StatusBadge status={item.status}/>],["Total item volume",formatVolume(total)],["Managed rental",rental.id],...(!inbound?[["Current Zone / Rack / Shelf",locationLabel(item.current_location)]]:[])]}/></div></CardContent></Card>
  {inbound&&<CapacitySummary rental={rental} pending={waitingVolume} projected={projected}/>}
  <Message error={error} success={success}/>{pending&&<div className="soft-panel p-5"><b>{pending.type} request pending review</b><p className="mt-2 break-words text-sm text-slate-500">{pending.id}</p></div>}{!available&&<p role="alert" className="rounded-xl bg-orange-50 p-4 text-sm text-orange-800">{inbound?'Inbound requires a Registered item.':'Outbound requires an InStorage item.'} The managed rental must be active.</p>}{exceeds&&!pending&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Insufficient allocated capacity. <Link className="font-bold underline" to={`/portal/rentals/${rental.id}/extend`}>Request additional capacity</Link> before inbound.</p>}
  <Card><CardContent><form onSubmit={submit} className="space-y-5"><Field id="movement-notes" label="Request information / instructions" hint={inbound?'Staff assigns the Shelf after accepting the inbound request.':'Include collection preferences or handling instructions for Staff.'}><textarea id="movement-notes" className="customer-textarea" maxLength={1000} value={notes} onChange={event=>{setNotes(event.target.value);setConfirmed(false);}} disabled={Boolean(pending)||!available}/></Field><label htmlFor="confirm-movement" className="flex cursor-pointer items-start gap-3 text-sm"><Checkbox id="confirm-movement" checked={confirmed} onCheckedChange={value=>setConfirmed(value===true)} disabled={Boolean(pending)||!available||exceeds}/><span>I confirm this {inbound?'inbound':'outbound'} request and understand that Staff must review and complete the movement.</span></label><Button type="submit" variant="orange" disabled={!customerDemoEnabled||!available||exceeds||Boolean(pending)||!confirmed}>Submit {inbound?'inbound':'outbound'} request</Button></form></CardContent></Card>
 </CustomerScreen>;
}

