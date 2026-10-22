import {Outlet} from 'react-router-dom';
import './experience.css';
import './customer-compact.css';
import './customer-portal.css';
import './customer-ux.css';
import './customer-warehouse.css';

export default function CustomerWarehouseLayout() {
  return <div className="experience-theme customer-portal customer-warehouse-layout">
    <main className="customer-warehouse-main"><Outlet /></main>
  </div>;
}
