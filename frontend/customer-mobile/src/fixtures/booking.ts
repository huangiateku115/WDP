import type {StorageUnit,UnitInterval} from '../domain/booking';
export const storageUnits:StorageUnit[]=[
{id:'south-s1',facilityId:'saigon-south',code:'U-102',size:'S',dimensions:'2 × 2,5 × 2,8 m',volumeM3:14,monthlyPrice:1250000,operational:'AVAILABLE'},
{id:'south-m1',facilityId:'saigon-south',code:'U-204',size:'M',dimensions:'3 × 3,2 × 3 m',volumeM3:28.8,monthlyPrice:1850000,operational:'AVAILABLE'},
{id:'south-m2',facilityId:'saigon-south',code:'U-208',size:'M',dimensions:'3 × 3,3 × 3 m',volumeM3:29.7,monthlyPrice:1900000,operational:'AVAILABLE'},
{id:'south-l1',facilityId:'saigon-south',code:'U-305',size:'L',dimensions:'4,5 × 4 × 3,2 m',volumeM3:57.6,monthlyPrice:3200000,operational:'UNAVAILABLE'},
{id:'airport-s1',facilityId:'airport',code:'S-14',size:'S',dimensions:'2 × 1,5 × 2 m',volumeM3:6,monthlyPrice:850000,operational:'AVAILABLE'},
];
// Existing occupied intervals are illustrative, never a live HOLD or new booking.
export const unitIntervals:UnitInterval[]=[{unitId:'south-m2',start:'2026-11-01',end:'2027-02-01'}];
export const facilityDetails:Record<string,{hours:string;amenities:string[]}>={
'saigon-south':{hours:'08:00–18:00 · Thứ Hai–Thứ Bảy (mẫu)',amenities:['Khu tiếp nhận hàng','Lối đi nội bộ','Quầy hỗ trợ']},
'east-metro':{hours:'08:00–17:00 · Thứ Hai–Thứ Bảy (mẫu)',amenities:['Kệ lưu trữ','Khu kiểm tra hàng']},
'airport':{hours:'08:00–18:00 · Thứ Hai–Thứ Sáu (mẫu)',amenities:['Quầy hỗ trợ','Lối đi nội bộ']},
};
export interface RentalFacts {total:number;depositCredited:number;balancePaid:number;contract:'SIGNED'|'DRAFT';handover:boolean;milestones:boolean[];}
// Independent financial/signing/handover facts; never inferred from rental status.
export const rentalFacts:Record<string,RentalFacts>={
'rental-south':{total:5550000,depositCredited:1850000,balancePaid:3700000,contract:'SIGNED',handover:true,milestones:[true,true,true,true,true,true]},
'rental-east':{total:2880000,depositCredited:0,balancePaid:0,contract:'DRAFT',handover:false,milestones:[true,false,false,false,false,false]},
'rental-history':{total:2550000,depositCredited:850000,balancePaid:1700000,contract:'SIGNED',handover:true,milestones:[true,true,true,true,true,true]},
};
