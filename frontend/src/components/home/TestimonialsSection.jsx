import { Star } from "lucide-react";

const reviews = [
  {
    name: "Thao Nguyen",
    role: "District 1 Customer",
    text: "The facility is extremely clean and the online booking process was much easier than I expected.",
  },
  {
    name: "Minh Tran",
    role: "Small Business Owner",
    text: "We use SelfStorage for inventory and documents. The security is exactly what we needed.",
  },
  {
    name: "Quang Le",
    role: "Long-Term Tenant",
    text: "Clear pricing, helpful support and convenient access. Extending my rental was straightforward.",
  },
];

export default function TestimonialsSection() {
  return (
    <section className="border-y border-[#e8eaf4] bg-[#F5F7F2] py-20">
      <div className="page-container">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label justify-center">Customer Stories</p>
          <h2 className="section-title mt-3">Real voices. More room.</h2>
        </div>

        <div className="mt-11 grid gap-5 lg:grid-cols-3">
          {reviews.map((review) => (
            <article
              key={review.name}
              className="rounded-2xl border border-[#e2e6f0] bg-white p-6"
            >
              <div className="flex gap-1 text-[#f4a900]">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star key={index} size={15} fill="currentColor" />
                ))}
              </div>

              <p className="mt-5 text-sm leading-7 text-[#4f596b]">
                “{review.text}”
              </p>

              <div className="mt-6 border-t pt-5">
                <p className="text-sm font-bold">{review.name}</p>
                <p className="mt-1 text-xs text-[#7b8495]">{review.role}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
