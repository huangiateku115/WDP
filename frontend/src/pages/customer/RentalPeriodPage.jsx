import {RentalPeriodIntegration} from '@/components/customer/RentalBookingIntegration';
import { useReservation } from '@/contexts/ReservationContext';
import { Input } from '@/components/ui/input';
import { calculatePricing, durationOptions, localToday, formatMoney, defaultStorage, defaultFacility } from '@/lib/booking';
import { useNavigate } from "react-router-dom";
import Steps from "@/components/common/Steps";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
const plans = [
  ["1 MONTH", "1,500,000", "Flexible"],
  ["3 MONTHS", "1,425,000", "Save 5%"],
  ["6 MONTHS", "1,350,000", "Recommended"],
  ["12 MONTHS", "1,275,000", "Best Value"],
];
function RentalPeriodPage() {
  const nav = useNavigate();
  const { reservation, updateReservation } = useReservation();
  const storage = reservation.storage || defaultStorage;
  const months = reservation.durationMonths || 1;
  const pricing = calculatePricing(storage.monthlyRate, months);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(reservation.startDate) && reservation.startDate >= localToday();
  const continueBooking = () => {
    if (!validDate) return;
    updateReservation({ storage, facility: reservation.facility || defaultFacility, serviceType: reservation.serviceType || 'LOCKER', pricing });
    nav('/portal/rent/review');
  };
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <Steps current={2} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <span className="label text-sky-700">STEP 2 OF 4</span>
          <h1 className="mt-2 text-4xl font-bold">Choose your rental period</h1>
          <p className="mt-2 text-slate-600">
            Longer commitments unlock instant recurring savings and price
            protection.
          </p>
          <Card className="mt-6">
            <CardContent>
              <b>RESERVED UNIT</b>
              <div className="mt-2 text-xl font-bold">
                {storage.name} {storage.size} m²
              </div>
              <p className="text-slate-500">
                SelfStorage Central Saigon
              </p>
            </CardContent>
          </Card>
          <Card className="mt-5">
            <CardContent>
              <h3 className="text-xl font-bold">Move-in Start Date</h3>
              <label htmlFor="move-in-date" className="field-label mt-4">Choose your move-in date</label>
              <Input id="move-in-date" type="date" min={localToday()} value={reservation.startDate} onChange={event => updateReservation({startDate: event.target.value})} />
              <p className="mt-2 text-xs text-slate-500">Select today or a future date to continue.</p>
            </CardContent>
          </Card>
          <h2 className="mt-7 text-xl font-bold">Select Commitment Duration</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {plans.map((p, i) => (
              <Card key={p[0]} className={months === durationOptions[i] ? "ring-2 ring-sky-700" : ""}>
                <button type="button" className="duration-choice w-full text-left" aria-pressed={months === durationOptions[i]} onClick={() => updateReservation({durationMonths:durationOptions[i]})}>
                <CardContent>
                  <div className="flex justify-between">
                    <h3 className="text-2xl font-bold">{p[0]}</h3>
                    <Badge variant={i === 2 ? "blue" : "sky"}>{p[2]}</Badge>
                  </div>
                  <div className="mt-8 price text-3xl">
                    {formatMoney(calculatePricing(storage.monthlyRate, durationOptions[i]).monthlyRate)} <small>VND / mo</small>
                  </div>
                  <p className="mt-3 text-sm text-slate-500">
                    Flexible lease with transparent monthly pricing.
                  </p>
                </CardContent>
                </button>
              </Card>
            ))}
          </div>
        </div>
        <Card className="h-fit">
          <CardContent>
            <span className="label text-sky-700">ESTIMATED FIRST PAYMENT</span>
            <div className="mt-2 price text-3xl">{formatMoney(pricing.total)} VND</div>
            <div className="my-5 border-t" />
            <div className="space-y-3 text-sm">
              <p>
                Monthly Base Rate <b className="float-right">{formatMoney(pricing.baseRate)}</b>
              </p>
              <p>
                Rental Subtotal <b className="float-right">{formatMoney(pricing.baseRate * months)}</b>
              </p>
              <p className="text-sky-700">
                Duration Discount <b className="float-right">-{formatMoney(pricing.discount)}</b>
              </p>
              <p>
                Security Deposit <b className="float-right">{formatMoney(pricing.baseRate)}</b>
              </p>
            </div>
            <Button
              className="mt-6 w-full"
              disabled={!validDate} onClick={continueBooking}
            >
              CONTINUE TO REVIEW →
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default RentalPeriodIntegration;
