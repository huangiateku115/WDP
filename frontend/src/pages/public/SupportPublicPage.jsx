import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Box,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileText,
  KeyRound,
  LifeBuoy,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const topics = [
  {
    icon: KeyRound,
    title: "Access & Entry",
    description:
      "Gate access, unit credentials, digital keys and entry troubleshooting.",
  },
  {
    icon: CircleDollarSign,
    title: "Billing & Payments",
    description:
      "Invoices, payment status, pricing, deposits and rental extensions.",
  },
  {
    icon: Box,
    title: "Storage & Unit Size",
    description:
      "Choose a unit, compare sizes and understand storage requirements.",
  },
  {
    icon: FileText,
    title: "Contracts & Reservations",
    description:
      "Reservation status, e-contracts, booking changes and cancellation.",
  },
  {
    icon: Building2,
    title: "Facilities",
    description:
      "Location information, access hours, loading areas and facility rules.",
  },
  {
    icon: ShieldCheck,
    title: "Security & Protection",
    description:
      "CCTV, renter responsibilities and item protection.",
  },
];

const faqs = [
  [
    "I cannot access my storage unit. What should I do?",
    "Check that your reservation and contract are active, then confirm you are using the access credentials assigned to the correct facility. If access still fails, contact SelfStorage support.",
  ],
  [
    "How can I change my reservation?",
    "Reservation changes depend on current unit availability. Contact support or use the customer portal where modification options are available.",
  ],
  [
    "Where can I see my payment status?",
    "Signed-in customers can review reservation and payment information from the customer portal.",
  ],
  [
    "How do I choose the correct storage size?",
    "Use the storage size guide or compare unit dimensions on the Facilities page before submitting a reservation.",
  ],
];

export default function SupportPublicPage() {
  const [query, setQuery] = useState("");
  const [openFaq, setOpenFaq] = useState(0);

  const filteredTopics = topics.filter((topic) => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) return true;

    return (
      topic.title.toLowerCase().includes(keyword) ||
      topic.description.toLowerCase().includes(keyword)
    );
  });

  return (
    <div className="bg-[#FAFAF7]">
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#EAF5EE] via-[#F5F7F2] to-[#FAFAF7] py-20">
        <div className="absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full bg-cyan-300/20 blur-3xl" />

        <div className="page-container relative text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#F28C28]" />

            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#176B3A]">
              24/7 Customer Care & Facility Assistance
            </span>
          </div>

          <h1 className="mt-5 font-heading text-4xl font-semibold tracking-[-0.05em] md:text-5xl">
            How can we help you today?
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-[#697386]">
            Find answers for facility access, rental billing, reservations,
            moving support and unit sizing.
          </p>

          <div className="mx-auto mt-9 max-w-3xl rounded-2xl bg-white p-2 shadow-xl">
            <div className="flex items-center gap-3">
              <Search className="ml-3 shrink-0 text-[#176B3A]" />

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder="Search help topics, access guides, payment FAQs..."
              />

              <Button className="hidden h-11 bg-[#176B3A] px-7 sm:flex">
                Search
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <a
              href="tel:02877700117"
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#176B3A] shadow-sm"
            >
              Hotline: 028 7770 0117 (24/7)
            </a>

            <span className="rounded-full bg-white px-4 py-2 text-xs font-semibold shadow-sm">
              WhatsApp / Zalo Concierge
            </span>

            <span className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold shadow-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Live Chat Active
            </span>
          </div>
        </div>
      </section>

      {/* TOPICS */}
      <section className="page-container py-20">
        <div className="text-center">
          <p className="section-label justify-center">Help Center</p>
          <h2 className="section-title mt-3">Browse by topic</h2>
          <p className="section-description mx-auto mt-4 max-w-2xl">
            Select a category to quickly find the information you need.
          </p>
        </div>

        <div className="mt-11 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredTopics.map((topic) => {
            const Icon = topic.icon;

            return (
              <article
                key={topic.title}
                className="group rounded-2xl border bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
                  <Icon size={20} />
                </div>

                <h3 className="mt-5 font-heading text-lg font-semibold">
                  {topic.title}
                </h3>

                <p className="mt-2 min-h-[48px] text-sm leading-6 text-[#697386]">
                  {topic.description}
                </p>

                <button
                  type="button"
                  className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#176B3A]"
                >
                  Explore articles
                  <ArrowRight
                    size={15}
                    className="transition group-hover:translate-x-1"
                  />
                </button>
              </article>
            );
          })}
        </div>

        {filteredTopics.length === 0 && (
          <div className="mt-10 rounded-2xl border bg-white py-12 text-center">
            <Search size={32} className="mx-auto text-[#9aa5bb]" />

            <h3 className="mt-4 font-semibold">No matching help topic</h3>

            <p className="mt-2 text-sm text-[#697386]">
              Try another search term or contact the support team below.
            </p>
          </div>
        )}
      </section>

      {/* QUICK HELP */}
      <section className="border-y bg-[#F5F7F2] py-20">
        <div className="page-container">
          <div className="grid gap-5 lg:grid-cols-3">
            <SupportCard
              icon={Phone}
              title="Call Support"
              text="Speak directly with the SelfStorage support team."
              action="028 7770 0117"
            />

            <SupportCard
              icon={MessageCircle}
              title="Live Assistance"
              text="Get help with reservations, access and facility questions."
              action="Start Conversation"
            />

            <SupportCard
              icon={BookOpen}
              title="Self-Service Guides"
              text="Review guides for booking, access and storage management."
              action="Browse Guides"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="page-container py-20">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <p className="section-label justify-center">Common Questions</p>
            <h2 className="section-title mt-3">
              Frequently asked support questions
            </h2>
          </div>

          <div className="mt-10 space-y-3">
            {faqs.map(([question, answer], index) => (
              <article
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
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT CTA */}
      <section className="page-container pb-20">
        <div className="vault-gradient blueprint-dark rounded-2xl p-8 text-white md:p-12">
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <LifeBuoy size={32} />

              <h2 className="mt-5 font-heading text-3xl font-semibold">
                Still need help?
              </h2>

              <p className="mt-3 max-w-xl text-sm leading-6 text-blue-100">
                Our support team can help with bookings, payments, contracts and
                facility access.
              </p>

              <div className="mt-5 flex items-center gap-2 text-xs text-blue-100">
                <Clock3 size={14} />
                Support available 24/7
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                className="bg-white text-[#176B3A] hover:bg-blue-50"
              >
                <a href="tel:02877700117">
                  <Phone size={15} className="mr-2" />
                  Call Support
                </a>
              </Button>

              <Button
                asChild
                variant="outline"
                className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Link to="/login">Customer Portal</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SupportCard({ icon: Icon, title, text, action }) {
  return (
    <article className="rounded-2xl border bg-white p-6">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
        <Icon size={20} />
      </div>

      <h3 className="mt-5 font-heading text-xl font-semibold">{title}</h3>

      <p className="mt-2 text-sm leading-6 text-[#697386]">{text}</p>

      <button
        type="button"
        className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#176B3A]"
      >
        {action}
        <ArrowRight size={15} />
      </button>
    </article>
  );
}
