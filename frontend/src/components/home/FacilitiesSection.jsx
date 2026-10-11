import {LoadState,recordId,addressText} from '@/components/customer/RentalBackendUI';
import { Link } from "react-router-dom";
import { ArrowRight, Clock3, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function FacilitiesSection({resource}) {
  const facilities=resource.data||[];
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
          <LoadState resource={resource}/>{resource.data?.length===0&&<p>No active facilities available.</p>}{facilities.map((facility) => (
            <article
              key={recordId(facility)}
              className="overflow-hidden rounded-2xl border border-[#e2e6f0] bg-white"
            >
              <div className="h-1.5 bg-[#176B3A]" />

              <div className="p-6">
                <span className="text-[10px] font-bold tracking-[0.13em] text-[#176B3A]">
                  {facility.address?.city}
                </span>

                <h3 className="mt-2 font-heading text-xl font-semibold">
                  {facility.name}
                </h3>

                <div className="mt-5 flex gap-2 text-sm text-[#697386]">
                  <MapPin size={16} className="shrink-0 text-[#176B3A]" />
                  {addressText(facility.address)}
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {facility.serviceTypes?.join(' · ')}
                </div>

                <div className="mt-6 flex items-center justify-between border-t pt-5">
                  <span className="flex items-center gap-2 text-xs text-[#697386]">
                    <Clock3 size={14} />
                    Facility information
                  </span>

                  <Button asChild size="sm" className="bg-[#176B3A] hover:bg-[#125830]">
                    <Link to={`/facilities/${recordId(facility)}`}>
                      View Facility
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
