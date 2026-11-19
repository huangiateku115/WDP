import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';

export type RentalServiceFilter='ALL'|'SELF_STORAGE'|'MANAGED_INVENTORY';
export type RentalStatusFilter='PAYMENT'|'CONTRACT'|'HANDOVER'|'ACTIVE'|'ENDED'|'CANCELLED';
export type RentalTimeFilter='ALL'|'ENDING_30_DAYS'|'ENDED_TERM';
export type RentalSort='NEWEST'|'OLDEST'|'END_ASC'|'END_DESC';
export type RentalListFilters={service:RentalServiceFilter;statuses:RentalStatusFilter[];facilityId:string|'ALL';time:RentalTimeFilter;sort:RentalSort};

export const emptyRentalFilters:RentalListFilters={service:'ALL',statuses:[],facilityId:'ALL',time:'ALL',sort:'NEWEST'};
export const rentalStatusOptions:{id:RentalStatusFilter;label:string}[]=[
  {id:'PAYMENT',label:'Chờ thanh toán'},{id:'CONTRACT',label:'Chờ ký hợp đồng'},
  {id:'HANDOVER',label:'Chờ bàn giao'},{id:'ACTIVE',label:'Đang thuê'},
  {id:'ENDED',label:'Đã kết thúc'},{id:'CANCELLED',label:'Đã hủy'},
];
export function normalizeRentalSearch(value:string){return value.trim().toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');}
function ref(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'?value as Record<string,unknown>:undefined;}
export function rentalFacilityId(r:ReservationDto){return refId(r.facilityId);}
export function rentalFacilityName(r:ReservationDto){const value=ref(r.facilityId)?.name;return typeof value==='string'?value:'';}
export function rentalUnitCode(r:ReservationDto){const value=ref(r.storageUnitId)?.unitCode;return typeof value==='string'?value:'';}
function createdAt(r:ReservationDto){const value=(r as ReservationDto&{createdAt?:unknown}).createdAt;return typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;}
function statusMatches(r:ReservationDto,filter:RentalStatusFilter){
  const self=r.serviceType==='SELF_STORAGE',v2=!self&&r.bookingFlowVersion===2,v3=!self&&r.bookingFlowVersion===3;
  switch(filter){
    case 'PAYMENT':return self?['CONTRACTED','CHECKIN_READY'].includes(r.status):v3? r.status==='RESERVED':v2?r.status==='RESERVED':false;
    case 'CONTRACT':return self?r.status==='DEPOSIT_PAID':v3?r.status==='PAID':false;
    case 'HANDOVER':return self?r.status==='PAID':v3?r.status==='CHECKIN_READY':false;
    case 'ACTIVE':return r.status==='ACTIVE';
    case 'ENDED':return ['OVERDUE','CHECKED_OUT','CLOSED'].includes(r.status);
    case 'CANCELLED':return r.status==='CANCELLED';
  }
}
export function filterAndSortRentals(rows:ReservationDto[],query:string,filters:RentalListFilters,now=Date.now()){
  const q=normalizeRentalSearch(query);
  const matches=rows.filter(r=>{
    if(filters.service!=='ALL'&&r.serviceType!==filters.service)return false;
    if(filters.facilityId!=='ALL'&&rentalFacilityId(r)!==filters.facilityId)return false;
    if(filters.statuses.length&&!filters.statuses.some(status=>statusMatches(r,status)))return false;
    const end=Date.parse(r.endDate);
    if(filters.time==='ENDING_30_DAYS'&&!(r.status==='ACTIVE'&&end>now&&end<=now+30*86400000))return false;
    if(filters.time==='ENDED_TERM'&&!(end<=now))return false;
    if(q){const haystack=normalizeRentalSearch([r.reservationCode,rentalFacilityName(r),rentalUnitCode(r)].join(' '));if(!haystack.includes(q))return false;}
    return true;
  });
  return matches.sort((a,b)=>{
    if(filters.sort==='END_ASC')return Date.parse(a.endDate)-Date.parse(b.endDate);
    if(filters.sort==='END_DESC')return Date.parse(b.endDate)-Date.parse(a.endDate);
    const left=createdAt(a),right=createdAt(b);if(left===null||right===null)return left===right?0:left===null?1:-1;
    return filters.sort==='NEWEST'?right-left:left-right;
  });
}
export function activeRentalFilterCount(filters:RentalListFilters){return (filters.statuses.length?1:0)+(filters.facilityId!=='ALL'?1:0)+(filters.time!=='ALL'?1:0)+(filters.sort!=='NEWEST'?1:0);}
