import {CardHeading,TintedPanel} from '../components/livePresentation';
import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {Linking} from 'react-native';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {apiIssue} from '../api/client';
import {loadContractReview,submitReviewedContract} from '../api/selfStorageContract';
import {hasPaperProof} from '../domain/livePayment';
import {refId} from '../api/contracts/core';
import {reservationProgress} from '../domain/reservationProgress';
import {contractText,reviewDocument,reviewFingerprint} from '../domain/contractReview';
import {managedInventory} from '../api/managedInventory';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard} from '../components/ui';
import {dateLabel,LiveScreen,money,ResourceState,useResource} from '../components/liveUI';
import {rentalDetailTarget} from '../domain/rentalDetailTarget';

function record(value:unknown):Record<string,unknown>|undefined{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function secureDocumentUrl(value:unknown){
  if(typeof value!=='string')return undefined;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;}
}

export function Contract(){
  const {id}=useLocalSearchParams<{id:string}>();
  const owner=useLiveSession(s=>s.user?._id??'');
  return <ContractReview key={owner+':'+id} id={id} owner={owner}/>;
}

function ContractReview({id,owner}:{id:string;owner:string}){
  const router=useRouter();
  const name=useLiveSession(s=>s.user?.displayName);
  const [revision,setRevision]=useState(0),[confirmation,setConfirmation]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [confirmedId,setConfirmedId]=useState(''),[openedDocument,setOpenedDocument]=useState('');
  const busy=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const data=useResource(owner+':'+id+':'+revision,signal=>loadContractReview(id,owner,signal));
  const review=data.data,contract=review?.contract;
  const rental = review?.reservation;
  const backButton={onPress:()=>router.replace((review?rentalDetailTarget(review.reservation):'/(tabs)/rentals') as Href)};
  const managedSnapshot=record(contract?.contentVersions?.find(version=>version.version===contract.currentContentVersion)?.content);
  const managedFacility=record(managedSnapshot?.facility),managedReservation=record(managedSnapshot?.reservation);
  const managedCustomer=record(contract?.customerSnapshot),managedPricing=record(contract?.pricingSnapshot);
  const managedCellIds=Array.isArray(managedReservation?.cellIds)?managedReservation.cellIds.filter((value):value is string=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value)):[];
  const managedCells=useResource(owner+':contract-cells:'+id+':'+managedCellIds.join(','),signal=>
    review?.reservation.serviceType==='MANAGED_INVENTORY'&&managedCellIds.length
      ?managedInventory.cellLabels(refId(review.reservation.facilityId),managedCellIds,signal):Promise.resolve({} as Record<string,string>));
  const paperProofUrl=secureDocumentUrl(contract?.signedProofUrl);
  const upfront = rental?.serviceType === 'SELF_STORAGE' && rental.rentalPaymentFlow === 'FULL_UPFRONT_V1';
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
        setNotice('Đã gửi yêu cầu ký. Đang cập nhật trạng thái hợp đồng.');
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
  if(review&&review.reservation.serviceType!=='SELF_STORAGE'&&review.reservation.bookingFlowVersion!==3){
    return <LiveScreen title="Hợp đồng" eyebrow="HỒ SƠ THUÊ · HỢP ĐỒNG" backButton={backButton} onRefresh={refresh} refreshing={data.loading}>
      <ResourceState {...data} resource="hợp đồng"/>
      {contract?<Card><CardHeading icon="document-text-outline" title={contractText(contract.contractCode)??'Hợp đồng thuê kho'}/>
        <AppText>{({DRAFT:'Bản nháp',SIGNED:'Đã ký',TERMINATED:'Đã chấm dứt',EXPIRED:'Đã hết hạn'})[contract.status]}</AppText>
        <AppText>Ứng dụng hiện hỗ trợ xem trạng thái hợp đồng.</AppText>
      </Card>:<StateCard title="Chưa có hợp đồng cho đơn thuê"/>}
    </LiveScreen>;
  }
  if(review&&review.reservation.serviceType==='MANAGED_INVENTORY'&&review.reservation.bookingFlowVersion===3){
    return <LiveScreen title="Hợp đồng" eyebrow="HỒ SƠ THUÊ · HỢP ĐỒNG" backButton={backButton} onRefresh={refresh} refreshing={data.loading}>
      <ResourceState {...data} resource="hợp đồng"/>
      {contract?<Card><CardHeading icon="document-text-outline" title={contractText(contract.contractCode)??'Hợp đồng thuê kho'}/>
        <AppText>Trạng thái hợp đồng: {({DRAFT:'Bản nháp',SIGNED:'Đã ký',TERMINATED:'Đã chấm dứt',EXPIRED:'Đã hết hạn'})[contract.status]}</AppText>
        {typeof contract.termsVersion==='string'&&<AppText>Phiên bản điều khoản: {contract.termsVersion}</AppText>}
        {!!managedFacility?.name&&<AppText>Cơ sở: {contractText(managedFacility.name)}</AppText>}
        {record(managedFacility?.address)&&<AppText>Địa chỉ cơ sở: {Object.values(record(managedFacility?.address)!).filter((value):value is string=>typeof value==='string'&&!!value.trim()).join(', ')}</AppText>}
        {!!managedCustomer?.fullName&&<AppText>Khách hàng: {contractText(managedCustomer.fullName)}</AppText>}
        {!!managedCustomer?.email&&<AppText>Email: {contractText(managedCustomer.email)}</AppText>}
        {!!managedCustomer?.phone&&<AppText>Số điện thoại: {contractText(managedCustomer.phone)}</AppText>}
        <AppText>Đơn thuê: {contractText(managedReservation?.code)??review.reservation.reservationCode}</AppText>
        <AppText>Kỳ thuê: {dateLabel(review.reservation.startDate)} – {dateLabel(review.reservation.endDate)}</AppText>
        {!!managedCellIds.length&&<>
          <ResourceState {...managedCells} resource="ô thuê trong hợp đồng"/>
          {managedCellIds.map((cellId,index)=><AppText key={cellId}>Ô {index+1}: {managedCells.data?.[cellId]??(managedCells.loading?'Đang tải mã ô':'Chưa có thông tin vị trí')}</AppText>)}
        </>}
        {typeof managedPricing?.estimatedRent==='number'&&Number.isFinite(managedPricing.estimatedRent)&&<AppText>Tiền thuê: {money(managedPricing.estimatedRent)}</AppText>}
        {typeof contract.paperContractNumber==='string'&&<AppText>Mã hợp đồng giấy: {contract.paperContractNumber}</AppText>}
        {contract.status==='SIGNED'&&typeof contract.verifiedAt==='string'&&!!contract.signedProofPublicId
          ?<AppText>Hợp đồng giấy đã được cơ sở xác minh vào {dateLabel(contract.verifiedAt)}.</AppText>
          :contract.status==='SIGNED'?<AppText>Đã có trạng thái ký; đang chờ cơ sở xác minh bằng chứng hợp đồng giấy.</AppText>
          :review.reservation.status==='PAID'?<AppText>Vui lòng đến cơ sở ký hợp đồng giấy. Nhân viên sẽ xác minh bằng chứng trước khi bàn giao.</AppText>
          :review.reservation.status==='RESERVED'?<AppText>Đang chờ xác nhận thanh toán; chưa có hợp đồng để ký tại cơ sở.</AppText>
          :<AppText>Hợp đồng giấy được ký và xác minh tại cơ sở. Ứng dụng sẽ cập nhật trạng thái sau khi cơ sở xác nhận.</AppText>}
        {paperProofUrl&&<Button label="Xem bằng chứng hợp đồng giấy" variant="outline" onPress={()=>void openPdf(paperProofUrl)}/>}
        {document?.content&&<AppText selectable>{document.content}</AppText>}
        {document?.terms.map((term,index)=><AppText selectable key={index}>{index+1}. {term}</AppText>)}
        {!!document?.pdf&&<Button label="Mở bản in hợp đồng" variant="outline" onPress={()=>void openPdf(document.pdf!)}/>}
        {!document?.available&&<AppText>Chưa có bản in hoặc nội dung điều khoản đầy đủ cho hợp đồng này.</AppText>}
        <Button label="Tải lại hợp đồng" variant="quiet" onPress={refresh}/>
      </Card>:review.reservation.status==='RESERVED'?<StateCard title="Đang chờ thanh toán" description="Hợp đồng sẽ xuất hiện sau khi khoản thanh toán được xác nhận."/>:
        <StateCard title="Chưa có hợp đồng cho đơn thuê" description="Chưa có hợp đồng liên kết với đơn thuê này."/>}
    </LiveScreen>;
  }
  return <LiveScreen title="Hợp đồng" eyebrow="HỒ SƠ THUÊ · HỢP ĐỒNG" backButton={backButton} onRefresh={refresh} refreshing={data.loading}>
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
      {upfront && rental && <>
        <AppText>Cơ sở: {typeof rental.facilityId === 'object' ? contractText(rental.facilityId.name) ?? refId(rental.facilityId) : refId(rental.facilityId)}</AppText>
        <AppText>Kho: {typeof rental.storageUnitId === 'object' && rental.storageUnitId ? contractText(rental.storageUnitId.unitCode) ?? refId(rental.storageUnitId) : rental.storageUnitId ?? 'Chưa có thông tin'}</AppText>
        <AppText accessibilityLiveRegion="polite">{reservationProgress(rental)?.summary}</AppText>
        {rental.status === 'PAID' && contract.status === 'DRAFT' && <>
          <AppText>Vui lòng đến cơ sở ký hợp đồng giấy. Nhân viên sẽ xác minh bản đã ký.</AppText>
          {!!rental.signingDeadline && <AppText>Hạn ký: {new Date(rental.signingDeadline).toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'})}</AppText>}
        </>}
        {rental.status === 'CHECKIN_READY' && hasPaperProof(contract) && <AppText>Đã xác minh hợp đồng giấy. Vui lòng chờ nhân viên bàn giao kho.</AppText>}
      </>}
      {!upfront&&typeof contract.pricingSnapshot?.depositAmount==='number'&&Number.isFinite(contract.pricingSnapshot.depositAmount)&&
        <AppText>Tiền cọc theo hợp đồng: {money(contract.pricingSnapshot.depositAmount)}</AppText>}
      {signatureRecorded&&signedAt?<AppText>Thời điểm Customer ký: {dateLabel(signedAt)}</AppText>:null}
      {document?.content?<AppText selectable>{document.content}</AppText>:null}
      {document?.terms.map((term,index)=><AppText selectable key={index}>{index+1}. {term}</AppText>)}
      {!!document?.pdf&&<Button label="Mở tài liệu hợp đồng" variant="outline" disabled={pending} onPress={()=>void openPdf(document.pdf!)}/>}
      {!document?.available&&<AppText>Chưa có nội dung điều khoản hoặc tài liệu đầy đủ để đọc.</AppText>}
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
