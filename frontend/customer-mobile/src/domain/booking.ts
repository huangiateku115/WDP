import {z} from 'zod';
export type UnitSize='S'|'M'|'L';
export interface StorageUnit {id:string;facilityId:string;code:string;size:UnitSize;dimensions:string;volumeM3:number;monthlyPrice:number|null;operational:'AVAILABLE'|'UNAVAILABLE';}
export interface UnitInterval {unitId:string;start:string;end:string;}
export interface DemoQuote {total:number;deposit:number;remaining:number;monthlyPrice:number;months:number;}
export interface BookingDraft {facilityId:string;unitId:string|null;start:string;months:number;previewed:boolean;}
// Calendar-only Vietnamese date. No UTC conversion of a customer-entered day.
export function vietnamToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function validDay(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value;}
export function endDay(start:string,months:number){if(!validDay(start)||![1,3,6,12].includes(months))return null;const [year,month,day]=start.split('-').map(Number) as [number,number,number];const last=new Date(Date.UTC(year,month-1+months+1,0)).getUTCDate();const result=new Date(Date.UTC(year,month-1+months,Math.min(day,last))).toISOString().slice(0,10);return validDay(result)?result:null;}
export const periodSchema=z.object({start:z.string().refine(validDay,'Nhập ngày hợp lệ theo YYYY-MM-DD.').refine(v=>validDay(v)&&v>=vietnamToday(),'Ngày bắt đầu không được ở quá khứ.'),months:z.number().refine(n=>[1,3,6,12].includes(n),'Chọn 1, 3, 6 hoặc 12 tháng.')});
export function demoQuote(unit:StorageUnit|undefined,months:number):DemoQuote|null {const price=unit?.monthlyPrice;if(!price||!Number.isSafeInteger(price)||price<0||![1,3,6,12].includes(months))return null;const total=price*months;if(!Number.isSafeInteger(total))return null;const deposit=price;return {monthlyPrice:price,months,total,deposit,remaining:total-deposit};}
export function unitAvailable(unit:StorageUnit,start:string,months:number,blocks:UnitInterval[]){const end=endDay(start,months);return unit.operational==='AVAILABLE'&&!!end&&periodSchema.safeParse({start,months}).success&&!blocks.some(b=>b.unitId===unit.id&&start<b.end&&end>b.start);}
export function dayLabel(day:string){return validDay(day)?day.split('-').reverse().join('/'):'Chưa chọn';}
