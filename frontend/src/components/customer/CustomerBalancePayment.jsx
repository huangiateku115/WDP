import { useEffect, useRef, useState } from 'react';
import { initiateCustomerBalance, confirmCustomerBalance, balanceMockEnabled } from '@/api/customerBalanceApi';
import { balanceKey, customerBalanceState, confirmedBalanceResult, confirmedBalanceSettlement, verifiedPendingBalance } from '@/lib/customerBalance';
import { customerManagedContractState } from '@/lib/customerManagedContractState';
import { reservationAmount } from '@/lib/customerReservationDisplay';
import { useAuthSession, getAccessToken } from '@/lib/authSession';
import { Card, CardContent, Button, Details, Message, LoadState, useBackend, record, recordId, rentalError } from './RentalBackendUI';

export default function CustomerBalancePayment({ reservation, loadLatest, onReservationRefresh }) {
  const session = useAuthSession(), rid = recordId(reservation), uid = recordId(session.user);
  const storageKey = `VaultSpace_balance_attempt:${uid}:${rid}`;
  const [attempt, setAttempt] = useState(() => { try { return localStorage.getItem(storageKey) ? 'UNKNOWN' : ''; } catch { return 'STORAGE_UNAVAILABLE'; } });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const paymentStorageKey = `${storageKey}:pending`;
  const [payment, setPayment] = useState(() => { try { return JSON.parse(localStorage.getItem(paymentStorageKey) || 'null'); } catch { return null; } });
  const [confirmationBlocked, setConfirmationBlocked] = useState(false);
  const busy = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const resource = useBackend(config => loadLatest(config), [rid]);
  const current = resource.data?.reservation, contract = resource.data?.contract;
  const state = customerBalanceState(current, contract, session.user);
  const progress = current && contract ? customerManagedContractState(contract, current, session.user) : null;
  const amounts = current?.managedPricingSnapshot?.amountBreakdown, currency = current?.managedPricingSnapshot?.pricingRule?.currency;
  const amount = value => typeof value === 'number' && Number.isFinite(value) && typeof currency === 'string' ? reservationAmount(value, currency) : 'Not verified';
  const live = token => active.current && getAccessToken() === token;
  async function pay() {
    if (busy.current || attempt || !state.eligible) return;
    busy.current = true; setPending(true); setError(''); const token = getAccessToken(); let submitted = false;
    try {
      const latest = await loadLatest(); if (!live(token)) return;
      const eligibility = customerBalanceState(latest.reservation, latest.contract, session.user);
      if (recordId(latest.reservation) !== rid || !eligibility.eligible) throw Error(eligibility.reason || 'Balance eligibility changed. Refresh reservation.');
      // A durable, non-secret marker prevents remount/reload from automatically reopening an uncertain POST.
      // The same deterministic body key also lets Backend deduplicate across tabs/devices.
      if (localStorage.getItem(storageKey)) { setAttempt('UNKNOWN'); return; }
      localStorage.setItem(storageKey, 'submitted');
      submitted = true; setAttempt('UNKNOWN');
      const result = record(await initiateCustomerBalance(rid, balanceKey(rid)));
      if (!live(token)) return;
      const status = confirmedBalanceResult(result, latest.reservation, session.user);
      setAttempt(status);
      if (status === 'PENDING') { setPayment(result.payment); try { localStorage.setItem(paymentStorageKey, JSON.stringify(result.payment)); } catch {/* Reload fails closed if storage is unavailable. */ } }
      if (status === 'SUCCEEDED') { resource.retry(); onReservationRefresh(); }
    } catch (e) { if (live(token)) setError(submitted ? `${rentalError(e)} Payment outcome may be unknown. Use GET refresh only; do not submit again.` : rentalError(e)); }
    finally { busy.current = false; if (live(token)) setPending(false); }
  }
  async function confirm() {
    if (busy.current || confirmationBlocked || !balanceMockEnabled() || !state.eligible || !verifiedPendingBalance(payment, current, session.user)) return;
    busy.current = true; setPending(true); setError(''); const token = getAccessToken();
    try {
      const latest = await loadLatest(); if (!live(token)) return;
      const eligibility = customerBalanceState(latest.reservation, latest.contract, session.user);
      if (recordId(latest.reservation) !== rid) throw Error('Reservation identity changed. Refresh before retrying.');
      if (eligibility.complete) { resource.retry(); onReservationRefresh(); return; }
      if (!eligibility.eligible || !verifiedPendingBalance(payment, latest.reservation, session.user)) throw Error(eligibility.reason || 'Pending balance could not be verified.');
      const result = record(await confirmCustomerBalance(rid, payment.idempotencyKey));
      if (!live(token)) return;
      confirmedBalanceSettlement(result, latest.reservation, session.user, payment);
      setAttempt('SUCCEEDED'); setPayment(null); try { localStorage.removeItem(paymentStorageKey); } catch {/* Preserve original attempt marker. */ }
      resource.retry(); onReservationRefresh();
    } catch (e) {
      if (live(token)) {
        const code = e.response?.status;
        setConfirmationBlocked([400, 401, 403, 404, 409].includes(code));
        setError(`${rentalError(e)} ${code === 404 ? 'Mock confirmation may be disabled or payment unavailable. ' : ''}Refresh Backend state before retrying. An uncertain confirmation can only be retried with the same payment key; do not initiate another payment.`);
        resource.retry();
      }
    } finally { busy.current = false; if (live(token)) setPending(false); }
  }
  async function refresh() {
    if (busy.current) return; busy.current = true; setPending(true); setError(''); const token = getAccessToken();
    try { const latest = await loadLatest(); if (!live(token)) return; resource.retry(); setConfirmationBlocked(false); if (customerBalanceState(latest.reservation, latest.contract, session.user).complete) onReservationRefresh(); }
    catch (e) { if (live(token)) setError(rentalError(e)); }
    finally { busy.current = false; if (live(token)) setPending(false); }
  }
  return <Card><CardContent className="space-y-4">
    <h2 className="text-xl font-bold">Balance Payment</h2>
    <p className="text-sm text-slate-500">Development simulation · Provider MOCK. Deposit credit is already included in the Backend balance; it is not charged again.</p>
    <LoadState resource={resource} />
    {current && <Details values={[["Total rent", amount(amounts?.totalDue)], ["Deposit credit", amount(amounts?.depositCredit)], ["Remaining balance (snapshot)", amount(amounts?.balanceDue)], ["Currency", currency || 'Not verified'], ["Contract signature progress", progress?.progress?.status || 'Not verified'], ["Reservation status", current.status]]} />}
    <Message error={error} />
    {state.complete ? <Message success={state.reason} /> : <>
      {(attempt === 'PENDING' || verifiedPendingBalance(payment, current, session.user)) ? <p role="status" className="text-orange-700">Balance PENDING — Awaiting confirmation. Provider MOCK. Use explicit development confirmation when enabled, or refresh after external confirmation.</p> : attempt === 'SUCCEEDED' ? <p role="status">Backend payment SUCCEEDED. Refresh reservation to reconcile its current stage.</p> : attempt ? <p role="status" className="text-orange-700">{attempt === 'STORAGE_UNAVAILABLE' ? 'Safe payment attempt storage is unavailable. Payment is disabled.' : 'Payment outcome is not verified. Use GET refresh only. No payment-status lookup is available; DEPOSIT_PAID alone does not prove no payment exists.'}</p> : null}
      {current && !state.eligible && <p role="note" className="text-orange-700">{state.reason}</p>}
      <Button variant="orange" onClick={pay} disabled={pending || resource.loading || !!resource.error || !!attempt || !state.eligible}>{pending ? 'Checking…' : 'Pay Balance (MOCK)'}</Button>
    </>}
    {!state.complete && balanceMockEnabled() && verifiedPendingBalance(payment, current, session.user) && <div className="space-y-2">
      <p className="text-sm text-orange-700">Development only: manually simulate settlement of this existing MOCK balance payment. This does not charge a payment provider.</p>
      <Button variant="orange" onClick={confirm} disabled={pending || resource.loading || !!resource.error || confirmationBlocked || !state.eligible}>{pending ? 'Checking…' : 'Confirm Balance (Development MOCK)'}</Button>
    </div>}
    {!state.complete && payment && !balanceMockEnabled() && <p className="text-sm text-slate-500">Frontend mock confirmation is disabled. Requires development and explicit balance mock opt-in; Backend must also enable the Managed check-in flow.</p>}
    {state.complete && <Button disabled>Balance payment confirmed</Button>}
    <Button variant="outline" onClick={refresh} disabled={pending}>Refresh balance status (GET)</Button>
    <p className="text-xs text-slate-500">Snapshot amounts are historical. Only Backend settlement and reservation state confirm completion. CHECKIN_READY awaits physical inbound; it does not mean ACTIVE or occupied Cells.</p>
  </CardContent></Card>;
}
