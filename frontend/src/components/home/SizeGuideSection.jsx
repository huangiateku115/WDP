import { Link } from "react-router-dom";
import {
  ArrowRight,
  Box,
  Building2,
  PackageOpen,
  Warehouse,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const sizes = [
  {
    icon: Box,
    title: "Few boxes & bags",
    type: "Locker / Micro Storage",
    size: "1–2 m²",
  },
  {
    icon: PackageOpen,
    title: "Studio / 1-room apt.",
    type: "Mini Storage",
    size: "3–4 m²",
  },
  {
    icon: Warehouse,
    title: "1–2 Bedroom Home",
    type: "Standard Storage",
    size: "6–9 m²",
  },
  {
    icon: Building2,
    title: "Commercial Inventory",
    type: "Business Storage",
    size: "12+ m²",
  },
];

export default function SizeGuideSection() {
  return (
    <section className="border-y border-[#e9ebf4] bg-[#F5F7F2] py-20">
      <div className="page-container">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label justify-center">Space Calculator</p>

          <h2 className="section-title mt-3">
            Not sure how much room you need?
          </h2>

          <p className="section-description mx-auto mt-4 max-w-2xl">
            Start with what you plan to store and compare our most common unit
            sizes. These are illustrative size guides; actual unit dimensions are shown during selection.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sizes.map(({ icon: Icon, title, type, size }) => (
            <div
              key={title}
              className="rounded-2xl border border-[#e2e6f1] bg-white p-5 transition hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
                <Icon size={19} />
              </div>

              <h3 className="mt-5 text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-xs text-[#7b8495]">{type}</p>

              <div className="mt-5 flex items-center justify-between border-t border-[#eef0f6] pt-4">
                <strong className="font-heading text-xl text-[#176B3A]">
                  {size}
                </strong>

                <ArrowRight size={16} className="text-[#176B3A]" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Button asChild className="bg-[#176B3A]">
            <Link to="/facilities">Find My Storage Size</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
