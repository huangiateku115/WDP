import { useSyncExternalStore } from 'react';
import { customerSeed, inventoryCategories, inventoryUnits } from '@/mocks/customerData';
export const customerDemoEnabled = import.meta.env.VITE_USE_MOCK === 'true';
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
  if(!values.name?.trim() || !inventoryCategories.includes(values.category) || !inventoryUnits.includes(values.unit))throw new Error('Enter a supported item name, category and unit.');
  if(!Number.isFinite(dimensions[0]*dimensions[1]*dimensions[2]*Number(values.quantity)))throw new Error('The item volume is too large.');
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
  if(!['EXTENSION','CAPACITY'].includes(values.type))throw new Error('Unsupported rental request.');
  if(values.type==='EXTENSION' && (!/^\d{4}-\d{2}-\d{2}$/.test(values.newEndDate || '') || values.newEndDate<=rental.endDate))throw new Error('The requested end date must be after the current rental end date.');
  if(values.type==='CAPACITY' && (!Number.isFinite(values.additional_capacity_m3) || values.additional_capacity_m3<=0))throw new Error('Enter a positive additional capacity.');
  if(!Number.isFinite(values.estimatedCharge) || values.estimatedCharge<0)throw new Error('A valid estimate is required.');
  if(state.requests.some(request=>request.rentalId===rental.id&&request.type===values.type&&request.status==='PENDING'))throw new Error('There is already a pending request of this type.');
  const request={...values,id:makeId('REQ'),status:'PENDING',createdAt:new Date().toISOString()};
  // An upgrade request does not create a rental or change its current capacity/end date.
  change(current=>({...current,requests:[request,...current.requests]}));return request;
}
export function markDemoNotification(id) {change(current=>({...current,notifications:current.notifications.map(item=>item.id===id?{...item,read:true}:item)}));}
export function markAllDemoNotifications() {change(current=>({...current,notifications:current.notifications.map(item=>({...item,read:true}))}));}
export const formatVolume = value => `${Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:9})} m³`;
export const locationLabel = location => location ? `${location.zone} / ${location.rack} / ${location.shelf}` : 'Outside';
export const timestampLabel = value => value ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(value)) : 'Not available';
