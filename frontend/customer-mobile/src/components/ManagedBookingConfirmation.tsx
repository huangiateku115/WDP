import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {useRouter} from 'expo-router';
import {apiIssue,MobileInputError} from '../api/client';
import {createManagedBooking,managedBookingPolicy,sameManagedQuote,verifyManagedCreation} from '../api/managedBookingV3';
import {managedInventory,type ManagedQuote} from '../api/managedInventory';
import {journal,newAttempt} from '../state/attemptJournal';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter} from './ui';
import {ResourceState,useResource} from './liveUI';

type Review=Extract<ManagedQuote,{bookingFlowVersion:3}>;

export function ManagedBookingConfirmation({owner,review,onReviewChanged}:{owner:string;review?:Review;onReviewChanged:()=>void}){
  const router=useRouter();
  const [accepted,setAccepted]=useState('');
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const busy=useRef(false),mounted=useRef(false);
  const scope=review?JSON.stringify(review):'';
  const activeScope=useRef(scope);
  activeScope.current=scope;
  const attempt=useResource(owner,()=>journal('managed-v3-booking',owner,'active').then(store=>store.read()));
  const policy=useResource(owner+':'+scope,signal=>review?managedBookingPolicy(signal):Promise.resolve(null));
  const versionId=policy.data?.versionId;
  const acceptance=scope+':'+versionId;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setAccepted('');setError('');},[scope]);

  async function submit(recover:boolean){
    if(busy.current)return;
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(!current())return;
    busy.current=true;setPending(true);setError('');
    try{
      const store=await journal('managed-v3-booking',owner,'active');
      let saved=await store.read();
      if(!current())return;
      if(!recover){
        if(saved)throw new MobileInputError('Hãy kiểm tra yêu cầu tạo đơn đã lưu trước khi tạo đơn mới.');
        if(!review||!versionId||accepted!==acceptance)return;
        const range={startDate:review.startDate,endDate:review.endDate};
        const input={facilityId:review.facilityId,startDate:review.startDate,term:review.term,
          allocatedCapacityM3:review.allocatedCapacityM3,cellIds:review.cellIds};
        const [fresh,latestPolicy]=await Promise.all([managedInventory.quote(input,range),managedBookingPolicy()]);
        if(!current()||activeScope.current!==scope)return;
        if(!sameManagedQuote(review,fresh)||latestPolicy.versionId!==versionId){
          setAccepted('');policy.reload();onReviewChanged();
          throw new MobileInputError('Báo giá hoặc điều khoản đã thay đổi. Hãy xem lại trước khi đặt kho.');
        }
        saved={...newAttempt(),managedBooking:{body:{...input,termsAccepted:true,termsVersionId:versionId},endDate:review.endDate}};
        if(!await store.claim(saved))throw new MobileInputError('Yêu cầu tạo đơn đang được xử lý.');
      }
      if(!saved?.managedBooking||!current()||(!recover&&activeScope.current!==scope))return;
      const {body,endDate}=saved.managedBooking;
      let resourceId=saved.resourceId;
      if(!resourceId){
        try{
          const created=await createManagedBooking(body,{startDate:body.startDate,endDate},saved.key,owner);
          resourceId=created._id;
          await store.write({...saved,resourceId});
        }catch(cause){
          // A first, definitive rejection leaves no reservation to recover.
          if(!recover&&axios.isAxiosError(cause)&&[400,403,409,422].includes(cause.response?.status??0)){
            await store.clear();
          }
          throw cause;
        }
      }
      if(!current())return;
      verifyManagedCreation(await managedInventory.rental(resourceId,owner,body.facilityId),body,endDate);
      if(!current())return;
      await store.clear();
      if(current())router.replace({pathname:'/managed/[facilityId]/confirmation',params:{facilityId:body.facilityId,reservationId:resourceId}});
    }catch(cause){
      if(current())setError(apiIssue(cause));
    }finally{
      busy.current=false;
      if(current()){setPending(false);attempt.reload();}
    }
  }

  if(!review&&!attempt.data&&!attempt.error)return null;
  return <Card>
    <ResourceState {...attempt}/>
    {attempt.data?<Button label="Khôi phục yêu cầu đặt kho đã lưu" loading={pending} onPress={()=>void submit(true)}/>:null}
    {review&&!attempt.data&&<><ResourceState {...policy}/>
      {policy.data&&<>
        <AppText variant="card">Điều khoản kho ký gửi · v{policy.data.version}</AppText>
        {policy.data.groups.map(group=><Card key={group.id}><AppText variant="medium">{group.title}</AppText>
          {group.sections.MANAGED_INVENTORY?.map((line,index)=><AppText key={index}>{line}</AppText>)}
        </Card>)}
        <Filter label="Tôi chấp nhận điều khoản kho ký gửi" selected={accepted===acceptance}
          onPress={()=>{if(!pending)setAccepted(accepted===acceptance?'':acceptance);}}/>
        <Button label="Xác nhận tạo đơn thuê" loading={pending}
          disabled={attempt.loading||!!attempt.error||accepted!==acceptance} onPress={()=>void submit(false)}/>
      </>}
    </>}
    {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
  </Card>;
}
