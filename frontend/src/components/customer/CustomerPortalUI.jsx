import {Link} from 'react-router-dom';
import {ChevronRight,House,Inbox,ArrowUpRight,Box,CalendarClock,ClipboardList} from 'lucide-react';
import {Card,CardContent} from '@/components/ui/card';

const sections={storage:'My Units',inventory:'My Inventory',contracts:'Contracts & Sign',payments:'Payments',rent:'Rent a space','warehouse-map':'Warehouse Map',notifications:'Notifications',profile:'My Profile',support:'Support',reservations:'Reservation',rentals:'Rental services',refunds:'Refund detail',charges:'Charge detail',handover:'Handover'};
export function PortalBreadcrumbs({section}){
  return <nav className="portal-breadcrumbs" aria-label="Customer breadcrumbs"><Link to="/portal"><House size={14} aria-hidden="true"/>My workspace</Link><ChevronRight size={13} aria-hidden="true"/><span aria-current="page">{sections[section]||'Customer Portal'}</span><span className="portal-workspace-label">VAULTSPACE · CUSTOMER</span></nav>;
}

// Counts come from the caller's existing Backend response, never from demo data.
export function PortalSummaryCards({items}){
  const icons=[Box,CalendarClock,ClipboardList];
  return <div className="portal-summary-grid" aria-label="Returned reservation summary">{items.map(({label,value},index)=>{const Icon=icons[index%icons.length];return <Card key={label} className="portal-summary-card"><CardContent><div className="portal-summary-label"><span>{label}</span><Icon size={18} aria-hidden="true"/></div><strong>{value}</strong><span className="portal-summary-source">From your returned reservations</span></CardContent></Card>;})}</div>;
}

export function PortalEmptyState({title,description,action}){
  return <Card className="portal-empty-state"><CardContent><span className="portal-empty-icon"><Inbox size={25} aria-hidden="true"/></span><h2>{title}</h2><p>{description}</p>{action&&<div className="mt-4">{action}</div>}</CardContent></Card>;
}

export function PortalTextLink({to,children}){
  return <Link className="portal-text-link" to={to}>{children}<ArrowUpRight size={15} aria-hidden="true"/></Link>;
}
