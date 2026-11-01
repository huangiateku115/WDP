import {useEffect,useRef,useState} from 'react';
import {useAuthSession,getAccessToken} from '@/lib/authSession';
import {initiateSelfStoragePayment,confirmSelfStoragePayment} from '@/api/selfStoragePaymentApi';
import {selfStorageStage,selfStorageQuote,selfStorageSettlement,selfStorageConfirmationPolicy} from '@/lib/selfStorageStagedPayment';
import {selfPaymentError} from '@/lib/selfStoragePayment';
import {reservationAmount} from '@/lib/customerReservationDisplay';
import {CustomerScreen,Card,CardContent,Button,Link,Details,Message,LoadState,useBackend,record,recordId} from './RentalBackendUI';

export default function SelfStorageStagedPayment({reservationId,loadContext}){
  const session=useAuthSession(),context=useBackend(config=>loadContext(reservationId,config),[reservationId]);
  const [snapshot,setSnapshot]=useState(null),[quote,setQuote]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[locked,setLocked]=useState(false);
  const busy=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const current=snapshot||context.data,reservation=current?.reservation,contract=current?.contract;
  const stage=selfStorageStage(reservation,contract,session.user),policy=selfStorageConfirmationPolicy(import.meta.env);
  const live=token=>active.current&&getAccessToken()===token;
  const storageKey=purpose=>`VaultSpace_self_payment_confirmation:${recordId(session.user)}:${reservationId}:${purpose}`;
  async function latest(){
    const fresh=await loadContext(reservationId);
    if(recordId(fresh?.reservation)!==reservationId)throw Error('Reservation identity changed. Refresh before continuing.');
    return fresh;
  }
  async function refresh(){
    if(busy.current)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();
    try{const fresh=await latest();if(!live(token))return;setSnapshot(fresh);setQuote(null);
      const marker=stage.purpose&&localStorage.getItem(storageKey(stage.purpose));
      setLocked(!!marker);setNotice(marker?'A confirmation was previously submitted. Only GET reconciliation is available; a fresh read alone does not make this callback safe to retry.':'Backend reservation and contract refreshed.');
    }catch(e){if(live(token)){setError(selfPaymentError(e));setLocked(true);}}
    finally{busy.current=false;if(live(token))setPending(false);}
  }
  async function initiate(){
    if(busy.current||!stage.eligible||locked)return;busy.current=true;setPending(true);setError('');setNotice('');setQuote(null);const token=getAccessToken();
    try{const fresh=await latest();if(!live(token))return;setSnapshot(fresh);
      const checked=selfStorageStage(fresh.reservation,fresh.contract,session.user);
      if(!checked.eligible||checked.purpose!==stage.purpose)throw Error(checked.reason||'Payment eligibility changed.');
      const result=record(await initiateSelfStoragePayment(reservationId,checked.purpose));if(!live(token))return;
      const verified=selfStorageQuote(result,fresh.reservation,checked.purpose);
      if(checked.purpose==='BALANCE'&&recordId(verified.contract)!==recordId(fresh.contract))throw Error('Paper contract identity changed. Refresh before continuing.');
      setQuote(verified);setNotice('Amount ready — awaiting explicit confirmation. No payment PENDING record or settlement was created by initiation.');
      const updated=await latest();if(live(token)){
        setSnapshot(updated);
        const currentStage=selfStorageStage(updated.reservation,updated.contract,session.user);
        if(!currentStage.eligible||currentStage.purpose!==checked.purpose){setQuote(null);return;}
        selfStorageQuote(verified,updated.reservation,checked.purpose);
      }
    }catch(e){if(live(token)){setQuote(null);setError(selfPaymentError(e));}}
    finally{busy.current=false;if(live(token))setPending(false);}
  }
  async function confirm(){
    if(busy.current||locked||!policy.enabled||!quote||quote.amount<=0||!stage.eligible||quote.purpose!==stage.purpose)return;
    busy.current=true;setPending(true);setError('');const token=getAccessToken();let sent=false;
    try{const fresh=await latest();if(!live(token))return;setSnapshot(fresh);
      const checked=selfStorageStage(fresh.reservation,fresh.contract,session.user);
      if(!checked.eligible||checked.purpose!==quote.purpose)throw Error(checked.reason||'Payment stage changed.');
      selfStorageQuote(quote,fresh.reservation,checked.purpose);
      const key=storageKey(checked.purpose);
      if(localStorage.getItem(key)){setLocked(true);throw Error('A confirmation was previously submitted. Refresh only; do not resubmit.');}
      localStorage.setItem(key,'submitted');setLocked(true);sent=true;
      const result=record(await confirmSelfStoragePayment(reservationId,checked.purpose));if(!live(token))return;
      selfStorageSettlement(result,fresh.reservation,checked.purpose,quote,session.user);
      setQuote(null);setNotice(`${checked.purpose} payment SUCCEEDED. Refreshing authoritative reservation and contract.`);
      const updated=await latest();if(live(token)){setSnapshot(updated);setNotice(`${checked.purpose} payment SUCCEEDED. Backend state refreshed.`);setLocked(false);}
    }catch(e){if(live(token)){
      setError(`${selfPaymentError(e)}${sent?' Confirmation may have committed. This endpoint is not replay-safe; use GET refresh only.':''}`);
      if(sent){setQuote(null);try{const updated=await latest();if(live(token))setSnapshot(updated);}catch{/* Keep confirmation locked. */}}
    }}finally{busy.current=false;if(live(token))setPending(false);}
  }
  return <CustomerScreen title="Self Storage Deposit & Balance" description="Review Backend amounts and the paper-signing prerequisites for your reservation.">
    {!snapshot&&<LoadState resource={context}/>}
    <Card><CardContent className="space-y-4">
      <h2 className="text-xl font-bold">{stage.complete?'Payment status':stage.purpose==='BALANCE'?'Remaining balance':'Advance deposit'}</h2>
      {reservation&&<Details values={[["Reservation",reservation.reservationCode||reservationId],["Reservation status",reservation.status],["Contract status",contract?.status||'Not created'],["Paper-signing proof",contract?.signedProofUrl?'Returned by Backend':'Awaiting Staff']]}/>}
      <p role="status" className={stage.complete?'text-brand':'text-sm text-slate-600'}>{stage.reason}</p>
      {!stage.complete&&<Button variant="orange" disabled={pending||(!snapshot&&(context.loading||!!context.error))||locked||!stage.eligible} aria-busy={pending} onClick={initiate}>{pending?'Checking…':stage.purpose==='BALANCE'?'Review balance amount':'Review deposit amount'}</Button>}
      {quote&&<div className="space-y-3"><Details values={[["Purpose",quote.purpose],["Total rent",reservationAmount(quote.breakdown.totalDue,'VND')],["Deposit credit",reservationAmount(quote.breakdown.depositCredit,'VND')],["Remaining balance",reservationAmount(quote.breakdown.balanceDue,'VND')],["Amount for this step",reservationAmount(quote.amount,'VND')]]}/>
        {quote.amount===0&&<p className="text-sm text-orange-700">Backend returned zero for this step. Zero-amount confirmation is blocked: the current payment ledger requires a positive amount and no zero-payment settlement path is provided.</p>}
        {import.meta.env.DEV===true&&<Button variant="orange" onClick={confirm} disabled={!policy.enabled||pending||locked||quote.amount<=0||!stage.eligible}>Confirm {quote.purpose==='DEPOSIT'?'Deposit':'Balance'} (Development MOCK)</Button>}
      </div>}
      {!stage.complete&&!policy.enabled&&<p role="note" className="text-sm text-orange-700">{policy.reason}</p>}
      {notice&&<p role="status" className="text-sm text-brand">{notice}</p>}
      <Message error={error}/>
      {locked&&<p className="text-sm text-orange-700">Confirmation is locked. Backend callbacks do not accept a client idempotency key. Do not create another payment after an uncertain outcome.</p>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={refresh} disabled={pending}>Refresh reservation and contract (GET)</Button><Button asChild variant="outline"><Link to={`/portal/reservations/${reservationId}`}>View Reservation</Link></Button>{contract&&<Button asChild variant="outline"><Link to={`/portal/contracts/${reservationId}`}>View Contract</Link></Button>}</div>
    </CardContent></Card>
  </CustomerScreen>;
}
