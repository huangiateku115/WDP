import {ReservationDetailIntegration} from '@/components/customer/RentalLifecycleIntegration';
import { useReservation } from '@/contexts/ReservationContext';
import { formatMoney, formatDate } from '@/lib/booking';
import { useNavigate, useParams } from "react-router-dom";
import Steps from "@/components/common/Steps";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
function ReservationStatusPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const { contracts } = useReservation();
  const booking = contracts.find(item => item.id === id || item.reservationCode === id);
  if (!booking) return <div className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-bold">Reservation not found</h1><p className="mt-3">Create a reservation to view its status and contract.</p><Button className="mt-5" onClick={() => nav('/portal/rent')}>Choose storage</Button></div>;
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <Steps current={4} />
      <div className="py-10 text-center">
        <Badge variant="sky">RESERVATION #{booking.reservationCode || booking.id}</Badge>
        <h1 className="mt-3 text-4xl font-bold">Reservation received!</h1>
        <p className="mt-2 text-slate-600">
          Thank you, <b>{booking.tenant.name}!</b> Your reservation for{" "}
          <b>{booking.facility.name}</b> has been registered.
        </p>
      </div>
      <Card>
        <CardContent>
          <div className="flex justify-between">
            <b>STATUS TRACKER & NEXT STEPS</b>
            <span className="text-sm text-slate-500">
              Estimated Approval: within 30 mins
            </span>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center md:grid-cols-6">
            {[
              "Submitted",
              "Facility Review",
              "Unit Assign",
              "Sign Contract",
              "Payment",
              "Move-in",
            ].map((x, i) => (
              <div
                key={x}
                className={i < 2 ? "text-sky-700" : "text-slate-400"}
              >
                <div
                  className={`mx-auto mb-2 h-8 w-8 rounded-full ${i < 2 ? "bg-sky-700" : "bg-slate-100"} text-white grid place-items-center`}
                >
                  {i === 0 ? "✓" : i + 1}
                </div>
                <b className="text-xs">{x}</b>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
        <Card>
          <CardContent>
            <span className="label text-sky-700">BOOKING SUMMARY</span>
            <h2 className="mt-3 text-2xl font-bold">
              {booking.facility.name}
            </h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                Reserved Space Unit
                <br />
                <b>Unit {booking.storage.code} ({booking.storage.size} m²)</b>
              </div>
              <div>
                Duration & Schedule
                <br />
                <b>{booking.durationMonths} Months · {formatDate(booking.startDate)}</b>
              </div>
              <div className="soft-panel p-4 md:col-span-2">
                <small>MONTHLY RENTAL & DEPOSIT</small>
                <div className="price text-3xl">{formatMoney(booking.pricing.monthlyRate)} VND / month</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h3 className="font-bold">FACILITY ACCESS</h3>
            <div className="mt-4 aspect-video rounded-xl bg-blue-50 grid place-items-center">
              Smart Lock Auto-Assignment
            </div>
            <p className="mt-4 text-sm">
              ✓ 24/7 CCTV & PIN Keypad
              <br />✓ Free Loading Bay Access
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="mt-7 flex justify-center gap-4">
        <Button variant="outline" onClick={() => nav("/portal/contracts")}>VIEW RESERVATION</Button>
        <Button onClick={() => nav(`/portal/contracts/${booking.id}`)}>
          REVIEW CONTRACT →
        </Button>
      </div>
    </div>
  );
}

// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default ReservationDetailIntegration;
