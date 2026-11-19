import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {refId} from '../api/contracts/core';
import {managedInventory} from '../api/managedInventory';
import {managedPriceNeedsAcceptance} from '../api/managedBookingV3';
import {managedCheckoutAction,managedPayment,managedPaymentApplied,managedPaymentEligible} from '../api/managedPaymentV3';
import {checkoutLink,fullRentReady,fullRentTerminal} from '../domain/livePayment';
import {journal,newAttempt} from '../state/attemptJournal';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card} from './ui';
import {ResourceState,money,useResource} from './liveUI';
import {FullRentCheckout} from './FullRentCheckout';
import {managedPaymentLabel,managedRentalPaymentProgress,type ManagedPaymentProgress} from '../domain/managedV3RentalProgress';

type ManagedPaymentRow=Awaited<ReturnType<typeof managedPayment.status>>&{createdAt?:string};

export function ManagedPaymentCard({r,owner,reload,refreshAppliedPayment,onProgress}:{r:ReservationDto;owner:string;reload:()=>void;refreshAppliedPayment:(paymentId:string)=>void;onProgress?:(state:ManagedPaymentProgress)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selectedPaymentId,setSelectedPaymentId]=useState('');
  const [confirmedPayment,setConfirmedPayment]=useState<ManagedPaymentRow>();
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
    let attempt:Awaited<ReturnType<Awaited<ReturnType<typeof journal>>['read']>>=null;
    let journalError:string|undefined;
    try{attempt=await (await journal('managed-v3-full-rent',owner,r._id)).read();}
    catch(cause){journalError=apiIssue(cause);}
    const historyResult=await managedPayment.history(r,owner,signal).then(
      rows=>({rows,error:undefined as string|undefined}),cause=>({rows:[] as ManagedPaymentRow[],error:apiIssue(cause)}));
    // Reservation.fullPaymentId is authoritative. Do not poll a local attempt:
    // payment detail GET can reconcile an unknown checkout state on the Backend.
    const linkedPaymentMissing=!!r.fullPaymentId&&!historyResult.error&&
      !historyResult.rows.some(row=>row.id===r.fullPaymentId);
    return {attempt,payments:historyResult.rows,historyError:historyResult.error,linkedPaymentMissing,journalError};
  });
  const paymentDetail=useResource(owner+':'+r._id+':detail:'+selectedPaymentId,signal=>
    selectedPaymentId?managedPayment.status(r,selectedPaymentId,owner,signal):Promise.resolve(undefined));
  const priceConsent=useResource(owner+':price:'+r._id,()=>journal('managed-v3-price-consent',owner,r._id).then(store=>store.read()));
  const priceBlocked=priceConsent.loading||!!priceConsent.error||managedPriceNeedsAcceptance(priceConsent.data?.priceReview);
  const rows=data.data?.payments;
  useEffect(()=>{
    const proof=[...(rows??[]),...(paymentDetail.data?[paymentDetail.data]:[])].find(row=>
      (!r.fullPaymentId||row.id===r.fullPaymentId)&&managedPaymentApplied(row));
    if(proof)setConfirmedPayment(proof);
  },[rows,paymentDetail.data,r.fullPaymentId]);
  const progressRows=r.fullPaymentId?rows?.filter(row=>row.id===r.fullPaymentId):rows;
  const verifiedRows=confirmedPayment&&(!r.fullPaymentId||confirmedPayment.id===r.fullPaymentId)
    ?[...(progressRows??[]),confirmedPayment]:progressRows;
  const progress=managedRentalPaymentProgress(r.status,verifiedRows,r.fullPaymentId);
  const applied=progress==='APPLIED'?verifiedRows?.find(managedPaymentApplied):undefined;
  const outstanding=rows?.filter(row=>!managedPaymentApplied(row)&&!fullRentTerminal(row))??[];
  const candidate=outstanding.length===1?outstanding[0]:undefined;
  const ready=!priceBlocked&&!applied&&managedPaymentEligible(r)&&candidate&&fullRentReady(candidate,r._id)?candidate:undefined;
  const waiting=!!candidate&&!applied&&!candidate.reconciliationRequired&&candidate.checkoutStatus!=='UNKNOWN'&&candidate.status==='PENDING';
  const review=!applied&&(outstanding.length>1||!!candidate&&!ready);
  const action=!priceBlocked&&managedPaymentEligible(r)&&rows?managedCheckoutAction(rows,data.data?.attempt):'BLOCKED';
  useEffect(()=>{onProgress?.(data.data?progress:'NONE');},[data.data,data.loading,onProgress,progress]);
  useEffect(()=>{if(applied&&r.status==='RESERVED')refreshAppliedPayment(applied.id);},[applied?.id,r.status,refreshAppliedPayment]);
  useEffect(()=>{if(!foreground||!focused)polling.current=0;},[foreground,focused]);
  useEffect(()=>{
    if(!focused||!foreground||!waiting||busy||polling.current>=3)return;
    const timer=setTimeout(()=>{polling.current++;data.reload();reload();},[2000,5000,10000][polling.current]);
    return()=>clearTimeout(timer);
  },[focused,foreground,waiting,busy,data.data,data.reload,reload]);

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
        if(!managedPaymentEligible(latest)||!candidate||history.some(managedPaymentApplied))return;
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

  async function acceptUpdatedPrice(){
    if(running.current||useLiveSession.getState().user?._id!==owner)return;
    const store=await journal('managed-v3-price-consent',owner,r._id);
    const saved=await store.read();
    if(!saved?.priceReview)return;
    await store.write({...saved,priceReview:{...saved.priceReview,accepted:true}});
    if(useLiveSession.getState().user?._id===owner)priceConsent.reload();
  }

  return <Card>
    <AppText variant="card">Thanh toán toàn bộ tiền thuê · PayOS</AppText>
    <ResourceState {...priceConsent}/>
    {priceConsent.data?.priceReview&&!priceConsent.data.priceReview.accepted&&<Card>
      <AppText variant="medium">Giá tạo đơn khác với báo giá bạn đã xem</AppText>
      <AppText>Báo giá đã xem: {money(priceConsent.data.priceReview.quotedAmount)}</AppText>
      <AppText>Giá đã ghi nhận cho đơn: {money(priceConsent.data.priceReview.authoritativeAmount)}</AppText>
      <AppText>Vui lòng xác nhận mức giá của đơn trước khi tiếp tục thanh toán.</AppText>
      <Button label="Tôi xác nhận mức giá của đơn" variant="orange" disabled={priceConsent.loading||!!priceConsent.error} onPress={()=>void acceptUpdatedPrice()}/>
    </Card>}
    <ResourceState {...data}/>
    {applied&&<AppText>{r.status==='PAID'?'Thanh toán đã được xác minh và ghi nhận.':'Giao dịch đã xác minh; đơn thuê đang được cập nhật trạng thái từ máy chủ.'}</AppText>}
    {applied&&<AppText>Đã thanh toán: {money(applied.amount)}</AppText>}
    {progress==='REVIEW'?<AppText accessibilityRole="alert">Giao dịch cần được đối soát trước khi tiếp tục.</AppText>:null}
    {progress==='UNSYNCED'&&<AppText accessibilityRole="alert">Chưa thể xác minh khoản thanh toán liên kết. Hãy tải lại hoặc liên hệ cơ sở để được hỗ trợ.</AppText>}
    {ready?<><FullRentCheckout payment={ready} url={checkoutLink(ready,r._id,'FULL_RENT')}/>
      <AppText>Quay lại ứng dụng sau khi thanh toán để kiểm tra trạng thái.</AppText></>:null}
    {review?<AppText>Giao dịch cần kiểm tra trước khi tiếp tục.</AppText>:null}
    {action==='CREATE'?<Button label="Tạo giao dịch PayOS" loading={busy} onPress={()=>void act('create')}/>:null}
    {action==='RECOVER'?<Button label="Khôi phục yêu cầu thanh toán" loading={busy} onPress={()=>void act('recover')}/>:null}
    {action==='RETRY'?<Button label="Thử thanh toán lại" loading={busy} onPress={()=>void act('retry')}/>:null}
    {managedPaymentEligible(r)&&candidate&&!applied?<Button label="Đối soát giao dịch" variant="outline" loading={busy} onPress={()=>void act('reconcile')}/>:null}
    <Button label="Tải lại thanh toán" variant="quiet" disabled={busy} onPress={()=>{polling.current=0;data.reload();reload();}}/>
    {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
    <AppText variant="medium">Lịch sử thanh toán</AppText>
    {data.data?.historyError&&<AppText accessibilityRole="alert">Chưa thể tải lịch sử thanh toán. Vui lòng thử lại.</AppText>}
    {rows?.length===0?<AppText>Chưa có giao dịch.</AppText>:null}
    {rows?.map(row=><Card key={row.id}>
      <AppText variant="medium">100% tiền thuê · {managedPaymentLabel(row)}</AppText>
      <AppText>{money(row.amount)} · {row.createdAt?new Date(row.createdAt).toLocaleString('vi-VN'):'Chưa có ngày tạo từ máy chủ'}</AppText>
      {selectedPaymentId===row.id&&<>
        <ResourceState {...paymentDetail} resource="chi tiết giao dịch"/>
        {paymentDetail.data&&<>
          <AppText>Mã giao dịch: {paymentDetail.data.id}</AppText>
          {paymentDetail.data.orderCode!==undefined&&<AppText>Mã thanh toán: {paymentDetail.data.orderCode}</AppText>}
          <AppText>Trạng thái: {managedPaymentLabel(paymentDetail.data)}</AppText>
          <AppText>Thanh toán toàn bộ tiền thuê · {money(paymentDetail.data.amount)}</AppText>
        </>}
        <Button label="Tải lại chi tiết" variant="quiet" disabled={paymentDetail.loading} onPress={paymentDetail.reload}/>
      </>}
      <Button label={selectedPaymentId===row.id?'Ẩn chi tiết':'Xem chi tiết giao dịch'} variant="outline"
        onPress={()=>setSelectedPaymentId(current=>current===row.id?'':row.id)}/>
    </Card>)}
  </Card>;
}
