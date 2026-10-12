export const termKey=term=>`${term.unit}:${term.value}`;
export const termLabel=term=>`${term.value} ${term.unit[0]+term.unit.slice(1).toLowerCase()}${term.value===1?'':'s'}`;
export function rentalEndDate(start,term){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!term||!Number.isSafeInteger(term.value)||term.value<1||!['DAY','MONTH','YEAR'].includes(term.unit))return '';
 const date=new Date(`${start}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==start)return '';
 const day=date.getUTCDate();
 if(term.unit==='DAY')date.setUTCDate(day+term.value);
 else {date.setUTCMonth(date.getUTCMonth()+term.value*(term.unit==='YEAR'?12:1));if(date.getUTCDate()!==day)date.setUTCDate(0);}
 return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):'';
}
export function matchingRentalTerms(rules,{facilityId,unitSize,serviceType,at}){
 if(!Array.isArray(rules))throw Error('Pricing Rules exist but the collection mapping is invalid. Expected data to be an array.');
 if(rules.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Backend returned invalid pricing data: a Pricing Rule record is malformed.');
 const matching=rules.filter(r=>r&&typeof r==='object'&&(typeof r.facilityId==='string'?r.facilityId:r.facilityId?._id)===facilityId&&r.serviceType===serviceType&&r.unitSize===unitSize);
 const active=matching.filter(r=>r.isActive===true),timestamp=at?Date.parse(at):null;
 const valid=active.map(r=>{
  const value=typeof r.term?.value==='string'&&/^[1-9]\d*$/.test(r.term.value)?Number(r.term.value):r.term?.value;
  if(!Number.isSafeInteger(value)||value<1||!['DAY','MONTH','YEAR'].includes(r.term?.unit)||typeof r.price!=='number'||!Number.isFinite(r.price)||r.price<=0||typeof r.currency!=='string'||!/^[A-Z]{3}$/.test(r.currency)||!Number.isFinite(Date.parse(r.effectiveFrom))||(r.effectiveTo!=null&&(!Number.isFinite(Date.parse(r.effectiveTo))||Date.parse(r.effectiveTo)<=Date.parse(r.effectiveFrom))))throw Error('Backend returned invalid pricing data for the selected unit. Check term, price, currency and effective dates.');
  return {...r,term:{value,unit:r.term.unit}};
 });
 const effective=valid.filter(r=>timestamp===null||(Date.parse(r.effectiveFrom)<=timestamp&&(r.effectiveTo==null||Date.parse(r.effectiveTo)>timestamp)));
 const terms=[...new Map(effective.map(r=>[termKey(r.term),r.term])).values()].sort((a,b)=>['DAY','MONTH','YEAR'].indexOf(a.unit)-['DAY','MONTH','YEAR'].indexOf(b.unit)||a.value-b.value);
 const reason=!rules.length?'No Pricing Rules are configured for this facility and unit size.':!matching.length?'No Pricing Rule matches this facility, service type and unit size.':!active.length?'No active Pricing Rules match this unit.':!effective.length?(valid.some(r=>Date.parse(r.effectiveFrom)>timestamp)?'Pricing Rules are not yet effective on the selected move-in date.':'No Pricing Rule is effective on the selected move-in date.') :'';
 return {terms,reason};
}
