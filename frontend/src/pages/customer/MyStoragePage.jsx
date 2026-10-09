import {RentalsIntegration} from '@/components/customer/RentalLifecycleIntegration';
import { useNavigate } from 'react-router-dom';
import CustomerRentalTools from '@/components/common/CustomerRentalTools';
import referenceImages from '@/components/common/referenceImages';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Headphones, PlusCircle } from "lucide-react";
function MyStoragePage() {
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8">
      <Portal />
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">Active Rentals</h2>
        <span className="text-sm">Showing 1 of 1 Unit</span>
      </div>
      <Card className="mt-5">
        <CardContent className="grid gap-6 md:grid-cols-[300px_1fr]">
          <div className="h-64 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-100 to-orange-50 grid place-items-center">
            <img src={referenceImages.vaultspace_my_storage[1]} alt="Your storage unit corridor" className="storage-photo" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          </div>
          <div>
            <div className="flex justify-between">
              <h2 className="text-2xl font-bold">
                Unit A-203 · Mini Storage 3 m²
              </h2>
              <Badge variant="green">ACTIVE</Badge>
            </div>
            <p className="mt-2 text-slate-600">
              📍 SelfStorage Central Saigon (128 Nguyen Thi Minh Khai, District
              1)
            </p>
            <div className="soft-panel mt-5 grid gap-4 p-5 md:grid-cols-2">
              <div>
                Rental Period
                <br />
                <b>May 15, 2025 – Nov 15, 2025</b>
              </div>
              <div>
                Duration Status
                <br />
                <b className="text-orange-600">14 days remaining</b>
              </div>
              <div>
                Monthly Rate
                <br />
                <b className="price text-2xl">1,350,000 VND/mo</b>
              </div>
              <div>
                Facility Hours
                <br />
                <b>24/7 Unlimited Access</b>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="orange" onClick={()=>nav("/portal/rentals/RNT-SELF-001/access")}>MANAGE STORAGE</Button>
              <Button variant="ghost" onClick={()=>nav("/portal/rentals/RNT-SELF-001/extend")}>Extend Rental →</Button>
              <Button variant="ghost" onClick={()=>nav("/portal/payments")}>View Contract & Invoices</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <h2 className="mt-8 text-2xl font-bold">Quick Services & Tools</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        {[
          [PlusCircle, "Book Another Space"],
          [KeyRound, "Digital Access & Gate PIN"],
          [Headphones, "Need Assistance?"],
        ].map(([I, t]) => (
          <SpotlightCard key={t} className="rounded-2xl"><Card className="h-full">
            <CardContent>
              <I className="text-sky-700" />
              <h3 className="mt-4 text-xl font-bold">{t}</h3>
              <p className="mt-2 text-slate-600">
                Manage this service directly from your SelfStorage portal.
              </p>
            </CardContent>
          </Card></SpotlightCard>
        ))}
      </div>
      <CustomerRentalTools/>
    </div>
  );
}
function Portal() {
  const nav = useNavigate();
  return (
    <>
      <div className="hero-grad rounded-2xl p-8 text-white">
        <span className="label text-blue-100">SelfStorage PORTAL</span>
        <h1 className="mt-2 text-5xl font-bold">My Storage</h1>
        <p className="mt-2 text-blue-100">
          Manage your active rentals, access codes and renewals in one place.
        </p>
      </div>
      <div className="mt-5 flex items-center justify-between rounded-2xl bg-orange-500 p-5 text-white">
        <div>
          <b>ACTION REQUIRED</b>
          <div className="text-xl font-bold">
            Your rental for Unit A-203 ends in 14 days.
          </div>
        </div>
        <Button onClick={()=>nav("/portal/rentals/RNT-SELF-001/extend")} variant="outline" className="border-0 bg-[#173d28] text-white hover:bg-[#0e4f2b]">EXTEND RENTAL NOW →</Button>
      </div>
    </>
  );
}




// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default RentalsIntegration;
