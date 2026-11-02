import {create} from 'zustand';
import {type BookingDraft,vietnamToday,unitAvailable,periodSchema,demoQuote} from '../domain/booking';
import {storageUnits,unitIntervals} from '../fixtures/booking';
interface BookingState {draft:BookingDraft|null;previewedUnits:string[];begin:(facilityId:string)=>void;select:(unitId:string)=>boolean;setPeriod:(start:string,months:number)=>void;preview:()=>boolean;clear:()=>void;}
export const useBookingStore=create<BookingState>((set,get)=>({
 draft:null,previewedUnits:[],
 begin:facilityId=>set(s=>s.draft?.facilityId===facilityId?{}:{draft:{facilityId,unitId:null,start:vietnamToday(),months:1,previewed:false}}),
 select:unitId=>{const s=get(),d=s.draft,u=storageUnits.find(u=>u.id===unitId);if(!d||!u||u.facilityId!==d.facilityId||s.previewedUnits.includes(unitId)||!unitAvailable(u,d.start,d.months,unitIntervals))return false;set({draft:{...d,unitId,previewed:false}});return true;},
 setPeriod:(start,months)=>set(s=>({draft:s.draft?{...s.draft,start,months,previewed:false}:null})),
 preview:()=>{const s=get(),d=s.draft,u=storageUnits.find(u=>u.id===d?.unitId);if(!d||!u||s.previewedUnits.includes(u.id)||!periodSchema.safeParse(d).success||!unitAvailable(u,d.start,d.months,unitIntervals)||!demoQuote(u,d.months))return false;set({draft:{...d,previewed:true},previewedUnits:[...s.previewedUnits,u.id]});return true;},
 clear:()=>set({draft:null,previewedUnits:[]}),
}));
