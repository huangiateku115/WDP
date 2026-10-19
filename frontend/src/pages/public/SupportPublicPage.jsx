import {PageIntro,PublicCTA,SectionHeading} from '@/components/public/PublicSiteUI';
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
      "Invoices, payment status, pricing, deposits and rental balances.",
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

 return <><PageIntro eyebrow="Help & support" title="A little guidance goes a long way." description="Questions about your space, your reservation or your inventory? Start here."><form className="vs-help-search" onSubmit={e=>{e.preventDefault();document.getElementById('help-topics')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}><input type="search" aria-label="Search help topics" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search access, payments, reservations…"/><Button className="vs-button" type="submit">Search</Button></form></PageIntro><section id="help-topics" className="vs-section"><div className="page-container"><SectionHeading eyebrow="Here to help" title="What can we help you with?" description="Browse a topic or head straight to your account for help with a specific reservation."/><div className="vs-help-grid">{filteredTopics.map(topic=><article className="vs-help-card" key={topic.title}><span className="vs-icon"><topic.icon size={22}/></span><h3>{topic.title}</h3><p>{topic.description}</p><a href="#support-faq" className="vs-text-link">Read FAQs <ArrowRight size={16}/></a></article>)}</div>{filteredTopics.length===0&&<div className="vs-empty"><h3>No matching help topic</h3><p>Try another search term or sign in to contact support.</p></div>}</div></section><section className="vs-section vs-white"><div className="page-container"><SectionHeading eyebrow="The right place to start" title="Let’s point you in the right direction."/><div className="vs-help-grid">{[[Phone,'Facility Contacts','Location, opening hours and contact details published by your facility.','View Facilities','/facilities'],[MessageCircle,'Customer Support','Sign in to create and follow a support request about your rental.','Create Support Request','/portal/support'],[BookOpen,'Self-Service Guides','Understand the steps from choosing your storage to arranging handover.','Browse Guides','/how-it-works']].map(([Icon,title,text,label,to])=><article className="vs-help-card" key={title}><span className="vs-icon"><Icon size={22}/></span><h3>{title}</h3><p>{text}</p><Link className="vs-text-link" to={to}>{label}<ArrowRight size={16}/></Link></article>)}</div></div></section><section id="support-faq" className="vs-section"><div className="page-container vs-faq"><div><p className="vs-eyebrow">Useful answers</p><h2>Good questions.<br/>A clearer next step.</h2><p className="vs-description">For account-specific help, sign in so your request can be linked to your rental.</p><Link className="vs-text-link mt-6" to="/portal/support">Sign in to contact support <ArrowRight size={16}/></Link></div><div>{faqs.map(([question,answer],i)=><article className="border-b border-[#dfe6dc] py-5" key={question}><button type="button" className="flex w-full items-center justify-between gap-5 text-left text-sm font-semibold" aria-expanded={openFaq===i} aria-controls={'support-answer-'+i} onClick={()=>setOpenFaq(openFaq===i?-1:i)}>{question}<ChevronDown size={18} className={openFaq===i?'rotate-180':''}/></button>{openFaq===i&&<p id={'support-answer-'+i} className="mt-4 text-sm leading-7 text-[#637267]">{answer}</p>}</article>)}</div></div></section><PublicCTA/></>;
}
