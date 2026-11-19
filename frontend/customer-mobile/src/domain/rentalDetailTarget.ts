import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';

export function rentalDetailTarget(r:Pick<ReservationDto,'_id'|'facilityId'|'serviceType'>){
  return r.serviceType==='MANAGED_INVENTORY'
    ?{pathname:'/managed/[facilityId]/confirmation' as const,params:{facilityId:refId(r.facilityId),reservationId:r._id}}
    :{pathname:'/preview/[kind]/[id]' as const,params:{kind:'rental',id:r._id}};
}
