import FacilityWarehouseMapPage from '@/pages/staff/FacilityWarehouseMapPage';
import MovementHistoryPage from '@/pages/staff/MovementHistoryPage';
import FacilityBoardPage from '@/pages/staff/FacilityBoardPage';
import FacilityAccessPage from '@/pages/staff/FacilityAccessPage';
import FacilityOperationsPage from '@/pages/staff/FacilityOperationsPage';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import ManagedReceivingQueue from '@/pages/staff/ManagedReceivingQueue';
import StockBalancePage from '@/pages/staff/StockBalancePage';
import StaffLayout from '@/layouts/StaffLayout';
import { StaffUnavailable } from '@/components/staff/StaffUI';
import { DashboardPage, TasksPage, OperationsPage, RefundsPage } from '@/pages/staff/StaffPages';
import CustomersPage from '@/pages/manager/CustomersPage';
import ReservationsPage from '@/pages/manager/ReservationsPage';
import { useStaffData, operator } from '@/lib/staffDemoStore';
import RepeatedInboundQueuePage from '@/pages/staff/RepeatedInboundQueuePage';
import CanonicalOutboundQueuePage from '@/pages/staff/CanonicalOutboundQueuePage';
import CanonicalRelocationPage from '@/pages/staff/CanonicalRelocationPage';
function ReviewPage({ kind }) { const actor = operator(useStaffData()); const Page = kind === 'customers' ? CustomersPage : ReservationsPage; return <Page key={actor?.id} workspace="staff" actor={actor || { id: null }} />; }
const operations = [['check-ins', 'CHECK_IN'], ['handovers', 'HANDOVER'], ['inspections', 'INSPECTION'], ['checkouts', 'CHECKOUT'], ['support', 'SUPPORT'], ['maintenance', 'MAINTENANCE']];
function InboundQueue(){const [params]=useSearchParams();return params.get('flow')==='managed-v2'?<ManagedReceivingQueue/>:<RepeatedInboundQueuePage/>;}
export default function StaffRoutes() { return <Routes><Route element={<StaffLayout />}><Route index element={<Navigate to="dashboard" replace />} /><Route path="facility-operations" element={<Navigate to="/staff/dashboard" replace />} /><Route path="warehouse-map" element={<FacilityWarehouseMapPage />} /><Route path="dashboard" element={<DashboardPage />} /><Route path="customers" element={<ReviewPage kind="customers" />} /><Route path="customers/:id" element={<ReviewPage kind="customers" />} /><Route path="reservations" element={<ReviewPage kind="reservations" />} /><Route path="reservations/:id" element={<ReviewPage kind="reservations" />} /><Route path="tasks" element={<FacilityBoardPage />} /><Route path="access" element={<FacilityAccessPage />} /><Route path="tasks/:id" element={<Navigate to="/staff/tasks" replace />} />{operations.flatMap(([path, type]) => [<Route key={path} path={path} element={<OperationsPage type={type} />} />, <Route key={path + '/detail'} path={path + '/:id'} element={<OperationsPage type={type} />} />])}<Route path="inventory/inbound" element={<InboundQueue />} /><Route path="inventory/inbound/:id" element={<ManagedReceivingQueue />} /><Route path="inventory/outbound" element={<CanonicalOutboundQueuePage />} /><Route path="inventory/relocation" element={<CanonicalRelocationPage />} /><Route path="inventory/stock" element={<StockBalancePage />} /><Route path="inventory/history" element={<MovementHistoryPage />} /><Route path="inventory/items/:id/history" element={<MovementHistoryPage />} /><Route path="refunds" element={<RefundsPage />} /><Route path="refunds/:id" element={<RefundsPage />} /><Route path="*" element={<StaffUnavailable title="Staff page unavailable" />} /></Route></Routes>; }
