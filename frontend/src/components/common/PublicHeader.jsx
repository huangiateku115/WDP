import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, Phone, X } from "lucide-react";
import Brand from "@/components/common/Brand";
import { Button } from "@/components/ui/button";

const nav = [
  ["Storage", "/"], ["Facilities", "/facilities"], ["How It Works", "/how-it-works"],
  ["Pricing", "/pricing"], ["Support", "/support"],
];
export default function PublicHeader(){
  const [open,setOpen]=useState(false);
  const cls=({isActive})=>`px-3 py-2 text-sm font-semibold transition ${isActive?"text-[#176B3A]":"text-[#425047] hover:text-[#176B3A]"}`;
  return <>
    <div className="bg-[#173D28] text-white"><div className="page-container flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-[11px]">
      <span>Secure self-storage across Ho Chi Minh City</span><Link to="/facilities" className="flex shrink-0 items-center gap-1.5 font-semibold"><Phone size={12}/>Facility contacts</Link>
    </div></div>
    <header className="sticky top-0 z-50 border-b border-[#E5EAE5] bg-white/95 backdrop-blur">
      <div className="page-container flex h-[74px] items-center justify-between gap-5">
        <Link to="/"><Brand/></Link>
        <nav className="hidden items-center gap-1 lg:flex">{nav.map(([label,to])=><NavLink key={to} to={to} className={cls}>{label}</NavLink>)}</nav>
        <div className="flex items-center gap-2">
          <Link to="/login" className="hidden px-3 text-sm font-semibold text-[#425047] sm:block">Sign in</Link>
          <Button asChild className="hidden bg-[#F28C28] px-5 font-bold text-white hover:bg-[#D96F12] sm:inline-flex"><Link to="/facilities">Find a storage</Link></Button>
          <button onClick={()=>setOpen(!open)} className="grid h-10 w-10 place-items-center rounded-lg lg:hidden">{open?<X/>:<Menu/>}</button>
        </div>
      </div>
      {open&&<nav className="page-container flex flex-col border-t py-3 lg:hidden">{nav.map(([label,to])=><NavLink onClick={()=>setOpen(false)} key={to} to={to} className={cls}>{label}</NavLink>)}<Button asChild className="mt-2 bg-[#F28C28] hover:bg-[#D96F12]"><Link to="/facilities">Find a storage</Link></Button></nav>}
    </header>
  </>;
}
