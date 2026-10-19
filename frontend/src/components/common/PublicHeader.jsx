import {useEffect,useRef,useState} from 'react';
import {Link,NavLink,useLocation} from 'react-router-dom';
import {ArrowUpRight,Menu,MapPin,X} from 'lucide-react';
import Brand from '@/components/common/Brand';
import {Button} from '@/components/ui/button';
const nav=[['Home','/'],['Facilities','/facilities'],['How It Works','/how-it-works'],['Pricing','/pricing'],['Support','/support']];
export default function PublicHeader(){
 const [open,setOpen]=useState(false),location=useLocation(),toggle=useRef(null),header=useRef(null);
 useEffect(()=>setOpen(false),[location.pathname]);
 useEffect(()=>{if(!open)return;const outside=e=>{if(!header.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 const closeWithEscape=e=>{if(e.key==='Escape'&&open){setOpen(false);toggle.current?.focus();}};
 return <><a className="vs-skip" href="#public-main">Skip to content</a><div className="vs-topline"><div className="page-container"><span>A little more space. A lot more possibility.</span><Link to="/facilities"><MapPin size={12}/>Explore our facilities <ArrowUpRight size={12}/></Link></div></div><header className="vs-header" ref={header} onKeyDown={closeWithEscape}><div className="page-container vs-header-inner"><Link to="/" aria-label="VaultSpace home"><Brand/></Link><nav className="vs-desktop-nav" aria-label="Main navigation">{nav.map(([label,to])=><NavLink end={to==='/'} key={to} to={to} className="vs-nav-link">{label}</NavLink>)}</nav><div className="vs-header-actions"><Link className="vs-signin" to="/login">Sign in</Link><Button asChild className="vs-button vs-button-orange"><Link to="/facilities">Find Storage <ArrowUpRight size={16}/></Link></Button><button ref={toggle} type="button" className="vs-menu-toggle" aria-label={open?'Close navigation menu':'Open navigation menu'} aria-expanded={open} aria-controls="public-mobile-menu" onClick={()=>setOpen(v=>!v)}>{open?<X size={22}/>:<Menu size={22}/>}</button></div></div><nav id="public-mobile-menu" hidden={!open} className="page-container vs-mobile-nav" aria-label="Mobile navigation">{nav.map(([label,to])=><NavLink end={to==='/'} key={to} to={to} onClick={()=>setOpen(false)} className="vs-nav-link">{label}</NavLink>)}<Button asChild className="vs-button vs-button-orange"><Link to="/facilities" onClick={()=>setOpen(false)}>Find Storage <ArrowUpRight size={16}/></Link></Button></nav></header></>;
}
