import {isV2Rental} from './managedIntake.js';
import {customerManagedContractState} from './customerManagedContractState.js';
import {inventoryId as id,validInventoryId} from './inventoryRegistration.js';

export const balanceKey=reservationId=>`wdp-balance-${reservationId}`;
// Confirmation omits the outer amount/currency present in initiation responses.
export function confirmedBalanceSettlement(result,reservation,user,payment){
  if(!payment||id(result?.payment)!==id(payment)||result?.payment?.status!=='SUCCEEDED'||!Number.isFinite(Date.parse(result.payment.succeededAt)))throw Error('Balance settlement response could not be verified. Refresh before retrying.');
  return confirmedBalanceResult({...result,amount:result.payment.amount,currency:result.payment.currency},reservation,user);
}
export function verifiedPendingBalance(payment,reservation,user){
  try{return payment?.status==='PENDING'&&confirmedBalanceResult({reservation,payment,amount:payment.amount,currency:payment.currency},reservation,user)==='PENDING';}catch{return false;}
}
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
