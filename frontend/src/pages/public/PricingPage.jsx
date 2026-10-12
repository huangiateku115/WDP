import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import facilityApi from '@/api/facilityApi';
import {useReservation} from '@/contexts/ReservationContext';
import {useBackend,LoadState,rows,responseData,recordId,validId} from '@/components/customer/RentalBackendUI';
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
    description: "For luggage, parcels, documents and smaller belongings.",
    features: ["Digital access", "24/7 CCTV", "Flexible rental"],
  },
  {
    icon: Warehouse,
    name: "Private Vault",
    size: "3 – 9 m²",
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
    "Long-term rates depend on the selected facility's returned pricing rules. No promotional discount is assumed.",
  ],
];

export default function PricingPage() {
  const [longTerm, setLongTerm] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [query]=useSearchParams(),{rentalDraft}=useReservation();
  const [facilityId,setFacilityId]=useState(query.get('facility')||recordId(rentalDraft.facility)||'');
  const locations=useBackend(config=>facilityApi.publicList(config).then(rows),[],true);
  const rates=useBackend(async config=>{if(!validId(facilityId))return null;const grouped=responseData(await facilityApi.publicPricing(facilityId,config));if(!grouped||typeof grouped!=='object'||Array.isArray(grouped)||(!Object.hasOwn(grouped,'selfStorage')&&!Object.hasOwn(grouped,'managedInventory'))||['selfStorage','managedInventory'].some(key=>Object.hasOwn(grouped,key)&&!Array.isArray(grouped[key])))throw Error('The facility pricing response cannot be displayed safely yet. Its grouped pricing contract requires backend confirmation.');const data=[...(grouped.selfStorage||[]),...(grouped.managedInventory||[])];if(data.some(rule=>typeof rule.price!=='number'||!Number.isFinite(rule.price)||rule.price<0||typeof rule.currency!=='string'||!/^[A-Z]{3}$/.test(rule.currency)||!Number.isInteger(rule.term?.value)||rule.term.value<1||!['DAY','MONTH','YEAR'].includes(rule.term.unit)))throw Error('The facility pricing response cannot be displayed safely yet. Its price, currency and term fields require backend confirmation.');return data;},[facilityId],true);
  const selectedLocation=locations.data?.find(f=>recordId(f)===facilityId);
  const visibleRates=rates.data?.filter(rule=>longTerm?rule.term.unit==='MONTH'&&[6,12].includes(rule.term.value):!(rule.term.unit==='MONTH'&&[6,12].includes(rule.term.value)))||[];

  return (
    <div className="bg-[#FAFAF7]">
      {/* HERO */}
      <section style={{backgroundColor:'#0E4F2B'}} className="blueprint-dark relative overflow-hidden bg-gradient-to-b from-[#176B3A] via-[#0E4F2B] to-[#173D28] py-14 text-white md:py-20">
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

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7" style={{color:'#EDF5EE'}}>
            Choose the exact space you need with flexible monthly terms and
            secure digital access.
          </p>

          <div className="mx-auto mt-8 grid max-w-xl gap-2 rounded-xl border border-white/30 bg-white/10 p-2 sm:grid-cols-2" role="group" aria-label="Pricing duration">
            <button
              type="button"
              onClick={() => setLongTerm(false)}
              aria-pressed={!longTerm}
              style={{color:!longTerm?'#176B3A':'#FFFFFF',background:!longTerm?'#FFFFFF':'#0E4F2B'}}
              className={`rounded-lg px-6 py-2.5 text-sm font-semibold ${
                !longTerm ? "bg-white text-[#176B3A] shadow" : "text-white"
              }`}
            >
              Monthly Flexible
            </button>

            <button
              type="button"
              onClick={() => setLongTerm(true)}
              aria-pressed={longTerm}
              style={{color:longTerm?'#176B3A':'#FFFFFF',background:longTerm?'#FFFFFF':'#0E4F2B'}}
              className={`rounded-lg px-6 py-2.5 text-sm font-semibold ${
                longTerm ? "bg-white text-[#176B3A] shadow" : "text-white"
              }`}
            >
              Long Term (6–12 Months)
            </button>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm" style={{color:'#EDF5EE'}}>
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
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
              <MapPin size={20} />
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase text-[#7b8495]">
                Selected Location
              </p>
              <strong className="break-words text-sm">{selectedLocation?.name||'Choose a facility'}</strong>
            </div>
          </div>

          <Button asChild variant="outline">
            <Link to="/facilities">Change Location</Link>
          </Button>
        </div>
        <div className="mx-auto mt-5 max-w-3xl space-y-3"><LoadState resource={locations}/><label className="block text-sm font-semibold text-[#173D28]">Facility<select aria-label="Pricing facility" className="customer-select mt-2" value={facilityId} onChange={event=>setFacilityId(event.target.value)}><option value="">Choose a facility</option>{locations.data?.filter(f=>validId(recordId(f))).map(f=><option key={recordId(f)} value={recordId(f)}>{f.name}</option>)}</select></label><LoadState resource={rates}/>{!facilityId&&<p className="text-sm text-slate-700">Choose a facility to view backend pricing.</p>}{rates.data&&<><h2 className="text-lg font-bold text-[#173D28]">Facility rates</h2>{visibleRates.length?visibleRates.map((rule,index)=><div key={recordId(rule)||index} className="rounded-xl border bg-white p-5"><p className="font-semibold text-[#176B3A]">{rule.serviceType}{rule.unitSize?` · ${rule.unitSize}`:''}</p><p className="mt-2 text-xl font-bold text-[#173D28]">{new Intl.NumberFormat('vi-VN').format(rule.price)} <span className="text-sm">{rule.currency} / {rule.term.value} {rule.term.unit.toLowerCase()}{rule.term.value===1?'':'s'}</span></p></div>):<p className="text-sm text-slate-700">No {longTerm?'6–12 month':'monthly'} rates returned for this facility.</p>}<p className="text-xs text-slate-600">Returned rule prices are shown for their exact term; deposits and total booking amounts require confirmed policies.</p></>}</div>
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
              ? "Long-term availability and prices depend on the selected facility. No discount is assumed."
              : "Review the selected facility's monthly rates above before booking."}
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
                  <span className="font-heading text-lg font-semibold text-[#173D28]">Check facility pricing</span>
                  <p className="mt-2 text-sm text-slate-600">Category pricing is not confirmed. No illustrative rate is presented as a live offer.</p>
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
                  <Link to={validId(facilityId)?`/portal/rent?facility=${facilityId}`:'/facilities'}>Check Availability</Link>
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
