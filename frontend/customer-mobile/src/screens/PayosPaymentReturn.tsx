import {useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {LiveScreen,money} from '../components/liveUI';
import {AppText,Button,Card,StateCard} from '../components/ui';
import {apiIssue} from '../api/client';
import {nativePaymentReturnPath} from '../api/paymentReturnLink';
import {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';

export default function PayosPaymentReturn(){
  const router=useRouter();
  const params=useLocalSearchParams<{reservationId?:string;paymentId?:string;serviceType?:string;cancel?:string}>();
  const reservationId=typeof params.reservationId==='string'?params.reservationId:'';
  const paymentId=typeof params.paymentId==='string'?params.paymentId:'';
  const cancel=params.cancel==='true';
  const returnPath=nativePaymentReturnPath(reservationId,paymentId,params.serviceType,cancel);
  const owner=useLiveSession(s=>s.user?._id??''),restoring=useLiveSession(s=>s.restoring);
  const [result,setResult]=useState<{key:string; payment:Awaited<ReturnType<typeof mobileRepo.reconcilePayment>>}|null>(null);
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
      if(useLiveSession.getState().user?._id!==owner)return;
      const result=await mobileRepo.reconcilePayment(reservation,paymentId,owner);
      if(useLiveSession.getState().user?._id===owner)setResult({key,payment:result});
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
  const detail = returnPath
    ? {pathname:'/rentals/[id]/payment' as const,params:{id:reservationId}}
    : '/rentals' as const;

  return <LiveScreen title="Kết quả thanh toán PayOS">
    {!returnPath?<StateCard kind="error" title="Liên kết thanh toán không hợp lệ" description="Không thể xác minh thông tin giao dịch được mở trong ứng dụng."/>:
      <Card>
        <AppText accessibilityLiveRegion="polite">{pending?'Đang xác minh giao dịch với máy chủ…':confirmedCancel?'Đã hủy thanh toán':applied?'Thanh toán đã được xác minh và ghi nhận.':cancel?'Chưa xác minh được trạng thái hủy. Thông tin từ đường dẫn không xác nhận giao dịch.':'Chưa xác minh được kết quả thanh toán. Hãy kiểm tra lại trạng thái.'}</AppText>
        {payment&&<AppText>{payment.purpose==='FULL_RENT'?'100% tiền thuê':payment.purpose==='DEPOSIT'?'Tiền đặt cọc':'Tiền thuê còn lại'} · {money(payment.amount)}</AppText>}
        {!!error&&<StateCard kind="error" title="Chưa thể kiểm tra giao dịch" description={error}/>}
        {!confirmedCancel&&!applied&&<Button label={pending?'Đang kiểm tra…':'Kiểm tra lại trạng thái'} disabled={pending} onPress={()=>{requestKey.current='';void verify();}}/>}
        <Button label={applied && payment?.purpose==='FULL_RENT' ? 'Xem hợp đồng' : 'Mở chi tiết thanh toán'} variant="outline" onPress={()=>applied && payment?.purpose==='FULL_RENT' ? router.replace({pathname:'/rentals/[id]/contract',params:{id:reservationId}}) : router.replace(detail)}/>
      </Card>}
  </LiveScreen>;
}
