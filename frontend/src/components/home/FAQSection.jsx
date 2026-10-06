import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "What is the minimum rental duration?",
    a: "Rental periods depend on the selected unit and facility. Available options are shown before reservation.",
  },
  {
    q: "Can I access my unit outside normal business hours?",
    a: "Selected SelfStorage facilities provide 24/7 digital access. Access conditions are displayed for each facility.",
  },
  {
    q: "Are my items protected while stored?",
    a: "Available protection options and applicable conditions are shown during reservation and contract review.",
  },
  {
    q: "Do I need to pay a deposit?",
    a: "Any required deposit or mandatory charge is displayed before reservation confirmation.",
  },
];

export default function FAQSection() {
  const [open, setOpen] = useState(0);

  return (
    <section className="page-container py-20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="section-label justify-center">Got Questions?</p>
        <h2 className="section-title mt-3">Frequently Asked Questions</h2>
      </div>

      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {faqs.map((item, index) => (
          <article
            key={item.q}
            className="overflow-hidden rounded-xl border border-[#e8eaf3] bg-white"
          >
            <button
              type="button"
              onClick={() => setOpen(open === index ? -1 : index)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-semibold">{item.q}</span>

              <ChevronDown
                size={18}
                className={`text-[#176B3A] transition ${
                  open === index ? "rotate-180" : ""
                }`}
              />
            </button>

            {open === index && (
              <p className="border-t px-5 py-4 text-sm leading-6 text-[#697386]">
                {item.a}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
