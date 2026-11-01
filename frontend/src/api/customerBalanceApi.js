import client from './axiosClient';
import {validInventoryId} from '@/lib/inventoryRegistration';

export const balanceMockEnabled=()=>import.meta.env?.DEV===true&&import.meta.env?.VITE_ENABLE_MANAGED_BALANCE_MOCK==='true';
export function confirmCustomerBalance(reservationId,idempotencyKey){
  if(!balanceMockEnabled())throw Error('Balance mock confirmation requires development and explicit frontend opt-in.');
  if(!validInventoryId(reservationId)||idempotencyKey!==`wdp-balance-${reservationId}`)throw Error('Invalid balance confirmation request.');
  return client.post(`/reservations/managed/${reservationId}/balance/mock-confirm`,{idempotencyKey});
}

// BE-REF reservation.routes.ts + managed-checkin.service.ts: Customer owner, development MOCK only.
export function initiateCustomerBalance(reservationId,idempotencyKey){
  if(!validInventoryId(reservationId)||typeof idempotencyKey!=='string'||!idempotencyKey.trim()||idempotencyKey.length>160)throw Error('Invalid balance payment request.');
  return client.post(`/reservations/managed/${reservationId}/balance`,{idempotencyKey});
}
