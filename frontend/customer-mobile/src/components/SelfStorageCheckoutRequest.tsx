import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {KeyboardAvoidingView,Modal,Platform,ScrollView,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {dateLabel,ResourceState,useResource} from './liveUI';
import {AppText,Button,Card,Input} from './ui';

const rejectionPrefix = 'Staff từ chối yêu cầu trả kho: ';
export function selfStorageCheckoutReason(r: ReservationDto) {
  if (r.checkoutRequest?.status !== 'CANCELLED') return undefined;
  const requestedAt = Date.parse(r.checkoutRequest.requestedAt ?? '');
  if (!Number.isFinite(requestedAt)) return undefined;
  const rejection = r.statusHistory?.slice().reverse().find(row => row.reason?.startsWith(rejectionPrefix) &&
    Date.parse(row.createdAt ?? '') >= requestedAt);
  return rejection?.reason?.slice(rejectionPrefix.length);
}

export function SelfStorageCheckoutRequest({rental,owner,id,reload}: {
  rental?: ReservationDto | null; owner:string; id:string; reload:()=>void;
}) {
  const [open,setOpen]=useState(false), [note,setNote]=useState(''), [busy,setBusy]=useState(false);
  const [error,setError]=useState(''), [awaiting,setAwaiting]=useState(false);
  const inFlight=useRef(false);
  const previousRequestAt=useRef<string|undefined>(undefined);
  const terms=useResource('checkout-terms:'+String(open), signal=>open ? mobileRepo.bookingPolicy(signal) : Promise.resolve(null));
  const r=rental;
  const status=r?.checkoutRequest?.status;
  const eligible=r?.serviceType==='SELF_STORAGE'&&['ACTIVE','OVERDUE'].includes(r.status)&&(!status||status==='CANCELLED');
  const confirmedStatus = status==='PENDING'||status==='COMPLETED'||r?.status==='CHECKED_OUT';
  const requestedAt=r?.checkoutRequest?.requestedAt;
  useEffect(()=>{
    if (confirmedStatus || (status==='CANCELLED' && requestedAt && requestedAt!==previousRequestAt.current)) setAwaiting(false);
  },[confirmedStatus,status,requestedAt]);
  async function submit() {
    if (!eligible || awaiting || inFlight.current) return;
    inFlight.current=true;
    setBusy(true);
    setError('');
    let submitted=false;
    const current=()=>useLiveSession.getState().user?._id===owner;
    try {
      const latest=await mobileRepo.rental(id,owner);
      if (!current()) return;
      if (latest.checkoutRequest?.status==='PENDING'||latest.status==='CHECKED_OUT') {
        setOpen(false);
        reload();
        return;
      }
      previousRequestAt.current=latest.checkoutRequest?.requestedAt;
      submitted=true;
      await mobileRepo.requestSelfStorageCheckout(latest,note,owner);
      if (current()) {
        setAwaiting(true);
        setOpen(false);
        setNote('');
        reload();
      }
    } catch (cause) {
      if (current()) {
        const uncertain=submitted&&(!axios.isAxiosError(cause)||!cause.response||cause.response.status>=500);
        if (uncertain) {
          setAwaiting(true);
          setOpen(false);
          setError('Chưa xác minh được kết quả gửi. Hãy tải lại đơn hoặc liên hệ cơ sở trước khi gửi thêm yêu cầu.');
        } else setError(apiIssue(cause));
        reload();
      }
    } finally {
      inFlight.current=false;
      setBusy(false);
    }
  }
  if (!r || r.serviceType!=='SELF_STORAGE') return null;
  if (!eligible&&!status&&r.status!=='CHECKED_OUT') return null;
  const reason=selfStorageCheckoutReason(r);
  const early=terms.data?.groups.find(group=>group.id==='P07')?.sections.SELF_STORAGE;
  return <Card>
    <AppText variant="card">Trả kho</AppText>
    {status==='PENDING'&&<AppText accessibilityLiveRegion="polite">Đã gửi yêu cầu · Chờ nhân viên nghiệm thu</AppText>}
    {(status==='COMPLETED'||r.status==='CHECKED_OUT')&&<AppText>Đã trả kho{r.actualCheckoutDate?' · '+dateLabel(r.actualCheckoutDate):''}</AppText>}
    {status==='CANCELLED'&&<AppText>Yêu cầu trả kho đã bị từ chối.{reason?' '+reason:''}</AppText>}
    {awaiting&&!confirmedStatus&&<AppText>Đang chờ xác nhận trạng thái từ máy chủ.</AppText>}
    {!open&&!!error&&!confirmedStatus&&<AppText accessibilityRole="alert">{error}</AppText>}
    {eligible&&!awaiting&&<Button label="Yêu cầu trả kho" variant="outline" onPress={()=>{setError('');setOpen(true);}}/>}
    {(status==='PENDING'||awaiting)&&<Button label="Kiểm tra trạng thái trả kho" variant="outline" onPress={reload}/>}
    <Modal visible={open} transparent onRequestClose={()=>{if(!inFlight.current)setOpen(false);}}>
      <SafeAreaView style={{flex:1,backgroundColor:'rgba(0,0,0,0.55)'}}>
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:20}}>
            <View accessibilityViewIsModal><Card>
              <AppText variant="heading">Xác nhận yêu cầu trả kho</AppText>
              <AppText>Nhân viên sẽ kiểm tra kho và xác nhận kết quả. Đơn vẫn giữ trạng thái hiện tại đến khi nghiệm thu.</AppText>
              <ResourceState {...terms}/>
              {early?.length ? <><AppText variant="label">Điều khoản trả kho sớm · v{terms.data?.version}</AppText>
                {early.map((line,index)=><AppText key={index}>{line}</AppText>)}</> : <AppText>Chưa tải được điều khoản trả kho sớm.</AppText>}
              <Input label="Ghi chú cho nhân viên" value={note} onChangeText={setNote} maxLength={500} multiline editable={!busy}/>
              {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
              <Button label="Gửi yêu cầu trả kho" loading={busy} disabled={!eligible||awaiting} onPress={()=>void submit()}/>
              <Button label="Quay lại" variant="quiet" disabled={busy} onPress={()=>setOpen(false)}/>
            </Card></View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </Card>;
}
