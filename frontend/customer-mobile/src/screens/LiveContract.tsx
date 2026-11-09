import {CardHeading,TintedPanel} from '../components/livePresentation';
import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {Linking} from 'react-native';
import {useLocalSearchParams} from 'expo-router';
import {apiIssue} from '../api/client';
import {loadContractReview,submitReviewedContract} from '../api/selfStorageContract';
import {contractText,reviewDocument,reviewFingerprint} from '../domain/contractReview';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard} from '../components/ui';
import {dateLabel,LiveScreen,money,ResourceState,useResource} from '../components/liveUI';

export function Contract(){
  const {id}=useLocalSearchParams<{id:string}>();
  const owner=useLiveSession(s=>s.user?._id??'');
  return <ContractReview key={owner+':'+id} id={id} owner={owner}/>;
}

function ContractReview({id,owner}:{id:string;owner:string}){
  const name=useLiveSession(s=>s.user?.displayName);
  const [revision,setRevision]=useState(0),[confirmation,setConfirmation]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [confirmedId,setConfirmedId]=useState(''),[openedDocument,setOpenedDocument]=useState('');
  const busy=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const data=useResource(owner+':'+id+':'+revision,signal=>loadContractReview(id,owner,signal));
  const review=data.data,contract=review?.contract;
  const document=contract&&reviewDocument(contract);
  const reviewed=contract&&review?reviewFingerprint(contract,review.reservation):'';
  const needsPdf=!!document?.pdf&&!document.content&&!document.terms.length;
  const canSign=!!(review?.canSign&&contract&&confirmedId!==contract._id);
  const confirming=!!reviewed&&confirmation===reviewed;
  const canConfirm=canSign&&(!needsPdf||openedDocument===reviewed);

  function refresh(){
    if(!busy.current){setConfirmation('');setRevision(value=>value+1);}
  }
  async function openPdf(url:string){
    try{await Linking.openURL(url);setOpenedDocument(reviewed);}
    catch{setError('Không mở được tài liệu hợp đồng. Vui lòng thử lại.');}
  }
  async function sign(){
    if(busy.current||!confirming||!canConfirm||!review)return;
    busy.current=true;setPending(true);setError('');setNotice('');
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    try{
      const signed=await submitReviewedContract(review,owner,current);
      if(signed&&current()){
        setConfirmedId(signed._id);
        setNotice('Backend đã ghi nhận chữ ký. Đang tải lại trạng thái xác minh.');
      }
    }catch(cause){
      if(current()){
        const uncertain=axios.isAxiosError(cause)&&(!cause.response||cause.response.status>=500);
        setError(uncertain?'Kết quả yêu cầu ký chưa rõ. Chỉ thử lại nếu dữ liệu mới nhất vẫn là bản nháp.':apiIssue(cause));
      }
    }finally{
      busy.current=false;
      if(current()){
        setConfirmation('');setPending(false);setOpenedDocument('');
        setRevision(value=>value+1);
      }
    }
  }

  const signedAt=contractText(contract?.signedByCustomerAt);
  const signatureRecorded=contract?.status==='SIGNED'&&!!signedAt&&Number.isFinite(Date.parse(signedAt));
  if(review&&review.reservation.serviceType!=='SELF_STORAGE'){
    return <LiveScreen title="Hợp đồng" eyebrow="HỒ SƠ THUÊ · HỢP ĐỒNG" onRefresh={refresh} refreshing={data.loading}>
      {contract?<Card><CardHeading icon="document-text-outline" title={contractText(contract.contractCode)??'Hợp đồng thuê kho'}/>
        <AppText>{({DRAFT:'Bản nháp',SIGNED:'Đã ký',TERMINATED:'Đã chấm dứt',EXPIRED:'Đã hết hạn'})[contract.status]}</AppText>
        <AppText>Ứng dụng hiện hỗ trợ xem trạng thái hợp đồng.</AppText>
      </Card>:<StateCard title="Chưa có hợp đồng cho đơn thuê"/>}
    </LiveScreen>;
  }
  return <LiveScreen title="Hợp đồng" eyebrow="HỒ SƠ THUÊ · HỢP ĐỒNG" onRefresh={refresh} refreshing={data.loading}>
    <ResourceState {...data}/>
    {error&&!signatureRecorded?<StateCard kind="error" title="Kết quả yêu cầu ký" description={error}/>:null}
    {notice?<TintedPanel><AppText accessibilityLiveRegion="polite">{notice}</AppText></TintedPanel>:null}
    {review&&contract===null&&<StateCard title="Chưa có hợp đồng cho đơn thuê"/>}
    {review&&contract&&<Card>
      <CardHeading icon="document-text-outline" title={contractText(contract.contractCode)??'Hợp đồng thuê kho'}/>
      <AppText>Trạng thái: {({DRAFT:'Bản nháp',SIGNED:'Đã ký',TERMINATED:'Đã chấm dứt',EXPIRED:'Đã hết hạn'})[contract.status]}</AppText>
      <AppText>Khách hàng: {contractText(contract.customerSnapshot?.fullName)??name??'Chưa cung cấp'}</AppText>
      <AppText>Đơn thuê: {review.reservation.reservationCode}</AppText>
      <AppText>Kỳ thuê: {dateLabel(review.reservation.startDate)} – {dateLabel(review.reservation.endDate)}</AppText>
      {typeof contract.pricingSnapshot?.estimatedRent==='number'&&Number.isFinite(contract.pricingSnapshot.estimatedRent)&&
        <AppText>Tiền thuê theo hợp đồng: {money(contract.pricingSnapshot.estimatedRent)}</AppText>}
      {typeof contract.pricingSnapshot?.depositAmount==='number'&&Number.isFinite(contract.pricingSnapshot.depositAmount)&&
        <AppText>Tiền cọc theo hợp đồng: {money(contract.pricingSnapshot.depositAmount)}</AppText>}
      {signatureRecorded&&signedAt?<AppText>Thời điểm Customer ký: {dateLabel(signedAt)}</AppText>:null}
      {document?.content?<AppText selectable>{document.content}</AppText>:null}
      {document?.terms.map((term,index)=><AppText selectable key={index}>{index+1}. {term}</AppText>)}
      {document?.pdf&&<Button label="Mở tài liệu hợp đồng" variant="outline" disabled={pending} onPress={()=>void openPdf(document.pdf!)}/>}
      {!document?.available&&<AppText>Backend chỉ cung cấp bản tóm tắt, chưa có nội dung điều khoản hoặc tài liệu để đọc.</AppText>}
      {review.reason?<AppText>{review.reason}</AppText>:null}
      {canSign&&!confirming&&<Button label="Ký hợp đồng" disabled={!canConfirm||pending} onPress={()=>{setConfirmation(reviewed);setError('');}}/>}
      {canSign&&confirming&&<>
        <AppText>Bạn xác nhận đã đọc nội dung và đồng ý gửi yêu cầu ký hợp đồng này?</AppText>
        <Button label="Xác nhận ký" loading={pending} disabled={!canConfirm} onPress={()=>void sign()}/>
        <Button label="Hủy xác nhận" variant="quiet" disabled={pending} onPress={()=>setConfirmation('')}/>
      </>}
      <Button label="Tải lại hợp đồng" variant="outline" disabled={pending} onPress={refresh}/>
    </Card>}
  </LiveScreen>;
}
