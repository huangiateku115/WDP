import { useState, useRef } from 'react';
import { useReservation } from '@/contexts/ReservationContext';
import reservationApi from '@/api/reservationApi';
import { calculatePricing, formatMoney, formatDate, endDate, localToday } from '@/lib/booking';
import { useNavigate } from "react-router-dom";
import Steps from "@/components/common/Steps";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
export default function ReviewReservationPage() {
  const nav = useNavigate();
  const { reservation, addContract } = useReservation();
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const [tenant, setTenant] = useState({name:'Nguyen Van An',phone:'0908 123 456',email:'nguyen.van.an@example.com',identity:'079094002819'});
  const pricing = calculatePricing(reservation.storage?.monthlyRate, reservation.durationMonths);
  const validBooking = Boolean(reservation.storage && reservation.startDate >= localToday());
  const validTenant = Object.values(tenant).every(value => value.trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tenant.email);
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
  };
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <Steps current={3} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <span className="label text-sky-700">STEP 3 OF 4</span>
          <h1 className="mt-2 text-4xl font-bold">Review your reservation</h1>
          <div className="soft-panel mt-5 p-5">
            <b>No payment is required right now</b>
            <p className="text-sm text-slate-600">
              Payment and security deposit will only be requested after your
              digital contract verification is complete.
            </p>
          </div>
          {[
            [
              "STORAGE DETAILS",
              `${reservation.facility?.name || "Not selected"} · Unit ${reservation.storage?.code || "—"} (${reservation.storage?.size || "—"} m²)`,
            ],
            ["RENTAL PERIOD", `${formatDate(reservation.startDate)} – ${formatDate(endDate(reservation.startDate, reservation.durationMonths))} · ${reservation.durationMonths} Months`],
            [
              "PRICING & DEPOSIT BREAKDOWN",
              `Estimated total due at move-in: ${formatMoney(pricing.total)} VND`,
            ],
          ].map((x) => (
            <Card key={x[0]} className="mt-5">
              <CardContent>
                <span className="label text-sky-700">{x[0]}</span>
                <h3 className="mt-3 text-xl font-bold">{x[1]}</h3>
              </CardContent>
            </Card>
          ))}
          <Card className="mt-5">
            <CardContent>
              <h3 className="font-bold">
                TENANT INFORMATION (FOR LEASE AGREEMENT)
              </h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Input aria-label="Full legal name" value={tenant.name} onChange={event => updateTenant("name", event.target.value)} />
                <Input aria-label="Phone number" value={tenant.phone} onChange={event => updateTenant("phone", event.target.value)} />
                <Input aria-label="Email address" value={tenant.email} onChange={event => updateTenant("email", event.target.value)} />
                <Input aria-label="Identity number" value={tenant.identity} onChange={event => updateTenant("identity", event.target.value)} />
              </div>
              <label htmlFor="confirm-personal-data" className="mt-4 flex cursor-pointer gap-3 text-sm">
                <Checkbox id="confirm-personal-data" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={submitting} />I confirm that all provided personal
                data is accurate.
              </label>
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardContent>
            <h2 className="text-xl font-bold">WHAT HAPPENS NEXT?</h2>
            <ol className="mt-5 space-y-4 text-sm">
              <li>
                <b>1 Review by Facility Team</b>
                <br />
                Usually within 2 business hours.
              </li>
              <li>
                <b>2 Unit Allocation</b>
                <br />A designated locker is provisioned.
              </li>
              <li>
                <b>3 Digital Lease Contract</b>
                <br />
                Sent through your portal.
              </li>
              <li>
                <b>4 Accept & Complete Move-in</b>
              </li>
            </ol>
            <Button
              className="mt-6 w-full"
              disabled={!confirmed || !validBooking || !validTenant || submitting} onClick={submit}
            >
              {submitting ? "CREATING RESERVATION…" : "SUBMIT RESERVATION →"}
            </Button>
            {!validBooking && <p className="mt-3 text-sm text-orange-700">Select a storage unit and a valid move-in date before submitting.</p>}
            {!confirmed && <p className="mt-3 text-xs text-slate-500">Confirm your personal information to enable submission.</p>}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
