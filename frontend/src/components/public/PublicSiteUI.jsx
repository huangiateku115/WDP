import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowDownRight,ArrowRight,Box,Boxes,MapPin,Warehouse} from 'lucide-react';
import {Button} from '@/components/ui/button';
import FadeContent from '@/components/reactbits/FadeContent';
import {addressText,recordId,validId} from '@/components/customer/RentalBackendUI';

// Existing project photography; no imagery or assets from the reference template.
export const publicPhotos={warehouse:'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1400&q=85',inventory:'https://images.unsplash.com/photo-1565793298595-6a879b1d9492?auto=format&fit=crop&w=1200&q=85'};
export const serviceName=value=>({SELF_STORAGE:'Self Storage',MANAGED_INVENTORY:'Managed Inventory'}[value]||value);
export function PublicLoadState({resource}){
  return <div className="vs-load" aria-live="polite">{resource.loading&&<p role="status" className="vs-data-note">Loading published information…</p>}{resource.error&&<div role="alert" className="vs-empty"><h3>We couldn’t load this information.</h3><p>Please try again. No sample locations or prices are shown.</p><Button variant="outline" className="mt-4" onClick={resource.retry}>Retry</Button></div>}</div>;
}
export function PublicImage({src,alt,className='',eager=false}){
  const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
  const safe=typeof src==='string'&&/^https?:\/\//i.test(src);
  return <div className={`vs-image ${className}`}>{safe&&!failed?<img src={src} alt={alt} loading={eager?'eager':'lazy'} fetchPriority={eager?'high':'auto'} onError={()=>setFailed(true)}/>:<div className="vs-photo-placeholder"><Warehouse size={44} strokeWidth={1}/><span>Facility photograph not available</span></div>}</div>;
}
export function SectionHeading({eyebrow,title,description,children}){
  return <div className="vs-section-heading"><div><p className="vs-eyebrow">{eyebrow}</p><h2>{title}</h2>{description&&<p className="vs-description">{description}</p>}</div>{children}</div>;
}
export function PageIntro({eyebrow,title,description,children}){
  return <section className="vs-page-intro"><div className="page-container"><p className="vs-breadcrumb"><Link to="/">Home</Link><span>/</span>{eyebrow}</p><FadeContent blur={false}><p className="vs-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="vs-description">{description}</p>{children}</FadeContent></div><ArrowDownRight className="vs-intro-arrow" aria-hidden="true" strokeWidth={.7}/></section>;
}
export function FacilityCard({facility}){
  return <article className="vs-facility-card"><PublicImage src={facility.images?.[0]} alt={facility.name}/><div className="vs-facility-body"><p className="vs-eyebrow">{facility.address?.city||'Explore a location'}</p><h3>{facility.name}</h3><p className="vs-address"><MapPin size={17}/>{addressText(facility.address)||'See facility for location details'}</p><div className="vs-service-tags">{facility.serviceTypes?.map(s=><span key={s}>{serviceName(s)}</span>)}</div>{validId(recordId(facility))&&<Link className="vs-text-link" to={`/facilities/${recordId(facility)}`}>View facility <ArrowRight size={18}/></Link>}</div></article>;
}
export function RateCard({rule}){
  if(typeof rule.price!=='number'||!Number.isFinite(rule.price)||rule.price<0)return <article className="vs-rate-card"><p>Price unavailable</p></article>;
  return <article className="vs-rate-card"><span className="vs-icon">{rule.serviceType==='MANAGED_INVENTORY'?<Boxes size={22}/>:<Box size={22}/>}</span><p className="vs-eyebrow">{serviceName(rule.serviceType)}{rule.unitSize?` · ${rule.unitSize}`:''}</p><p className="vs-rate">{new Intl.NumberFormat('vi-VN').format(rule.price)} <span>{rule.currency}</span></p><p className="vs-rate-term">Per {rule.term?.value} {rule.term?.unit?.toLowerCase()}{rule.term?.value===1?'':'s'}{rule.serviceType==='MANAGED_INVENTORY'?' · per m³':''}</p><span className="vs-rate-note">Published facility rate</span></article>;
}
export function ServiceCards({facilityId}){
  const services=[{icon:Box,title:'Self-Storage Units',label:'Your space. Your belongings.',text:'A private unit for furniture, household belongings and business essentials. Choose from the sizes published by your facility.',items:['Choose a unit and rental period','Review your contract online','Arrange handover with the facility'],photo:publicPhotos.warehouse},{icon:Boxes,title:'Managed Inventory Storage',label:'Your inventory. In capable hands.',text:'Dedicated warehouse Cells for registered inventory, with receiving and retrieval handled by the facility team.',items:['Reserve capacity in selected Cells','Register and follow your inventory','Request inbound and outbound handling'],photo:publicPhotos.inventory}];
  return <div className="vs-service-grid">{services.map((s,i)=><FadeContent key={s.title} delay={i*90} blur={false}><article className="vs-service-card"><PublicImage src={s.photo} alt={i?'Warehouse inventory storage':'Storage facility interior'}/><div className="vs-service-content"><span className="vs-icon"><s.icon size={24}/></span><p className="vs-eyebrow">{s.label}</p><h3>{s.title}</h3><p>{s.text}</p><ul>{s.items.map(x=><li key={x}><span aria-hidden="true">↗</span>{x}</li>)}</ul><Button asChild className="vs-button"><Link to={validId(facilityId)?`/portal/rent?facility=${facilityId}`:'/facilities'}>{facilityId?'Check Availability':'Explore facilities'}<ArrowRight size={17}/></Link></Button></div></article></FadeContent>)}</div>;
}
export function PublicCTA(){return <section className="page-container vs-cta-section"><div className="vs-cta"><div><p className="vs-eyebrow">A fresh start, with more space</p><h2>Make room for<br/>what matters.</h2><p>Find a place for your belongings, or a new home for your business inventory.</p></div><div className="vs-cta-actions"><Button asChild className="vs-button vs-button-orange" size="lg"><Link to="/facilities">Find Storage<ArrowRight size={18}/></Link></Button><Link to="/support">Need a hand? Let’s talk <ArrowRight size={16}/></Link></div><Box className="vs-cta-art" aria-hidden="true" strokeWidth={.5}/></div></section>;}
