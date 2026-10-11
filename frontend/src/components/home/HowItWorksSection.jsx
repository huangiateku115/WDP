import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

const steps = [
  [
    "01",
    "Choose Space",
    "Browse storage sizes, facilities and live availability.",
  ],
  ["02", "Select Dates", "Choose your move-in date and rental period."],
  [
    "03",
    "Approval, Sign & Demo Pay",
    "Wait for approval, review your contract and make demo payment.",
  ],
  [
    "04",
    "Handover & Active Access",
    "Wait for facility handover before ACTIVE rental access.",
  ],
];

export default function HowItWorksSection() {
  return (
    <section className="page-container py-20 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="section-label justify-center">Simple Online Rental</p>
        <h2 className="section-title mt-3">Storage in four simple steps.</h2>
      </div>

      <div className="relative mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        <div className="absolute left-[12%] right-[12%] top-7 hidden h-px bg-[#D8E6DC] lg:block" />

        {steps.map(([number, title, text]) => (
          <article key={number} className="relative text-center">
            <div className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#FAFAF7] bg-[#EAF5EE] font-heading text-sm font-bold text-[#176B3A]">
              {number}
            </div>

            <h3 className="mt-5 text-[15px] font-bold">{title}</h3>

            <p className="mx-auto mt-2 max-w-[230px] text-sm leading-6 text-[#697386]">
              {text}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-10 text-center">
        <Button asChild className="bg-[#176B3A]">
          <Link to="/how-it-works">
            See How It Works
            <ArrowRight size={15} className="ml-2" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
