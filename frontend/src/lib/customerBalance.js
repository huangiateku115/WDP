import {isV2Rental} from './managedIntake.js';
import {customerManagedContractState} from './customerManagedContractState.js';
import {inventoryId as id,validInventoryId} from './inventoryRegistration.js';

export const balanceKey=reservationId=>`wdp-balance-${reservationId}`;
export function customerBalanceState(reservation,contract,user){
  const disabled=reason=>({eligible:false,reason});
  if(!isV2Rental(reservation)||!validInventoryId(id(reservation)))return disabled('A verified Managed Inventory V2 reservation is required.');
  if(user?.role!=='CUSTOMER'||!validInventoryId(id(user))||id(reservation.customerId)!==id(user))return disabled('The reservation does not belong to this Customer identity.');
  const settled=typeof reservation.balanceSettledAt==='string'&&Number.isFinite(Date.parse(reservation.balanceSettledAt));
  if(['CHECKIN_READY','ACTIVE'].includes(reservation.status))return settled?{eligible:false,complete:true,reason:reservation.status==='ACTIVE'?'Rental activated after physical inbound.':'Balance payment confirmed. Awaiting first physical inbound.'}:disabled('Reservation stage and balance settlement timestamp are inconsistent. Refresh reservation; payment is disabled.');
  if(reservation.balanceSettledAt)return disabled('Balance settlement is recorded but the reservation stage is inconsistent. Refresh reservation; payment is disabled.');
  if(reservation.status!=='DEPOSIT_PAID')return disabled(`Reservation status ${reservation.status||'unknown'} does not permit Balance payment.`);
  const signature=customerManagedContractState(contract,reservation,user);
  if(signature.kind!=='SIGNED')return disabled(signature.kind==='PARTIALLY_SIGNED'?'Customer signed — Awaiting Facility signature':signature.reason||'Contract must be fully signed by Customer and Facility before Balance payment.');
  const amounts=reservation.managedPricingSnapshot?.amountBreakdown,currency=reservation.managedPricingSnapshot?.pricingRule?.currency;
  if(currency!=='VND'||!amounts||![amounts.totalDue,amounts.depositCredit,amounts.balanceDue].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER))return disabled('Backend financial breakdown or VND currency could not be verified.');
  const pricing=signature.progress.content.pricing;
  if(['totalDue','depositCredit','balanceDue'].some(k=>pricing[k]!==amounts[k]))return disabled('Reservation and signed contract amounts differ. Refresh before Balance payment.');
  return {eligible:true,amounts,currency,signature};
}

export function confirmedBalanceResult(result,reservation,user){
  const fail=()=>{throw Error('Balance response could not be verified. Use GET refresh; do not submit again.');};
  if(id(result?.reservation)!==id(reservation)||id(result.reservation.customerId)!==id(user)||!isV2Rental(result.reservation))return fail();
  const amount=reservation.managedPricingSnapshot.amountBreakdown.balanceDue;
  if(result.amount!==amount||result.currency!=='VND')return fail();
  if(result.zeroBalance===true&&amount===0&&result.payment===null&&result.reservation.status==='CHECKIN_READY'&&Number.isFinite(Date.parse(result.reservation.balanceSettledAt)))return 'SUCCEEDED';
  const p=result.payment;
  if(!validInventoryId(id(p))||id(p.reservationId)!==id(reservation)||id(p.customerId)!==id(user)||p.serviceType!=='MANAGED_INVENTORY'||p.purpose!=='BALANCE'||p.provider!=='MOCK'||p.amount!==amount||p.currency!=='VND'||p.idempotencyKey!==balanceKey(id(reservation))||!['PENDING','SUCCEEDED'].includes(p.status))return fail();
  if(p.status==='SUCCEEDED'&&(!['CHECKIN_READY','ACTIVE'].includes(result.reservation.status)||!Number.isFinite(Date.parse(result.reservation.balanceSettledAt))))return fail();
  if(p.status==='PENDING'&&(result.reservation.status!=='DEPOSIT_PAID'||result.reservation.balanceSettledAt))return fail();
  return p.status;
}

export function canMockConfirmBalance(reservation,contract,user,payment){
  const state=customerBalanceState(reservation,contract,user);
  if(!state.eligible||state.amounts.balanceDue<=0||payment?.status!=='PENDING')return false;
  try{return confirmedBalanceResult({reservation,payment,amount:payment.amount,currency:payment.currency},reservation,user)==='PENDING';}catch{return false;}
}

export function confirmedMockBalanceResult(result,reservation,user,pendingPayment){
  const payment=result?.payment,updated=result?.reservation;
  if(!isV2Rental(updated)||id(updated)!==id(reservation)||id(updated.customerId)!==id(user)||id(payment)!==id(pendingPayment)||payment?.status!=='SUCCEEDED'||updated.status!=='CHECKIN_READY'||!Number.isFinite(Date.parse(updated.balanceSettledAt)))throw Error('Mock Balance response could not be verified. Use GET refresh only.');
  if(payment.facilityId&&id(payment.facilityId)!==id(reservation.facilityId))throw Error('Mock Balance Facility does not match this reservation.');
  const amount=reservation.managedPricingSnapshot?.amountBreakdown?.balanceDue;
  if(id(payment.reservationId)!==id(reservation)||id(payment.customerId)!==id(user)||payment.serviceType!=='MANAGED_INVENTORY'||payment.purpose!=='BALANCE'||payment.provider!=='MOCK'||payment.amount!==amount||payment.currency!=='VND'||payment.idempotencyKey!==balanceKey(id(reservation)))throw Error('Mock Balance receipt does not match this reservation.');
  return 'SUCCEEDED';
}
