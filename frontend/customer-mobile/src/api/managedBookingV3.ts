import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {managedCreateBody} from './contracts/booking';
import {readData,refId} from './contracts/core';
import {mapReservation,type ReservationDto} from './contracts/customer';
import type {ManagedQuote,ManagedRange} from './managedInventory';

export type ManagedCreateBody=z.infer<typeof managedCreateBody>;
type V3Quote=Extract<ManagedQuote,{bookingFlowVersion:3}>;
const policyDto=z.object({
  versionId:z.string().min(1).max(120),version:z.string().min(1),status:z.literal('PUBLISHED'),
  services:z.array(z.string()).refine(values=>values.includes('MANAGED_INVENTORY')),
  groups:z.array(z.object({id:z.string(),title:z.string(),appliesTo:z.array(z.string()),
    sections:z.object({MANAGED_INVENTORY:z.array(z.string().trim().min(1)).optional()})})),
});

export async function managedBookingPolicy(signal?:AbortSignal){
  const policy=readData(policyDto,await wire('GET','/public/terms/current',{
    anonymous:true,params:{serviceType:'MANAGED_INVENTORY'},signal,
  }));
  const groups=policy.groups.filter(group=>group.appliesTo.includes('MANAGED_INVENTORY'));
  if(!groups.length||groups.some(group=>!group.sections.MANAGED_INVENTORY?.length)){
    throw new MobileInputError('Không thể xác minh điều khoản kho ký gửi.');
  }
  return {...policy,groups};
}

export function sameManagedQuote(reviewed:V3Quote,fresh:ManagedQuote){
  return fresh.bookingFlowVersion===3&&fresh.facilityId===reviewed.facilityId&&
    fresh.startDate===reviewed.startDate&&fresh.endDate===reviewed.endDate&&
    fresh.allocatedCapacityM3===reviewed.allocatedCapacityM3&&
    fresh.term.unit===reviewed.term.unit&&fresh.term.value===reviewed.term.value&&
    fresh.cellIds.length===reviewed.cellIds.length&&new Set(fresh.cellIds).size===fresh.cellIds.length&&
    fresh.cellIds.every(id=>reviewed.cellIds.includes(id))&&
    JSON.stringify(fresh.pricing)===JSON.stringify(reviewed.pricing)&&
    fresh.taxAmount===reviewed.taxAmount&&fresh.payment.amount===reviewed.payment.amount&&
    fresh.payment.currency===reviewed.payment.currency;
}

export function verifyManagedCreation(r:ReservationDto,body:ManagedCreateBody,endDate:string){
  if(r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3||r.rentalPaymentFlow!=='FULL_UPFRONT_V1'||
    refId(r.facilityId)!==body.facilityId||Date.parse(r.startDate)!==Date.parse(body.startDate)||
    Date.parse(r.endDate)!==Date.parse(endDate)||r.allocatedCapacity!==body.allocatedCapacityM3||
    r.allocatedCellIds?.length!==body.cellIds.length||new Set(r.allocatedCellIds.map(refId)).size!==body.cellIds.length||
    r.allocatedCellIds.some(cell=>!body.cellIds.includes(refId(cell)))){
    throw new MobileInputError('Không thể xác minh đơn thuê vừa tạo. Hãy kiểm tra yêu cầu đã lưu.');
  }
  return r;
}

export async function createManagedBooking(body:ManagedCreateBody,range:ManagedRange,key:string,owner:string){
  const response=await wire('POST','/reservations/managed',{body:managedCreateBody.parse(body),key});
  const result=readData(z.object({reservation:z.unknown(),idempotent:z.boolean().optional()}),response);
  const reservation=verifyManagedCreation(mapReservation({success:true,data:result.reservation},owner),body,range.endDate);
  if(!result.idempotent&&reservation.status!=='RESERVED'){
    throw new MobileInputError('Máy chủ chưa xác nhận trạng thái giữ ô.');
  }
  return reservation;
}
