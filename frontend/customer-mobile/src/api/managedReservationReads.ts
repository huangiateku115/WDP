import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {assertOwner,idRef,instant,objectId,readData,refId,whole} from './contracts/core';
import type {ReservationDto} from './contracts/customer';

const purpose=z.enum(['INBOUND','OUTBOUND','RELOCATION','INSPECTION']);
const common={_id:objectId,reservationId:idRef,customerId:idRef,facilityId:idRef,revision:whole};
const visitDto=z.object({...common,purpose,startsAt:instant,endsAt:instant,note:z.string().nullish(),
  assignedStaffId:idRef.nullish(),status:z.enum(['SCHEDULED','CHECKED_IN','COMPLETED','CANCELLED'])});
const visitAvailabilityDto=z.object({timeZone:z.literal('Asia/Ho_Chi_Minh'),slotDurationMinutes:whole.min(1),
  capacityBasis:z.string().min(1),staffAssignmentRequired:z.literal(true),
  slots:z.array(z.object({startsAt:instant,endsAt:instant}).strict())});
const visitCreateBody=z.object({reservationId:objectId,purpose,startsAt:instant,endsAt:instant,note:z.string().trim().max(500).optional()}).strict();
export type ManagedVisit=z.infer<typeof visitDto>;
export type ManagedVisitCreate=z.infer<typeof visitCreateBody>;
const sessionDto=z.object({...common,visitId:idRef,assignedStaffId:idRef,allowedCellIds:z.array(idRef),allowedPurposes:z.array(purpose),
  startedAt:instant,expiresAt:instant,status:z.enum(['ACTIVE','CHECKED_OUT','REVOKED','EXPIRED'])});
const readinessDto=z.object({
  reservationId:objectId,serviceType:z.literal('MANAGED_INVENTORY'),readonly:z.literal(true),
  overallReadiness:z.enum(['UNKNOWN','BLOCKED','READY']),
  stockSummary:z.object({currentQuantity:whole.nullish(),heldQuantity:whole.nullish()}).optional(),
  outstandingRequestSummary:z.object({inbound:z.object({unresolvedCount:whole.nullish()}),
    outbound:z.object({unresolvedCount:whole.nullish()})}).optional(),
  blockers:z.array(z.object({code:z.string(),scope:z.string(),message:z.string()})),
});

function scope(r:ReservationDto,owner:string){
  assertOwner(r,owner);
  if(r.serviceType!=='MANAGED_INVENTORY'||r.bookingFlowVersion!==3)throw new MobileInputError('Đơn thuê không thuộc kho ký gửi V3.');
}

export function mapManagedAccessRows<T extends {customerId:z.infer<typeof idRef>;reservationId:z.infer<typeof idRef>;facilityId:z.infer<typeof idRef>}>(
  rows:T[],r:ReservationDto,owner:string,
){
  scope(r,owner);
  for(const row of rows)assertOwner(row,owner);
  const matches=rows.filter(row=>refId(row.reservationId)===r._id);
  if(matches.some(row=>refId(row.facilityId)!==refId(r.facilityId)))throw new MobileInputError('Dữ liệu truy cập không thuộc cơ sở của đơn thuê.');
  return matches;
}

export const managedReservationReads={
  async visitAvailability(r:ReservationDto,owner:string,date:string,signal?:AbortSignal){
    scope(r,owner);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['CHECKIN_READY','ACTIVE'].includes(r.status)||Date.parse(r.endDate)<=Date.now())
      throw new MobileInputError('Đơn thuê chưa đủ điều kiện đặt lịch đến kho.');
    return readData(visitAvailabilityDto,await wire('GET','/access/managed-v3/visits/availability',{
      params:{reservationId:r._id,date},signal,
    }));
  },
  async createVisit(r:ReservationDto,owner:string,body:ManagedVisitCreate,key:string){
    scope(r,owner);
    const payload=visitCreateBody.parse(body);
    if(payload.reservationId!==r._id)throw new MobileInputError('Lịch đến kho không thuộc đơn thuê này.');
    const [created]=mapManagedAccessRows([readData(visitDto,await wire('POST','/access/managed-v3/visits',{body:payload,key}))],r,owner);
    if(!created||created.purpose!==payload.purpose||created.startsAt!==payload.startsAt||created.endsAt!==payload.endsAt||created.status!=='SCHEDULED')
      throw new MobileInputError('Chưa xác minh được lịch đến kho vừa tạo.');
    return created;
  },
  async visits(r:ReservationDto,owner:string,signal?:AbortSignal){
    scope(r,owner);
    return mapManagedAccessRows(readData(z.array(visitDto),await wire('GET','/access/managed-v3/visits/me',{signal})),r,owner);
  },
  async visit(r:ReservationDto,owner:string,visitId:string,signal?:AbortSignal){
    scope(r,owner);
    const [row]=mapManagedAccessRows([readData(visitDto,await wire('GET','/access/managed-v3/visits/'+objectId.parse(visitId),{signal}))],r,owner);
    if(!row)throw new MobileInputError('Không tìm thấy lịch đến kho này.');
    return row;
  },
  async amendVisit(r:ReservationDto,owner:string,visit:ManagedVisit,body:Partial<ManagedVisitCreate>,key:string){
    if(!mapManagedAccessRows([visit],r,owner).length||visit.status!=='SCHEDULED')throw new MobileInputError('Lịch không còn đủ điều kiện sửa.');
    const payload=z.object({purpose:purpose.optional(),startsAt:instant.optional(),endsAt:instant.optional(),note:z.string().trim().max(500).optional()}).strict().parse(body);
    if(!Object.keys(payload).length)throw new MobileInputError('Chưa có thay đổi lịch để lưu.');
    const [updated]=mapManagedAccessRows([readData(visitDto,await wire('PATCH','/access/managed-v3/visits/'+visit._id,{body:payload,key,ifMatch:visit.revision}))],r,owner);
    if(!updated||updated._id!==visit._id||updated.status!=='SCHEDULED'||updated.revision<=visit.revision)
      throw new MobileInputError('Chưa xác minh được lịch đã cập nhật.');
    return updated;
  },
  async cancelVisit(r:ReservationDto,owner:string,visit:z.infer<typeof visitDto>){
    if(!mapManagedAccessRows([visit],r,owner).length||visit.status!=='SCHEDULED')throw new MobileInputError('Lịch không thể hủy.');
    const response=await wire('POST','/access/managed-v3/visits/'+visit._id+'/cancel',{body:{},ifMatch:visit.revision});
    const [updated]=mapManagedAccessRows([readData(visitDto,response)],r,owner);
    if(updated?._id!==visit._id||updated.status!=='CANCELLED')throw new MobileInputError('Chưa xác minh được việc hủy lịch.');
    return updated;
  },
  async sessions(r:ReservationDto,owner:string,signal?:AbortSignal){
    scope(r,owner);
    return mapManagedAccessRows(readData(z.array(sessionDto),await wire('GET','/access/managed-v3/sessions/me',{signal})),r,owner);
  },
  async readiness(r:ReservationDto,owner:string,signal?:AbortSignal){
    scope(r,owner);
    const dto=readData(readinessDto,await wire('GET','/reservations/managed/'+objectId.parse(r._id)+'/closure-readiness',{signal}));
    if(dto.reservationId!==r._id)throw new MobileInputError('Đánh giá không thuộc đơn thuê.');
    return dto;
  },
};
