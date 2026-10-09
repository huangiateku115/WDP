import { Camera, KeyRound, ShieldCheck } from "lucide-react";

const features = [
  {
    icon: Camera,
    title: "24/7 CCTV Monitoring",
    text: "Continuous facility surveillance and controlled entry points.",
  },
  {
    icon: KeyRound,
    title: "Smart Digital Access",
    text: "Secure credentials provide convenient access without traditional keys.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-Layer Security",
    text: "Controlled facility, storage-zone and individual unit protection.",
  },
];

export default function SecuritySection() {
  return (
    <section className="page-container py-20 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="section-label justify-center">
          The SelfStorage Difference
        </p>

        <h2 className="section-title mt-3">
          Security engineered for total peace of mind.
        </h2>

        <p className="section-description mx-auto mt-4 max-w-2xl">
          Modern physical and digital security protects your storage space
          throughout the day.
        </p>
      </div>

      <div className="mt-11 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <article
            key={title}
            className="rounded-2xl border border-[#e6e9f2] bg-white p-6"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EAF5EE] text-[#176B3A]">
              <Icon size={21} />
            </div>

            <h3 className="mt-5 text-[15px] font-bold">{title}</h3>

            <p className="mt-2 text-sm leading-6 text-[#697386]">{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
