import {mapV3Movements,mapV3Stock} from './contracts/managedV3Ledger';
import {z} from 'zod';
import axios from 'axios';
import {Platform} from 'react-native';
import {wire,MobileInputError} from './client';
import {assertOwner, idRef, instant, objectId, positive, readData, readPage, refId, whole} from './contracts/core';
import {identityProfile, mapCurrentUser, mapFacilities, mapFacility, mapReservation, mapReservations, type ReservationDto} from './contracts/customer';
import {day, mapAvailability, mapEstimate, selfBody, selfBookingBody, term, unitDto} from './contracts/booking';
import {contractDto, payosBody, mapContract, mapPaymentHistory, mapSelfPayment} from './contracts/documents';
import {itemDto, mapItem, mapMovements, mapStock} from './contracts/inventory';
import {mapMarkOneRead, mapNotifications} from './contracts/communications';

import {rentalEndDate,termKey} from '../domain/liveBooking';
import {accountUpdate,profileUpdate} from './contracts/profile';

const liveUnitDto=unitDto.extend({status:z.unknown()});
const id = (value: string) => objectId.parse(value);
const priceDto = z.object({_id:objectId, facilityId:idRef, serviceType:z.literal('SELF_STORAGE'),
  unitSize:z.enum(['SMALL','MEDIUM','LARGE']), term, currency:z.literal('VND')});
export const bookingPeriod = z.object({start:day, end:day, value:z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER), unit:term.shape.unit});
export type BookingPeriod = z.infer<typeof bookingPeriod>;

const priceOption=priceDto.extend({price:positive,isActive:z.boolean(),effectiveFrom:instant,effectiveTo:instant.nullish()})
  .refine(rule=>!rule.effectiveTo||Date.parse(rule.effectiveTo)>Date.parse(rule.effectiveFrom));
const effectiveAt=(rule:z.infer<typeof priceOption>,at:number)=>rule.isActive&&Date.parse(rule.effectiveFrom)<=at&&
  (!rule.effectiveTo||Date.parse(rule.effectiveTo)>at);

export const mobileRepo = {
  async facilities(page=1,signal?:AbortSignal) {
    return mapFacilities(await wire('GET','/public/facilities',{anonymous:true,params:{page,limit:20},signal}));
  },
  async facility(facilityId:string,signal?:AbortSignal) {
    const result=mapFacility(await wire('GET','/public/facilities/'+id(facilityId),{anonymous:true,signal}));
    if(result._id!==facilityId) throw new MobileInputError('Cơ sở không khớp.');
    return result;
  },
  async units(facilityId:string,page=1,signal?:AbortSignal) {
    const result=readPage(liveUnitDto,await wire('GET','/facilities/'+id(facilityId)+'/storage-units',{params:{page,limit:20},signal}));
    if(result.items.some(unit=>refId(unit.facilityId)!==facilityId)) throw new MobileInputError('Kho không thuộc cơ sở này.');
    return result;
  },
  async unit(facilityId:string,unitId:string,signal?:AbortSignal) {
    const unit=readData(liveUnitDto,await wire('GET','/storage-units/'+id(unitId),{signal}));
    if(unit._id!==unitId||refId(unit.facilityId)!==id(facilityId))throw new MobileInputError('Kho không thuộc cơ sở này.');
    return unit;
  },
  async monthlyAvailability(unitId:string,month:string,signal?:AbortSignal) {
    return mapAvailability(await wire('GET','/storage-units/'+id(unitId)+'/availability',{params:{month},signal}),unitId,month);
  },
  async bookingTerms(facilityId:string,unitSize:string,start:string,signal?:AbortSignal) {
    const at=Date.parse(day.parse(start)+'T00:00:00Z');
    const terms=new Map<string,z.infer<typeof term>>();
    for(let page=1;page<=100;page++){
      const {items,pagination}=readPage(priceOption,await wire('GET','/pricing-rules',{params:{
        facilityId:id(facilityId),serviceType:'SELF_STORAGE',unitSize,isActive:true,page,limit:100,
      },signal}));
      if(pagination.page!==page)throw new MobileInputError('Trang bảng giá không khớp.');
      for(const rule of items){
        if(refId(rule.facilityId)!==facilityId||rule.unitSize!==unitSize)throw new MobileInputError('Bảng giá không khớp với kho.');
        if(effectiveAt(rule,at)){
          terms.set(termKey(rule.term),rule.term);
        }
      }
      if(page>=pagination.totalPages)return [...terms.values()].sort((a,b)=>a.value-b.value);
    }
    throw new MobileInputError('Chưa tải được toàn bộ kỳ hạn.');
  },
  async quote(facilityId:string,unitId:string,input:unknown,signal?:AbortSignal) {
    const period=bookingPeriod.parse(input);
    if (Date.parse(period.start+'T00:00:00Z')<=Date.now() || rentalEndDate(period.start,{value:period.value,unit:period.unit})!==period.end) {
      throw new MobileInputError('Ngày thuê phải ở tương lai và khớp với kỳ hạn đã chọn.');
    }
    const unit=await mobileRepo.unit(facilityId,unitId,signal);
    if(unit.status!=='AVAILABLE'&&unit.status!=='HELD'&&unit.status!=='OCCUPIED') {
      throw new MobileInputError('Kho đã chọn không còn khả dụng.');
    }
    const startDate=period.start+'T00:00:00.000Z',endDate=period.end+'T00:00:00.000Z';
    const month=period.start.slice(0,7);
    const [availability,rawPrice]=await Promise.all([
      wire('GET','/storage-units/'+unitId+'/availability',{params:{month,startDate:period.start,endDate:period.end},signal}),
      wire('GET','/pricing-rules/resolve',{params:{facilityId,serviceType:'SELF_STORAGE',unitSize:unit.size,termValue:period.value,termUnit:period.unit,at:startDate},signal}),
    ]);
    const range=mapAvailability(availability,unitId,month,{startDate:period.start,endDate:period.end});
    if(range.availabilityState!=='VERIFIED'||range.rangeAvailability!=='AVAILABLE') throw new MobileInputError('Kho không còn trống trong kỳ thuê đã chọn.');
    const price=readData(priceOption,rawPrice);
    if(!effectiveAt(price,Date.parse(startDate))||refId(price.facilityId)!==facilityId||price.unitSize!==unit.size||price.term.value!==period.value||price.term.unit!==period.unit) {
      throw new MobileInputError('Bảng giá không khớp với kỳ thuê.');
    }
    const priceRequest={pricingPolicyId:price._id,startDate,endDate};
    const body=selfBookingBody({...priceRequest,facilityId,storageUnitId:unitId});
    const estimate=mapEstimate(await wire('POST','/reservations/estimate',{anonymous:true,body:priceRequest,signal}));
    return {body,estimate,unit};
  },
  async bookingPolicy(signal?: AbortSignal) {
    return readData(z.object({
      versionId: z.string().min(1), version: z.string().min(1), status: z.literal('PUBLISHED'),
      services: z.array(z.string()).refine(services => services.includes('SELF_STORAGE')),
      groups: z.array(z.object({
        id: z.string(), title: z.string(), appliesTo: z.array(z.string()),
        sections: z.object({SELF_STORAGE: z.array(z.string().trim().min(1)).optional()})
      })).refine(groups => {
        const applicable = groups.filter(group => group.appliesTo.includes('SELF_STORAGE'));
        return applicable.length > 0 && applicable.every(group => (group.sections.SELF_STORAGE?.length ?? 0) > 0);
      })
    }), await wire('GET','/public/terms/current',{anonymous:true,params:{serviceType:'SELF_STORAGE'},signal}));
  },
  async book(body:ReturnType<typeof selfBookingBody>,key:string,owner:string) {
    if (body.termsAccepted !== true || !body.termsVersionId) throw new MobileInputError('Cần chấp nhận điều khoản hiện hành.');
    const result=mapReservation(await wire('POST','/reservations',{body:selfBody.parse(body),key}),owner);
    if(result.serviceType!=='SELF_STORAGE'||result.rentalPaymentFlow!=='FULL_UPFRONT_V1'||refId(result.facilityId)!==body.facilityId||!result.storageUnitId||
       refId(result.storageUnitId)!==body.storageUnitId||Date.parse(result.startDate)!==Date.parse(body.startDate)||
       Date.parse(result.endDate)!==Date.parse(body.endDate)) throw new MobileInputError('Chưa xác minh được đơn thuê vừa tạo.');
    return result;
  },
  async rentals(owner:string,signal?:AbortSignal) {
    return mapReservations(await wire('GET','/reservations/me',{signal}),owner);
  },
  async rental(reservationId:string,owner:string,signal?:AbortSignal) {
    const target=id(reservationId);
    // Same Customer-scoped lookup as Web. The generic detail route compares a populated Customer document to an ID.
    const r=(await mobileRepo.rentals(owner,signal)).find(row=>row._id===target);
    if(!r)throw new MobileInputError('Không tìm thấy đơn thuê này trong tài khoản của bạn.');
    return r;
  },
  async contract(r:ReservationDto,owner:string,signal?:AbortSignal) {
    try {
      const c=mapContract(await wire('GET','/contracts/reservation/'+id(r._id),{signal}),owner,r.serviceType).contract;
      if(refId(c.reservationId)!==r._id) throw new MobileInputError('Hợp đồng không thuộc đơn thuê này.');
      return c;
    } catch(error) {
      if(axios.isAxiosError(error)&&error.response?.status===404) return null;
      throw error;
    }
  },
  async signSelfStorageContract(r:ReservationDto,contract:z.infer<typeof contractDto>,owner:string) {
    assertOwner(r,owner);
    assertOwner(contract,owner);
    if(r.serviceType!=='SELF_STORAGE'||r.rentalPaymentFlow==='FULL_UPFRONT_V1'||r.status!=='DEPOSIT_PAID'||contract.status!=='DRAFT'||refId(contract.reservationId)!==r._id){
      throw new MobileInputError('Đơn thuê hoặc hợp đồng chưa đủ điều kiện ký.');
    }
    const result=mapContract(await wire('PATCH','/contracts/'+id(contract._id)+'/sign'),owner,r.serviceType).contract;
    if(result._id!==contract._id||refId(result.reservationId)!==r._id||result.status!=='SIGNED'||
      typeof result.signedByCustomerAt!=='string'||!Number.isFinite(Date.parse(result.signedByCustomerAt))){
      throw new MobileInputError('Máy chủ chưa xác nhận được kết quả ký cho hợp đồng này.');
    }
    return result;
  },
  async contracts(owner:string,signal?:AbortSignal) {
    const rows=readData(z.array(contractDto),await wire('GET','/contracts/me',{signal}));
    rows.forEach(row=>assertOwner(row,owner));
    return rows;
  },
  async payments(r:ReservationDto,owner:string,signal?:AbortSignal) {
    assertOwner(r,owner);
    if(r.serviceType!=='SELF_STORAGE') throw new MobileInputError('Thanh toán PayOS chỉ dành cho kho tự quản.');
    const path='/reservations/'+id(r._id)+'/payments/';
    let cursor:string|null=null;
    const seen=new Set<string>();
    const items:ReturnType<typeof mapPaymentHistory>['items']=[];
    do {
      const page=mapPaymentHistory(await wire('GET',path+'payos',{params:{limit:25,...(cursor?{cursor}:{})},signal}),r._id);
      items.push(...page.items);
      cursor=page.nextCursor;
      if(cursor&&(seen.has(cursor)||seen.size>=99)) throw new MobileInputError('Chưa xác minh được toàn bộ lịch sử thanh toán.');
      if(cursor) seen.add(cursor);
    } while(cursor);
    return items;
  },
  async payment(r:ReservationDto,paymentId:string,owner:string,signal?:AbortSignal) {
    const result=mapSelfPayment(await wire('GET','/reservations/'+id(r._id)+'/payments/'+id(paymentId),{signal}),r,owner);
    if(result.id!==paymentId) throw new MobileInputError('Giao dịch không khớp.');
    return result;
  },
  async reconcilePayment(r: ReservationDto, paymentId: string, owner: string) {
    assertOwner(r, owner);
    if (r.serviceType !== 'SELF_STORAGE') throw new MobileInputError('Giao dịch không thuộc dịch vụ kho tự quản.');
    const result = mapSelfPayment(await wire('POST','/reservations/'+id(r._id)+'/payments/'+id(paymentId)+'/reconcile',{body:{}}), r, owner);
    if (result.id !== paymentId) throw new MobileInputError('Giao dịch không khớp.');
    return result;
  },
  async requestSelfStorageCheckout(r: ReservationDto, note: string, owner: string) {
    assertOwner(r, owner);
    if (r.serviceType !== 'SELF_STORAGE' || !['ACTIVE','OVERDUE'].includes(r.status) || r.checkoutRequest?.status === 'PENDING')
      throw new MobileInputError('Đơn thuê chưa đủ điều kiện yêu cầu trả kho.');
    const body = z.object({note:z.string().trim().max(500)}).parse({note});
    const result = mapReservation(await wire('POST','/reservations/'+id(r._id)+'/checkout-request',{body}),owner);
    if (result._id !== r._id || result.serviceType !== 'SELF_STORAGE' || result.checkoutRequest?.status !== 'PENDING')
      throw new MobileInputError('Máy chủ chưa xác nhận yêu cầu trả kho. Hãy tải lại đơn thuê.');
    return result;
  },
  async cancelUpfrontRental(r: ReservationDto, owner: string) {
    assertOwner(r, owner);
    if (r.serviceType !== 'SELF_STORAGE' || r.rentalPaymentFlow !== 'FULL_UPFRONT_V1' ||
        !['RESERVED','CONTRACTED'].includes(r.status) || r.customerCancellationEligible !== true)
      throw new MobileInputError('Máy chủ chưa xác nhận đủ điều kiện hủy đơn thuê.');
    const cancelled = mapReservation(await wire('PATCH','/reservations/'+id(r._id)+'/cancel'),owner);
    if (cancelled._id !== r._id || cancelled.status !== 'CANCELLED')
      throw new MobileInputError('Chưa xác minh được kết quả hủy. Hãy tải lại đơn thuê.');
    return cancelled;
  },
  async deposit(r:ReservationDto,key:string,owner:string) {
    return mobileRepo.checkout(r,key,owner,'DEPOSIT');
  },
  async checkout(r:ReservationDto,key:string,owner:string,purpose:z.infer<typeof payosBody>['purpose']) {
    assertOwner(r,owner);
    if(r.serviceType!=='SELF_STORAGE') throw new MobileInputError('Thanh toán PayOS chỉ dành cho kho tự quản.');
    const upfront = r.rentalPaymentFlow === 'FULL_UPFRONT_V1';
    if (upfront !== (purpose === 'FULL_RENT') || (upfront && r.status !== 'CONTRACTED'))
      throw new MobileInputError('Mục đích thanh toán không khớp với đơn thuê.');
    if(purpose==='BALANCE'&&r.status!=='CHECKIN_READY')throw new MobileInputError('Đơn thuê chưa đủ điều kiện thanh toán số dư.');
    const response=await wire('POST','/reservations/'+id(r._id)+'/payments/payos',{key,body:{purpose},clientPlatform:Platform.OS==='web'?undefined:'MOBILE'});
    z.object({outcome:z.enum(['CREATED','REPLAYED'])}).parse(response);
    const result=mapSelfPayment(response,r,owner);
    if(result.purpose!==purpose) throw new MobileInputError('Loại giao dịch không khớp.');
    return result;
  },
  async inventory(owner:string,page=1,signal?:AbortSignal) {
    const result=readPage(itemDto,await wire('GET','/inventory-items/me',{params:{page,limit:20},signal}));
    result.items.forEach(item=>assertOwner(item,owner));
    return result;
  },
  async item(itemId:string,owner:string,signal?:AbortSignal) {
    const item=mapItem(await wire('GET','/inventory-items/'+id(itemId),{signal}),owner);
    if(item._id!==itemId) throw new MobileInputError('Mã hàng không khớp.');
    return item;
  },
  async inventoryLedgerVersion(item:ReturnType<typeof mapItem>,owner:string,signal?:AbortSignal) {
    assertOwner(item,owner);
    const rental=await mobileRepo.rental(refId(item.managedReservationId),owner,signal);
    if(rental.serviceType!=='MANAGED_INVENTORY'||refId(rental.facilityId)!==refId(item.facilityId)) {
      throw new MobileInputError('Mặt hàng không thuộc đơn thuê ký gửi này.');
    }
    return rental.bookingFlowVersion===3?'V3':'LEGACY';
  },
  async inventoryOperation(item:ReturnType<typeof mapItem>,owner:string,key:string,signal?:AbortSignal) {
    if(!/^[A-Za-z0-9_.:\/-]{8,128}$/.test(key)||await mobileRepo.inventoryLedgerVersion(item,owner,signal)!=='V3') {
      throw new MobileInputError('Mã thao tác không hợp lệ cho sổ kho V3.');
    }
    const response=await wire('GET','/inventory-items/'+id(item._id)+'/v3/operations',{params:{key},signal});
    const operation=readData(z.object({status:z.literal('COMMITTED'),movement:z.unknown()}),response);
    const movement=mapV3Movements({success:true,data:[operation.movement]},item,owner)[0];
    if(!movement)throw new MobileInputError('Chưa xác minh được thao tác.');
    return movement;
  },
  async inventoryStock(item:ReturnType<typeof mapItem>,owner:string,signal?:AbortSignal) {
    if(await mobileRepo.inventoryLedgerVersion(item,owner,signal)==='V3'){
      return {kind:'V3' as const,stock:mapV3Stock(await wire('GET','/inventory-items/'+id(item._id)+'/v3/stock',{signal}),item,owner)};
    }
    return {kind:'LEGACY' as const,stock:await mobileRepo.stock(item,owner,signal)};
  },
  async inventoryMovements(item:ReturnType<typeof mapItem>,owner:string,signal?:AbortSignal) {
    if(await mobileRepo.inventoryLedgerVersion(item,owner,signal)==='V3'){
      return {kind:'V3' as const,rows:mapV3Movements(await wire('GET','/inventory-items/'+id(item._id)+'/v3/movements',{signal}),item,owner)};
    }
    return {kind:'LEGACY' as const,rows:await mobileRepo.movements(item,owner,signal)};
  },
  async stock(item:ReturnType<typeof mapItem>,owner:string,signal?:AbortSignal) {
    assertOwner(item,owner);
    const response=await wire('GET','/inventory-items/'+id(item._id)+'/stock-balance',{signal});
    const stock=mapStock(response,item,owner);
    return {...stock,availableQuantity:readData(z.object({availableQuantity:whole.optional()}),response).availableQuantity};
  },
  async movements(item:ReturnType<typeof mapItem>,owner:string,signal?:AbortSignal) {
    assertOwner(item,owner);
    return mapMovements(await wire('GET','/inventory-items/'+id(item._id)+'/movements',{signal}),item,owner);
  },
  async profile(owner:string,signal?:AbortSignal) {
    const profile=readData(identityProfile,await wire('GET','/customers/me/profile',{signal}));
    assertOwner({customerId:profile.userId},owner);
    return profile;
  },
  async updateAccount(owner:string,input:unknown) {
    id(owner);
    const updated=mapCurrentUser(await wire('PUT','/users/me/profile',{body:accountUpdate.parse(input)}));
    assertOwner({customerId:updated._id},owner);
    return updated;
  },
  async updateProfile(owner:string,input:unknown) {
    id(owner);
    const updated=readData(identityProfile,await wire('PUT','/customers/me/profile',{body:profileUpdate.parse(input)}));
    assertOwner({customerId:updated.userId},owner);
    return updated;
  },
  async notifications(owner:string,signal?:AbortSignal) {
    return mapNotifications(await wire('GET','/notifications/me',{signal}),owner);
  },
  async readNotification(notificationId:string,owner:string) {
    const response=await wire('PATCH','/notifications/'+id(notificationId)+'/read');
    return mapMarkOneRead(response,notificationId,owner);
  },
};
