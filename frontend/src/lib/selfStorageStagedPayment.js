import {inventoryId as id,validInventoryId} from './inventoryRegistration.js';

export const usesSelfStorageStagedPayment=reservation=>reservation?.serviceType==='SELF_STORAGE'&&(
  ['RESERVED','DEPOSIT_PAID','CHECKIN_READY'].includes(reservation.status)||
  ['PAID','ACTIVE'].includes(reservation.status)&&(validInventoryId(id(reservation.depositPaymentId))||validInventoryId(id(reservation.balancePaymentId)))
);

// BE-REF reservation.controller.ts has no environment check for these callbacks.
// Do not equate a development Frontend with a verified development Backend.
export function selfStorageConfirmationPolicy(env={}){
  return {enabled:false,reason:env.DEV===true
    ?'Mock confirmation is disabled: the Backend development environment has not been verified and these endpoints have no environment gate. Contact the project team; no payment has been submitted.'
    :'Mock confirmation is unavailable in production. No real payment provider is integrated.'};
}
export function selfStorageStage(reservation,contract,user){
  if(reservation?.serviceType!=='SELF_STORAGE'||!validInventoryId(id(reservation))||user?.role!=='CUSTOMER'||!validInventoryId(id(user))||id(reservation.customerId)!==id(user))return {reason:'An owned Self Storage reservation is required.'};
  if(['PAID','ACTIVE'].includes(reservation.status))return {complete:true,reason:reservation.status==='ACTIVE'?'Rental active after handover.':'Payment recorded. Awaiting Staff handover; the rental is not active yet.'};
  if(reservation.status==='RESERVED')return {purpose:'DEPOSIT',eligible:true,reason:'Review the advance deposit amount returned by Backend. Initiation does not create or settle a payment.'};
  if(['DEPOSIT_PAID','CHECKIN_READY'].includes(reservation.status)){
    const paper=validInventoryId(id(contract))&&id(contract.reservationId)===id(reservation)&&id(contract.customerId)===id(user)&&contract.status==='SIGNED'&&typeof contract.signedProofUrl==='string'&&!!contract.signedProofUrl.trim();
    return {purpose:'BALANCE',eligible:paper,reason:paper?'Staff paper-signing proof is present. Review the remaining balance before confirmation.':'Deposit stage recorded. Visit the facility for paper contract signing; Staff must confirm the signed contract and upload proof before balance payment.'};
  }
  return {reason:'This reservation stage does not use the deposit/balance flow. No payment will be submitted.'};
}
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
export function selfStorageQuote(result,reservation,purpose){
  const b=result?.breakdown;
  if(!['DEPOSIT','BALANCE'].includes(purpose)||id(result?.reservationId)!==id(reservation)||result.purpose!==purpose||result.currency!=='VND'||!b||!['rentAmount','taxAmount','discountAmount','totalDue','depositCredit','balanceDue'].every(k=>amount(b[k]))||result.amount!==b[purpose==='DEPOSIT'?'depositCredit':'balanceDue']||b.rentAmount!==reservation.estimatedRent||b.depositCredit!==reservation.depositAmount||b.taxAmount!==(reservation.taxAmount||0)||b.discountAmount!==(reservation.discountAmount||0))throw Error('Backend payment amount could not be verified. Refresh before continuing.');
  if(purpose==='BALANCE'&&(!validInventoryId(id(result.contract))||typeof result.contract.signedProofUrl!=='string'||!result.contract.signedProofUrl.trim()))throw Error('Backend paper-signing proof could not be verified. Contact facility Staff.');
  return result;
}
export function selfStorageSettlement(result,reservation,purpose,quote,user){
  const r=result?.reservation,p=result?.payment,expected=purpose==='DEPOSIT'?'DEPOSIT_PAID':'PAID';
  if(!quote||quote.purpose!==purpose||id(r)!==id(reservation)||r?.serviceType!=='SELF_STORAGE'||id(r.customerId)!==id(user)||r.status!==expected||!validInventoryId(id(p))||id(p.reservationId)!==id(reservation)||id(p.customerId)!==id(user)||id(p.facilityId)!==id(reservation.facilityId)||p.serviceType!=='SELF_STORAGE'||p.purpose!==purpose||p.provider!=='MOCK'||p.status!=='SUCCEEDED'||!amount(p.amount)||p.amount<=0||p.amount!==quote.amount||p.currency!=='VND'||typeof p.idempotencyKey!=='string'||!p.idempotencyKey.trim()||!Number.isFinite(Date.parse(p.succeededAt))||id(r[purpose==='DEPOSIT'?'depositPaymentId':'balancePaymentId'])!==id(p))throw Error('Payment result is uncertain or inconsistent. Refresh Backend state; do not repeat confirmation.');
  return result;
}
