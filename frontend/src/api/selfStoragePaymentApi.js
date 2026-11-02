import client from './axiosClient';
import {validInventoryId} from '@/lib/inventoryRegistration';
import {selfStorageConfirmationPolicy} from '@/lib/selfStorageStagedPayment';

function path(reservationId,purpose){
  if(!validInventoryId(reservationId)||!['DEPOSIT','BALANCE'].includes(purpose))throw Error('Invalid Self Storage payment request.');
  return `/reservations/${reservationId}/${purpose.toLowerCase()}`;
}
export function initiateSelfStoragePayment(reservationId,purpose){
  // These controllers consume neither a body DTO nor an Idempotency-Key.
  // Initiation returns a breakdown only; it does not create a payment ledger entry.
  return client.post(path(reservationId,purpose),{});
}
export function confirmSelfStoragePayment(reservationId,purpose){
  const url=path(reservationId,purpose);
  const policy=selfStorageConfirmationPolicy(import.meta.env);
  if(!policy.enabled)throw Error(policy.reason);
  // Backend generates its own timestamp key; never invent a client retry key.
  return client.post(`${url}/mock-confirm`,{});
}
