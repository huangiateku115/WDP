import { Link } from "react-router-dom";
import {
  ArrowRight,
  CircleCheck,
  LockKeyhole,
  Warehouse,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const solutions = [
  {
    badge: "MOST POPULAR",
    icon: Warehouse,
    title: "Mini Storage (3–9 m²)",
    description:
      "Private rooms with secure PIN entry, ideal for moving, renovation, seasonal belongings or business inventory.",
    features: [
      "Clean, ventilated compartments",
      "Ground-level & elevator access",
      "24/7 CCTV and digital entry",
    ],
    image:
      "https://removalistsnorthernbeaches.com.au/wp-content/uploads/2026/06/Modern-self-storage-solution-providing-secure-space-for-furniture-and-household-belongings.jpg",
  },

  {
    badge: "FLEXIBLE STORAGE",
    icon: LockKeyhole,
    title: "Smart Lockers & Micro Storage",
    description:
      "Compact lockers for luggage, documents, parcels and smaller belongings with digital self-service access.",
    features: [
      "PIN and smart access",
      "Flexible short-term rental",
      "Secure monitored facility",
    ],
    image:
      "https://images.unsplash.com/photo-1565793298595-6a879b1d9492?auto=format&fit=crop&w=1200&q=85",
  },
];

export default function StorageSolutionsSection() {
  return (
    <section className="page-container py-20 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="section-label justify-center">
          Popular Storage Solutions
        </p>

        <h2 className="section-title mt-3">
          Storage designed around what you need.
        </h2>

        <p className="section-description mx-auto mt-4 max-w-2xl">
          Choose secure personal rooms or flexible
          smart lockers across the SelfStorage network.
        </p>
      </div>

      <div className="mt-12 space-y-7">
        {solutions.map((item, index) => {
          const Icon = item.icon;
          const reverse = index % 2 === 1;

          return (
            <article
              key={item.title}
              className="overflow-hidden rounded-2xl border border-[#e4e8f2] bg-white shadow-[0_8px_30px_rgba(16,24,40,.05)]"
            >
              <div className="grid lg:grid-cols-2">
                <div
                  className={`relative min-h-[310px] ${
                    reverse ? "lg:order-2" : ""
                  }`}
                >
                  <img
                    src={item.image}
                    alt={item.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />

                  <span className="absolute left-5 top-5 rounded-full bg-[#176B3A] px-3 py-1.5 text-[10px] font-bold tracking-wider text-white">
                    {item.badge}
                  </span>
                </div>

                <div
                  className={`flex flex-col justify-center p-7 md:p-10 ${
                    reverse ? "lg:order-1" : ""
                  }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
                    <Icon size={20} />
                  </div>

                  <h3 className="mt-5 font-heading text-2xl font-semibold tracking-[-0.035em] md:text-[30px]">
                    {item.title}
                  </h3>

                  <p className="mt-3 text-sm leading-6 text-[#697386]">
                    {item.description}
                  </p>

                  <div className="mt-5 space-y-2.5">
                    {item.features.map((feature) => (
                      <div
                        key={feature}
                        className="flex gap-2.5 text-sm text-[#4b5565]"
                      >
                        <CircleCheck
                          size={16}
                          className="mt-0.5 shrink-0 text-emerald-600"
                        />
                        {feature}
                      </div>
                    ))}
                  </div>

                  <div className="mt-7 flex flex-wrap items-end justify-between gap-5 border-t border-[#edf0f6] pt-6">
                    <div>
                      <p className="text-xs text-[#7b8495]">Pricing varies by facility and term</p>
                      <Link to="/pricing" className="mt-2 inline-block font-semibold text-[#176B3A]">View published facility rates</Link>
                    </div>

                    <Button asChild variant="outline">
                      <Link to="/facilities">
                        View Storage
                        <ArrowRight size={15} className="ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
