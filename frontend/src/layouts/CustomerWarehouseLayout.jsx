import {Link, Outlet} from 'react-router-dom';
import {ArrowLeft} from 'lucide-react';
import Brand from '@/components/common/Brand';
import './experience.css';
import './customer-compact.css';
import './customer-portal.css';
import './customer-ux.css';
import './customer-warehouse.css';

export default function CustomerWarehouseLayout() {
  return <div className="experience-theme customer-portal customer-warehouse-layout">
    <header className="customer-warehouse-header">
      <Link to="/portal" aria-label="VaultSpace portal"><Brand /></Link>
      <span className="customer-warehouse-title">Warehouse workspace</span>
      <Link to="/portal" className="customer-warehouse-back" aria-label="Back to Customer Portal"><ArrowLeft size={16}/>Back to Portal</Link>
    </header>
    <main className="customer-warehouse-main"><Outlet /></main>
  </div>;
}
