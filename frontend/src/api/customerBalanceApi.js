import client from './axiosClient';
import {validInventoryId} from '@/lib/inventoryRegistration';

// BE-REF reservation.routes.ts + managed-checkin.service.ts: Customer owner, development MOCK only.
export function initiateCustomerBalance(reservationId,idempotencyKey){
  if(!validInventoryId(reservationId)||typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>160)throw Error('Invalid balance payment request.');
  return client.post(`/reservations/managed/${reservationId}/balance`,{idempotencyKey});
}
