import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {pricingApi} from '@/api/customerRentalApi';
import {useReservation} from '@/contexts/ReservationContext';
import {localToday} from '@/lib/booking';
import {matchingRentalTerms,rentalEndDate,termKey,termLabel} from '@/lib/rentalPeriod';
import {Input} from '@/components/ui/input';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import Steps from '@/components/common/Steps';
import {BackendScreen,Card,CardContent,Button,Details,Link,LoadState,Message,useBackend,rows,record,recordId,validId} from './RentalBackendUI';

export default function RentalPeriodIntegration(){
 const {rentalDraft}=useReservation();
 return <RentalPeriodForm key={`${recordId(rentalDraft.facility)}:${recordId(rentalDraft.unit)}`}/>;
}
function RentalPeriodForm(){
 const {rentalDraft,updateRentalDraft}=useReservation(),nav=useNavigate();
 const facilityId=recordId(rentalDraft.facility),unitId=recordId(rentalDraft.unit),unitSize=rentalDraft.unit?.size,serviceType='SELF_STORAGE';
 const [start,setStart]=useState(rentalDraft.startDate||''),[selected,setSelected]=useState(rentalDraft.term?termKey(rentalDraft.term):Number.isSafeInteger(rentalDraft.months)&&rentalDraft.months>0?termKey({value:rentalDraft.months,unit:'MONTH'}):'');
 const scopeValid=validId(facilityId)&&validId(unitId)&&recordId(rentalDraft.unit?.facilityId)===facilityId&&rentalDraft.unit?.status==='AVAILABLE'&&['SMALL','MEDIUM','LARGE'].includes(unitSize)&&Array.isArray(rentalDraft.facility?.serviceTypes)&&rentalDraft.facility.serviceTypes.includes(serviceType);
 const rules=useBackend(async config=>{
  if(!scopeValid)return [];
  const all=[];let page=1,totalPages=1;
  do{
   const response=await pricingApi.list({facilityId,serviceType,unitSize,isActive:true,page,limit:100},config);
   all.push(...rows(response));const pagination=response.data.pagination;
   if(!pagination||!Number.isInteger(pagination.totalPages)||pagination.totalPages<0)throw Error('Pricing Rules collection mapping failed: pagination is invalid.');
   totalPages=pagination.totalPages;page++;
  }while(page<=totalPages);
  return all;
 },[facilityId,unitId,unitSize,scopeValid]);
 const at=start?`${start}T00:00:00Z`:null;
 let available={terms:[],reason:''},mappingError='';
 if(rules.data)try{available=matchingRentalTerms(rules.data,{facilityId,unitSize,serviceType,at});}catch(error){mappingError=error.message;}
 const selectedTerm=available.terms.find(term=>termKey(term)===selected);
 useEffect(()=>{if(!rules.loading&&!rules.error&&(!selectedTerm||mappingError))setSelected('');},[rules.loading,rules.error,selectedTerm?.value,selectedTerm?.unit,mappingError]);
 const end=rentalEndDate(start,selectedTerm);
 const valid=scopeValid&&!!selectedTerm&&!!end&&end>start&&start>=localToday()&&Date.parse(at)>Date.now()&&!mappingError;
 const price=useBackend(async config=>{
  if(!valid)return null;
  let result;
  try{result=record(await pricingApi.resolve({facilityId,serviceType,unitSize,termValue:selectedTerm.value,termUnit:selectedTerm.unit,at},config));}
  catch(error){if(error.response?.status===404&&error.response?.data?.message==='No effective rule')throw Error('Backend pricing resolution: No effective rule for the selected move-in date and commitment.');throw error;}
  const checked=matchingRentalTerms([result],{facilityId,serviceType,unitSize,at});
  if(!checked.terms.some(t=>termKey(t)===selected)||!validId(recordId(result)))throw Error('Resolved Pricing Rule does not match the selected duration or effective date.');
  return result;
 },[facilityId,unitId,start,selected,valid]);
 const policy=useBackend(config=>valid?pricingApi.resolvePolicy({facilityId,serviceType,type:'DEPOSIT',at},config).then(record):Promise.resolve(null),[facilityId,unitId,start,valid]);
 function review(){if(!valid||!price.data||price.loading||price.error)return;updateRentalDraft({startDate:start,endDate:end,term:selectedTerm,months:selectedTerm.unit==='MONTH'?selectedTerm.value:null,quote:{price:price.data,policy:policy.data||null}});nav('/portal/rent/review');}
 return <BackendScreen title="Choose your rental period" description="Review effective backend pricing for your selected unit and commitment duration."><Steps current={2}/>{!scopeValid&&<Link to="/portal/rent">Select an available storage unit at a valid facility first</Link>}<div className="grid gap-6 sm:grid-cols-2"><label className="block"><span className="field-label">Move-in date</span><Input aria-label="Move-in date" type="date" min={localToday()} required value={start} onChange={e=>setStart(e.target.value)}/></label><div><label htmlFor="rental-commitment" className="field-label">Select Commitment Duration</label><Select value={selectedTerm?selected:''} onValueChange={setSelected} disabled={!scopeValid||rules.loading||!!rules.error||!!mappingError||!available.terms.length}><SelectTrigger id="rental-commitment" aria-label="Select Commitment Duration"><SelectValue placeholder={rules.loading?'Loading pricing terms…':'Choose commitment duration'}/></SelectTrigger><SelectContent>{available.terms.map(term=><SelectItem key={termKey(term)} value={termKey(term)}>{termLabel(term)}</SelectItem>)}</SelectContent></Select></div></div><LoadState resource={rules}/><Message error={mappingError}/>{mappingError&&<Button variant="outline" onClick={rules.retry}>Retry pricing rules</Button>}{scopeValid&&!rules.loading&&!rules.error&&!mappingError&&available.reason&&<p role="status">{available.reason}</p>}{!start&&available.terms.length>0&&<p>Choose a move-in date to check which terms are effective.</p>}<p>Rental end: {end||'Choose a valid date and duration'}</p><div aria-label="Resolved pricing"><LoadState resource={price}/>{price.error&&<p className="text-sm">No applicable pricing could be resolved for the selected move-in date and commitment. Review remains unavailable.</p>}</div>{price.data&&<Card><CardContent><Details values={[["Resolved rule price",price.data.price],["Currency",price.data.currency],["Commitment",termLabel(selectedTerm)],["Pricing rule",recordId(price.data)],["Deposit policy",recordId(policy.data)]]}/><p className="mt-5 text-sm text-orange-700">You can review the returned rule price. Final booking remains unavailable until authoritative rental total and deposit calculations are confirmed.</p></CardContent></Card>}<div aria-label="Deposit policy"><LoadState resource={policy}/>{policy.error&&<p className="text-sm">Deposit policy is unavailable. Review shows only confirmed pricing; final reservation submission remains disabled.</p>}</div><Button disabled={!valid||!price.data||price.loading||!!price.error} onClick={review}>Review Reservation</Button></BackendScreen>;
}
