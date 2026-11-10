import {Link} from 'react-router-dom';
import {ChevronRight,House,Inbox,ArrowUpRight,Box,CalendarClock,ClipboardList} from 'lucide-react';
import {Card,CardContent} from '@/components/ui/card';

const sections={storage:'Kho của tôi',inventory:'Hàng hóa của tôi',contracts:'Hợp đồng',payments:'Thanh toán',rent:'Thuê kho','warehouse-map':'Sơ đồ kho',notifications:'Thông báo',profile:'Hồ sơ cá nhân',support:'Hỗ trợ',reservations:'Đơn thuê',rentals:'Dịch vụ thuê kho',refunds:'Chi tiết hoàn tiền',charges:'Chi tiết khoản thu',handover:'Bàn giao'};
export function PortalBreadcrumbs({section}){
  return <nav className="portal-breadcrumbs" aria-label="Điều hướng đường dẫn"><Link to="/portal"><House size={14} aria-hidden="true"/>Không gian của tôi</Link><ChevronRight size={13} aria-hidden="true"/><span aria-current="page">{sections[section]||'Cổng khách hàng'}</span><span className="portal-workspace-label">VAULTSPACE · KHÁCH HÀNG</span></nav>;
}

// Counts come from the caller's existing Backend response, never from demo data.
export function PortalSummaryCards({items}){
  const icons=[Box,CalendarClock,ClipboardList];
  return <div className="portal-summary-grid" aria-label="Tóm tắt đơn thuê">{items.map(({label,value},index)=>{const Icon=icons[index%icons.length];return <Card key={label} className="portal-summary-card"><CardContent><div className="portal-summary-label"><span>{label}</span><Icon size={18} aria-hidden="true"/></div><strong>{value}</strong><span className="portal-summary-source">Theo dữ liệu đơn thuê</span></CardContent></Card>;})}</div>;
}

export function PortalEmptyState({title,description,action}){
  return <Card className="portal-empty-state"><CardContent><span className="portal-empty-icon"><Inbox size={25} aria-hidden="true"/></span><h2>{title}</h2><p>{description}</p>{action&&<div className="mt-4">{action}</div>}</CardContent></Card>;
}

export function PortalTextLink({to,children}){
  return <Link className="portal-text-link" to={to}>{children}<ArrowUpRight size={15} aria-hidden="true"/></Link>;
}
