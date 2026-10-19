import {PublicLoadState as LoadState} from './PublicSiteUI';
import {Link} from 'react-router-dom';
import {ArrowRight} from 'lucide-react';
import facilityApi from '@/api/facilityApi';
import {useBackend,responseData,recordId,validId} from '@/components/customer/RentalBackendUI';
import {RateCard} from './PublicSiteUI';
export default function HomePricingPreview({facilities,selected}){
 const location=facilities.data?.find(f=>recordId(f)===selected)||facilities.data?.find(f=>validId(recordId(f))),id=recordId(location);
 const resource=useBackend(async config=>{if(!validId(id))return null;const grouped=responseData(await facilityApi.publicPricing(id,config));if(!grouped||!Array.isArray(grouped.selfStorage)||!Array.isArray(grouped.managedInventory))throw Error('Published pricing is unavailable.');const rates=[...grouped.selfStorage,...grouped.managedInventory];if(rates.some(r=>typeof r.price!=='number'||!Number.isFinite(r.price)||r.price<0||typeof r.currency!=='string'||!/^[A-Z]{3}$/.test(r.currency)||!Number.isSafeInteger(r.term?.value)||r.term.value<1||!['DAY','MONTH','YEAR'].includes(r.term.unit)))throw Error('Published pricing cannot be displayed.');return rates.slice(0,2);},[id],true);
 return <section className="vs-section"><div className="page-container vs-pricing-preview"><div><p className="vs-eyebrow">Space that fits your plans</p><h2>The right space.<br/>A clearly stated rate.</h2><p className="vs-description">Compare published rates by facility and rental period. Your final quote confirms the deposit and total before you reserve.</p><p className="vs-data-note">{location?'Showing published rates for '+location.name:'Choose a facility to explore published pricing.'}</p><Link className="vs-text-link" to={id?'/pricing?facility='+id:'/pricing'}>Explore pricing <ArrowRight size={17}/></Link></div><div><LoadState resource={resource}/>{resource.data?.length>0?<div className="vs-rates-grid">{resource.data.map((r,i)=><RateCard key={recordId(r)||i} rule={r}/>)}</div>:!resource.loading&&!resource.error&&<div className="vs-empty">Published rates appear here when a facility makes them available. Browse pricing to select a location.</div>}</div></div></section>;
}
