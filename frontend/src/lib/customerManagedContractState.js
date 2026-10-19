import {currentManagedContract,maySignManaged} from './managedIntake.js';
import {inventoryId} from './inventoryRegistration.js';

// Customer presentation only; retain the existing shared Backend signature checks.
export function customerManagedContractState(contract,reservation,user){
  let progress;
  try{progress=currentManagedContract(contract,reservation);}
  catch(error){
    const active=Array.isArray(contract?.contentVersions)?contract.contentVersions.find(v=>v?.version===contract.currentContentVersion):null;
    const staleSigned=contract?.status==='SIGNED'&&active&&Array.isArray(contract.signatures)&&!['CUSTOMER','FACILITY'].every(party=>contract.signatures.some(s=>s?.version===contract.currentContentVersion&&s?.contentHash===active.contentHash&&(party==='CUSTOMER'?s.signerRole==='CUSTOMER':['FACILITY_STAFF','FACILITY_MANAGER'].includes(s.signerRole))));
    return {kind:'INVALID',canSign:false,reason:staleSigned?'Backend reports SIGNED, but both valid signatures do not match the current version and content hash. Refresh contract; signing is disabled.':error instanceof TypeError?'Contract version, snapshot or signature data could not be verified. Refresh contract; signing is disabled.':error.message};
  }
  if(user?.role!=='CUSTOMER'||!inventoryId(user)||inventoryId(user)!==inventoryId(contract.customerId))return {kind:'INELIGIBLE',canSign:false,reason:'The signed-in Customer identity does not match this contract owner.'};
  if(contract.status==='SIGNED'&&progress.customer&&progress.facility)return {kind:'SIGNED',canSign:false,progress,message:'Contract fully signed by Customer and Facility.'};
  if(contract.status==='DRAFT'&&progress.customer&&!progress.facility)return {kind:'PARTIALLY_SIGNED',canSign:false,progress,message:'Customer signed — Awaiting Facility signature'};
  const stale=contract.signatures.some(s=>s.version!==progress.version||s.contentHash!==progress.hash);
  const notice=stale?'Signatures from another version or content hash do not sign the current contract. Review the current version before signing.':'';
  if(!['DRAFT','SIGNED'].includes(contract.status))return {kind:'INELIGIBLE',canSign:false,progress,notice,reason:`Contract status is ${contract.status}. Customer signing is unavailable.`};
  if(!maySignManaged(contract,reservation,user))return {kind:'INELIGIBLE',canSign:false,progress,notice,reason:`Reservation status ${reservation?.status||'not verified'} is not eligible for Customer signing. A verified DEPOSIT_PAID or CHECKIN_READY V2 reservation is required.`};
  return {kind:'DRAFT',canSign:true,progress,notice,message:'Review the current Backend-confirmed contract before signing during direct check-in/intake.'};
}
