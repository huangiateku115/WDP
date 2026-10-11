import {recordId} from '@/components/customer/RentalBackendUI';
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, MapPin, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import FadeContent from "@/components/reactbits/FadeContent";
import ShinyText from "@/components/reactbits/ShinyText";
import Magnet from "@/components/reactbits/Magnet";

export default function HeroSection({facilities,selected,onSelect}) {
  const benefits = [
    "Flexible monthly rental",
    "24/7 monitored facilities",
    "Personal & business storage",
  ];

  return (
    <section className="relative overflow-hidden bg-[#F3F6F0]">
      <div className="page-container grid min-h-[650px] items-center gap-10 py-12 lg:grid-cols-[.92fr_1.08fr] lg:py-16">
        {/* LEFT CONTENT */}
        <FadeContent className="relative z-10" duration={850}>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#EAF5EE] px-4 py-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#176B3A]">
            <ShieldCheck size={14} />
            Safe • Flexible • Easy access
          </div>

          <h1 className="mt-6 max-w-xl font-heading text-[44px] font-extrabold leading-[1.03] tracking-[-.055em] text-[#173D28] md:text-[62px]">
            More space.
            <br />
            <ShinyText className="text-[#F28C28]">Less clutter.</ShinyText>
            <br />
            Life made easier.
          </h1>

          <p className="mt-5 max-w-lg text-base leading-7 text-[#657067]">
            Secure self-storage for your home or business in Ho Chi Minh City.
            Choose your size, reserve online and move in when you're ready.
          </p>

          <label className="mt-5 block text-sm font-semibold">Choose a facility<select className="customer-select mt-2" aria-label="Home facility" value={selected} onChange={e=>onSelect(e.target.value)} disabled={facilities.loading||!!facilities.error}><option value="">Browse all facilities</option>{facilities.data?.map(f=><option key={recordId(f)} value={recordId(f)}>{f.name}</option>)}</select></label>
          {/* CTA */}
          <div className="mt-7 flex flex-wrap gap-3">
            <Magnet>
              <Button
                asChild
                size="lg"
                className="h-12 bg-[#F28C28] px-6 font-bold hover:bg-[#D96F12]"
              >
                <Link to={selected?`/facilities/${selected}`:"/facilities"}>
                  Find a storage
                  <ArrowRight size={16} className="ml-2" />
                </Link>
              </Button>
            </Magnet>

            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 border-[#176B3A] bg-white px-6 font-bold text-[#176B3A] hover:bg-[#EAF5EE]"
            >
              <Link to="/pricing">View prices</Link>
            </Button>
          </div>

          {/* BENEFITS */}
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#4D5B50]">
            {benefits.map((benefit) => (
              <span key={benefit} className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[#176B3A]" />

                {benefit}
              </span>
            ))}
          </div>
        </FadeContent>

        {/* RIGHT IMAGE */}
        <FadeContent className="relative" delay={140} duration={900}>
          <div className="overflow-hidden rounded-[28px] shadow-[0_24px_70px_rgba(23,61,40,.18)]">
            <img
              src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1400&q=85"
              alt="Self storage warehouse"
              className="rb-image-hover h-[470px] w-full object-cover md:h-[550px]"
            />
          </div>

          {/* LOCATION CARD */}
          <div className="absolute -bottom-5 left-5 right-5 rounded-2xl bg-white p-4 shadow-xl md:left-[-45px] md:right-auto md:w-[330px]">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
                <MapPin size={20} />
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#899188]">
                  Storage near you
                </p>

                <p className="mt-1 text-sm font-bold text-[#1F2A22]">
                  Browse active facilities
                </p>
              </div>

              <Link
                to="/facilities"
                aria-label="View storage facilities"
                className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F28C28] text-white transition hover:bg-[#D96F12]"
              >
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </FadeContent>
      </div>
    </section>
  );
}
