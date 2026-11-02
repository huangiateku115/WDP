import {useEffect,useRef,useState} from 'react';
import {initiateCustomerBalance,confirmMockCustomerBalance} from '@/api/customerBalanceApi';
import {balanceKey,customerBalanceState,confirmedBalanceResult,canMockConfirmBalance,confirmedMockBalanceResult} from '@/lib/customerBalance';
import {Dialog} from '@/components/ui/dialog';
import {customerManagedContractState} from '@/lib/customerManagedContractState';
import {reservationAmount} from '@/lib/customerReservationDisplay';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {Card,CardContent,Button,Details,Message,LoadState,useBackend,record,recordId,rentalError} from './RentalBackendUI';

export default function CustomerBalancePayment({reservation,loadLatest,onReservationRefresh}){
  const session=useAuthSession(),rid=recordId(reservation),uid=recordId(session.user);
  const storageKey=`VaultSpace_balance_attempt:${uid}:${rid}`;
  const [attempt,setAttempt]=useState(()=>{try{return localStorage.getItem(storageKey)?'UNKNOWN':'';}catch{return 'STORAGE_UNAVAILABLE';}});
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const [pendingPayment,setPendingPayment]=useState(null),[mockDialog,setMockDialog]=useState(false),[mockLocked,setMockLocked]=useState(false);
  const mockEnabled=import.meta.env.DEV===true&&import.meta.env.VITE_ENABLE_MANAGED_BALANCE_MOCK==='true';
  const busy=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const resource=useBackend(config=>loadLatest(config),[rid]);
  const current=resource.data?.reservation,contract=resource.data?.contract;
  const state=customerBalanceState(current,contract,session.user);
  const progress=current&&contract?customerManagedContractState(contract,current,session.user):null;
  const amounts=current?.managedPricingSnapshot?.amountBreakdown,currency=current?.managedPricingSnapshot?.pricingRule?.currency;
  const amount=value=>typeof value==='number'&&Number.isFinite(value)&&typeof currency==='string'?reservationAmount(value,currency):'Not verified';
  const live=token=>active.current&&getAccessToken()===token;
  async function pay(){
    if(busy.current||attempt||!state.eligible)return;
    busy.current=true;setPending(true);setError('');const token=getAccessToken();let submitted=false;
    try{
      const latest=await loadLatest();if(!live(token))return;
      const eligibility=customerBalanceState(latest.reservation,latest.contract,session.user);
      if(recordId(latest.reservation)!==rid||!eligibility.eligible)throw Error(eligibility.reason||'Balance eligibility changed. Refresh reservation.');
      // A durable, non-secret marker prevents remount/reload from automatically reopening an uncertain POST.
      // The same deterministic body key also lets Backend deduplicate across tabs/devices.
      if(localStorage.getItem(storageKey)){setAttempt('UNKNOWN');return;}
      localStorage.setItem(storageKey,'submitted');
      submitted=true;setAttempt('UNKNOWN');
      const result=record(await initiateCustomerBalance(rid,balanceKey(rid)));
      if(!live(token))return;
      const status=confirmedBalanceResult(result,latest.reservation,session.user);
      setAttempt(status);
      setPendingPayment(status==='PENDING'?result.payment:null);
      if(status==='SUCCEEDED'){resource.retry();onReservationRefresh();}
    }catch(e){if(live(token))setError(submitted?`${rentalError(e)} Payment outcome may be unknown. Use GET refresh only; do not submit again.`:rentalError(e));}
    finally{busy.current=false;if(live(token))setPending(false);}
  }
  async function refresh(){
    if(busy.current)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();
    try{const latest=await loadLatest();if(!live(token))return;resource.retry();if(customerBalanceState(latest.reservation,latest.contract,session.user).complete)onReservationRefresh();}
    catch(e){if(live(token))setError(rentalError(e));}
    finally{busy.current=false;if(live(token))setPending(false);}
  }
  async function confirmMock(){
    if(!mockEnabled||busy.current||mockLocked||attempt!=='PENDING'||!canMockConfirmBalance(current,contract,session.user,pendingPayment))return;
    busy.current=true;setPending(true);setError('');const token=getAccessToken();let submitted=false;
    try{
      const latest=await loadLatest();if(!live(token))return;
      if(recordId(latest.reservation)!==rid||!canMockConfirmBalance(latest.reservation,latest.contract,session.user,pendingPayment))throw Error('Pending Balance or contract eligibility changed. Use GET refresh.');
      const marker=`${storageKey}:mock-confirm`;
      if(localStorage.getItem(marker)){setMockLocked(true);setAttempt('UNKNOWN');setPendingPayment(null);return;}
      localStorage.setItem(marker,'submitted');submitted=true;setMockLocked(true);setAttempt('UNKNOWN');setPendingPayment(null);
      const result=record(await confirmMockCustomerBalance(rid,pendingPayment.idempotencyKey));
      if(!live(token))return;
      confirmedMockBalanceResult(result,latest.reservation,session.user,pendingPayment);
      const refreshed=await loadLatest();if(!live(token))return;
      resource.retry();
      if(recordId(refreshed.reservation)!==rid||!customerBalanceState(refreshed.reservation,refreshed.contract,session.user).complete)throw Error('Mock confirmation returned, but CHECKIN_READY was not verified by GET. Refresh before continuing.');
      setAttempt('SUCCEEDED');onReservationRefresh();
    }catch(e){if(live(token))setError(submitted?`${rentalError(e)} Mock confirmation outcome is unresolved. Use GET refresh only; do not confirm again.`:rentalError(e));}
    finally{busy.current=false;if(live(token)){setPending(false);setMockDialog(false);}}
  }
  return <Card><CardContent className="space-y-4">
    <h2 className="text-xl font-bold">Balance Payment</h2>
    <p className="text-sm text-slate-500">Development simulation · Provider MOCK. Deposit credit is already included in the Backend balance; it is not charged again.</p>
    <LoadState resource={resource}/>
    {current&&<Details values={[["Total rent",amount(amounts?.totalDue)],["Deposit credit",amount(amounts?.depositCredit)],["Remaining balance (snapshot)",amount(amounts?.balanceDue)],["Currency",currency||'Not verified'],["Contract signature progress",progress?.progress?.status||'Not verified'],["Reservation status",current.status]]}/>}
    <Message error={error}/>
    {state.complete?<Message success={state.reason}/>:<>
      {attempt==='PENDING'?<p role="status" className="text-orange-700">Balance PENDING — Awaiting confirmation. Provider MOCK. Refresh after external development confirmation.</p>:attempt==='SUCCEEDED'?<p role="status">Backend payment SUCCEEDED. Refresh reservation to reconcile its current stage.</p>:attempt?<p role="status" className="text-orange-700">{attempt==='STORAGE_UNAVAILABLE'?'Safe payment attempt storage is unavailable. Payment is disabled.':'Payment outcome is not verified. Use GET refresh only. No payment-status lookup is available; DEPOSIT_PAID alone does not prove no payment exists.'}</p>:null}
      {current&&!state.eligible&&<p role="note" className="text-orange-700">{state.reason}</p>}
      <Button variant="orange" onClick={pay} disabled={pending||resource.loading||!!resource.error||!!attempt||!state.eligible}>{pending?'Checking…':'Pay Balance (MOCK)'}</Button>
    </>}
    {mockEnabled&&current?.serviceType==='MANAGED_INVENTORY'&&current.bookingFlowVersion===2&&current.status==='DEPOSIT_PAID'&&session.user?.role==='CUSTOMER'&&recordId(current.customerId)===uid&&<div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <p className="text-xs font-bold text-orange-700">DEVELOPMENT ONLY · Simulated Balance confirmation</p>
      <Button variant="orange" disabled={pending||resource.loading||!!resource.error||mockLocked||attempt!=='PENDING'||!canMockConfirmBalance(current,contract,session.user,pendingPayment)} onClick={()=>setMockDialog(true)}>Mock Confirm Balance</Button>
      <p className="text-xs text-slate-500">Requires a verified PENDING receipt from this session. This does not confirm physical inbound or activate the rental.</p>
    </div>}
    {mockEnabled&&mockDialog&&<Dialog title="Confirm development Balance simulation" description="This confirms one simulated remaining-balance payment on the development Backend. No real money is transferred." busy={pending} onClose={()=>setMockDialog(false)}><div className="flex flex-wrap gap-3"><Button variant="orange" disabled={pending||mockLocked||!canMockConfirmBalance(current,contract,session.user,pendingPayment)} onClick={confirmMock}>Confirm simulated Balance</Button><Button variant="outline" disabled={pending} onClick={()=>setMockDialog(false)}>Cancel</Button></div></Dialog>}
    {state.complete&&<Button disabled>Balance payment confirmed</Button>}
    <Button variant="outline" onClick={refresh} disabled={pending}>Refresh balance status (GET)</Button>
    <p className="text-xs text-slate-500">Snapshot amounts are historical. Only Backend settlement and reservation state confirm completion. CHECKIN_READY awaits physical inbound; it does not mean ACTIVE or occupied Cells.</p>
  </CardContent></Card>;
}
