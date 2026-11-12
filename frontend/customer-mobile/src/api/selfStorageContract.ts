import {MobileInputError} from './client';
import {mobileRepo} from './mobileRepository';
import {readRentalPayment} from './selfStoragePayment';
import {reservationProgress} from '../domain/reservationProgress';
import {reviewFingerprint} from '../domain/contractReview';

export async function loadContractReview(id:string,owner:string,signal?:AbortSignal){
  const reservation=await mobileRepo.rental(id,owner,signal);
  if(reservation.serviceType!=='SELF_STORAGE'){
    return {reservation,contract:await mobileRepo.contract(reservation,owner,signal),canSign:false,reason:''};
  }
  if (reservation.rentalPaymentFlow === 'FULL_UPFRONT_V1') {
    const contract = await mobileRepo.contract(reservation,owner,signal);
    return {reservation,contract,canSign:false,reason:''};
  }
  const {contract,payments,decision}=await readRentalPayment(reservation,owner,signal,true);
  const progress=reservationProgress(reservation,{contract,payments,decision:decision.kind});
  return {reservation,contract,canSign:progress?.next?.action?.intent==='SIGN',
    reason:progress?.next?.description??'Chưa thể xác minh điều kiện ký.'};
}

export async function submitReviewedContract(review:Awaited<ReturnType<typeof loadContractReview>>,owner:string,isCurrent:()=>boolean){
  if(!review.canSign||!review.contract||!isCurrent())return;
  const latest=await loadContractReview(review.reservation._id,owner);
  if(!isCurrent())return;
  if(!latest.canSign||!latest.contract||
    reviewFingerprint(review.contract,review.reservation)!==reviewFingerprint(latest.contract,latest.reservation)){
    throw new MobileInputError('Nội dung hoặc điều kiện ký đã thay đổi. Vui lòng đọc lại hợp đồng mới nhất.');
  }
  return mobileRepo.signSelfStorageContract(latest.reservation,latest.contract,owner);
}
