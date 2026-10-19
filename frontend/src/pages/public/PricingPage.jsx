import {PublicLoadState as LoadState} from '@/components/public/PublicSiteUI';
import {PageIntro,PublicCTA,RateCard,SectionHeading,ServiceCards} from '@/components/public/PublicSiteUI';
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import facilityApi from '@/api/facilityApi';
import {useReservation} from '@/contexts/ReservationContext';
import {useBackend,rows,responseData,recordId,validId} from '@/components/customer/RentalBackendUI';
import {
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  Clock3,
  MapPin,
  ShieldCheck,
  Warehouse,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const plans = [
  {
    icon: Box,
    name: "Smart Locker",
    size: "XS – L",
    description: "For luggage, parcels, documents and smaller belongings.",
    features: ["Digital access", "24/7 CCTV", "Flexible rental"],
  },
  {
    icon: Warehouse,
    name: "Private Vault",
    size: "3 – 9 m²",
    popular: true,
    description: "Private storage for homes, moving and business inventory.",
    features: ["Private room", "PIN access", "Elevator access"],
  },
];

const faqs = [
  [
    "Are there hidden booking fees?",
    "Mandatory charges are displayed before reservation confirmation so you can review the full amount before proceeding.",
  ],
  [
    "Can I switch storage sizes later?",
    "Availability permitting, customers can request a different unit through SelfStorage support or the customer portal.",
  ],
  [
    "How does long-term pricing work?",
    "Long-term rates depend on the selected facility's returned pricing rules. No promotional discount is assumed.",
  ],
];

export default function PricingPage() {
  const [longTerm, setLongTerm] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [query]=useSearchParams(),{rentalDraft}=useReservation();
  const [facilityId,setFacilityId]=useState(query.get('facility')||recordId(rentalDraft.facility)||'');
  const locations=useBackend(config=>facilityApi.publicList(config).then(rows),[],true);
  const rates=useBackend(async config=>{if(!validId(facilityId))return null;const grouped=responseData(await facilityApi.publicPricing(facilityId,config));if(!grouped||typeof grouped!=='object'||Array.isArray(grouped)||(!Object.hasOwn(grouped,'selfStorage')&&!Object.hasOwn(grouped,'managedInventory'))||['selfStorage','managedInventory'].some(key=>Object.hasOwn(grouped,key)&&!Array.isArray(grouped[key])))throw Error('The facility pricing response cannot be displayed safely yet. Its grouped pricing contract requires backend confirmation.');const data=[...(grouped.selfStorage||[]),...(grouped.managedInventory||[])];if(data.some(rule=>typeof rule.price!=='number'||!Number.isFinite(rule.price)||rule.price<0||typeof rule.currency!=='string'||!/^[A-Z]{3}$/.test(rule.currency)||!Number.isInteger(rule.term?.value)||rule.term.value<1||!['DAY','MONTH','YEAR'].includes(rule.term.unit)))throw Error('The facility pricing response cannot be displayed safely yet. Its price, currency and term fields require backend confirmation.');return data;},[facilityId],true);
  const selectedLocation=locations.data?.find(f=>recordId(f)===facilityId);
  const visibleRates=rates.data?.filter(rule=>longTerm?rule.term.unit==='MONTH'&&[6,12].includes(rule.term.value):!(rule.term.unit==='MONTH'&&[6,12].includes(rule.term.value)))||[];

  return <><PageIntro eyebrow="Storage pricing" title="More space. A clearer picture." description="Choose a facility and explore its published rental rates. Find the right storage service for your plans, with no assumed discounts."/><section className="vs-section"><div className="page-container"><div className="vs-pricing-controls"><label>Facility<select aria-label="Pricing facility" className="vs-select" value={facilityId} onChange={e=>setFacilityId(e.target.value)}><option value="">Choose a facility</option>{locations.data?.filter(f=>validId(recordId(f))).map(f=><option key={recordId(f)} value={recordId(f)}>{f.name}</option>)}</select></label><div className="vs-duration" role="group" aria-label="Pricing duration"><button type="button" onClick={()=>setLongTerm(false)} aria-pressed={!longTerm}>Monthly Flexible</button><button type="button" onClick={()=>setLongTerm(true)} aria-pressed={longTerm}>Long Term (6–12 Months)</button></div></div><LoadState resource={locations}/><SectionHeading eyebrow={selectedLocation?.name||'Published facility pricing'} title="Find a rate that fits your plans." description="Select a facility to see the rates available for your rental period."/><LoadState resource={rates}/>{!facilityId&&<div className="vs-empty"><h3>Start with a facility</h3><p>Choose a facility to view its published rates.</p><Link className="vs-text-link mt-5" to="/facilities">Explore locations <ArrowRight size={16}/></Link></div>}{rates.data&&<><div className="vs-rates-grid">{visibleRates.map((rule,i)=><RateCard key={recordId(rule)||i} rule={rule}/>)}</div>{!visibleRates.length&&<div className="vs-empty">No {longTerm?'6–12 month':'monthly'} rates returned for this facility.</div>}<p className="vs-data-note">Returned rule prices are shown for their exact term; deposits and total booking amounts require confirmed policies.</p></>}</div></section><section className="vs-section vs-white"><div className="page-container"><SectionHeading eyebrow="Two ways to store" title="Choose the service, then the space." description="A private storage unit or facility-managed inventory: compare how each service works."/><ServiceCards facilityId={facilityId}/></div></section><section className="vs-section"><div className="page-container vs-faq"><div><p className="vs-eyebrow">A little more clarity</p><h2>Questions about pricing?</h2><p className="vs-description">Review your quote and contract before you commit to a rental.</p><Link className="vs-text-link mt-6" to="/support">Visit our help center <ArrowRight size={16}/></Link></div><div>{faqs.map(([question,answer],i)=><article className="border-b border-[#dfe6dc] py-5" key={question}><button type="button" className="flex w-full items-center justify-between gap-5 text-left text-sm font-semibold" aria-expanded={openFaq===i} aria-controls={'pricing-answer-'+i} onClick={()=>setOpenFaq(openFaq===i?-1:i)}>{question}<ChevronDown size={18} className={openFaq===i?'rotate-180':''}/></button>{openFaq===i&&<p id={'pricing-answer-'+i} className="mt-4 text-sm leading-7 text-[#637267]">{answer}</p>}</article>)}</div></div></section><PublicCTA/></>;
}
