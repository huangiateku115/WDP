const SELF_STORAGE_SIGNING_WINDOW_MS=3*24*60*60*1000;

/** Existing Self Storage policy: three rolling days from confirmed full-rent payment. */
export function selfStorageSigningDeadline(paymentConfirmedAt:Date):Date{
  if(!(paymentConfirmedAt instanceof Date)||!Number.isFinite(paymentConfirmedAt.getTime()))
    throw new TypeError('A valid payment confirmation time is required');
  return new Date(paymentConfirmedAt.getTime()+SELF_STORAGE_SIGNING_WINDOW_MS);
}
