import {managedRequest, managedVietnamDate, managedBookingDateAllowed} from './customerReservationService.js';
import {managedQuoteFinancials} from './managedRentalPricing.js';

const id=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
export function minimumBookingStartDate(now=Date.now()){
  return managedVietnamDate(now);
}
export function bookingStartDateError(start,now=Date.now()){
  if(!start)return 'Choose a rental start date.';
  const range=bookingInterval(start,{value:1,unit:'DAY'});
  if(!range)return 'Choose a valid calendar date.';
  return managedBookingDateAllowed(range.startDate,now)?'':'Choose today or a future start date in Vietnam time.';
}
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
export function cellBookingReason(cell,rack,range,now=Date.now()) {
  if(!range)return 'Choose a rental start date and term before selecting Cells.';
  try{canonicalRange(range);}catch{return 'Choose a valid UTC rental interval.';}
  if(!managedBookingDateAllowed(range.startDate,now))return 'Choose today or a future start date in Vietnam time.';
  if(!id(cell?._id)||!id(rack?._id)||!id(rack?.facilityId))return 'Cell identity or Facility is unavailable.';
  if(rack.operationalStatus!=='AVAILABLE')return 'Parent Rack is not AVAILABLE.';
  if(cell.facilityId!=null&&cell.facilityId!==rack.facilityId)return 'Cell belongs to a different Facility.';
  if(cell.operationalStatus!=='AVAILABLE')return `Cell operation: ${cell.operationalStatus||'unknown'}.`;
  if(!['AVAILABLE','RESERVED','OCCUPIED'].includes(cell.bookingStatus)||!['AVAILABLE','RESERVED','OCCUPIED','BLOCKED','MAINTENANCE'].includes(cell.displayStatus))return 'Booking status is missing or unknown; refresh availability.';
  if(cell.bookingStatus!=='AVAILABLE'||cell.displayStatus!=='AVAILABLE')return `Cell is ${cell.displayStatus} for this interval.`;
  if(cell.physicalUsageKnown!==true)return 'Physical usage is unknown; this Cell cannot be booked.';
  if(cell.isBookable!==true)return 'Cell is not confirmed bookable for this interval.';
  if(cell.periodStatus!=='AVAILABLE')return 'Cell reservation-period availability is missing or unavailable. Refresh the selected interval.';
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
  if(!data||![2,3].includes(data.bookingFlowVersion))throw Error('Unsupported Managed quote version.');
  const expectedCells=payload?.cellIds,quotedCells=data.cellIds;
  if(!Array.isArray(expectedCells)||!expectedCells.length||new Set(expectedCells.map(x=>String(x).toLowerCase())).size!==expectedCells.length||
    !Array.isArray(quotedCells)||quotedCells.some(x=>typeof x!=='string'||!id(x))||new Set(quotedCells.map(x=>x.toLowerCase())).size!==quotedCells.length||
    [...quotedCells].map(x=>x.toLowerCase()).sort().join(',')!==[...expectedCells].map(x=>String(x).toLowerCase()).sort().join(','))throw Error('Managed quote Cell IDs do not match the selected Cells. Refresh and request a new quote.');
  if(String(data.facilityId).toLowerCase()!==String(payload.facilityId).toLowerCase()||
    !Number.isFinite(data.allocatedCapacityM3)||data.allocatedCapacityM3<=0||Math.abs(data.allocatedCapacityM3-payload.allocatedCapacityM3)>1e-6||
    data.startDate!==range.startDate||data.endDate!==range.endDate||data.term?.value!==payload.term.value||data.term?.unit!==payload.term.unit||
    ![data.pricing?.ratePerM3,data.pricing?.estimatedRent,data.taxAmount].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||
    typeof data.pricing?.currency!=='string'||!Number.isFinite(data.pricing.estimatedRent+data.taxAmount))throw Error('Invalid Managed quote. Refresh and request a new quote.');
  if(data.bookingFlowVersion===2){
    if(![data.deposit?.amount,data.deposit?.percentage].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))throw Error('Invalid Managed quote. Refresh and request a new quote.');
    managedQuoteFinancials(data);
  }
  if(data.bookingFlowVersion===3){
    const positiveVnd=v=>Number.isSafeInteger(v)&&v>0,nonNegativeVnd=v=>Number.isSafeInteger(v)&&v>=0,p=data.payment;
    if(data.pricing?.billingBasis!=='PER_M3'||!id(String(data.pricing?.ruleId??''))||!Number.isSafeInteger(data.pricing?.version)||data.pricing.version<1||data.pricing.currency!=='VND'||
      !positiveVnd(data.pricing.estimatedRent)||!nonNegativeVnd(data.taxAmount)||
      p?.purpose!=='FULL_RENT'||!positiveVnd(p.amount)||!nonNegativeVnd(p.amount)||p.amount!==data.pricing.estimatedRent+data.taxAmount||
      !Number.isFinite(data.sellableCapacityM3)||data.sellableCapacityM3<=0||!Number.isFinite(data.committedPeakCapacityM3)||data.committedPeakCapacityM3<0||
      !Number.isFinite(data.availableCapacityM3)||data.availableCapacityM3<0||
      Math.abs(data.availableCapacityM3-(data.sellableCapacityM3-data.committedPeakCapacityM3))>1e-6||data.availableCapacityM3<data.allocatedCapacityM3)
      throw Error('Managed V3 quote pricing or availability is missing or inconsistent. Refresh and request a new quote.');
  }
  return data;
}
export function matchesCellReservation(r,payload,range) {
  const fid=typeof r?.facilityId==='string'?r.facilityId:r?.facilityId?._id;
  return id(r?._id)&&r.serviceType==='MANAGED_INVENTORY'&&fid===payload.facilityId&&r.startDate===range.startDate&&r.endDate===range.endDate&&Number.isFinite(r.allocatedCapacity)&&Math.abs(r.allocatedCapacity-payload.allocatedCapacityM3)<=1e-6&&Array.isArray(r.allocatedCellIds)&&r.allocatedCellIds.length===payload.cellIds.length&&[...r.allocatedCellIds].map(x=>typeof x==='string'?x:x?._id).sort().join(',')===[...payload.cellIds].sort().join(',');
}
