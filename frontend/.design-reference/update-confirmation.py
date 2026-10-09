from pathlib import Path
def edit(path,old,new):
 p=Path(path);t=p.read_text(encoding='utf-8-sig')
 if old not in t: raise Exception('Missing '+path+' '+old[:60])
 p.write_text(t.replace(old,new),encoding='utf-8')
edit('src/pages/customer/ReviewReservationPage.jsx','import { useNavigate }', '''import { useState, useRef } from 'react';
import { useReservation } from '@/contexts/ReservationContext';
import reservationApi from '@/api/reservationApi';
import { calculatePricing, formatMoney, formatDate, endDate, localToday } from '@/lib/booking';
import { useNavigate }''')
edit('src/pages/customer/ReviewReservationPage.jsx','  const nav = useNavigate();','''  const nav = useNavigate();
  const { reservation, addContract } = useReservation();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const [tenant, setTenant] = useState({name:'Nguyen Van An',phone:'0908 123 456',email:'nguyen.van.an@example.com',identity:'079094002819'});
  const pricing = calculatePricing(reservation.storage?.monthlyRate, reservation.durationMonths);
  const validBooking = Boolean(reservation.storage && reservation.startDate >= localToday());
  const validTenant = Object.values(tenant).every(value => value.trim()) && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(tenant.email);
  const updateTenant = (field, value) => { setTenant(previous => ({...previous,[field]:value})); setConfirmed(false); };
  const submit = async () => {
    if (!confirmed || !validBooking || !validTenant || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setError('');
    try {
      const { data } = await reservationApi.create({ ...reservation, facilityId: reservation.facility.id, storageId: reservation.storage.id, tenant, pricing });
      if (!data?.id) throw new Error('Reservation could not be created. Please try again.');
      addContract({ ...reservation, ...data, tenant, pricing });
      nav(`/portal/reservations/${data.id}`);
    } catch (error) { setError(error.response?.data?.message || error.message || 'Unable to submit reservation. Please try again.'); }
    finally { setSubmitting(false); submittingRef.current = false; }
  };''')
edit('src/pages/customer/ReviewReservationPage.jsx','"SelfStorage Central Saigon · Unit A-203 (6 m²)"','`${reservation.facility?.name || "Not selected"} · Unit ${reservation.storage?.code || "—"} (${reservation.storage?.size || "—"} m²)`')
edit('src/pages/customer/ReviewReservationPage.jsx','"May 15, 2025 – Nov 15, 2025 · 6 Months"','`${formatDate(reservation.startDate)} – ${formatDate(endDate(reservation.startDate, reservation.durationMonths))} · ${reservation.durationMonths} Months`')
edit('src/pages/customer/ReviewReservationPage.jsx','"Estimated total due at move-in: 5,600,000 VND"','`Estimated total due at move-in: ${formatMoney(pricing.total)} VND`')
for field,value,label in [('name','Nguyen Van An','Full legal name'),('phone','0908 123 456','Phone number'),('email','nguyen.van.an@example.com','Email address'),('identity','079094002819','Identity number')]:
 edit('src/pages/customer/ReviewReservationPage.jsx',f'<Input defaultValue="{value}" />',f'<Input aria-label="{label}" value={{tenant.{field}}} onChange={{event => updateTenant("{field}", event.target.value)}} />')
edit('src/pages/customer/ReviewReservationPage.jsx','<label className="mt-4 flex gap-2 text-sm">','<label htmlFor="confirm-personal-data" className="mt-4 flex cursor-pointer gap-3 text-sm">')
edit('src/pages/customer/ReviewReservationPage.jsx','<Checkbox defaultChecked />I confirm','<Checkbox id="confirm-personal-data" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={submitting} />I confirm')
edit('src/pages/customer/ReviewReservationPage.jsx','onClick={() => nav("/portal/reservations/VS-2025-0849")}','disabled={!confirmed || !validBooking || !validTenant || submitting} onClick={submit}')
edit('src/pages/customer/ReviewReservationPage.jsx','SUBMIT RESERVATION →','{submitting ? "CREATING RESERVATION…" : "SUBMIT RESERVATION →"}')
edit('src/pages/customer/ReviewReservationPage.jsx','''            </Button>
          </CardContent>''','''            </Button>
            {!validBooking && <p className="mt-3 text-sm text-orange-700">Select a storage unit and a valid move-in date before submitting.</p>}
            {!confirmed && <p className="mt-3 text-xs text-slate-500">Confirm your personal information to enable submission.</p>}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </CardContent>''')
edit('src/pages/customer/ReservationStatusPage.jsx','import { useNavigate }','''import { useReservation } from '@/contexts/ReservationContext';
import { formatMoney, formatDate } from '@/lib/booking';
import { useNavigate, useParams }''')
edit('src/pages/customer/ReservationStatusPage.jsx','  const nav = useNavigate();','''  const nav = useNavigate();
  const { id } = useParams();
  const { contracts } = useReservation();
  const booking = contracts.find(item => item.id === id || item.reservationCode === id);
  if (!booking) return <div className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-bold">Reservation not found</h1><p className="mt-3">Create a reservation to view its status and contract.</p><Button className="mt-5" onClick={() => nav('/portal/rent')}>Choose storage</Button></div>;''')
edit('src/pages/customer/ReservationStatusPage.jsx','RESERVATION #VS-2025-0849','RESERVATION #{booking.reservationCode || booking.id}')
edit('src/pages/customer/ReservationStatusPage.jsx','<b>Nguyen Van An!</b>','<b>{booking.tenant.name}!</b>')
edit('src/pages/customer/ReservationStatusPage.jsx','SelfStorage Central Saigon','{booking.facility.name}')
edit('src/pages/customer/ReservationStatusPage.jsx','Unit A-203 (6 m²)','Unit {booking.storage.code} ({booking.storage.size} m²)')
edit('src/pages/customer/ReservationStatusPage.jsx','6 Months Tenancy','{booking.durationMonths} Months · {formatDate(booking.startDate)}')
edit('src/pages/customer/ReservationStatusPage.jsx','2,800,000 VND / month','{formatMoney(booking.pricing.monthlyRate)} VND / month')
edit('src/pages/customer/ReservationStatusPage.jsx','<Button variant="outline">VIEW RESERVATION</Button>','<Button variant="outline" onClick={() => nav("/portal/contracts")}>VIEW RESERVATION</Button>')
edit('src/pages/customer/ReservationStatusPage.jsx','onClick={() => nav("/portal/contracts/VS-2025-0849")}','onClick={() => nav(`/portal/contracts/${booking.id}`)}')
edit('src/pages/customer/ReservationStatusPage.jsx','SIMULATE APPROVAL / CONTRACT →','REVIEW CONTRACT →')
edit('src/pages/customer/ContractPage.jsx','import { useNavigate }','''import { useEffect, useState } from 'react';
import { useReservation } from '@/contexts/ReservationContext';
import contractApi from '@/api/contractApi';
import { formatMoney, formatDate } from '@/lib/booking';
import { useNavigate, useParams }''')
edit('src/pages/customer/ContractPage.jsx','  const nav = useNavigate();','''  const nav = useNavigate();
  const { reservationId } = useParams();
  const { contracts, confirmContract } = useReservation();
  const booking = contracts.find(item => item.id === reservationId || item.reservationCode === reservationId);
  const [contract, setContract] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setAccepted(false); setContract(null); setError('');
    if (booking) contractApi.getByReservation(booking.id).then(({data}) => {
      if (active) { if (!data?.id) setError('Contract is not available yet.'); else setContract(data); }
    }).catch(error => { if (active) setError(error.response?.data?.message || 'Unable to load contract. Please try again.'); });
    return () => { active = false; };
  }, [booking?.id, retry]);
  const sign = async () => {
    if (!accepted || signing || !contract || booking.contractStatus === 'SIGNED') return;
    setSigning(true); setError('');
    try {
      const {data} = await contractApi.sign(contract.id, {signedBy: booking.tenant.name});
      if (data?.status !== 'SIGNED') throw new Error('Contract confirmation has not completed. Please try again.');
      confirmContract(booking.id, data);
      nav(`/portal/payments/${booking.id}`);
    } catch (error) { setError(error.response?.data?.message || error.message || 'Unable to confirm contract.'); }
    finally { setSigning(false); }
  };
  if (!booking) return <div className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-bold">Contract not found</h1><Button className="mt-5" onClick={() => nav('/portal/contracts')}>Back to contracts</Button></div>;''')
edit('src/pages/customer/ContractPage.jsx','<b>SelfStorage Central Saigon</b>','<b>{booking.facility.name}</b>')
edit('src/pages/customer/ContractPage.jsx','Unit A-203 · Level 2','Unit {booking.storage.code} · {booking.storage.size} m²')
edit('src/pages/customer/ContractPage.jsx','6 Months Guaranteed','{booking.durationMonths} Months · {formatDate(booking.startDate)}')
edit('src/pages/customer/ContractPage.jsx','Monthly Rate 2,800,000 VND','Monthly Rate {formatMoney(booking.pricing.monthlyRate)} VND')
edit('src/pages/customer/ContractPage.jsx','Deposit 2,800,000 VND','Deposit {formatMoney(booking.pricing.deposit)} VND')
edit('src/pages/customer/ContractPage.jsx','5,600,000 VND','{formatMoney(booking.pricing.total)} VND')
edit('src/pages/customer/ContractPage.jsx','NGUYEN VAN AN','{booking.tenant.name}')
edit('src/pages/customer/ContractPage.jsx','rights for Unit A-203, situated on Level 2 of the SelfStorage\n              Central Saigon Facility.','rights for Unit {booking.storage.code} at {booking.facility.name}.')
edit('src/pages/customer/ContractPage.jsx','<label className="flex gap-3">','<label htmlFor="accept-contract" className="flex cursor-pointer gap-3">')
edit('src/pages/customer/ContractPage.jsx','<Checkbox />','<Checkbox id="accept-contract" checked={accepted} onCheckedChange={value => setAccepted(value === true)} disabled={signing || booking.contractStatus === "SIGNED"} />')
edit('src/pages/customer/ContractPage.jsx','onClick={() => nav("/portal/payments/VS-2025-0849")}','disabled={!accepted || !contract || signing || booking.contractStatus === "SIGNED"} onClick={sign}')
edit('src/pages/customer/ContractPage.jsx','ACCEPT CONTRACT & PROCEED TO PAYMENT →','{booking.contractStatus === "SIGNED" ? "CONTRACT CONFIRMED" : signing ? "CONFIRMING…" : "CONFIRM CONTRACT & PROCEED TO PAYMENT →"}')
edit('src/pages/customer/ContractPage.jsx','<div className="clear-both" />','''<div className="clear-both" />
          {!contract && !error && <p className="mt-3 text-sm text-slate-500">Loading contract…</p>}
          {error && <div className="mt-3"><p role="alert" className="text-sm text-red-700">{error}</p>{!contract && <Button variant="outline" className="mt-2" onClick={() => setRetry(value => value+1)}>Retry loading contract</Button>}</div>}''')
# Keep backend-returned terms visible instead of presenting a fabricated full contract.
edit('src/pages/customer/ContractPage.jsx','''            <div className="soft-panel mt-7''','''            {contract?.terms && <ol className="mt-6 space-y-3 text-sm text-slate-600">{contract.terms.map((term,index) => <li key={index}>{index+1}. {term}</li>)}</ol>}
            <div className="soft-panel mt-7''')
edit('src/routes/AppRoutes.jsx','import Placeholder',"import ContractsPage from '@/pages/customer/ContractsPage';\nimport Placeholder")
edit('src/routes/AppRoutes.jsx','element={<Placeholder title="Contracts & Sign" />}','element={<ContractsPage />}')
