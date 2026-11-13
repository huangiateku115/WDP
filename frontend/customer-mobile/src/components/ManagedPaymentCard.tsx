import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';
import {managedInventory} from '../api/managedInventory';
import {managedCheckoutAction,managedPayment,managedPaymentApplied,managedPaymentEligible} from '../api/managedPaymentV3';
import {checkoutLink,fullRentReady,fullRentTerminal} from '../domain/livePayment';
import {journal,newAttempt} from '../state/attemptJournal';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card} from './ui';
import {ResourceState,money,useResource} from './liveUI';
import {FullRentCheckout} from './FullRentCheckout';

export function ManagedPaymentCard({r,owner,reload}:{r:ReservationDto;owner:string;reload:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false),mounted=useRef(false);
  const polling=useRef(0);
  const [focused,setFocused]=useState(false);
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));
  const [foreground,setForeground]=useState(AppState.currentState==='active'||AppState.currentState==null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const sub=AppState.addEventListener('change',value=>{setForeground(value==='active');});
    return()=>sub.remove();
  },[]);
  const data=useResource(owner+':'+r._id,async signal=>{
    const store=await journal('managed-v3-full-rent',owner,r._id);
    const attempt=await store.read();
    const rows=await managedPayment.history(r,owner,signal);
    const outstanding=rows.filter(row=>!managedPaymentApplied(row)&&!fullRentTerminal(row));
    const paymentId=outstanding.length===1?outstanding[0]!.id:outstanding.length===0?attempt?.resourceId:undefined;
    const status=paymentId?await managedPayment.status(r,paymentId,owner,signal):undefined;
    const payments=status?rows.map(row=>row.id===status.id?status:row):rows;
    if(status&&!payments.some(row=>row.id===status.id))payments.unshift(status);
    return {attempt,payments};
  });
  const rows=data.data?.payments;
  const applied=rows?.find(managedPaymentApplied);
  const outstanding=rows?.filter(row=>!managedPaymentApplied(row)&&!fullRentTerminal(row))??[];
  const candidate=outstanding.length===1?outstanding[0]:undefined;
  const ready=!applied&&managedPaymentEligible(r)&&candidate&&fullRentReady(candidate,r._id)?candidate:undefined;
  const waiting=!!candidate&&!applied&&!candidate.reconciliationRequired&&candidate.checkoutStatus!=='UNKNOWN'&&candidate.status==='PENDING';
  const review=!applied&&(outstanding.length>1||!!candidate&&!ready);
  const action=managedPaymentEligible(r)&&rows?managedCheckoutAction(rows,data.data?.attempt):'BLOCKED';
  useEffect(()=>{if(!foreground||!focused)polling.current=0;},[foreground,focused]);
  useEffect(()=>{
    if(!focused||!foreground||!waiting||busy||polling.current>=3)return;
    const timer=setTimeout(()=>{polling.current++;data.reload();},[2000,5000,10000][polling.current]);
    return()=>clearTimeout(timer);
  },[focused,foreground,waiting,busy,data.data,data.reload]);

  async function act(kind:'create'|'retry'|'recover'|'reconcile'){
    if(running.current)return;
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(!current())return;
    running.current=true;setBusy(true);setError('');
    try{
      const latest=await managedInventory.rental(r._id,owner,refId(r.facilityId));
      const store=await journal('managed-v3-full-rent',owner,r._id);
      let saved=await store.read();
      const history=await managedPayment.history(latest,owner);
      if(!current())return;
      if(kind==='reconcile'){
        if(!candidate||history.some(managedPaymentApplied))return;
        const payment=await managedPayment.status(latest,candidate.id,owner);
        if(!current()||managedPaymentApplied(payment)||fullRentTerminal(payment))return;
        await managedPayment.reconcile(latest,payment.id,owner);
      }else{
        if(!managedPaymentEligible(latest)||managedCheckoutAction(history,saved)!==kind.toUpperCase())return;
        if(kind==='create'||kind==='retry'){
          const previous=saved?.key;
          saved=newAttempt();
          if(!await store.claim(saved,previous))return;
        }
        if(!saved||!current())return;
        const result=await managedPayment.checkout(latest,owner,saved.key);
        await store.write({...saved,resourceId:result.id});
      }
    }catch(cause){if(current())setError(apiIssue(cause));}
    finally{running.current=false;if(current()){setBusy(false);data.reload();reload();}}
  }

  return <Card>
    <AppText variant="card">Thanh toán toàn bộ tiền thuê · PayOS</AppText>
    <ResourceState {...data}/>
    {applied?<AppText>Máy chủ đã xác minh và ghi nhận thanh toán.</AppText>:null}
    {ready?<><FullRentCheckout payment={ready} url={checkoutLink(ready,r._id,'FULL_RENT')}/>
      <AppText>Quay lại ứng dụng sau khi thanh toán để kiểm tra trạng thái.</AppText></>:null}
    {review?<AppText>Giao dịch cần kiểm tra trước khi tiếp tục.</AppText>:null}
    {action==='CREATE'?<Button label="Tạo giao dịch PayOS" loading={busy} onPress={()=>void act('create')}/>:null}
    {action==='RECOVER'?<Button label="Khôi phục yêu cầu thanh toán" loading={busy} onPress={()=>void act('recover')}/>:null}
    {action==='RETRY'?<Button label="Thử thanh toán lại" loading={busy} onPress={()=>void act('retry')}/>:null}
    {candidate&&!applied?<Button label="Đối soát giao dịch" variant="outline" loading={busy} onPress={()=>void act('reconcile')}/>:null}
    <Button label="Tải lại thanh toán" variant="quiet" disabled={busy} onPress={()=>{polling.current=0;data.reload();reload();}}/>
    {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
    <AppText variant="medium">Lịch sử thanh toán</AppText>
    {rows?.length===0?<AppText>Chưa có giao dịch.</AppText>:null}
    {rows?.map(row=><AppText key={row.id}>{money(row.amount)} · {row.status} · {row.checkoutStatus}</AppText>)}
  </Card>;
}
