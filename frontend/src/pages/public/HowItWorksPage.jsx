import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Check,
  FileCheck2,
  KeyRound,
  MoveRight,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const steps = [
  {
    number: "01",
    icon: Building2,
    title: "Select Your Space Online with 3D Spatial Clarity",
    text: "Browse live unit availability by location and size. Compare spaces and reserve the exact unit you need.",
  },
  {
    number: "02",
    icon: FileCheck2,
    title: "Instant Digital Verification & Paperless E-Lease",
    text: "Complete renter information, verify your details and review your digital storage agreement online.",
  },
  {
    number: "03",
    icon: Smartphone,
    title: "Instant Smartphone Key & Automated Gate Pass",
    text: "After confirmation, your account receives secure digital facility and unit access without traditional physical keys.",
  },
  {
    number: "04",
    icon: MoveRight,
    title: "Move In Seamlessly On Your Own Schedule",
    text: "Arrive when it suits you and access your SelfStorage using the credentials provided to your account.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-[#FAFAF7]">
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0E4F2B] via-[#2F855A] to-[#F28C28] py-20 text-white">
        <div className="blueprint-dark absolute inset-0 opacity-30" />

        <div className="page-container relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-[#F6A94F]" />

            <span className="text-[10px] font-bold uppercase tracking-[0.15em]">
              Urban Storage Simplified
            </span>
          </div>

          <div className="mt-6 grid items-center gap-10 lg:grid-cols-[1.5fr_.7fr]">
            <div>
              <h1 className="max-w-4xl font-heading text-4xl font-semibold leading-[1.08] tracking-[-0.05em] md:text-5xl">
                How SelfStorage Works — From Booking to Move-In in Minutes
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-7 text-blue-100">
                Simple, digital, and flexible. Reserve online, complete your
                agreement, receive secure access and move in on your schedule.
              </p>

              <div className="mt-7 flex flex-wrap gap-2">
                {[
                  "Choose Space & Reserve",
                  "Digital Verification",
                  "Instant Smart Access",
                  "Move-In Anytime",
                ].map((item, index) => (
                  <a
                    key={item}
                    href={`#step-${index + 1}`}
                    className={`rounded-full px-4 py-2 text-xs font-semibold ${
                      index === 0
                        ? "bg-white text-[#176B3A]"
                        : "bg-white/15 text-white"
                    }`}
                  >
                    <span className="mr-2">{index + 1}</span>
                    {item}
                  </a>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 text-[#172033] shadow-2xl">
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#697386]">
                    Active Facilities
                  </p>

                  <p className="mt-1 font-heading text-xl font-semibold text-[#176B3A]">
                    5 Flagship Hubs
                  </p>
                </div>

                <Building2 className="text-[#176B3A]" />
              </div>

              <div className="space-y-4 py-5 text-sm">
                <Info label="Average Booking Speed" value="3 mins 40 secs" />
                <Info label="Digital Access" value="24 / 7" />
                <Info label="Physical Keys" value="Not Required" />
              </div>

              <Button asChild className="w-full bg-[#176B3A]">
                <Link to="/facilities">Find Storage</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* STEPS */}
      <section className="page-container py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label justify-center">Four Simple Steps</p>
          <h2 className="section-title mt-3">
            From search to storage without the paperwork.
          </h2>
        </div>

        <div className="mt-12 space-y-8">
          {steps.map((step, index) => {
            const Icon = step.icon;

            return (
              <article
                id={`step-${index + 1}`}
                key={step.number}
                className="grid items-center gap-10 rounded-2xl border bg-white p-7 md:grid-cols-2 md:p-10"
              >
                <div className={index % 2 ? "md:order-2" : ""}>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#176B3A]">
                    Step {step.number}
                  </span>

                  <h3 className="mt-3 font-heading text-2xl font-semibold md:text-3xl">
                    {step.title}
                  </h3>

                  <p className="mt-4 text-sm leading-7 text-[#697386]">
                    {step.text}
                  </p>

                  <div className="mt-6 space-y-3">
                    {[
                      "Fully digital process",
                      "Secure renter verification",
                      "Designed for fast self-service",
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Check size={16} className="text-emerald-600" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className={`blueprint-light flex min-h-[290px] items-center justify-center rounded-2xl bg-[#EAF5EE] ${
                    index % 2 ? "md:order-1" : ""
                  }`}
                >
                  <Icon size={90} strokeWidth={1} className="text-[#176B3A]" />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* SECURITY */}
      <section className="bg-[#173D28] py-20 text-white">
        <div className="page-container text-center">
          <ShieldCheck size={40} className="mx-auto text-[#F6A94F]" />

          <h2 className="mt-5 font-heading text-3xl font-semibold">
            Digital convenience. Physical security.
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#C9D7CD]">
            SelfStorage combines online self-service with controlled facility
            access and monitored storage areas.
          </p>

          <Button
            asChild
            className="mt-7 bg-white text-[#176B3A] hover:bg-blue-50"
          >
            <Link to="/facilities">
              Find Storage
              <ArrowRight size={15} className="ml-2" />
            </Link>
          </Button>
        </div>
      </section>

      {/* CTA */}
      <section className="page-container py-20">
        <div className="rounded-2xl border bg-white p-8 text-center md:p-12">
          <KeyRound size={35} className="mx-auto text-[#176B3A]" />

          <h2 className="mt-5 font-heading text-3xl font-semibold">
            Ready to simplify your storage?
          </h2>

          <p className="mx-auto mt-3 max-w-xl text-sm text-[#697386]">
            Choose your facility and storage size online and start your
            SelfStorage reservation.
          </p>

          <Button asChild className="mt-7 bg-[#176B3A]">
            <Link to="/facilities">Browse Available Units</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#697386]">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
