import { Link, Outlet } from "react-router-dom";
import { Clock3, MapPin, Phone, ShieldCheck } from "lucide-react";
import Brand from "@/components/common/Brand";
import PublicHeader from "@/components/common/PublicHeader";
import ClickSpark from "@/components/reactbits/ClickSpark";
import ScrollProgress from "@/components/reactbits/ScrollProgress";
const groups=[
 {title:"Storage",links:[["Personal storage","/facilities"],["Business storage","/facilities"],["Storage sizes","/pricing"]]},
 {title:"Explore",links:[["Facilities","/facilities"],["How it works","/how-it-works"],["Pricing","/pricing"],["Help center","/support"]]},
 {title:"Locations",links:[["District 1","/facilities"],["District 7","/facilities"],["Thu Duc City","/facilities"],["Tan Binh","/facilities"]]},
];
export default function PublicLayout(){return <div className="min-h-screen bg-[#FAFAF7] text-[#1F2A22]"><ScrollProgress/><ClickSpark/><PublicHeader/><main><Outlet/></main><footer className="bg-[#173D28] text-white"><div className="page-container py-14"><div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]"><div><Link to="/"><Brand light/></Link><p className="mt-5 max-w-sm text-sm leading-6 text-white/65">Clean, secure and flexible self-storage for homes and businesses across Ho Chi Minh City.</p><a href="tel:02877700117" className="mt-5 inline-flex items-center gap-2 font-bold text-[#F6A94F]"><Phone size={16}/>028 7770 0117</a></div>{groups.map(g=><div key={g.title}><h3 className="text-xs font-bold uppercase tracking-[.12em] text-[#F6A94F]">{g.title}</h3><div className="mt-4 flex flex-col gap-3">{g.links.map(([x,to])=><Link key={x} to={to} className="text-sm text-white/65 transition hover:text-white">{x}</Link>)}</div></div>)}</div><div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs text-white/55 md:flex-row md:items-center md:justify-between"><p>© 2026 VaultSpace Self-Storage Vietnam.</p><div className="flex flex-wrap gap-5"><span className="flex items-center gap-1.5"><Clock3 size={13}/>24/7 monitored</span><span className="flex items-center gap-1.5"><ShieldCheck size={13}/>Secure facilities</span><span className="flex items-center gap-1.5"><MapPin size={13}/>Ho Chi Minh City</span></div></div></div></footer></div>}
