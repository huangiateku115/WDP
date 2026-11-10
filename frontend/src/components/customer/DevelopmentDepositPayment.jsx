import { useEffect, useRef, useState } from 'react';
import { submitDevelopmentDeposit } from '@/api/customerDepositApi';
import {
  customerDepositState, confirmedDepositResult, canMockConfirmDeposit,
  confirmedDepositMockResult,
} from '@/lib/customerDeposit';
import { useAuthSession, getAccessToken } from '@/lib/authSession';
import { Dialog } from '@/components/ui/dialog';
import {
  Card, CardContent, Button, Details, Message, LoadState,
  useBackend, record, recordId, rentalError,
} from './RentalBackendUI';
import { reservationAmount } from '@/lib/customerReservationDisplay';

export default function DevelopmentDepositPayment({ reservation, loadLatest, onReservationRefresh }) {
  const session = useAuthSession();
  const reservationId = recordId(reservation);
  const storageKey = `VaultSpace_deposit_attempt:${recordId(session.user)}:${reservationId}`;
  const [attempt, setAttempt] = useState(() => {
    try { return localStorage.getItem(storageKey) ? 'UNKNOWN' : ''; }
    catch { return 'STORAGE_UNAVAILABLE'; }
  });
  const [payment, setPayment] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [now, setNow] = useState(Date.now);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active.current = false; clearInterval(timer); };
  }, []);
  const resource = useBackend(config => loadLatest(config), [reservationId]);
  const current = resource.data;
  const state = customerDepositState(current, session.user, now);
  const canConfirm = attempt === 'PENDING' && canMockConfirmDeposit(current, session.user, payment, now);
  const live = token => active.current && getAccessToken() === token;

  async function submit(confirm) {
    if (busy.current || resource.loading || resource.error) return;
    if (confirm ? !canConfirm : !!attempt || !state.eligible) return;
    busy.current = true;
    setPending(true);
    setError('');
    const token = getAccessToken();
    let submitted = false;
    try {
      const latest = await loadLatest();
      if (!live(token)) return;
      const eligible = customerDepositState(latest, session.user);
      if (recordId(latest) !== reservationId || !eligible.eligible) {
        throw Error(eligible.reason || 'Deposit eligibility changed. Refresh Backend status.');
      }
      if (confirm && !canMockConfirmDeposit(latest, session.user, payment)) {
        throw Error('Pending deposit could not be verified. Refresh Backend status.');
      }
      const marker = confirm ? `${storageKey}:mock-confirm` : storageKey;
      if (localStorage.getItem(marker)) {
        setAttempt('UNKNOWN');
        setPayment(null);
        return;
      }
      localStorage.setItem(marker, 'submitted');
      submitted = true;
      setAttempt('UNKNOWN');
      const result = record(await submitDevelopmentDeposit(reservationId, confirm));
      if (!live(token)) return;
      if (confirm) {
        setAttempt(confirmedDepositMockResult(result, latest, session.user, payment));
        setPayment(null);
        resource.retry();
        onReservationRefresh();
      } else {
        const status = confirmedDepositResult(result, latest, session.user);
        setAttempt(status);
        setPayment(status === 'PENDING' ? result.payment : null);
      }
    } catch (failure) {
      if (live(token)) {
        const message = rentalError(failure);
        setError(submitted ? `${message} Outcome is unresolved. Refresh Backend status before further action.` : message);
      }
    } finally {
      busy.current = false;
      if (live(token)) { setPending(false); setDialog(false); }
    }
  }

  return <Card><CardContent className="space-y-4">
    <h2 className="text-xl font-bold">Deposit Payment (Development MOCK)</h2>
    <p className="text-sm text-slate-500">Simulate advance-rent payment using the development Backend.</p>
    <LoadState resource={resource} />
    {state.financials && <Details values={[
      ['Reservation status', current.status],
      ['Deposit amount', reservationAmount(state.financials.advanceDepositRequired, state.financials.currency)],
    ]} />}
    <Message error={error} />
    {state.complete ? <Message success="Deposit Paid" /> : <>
      {!state.eligible && current && <p role="note">{state.reason}</p>}
      {attempt && <p role="status">{attempt === 'PENDING'
        ? 'Deposit PENDING. Review and confirm the development simulation.'
        : `Deposit outcome ${attempt}. Refresh Backend status to reconcile.`}</p>}
      <Button onClick={() => submit(false)} disabled={pending || resource.loading || !!resource.error || !!attempt || !state.eligible}>Pay Deposit (MOCK)</Button>
      {canConfirm && <Button onClick={() => setDialog(true)} disabled={pending}>Mock Confirm Deposit</Button>}
    </>}
    <Button variant="outline" onClick={() => { resource.retry(); onReservationRefresh(); }} disabled={pending}>Refresh deposit status (GET)</Button>
    {dialog && <Dialog title="Confirm development Deposit simulation" description="Simulate the advance-rent deposit for this demo reservation." busy={pending} onClose={() => setDialog(false)}>
      <div className="flex gap-3">
        <Button onClick={() => submit(true)} disabled={pending || !canConfirm}>Confirm simulated Deposit</Button>
        <Button variant="outline" onClick={() => setDialog(false)} disabled={pending}>Cancel</Button>
      </div>
    </Dialog>}
  </CardContent></Card>;
}
