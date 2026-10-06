import {Routes,Route,Navigate} from 'react-router-dom';
import AdminLayout from '@/layouts/AdminLayout';
import UsersPage from '@/pages/admin/UsersPage';
import {DashboardPage,LoginHistoryPage,AuditPage,FacilitiesPage} from '@/pages/admin/SystemPages';
import {Panel,OpenLink} from '@/components/manager/ManagerUI';
export default function AdminRoutes(){return <Routes><Route element={<AdminLayout/>}><Route index element={<Navigate to="dashboard" replace/>}/><Route path="dashboard" element={<DashboardPage/>}/><Route path="users" element={<UsersPage key="directory"/>}/><Route path="users/new" element={<UsersPage key="create" create/>}/><Route path="users/:id" element={<UsersPage key="detail"/>}/><Route path="login-history" element={<LoginHistoryPage/>}/><Route path="audit" element={<AuditPage/>}/><Route path="audit/:id" element={<AuditPage/>}/><Route path="facilities" element={<FacilitiesPage/>}/><Route path="*" element={<Panel title="Admin page unavailable"><OpenLink to="/admin/dashboard">Back to dashboard</OpenLink></Panel>}/></Route></Routes>;}
