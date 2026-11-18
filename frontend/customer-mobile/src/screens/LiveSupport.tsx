import {useRef,useState} from 'react';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {z} from 'zod';
import {wire,apiIssue,MobileInputError} from '../api/client';
import {idRef,instant,objectId,readData,readPage,refId} from '../api/contracts/core';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Filter,Input,StateCard} from '../components/ui';
import {LiveScreen,ResourceState,useResource} from '../components/liveUI';

const requestDto=z.object({_id:objectId,customerId:idRef,facilityId:idRef.optional(),category:z.enum(['RENTAL','ACCESS','PAYMENT','ITEM','LOCATION','OTHER']),
  subject:z.string(),description:z.string(),priority:z.enum(['LOW','MEDIUM','HIGH','URGENT']),status:z.enum(['OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED']),
  resolutionNote:z.string().optional(),relatedEntity:z.object({type:z.string(),id:z.string()}).optional(),createdAt:instant,updatedAt:instant}).passthrough();
const messageDto=z.object({_id:objectId,supportRequestId:objectId,authorId:idRef,authorRole:z.string(),message:z.string(),isInternal:z.boolean(),createdAt:instant});
const categories=[['RENTAL','Đơn thuê'],['ACCESS','Truy cập kho'],['PAYMENT','Thanh toán'],['ITEM','Hàng hóa'],['LOCATION','Vị trí'],['OTHER','Khác']] as const;
const labels={OPEN:'Đang mở',ASSIGNED:'Đã tiếp nhận',IN_PROGRESS:'Đang xử lý',RESOLVED:'Đã giải đáp',CLOSED:'Đã đóng'};
const categoryLabel=(key:string)=>categories.find(row=>row[0]===key)?.[1]??key;
const ownerId=()=>useLiveSession.getState().user?._id??'';
export function LiveSupportList(){
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();const data=useResource(owner,async signal=>readPage(requestDto,await wire('GET','/support-requests',{params:{page:1,limit:50},signal})).items);
  return <LiveScreen title="Trung tâm hỗ trợ" eyebrow="HỖ TRỢ KHÁCH HÀNG" subtitle="Tra cứu yêu cầu và trao đổi với đội ngũ hỗ trợ." onRefresh={data.reload} refreshing={data.loading}>
    <Button label="Tạo yêu cầu hỗ trợ" onPress={()=>router.push('/support/new')}/><ResourceState {...data}/>
    {data.data?.length===0&&<StateCard title="Chưa có yêu cầu hỗ trợ"/>}
    {data.data?.map(row=><Card key={row._id}><AppText variant="card">{row.subject}</AppText><AppText>{categoryLabel(row.category)} · {labels[row.status]}</AppText>
      <AppText>{new Date(row.updatedAt).toLocaleDateString('vi-VN')}</AppText><Button label="Xem trao đổi" variant="outline" onPress={()=>router.push({pathname:'/support/[requestId]',params:{requestId:row._id}} as unknown as Href)}/></Card>)}
  </LiveScreen>;
}
export function LiveSupportNew(){
  const owner=useLiveSession(s=>s.user?._id??''),router=useRouter();const [category,setCategory]=useState<typeof categories[number][0]>('OTHER');
  const [subject,setSubject]=useState(''),[description,setDescription]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),lock=useRef(false);
  async function submit(){if(lock.current)return;lock.current=true;setPending(true);setError('');try{
    if(!owner||!subject.trim()||!description.trim())throw new MobileInputError('Nhập tiêu đề và nội dung yêu cầu.');
    const row=readData(requestDto,await wire('POST','/support-requests',{body:{category,subject:subject.trim(),description:description.trim(),priority:'MEDIUM'}}));
    if(refId(row.customerId)!==owner||row.subject!==subject.trim()||row.category!==category)throw new MobileInputError('Chưa xác minh được yêu cầu hỗ trợ vừa tạo.');
    router.replace({pathname:'/support/[requestId]',params:{requestId:row._id}} as unknown as Href);
  }catch(cause){setError(apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  return <LiveScreen title="Tạo yêu cầu hỗ trợ" eyebrow="TRUNG TÂM HỖ TRỢ" subtitle="Không gắn tự động Reservation hay SKU để tránh gửi sai liên kết riêng tư.">
    <Card><AppText variant="label">CHỦ ĐỀ</AppText>{categories.map(row=><Filter key={row[0]} label={row[1]} selected={category===row[0]} onPress={()=>setCategory(row[0])}/>)}
      <Input label="Tiêu đề" value={subject} onChangeText={setSubject} maxLength={200} editable={!pending}/>
      <Input label="Nội dung" value={description} onChangeText={setDescription} multiline maxLength={5000} editable={!pending}/>
      <AppText>Chỉ chia sẻ thông tin cần thiết; yêu cầu sẽ được gắn với tài khoản đang đăng nhập.</AppText>
      <Button label="Gửi yêu cầu" loading={pending} onPress={()=>void submit()}/>
    </Card>{!!error&&<StateCard kind="error" title="Chưa gửi được yêu cầu" description={error}/>}</LiveScreen>;
}
export function LiveSupportDetail(){
  const {requestId}=useLocalSearchParams<{requestId:string}>();const owner=useLiveSession(s=>s.user?._id??''),[message,setMessage]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);const lock=useRef(false);
  const request=useResource(owner+':'+requestId,async signal=>{const row=readData(requestDto,await wire('GET','/support-requests/'+objectId.parse(requestId),{signal}));if(refId(row.customerId)!==owner)throw new MobileInputError('Yêu cầu không thuộc tài khoản hiện tại.');return row;});
  const messages=useResource(owner+':'+requestId+':messages',async signal=>{const rows=readData(z.array(messageDto),await wire('GET','/support-requests/'+objectId.parse(requestId)+'/messages',{signal}));return rows.filter(row=>!row.isInternal);});
  async function send(){if(lock.current)return;lock.current=true;setPending(true);setError('');try{
    const body={message:message.trim(),isInternal:false};if(!body.message)throw new MobileInputError('Nhập nội dung trao đổi.');
    const saved=readData(messageDto,await wire('POST','/support-requests/'+objectId.parse(requestId)+'/messages',{body}));
    if(saved.supportRequestId!==requestId||saved.isInternal||refId(saved.authorId)!==owner)throw new MobileInputError('Chưa xác minh được phản hồi đã gửi.');setMessage('');messages.reload();
  }catch(cause){setError(apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  return <LiveScreen title="Chi tiết hỗ trợ" eyebrow="TRAO ĐỔI" onRefresh={()=>{request.reload();messages.reload();}} refreshing={request.loading||messages.loading}>
    <ResourceState {...request}/><ResourceState {...messages}/>{request.data&&<Card><AppText variant="card">{request.data.subject}</AppText><AppText>{categoryLabel(request.data.category)} · {labels[request.data.status]}</AppText>
      <AppText>{request.data.description}</AppText>{request.data.resolutionNote&&<AppText>Phản hồi: {request.data.resolutionNote}</AppText>}</Card>}
    {messages.data?.map(row=><Card key={row._id}><AppText>{row.authorRole==='CUSTOMER'?'Bạn':'Đội ngũ hỗ trợ'} · {new Date(row.createdAt).toLocaleString('vi-VN')}</AppText><AppText>{row.message}</AppText></Card>)}
    {messages.data?.length===0&&<StateCard title="Chưa có trao đổi"/>}
    {request.data&&request.data.status!=='CLOSED'&&<Card><Input label="Tin nhắn" value={message} onChangeText={setMessage} multiline maxLength={5000} editable={!pending}/><Button label="Gửi phản hồi" loading={pending} onPress={()=>void send()}/></Card>}
    {!!error&&<StateCard kind="error" title="Chưa gửi được phản hồi" description={error}/>}
  </LiveScreen>;
}
