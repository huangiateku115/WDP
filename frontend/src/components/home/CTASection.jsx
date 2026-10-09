import { Link } from "react-router-dom";
import { ArrowRight, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function CTASection() {
  return (
    <section className="page-container pb-20">
      <div className="vault-gradient blueprint-dark overflow-hidden rounded-2xl px-7 py-12 text-white md:px-12">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-100">
              Ready when you are
            </p>

            <h2 className="mt-3 font-heading text-3xl font-semibold md:text-4xl">
              Ready to make more room?
            </h2>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50">
              Browse available storage near you or speak with our team for help
              choosing the right size.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="bg-white text-[#176B3A] hover:bg-blue-50"
            >
              <Link to="/facilities">
                Find Storage
                <ArrowRight size={15} className="ml-2" />
              </Link>
            </Button>

            <Button
              asChild
              variant="outline"
              className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <Link to="/support">
                <Phone size={15} className="mr-2" />
                Talk to Us
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
