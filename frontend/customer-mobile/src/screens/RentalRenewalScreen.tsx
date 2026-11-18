import {useEffect,useRef,useState} from 'react';
import {AppState,Linking,Pressable,View} from 'react-native';
import {useRouter} from 'expo-router';
import {ResourceState,useResource} from '../components/liveUI';
import {ScreenHeading} from '../components/livePresentation';
import {mobileRepo} from '../api/mobileRepository';
import {assertOwner} from '../api/contracts/core';
import type {ReservationDto} from '../api/contracts/customer';
import {Screen,AppText,Button,Card,Chip,StateCard,ui} from '../components/ui';
import {dateLabel,money} from '../components/liveUI';
import {useLiveSession} from '../state/useLiveSession';
import {availableRenewalTerms,createRenewalPayment,createRenewalRequest,newAttempt,quoteRenewal,
  isRenewalPaymentApplied,reconcileRenewalPayment,renewalCheckoutUrl,renewalErrorMessage,renewalExtension,renewalPaymentJournal,renewalPaymentStatus,renewalRequestJournal,type RenewalExtension,type RenewalPayment,type RenewalTerm} from '../api/selfStorageRenewal';
import {colors} from '../theme/tokens';

type RenewalPage={reservation:ReservationDto;terms:RenewalTerm[];extension:RenewalExtension|null;payment:RenewalPayment|null};
const activeExtension=(r:ReservationDto)=>[...(r.extendContract??[])].reverse().find(e=>['PENDING_PAYMENT','PAID'].includes(e.status));
export default function RentalRenewalScreen({id}:{id:string}){
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();
  const load=async(signal:AbortSignal):Promise<RenewalPage>=>{
    const reservation=await mobileRepo.rental(id,owner,signal);assertOwner(reservation,owner);
    const inProgress=(reservation.extendContract??[]).filter(e=>['PENDING_PAYMENT','PAID'].includes(e.status));
    if(inProgress.length>1)throw Error('Có nhiều yêu cầu gia hạn đang mở. Không thể xác định giao dịch an toàn. Vui lòng liên hệ cơ sở.');
    const raw=activeExtension(reservation),parsed=raw?renewalExtension.safeParse(raw):null;
    const extension=parsed?.success?parsed.data:null;
    if(raw&&!extension)throw Error('Yêu cầu gia hạn hiện có chưa đủ dữ liệu để xác minh.');
    if(extension){
      const store=await renewalPaymentJournal(owner,extension._id),attempt=await store.read();
      const paymentId=extension.paymentId??attempt?.resourceId;
      const payment=paymentId?await renewalPaymentStatus(reservation,owner,extension,paymentId,signal):null;
      return {reservation,terms:[],extension,payment};
    }
    const terms=reservation.status==='ACTIVE'?await availableRenewalTerms(reservation,owner,signal):[];
    return {reservation,terms,extension:null,payment:null};
  };
  const data=useResource(owner+':renewal:'+id,load);
  const [selected,setSelected]=useState<RenewalTerm|null>(null),[quote,setQuote]=useState<Awaited<ReturnType<typeof quoteRenewal>>|null>(null);
  const [working,setWorking]=useState(false),[message,setMessage]=useState(''),[pageError,setPageError]=useState('');
  const busy=useRef(false),ownerRef=useRef(owner);ownerRef.current=owner;
  useEffect(()=>{setSelected(null);setQuote(null);setMessage('');setPageError('');},[id,owner]);
  const reservation=data.data?.reservation;
  const extension=data.data?.extension;
  const currentDate=reservation?dateLabel(reservation.endDate):'';
  const primaryFacility=typeof reservation?.facilityId==='object'&&'name' in reservation.facilityId?String(reservation.facilityId.name):'Kho tự quản';
  const payment= data.data?.payment??null;
  const paymentApplied=isRenewalPaymentApplied(payment);

  useEffect(()=>{
    if(!reservation||!extension||!payment?.id||paymentApplied||busy.current)return;
    const listener=AppState.addEventListener('change',state=>{
      if(state!=='active'||busy.current)return;
      void reconcileRenewalPayment(reservation,owner,extension,payment.id).then(fresh=>{
        if(ownerRef.current===owner){data.reload();if(fresh.status==='PENDING'&&fresh.checkoutStatus==='READY')setMessage('Thanh toán đang chờ xác nhận.');}
      }).catch(()=>{if(ownerRef.current===owner)setMessage('Chưa xác định được kết quả. Hãy kiểm tra giao dịch hiện có.');});
    });
    return ()=>listener.remove();
  },[reservation,extension,payment?.id,paymentApplied,owner]);

  async function loadQuote(term:RenewalTerm){
    if(!reservation||busy.current)return;busy.current=true;setWorking(true);setPageError('');setQuote(null);setSelected(term);
    try{const result=await quoteRenewal(reservation,owner,term);if(ownerRef.current===owner)setQuote(result);}
    catch(error){if(ownerRef.current===owner)setPageError(renewalErrorMessage(error));}
    finally{busy.current=false;setWorking(false);}
  }

  async function requestRenewal(){
    if(!reservation||!quote?.canExtend||!selected||busy.current)return;busy.current=true;setWorking(true);setPageError('');
    try{
      const store=await renewalRequestJournal(owner,id),previous=await store.read();
      const attempt=previous&&!previous.resourceId?previous:newAttempt();
      if((!previous||!!previous.resourceId)&&!await store.claim(attempt,previous?.key))throw Error('Yêu cầu gia hạn đang được xử lý. Hãy tải lại trạng thái.');
      const result=await createRenewalRequest(reservation,owner,selected,attempt.key);
      await store.write({...attempt,resourceId:result._id});
      if(ownerRef.current===owner){setMessage('Yêu cầu gia hạn đã được ghi nhận.');setQuote(null);data.reload();}
    }catch(error){if(ownerRef.current===owner)setPageError(renewalErrorMessage(error));}
    finally{busy.current=false;setWorking(false);}
  }

  async function startPayment(){
    if(!reservation||!extension||extension.status!=='PENDING_PAYMENT'||busy.current)return;busy.current=true;setWorking(true);setPageError('');
    try{
      const store=await renewalPaymentJournal(owner,extension._id);let attempt=await store.read();
      if(payment?.id){
        const existing=await renewalPaymentStatus(reservation,owner,extension,payment.id);
        const existingUrl=renewalCheckoutUrl(existing,id,extension._id);if(existingUrl){await Linking.openURL(existingUrl);return;}
        if(!(['FAILED','CANCELLED'].includes(existing.status)&&existing.retryAllowed===true&&!existing.reconciliationRequired)){
          const reconciled=await reconcileRenewalPayment(reservation,owner,extension,existing.id);
          setMessage(isRenewalPaymentApplied(reconciled)?'Thanh toán đã được xác minh. Gia hạn chỉ có hiệu lực sau khi cơ sở xác nhận phụ lục giấy.':'Chưa xác nhận được thanh toán. Đang giữ nguyên giao dịch hiện có.');data.reload();return;
        }
        await store.clear();attempt=null;
      }
      if(attempt?.resourceId){
        const existing=await renewalPaymentStatus(reservation,owner,extension,attempt.resourceId);
        const existingUrl=renewalCheckoutUrl(existing,id,extension._id);if(existingUrl){await Linking.openURL(existingUrl);return;}
        if(['FAILED','CANCELLED'].includes(existing.status)&&existing.retryAllowed===true&&!existing.reconciliationRequired){await store.clear();attempt=null;}
        else {
          const reconciled=await reconcileRenewalPayment(reservation,owner,extension,existing.id);
          setMessage(isRenewalPaymentApplied(reconciled)?'Thanh toán đã được xác minh. Gia hạn chỉ có hiệu lực sau khi cơ sở xác nhận phụ lục giấy.':'Chưa xác nhận được thanh toán. Đang giữ nguyên giao dịch hiện có.');
          data.reload();return;
        }
      }
      const next=attempt??newAttempt();
      if(!attempt&&!await store.claim(next))throw Error('Thanh toán đang được xử lý. Hãy kiểm tra trạng thái trước khi tiếp tục.');
      const created=await createRenewalPayment(reservation,owner,extension,next.key);
      await store.write({...next,resourceId:created.id});
      const checkoutUrl=renewalCheckoutUrl(created,id,extension._id);if(checkoutUrl)await Linking.openURL(checkoutUrl);
      else setMessage('Yêu cầu thanh toán đã được ghi nhận. Đang xác minh trạng thái giao dịch.');
      if(ownerRef.current===owner)data.reload();
    }catch(error){if(ownerRef.current===owner)setPageError(renewalErrorMessage(error));}
    finally{busy.current=false;setWorking(false);}
  }

  async function checkPayment(){
    if(!reservation||!extension||!payment?.id||busy.current)return;busy.current=true;setWorking(true);setPageError('');
    try{const fresh=await reconcileRenewalPayment(reservation,owner,extension,payment.id);if(ownerRef.current===owner){data.reload();setMessage(fresh.status==='SUCCEEDED'&&fresh.providerSettlementStatus==='VERIFIED'&&fresh.applicationStatus==='APPLIED'?'Thanh toán đã được xác minh. Gia hạn chỉ có hiệu lực sau khi cơ sở xác nhận phụ lục giấy.':'Chưa xác nhận được thanh toán.');}}
    catch(error){if(ownerRef.current===owner)setPageError(renewalErrorMessage(error));}
    finally{busy.current=false;setWorking(false);}
  }

  const retryAllowed=!!payment&&['FAILED','CANCELLED'].includes(payment.status)&&payment.retryAllowed===true&&!payment.reconciliationRequired;
  const paymentActionLabel=payment&&renewalCheckoutUrl(payment,id,extension?._id??'')?'Mở liên kết PayOS hiện có'
    :payment?(retryAllowed?'Tạo liên kết thanh toán mới':'Kiểm tra giao dịch hiện có'):'Tạo liên kết PayOS';
  const footer=reservation&&!data.loading&&!data.error?(
    extension?.status==='PENDING_PAYMENT'?<Button label={paymentActionLabel} loading={working} onPress={()=>void startPayment()}/>
    :extension?.status==='PAID'?<Button label="Kiểm tra trạng thái thanh toán" variant="outline" loading={working} onPress={()=>void checkPayment()}/>
    :quote?.canExtend?<Button label="Tạo yêu cầu gia hạn" loading={working} onPress={()=>void requestRenewal()}/>:<Button label="Chọn kỳ hạn để xem báo giá" disabled onPress={()=>{}}/>):undefined;

  return <Screen footer={footer} onRefresh={data.reload} refreshing={data.loading}>
    <ScreenHeading title="Gia hạn hợp đồng" eyebrow="KHO TỰ QUẢN" subtitle="Chọn thời hạn để tiếp tục sử dụng kho."/>
    <ResourceState {...data} resource="gia hạn"/>
    {reservation&&<Card>
      <AppText variant="card">{reservation.reservationCode}</AppText>
      <AppText>Cơ sở: {primaryFacility}</AppText>
      <AppText>Ngày hết hạn hiện tại: {currentDate}</AppText>
      <Chip label={reservation.status==='ACTIVE'?'Đang thuê':reservation.status}/>
    </Card>}
    {!!message&&<StateCard title={message}/>}
    {!!pageError&&<StateCard kind="error" title="Chưa thể tiếp tục" description={pageError} onRetry={data.reload}/>}
    {reservation&&!extension&&reservation.status==='ACTIVE'&&<Card>
      <AppText variant="card">Chọn kỳ hạn gia hạn</AppText>
      {!data.loading&&!data.error&&data.data?.terms.length===0&&<AppText>Hiện chưa có kỳ hạn gia hạn phù hợp cho đơn thuê này.</AppText>}
      <View style={ui.wrap}>{data.data?.terms.map(term=>{
        const label=`${term.value} ${term.unit==='DAY'?'ngày':term.unit==='YEAR'?'năm':'tháng'}`;
        const chosen=selected?.value===term.value&&selected.unit===term.unit;
        return <Pressable key={term.unit+term.value} accessibilityRole="button" accessibilityState={{selected:chosen}} onPress={()=>void loadQuote(term)} style={{minHeight:46,paddingHorizontal:15,justifyContent:'center',borderRadius:12,borderWidth:1,borderColor:chosen?colors.primary:colors.line,backgroundColor:chosen?colors.mint:colors.card}}><AppText variant="label" style={{color:chosen?colors.primary:colors.text}}>{label}</AppText></Pressable>;
      })}</View>
      {working&&!quote&&<AppText accessibilityLiveRegion="polite">Đang xác minh báo giá…</AppText>}
      {quote&&<View style={{gap:8}}>
        <AppText variant="label">Phí gia hạn: {money(quote.amount)}</AppText>
        <AppText>Thời hạn mới dự kiến: {dateLabel(quote.oldEndDate)} – {dateLabel(quote.newEndDate)}</AppText>
        {!quote.canExtend&&<AppText accessibilityRole="alert">{quote.reason||'Đơn thuê hiện chưa đủ điều kiện gia hạn.'}</AppText>}
        {quote.canExtend&&<AppText variant="caption" style={ui.muted}>Đơn thuê được gia hạn sau khi nhân viên xác nhận phụ lục hợp đồng giấy.</AppText>}
      </View>}
    </Card>}
    {reservation&&extension&&<Card>
      <AppText variant="card">{extension.status==='ACTIVE'?'Gia hạn thành công':`Yêu cầu ${extension.extensionCode}`}</AppText>
      <Chip label={extension.status==='PENDING_PAYMENT'?'Chờ thanh toán':extension.status==='PAID'?'Đã thanh toán · chờ ký phụ lục':extension.status==='ACTIVE'?'Đã gia hạn':extension.status==='CANCELLED'?'Đã hủy':'Không được chấp thuận'}/>
      <AppText>Kỳ hạn: {extension.durationMonths} tháng · {money(extension.amount)}</AppText>
      {!!extension.oldEndDate&&!!extension.newEndDate&&<AppText>{dateLabel(extension.oldEndDate)} – {dateLabel(extension.newEndDate)}</AppText>}
      {extension.status==='PENDING_PAYMENT'&&payment&&<>
        <AppText>PayOS: {payment.status==='PENDING'?'Đang chờ xác nhận':payment.status==='SUCCEEDED'&&payment.providerSettlementStatus==='VERIFIED'?'Đã xác minh thanh toán':payment.status==='FAILED'?'Thanh toán thất bại':payment.status==='CANCELLED'?'Đã hủy':'Đang đối soát'}</AppText>
        {(payment.status==='SUCCEEDED'||payment.providerSettlementStatus==='VERIFIED'||payment.applicationStatus==='MANUAL_REVIEW'||payment.reconciliationRequired)&&<Button label="Kiểm tra trạng thái giao dịch" variant="outline" loading={working} onPress={()=>void checkPayment()}/>}
      </>}
      {extension.status==='PAID'&&<AppText>Thanh toán đã được ghi nhận. Gia hạn chưa có hiệu lực cho đến khi cơ sở xác nhận phụ lục hợp đồng giấy.</AppText>}
      {extension.status==='ACTIVE'&&<AppText>Ngày hết hạn mới: {dateLabel(reservation.endDate)}.</AppText>}
      {extension.status==='REJECTED'&&<AppText>{extension.rejectionReason||'Cơ sở đã từ chối yêu cầu gia hạn.'}</AppText>}
      {payment&&payment.status!=='PENDING'&&<AppText>Trạng thái thanh toán: {payment.status==='SUCCEEDED'&&payment.providerSettlementStatus==='VERIFIED'&&payment.applicationStatus==='APPLIED'?'Đã xác minh và ghi nhận':payment.status==='FAILED'?'Không thành công':payment.status==='CANCELLED'?'Đã hủy':'Đang được kiểm tra'}</AppText>}
      {!!payment&&payment.status!=='PENDING'&&<Button label="Kiểm tra trạng thái giao dịch" variant="outline" loading={working} onPress={()=>void checkPayment()}/>}
    </Card>}
    {reservation?.status!=='ACTIVE'&&!extension&&reservation&&<StateCard title="Đơn thuê chưa đủ điều kiện gia hạn" description="Gia hạn hiện chỉ áp dụng cho đơn thuê đang còn hiệu lực."/>}
    {reservation?.extendContract?.filter(e=>!['PENDING_PAYMENT','PAID'].includes(e.status)).map((entry,index)=><Card key={entry._id??`${entry.status}:${index}`}>
      <AppText variant="card">{entry.status==='ACTIVE'?'Gia hạn thành công':'Lịch sử gia hạn'}</AppText><Chip label={entry.status==='ACTIVE'?'Đã gia hạn':entry.status==='CANCELLED'?'Đã hủy':entry.status==='REJECTED'?'Không được chấp thuận':'Đang cập nhật'}/>
      {!!entry.extensionCode&&<AppText>Mã gia hạn: {entry.extensionCode}</AppText>}
      {entry.durationMonths!==undefined&&<AppText>Kỳ hạn gia hạn: {entry.durationMonths} tháng</AppText>}
      {entry.amount!==undefined&&<AppText>Phí gia hạn: {money(entry.amount)}</AppText>}
      {!!entry.oldEndDate&&<AppText>Hạn thuê trước gia hạn: {dateLabel(entry.oldEndDate)}</AppText>}
      {!!entry.newEndDate&&<AppText>Hạn thuê sau gia hạn: {dateLabel(entry.newEndDate)}</AppText>}
      {!!entry.verifiedAt&&<AppText>Ngày xác nhận: {dateLabel(entry.verifiedAt)}</AppText>}
      {!!entry.rejectionReason&&<AppText>{entry.rejectionReason}</AppText>}
    </Card>)}
    <Button label="Quay lại chi tiết đơn thuê" variant="outline" onPress={()=>router.replace({pathname:'/preview/[kind]/[id]',params:{kind:'rental',id}})}/>
  </Screen>;
}
