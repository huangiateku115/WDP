import CustomerUserMenu from '@/components/customer/CustomerUserMenu';
import {useAuthSession} from '@/lib/authSession';
import ExperienceContent from '@/components/common/ExperienceContent';
import './experience.css';
import './customer-compact.css';
import './customer-portal.css';
import './customer-ux.css';
import {PortalBreadcrumbs} from '@/components/customer/CustomerPortalUI';
import {Outlet,NavLink,Link,useLocation} from 'react-router-dom';import {Box,FileSignature,CreditCard,PlusCircle,LifeBuoy,Globe,UserCircle,PackageOpen,Bell,Map} from 'lucide-react';import Brand from '@/components/common/Brand';
const nav=[['/portal',Box,'Kho của tôi'],['/portal/rent',PlusCircle,'Thuê kho'],['/portal/warehouse-map',Map,'Sơ đồ kho'],['/portal/inventory',PackageOpen,'Hàng hóa của tôi'],['/portal/contracts',FileSignature,'Hợp đồng'],['/portal/payments',CreditCard,'Thanh toán'],['/portal/terms',FileSignature,'Điều khoản'],['/portal/notifications',Bell,'Thông báo'],['/portal/support',LifeBuoy,'Hỗ trợ'],['/portal/profile',UserCircle,'Hồ sơ']];
export default function CustomerLayout(){const {user}=useAuthSession(),{pathname}=useLocation(),section=pathname.split('/')[2]||'storage';return <div className="experience-theme customer-portal min-h-screen portal-bg"><div className="w-full"><header className="portal-topbar flex h-16 items-center justify-between border-b bg-white px-5 md:px-8"><Link to="/portal" aria-label="VaultSpace - Trang khách hàng"><Brand /></Link><div className="flex items-center gap-3"><span className="hidden text-sm sm:inline" aria-label="Ngôn ngữ: Tiếng Việt"><Globe size={16} className="inline"/> VI</span><CustomerUserMenu user={user}/></div></header><nav aria-label="Điều hướng khách hàng" className="portal-navigation">{nav.map(([to,I,l])=><NavLink key={to} to={to} end={to === "/portal"} onFocus={event=>event.currentTarget.scrollIntoView({block:'nearest',inline:'nearest'})}><I size={16}/>{l}</NavLink>)}</nav><main className="portal-page" data-portal-section={section}><PortalBreadcrumbs section={section}/><ExperienceContent><Outlet/></ExperienceContent></main></div></div>}


