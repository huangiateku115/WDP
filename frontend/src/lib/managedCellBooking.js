import {managedRequest} from './customerReservationService.js';

const id=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
export const volumeText=value=>Number.isFinite(value)?`${Number(value.toFixed(6)).toLocaleString('en-US',{maximumFractionDigits:6})} m³`:'Not returned';
export function bookingInterval(start,term) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!Number.isSafeInteger(term?.value)||term.value<1||!['DAY','MONTH','YEAR'].includes(term.unit))return null;
  const from=new Date(`${start}T00:00:00.000Z`),to=new Date(from);
  if(!Number.isFinite(+from)||from.toISOString().slice(0,10)!==start)return null;
  if(term.unit==='DAY')to.setUTCDate(to.getUTCDate()+term.value);
  else {const month=to.getUTCMonth()+term.value*(term.unit==='YEAR'?12:1),year=to.getUTCFullYear()+Math.floor(month/12),day=to.getUTCDate();to.setUTCDate(1);to.setUTCFullYear(year);to.setUTCMonth(month%12);to.setUTCDate(Math.min(day,new Date(Date.UTC(year,month%12+1,0)).getUTCDate()));}
  if(!Number.isFinite(+to)||to<=from)return null;
  return {startDate:from.toISOString(),endDate:to.toISOString()};
}
export function canonicalRange(range) {
  if(!range)return {};
  if(!['startDate','endDate'].every(k=>typeof range[k]==='string'&&Number.isFinite(Date.parse(range[k]))&&new Date(range[k]).toISOString()===range[k])||Date.parse(range.endDate)<=Date.parse(range.startDate))throw Error('Choose a valid UTC rental interval.');
  return {startDate:range.startDate,endDate:range.endDate};
}
export function readBookingPeriod(params) {
  const start=params.get('start')||(params.get('startDate')||'').slice(0,10),term={value:params.has('termValue')?Number(params.get('termValue')):1,unit:params.get('termUnit')||'MONTH'};
  let range=bookingInterval(start,term);
  if(!params.get('start')&&params.get('startDate')&&params.get('endDate')){try{range=canonicalRange({startDate:params.get('startDate'),endDate:params.get('endDate')});}catch{range=null;}}
  return {start,term,range};
}
export function cellVolume(cell) {
  const values=['widthM','depthM','usableHeightM'].map(k=>cell?.dimensions?.[k]);
  if(!values.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))throw Error('Measured width, depth and usable height are required.');
  const result=values.reduce((a,b)=>a*b,1);if(!Number.isFinite(result)||result<=0)throw Error('Invalid measured Cell volume.');return result;
}
export function cellBookingReason(cell,rack,range) {
  if(!range)return 'Choose a rental start date and term before selecting Cells.';
  if(Date.parse(range.startDate)<=Date.now())return 'Choose a future UTC start date.';
  if(!id(cell?._id)||!id(rack?._id)||!id(rack?.facilityId))return 'Cell identity or Facility is unavailable.';
  if(rack.operationalStatus!=='AVAILABLE')return 'Parent Rack is not AVAILABLE.';
  if(cell.operationalStatus!=='AVAILABLE')return `Cell operation: ${cell.operationalStatus||'unknown'}.`;
  if(!['AVAILABLE','RESERVED','OCCUPIED'].includes(cell.bookingStatus)||!['AVAILABLE','RESERVED','OCCUPIED','BLOCKED','MAINTENANCE'].includes(cell.displayStatus))return 'Booking status is missing or unknown; refresh availability.';
  if(cell.bookingStatus!=='AVAILABLE'||cell.displayStatus!=='AVAILABLE')return `Cell is ${cell.displayStatus} for this interval.`;
  if(typeof cell.usedWeightKg!=='number'||typeof cell.usedVolumeM3!=='number'||cell.usedWeightKg!==0||cell.usedVolumeM3!==0)return 'Physical usage is unknown or this Cell contains inventory.';
  try{cellVolume(cell);}catch(e){return e.message;}return '';
}
export function selectedPayload(facilityId,selection,range,term) {
  canonicalRange(range);
  const calculated=range&&bookingInterval(range.startDate.slice(0,10),term);
  if(!calculated||calculated.startDate!==range.startDate||calculated.endDate!==range.endDate)throw Error('Choose a start date and term matching the requested rental interval.');
  if(!Array.isArray(selection)||selection.length<1||selection.length>100)throw Error('Select 1–100 Cells.');
  const ids=selection.map(x=>x.cell?._id?.toLowerCase());
  if(!ids.every(id)||new Set(ids).size!==ids.length)throw Error('Selected Cell IDs must be valid and unique.');
  for(const row of selection){if(row.rack?.facilityId?.toLowerCase()!==facilityId?.toLowerCase())throw Error('All Cells must belong to this Facility.');const reason=cellBookingReason(row.cell,row.rack,range);if(reason)throw Error(reason);}
  const allocatedCapacityM3=selection.reduce((sum,x)=>sum+cellVolume(x.cell),0);
  return {...managedRequest({facilityId,allocatedCapacityM3,startDate:range.startDate,term}),cellIds:ids};
}
export function verifiedCellQuote(data,payload,range) {
  if(!data||String(data.facilityId)!==payload.facilityId||Math.abs(data.allocatedCapacityM3-payload.allocatedCapacityM3)>1e-6||!Number.isFinite(data.allocatedCapacityM3)||data.startDate!==range.startDate||data.endDate!==range.endDate||data.term?.value!==payload.term.value||data.term?.unit!==payload.term.unit||![data.pricing?.ratePerM3,data.pricing?.estimatedRent,data.deposit?.amount,data.deposit?.percentage,data.taxAmount].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||typeof data.pricing.currency!=='string'||!Number.isFinite(data.pricing.estimatedRent+data.deposit.amount+data.taxAmount))throw Error('Invalid Managed quote. Refresh and request a new quote.');
  return data;
}
export function matchesCellReservation(r,payload,range) {
  const fid=typeof r?.facilityId==='string'?r.facilityId:r?.facilityId?._id;
  return id(r?._id)&&r.serviceType==='MANAGED_INVENTORY'&&fid===payload.facilityId&&r.startDate===range.startDate&&r.endDate===range.endDate&&Number.isFinite(r.allocatedCapacity)&&Math.abs(r.allocatedCapacity-payload.allocatedCapacityM3)<=1e-6&&Array.isArray(r.allocatedCellIds)&&r.allocatedCellIds.length===payload.cellIds.length&&[...r.allocatedCellIds].map(x=>typeof x==='string'?x:x?._id).sort().join(',')===[...payload.cellIds].sort().join(',');
}
