import {PaymentIntegration} from '@/components/customer/RentalLifecycleIntegration';
import Steps from '@/components/common/Steps';
import { useReservation } from "@/contexts/ReservationContext";
import { formatMoney } from "@/lib/booking";
import { useNavigate, useParams } from "react-router-dom";
import PortalHero from "@/components/common/PortalHero";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QrCode, CreditCard, Landmark } from "lucide-react";
function PaymentPage() {
  const nav = useNavigate();
  const { reservationId } = useParams();
  const { contracts } = useReservation();
  const booking = contracts.find(item => item.id === reservationId);
  const total = booking?.pricing.total ?? 5600000;
  const monthlyRate = booking?.pricing.monthlyRate ?? 2800000;
  const deposit = booking?.pricing.deposit ?? 2800000;
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8"><Steps current={2} labels={["Review Contract", "Payment", "Check-in"]} />
      <div className="label mb-3 text-sky-700">
        STEP 2 OF 3: INITIAL RENTAL PAYMENT (PAYOS)
      </div>
      <PortalHero
        eyebrow="SECURE CHECKOUT & INITIAL SETTLEMENT"
        title="Complete your payment"
        desc="Pay the initial rental amount to immediately confirm your unit reservation and generate check-in access credentials."
        right={
          <>
            <small>Total Payable</small>
            <div className="price text-2xl text-orange-300">{formatMoney(total)} VND</div>
          </>
        }
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold">Summary of Lease & Invoicing</h2>
            <div className="mt-5 soft-panel p-4">
              ASSIGNED UNIT
              <br />
              <b>Unit {booking?.storage.code || "A-203"}</b>
            </div>
            <div className="mt-4 soft-panel p-4">
              FACILITY LOCATION
              <br />
              <b>{booking?.facility.name || "SelfStorage Central Saigon"}</b>
            </div>
            <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-700">
              <b>Contract Status: Signed Electronically</b>
            </div>
            <h3 className="mt-6 font-bold">PAYMENT BREAKDOWN</h3>
            <div className="mt-3 space-y-3 text-sm">
              <p>
                Rental Subtotal <b className="float-right">{formatMoney(booking?.pricing.subtotal ?? monthlyRate)} VND</b>
              </p>
              <p>
                Refundable Security Deposit{" "}
                <b className="float-right">{formatMoney(deposit)} VND</b>
              </p>
            </div>
            <div className="mt-5 rounded-xl bg-sky-700 p-5 text-white">
              <small>TOTAL PAYABLE</small>
              <div className="price text-3xl text-orange-300">
                {formatMoney(total)} VND
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">PayOS Instant Checkout</h2>
              <Badge variant="green">GATEWAY ONLINE</Badge>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <Button variant="secondary">
                <QrCode />
                VietQR Bank
              </Button>
              <Button variant="outline">
                <Landmark />
                Domestic ATM
              </Button>
              <Button variant="outline">
                <CreditCard />
                Visa / Master
              </Button>
            </div>
            <div className="mt-5 grid gap-5 rounded-2xl bg-blue-50 p-5 md:grid-cols-[200px_1fr]">
              <div className="grid aspect-square place-items-center rounded-xl bg-white">
                <QrCode size={130} />
              </div>
              <div className="space-y-3 text-sm">
                <p>
                  Bank Name <b className="float-right">VietinBank (CTG)</b>
                </p>
                <p>
                  Beneficiary{" "}
                  <b className="float-right">SelfStorage VIETNAM CO LTD</b>
                </p>
                <p>
                  Transfer Memo{" "}
                  <b className="float-right text-sky-700">{booking?.reservationCode || reservationId}</b>
                </p>
                <p>
                  Amount to Pay{" "}
                  <b className="float-right text-xl text-orange-600">
                    {formatMoney(total)} VND
                  </b>
                </p>
              </div>
            </div>
            <Button
              size="lg"
              className="mt-6 w-full"
              onClick={() => nav(`/portal/handover/${reservationId}`)}
            >
              ⚡ PAY WITH PAYOS ({formatMoney(total)} VND) →
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default PaymentIntegration;
