import { Link } from "react-router-dom";
import { ArrowRight, Clock3, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";

const facilities = [
  {
    district: "DISTRICT 1",
    title: "Central Urban Vault",
    address: "128 Nguyen Thi Minh Khai, District 1",
    available: "8 units available",
  },
  {
    district: "DISTRICT 7",
    title: "Phu My Hung Logistics Annex",
    address: "45 Nguyen Van Linh, District 7",
    available: "5 units available",
  },
  {
    district: "THU DUC CITY",
    title: "SelfStorage East Hub",
    address: "88 Vo Van Ngan, Thu Duc City",
    available: "12 units available",
  },
];

export default function FacilitiesSection() {
  return (
    <section className="border-y border-[#e7eaf4] bg-[#F5F7F2] py-20">
      <div className="page-container">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label justify-center">Our Network</p>

          <h2 className="section-title mt-3">
            Facilities across Ho Chi Minh City.
          </h2>

          <p className="section-description mx-auto mt-4 max-w-2xl">
            Choose the SelfStorage location that works best for your home,
            office or moving route.
          </p>
        </div>

        <div className="mt-11 grid gap-5 lg:grid-cols-3">
          {facilities.map((facility) => (
            <article
              key={facility.title}
              className="overflow-hidden rounded-2xl border border-[#e2e6f0] bg-white"
            >
              <div className="h-1.5 bg-[#176B3A]" />

              <div className="p-6">
                <span className="text-[10px] font-bold tracking-[0.13em] text-[#176B3A]">
                  {facility.district}
                </span>

                <h3 className="mt-2 font-heading text-xl font-semibold">
                  {facility.title}
                </h3>

                <div className="mt-5 flex gap-2 text-sm text-[#697386]">
                  <MapPin size={16} className="shrink-0 text-[#176B3A]" />
                  {facility.address}
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {facility.available}
                </div>

                <div className="mt-6 flex items-center justify-between border-t pt-5">
                  <span className="flex items-center gap-2 text-xs text-[#697386]">
                    <Clock3 size={14} />
                    24/7 access
                  </span>

                  <Button asChild size="sm">
                    <Link to="/facilities">
                      View Units
                      <ArrowRight size={14} className="ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
