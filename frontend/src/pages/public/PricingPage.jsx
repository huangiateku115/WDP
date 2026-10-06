import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  Clock3,
  MapPin,
  ShieldCheck,
  Warehouse,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const plans = [
  {
    icon: Box,
    name: "Smart Locker",
    size: "XS – L",
    monthly: 250000,
    description: "For luggage, parcels, documents and smaller belongings.",
    features: ["Digital access", "24/7 CCTV", "Flexible rental"],
  },
  {
    icon: Warehouse,
    name: "Private Vault",
    size: "3 – 9 m²",
    monthly: 1500000,
    popular: true,
    description: "Private storage for homes, moving and business inventory.",
    features: ["Private room", "PIN access", "Elevator access"],
  },
];

const faqs = [
  [
    "Are there hidden booking fees?",
    "Mandatory charges are displayed before reservation confirmation so you can review the full amount before proceeding.",
  ],
  [
    "Can I switch storage sizes later?",
    "Availability permitting, customers can request a different unit through SelfStorage support or the customer portal.",
  ],
  [
    "How does long-term pricing work?",
    "This demo applies a 15% illustration discount to the displayed monthly rate when Long-Term is selected.",
  ],
];

export default function PricingPage() {
  const [longTerm, setLongTerm] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  const price = (value) => {
    const finalPrice = longTerm ? Math.round(value * 0.85) : value;

    return new Intl.NumberFormat("vi-VN").format(finalPrice);
  };

  return (
    <div className="bg-[#FAFAF7]">
      {/* HERO */}
      <section className="blueprint-dark relative overflow-hidden bg-gradient-to-b from-[#176B3A] via-[#0638a8] to-[#173D28] py-20 ">
        <div className="page-container text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-[#F28C28]" />

            <span className="text-[10px] font-bold uppercase tracking-[0.15em]">
              Straightforward Saigon Pricing
            </span>
          </div>

          <h1 className="mx-auto mt-5 max-w-3xl font-heading text-4xl font-semibold leading-tight tracking-[-0.05em] md:text-5xl">
            Transparent Storage Pricing, Zero Hidden Fees
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-blue">
            Choose the exact space you need with flexible monthly terms and
            secure digital access.
          </p>

          <div className="mt-8 inline-flex rounded-xl bg-white/15 p-1.5">
            <button
              type="button"
              onClick={() => setLongTerm(false)}
              className={`rounded-lg px-6 py-2.5 text-sm font-semibold ${
                !longTerm ? "bg-white text-[#176B3A] shadow" : "text"
              }`}
            >
              Monthly Flexible
            </button>

            <button
              type="button"
              onClick={() => setLongTerm(true)}
              className={`rounded-lg px-6 py-2.5 text-sm font-semibold ${
                longTerm ? "bg-white text-[#176B3A] shadow" : "text-white"
              }`}
            >
              Long-Term (6–12 Mo)
              <span className="ml-2 rounded-full bg-orange-600 px-2 py-0.5 text-[9px] text-white">
                SAVE 15%
              </span>
            </button>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-5 text-xs text-blue-100">
            <span>✓ No hidden administration fees</span>
            <span>•</span>
            <span>⚡ Fast digital access setup</span>
            <span>•</span>
            <span>✓ Flexible rental options</span>
          </div>
        </div>
      </section>

      {/* LOCATION */}
      <section className="page-container relative z-10 -mt-7">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl border bg-white p-5 shadow-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
              <MapPin size={20} />
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase text-[#7b8495]">
                Selected Location
              </p>
              <strong className="text-sm">Ho Chi Minh City Network</strong>
            </div>
          </div>

          <Button asChild variant="outline">
            <Link to="/facilities">Change Location</Link>
          </Button>
        </div>
      </section>

      {/* PLANS */}
      <section className="page-container py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label justify-center">
            Precision Lockers & Private Vaults
          </p>

          <h2 className="section-title mt-3">
            Choose the space that fits your needs.
          </h2>

          <p className="section-description mx-auto mt-4 max-w-2xl">
            {longTerm
              ? "Long-term example rates currently show a 15% discount."
              : "Stay flexible with simple monthly storage pricing."}
          </p>
        </div>

        <div className="mt-11 grid gap-5 lg:grid-cols-2">
          {plans.map((plan) => {
            const Icon = plan.icon;

            return (
              <article
                key={plan.name}
                className={`relative rounded-2xl border bg-white p-6 ${
                  plan.popular
                    ? "border-[#176B3A] shadow-[0_15px_40px_rgba(6,63,196,.12)]"
                    : "border-[#e3e7f0]"
                }`}
              >
                {plan.popular && (
                  <span className="absolute right-5 top-5 rounded-full bg-[#176B3A] px-3 py-1 text-[9px] font-bold text-white">
                    MOST POPULAR
                  </span>
                )}

                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
                  <Icon size={21} />
                </div>

                <p className="mt-5 text-xs font-bold uppercase tracking-wider text-[#176B3A]">
                  {plan.size}
                </p>

                <h3 className="mt-2 font-heading text-2xl font-semibold">
                  {plan.name}
                </h3>

                <p className="mt-3 min-h-[48px] text-sm leading-6 text-[#697386]">
                  {plan.description}
                </p>

                <div className="mt-6">
                  <span className="font-heading text-3xl font-semibold">
                    {price(plan.monthly)}
                  </span>
                  <span className="ml-2 text-xs text-[#697386]">
                    VND / month
                  </span>
                </div>

                <div className="mt-6 space-y-3 border-t pt-5">
                  {plan.features.map((feature) => (
                    <div
                      key={feature}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Check size={15} className="text-emerald-600" />
                      {feature}
                    </div>
                  ))}
                </div>

                <Button
                  asChild
                  className={`mt-7 w-full ${
                    plan.popular
                      ? "bg-[#176B3A]"
                      : "bg-[#EAF5EE] text-[#176B3A] hover:bg-[#EAF5EE]"
                  }`}
                >
                  <Link to="/facilities">Check Availability</Link>
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      {/* INCLUDED */}
      <section className="border-y bg-[#F5F7F2] py-20">
        <div className="page-container">
          <div className="mx-auto max-w-3xl text-center">
            <p className="section-label justify-center">Clear & Predictable</p>
            <h2 className="section-title mt-3">What's included?</h2>
          </div>

          <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
            <div className="rounded-2xl border bg-white p-7">
              <h3 className="font-heading text-xl font-semibold">
                Included with your storage
              </h3>

              <div className="mt-6 space-y-4">
                <Included icon={ShieldCheck} text="24/7 facility monitoring" />
                <Included icon={Clock3} text="Digital facility access" />
                <Included icon={Zap} text="Online account management" />
                <Included icon={Check} text="Transparent monthly billing" />
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-7">
              <h3 className="font-heading text-xl font-semibold">
                Optional services
              </h3>

              <div className="mt-6 space-y-4">
                <Included icon={Box} text="Packing and moving supplies" />
                <Included icon={Warehouse} text="Business storage upgrades" />
                <Included
                  icon={ShieldCheck}
                  text="Additional protection options"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="page-container py-20">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <p className="section-label justify-center">Pricing FAQ</p>
            <h2 className="section-title mt-3">Questions about pricing?</h2>
          </div>

          <div className="mt-9 space-y-3">
            {faqs.map(([question, answer], index) => (
              <div
                key={question}
                className="overflow-hidden rounded-xl border bg-white"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left text-sm font-semibold"
                >
                  {question}

                  <ChevronDown
                    size={17}
                    className={`transition ${
                      openFaq === index ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {openFaq === index && (
                  <p className="border-t p-5 text-sm leading-6 text-[#697386]">
                    {answer}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-container pb-20">
        <div className="vault-gradient blueprint-dark rounded-2xl p-10 text-center text-white">
          <h2 className="font-heading text-3xl font-semibold">
            Find the right space at the right price.
          </h2>

          <p className="mx-auto mt-3 max-w-xl text-sm text-blue-100">
            Browse live facilities and choose the storage unit that works for
            you.
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
    </div>
  );
}

function Included({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-3 text-sm text-[#4f596b]">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF5EE] text-[#176B3A]">
        <Icon size={15} />
      </div>
      {text}
    </div>
  );
}
