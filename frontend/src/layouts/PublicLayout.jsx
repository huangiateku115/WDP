import {Link,Outlet} from 'react-router-dom';
import {ArrowUpRight} from 'lucide-react';
import Brand from '@/components/common/Brand';
import PublicHeader from '@/components/common/PublicHeader';
import ClickSpark from '@/components/reactbits/ClickSpark';
import ScrollProgress from '@/components/reactbits/ScrollProgress';
import './public-site.css';
const groups=[{title:'Find your space',links:[['Self Storage','/facilities'],['Managed Inventory','/facilities'],['Published pricing','/pricing']]},{title:'Explore VaultSpace',links:[['Our facilities','/facilities'],['How it works','/how-it-works'],['Help & support','/support']]},{title:'Your account',links:[['Customer sign in','/login'],['Create an account','/register'],['Customer portal','/portal']]}];
export default function PublicLayout(){return <div className="vs-public min-h-screen"><ScrollProgress/><ClickSpark/><PublicHeader/><main id="public-main" tabIndex={-1}><Outlet/></main><footer className="vs-footer"><div className="page-container"><div className="vs-footer-grid"><div><Link to="/" aria-label="VaultSpace home"><Brand/></Link><p>More room for life. More space for business. Find self-storage and managed inventory storage that fits your next chapter.</p><Link className="vs-text-link mt-5" to="/facilities">Find your facility <ArrowUpRight size={16}/></Link></div>{groups.map(g=><div key={g.title}><h3>{g.title}</h3><nav aria-label={g.title}>{g.links.map(([label,to])=><Link key={label} to={to}>{label}</Link>)}</nav></div>)}</div><div className="vs-footer-bottom"><p>© 2026 VaultSpace · Self Storage Vietnam</p><span>Facility contact details and hours are published on each location page.</span></div></div></footer></div>}
