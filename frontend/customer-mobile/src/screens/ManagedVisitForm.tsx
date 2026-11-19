import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Keyboard,Pressable,StyleSheet,View} from 'react-native';
import axios from 'axios';
import {useLocalSearchParams,useRouter,type Href} from 'expo-router';
import {apiIssue} from '../api/client';
import {refId} from '../api/contracts/core';
import {mobileRepo} from '../api/mobileRepository';
import {managedReservationReads,type ManagedVisit} from '../api/managedReservationReads';
import {managedInventory} from '../api/managedInventory';
import {useLiveSession} from '../state/useLiveSession';
import {journal,newAttempt} from '../state/attemptJournal';
import {AppText,Button,Card,Input,Screen} from '../components/ui';
import {ManagedVisitDatePicker} from '../components/ManagedVisitDatePicker';
import {ScreenHeading} from '../components/livePresentation';
import {ResourceState,useResource} from '../components/liveUI';
import {colors} from '../theme/tokens';
import {publishVisitSuccessFeedback} from '../state/visitSuccessFeedback';
import {showToast} from '../state/toastStore';

const dateParts=(date:Date,timeZone='Asia/Ho_Chi_Minh')=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)?.value??'';
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const todayVietnam=()=>dateParts(new Date());
const displayDate=(value:string)=>new Intl.DateTimeFormat('vi-VN',{dateStyle:'full',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
const displayTime=new Intl.DateTimeFormat('vi-VN',{timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'});
const todaySlot=(startsAt:string)=>Date.parse(startsAt)>Date.now();
function visitFailureMessage(error:unknown){
  if(!axios.isAxiosError(error))return apiIssue(error);
  const status=error.response?.status,code=error.response?.data?.code;
  if(status===401)return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi đặt lịch.';
  if(status===403)return 'Tài khoản không có quyền đặt lịch cho Reservation này.';
  if(status===409){
    if(code==='VISIT_SLOT_UNAVAILABLE')return 'Khung giờ vừa hết hoặc đã có xung đột. Hãy tải lại và chọn khung giờ khác.';
    if(code==='RESERVATION_NOT_VISIT_READY')return 'Reservation hiện chưa đủ điều kiện đặt lịch đến kho.';
    if(code==='IDEMPOTENCY_CONFLICT')return 'Yêu cầu đặt lịch trước đó bị xung đột. Hãy kiểm tra danh sách lịch trước khi tiếp tục.';
    return `Lịch đang bị xung đột${typeof code==='string'?` (${code})`:''}. Hãy tải lại danh sách lịch và khung giờ.`;
  }
  return apiIssue(error);
}
function uncertainVisitResult(error:unknown){return !axios.isAxiosError(error)||!error.response||error.response.status>=500;}

export function ManagedVisitForm(){
  const {reservationId,visitId}=useLocalSearchParams<{reservationId:string;visitId?:string}>();
  const owner=useLiveSession(state=>state.user?._id??''),router=useRouter();
  const reservation=useResource(owner+':'+reservationId,signal=>mobileRepo.rental(reservationId,owner,signal));
  const r=reservation.data;
  const facility=useResource(r?refId(r.facilityId):'',signal=>r?managedInventory.facility(refId(r.facilityId),signal):Promise.resolve(null));
  const visits=useResource(visitId&&r?owner+':visits:'+r._id:'',signal=>visitId&&r?managedReservationReads.visits(r,owner,signal):Promise.resolve(null));
  const visit=visits.data?.find(row=>row._id===visitId);
  const [date,setDate]=useState(todayVietnam),[note,setNote]=useState(''),[selectedSlot,setSelectedSlot]=useState('');
  const [pending,setPending]=useState(false),[checking,setChecking]=useState(false),[checkedNoMatch,setCheckedNoMatch]=useState(false),[sameKeyRetryAllowed,setSameKeyRetryAllowed]=useState(true),[unknownCreate,setUnknownCreate]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
  const busy=useRef(false),hydrated=useRef(false);
  const checkingBusy=useRef(false);
  const scope=owner+':'+reservationId;
  const createAttempt=useResource(scope+':visit-create-attempt',()=>journal('managed-v3-visit-create',owner,reservationId).then(store=>store.read()));
  const amendAttempt=useResource(visitId?scope+':'+visitId:'',()=>visitId?journal('managed-v3-visit-amend',owner,visitId).then(store=>store.read()):Promise.resolve(null));
  useEffect(()=>{
    if(!visit||hydrated.current)return;
    hydrated.current=true;setDate(dateParts(new Date(visit.startsAt)));setNote(visit.note??'');setSelectedSlot(visit.startsAt);
  },[visit]);
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=todayVietnam();
  const eligible=!!r&&r.serviceType==='MANAGED_INVENTORY'&&r.bookingFlowVersion===3&&r.status==='ACTIVE'&&Date.parse(r.startDate)<=Date.now()&&Date.parse(r.endDate)>Date.now();
  const availability=useResource(r&&eligible&&validDate?scope+':availability:'+refId(r.facilityId)+':'+date:'',signal=>r&&eligible&&validDate
    ?managedReservationReads.visitAvailability(r,owner,date,signal):Promise.resolve(null));
  const slots=availability.data?.slots??[];
  const slotSelected=slots.find(row=>row.startsAt===selectedSlot&&todaySlot(row.startsAt));
  const savedAttempt=visitId?amendAttempt.data:createAttempt.data;
  const loading=reservation.loading||facility.loading||(!!visitId&&visits.loading);

  async function confirmCreate(confirmed:ManagedVisit,store:Awaited<ReturnType<typeof journal>>){
    await store.clear().catch(()=>undefined);
    setUnknownCreate(false);
    publishVisitSuccessFeedback({reservationId:r!._id,visitId:confirmed._id});
    showToast('Đặt lịch đến kho thành công');
    router.replace((`/managed/reservations/${r!._id}/visits`) as Href);
  }

  async function reconcileCreateAttempt(allowSameKeyRetry=sameKeyRetryAllowed){
    if(checkingBusy.current||!r)return;
    checkingBusy.current=true;setChecking(true);setError('');setCheckedNoMatch(false);
    try{
      const store=await journal('managed-v3-visit-create',owner,r._id),saved=await store.read();
      if(!saved?.visitBody){setError('Không tìm thấy yêu cầu đã lưu để kiểm tra trạng thái.');return;}
      const rows=await managedReservationReads.visits(r,owner);
      const expectedPurpose='facilityId' in saved.visitBody?'WAREHOUSE_VISIT':saved.visitBody.purpose;
      const match=rows.find(row=>row.facilityId===facility.data?._id&&row.purpose===expectedPurpose&&
        row.startsAt===saved.visitBody?.startsAt&&row.endsAt===saved.visitBody?.endsAt&&row.status==='SCHEDULED'&&
        (!('note' in (saved.visitBody??{}))||row.note===(saved.visitBody as {note?:string}).note));
      if(match){await confirmCreate(match,store);return;}
      setCheckedNoMatch(allowSameKeyRetry);setError(allowSameKeyRetry?'Chưa tìm thấy lịch khớp. Yêu cầu cũ vẫn được giữ nguyên; không tạo yêu cầu mới.':'Chưa tìm thấy lịch khớp và yêu cầu trước đã xung đột. Giữ nguyên yêu cầu để tránh tạo lịch trùng và liên hệ hỗ trợ.');
    }catch(cause){setError(`Chưa xác định được kết quả. ${apiIssue(cause)} Không gửi lịch mới.`);}
    finally{checkingBusy.current=false;setChecking(false);}
  }

  async function submit(recover=false){
    if(busy.current||pending||!r||!eligible||!useLiveSession.getState().user?._id||useLiveSession.getState().user?._id!==owner)return;
    busy.current=true;setPending(true);setError('');setCheckedNoMatch(false);if(!recover&&!visitId){setUnknownCreate(false);setSameKeyRetryAllowed(true);}Keyboard.dismiss();
    let createRequestStarted=false;
    try{
      if(visitId){
        if(!visit||visit.status!=='SCHEDULED')throw new Error('Lịch không còn đủ điều kiện sửa.');
        const store=await journal('managed-v3-visit-amend',owner,visit._id);let saved=await store.read();
        if(!recover){
          if(saved)throw new Error('Đang có yêu cầu sửa lịch chưa rõ kết quả. Hãy khôi phục đúng yêu cầu đã lưu.');
          if(!slotSelected)throw new Error('Chọn khung giờ còn hiệu lực do cơ sở cung cấp.');
          const attempt={...newAttempt(),resourceId:visit._id,visitRevision:visit.revision,visitAmendBody:{startsAt:slotSelected.startsAt,endsAt:slotSelected.endsAt,...(note.trim()?{note:note.trim()}:{})}};
          if(!await store.claim(attempt))throw new Error('Yêu cầu sửa lịch đang được xử lý.');saved=attempt;
        }
        if((!saved?.visitAmendBody&&!saved?.visitBody)||saved.resourceId!==visit._id||saved.visitRevision===undefined)throw new Error('Không thể xác minh yêu cầu sửa lịch đã lưu.');
        const body=saved.visitAmendBody??('reservationId' in saved.visitBody!?(({reservationId:_,purpose:__,...rest})=>rest)(saved.visitBody):saved.visitBody);
        const updated=await managedReservationReads.amendVisit(r,owner,{...visit,revision:saved.visitRevision},body,saved.key);
        await store.clear();setSuccess(true);showToast('Đã cập nhật lịch đến kho');router.back();
      }else{
        const store=await journal('managed-v3-visit-create',owner,r._id);let saved=await store.read();
        if(!recover){
          if(saved)throw new Error('Đang có yêu cầu đặt lịch chưa rõ kết quả. Hãy khôi phục yêu cầu đã lưu.');
          if(!slotSelected)throw new Error('Chọn một khung giờ còn hiệu lực do cơ sở cung cấp.');
          const visitBody={facilityId:refId(r.facilityId),startsAt:slotSelected.startsAt,endsAt:slotSelected.endsAt,...(note.trim()?{note:note.trim()}:{})};
          const attempt={...newAttempt(),visitBody};if(!await store.claim(attempt))throw new Error('Yêu cầu đặt lịch đang được xử lý.');saved=attempt;
        }
        if(!saved?.visitBody)throw new Error('Không có yêu cầu đặt lịch để khôi phục.');
        createRequestStarted=true;
        const created=await managedReservationReads.createVisit(r,owner,saved.visitBody,saved.key);
        await confirmCreate(created,store);
      }
    }catch(cause){
      if(useLiveSession.getState().user?._id===owner){
        if(!visitId&&createRequestStarted&&axios.isAxiosError(cause)&&cause.response?.data?.code==='IDEMPOTENCY_CONFLICT'){
          setUnknownCreate(true);setSameKeyRetryAllowed(false);setError(visitFailureMessage(cause));
          await reconcileCreateAttempt(false);
          return;
        }
        if(!visitId&&createRequestStarted&&uncertainVisitResult(cause)){
          setUnknownCreate(true);
          setError('Chưa xác nhận được kết quả. Đang kiểm tra danh sách lịch trước khi đề xuất gửi lại.');
          await reconcileCreateAttempt();
          return;
        }
        const knownRejected=axios.isAxiosError(cause)&&cause.response&&cause.response.status>=400&&cause.response.status<500;
        if((visitId&&axios.isAxiosError(cause)&&[400,403,404,409,412,422].includes(cause.response?.status??0))||(!visitId&&knownRejected)){
          if(visitId){await journal('managed-v3-visit-amend',owner,visitId).then(store=>store.clear());visits.reload();}
          else {await journal('managed-v3-visit-create',owner,reservationId).then(store=>store.clear());setUnknownCreate(false);}
          availability.reload();
        }
        setError(visitFailureMessage(cause));
      }
    }finally{busy.current=false;if(useLiveSession.getState().user?._id===owner)setPending(false);}
  }
  const scopeAvailable=availability.data?.reservationScopeAvailable!==false;
  const footer=pending?<View style={styles.pendingFooter}><ActivityIndicator color={colors.primary}/><AppText variant="medium">{checking?'Đang kiểm tra trạng thái lịch...':visitId?'Đang lưu lịch...':'Đang đặt lịch...'}</AppText></View>:<Button label={visitId?'Lưu thay đổi lịch':'Xác nhận đặt lịch'} disabled={!eligible||!slotSelected||!scopeAvailable||!!savedAttempt||unknownCreate||success||loading||availability.loading||!!availability.error} onPress={()=>void submit(false)}/>;
  if(loading)return <Screen footer={<Button label="Đang tải" loading disabled onPress={()=>{}}/>}><ScreenHeading title={visitId?'Sửa lịch đến kho':'Đặt lịch đến kho'}/><ResourceState {...reservation}/><ResourceState {...facility}/>{visitId&&<ResourceState {...visits}/>}</Screen>;
  if(!r||!facility.data)return <Screen><ScreenHeading title="Đặt lịch đến kho"/><ResourceState {...reservation}/><ResourceState {...facility}/><Button label="Quay lại" variant="outline" onPress={()=>router.back()}/></Screen>;
  if(!eligible)return <Screen><ScreenHeading title="Đặt lịch đến kho"/><Card><AppText accessibilityRole="alert">Đơn thuê chưa đủ điều kiện đặt lịch vào thời điểm này.</AppText><AppText>{r.reservationCode}</AppText></Card><Button label="Quay lại đơn thuê" variant="outline" onPress={()=>router.back()}/></Screen>;
  if(visitId&&!visit)return <Screen><ScreenHeading title="Sửa lịch đến kho"/><ResourceState {...visits}/><Button label="Quay lại" variant="outline" onPress={()=>router.back()}/></Screen>;
  if(visitId&&visit&&visit.status!=='SCHEDULED')return <Screen><ScreenHeading title="Sửa lịch đến kho"/><Card><AppText>Lịch này không còn ở trạng thái có thể chỉnh sửa.</AppText></Card><Button label="Quay lại" variant="outline" onPress={()=>router.back()}/></Screen>;
  return <Screen testID="managed-visit-form" footer={footer}>
    <ScreenHeading title={visitId?'Sửa lịch đến kho':'Đặt lịch đến kho'} eyebrow="KHO KÝ GỬI" subtitle="Chọn ngày và khung giờ được cơ sở mở. Phiên thao tác kho chỉ được cấp sau khi nhân viên check-in."/>
    <Card><AppText variant="medium">{facility.data.name}</AppText><AppText>Mã đơn thuê · {r.reservationCode}</AppText><AppText variant="caption">Lịch đến kho sẽ được gắn với đơn thuê đang hoạt động phù hợp tại cơ sở này.</AppText></Card>
    <Card><AppText variant="card">Ngày đến kho</AppText><ManagedVisitDatePicker value={date} disabled={pending} onChange={next=>{setDate(next);setSelectedSlot('');}}/><AppText variant="caption" style={{color:colors.muted}}>Chọn ngày và khung giờ đến kho.</AppText>
      {!visitId&&(createAttempt.data||unknownCreate)&&<Card><AppText accessibilityRole="alert">Lần gửi trước chưa rõ kết quả. Hãy kiểm tra danh sách lịch trước khi gửi lại.</AppText><Button label={checking?'Đang kiểm tra trạng thái...':'Kiểm tra trạng thái lịch'} variant="outline" loading={checking} onPress={()=>void reconcileCreateAttempt()}/>{checkedNoMatch&&sameKeyRetryAllowed&&<Button label="Gửi lại đúng yêu cầu đã lưu" variant="quiet" disabled={checking} onPress={()=>void submit(true)}/>}</Card>}
      {visitId&&amendAttempt.data&&<Card><AppText accessibilityRole="alert">Lần sửa trước chưa rõ kết quả. Hãy khôi phục đúng yêu cầu.</AppText><Button label="Khôi phục yêu cầu sửa đã lưu" variant="outline" loading={pending} onPress={()=>void submit(true)}/></Card>}
      <AppText variant="card">Khung giờ còn trống</AppText>{availability.loading?<ResourceState {...availability}/>:availability.error?<ResourceState {...availability}/>:!availability.data?<AppText>Chọn ngày để xem khung giờ tại cơ sở.</AppText>:availability.data.reservationScopeAvailable===false?<AppText accessibilityRole="alert">Chưa có đơn thuê phù hợp còn hiệu lực tại cơ sở này.</AppText>:slots.length===0?<AppText>Ngày này không có khung giờ khả dụng.</AppText>:<>
        {slots.length===1&&<AppText variant="caption" style={{color:colors.orangeText}}>Ngày này chỉ còn một khung giờ.</AppText>}
        <View style={styles.grid}>{slots.map(slot=>{const available=todaySlot(slot.startsAt);const selected=selectedSlot===slot.startsAt;return <Pressable key={slot.startsAt} accessibilityRole="button" accessibilityLabel={`${displayTime.format(new Date(slot.startsAt))}${available?'':' không khả dụng'}`} accessibilityState={{selected,disabled:!available||pending}} disabled={!available||pending} onPress={()=>setSelectedSlot(slot.startsAt)} style={[styles.slot,selected&&styles.selected,!available&&styles.unavailable]}><AppText variant="medium" style={{color:selected?colors.white:available?colors.primary:colors.inactive}}>{displayTime.format(new Date(slot.startsAt))}</AppText><AppText variant="caption" style={{color:selected?'#e6f4ec':available?colors.muted:colors.inactive}}>{available?'Còn chỗ':'Không khả dụng'}</AppText></Pressable>;})}</View>
      </>}
      <Input label="Ghi chú (không bắt buộc)" value={note} editable={!pending} onChangeText={setNote} maxLength={500} multiline numberOfLines={3} placeholder="Tối đa 500 ký tự" style={{minHeight:76,textAlignVertical:'top'}}/>
      {!!error&&<AppText accessibilityRole="alert" style={{color:colors.danger}}>{error}</AppText>}
    </Card>
    <Button label="Quay lại đơn thuê" variant="quiet" onPress={()=>router.back()}/>
  </Screen>;
}

const styles=StyleSheet.create({grid:{flexDirection:'row',flexWrap:'wrap',gap:10},slot:{width:'48%',minHeight:66,padding:10,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.soft,alignItems:'center',justifyContent:'center',gap:2},selected:{backgroundColor:colors.primary,borderColor:colors.primary},unavailable:{opacity:.5,backgroundColor:colors.surface},pendingFooter:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10}});
