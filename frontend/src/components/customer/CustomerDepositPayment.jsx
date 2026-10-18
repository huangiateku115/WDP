import {useEffect,useRef,useState} from 'react';
import managedReservationApi from '@/api/managedReservationApi';
import {customerDepositState,confirmedDepositResult,depositKey,canMockConfirmDeposit,confirmedDepositMockResult} from '@/lib/customerDeposit';
import {Dialog} from '@/components/ui/dialog';
import {reservationAmount} from '@/lib/customerReservationDisplay';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {Card,CardContent,Button,Details,Message,LoadState,useBackend,record,recordId,rentalError} from './RentalBackendUI';

export default function CustomerDepositPayment({reservation,loadLatest,onReservationRefresh}){
  const session=useAuthSession(),rid=recordId(reservation);
  const storageKey=`VaultSpace_deposit_attempt:${recordId(session.user)}:${rid}`;
  const [attempt,setAttempt]=useState(()=>{try{return localStorage.getItem(storageKey)?'UNKNOWN':'';}catch{return 'STORAGE_UNAVAILABLE';}});
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now);
  const [pendingPayment,setPendingPayment]=useState(null),[mockDialog,setMockDialog]=useState(false),[mockLocked,setMockLocked]=useState(false);
  const mockEnabled=import.meta.env.DEV===true&&import.meta.env.VITE_ENABLE_MANAGED_DEPOSIT_MOCK==='true';
  const busy=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>{active.current=false;clearInterval(timer);};},[]);
  const resource=useBackend(config=>loadLatest(config),[rid]);
  const current=resource.data,state=customerDepositState(current,session.user,now);
  const b=current?.managedPricingSnapshot?.amountBreakdown,currency=current?.managedPricingSnapshot?.pricingRule?.currency;
  const amount=value=>typeof value==='number'&&Number.isFinite(value)&&typeof currency==='string'?reservationAmount(value,currency):'Not verified';
  const live=token=>active.current&&getAccessToken()===token;
  async function pay(){
    if(busy.current||attempt||!state.eligible||resource.loading||resource.error)return;
    busy.current=true;setPending(true);setError('');const token=getAccessToken();let submitted=false;
    try{
      const latest=await loadLatest();if(!live(token))return;
      const eligibility=customerDepositState(latest,session.user);
      if(recordId(latest)!==rid||!eligibility.eligible)throw Error(eligibility.reason||'Deposit eligibility changed. Refresh reservation.');
      if(localStorage.getItem(storageKey)){setAttempt('UNKNOWN');return;}
      // Persist only a non-secret uncertainty marker; never treat browser storage as payment proof.
      localStorage.setItem(storageKey,'submitted');submitted=true;setAttempt('UNKNOWN');
      const result=record(await managedReservationApi.initiateDeposit(rid,{idempotencyKey:depositKey(rid)}));
      if(!live(token))return;
      const status=confirmedDepositResult(result,latest,session.user);
      setAttempt(status);setPendingPayment(status==='PENDING'?result.payment:null);
    }catch(e){if(live(token))setError(submitted?`${rentalError(e)} Deposit confirmation is unresolved. Use GET refresh only; do not submit again.`:rentalError(e));}
    finally{busy.current=false;if(live(token))setPending(false);}
  }
  async function refresh(){
    if(busy.current)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();
    try{const latest=await loadLatest();if(!live(token))return;resource.retry();if(recordId(latest)===rid&&customerDepositState(latest,session.user).complete)onReservationRefresh();}
    catch(e){if(live(token))setError(rentalError(e));}
    finally{busy.current=false;if(live(token))setPending(false);}
  }
  async function confirmMock(){
    if(!mockEnabled||busy.current||mockLocked||attempt!=='PENDING'||!canMockConfirmDeposit(current,session.user,pendingPayment))return;
    busy.current=true;setPending(true);setError('');const token=getAccessToken();let submitted=false;
    try{
      const latest=await loadLatest();if(!live(token))return;
      // No supported GET payment lookup exists: revalidate the bound POST04 receipt against fresh reservation data.
      // Backend atomically checks the actual ledger status; never recover a receipt from browser storage.
      if(recordId(latest)!==rid||!canMockConfirmDeposit(latest,session.user,pendingPayment))throw Error('Pending Deposit or reservation eligibility changed. Use GET refresh.');
      const marker=`${storageKey}:mock-confirm`;
      if(localStorage.getItem(marker)){setMockLocked(true);setAttempt('UNKNOWN');setPendingPayment(null);return;}
      localStorage.setItem(marker,'submitted');submitted=true;setMockLocked(true);setAttempt('UNKNOWN');setPendingPayment(null);
      const result=record(await managedReservationApi.confirmMockDeposit(rid,{idempotencyKey:pendingPayment.idempotencyKey}));
      if(!live(token))return;
      const status=confirmedDepositMockResult(result,latest,session.user,pendingPayment);
      setAttempt(status);
      const refreshed=await loadLatest();if(!live(token))return;
      resource.retry();
      if(status==='SUCCEEDED'&&recordId(refreshed)===rid&&customerDepositState(refreshed,session.user).complete)onReservationRefresh();
    }catch(e){if(live(token))setError(submitted?`${rentalError(e)} Mock confirmation outcome is unresolved. Use GET refresh only; do not confirm again.`:rentalError(e));}
    finally{busy.current=false;if(live(token)){setPending(false);setMockDialog(false);}}
  }
  return <Card><CardContent className="space-y-4">
    <h2 className="text-xl font-bold">Deposit Payment</h2>
    <p className="text-sm text-slate-500">Deposit is advance rent credited toward the total, not a refundable security deposit. Development simulation · Provider MOCK.</p>
    <LoadState resource={resource}/>
    {current&&<Details values={[["Reservation code",current.reservationCode||'Not returned'],["Current reservation status",current.status],["Total rent",amount(b?.totalDue)],["Deposit amount",amount(b?.depositCredit)],["Remaining balance after Deposit (snapshot)",amount(b?.balanceDue)]]}/>}
    <Message error={error}/>
    {state.complete?<><Message success="Deposit Paid"/><Button disabled>Deposit Paid</Button><p className="text-sm">The Backend has confirmed the deposit stage. Inventory Registration is available below when the existing rental eligibility rules permit it.</p></>:<>
      {attempt&&<p role="status" className="text-orange-700">{attempt==='PENDING'?'Deposit payment initiated. Waiting for confirmation.':attempt==='STORAGE_UNAVAILABLE'?'Safe payment attempt storage is unavailable. Deposit payment is disabled.':attempt==='RECONCILIATION_REQUIRED'?'Deposit requires reconciliation. Use GET refresh and development support; do not submit again.':attempt==='SUCCEEDED'?'Backend payment reports SUCCEEDED. Refresh reservation to verify the deposit lifecycle; completion is not yet confirmed here.':'Deposit confirmation is unresolved. Use GET refresh only. RESERVED does not prove a prior payment failed; do not submit again.'}</p>}
      {current&&!state.eligible&&<p role="note" className="text-orange-700">{state.reason}</p>}
      <Button variant="orange" onClick={pay} disabled={pending||resource.loading||!!resource.error||!!attempt||!state.eligible}>{pending?'Checking…':'Pay Deposit'}</Button>
    </>}
    {mockEnabled&&current?.serviceType==='MANAGED_INVENTORY'&&current.bookingFlowVersion===2&&current.status==='RESERVED'&&session.user?.role==='CUSTOMER'&&recordId(current.customerId)===recordId(session.user)&&<div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <p className="text-xs font-bold text-orange-700">DEVELOPMENT ONLY · Simulated Deposit confirmation</p>
      <Button variant="orange" disabled={pending||resource.loading||!!resource.error||mockLocked||attempt!=='PENDING'||!canMockConfirmDeposit(current,session.user,pendingPayment,now)} onClick={()=>setMockDialog(true)}>Mock Confirm Deposit</Button>
      <p className="text-xs text-slate-500">Requires a verified PENDING receipt from this session. Reloaded or unknown outcomes require GET reconciliation and development tooling.</p>
    </div>}
    {mockEnabled&&mockDialog&&<Dialog title="Confirm development Deposit simulation" description="DEVELOPMENT ONLY. This sends one simulated Deposit confirmation to the development Backend. It does not settle Balance, sign a contract or activate the rental." busy={pending} onClose={()=>setMockDialog(false)}>
      <div className="flex flex-wrap gap-3"><Button variant="orange" disabled={pending||mockLocked||!canMockConfirmDeposit(current,session.user,pendingPayment,now)} onClick={confirmMock}>Confirm simulated Deposit</Button><Button variant="outline" disabled={pending} onClick={()=>setMockDialog(false)}>Cancel</Button></div>
    </Dialog>}
    <Button variant="outline" onClick={refresh} disabled={pending}>Refresh Payment Status</Button>
    <p className="text-xs text-slate-500">Refresh uses GET only. Payment confirmation requires development tooling or the explicitly enabled development simulation. Deposit and Balance do not confirm physical inbound or Cell occupancy.</p>
  </CardContent></Card>;
}
