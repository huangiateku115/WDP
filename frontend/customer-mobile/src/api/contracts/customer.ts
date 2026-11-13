import {z} from 'zod';
import {assertOwner,idRef,instant,nonnegative,objectId,readData,readPage,refId,reservationStatus,service,whole} from './core';

export const customerUser=z.object({_id:objectId,role:z.literal('CUSTOMER'),displayName:z.string().min(1),email:z.string().email(),phone:z.string().nullish(),isActive:z.boolean().optional()}).passthrough();
export const loginBody=z.object({email:z.string().trim().email(),password:z.string().min(1)}).strict();
export const logoutBody=z.object({refreshToken:z.string().min(1)}).strict();
export const registrationBody=z.object({email:z.string().trim().email(),password:z.string().min(8),displayName:z.string().trim().min(1),phone:z.string().trim().optional()}).strict();
export function buildRegistration(form:{name:string;email:string;password:string;phone?:string}){
  return registrationBody.parse({email:form.email,password:form.password,displayName:form.name,...(form.phone?.trim()?{phone:form.phone}:{})});
}
export function mapCurrentUser(response:unknown){const user=readData(customerUser,response);if(user.isActive===false)throw Error('Account inactive');return user;}
export function mapLogin(response:unknown){
  const result=readData(z.object({accessToken:z.string().min(1),refreshToken:z.string().min(1),user:customerUser}),response);
  if(result.user.isActive===false)throw Error('Account inactive');return result;
}
export const identityProfile=z.object({userId:idRef,verificationStatus:z.enum(['UNVERIFIED','PENDING','VERIFIED','REJECTED']),identityCard:z.string().nullish(),address:z.string().nullish(),taxCode:z.string().nullish()}).passthrough();
export const facilityDto=z.object({_id:objectId,name:z.string().min(1),serviceTypes:z.array(service).min(1),address:z.object({street:z.string().optional(),district:z.string().optional(),city:z.string().optional()}).passthrough(),images:z.array(z.string().url()).optional(),description:z.string().optional()}).passthrough();
export const reservationDto=z.object({_id:objectId,reservationCode:z.string().min(1),customerId:idRef,facilityId:idRef,storageUnitId:idRef.nullish(),serviceType:service,status:reservationStatus,
  rentalPaymentFlow:z.literal('FULL_UPFRONT_V1').optional(),customerCancellationEligible:z.boolean().optional(),signingDeadline:instant.nullish(),
  startDate:instant,endDate:instant,expiresAt:instant.nullish(),bookingFlowVersion:z.union([z.literal(1),z.literal(2),z.literal(3)]).optional(),
  checkoutRequest:z.object({requestedAt:instant.optional(),note:z.string().optional(),status:z.enum(['PENDING','COMPLETED','CANCELLED']).optional()}).nullish(),
  actualCheckoutDate:instant.nullish(),
  statusHistory:z.array(z.object({status:reservationStatus,reason:z.string().optional(),createdAt:instant.optional()})).optional(),
  allocatedCapacity:nonnegative.optional(),usedCapacityM3:nonnegative.optional(),allocatedCellIds:z.array(idRef).optional(),
  inventoryVersion:whole.optional(),activeClosureRequestId:objectId.nullish()}).passthrough();
export type ReservationDto=z.infer<typeof reservationDto>;
export function mapReservation(response:unknown,customerId:string){const r=readData(reservationDto,response);assertOwner(r,customerId);if(Date.parse(r.endDate)<=Date.parse(r.startDate))throw Error('Invalid rental period');return r;}
export function mapReservations(response:unknown,customerId:string){return readData(z.array(reservationDto),response).map(r=>{assertOwner(r,customerId);if(Date.parse(r.endDate)<=Date.parse(r.startDate))throw Error('Invalid rental period');return r;});}
export const mapFacilities=(response:unknown)=>readPage(facilityDto,response);
export const mapFacility=(response:unknown)=>readData(facilityDto,response);
export function lifecycle(r:Pick<ReservationDto,'serviceType'|'status'|'bookingFlowVersion'>){
  const self=r.serviceType==='SELF_STORAGE',v2=!self&&r.bookingFlowVersion===2,v3=!self&&r.bookingFlowVersion===3;
  const labels:Partial<Record<ReservationDto['status'],string>>=self?{
    RESERVED:'Đặt chỗ cũ · chờ xét duyệt',CONTRACTED:'Đã tạo đặt chỗ và hợp đồng nháp · chờ cọc',DEPOSIT_PAID:'Đã cấn trừ cọc · chờ xác minh hợp đồng giấy',CHECKIN_READY:'Đã xác minh hợp đồng giấy · chờ thanh toán số dư',PAID:'Đã thanh toán · chờ nhân viên bàn giao',ACTIVE:'Đang thuê · đã bàn giao',
  }:v3?{RESERVED:'Đang giữ ô · chờ thanh toán',PAID:'Đã thanh toán · chờ hợp đồng giấy',CHECKIN_READY:'Chờ bàn giao',ACTIVE:'Đang thuê ký gửi'}:v2?{RESERVED:'Đang giữ ô · chờ cọc',DEPOSIT_PAID:'Đã cọc · chuẩn bị hàng',CHECKIN_READY:'Đã hoàn tất hợp đồng và tiền thuê · chờ nhập lần đầu',ACTIVE:'Đang thuê · đã nhập lần đầu'}:{RESERVED:'Đặt chỗ ký gửi cũ · chờ duyệt',CONTRACTED:'Hợp đồng ký gửi cũ',PAID:'Đã thanh toán · chờ kích hoạt',ACTIVE:'Đang thuê ký gửi'};
  return {service:r.serviceType,flow:self?'SELF':v3?'MANAGED_V3':v2?'MANAGED_V2':'MANAGED_LEGACY',status:r.status,label:labels[r.status]??r.status,active:r.status==='ACTIVE'};
}
export function dashboardFromReservations(rows:ReservationDto[],owner:string){rows.forEach(r=>assertOwner(r,owner));return {active:rows.filter(r=>r.status==='ACTIVE'),attention:rows.filter(r=>['RESERVED','CONTRACTED','DEPOSIT_PAID','CHECKIN_READY'].includes(r.status)),count:rows.length};}
export function reservationIdentity(r:ReservationDto){return {id:r._id,facilityId:refId(r.facilityId),service:r.serviceType};}
