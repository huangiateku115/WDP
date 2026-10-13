import {ReservationDetailIntegration} from '@/components/customer/RentalLifecycleIntegration';
import { useParams } from 'react-router-dom';
import { useReservation } from '@/contexts/ReservationContext';
import Steps from '@/components/common/Steps';
import PortalHero from "@/components/common/PortalHero";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
function HandoverPreview() {
  const { reservationId } = useParams();
  const { contracts } = useReservation();
  const booking = contracts.find(item => item.id === reservationId);
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8"><Steps current={3} labels={["Review Contract", "Payment", "Check-in"]} />
      <div className="label mb-3 text-sky-700">
        STEP 3 OF 3: ON-SITE HANDOVER & CHECK-IN PROTOCOL
      </div>
      <PortalHero
        eyebrow="PHYSICAL FACILITY ARRIVAL PROTOCOL"
        title="Ready to move in."
        desc="Contract accepted and payment settled. Please visit SelfStorage Central Saigon during operating hours to complete staff verification, unit walkthrough, and keycard activation."
        right={
          <>
            <b>WAITING FOR ARRIVAL</b>
            <br />
            06:00 – 22:00 Daily
          </>
        }
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardContent>
              <h2 className="text-xl font-bold">
                Facility Pass & Customer Identification
              </h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="soft-panel p-4">
                  ASSIGNED UNIT
                  <br />
                  <b className="text-2xl">Unit {booking?.storage.code || "A-203"}</b>
                </div>
                <div className="soft-panel p-4">
                  REGISTERED CUSTOMER
                  <br />
                  <b className="text-xl">{booking?.tenant.name || "Nguyen Van An"}</b>
                </div>
                <div className="soft-panel p-4 md:col-span-2">
                  FACILITY LOCATION
                  <br />
                  <b>SelfStorage Central Saigon</b>
                </div>
                <div className="rounded-xl bg-blue-100 p-5 md:col-span-2">
                  <small>CHECK-IN IDENTIFIER</small>
                  <div className="price text-3xl">{booking?.reservationCode || reservationId}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <h2 className="text-xl font-bold">
                Arrival Instructions & What to Do
              </h2>
              <div className="mt-5 space-y-3">
                {[
                  "Provide Reservation ID",
                  "Identity Verification",
                  "Joint Unit Inspection",
                  "Smart Credentials Handover",
                  "Handover Sign-off",
                ].map((x, i) => (
                  <div
                    key={x}
                    className="flex gap-4 rounded-xl bg-slate-50 p-4"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-700 font-bold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <b>{x}</b>
                      <p className="text-sm text-slate-500">
                        Complete this step with the on-site facility concierge.
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardContent>
              <div className="flex justify-between">
                <h2 className="text-xl font-bold">Handover Status Checklist</h2>
                <Badge>4 OF 7 COMPLETED</Badge>
              </div>
              <div className="mt-5 space-y-3">
                {[
                  "Reservation Approved",
                  "Unit Assigned: Unit A-203",
                  "Contract Accepted",
                  "Payment Complete",
                  "Facility Check-in",
                  "Unit Inspection",
                  "Handover Confirmation",
                ].map((x, i) => (
                  <div
                    key={x}
                    className={`rounded-xl p-4 text-sm ${i < 4 ? "bg-emerald-50" : i === 4 ? "bg-orange-50" : "bg-slate-50"}`}
                  >
                    {i < 4 ? "✓ " : i === 4 ? "◷ " : "○ "}
                    <b>{x}</b>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <h3 className="font-bold">Facility Concierge & Loading Bay</h3>
              <p className="mt-3">
                <b>Tran Minh Hoang</b>
                <br />
                Ground Floor Concierge Desk
              </p>
              <Button className="mt-5 w-full">
                VIEW ARRIVAL GUIDE & DIRECTIONS →
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


export default ReservationDetailIntegration;
