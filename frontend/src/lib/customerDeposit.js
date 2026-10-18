import {inventoryId as id,validInventoryId} from './inventoryRegistration.js';
import {isV2Rental} from './managedIntake.js';
import {managedReservationFinancials} from './managedRentalPricing.js';

export const depositKey=reservationId=>`wdp-deposit-${reservationId}`;
export function customerDepositState(reservation,user,now=Date.now()){
  const disabled=reason=>({eligible:false,reason});
  if(!isV2Rental(reservation)||!validInventoryId(id(reservation)))return disabled('A verified Managed Inventory V2 reservation is required.');
  if(user?.role!=='CUSTOMER'||!validInventoryId(id(user))||id(reservation.customerId)!==id(user))return disabled('The reservation does not belong to this Customer identity.');
  let financials;
  try{financials=managedReservationFinancials(reservation);}catch{return disabled('Deposit pricing snapshot is missing or inconsistent. Refresh reservation; payment is disabled.');}
  if(financials.currency!=='VND'||financials.advanceDepositRequired<=0)return disabled('A positive Backend-confirmed VND advance-rent deposit is required.');
  if(['DEPOSIT_PAID','CHECKIN_READY','ACTIVE'].includes(reservation.status))return {eligible:false,complete:true,financials,reason:'Deposit Paid'};
  if(reservation.status!=='RESERVED')return disabled(`Reservation status ${reservation.status||'unknown'} does not permit Deposit payment.`);
  if(typeof reservation.expiresAt!=='string'||!Number.isFinite(Date.parse(reservation.expiresAt))||Date.parse(reservation.expiresAt)<=now)return disabled('The reservation hold has expired or cannot be verified. Deposit payment is disabled.');
  return {eligible:true,financials};
}

// Only interpret the confirmed initiation envelope. SUCCEEDED is not a reservation transition.
export function confirmedDepositResult(result,reservation,user){
  const p=result?.payment,amount=reservation.managedPricingSnapshot?.amountBreakdown?.depositCredit;
  if(id(result?.reservationId)!==id(reservation)||result.amount!==amount||result.currency!=='VND'||!validInventoryId(id(p))||id(p.reservationId)!==id(reservation)||id(p.customerId)!==id(user)||id(p.facilityId)!==id(reservation.facilityId)||p.serviceType!=='MANAGED_INVENTORY'||p.purpose!=='DEPOSIT'||p.provider!=='MOCK'||p.amount!==amount||p.currency!=='VND'||p.idempotencyKey!==depositKey(id(reservation))||!['PENDING','SUCCEEDED','RECONCILIATION_REQUIRED'].includes(p.status))throw Error('Deposit initiation response could not be verified. Use GET refresh only; do not submit again.');
  return p.status;
}

export function canMockConfirmDeposit(reservation,user,payment,now=Date.now()){
  if(!customerDepositState(reservation,user,now).eligible||payment?.status!=='PENDING')return false;
  try{return confirmedDepositResult({payment,reservationId:id(reservation),amount:payment.amount,currency:payment.currency},reservation,user)==='PENDING';}catch{return false;}
}

export function confirmedDepositMockResult(result,reservation,user,pendingPayment){
  const p=result?.payment,r=result?.reservation;
  if(!isV2Rental(r)||id(r)!==id(reservation)||id(r.customerId)!==id(user)||id(p)!==id(pendingPayment)||!['SUCCEEDED','RECONCILIATION_REQUIRED'].includes(p?.status))throw Error('Mock confirmation response could not be verified. Use GET refresh only.');
  const status=confirmedDepositResult({payment:p,reservationId:id(r),amount:p.amount,currency:p.currency},reservation,user);
  if(result.reconciliationRequired===true||status==='RECONCILIATION_REQUIRED')return 'RECONCILIATION_REQUIRED';
  if(r.status!=='DEPOSIT_PAID')throw Error('Mock confirmation did not return DEPOSIT_PAID. Use GET refresh only.');
  return status;
}
