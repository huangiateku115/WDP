import client from './axiosClient';
import { validInventoryId } from '@/lib/inventoryRegistration';
import { depositKey } from '@/lib/customerDeposit';

export function depositMockEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_ENABLE_MANAGED_DEPOSIT_MOCK === 'true';
}

export function submitDevelopmentDeposit(reservationId, confirm = false) {
  if (!depositMockEnabled()) throw Error('Deposit simulation requires development and explicit opt-in.');
  if (!validInventoryId(reservationId)) throw Error('Invalid reservation ID.');
  const suffix = confirm ? '/mock-confirm' : '';
  return client.post(`/reservations/managed/${reservationId}/deposit${suffix}`, {
    idempotencyKey: depositKey(reservationId),
  });
}
