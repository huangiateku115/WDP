import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {assertOwner,objectId,readData} from './contracts/core';
import {mapPaymentHistory,paymentDto} from './contracts/documents';
import {fullRentTerminal} from '../domain/livePayment';
import type {ReservationDto} from './contracts/customer';

export function managedPaymentPath(r:ReservationDto,owner:string){
  assertOwner(r,owner);
  if(r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3||r.rentalPaymentFlow!=='FULL_UPFRONT_V1'){
    throw new MobileInputError('Đơn thuê không thuộc thanh toán toàn bộ kho ký gửi V3.');
  }
  return '/reservations/managed/'+objectId.parse(r._id)+'/payments/';
}

export function managedPaymentEligible(r:ReservationDto){
  return r.status==='RESERVED'&&!!r.expiresAt&&Date.parse(r.expiresAt)>Date.now();
}

export function managedPaymentApplied(p:z.infer<typeof paymentDto>){
  return p.status==='SUCCEEDED'&&p.providerSettlementStatus==='VERIFIED'&&p.applicationStatus==='APPLIED'&&!p.reconciliationRequired;
}

export function managedCheckoutAction(rows:z.infer<typeof paymentDto>[],attempt?:{resourceId?:string}|null){
  if(!rows.length)return attempt?.resourceId?'BLOCKED':attempt?'RECOVER':'CREATE';
  const latest=rows[0];
  if(!latest||latest.retryAllowed!==true||!rows.every(fullRentTerminal)||
    (attempt&&!rows.some(row=>row.id===attempt.resourceId)))return 'BLOCKED';
  return 'RETRY';
}

function mapPayment(response:unknown,reservationId:string,expectedId?:string){
  const p=readData(paymentDto,response);
  if(p.purpose!=='FULL_RENT'||p.reservationId!==reservationId||(expectedId&&p.id!==expectedId)){
    throw new MobileInputError('Giao dịch không khớp với đơn thuê.');
  }
  return p;
}

export const managedPayment={
  async history(r:ReservationDto,owner:string,signal?:AbortSignal){
    const path=managedPaymentPath(r,owner);
    const rows:Array<ReturnType<typeof mapPaymentHistory>['items'][number]>=[];
    const cursors=new Set<string>(),ids=new Set<string>();
    let cursor:string|null=null;
    do{
      const page=mapPaymentHistory(await wire('GET',path+'payos',{params:{limit:25,...(cursor?{cursor}:{})},signal}),r._id);
      for(const row of page.items){
        if(ids.has(row.id))throw new MobileInputError('Lịch sử thanh toán chứa giao dịch trùng.');
        ids.add(row.id);
        if(row.purpose==='FULL_RENT')rows.push(row);
      }
      cursor=page.nextCursor;
      if(cursor&&(cursors.has(cursor)||cursors.size>=99))throw new MobileInputError('Chưa xác minh được toàn bộ lịch sử.');
      if(cursor)cursors.add(cursor);
    }while(cursor);
    return rows;
  },
  async status(r:ReservationDto,paymentId:string,owner:string,signal?:AbortSignal){
    return mapPayment(await wire('GET',managedPaymentPath(r,owner)+objectId.parse(paymentId),{signal}),r._id,paymentId);
  },
  async reconcile(r:ReservationDto,paymentId:string,owner:string){
    return mapPayment(await wire('POST',managedPaymentPath(r,owner)+objectId.parse(paymentId)+'/reconcile',{body:{}}),r._id,paymentId);
  },
  async checkout(r:ReservationDto,owner:string,key:string){
    const path=managedPaymentPath(r,owner);
    if(!managedPaymentEligible(r))throw new MobileInputError('Đơn thuê chưa đủ điều kiện thanh toán.');
    const response=await wire('POST',path+'payos',{key,body:{purpose:'FULL_RENT'}});
    z.object({outcome:z.enum(['CREATED','REPLAYED'])}).parse(response);
    return mapPayment(response,r._id);
  },
};
