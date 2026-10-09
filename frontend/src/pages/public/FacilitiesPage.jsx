import {FacilityBrowser} from '@/components/customer/RentalBookingIntegration';
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Box,
  Building2,
  ChevronDown,
  Clock3,
  MapPin,
  Search,
  ShieldCheck,
  Warehouse,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const facilities = [
  {
    id: 1,
    district: "District 1",
    area: "Central Saigon",
    name: "SelfStorage Central",
    address: "128 Nguyen Thi Minh Khai, District 1",
    available: 8,
    price: "490,000",
    types: ["Mini Storage"],
    image:
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=85",
  },
  {
    id: 2,
    district: "District 7",
    area: "Phu My Hung",
    name: "SelfStorage South Hub",
    address: "45 Nguyen Van Linh, District 7",
    available: 5,
    price: "450,000",
    types: ["Mini Storage", "Business Storage"],
    image:
      "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=85",
  },
  {
    id: 3,
    district: "Thu Duc City",
    area: "Innovation Park",
    name: "SelfStorage East Hub",
    address: "88 Vo Van Ngan, Thu Duc City",
    available: 12,
    price: "390,000",
    types: ["Smart Lockers", "Heavy Warehouse"],
    image:
      "https://images.unsplash.com/photo-1565793298595-6a879b1d9492?auto=format&fit=crop&w=1200&q=85",
  },
];

function FacilitiesPage() {
  const [district, setDistrict] = useState("All Districts");
  const [type, setType] = useState("All Solutions");
  const [size, setSize] = useState("Any Size");

  const visibleFacilities = useMemo(() => {
    return facilities.filter((facility) => {
      const districtMatch =
        district === "All Districts" || facility.district === district;

      const typeMatch =
        type === "All Solutions" || facility.types.includes(type);

      return districtMatch && typeMatch;
    });
  }, [district, type]);

  return (
    <div className="bg-[#FAFAF7]">
      {/* HERO */}
      <section className="blueprint-light relative overflow-hidden bg-gradient-to-b from-[#EAF5EE] via-[#F7FAF7] to-[#FAFAF7] pb-24 pt-14">
        <div className="page-container text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-[#176B3A]" />

            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#176B3A]">
              Ho Chi Minh City Network • Live Space Matrix
            </span>
          </div>

          <h1 className="mt-5 font-heading text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
            Find storage near you
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#5f6879] md:text-base">
            Discover secure storage facilities across Ho Chi
            Minh City with online availability and digital access.
          </p>
        </div>
      </section>

      {/* FILTER */}
      <section className="page-container relative z-10 -mt-14">
        <div className="rounded-2xl border border-[#e3e7f0] bg-white p-6 shadow-[0_18px_50px_rgba(16,24,40,.12)]">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="District / Area"
              value={district}
              onChange={setDistrict}
              options={[
                "All Districts",
                "District 1",
                "District 7",
                "Thu Duc City",
              ]}
            />

            <FilterSelect
              label="Storage Type"
              value={type}
              onChange={setType}
              options={[
                "All Solutions",
                "Mini Storage",
                "Business Storage",
                "Smart Lockers",
                "Heavy Warehouse",
              ]}
            />

            <FilterSelect
              label="Unit Size"
              value={size}
              onChange={setSize}
              options={["Any Size", "Up to 4 m²", "Up to 8 m²", "12+ m²"]}
            />

            <div className="flex items-end">
              <Button className="h-12 w-full bg-[#176B3A]">
                <Search size={16} className="mr-2" />
                Search Available Units
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* RESULTS */}
      <section className="page-container py-16">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="section-label">Storage Locations</p>

            <h2 className="section-title mt-2">
              Available facilities in Ho Chi Minh City
            </h2>
          </div>

          <p className="text-sm text-[#697386]">
            {visibleFacilities.length} facilities found
          </p>
        </div>

        <div className="mt-9 space-y-6">
          {visibleFacilities.map((facility) => (
            <article
              key={facility.id}
              className="overflow-hidden rounded-2xl border border-[#e4e8f2] bg-white"
            >
              <div className="grid lg:grid-cols-[.85fr_1.15fr]">
                <div className="relative min-h-[290px]">
                  <img
                    src={facility.image}
                    alt={facility.name}
                    className="absolute inset-0 h-full w-full object-cover"
                  />

                  <span className="absolute left-5 top-5 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-[#176B3A] shadow">
                    {facility.district.toUpperCase()}
                  </span>
                </div>

                <div className="p-7 md:p-9">
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-[#176B3A]">
                        {facility.area}
                      </p>

                      <h3 className="mt-2 font-heading text-2xl font-semibold">
                        {facility.name}
                      </h3>

                      <p className="mt-3 flex items-center gap-2 text-sm text-[#697386]">
                        <MapPin size={15} />
                        {facility.address}
                      </p>
                    </div>

                    <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      {facility.available} units available
                    </span>
                  </div>

                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    <Feature icon={Clock3} title="24/7" text="Digital access" />

                    <Feature icon={ShieldCheck} title="CCTV" text="Monitored" />
                  </div>

                  <div className="mt-7 flex flex-wrap gap-2">
                    {facility.types.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-[#EAF5EE] px-3 py-1.5 text-xs font-semibold text-[#4D6554]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>

                  <div className="mt-7 flex flex-wrap items-end justify-between gap-5 border-t pt-6">
                    <div>
                      <p className="text-xs text-[#7b8495]">Storage from</p>
                      <strong className="mt-1 block font-heading text-2xl">
                        {facility.price}{" "}
                        <span className="text-xs font-normal text-[#7b8495]">
                          VND/mo
                        </span>
                      </strong>
                    </div>

                    <Button asChild className="bg-[#176B3A]">
                      <Link to="/portal/rent">
                        View Available Units
                        <ArrowRight size={15} className="ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}

          {visibleFacilities.length === 0 && (
            <div className="rounded-2xl border bg-white py-16 text-center">
              <Warehouse size={38} className="mx-auto text-[#9aa5bb]" />

              <h3 className="mt-4 font-heading text-xl font-semibold">
                No matching facilities
              </h3>

              <p className="mt-2 text-sm text-[#697386]">
                Try changing your district or storage type.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* EAST HUB */}
      <section className="border-y bg-[#f3f5ff] py-20">
        <div className="page-container grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="section-label">New Facility • 2025</span>

            <h2 className="section-title mt-3">SelfStorage East Hub</h2>

            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#176B3A]">
              <MapPin size={16} />
              Thu Duc City • Innovation Park
            </p>

            <p className="mt-5 max-w-xl text-sm leading-7 text-[#697386]">
              Located at 88 Vo Van Ngan, the East Hub combines smart micro
              lockers, heavy warehouse storage and extra-wide corridors for
              convenient loading.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Feature icon={Box} title="Smart Lockers" text="Micro storage" />
              <Feature
                icon={Warehouse}
                title="Heavy Warehouse"
                text="Business inventory"
              />
              <Feature
                icon={Building2}
                title="Wide Corridors"
                text="Easy loading"
              />
              <Feature
                icon={ShieldCheck}
                title="Secure Hub"
                text="Controlled access"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl">
            <img
              src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=85"
              alt="SelfStorage East Hub"
              className="h-[380px] w-full object-cover"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-semibold text-[#5e6676]">
        {label}
      </span>

      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full appearance-none rounded-xl border-0 bg-[#f4f6ff] px-4 pr-10 text-sm font-medium outline-none ring-[#176B3A] focus:ring-2"
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>

        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"
        />
      </div>
    </label>
  );
}

function Feature({ icon: Icon, title, text }) {
  return (
    <div className="rounded-xl bg-[#f6f8ff] p-4">
      <Icon size={18} className="text-[#176B3A]" />
      <strong className="mt-3 block text-sm">{title}</strong>
      <span className="mt-1 block text-xs text-[#7b8495]">{text}</span>
    </div>
  );
}

// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default FacilityBrowser;
