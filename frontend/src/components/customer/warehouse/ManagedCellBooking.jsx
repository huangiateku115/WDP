import {useEffect,useRef,useState} from 'react';
import {useNavigate,useSearchParams} from 'react-router-dom';
import {getAccessToken,useAuthSession} from '@/lib/authSession';
import managedApi from '@/api/managedReservationApi';
import reservationApi from '@/api/reservationApi';
import warehouseMapApi from '@/api/warehouseMapApi';
import {customerProfileApi} from '@/api/customerRentalApi';
import {managedCreation} from '@/lib/customerReservationService';
import {readBookingPeriod,selectedPayload,cellBookingReason,cellVolume,volumeText,verifiedCellQuote,matchesCellReservation} from '@/lib/managedCellBooking';
import {validateRackDetail} from '@/lib/warehouseMap';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog} from '@/components/ui/dialog';
import {useBackend,record,rows,LoadState,Message,Link} from '../RentalBackendUI';

// UI basket only, in memory. No reservation/token/payment is persisted here.
let basketOwner='',basketRows=[],basketAttempt=null;

export function useManagedCellBooking(facilityId){
  const session=useAuthSession(),[params,setParams]=useSearchParams(),nav=useNavigate();
  const period=readBookingPeriod(params),rangeKey=JSON.stringify(period.range),scope=`${session.accessToken}:${facilityId}:${rangeKey}`;
  const owner=`${session.accessToken}:${facilityId}`;
  const [selection,setSelection]=useState(()=>{if(basketOwner!==owner){basketOwner=owner;basketRows=[];basketAttempt=null;}return basketRows.map(row=>({...row,availabilityKey:''}));}),[revision,setRevision]=useState(0),[open,setOpen]=useState(false),[quote,setQuote]=useState(null),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(''),[error,setError]=useState(''),[uncertain,setUncertain]=useState(()=>basketAttempt),[checking,setChecking]=useState(false);
  useEffect(()=>{basketOwner=owner;basketRows=selection;},[selection,owner]);
  useEffect(()=>{basketAttempt=uncertain;},[uncertain]);
  const busy=useRef(false),active=useRef(scope),alive=useRef(true);active.current=scope;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(getAccessToken()!==session.accessToken){basketOwner='';basketRows=[];basketAttempt=null;}};},[]);
  const profile=useBackend(config=>open?customerProfileApi.get(config).then(record):Promise.resolve(null),[open]);
  const racksKey=JSON.stringify([...new Set(selection.map(x=>x.rack._id))].sort());
  const validScope=key=>alive.current&&active.current===key&&getAccessToken()===session.accessToken;
  async function freshSelection(entries,range,config={}){
    if(!range)throw Error('Choose a valid rental interval.');
    const racks=await Promise.all([...new Set(entries.map(x=>x.rack._id))].map(async rackId=>validateRackDetail(record(await warehouseMapApi.getRackDetailMap(rackId,config,range)),facilityId,rackId)));
    return entries.map(entry=>{const data=racks.find(d=>d.rack._id===entry.rack._id),level=data.levels.find(l=>l.cells.some(c=>c._id===entry.cell._id)),cell=level?.cells.find(c=>c._id===entry.cell._id);return cell?{cell,level:{levelNumber:level.levelNumber},rack:data.rack,availabilityKey:JSON.stringify(range),reason:cellBookingReason(cell,data.rack,range)}:{...entry,availabilityKey:'',reason:'Cell is no longer returned by this Rack. Remove it and refresh.'};});
  }
  useEffect(()=>{
    setQuote(null);setConfirmed(false);
    if(!selection.length||!period.range){setChecking(false);return;}
    const abort=new AbortController(),key=scope;setChecking(true);
    freshSelection(selection,period.range,{signal:abort.signal}).then(fresh=>{if(!abort.signal.aborted&&validScope(key))setSelection(current=>current.map(x=>fresh.find(f=>f.cell._id===x.cell._id)||x));}).catch(e=>{if(!abort.signal.aborted&&validScope(key)){setError(bookingError(e));setSelection(current=>current.map(x=>({...x,availabilityKey:'',reason:'Availability could not be refreshed.'})));}}).finally(()=>{if(!abort.signal.aborted&&validScope(key))setChecking(false);});
    return()=>abort.abort();
  },[rangeKey,revision,racksKey]);
  const selectionKey=JSON.stringify(selection.map(x=>[x.cell._id,x.availabilityKey,x.reason,x.cell.dimensions]));
  const requestKey=`${scope}:${selectionKey}`;const requestRef=useRef(requestKey);requestRef.current=requestKey;
  useEffect(()=>{setQuote(null);setConfirmed(false);},[requestKey]);
  let payload=null;try{if(!checking&&selection.every(x=>x.availabilityKey===rangeKey&&!x.reason))payload=selectedPayload(facilityId,selection,period.range,period.term);}catch{/* Invalid selection stays readable but cannot be bought. */}
  const review=quote?.key===requestKey?quote.data:null;
  function changePeriod(key,value){if(busy.current||uncertain)return;const next=new URLSearchParams(params);next.set(key,String(value));next.delete('startDate');next.delete('endDate');setSelection(current=>current.map(row=>({...row,availabilityKey:''})));setParams(next,{replace:true});setQuote(null);setConfirmed(false);setError('');}
  function toggle(cell,level,rack){if(busy.current||uncertain)return;setQuote(null);setConfirmed(false);setError('');setSelection(current=>{if(current.some(x=>x.cell._id===cell._id))return current.filter(x=>x.cell._id!==cell._id);if(current.length>=100){setError('At most 100 Cells can be selected.');return current;}const reason=cellBookingReason(cell,rack,period.range);if(reason){setError(reason);return current;}return [...current,{cell,level:{levelNumber:level.levelNumber},rack,availabilityKey:rangeKey,reason:''}];});}
  function clear(){if(busy.current||uncertain)return;setSelection([]);setQuote(null);setConfirmed(false);setError('');}
  async function resolveQuote(){if(busy.current||!payload||uncertain)return;busy.current=true;setPending('quote');setError('');setQuote(null);setConfirmed(false);const key=scope,rkey=requestKey;
    try{const data=verifiedCellQuote(record(await managedApi.quote(payload)),payload,period.range);if(validScope(key)&&requestRef.current===rkey)setQuote({key:rkey,data});}
    catch(e){if(validScope(key))setError(bookingError(e));}finally{busy.current=false;if(validScope(key))setPending('');}}
  async function reconcile(attempt){if(busy.current)return;busy.current=true;setPending('reconcile');setError('');const key=scope;
    try{const owned=rows(await reservationApi.mineReal());if(!validScope(key))return;const found=owned.filter(r=>!attempt.known.includes(r._id)&&matchesCellReservation(r,attempt.payload,attempt.range));
      if(found.length===1){basketRows=[];basketAttempt=null;setUncertain(null);setSelection([]);clearMapAvailability();nav(`/portal/reservations/${found[0]._id}`,{state:{managedCreated:true}});return;}
      if(found.length>1)throw Error('Multiple matching records were returned. Check My Storage before making another reservation.');
      setUncertain(null);setQuote(null);setConfirmed(false);setRevision(v=>v+1);setError('No new matching reservation was returned by your account. Availability must refresh and you must obtain a new quote before an explicit manual retry. No request was repeated.');
    }catch(e){if(validScope(key))setError(`${bookingError(e)} Booking remains uncertain; automatic retry is disabled.`);}finally{busy.current=false;if(validScope(key))setPending('');}}
  async function create(){if(busy.current||!payload||!review||!confirmed||profile.data?.verificationStatus!=='VERIFIED'||uncertain)return;busy.current=true;setPending('create');setError('');const key=scope,rkey=requestKey;let sent=false,attempt;
    try{
      const eligibility=record(await customerProfileApi.get());if(!validScope(key))return;if(eligibility.verificationStatus!=='VERIFIED')throw Error('A VERIFIED Customer Profile is required.');
      const fresh=await freshSelection(selection,period.range);if(!validScope(key)||requestRef.current!==rkey)return;
      const latest=selectedPayload(facilityId,fresh,period.range,period.term);if(Math.abs(latest.allocatedCapacityM3-payload.allocatedCapacityM3)>1e-6||fresh.some(x=>x.reason)){setSelection(fresh);setQuote(null);setConfirmed(false);throw Error('Cell dimensions or availability changed. Review the refreshed selection and request a new quote.');}
      const updated=verifiedCellQuote(record(await managedApi.quote(latest)),latest,period.range);if(!validScope(key)||requestRef.current!==rkey)return;
      if(JSON.stringify(updated)!==JSON.stringify(review)){setQuote({key:rkey,data:updated});setConfirmed(false);setError('The quote changed. Review the updated charges and confirm again.');return;}
      const owned=rows(await reservationApi.mineReal());if(!validScope(key)||requestRef.current!==rkey)return;
      attempt={payload:latest,range:period.range,known:owned.map(r=>r._id)};sent=true;
      const result=managedCreation(await managedApi.create(latest));if(!validScope(key))return;
      if(!matchesCellReservation(result.reservation,latest,period.range))throw Error('The returned reservation did not match the selected Cells and period.');
      basketRows=[];basketAttempt=null;setSelection([]);clearMapAvailability();nav(`/portal/reservations/${result.reservation._id}`,{state:{managedCreated:true}});
    }catch(e){if(!validScope(key))return;setConfirmed(false);setQuote(null);const status=e.response?.status;
      if(sent&&(!status||status>=500)){setUncertain(attempt);setError('The creation result is uncertain. Check your own reservation records before any manual retry. No automatic POST will be sent.');}
      else {setError(bookingError(e));setRevision(v=>v+1);clearMapAvailability();}
    }finally{busy.current=false;if(validScope(key))setPending('');}}
  return {period,rangeKey,selection,payload,profile,open,setOpen,review,confirmed,setConfirmed,pending,error,uncertain,checking,changePeriod,toggle,clear,resolveQuote,create,reconcile,refresh:()=>setRevision(v=>v+1),locked:!!pending||!!uncertain};
}

export const clearMapAvailability=()=>window.dispatchEvent(new Event('vaultspace:map-refresh'));
function bookingError(error){const status=error.response?.status;return ({400:'Invalid request or Cell capacity. Refresh dimensions and request a new quote.',401:'Please sign in again.',403:'Your profile or role is not eligible for this reservation.',404:'The Facility, Cell or required configuration is unavailable.',409:'Availability or pricing changed. Refresh the selected Cells and request a new quote.'})[status]||error.message||'The request could not be completed.';}
function SelectedList({selection}){return <ul className="wm-booking-list">{selection.map(x=><li key={x.cell._id}><strong>{x.cell.code||x.cell._id}</strong><span>{x.rack.rackCode||x.rack._id} · {x.rack.zoneCode||x.rack.zoneId||'Zone not returned'} · Level {x.level.levelNumber}</span><span>{x.cell.dimensions?.widthM} × {x.cell.dimensions?.depthM} × {x.cell.dimensions?.usableHeightM??'?'} m · {(()=>{try{return volumeText(cellVolume(x.cell));}catch{return 'Measured volume unavailable';}})()}</span>{x.reason&&<span className="text-orange-600">{x.reason}</span>}</li>)}</ul>;}
export function CellBookingPanel({booking,facilityId,facilityName}){
  const b=booking;return <section className="wm-booking-panel" aria-label="Managed Cell booking"><h2 className="text-lg font-bold">Select Cells for your rental</h2><p className="mt-2 text-sm">{facilityName||facilityId} · Availability is checked for the rental interval; selection and quotes do not hold Cells.</p><div className="wm-period-fields"><label>Rental start date (UTC)<Input aria-label="Cell rental start date (UTC)" type="date" value={b.period.start} disabled={b.locked} onChange={e=>b.changePeriod('start',e.target.value)}/></label><label>Term value<Input aria-label="Cell rental term value" type="number" min="1" step="1" value={b.period.term.value||''} disabled={b.locked} onChange={e=>b.changePeriod('termValue',e.target.value)}/></label><label>Term unit<select className="customer-select" aria-label="Cell rental term unit" value={b.period.term.unit} disabled={b.locked} onChange={e=>b.changePeriod('termUnit',e.target.value)}>{['DAY','MONTH','YEAR'].map(unit=><option key={unit}>{unit}</option>)}</select></label></div><p className="mt-2 text-sm">UTC interval: {b.period.range?`${b.period.range.startDate} → ${b.period.range.endDate}`:'Choose a valid date and term.'}</p><h3 className="mt-4 font-bold">Selected Cells ({b.selection.length})</h3><SelectedList selection={b.selection}/><div className="mt-4 flex flex-wrap items-center gap-3"><strong>Total selected capacity: {b.payload?volumeText(b.payload.allocatedCapacityM3):'Not yet validated'}</strong><Button variant="outline" disabled={b.locked||!b.selection.length} onClick={b.clear}>Clear Selection</Button><Button variant="orange" disabled={!b.payload||b.locked||b.checking} onClick={()=>b.setOpen(true)}>Buy</Button>{b.checking&&<span role="status">Refreshing selected Cells…</span>}</div><Message error={b.error}/>{b.uncertain&&<div className="mt-3 flex flex-wrap gap-3"><Button disabled={!!b.pending} onClick={()=>b.reconcile(b.uncertain)}>Check booking result</Button><Button asChild variant="outline"><Link to="/portal">Check My Storage</Link></Button></div>}{b.open&&<Dialog title="Review Managed Reservation" description="Review selected Cells and estimated charges. The server validates and holds Cells only when the reservation is created." busy={!!b.pending} onClose={()=>{b.setOpen(false);b.setConfirmed(false);}}><p>{facilityName||facilityId} · {b.period.term.value} {b.period.term.unit}</p><p className="break-words text-sm">{b.period.range?.startDate} → {b.period.range?.endDate}</p><SelectedList selection={b.selection}/><p>Total capacity: {b.payload?volumeText(b.payload.allocatedCapacityM3):'Availability requires refresh'}</p><LoadState resource={b.profile}/>{b.profile.data?.verificationStatus!=='VERIFIED'&&<p className="text-sm text-orange-700">A VERIFIED Customer Profile is required to create a reservation.</p>}<Button disabled={!b.payload||b.locked} onClick={b.resolveQuote}>{b.pending==='quote'?'Requesting quote…':'Get Cell quote'}</Button>{b.review&&<><dl className="grid grid-cols-2 gap-2 text-sm">{[['Rate per m³',b.review.pricing.ratePerM3],['Estimated rent',b.review.pricing.estimatedRent],['Deposit',b.review.deposit.amount],['Deposit percentage',b.review.deposit.percentage],['Tax',b.review.taxAmount],['Currency',b.review.pricing.currency],['Pricing rule',b.review.pricing.ruleId],['Pricing version',b.review.pricing.version]].map(([label,value])=><div key={label} className="min-w-0 break-words"><dt>{label}</dt><dd className="font-semibold">{value??'Not returned'}</dd></div>)}</dl><p className="font-semibold">Calculated estimate: {b.review.pricing.estimatedRent+b.review.deposit.amount+b.review.taxAmount} {b.review.pricing.currency}</p><label className="flex cursor-pointer items-start gap-3 text-sm"><Checkbox aria-label="Confirm selected Cells and estimated charges" checked={b.confirmed} disabled={b.locked} onCheckedChange={v=>b.setConfirmed(v===true)}/><span>I have reviewed the selected Cells, rental period and estimated charges.</span></label></>}<Message error={b.error}/><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={!!b.pending} onClick={()=>{b.setOpen(false);b.setConfirmed(false);}}>Cancel</Button><Button variant="orange" disabled={!b.payload||!b.review||!b.confirmed||b.profile.data?.verificationStatus!=='VERIFIED'||b.locked} onClick={b.create}>{b.pending==='create'?'Creating reservation…':'Confirm Reservation'}</Button></div>{b.uncertain&&<Button disabled={!!b.pending} onClick={()=>b.reconcile(b.uncertain)}>Check booking result</Button>}</Dialog>}</section>;
}

