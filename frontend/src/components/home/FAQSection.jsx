import {Link} from 'react-router-dom';
import {ArrowRight} from 'lucide-react';
import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "What is the minimum rental duration?",
    a: "Rental periods depend on the selected unit and facility. Available options are shown before reservation.",
  },
  {
    q: "Can I access my unit outside normal business hours?",
    a: "Check the published facility hours and coordinate with the facility team. Simulated unit access is available only for ACTIVE rentals.",
  },
  {
    q: "Are my items protected while stored?",
    a: "Available protection options and applicable conditions are shown during reservation and contract review.",
  },
  {
    q: "Do I need to pay a deposit?",
    a: "Your rental quote sets out the deposit and total before reservation. Review these amounts along with your contract before continuing.",
  },
];

export default function FAQSection() {
  const [open, setOpen] = useState(0);

 return <section className="vs-section vs-white"><div className="page-container vs-faq"><div><p className="vs-eyebrow">Before you get started</p><h2>A few things<br/>you might wonder.</h2><p className="vs-description">The right space starts with the right information. We are here to help you find it.</p><Link className="vs-text-link mt-6" to="/support">More questions? Visit Support <ArrowRight size={16}/></Link></div><div>{faqs.map((item,index)=><article className="border-b border-[#dfe6dc] py-5" key={item.q}><button type="button" className="flex w-full items-center justify-between gap-5 text-left text-sm font-semibold" aria-expanded={open===index} aria-controls={'home-answer-'+index} onClick={()=>setOpen(open===index?-1:index)}>{item.q}<ChevronDown size={18} className={open===index?'rotate-180':''}/></button>{open===index&&<p id={'home-answer-'+index} className="mt-4 text-sm leading-7 text-[#637267]">{item.a}</p>}</article>)}</div></div></section>;
}
