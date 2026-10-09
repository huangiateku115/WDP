from pathlib import Path
files = {}
files['src/mocks/customerData.js'] = r'''
// Customer-only preview fixtures. No endpoint or authentication behavior is defined here.
export const inventoryCategories = ['Documents', 'Household goods', 'Business stock', 'Equipment'];
export const inventoryUnits = ['box', 'piece', 'carton', 'pallet'];
export const customerSeed = {
  profile: { fullName: 'Nguyen Van An', email: 'nguyen.van.an@example.com', phone: '0908 123 456', address: 'District 1, Ho Chi Minh City', company: '' },
  rentals: [
    { id: 'RNT-SELF-001', model: 'SELF_STORAGE', facility: 'SelfStorage Central Saigon', unitCode: 'A-203', status: 'ACTIVE', accessStatus: 'ACTIVE', startDate: '2026-05-19', endDate: '2026-10-19', monthlyRate: 1350000, size: 3, contract: 'VS-C-0849', demoPin: 'DEMO-4821' },
    { id: 'RNT-MANAGED-001', model: 'MANAGED_INVENTORY', facility: 'SelfStorage Central Saigon', status: 'ACTIVE', startDate: '2026-07-01', endDate: '2026-12-31', monthlyRate: 2000000, allocated_capacity_m3: 10, used_capacity_m3: 4, capacityRatePerM3Month: 200000, contract: 'VS-C-0850' },
    { id: 'RNT-SELF-002', model: 'SELF_STORAGE', facility: 'SelfStorage Thu Duc', unitCode: 'B-105', status: 'ACTIVE', accessStatus: 'SUSPENDED', startDate: '2026-08-01', endDate: '2026-11-01', monthlyRate: 1500000, size: 3, contract: 'VS-C-0851', suspensionReason: 'Access is suspended pending a billing review. Please contact support.' },
  ],
  items: [
    { id: 'INV-001', code: 'VS-INV-001', name: 'Archive cartons', description: 'Business records in sealed cartons.', category: 'Documents', quantity: 6, unit: 'carton', length: 1, width: 1, height: .5, weight: 8, volume_m3: .5, rentalId: 'RNT-MANAGED-001', status: 'InStorage', current_location: { zone:'Z-A', rack:'R-02', shelf:'S-03' } },
    { id: 'INV-002', code: 'VS-INV-002', name: 'Display equipment', description: 'Event display packed for storage.', category: 'Equipment', quantity: 1, unit: 'piece', length: 1, width: 1, height: 1, weight: 22, volume_m3: 1, rentalId:'RNT-MANAGED-001', status:'InStorage', current_location:{ zone:'Z-B', rack:'R-01', shelf:'S-02' } },
    { id: 'INV-003', code:'VS-INV-003', name:'Seasonal stock', description:'Five cartons awaiting inbound.', category:'Business stock', quantity:5, unit:'carton', length:.5, width:.5, height:.4, weight:3, volume_m3:.1, rentalId:'RNT-MANAGED-001', status:'Registered', current_location:null },
  ],
  movements: [
    { id:'MOV-001', itemId:'INV-001', type:'INBOUND', from:null, to:{zone:'Z-A',rack:'R-01',shelf:'S-01'}, performer:'Facility staff · Tran Minh Hoang', timestamp:'2026-09-18T09:00:00+07:00', notes:'Received six cartons.' },
    { id:'MOV-002', itemId:'INV-001', type:'RELOCATION', from:{zone:'Z-A',rack:'R-01',shelf:'S-01'}, to:{zone:'Z-A',rack:'R-02',shelf:'S-03'}, performer:'Facility staff · Tran Minh Hoang', timestamp:'2026-09-25T14:30:00+07:00', notes:'Moved during rack reorganization.' },
    { id:'MOV-003', itemId:'INV-002', type:'INBOUND', from:null, to:{zone:'Z-B',rack:'R-01',shelf:'S-02'}, performer:'Facility staff · Le Thi Mai', timestamp:'2026-09-20T10:00:00+07:00', notes:'Equipment inspected at handover.' },
  ],
  requests: [],
  payments: [
    {id:'PAY-001',reference:'VS-PAY-0849',rentalId:'RNT-SELF-001',contract:'VS-C-0849',type:'Rental fee',amount:1350000,status:'PAID',date:'2026-10-01T09:00:00+07:00',provider:'PAYOS'},
    {id:'PAY-002',reference:'VS-PAY-0850',rentalId:'RNT-MANAGED-001',contract:'VS-C-0850',type:'Managed storage',amount:2000000,status:'PENDING',date:'2026-10-03T10:00:00+07:00',provider:'PAYOS'},
    {id:'PAY-003',reference:'VS-PAY-0851',rentalId:'RNT-SELF-002',contract:'VS-C-0851',type:'Rental fee',amount:1500000,status:'FAILED',date:'2026-10-02T11:00:00+07:00',provider:'PAYOS'},
  ],
  refunds: [{id:'REF-001',paymentId:'PAY-001',rentalId:'RNT-SELF-001',amount:150000,status:'PROCESSING',date:'2026-10-03T10:30:00+07:00',reason:'Approved billing adjustment.',reference:'VS-REF-001'}],
  charges: [{id:'CHG-001',rentalId:'RNT-SELF-001',type:'Extra handling',amount:200000,status:'PAYMENT_REQUIRED',date:'2026-10-03T12:00:00+07:00',dueDate:'2026-10-15',reason:'Additional loading assistance requested.',reference:'VS-CHG-001'}, {id:'CHG-002',rentalId:'RNT-SELF-001',type:'Damage charge',amount:100000,status:'PAID',date:'2026-09-28T10:00:00+07:00',reason:'Approved repair charge after inspection.',reference:'VS-CHG-002'}],
  notifications: [
    ...['Reservation','Approval / rejection','Contract','Payment','Rental reminder','Overdue','Support','Inventory inbound','Inventory outbound'].map((category,index)=>({id:`NOT-${index+1}`,category,title:['Reservation received','Reservation approved','Contract ready for review','Payment requires attention','Your rental ends soon','Access suspended for billing review','Support team replied','Inbound request received','Outbound request updated'][index],message:['Your reservation is ready for the next step.','View approval details in your reservation.','Review and confirm your rental agreement.','Review your payment status in the portal.','Request an extension before your current end date.','Please contact support about the suspended rental.','Your facility support conversation has an update.','Staff will assign the item location after acceptance.','View movement history after staff completes outbound.'][index],timestamp:`2026-10-0${index%3+1}T09:00:00+07:00`,read:index>3,href:['/portal/contracts','/portal/contracts','/portal/contracts','/portal/payments','/portal/rentals/RNT-SELF-001/extend','/portal/rentals/RNT-SELF-002/access','/portal/support','/portal/inventory/INV-003/inbound','/portal/inventory/INV-001/history'][index]})),
  ],
};
'''
files['src/lib/customerDemoStore.js'] = r'''
import { useSyncExternalStore } from 'react';
import { customerSeed } from '@/mocks/customerData';
export const customerDemoEnabled = import.meta.env.VITE_USE_MOCK !== 'false';
const key = 'VaultSpace_customer_priority1_demo_v1';
const empty = { profile:{fullName:'',email:'',phone:'',address:'',company:''},rentals:[],items:[],movements:[],requests:[],payments:[],refunds:[],charges:[],notifications:[] };
const clone = value => JSON.parse(JSON.stringify(value));
let state;
try { state = customerDemoEnabled ? JSON.parse(localStorage.getItem(key)) || clone(customerSeed) : clone(empty); }
catch { state = customerDemoEnabled ? clone(customerSeed) : clone(empty); }
const listeners = new Set();
const notify = () => listeners.forEach(listener=>listener());
window.addEventListener('storage', event=>{if(event.key===key && event.newValue && customerDemoEnabled){try{state=JSON.parse(event.newValue);notify();}catch{/* Leave the last valid preview intact. */}}});
function change(fn) {
  if (!customerDemoEnabled) throw new Error('This action needs a connected customer API.');
  const next = fn(clone(state));
  localStorage.setItem(key,JSON.stringify(next));
  state = next; notify();
}
export function useCustomerData() {
  return useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>state);
}
const makeId = prefix => `${prefix}-${crypto.randomUUID()}`;
export function saveDemoProfile(profile) {change(current=>({...current,profile}));}
export function registerDemoItem(values) {
  const rental=state.rentals.find(item=>item.id===values.rentalId && item.model==='MANAGED_INVENTORY' && item.status==='ACTIVE');
  if(!rental)throw new Error('An active Managed Inventory rental is required.');
  const dimensions=['length','width','height','weight'].map(name=>Number(values[name]));
  if(dimensions.some(value=>!Number.isFinite(value)||value<=0)||!Number.isInteger(Number(values.quantity))||Number(values.quantity)<=0)throw new Error('Enter valid positive dimensions, weight and quantity.');
  const id=makeId('INV');
  const item={...values,id,code:`VS-INV-${id.slice(-8).toUpperCase()}`,name:values.name.trim(),quantity:Number(values.quantity),length:dimensions[0],width:dimensions[1],height:dimensions[2],weight:dimensions[3],volume_m3:dimensions[0]*dimensions[1]*dimensions[2],status:'Registered',current_location:null};
  change(current=>({...current,items:[item,...current.items]}));return item;
}
export function pendingMovement(itemId) {return state.requests.find(request=>request.itemId===itemId && request.status==='PENDING');}
export function reservedInboundVolume(rentalId) {
  return state.requests.filter(request=>request.rentalId===rentalId&&request.type==='INBOUND'&&request.status==='PENDING').reduce((total,request)=>total+request.volume,0);
}
export function requestDemoMovement(itemId,type,notes) {
  const item=state.items.find(item=>item.id===itemId);
  const rental=state.rentals.find(rental=>rental.id===item?.rentalId);
  if(!item||!rental||rental.model!=='MANAGED_INVENTORY'||rental.status!=='ACTIVE')throw new Error('An active Managed Inventory rental is required.');
  if(pendingMovement(itemId))throw new Error('This item already has a pending movement request.');
  if(type==='INBOUND' && item.status!=='Registered' || type==='OUTBOUND' && item.status!=='InStorage')throw new Error('This action is not available for the current item status.');
  if(!['INBOUND','OUTBOUND'].includes(type))throw new Error('Unsupported movement request.');
  const volume=item.volume_m3*item.quantity;
  if(type==='INBOUND' && rental.used_capacity_m3+reservedInboundVolume(rental.id)+volume>rental.allocated_capacity_m3+1e-9)throw new Error('The projected volume exceeds allocated capacity. Request additional capacity first.');
  const request={id:makeId('REQ'),rentalId:rental.id,itemId,type,volume,notes:notes.trim(),status:'PENDING',createdAt:new Date().toISOString()};
  change(current=>({...current,requests:[request,...current.requests],notifications:[{id:makeId('NOT'),category:type==='INBOUND'?'Inventory inbound':'Inventory outbound',title:`${type==='INBOUND'?'Inbound':'Outbound'} request received`,message:`${item.name}: pending staff review.`,read:false,timestamp:request.createdAt,href:`/portal/inventory/${itemId}`},...current.notifications]}));return request;
}
export function requestDemoExtension(values) {
  const rental=state.rentals.find(rental=>rental.id===values.rentalId);
  if(!rental||rental.status!=='ACTIVE')throw new Error('An active rental is required.');
  if(values.type==='CAPACITY' && rental.model!=='MANAGED_INVENTORY')throw new Error('Capacity upgrades are only available for Managed Inventory.');
  if(state.requests.some(request=>request.rentalId===rental.id&&request.type===values.type&&request.status==='PENDING'))throw new Error('There is already a pending request of this type.');
  const request={...values,id:makeId('REQ'),status:'PENDING',createdAt:new Date().toISOString()};
  // An upgrade request does not create a rental or change its current capacity/end date.
  change(current=>({...current,requests:[request,...current.requests]}));return request;
}
export function markDemoNotification(id) {change(current=>({...current,notifications:current.notifications.map(item=>item.id===id?{...item,read:true}:item)}));}
export function markAllDemoNotifications() {change(current=>({...current,notifications:current.notifications.map(item=>({...item,read:true}))}));}
export const formatVolume = value => `${Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:3})} m³`;
export const locationLabel = location => location ? `${location.zone} / ${location.rack} / ${location.shelf}` : 'Outside';
export const timestampLabel = value => value ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)) : 'Not available';
'''
files['src/components/common/CustomerScreen.jsx'] = r'''
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { customerDemoEnabled } from '@/lib/customerDemoStore';
export function CustomerScreen({title,description,eyebrow='CUSTOMER PORTAL',action,children}) {
  return <div className="customer-screen mx-auto max-w-6xl p-5 md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="label text-sky-700">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold md:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-sm text-slate-500">{description}</p></div>{action}</div><p className="demo-notice mt-5 rounded-xl border px-4 py-3 text-xs">{customerDemoEnabled?'Demo workspace · Changes are saved in this browser. Requests are simulated and do not perform staff operations or real payments.':'Customer API integration pending · Preview actions are unavailable in live mode.'}</p><div className="mt-6 space-y-6">{children}</div></div>;
}
export function StatusBadge({status}) {
  const green=['ACTIVE','PAID','COMPLETED','InStorage','APPROVED','SIGNED'].includes(status);
  const red=['FAILED','REJECTED','SUSPENDED','OVERDUE'].includes(status);
  return <Badge variant={green?'green':red?'dark':'orange'} className={red?'bg-red-50 text-red-700':''}>{String(status||'Unknown').replaceAll('_',' ')}</Badge>;
}
export function Field({label,id,children,hint}) {return <div><label htmlFor={id} className="field-label">{label}</label>{children}{hint&&<p className="mt-2 text-xs text-slate-500">{hint}</p>}</div>;}
export function Details({values}) {return <dl className="grid gap-5 sm:grid-cols-2">{values.map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold">{value ?? '—'}</dd></div>)}</dl>;}
export function EmptyState({title,description,to,label='Back to portal'}) {return <Card><CardContent className="py-12 text-center"><h2 className="text-xl font-bold">{title}</h2><p className="mx-auto mt-3 max-w-lg text-sm text-slate-500">{description}</p>{to&&<Button asChild variant="orange" className="mt-5"><Link to={to}>{label}</Link></Button>}</CardContent></Card>;}
export function Message({error,success}) {return error?<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>:success?<p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>:null;}
export function Select({id,label,value,onChange,options,disabled=false}) {return <select id={id} aria-label={label} className="customer-select" value={value} onChange={onChange} disabled={disabled}>{options.map(option=>{const [value,label]=Array.isArray(option)?option:[option,option];return <option key={value} value={value}>{label}</option>;})}</select>;}
export function CapacitySummary({rental,projected,pending=0}) {
  const used=rental.used_capacity_m3,allocated=rental.allocated_capacity_m3;
  return <div className="soft-panel p-5"><div className="flex flex-wrap justify-between gap-2 text-sm"><b>Managed storage capacity</b><span>{used.toFixed(3)} / {allocated.toFixed(3)} m³ used</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-label="Used capacity" aria-valuemin={0} aria-valuemax={allocated} aria-valuenow={used}><div className="h-full rounded-full bg-[#176B3A]" style={{width:`${Math.min(100,used/allocated*100)}%`}}/></div>{pending>0&&<p className="mt-3 text-xs text-slate-500">Pending inbound volume: {pending.toFixed(3)} m³</p>}{projected!=null&&<p className={`mt-3 text-sm ${projected>allocated?'text-red-700':'text-sky-700'}`}>Projected after inbound: <b>{projected.toFixed(3)} m³</b></p>}</div>;
}
'''
for path,content in files.items():
 p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content.strip()+'\n',encoding='utf-8')
