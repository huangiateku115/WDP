import { useReservation } from '@/contexts/ReservationContext';
import { calculatePricing, defaultStorage, defaultFacility } from '@/lib/booking';
import referenceImages from '@/components/common/referenceImages';
import { useNavigate } from "react-router-dom";
import Steps from "@/components/common/Steps";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Truck } from "lucide-react";
const units = [
  [
    "Mini Storage — 3 m² (approx. 9 m³)",
    "1,500,000",
    "3 spaces available",
    "SELECTED",
  ],
  [
    "Mini Storage — 6 m² (approx. 18 m³)",
    "2,800,000",
    "2 spaces available",
    "POPULAR",
  ],
  [
    "Mini Storage — 9 m² (approx. 27 m³)",
    "3,900,000",
    "Only 1 space left",
    "LARGE CAPACITY",
  ],
];
export default function SelectStoragePage() {
  const nav = useNavigate();
  const { reservation, updateReservation } = useReservation();
  const selected = reservation.storage || defaultStorage;
  const selectUnit = (index) => {
    const size = [3, 6, 9][index];
    const storage = { id: ['LOCKER-A101','LOCKER-A203','MINI-9'][index], code: ['A-101','A-203','A-309'][index], name: 'Mini Storage', size, monthlyRate: Number(units[index][1].replaceAll(',', '')) };
    updateReservation({ facility: defaultFacility, serviceType: 'LOCKER', storage, pricing: calculatePricing(storage.monthlyRate, reservation.durationMonths) });
    nav('/portal/rent/period');
  };
  const continueBooking = () => {
    updateReservation({ facility: reservation.facility || defaultFacility, serviceType: 'LOCKER', storage: selected, pricing: calculatePricing(selected.monthlyRate, reservation.durationMonths) });
    nav('/portal/rent/period');
  };
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <Steps current={1} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_310px]">
        <div>
          <span className="label text-sky-700">STEP 1 OF 4</span>
          <h1 className="mt-2 text-4xl font-bold">Choose your storage</h1>
          <Card className="mt-5 p-4">
            📍 Selected Facility: <b>SelfStorage Central Saigon (District 1)</b>
          </Card>
          <div className="mt-4 flex flex-wrap gap-2 rounded-xl border bg-[#eaf5ee] p-2">
            <Button variant="secondary">Mini Storage</Button>
            <Button variant="outline">Smart Lockers</Button>
          </div>
          <div className="mt-5 space-y-4">
            {units.map((u, i) => (
              <Card
                key={u[0]}
                className={selected.size === [3,6,9][i] ? "border-l-4 border-l-sky-700" : ""}
              >
                <CardContent className="grid gap-5 md:grid-cols-[120px_1fr_auto]">
                  <div className="grid h-28 overflow-hidden place-items-center rounded-xl bg-blue-50">
                    <img src={referenceImages.vaultspace_reservation_step_1[i]} alt={`Storage space ${u[0]}`} className="storage-photo" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                  </div>
                  <div>
                    <div className="flex gap-2">
                      <h3 className="text-xl font-bold">{u[0]}</h3>
                      <Badge variant={i === 2 ? "orange" : "blue"}>
                        {selected.size === [3,6,9][i] ? "SELECTED" : i === 0 ? "AVAILABLE" : u[3]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      Ideal for boxes, luggage, furniture and household items.
                    </p>
                    <div className="mt-4 text-sm text-slate-600">
                      ▣ PIN Keypad + Smart App · Ground floor access
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="price text-2xl">
                      {u[1]} <small>VND</small>
                    </div>
                    <div
                      className={`mt-1 text-sm font-bold ${i === 2 ? "text-orange-600" : "text-emerald-600"}`}
                    >
                      {u[2]}
                    </div>
                    <Button
                      className="mt-4"
                      variant={selected.size === [3,6,9][i] ? "default" : "secondary"}
                      onClick={() => selectUnit(i)}
                    >
                      {selected.size === [3,6,9][i] ? "Selected" : "Select Unit"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>          <div className="soft-panel mt-5 p-5">
            <h2 className="text-lg font-bold">Included with every storage unit</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="storage-feature"><ShieldCheck size={20}/><div><b>Secure Access</b><p>PIN keypad and facility surveillance.</p></div></div>
              <div className="storage-feature"><Truck size={20}/><div><b>Easy Move-in</b><p>Loading bay and ground floor access.</p></div></div>
            </div>
          </div>
        </div>
        <Card className="h-fit lg:sticky lg:top-20">
          <CardContent>
            <h2 className="text-xl font-bold">YOUR RESERVATION</h2><p className="mt-2 text-sm text-slate-500">Instant confirmation &amp; price lock guarantee</p>
            <div className="mt-5 space-y-3 text-sm">
              <p>
                Facility: <b>SelfStorage Central Saigon</b>
              </p>
              <p>
                Storage Type: <b>Mini Storage</b>
              </p>
              <p>
                Selected Unit Size: <b>{selected.size} m²</b>
              </p>
            </div>
            <div className="my-5 border-t" />
            <div className="price text-3xl">
              {selected.monthlyRate.toLocaleString("en-US")} <small>VND</small>
            </div>
            <Button
              className="mt-5 w-full"
              onClick={continueBooking}
            >
              CONTINUE TO RENTAL PERIOD →
            </Button><div className="reservation-trust"><span>✓ Instant lock</span><span>✓ Transparent pricing</span><span>✓ Secure facility</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


