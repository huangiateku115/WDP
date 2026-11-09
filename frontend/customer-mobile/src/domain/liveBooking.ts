import {day,term} from '../api/contracts/booking';
import type {z} from 'zod';

export type RentalTerm=z.infer<typeof term>;
export const termLabels={DAY:'Ngày',MONTH:'Tháng',YEAR:'Năm'} as const;
export const termKey=(duration:RentalTerm)=>duration.unit+':'+duration.value;
export const utcToday=()=>new Date().toISOString().slice(0,10);

export function unitSelection(status:unknown){
  switch(status){
    case 'AVAILABLE': return {label:'Còn trống',selectable:true};
    case 'OCCUPIED': return {label:'Đã có người thuê',selectable:false};
    case 'HELD': return {label:'Đang giữ chỗ',selectable:false};
    case 'INACTIVE': case 'MAINTENANCE': case 'BLOCKED':
      return {label:'Không khả dụng',selectable:false};
    default: return {label:'Chưa xác minh',selectable:false};
  }
}

export function rentalEndDate(start:string,duration:RentalTerm){
  if(!day.safeParse(start).success||!term.safeParse(duration).success)return undefined;
  const date=new Date(start+'T00:00:00Z');
  if(duration.unit==='DAY')date.setUTCDate(date.getUTCDate()+duration.value);
  else {
    const originalDay=date.getUTCDate();
    date.setUTCMonth(date.getUTCMonth()+duration.value*(duration.unit==='YEAR'?12:1));
    if(date.getUTCDate()!==originalDay)date.setUTCDate(0);
  }
  return Number.isFinite(date.getTime())&&date.getUTCFullYear()<=9999?date.toISOString().slice(0,10):undefined;
}

export function shiftMonth(month:string,amount:number){
  const date=new Date(month+'-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+amount);
  return Number.isFinite(date.getTime())&&date.getUTCFullYear()<=9999?date.toISOString().slice(0,7):month;
}

export function calendarDays(month:string){
  const first=new Date(month+'-01T00:00:00Z');
  const offset=(first.getUTCDay()+6)%7;
  first.setUTCMonth(first.getUTCMonth()+1,0);
  return [...Array<string|null>(offset).fill(null),...Array.from({length:first.getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))];
}

export function canStartOn(date:string,availability?:{availabilityState:string;intervals:{startDate:string;endDate:string}[]},today=utcToday()){
  return day.safeParse(date).success&&date>today&&availability?.availabilityState==='VERIFIED'&&
    !availability.intervals.some(interval=>Date.parse(interval.startDate)<Date.parse(date+'T00:00:00Z')+86400000&&
      Date.parse(interval.endDate)>Date.parse(date+'T00:00:00Z'));
}
