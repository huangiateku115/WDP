import {useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {LiveScreen,money} from '../components/liveUI';
import {AppText,Button,Card,StateCard} from '../components/ui';
import {apiIssue} from '../api/client';
import {nativePaymentReturnPath} from '../api/paymentReturnLink';
import {mobileRepo} from '../api/mobileRepository';
import {reconcilePaymentReturn,type RenewalPayment} from '../api/selfStorageRenewal';
import {managedPayment,managedPaymentApplied} from '../api/managedPaymentV3';
import {refId} from '../api/contracts/core';
import type {ReservationDto} from '../api/contracts/customer';
import {fullRentTerminal} from '../domain/livePayment';
import {useLiveSession} from '../state/useLiveSession';

export default function PayosPaymentReturn(){
  const router=useRouter();
  const params=useLocalSearchParams<{reservationId?:string;paymentId?:string;serviceType?:string;cancel?:string}>();
  const reservationId=typeof params.reservationId==='string'?params.reservationId:'';
  const paymentId=typeof params.paymentId==='string'?params.paymentId:'';
  const cancel=params.cancel==='true';
  const returnPath=nativePaymentReturnPath(reservationId,paymentId,params.serviceType,cancel);
  const owner=useLiveSession(s=>s.user?._id??''),restoring=useLiveSession(s=>s.restoring);
  const [result,setResult]=useState<{key:string; payment:Awaited<ReturnType<typeof mobileRepo.reconcilePayment>>|RenewalPayment|Awaited<ReturnType<typeof managedPayment.reconcile>>; reservation:ReservationDto}|null>(null);
  const payment = result?.key === owner+':'+returnPath ? result.payment : null;
  const [error,setError]=useState(''),[pending,setPending]=useState(false);
  const requestKey=useRef(''),busy=useRef(false);

  async function verify(){
    if(!returnPath||!owner||busy.current)return;
    const key=owner+':'+returnPath;
    if(requestKey.current===key)return;
    requestKey.current=key;
    busy.current=true;
    setPending(true);setError('');
    try{
      const reservation=await mobileRepo.rental(reservationId,owner);
      if(reservation.serviceType!==params.serviceType)throw new Error('Loại dịch vụ của đơn thuê không khớp với liên kết thanh toán.');
      if(useLiveSession.getState().user?._id!==owner)return;
      if(params.serviceType==='MANAGED_INVENTORY'){
        const current=await managedPayment.status(reservation,paymentId,owner);
        const payment=managedPaymentApplied(current)||fullRentTerminal(current)?current:await managedPayment.reconcile(reservation,paymentId,owner);
        if(useLiveSession.getState().user?._id!==owner)return;
        const refreshed=await mobileRepo.rental(reservationId,owner);
        if(refreshed.serviceType!=='MANAGED_INVENTORY')throw new Error('Không thể xác minh lại đơn kho ký gửi.');
        if(useLiveSession.getState().user?._id===owner)setResult({key,payment,reservation:refreshed});
      }else{
        const payment=await reconcilePaymentReturn(reservation,owner,paymentId);
        if(useLiveSession.getState().user?._id===owner)setResult({key,payment,reservation});
      }
    }catch(cause){
      if(useLiveSession.getState().user?._id===owner)setError(apiIssue(cause));
    }finally{busy.current=false;setPending(false);}
  }

  useEffect(()=>{
    if(restoring||!returnPath)return;
    if(!owner){router.replace({pathname:'/(auth)/login',params:{returnTo:returnPath}});return;}
    void verify();
  },[owner,restoring,returnPath]);

  const confirmedCancel=payment?.status==='CANCELLED'&&payment.checkoutStatus==='CANCELLED'&&!!payment.cancelVerifiedAt&&!payment.reconciliationRequired&&
    payment.providerSettlementStatus==='NOT_VERIFIED'&&payment.applicationStatus==='NOT_APPLIED';
  const applied=payment?.status==='SUCCEEDED'&&payment.providerSettlementStatus==='VERIFIED'&&
    payment.applicationStatus==='APPLIED'&&!payment.reconciliationRequired;
  const managedApplied=applied&&params.serviceType==='MANAGED_INVENTORY'&&result?.reservation.status==='PAID';
  const renewal=payment?.purpose==='RENEWAL';
  const detail = returnPath
    ? renewal?(`/rentals/${encodeURIComponent(reservationId)}/renewal` as Href):{pathname:'/rentals/[id]/payment' as const,params:{id:reservationId}}
    : '/rentals' as const;

  return <LiveScreen title="Kết quả thanh toán PayOS">
    {!returnPath?<StateCard kind="error" title="Liên kết thanh toán không hợp lệ" description="Không thể xác minh thông tin giao dịch được mở trong ứng dụng."/>:
      <Card>
        <AppText accessibilityLiveRegion="polite">{pending?'Đang xác minh giao dịch với máy chủ…':confirmedCancel?'Đã hủy thanh toán':applied&&renewal?'Đã xác minh thanh toán gia hạn. Gia hạn chỉ có hiệu lực sau khi cơ sở xác nhận phụ lục giấy.':params.serviceType==='MANAGED_INVENTORY'&&applied&&!managedApplied?'Thanh toán đã xác minh; đơn thuê đang được cập nhật. Hãy kiểm tra lại trạng thái đơn.':managedApplied?'Thanh toán đã được xác minh. Đơn thuê đang chờ hoàn tất hợp đồng giấy và bàn giao tại cơ sở.':applied?'Thanh toán đã được xác minh và ghi nhận.':cancel?'Chưa xác minh được trạng thái hủy. Thông tin từ đường dẫn không xác nhận giao dịch.':'Chưa xác minh được kết quả thanh toán. Hãy kiểm tra lại trạng thái.'}</AppText>
        {payment&&<AppText>{payment.purpose==='RENEWAL'?'Gia hạn hợp đồng':payment.purpose==='FULL_RENT'?'100% tiền thuê':payment.purpose==='DEPOSIT'?'Tiền đặt cọc':'Tiền thuê còn lại'} · {money(payment.amount)}</AppText>}
        {!!error&&<StateCard kind="error" title="Chưa thể kiểm tra giao dịch" description={error}/>}
        {!confirmedCancel&&!(params.serviceType==='MANAGED_INVENTORY'?managedApplied:applied)&&<Button label={pending?'Đang kiểm tra…':'Kiểm tra lại trạng thái'} disabled={pending} onPress={()=>{requestKey.current='';void verify();}}/>}
        <Button label={managedApplied?'Mở đơn thuê':applied&&payment?.purpose==='FULL_RENT'?'Xem hợp đồng':renewal?'Mở chi tiết gia hạn':'Mở chi tiết thanh toán'} variant="outline" onPress={()=>managedApplied&&result?.reservation.serviceType==='MANAGED_INVENTORY'?router.replace({pathname:'/managed/[facilityId]/confirmation',params:{facilityId:refId(result.reservation.facilityId),reservationId}}):applied&&payment?.purpose==='FULL_RENT'?router.replace({pathname:'/rentals/[id]/contract',params:{id:reservationId}}):router.replace(detail)}/>
      </Card>}
  </LiveScreen>;
}
