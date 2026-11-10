import { useEffect, useRef, useState } from 'react';
import axiosClient from '@/api/axiosClient';
import contractApi from '@/api/contractApi';
import { useAuthSession, getAccessToken } from '@/lib/authSession';
import { apiRecord, objectId, recordId, reviewError } from '@/lib/facilityReview';
import { Screen, Panel, Details, Message, Button, Select, Textarea } from '@/components/manager/ManagerUI';

export default function ManagedV3LifecyclePanel({ reservation, onRefresh }) {
  const { accessToken, user } = useAuthSession();
  const [contract, setContract] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [condition, setCondition] = useState('GOOD'), [notes, setNotes] = useState('');
  const operation = useRef(false);
  const reservationId = recordId(reservation), facilityId = recordId(reservation?.facilityId);
  const operator = ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(user?.role) && recordId(user?.assignedFacilityId) === facilityId;
  const reload = async () => {
    setError('');
    try { setContract(apiRecord(await contractApi.byReservationReal(reservationId))); }
    catch (cause) { if (cause?.response?.status === 404) setContract(null); else setError(reviewError(cause)); }
  };
  useEffect(() => { void reload(); }, [reservationId, accessToken]);
  const transact = async work => {
    if (operation.current || !operator) return;
    operation.current = true; setBusy(true); setError('');
    try { await work(); await reload(); onRefresh?.(); }
    catch (cause) { setError(reviewError(cause)); }
    finally { operation.current = false; setBusy(false); }
  };
  const createContract = () => transact(async () => {
    if (reservation.status !== 'DEPOSIT_PAID') throw Error('Contract snapshot requires a verified Deposit first.');
    const response = await axiosClient.post(`/reservations/managed/${encodeURIComponent(reservationId)}/contract`, {});
    const value = apiRecord(response);
    if (recordId(value.reservationId) !== reservationId || value.termsVersion !== 'MI-V3-1' || value.currentContentVersion !== 1 || !value.contentVersions?.some(v => v.version === 1 && /^[a-f\d]{64}$/i.test(v.contentHash) && v.content?.schemaVersion === 3)) throw Error('Backend did not confirm the V3 contract snapshot.');
    setContract(value);
  });
  const signFacility = () => transact(async () => {
    if (!contract?._id || contract.status !== 'DRAFT') throw Error('A draft V3 contract is required.');
    const response = await contractApi.signFacilityReal(contract._id);
    const value = apiRecord(response), active = value.contentVersions?.find(v => v.version === value.currentContentVersion);
    const customerSigned = value.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && s.signerRole === 'CUSTOMER');
    const facilitySigned = value.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(s.signerRole));
    if (recordId(value) !== recordId(contract) || !customerSigned || !facilitySigned || value.status !== 'SIGNED') throw Error('Backend did not confirm both signatures on the same current V3 contract version.');
    setContract(value);
  });
  const handover = () => transact(async () => {
    if (reservation.status !== 'PAID' || !contract || contract.status !== 'SIGNED' || !reservation.balanceSettledAt || !notes.trim()) throw Error('A paid reservation, fully signed contract and access notes are required.');
    const response = await axiosClient.post(`/reservations/managed/${encodeURIComponent(reservationId)}/handover`, { storageCondition: condition, accessNotes: notes.trim() });
    const value = apiRecord(response);
    if (recordId(value) !== reservationId || value.bookingFlowVersion !== 3 || value.status !== 'ACTIVE' || !value.handoverAt || !value.handoverByStaffId || value.storageCondition !== condition || value.handoverAccessNotes !== notes.trim()) throw Error('Backend did not confirm Managed V3 handover.');
  });
  const active = contract?.contentVersions?.find(v => v.version === contract.currentContentVersion);
  const content = active?.content;
  if (!operator) return <Panel title="Managed V3 lifecycle"><p>Only Staff or Manager assigned to this Facility can manage the V3 contract and access handover.</p></Panel>;
  return <Panel title="Managed Inventory V3 lifecycle"><Message error={error}/>
    <Details values={[["Reservation status", reservation.status], ["Contract version", active?.version ?? "Not created"], ["Content hash", active?.contentHash ?? "Not returned"], ["Signatures", contract?.signatures?.filter(s => s.version === active?.version && s.contentHash === active?.contentHash).map(s => `${s.signerRole} · ${s.signedAt}`).join("; ") || "None"]]}/>
    {content?.reservation && <Details values={[["Snapshot Facility", content.facility?.name || content.reservation.facilityId], ["Cells", content.reservation.cellIds?.join(', ') || "Not returned"], ["Allocated capacity", `${content.reservation.allocatedCapacityM3 ?? "—"} m³`], ["Rental interval", `${content.reservation.startDate} – ${content.reservation.endDate}`], ["Term", JSON.stringify(content.reservation.term)], ["Quoted rent", content.pricing?.estimatedRent], ["Advance rent", content.pricing?.depositAmount]]}/>}
    {!contract && reservation.status === 'DEPOSIT_PAID' && <Button disabled={busy} onClick={createContract}>{busy ? 'Creating…' : 'Create V3 contract snapshot'}</Button>}
    {contract?.status === 'DRAFT' && !contract.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && s.signerRole === 'CUSTOMER') && <p>Customer signature is required on the current snapshot. The backend will reject a signature for a changed version.</p>}
    {contract?.status === 'DRAFT' && contract.signatures?.some(s => s.version === active?.version && s.contentHash === active?.contentHash && s.signerRole === 'CUSTOMER') && <Button disabled={busy} onClick={signFacility}>{busy ? 'Signing…' : 'Sign current V3 contract as Facility'}</Button>}
    {reservation.status === 'PAID' && <div className="mt-4 space-y-3"><Select label="Storage condition at access handover" value={condition} onChange={setCondition} options={[["GOOD","Good"],["MINOR_DAMAGE","Minor damage recorded"],["UNSAFE","Unsafe"]]}/><Textarea aria-label="Access handover notes" required maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Record access credentials or handover notes"/><Button disabled={busy||!notes.trim()||contract?.status!=='SIGNED'} onClick={handover}>{busy ? 'Recording…' : 'Confirm access handover'}</Button></div>}
    {reservation.status === 'ACTIVE' && <p role="status">Access handover recorded at {reservation.handoverAt || '—'} by {recordId(reservation.handoverByStaffId) || '—'}. First physical inbound remains a separate action.</p>}
    <p className="mt-3 text-sm">The V3 contract uses the quote’s Cell, capacity, date, term and price snapshot. Handover activates the rental without requiring inventory to exist.</p>
  </Panel>;
}
