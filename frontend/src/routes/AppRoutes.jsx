import {lazy, Suspense} from 'react';
import { Navigate, Route, Routes } from "react-router-dom";
import PublicLayout from "@/layouts/PublicLayout";
import AuthLayout from "@/layouts/AuthLayout";
import CustomerLayout from "@/layouts/CustomerLayout";
import CustomerGate from '@/components/customer/CustomerGate';
import HomePage from "@/pages/public/HomePage";
import {PublicFacilityDetail} from '@/components/customer/PublicFacilityCatalog';
import FacilitiesPage from "@/pages/public/FacilitiesPage";
import HowItWorksPage from "@/pages/public/HowItWorksPage";
import PricingPage from "@/pages/public/PricingPage";
import SupportPublicPage from "@/pages/public/SupportPublicPage";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import MyStoragePage from "@/pages/customer/MyStoragePage";
import MyInventoryPage from "@/pages/customer/MyInventoryPage";
import SupportPage from "@/pages/customer/SupportPage";
import SelectStoragePage from "@/pages/customer/SelectStoragePage";
import RentalPeriodPage from "@/pages/customer/RentalPeriodPage";
import ReviewReservationPage from "@/pages/customer/ReviewReservationPage";
import ReservationStatusPage from "@/pages/customer/ReservationStatusPage";
import ContractPage from "@/pages/customer/ContractPage";
import PaymentPage from "@/pages/customer/PaymentPage";
import HandoverPage from "@/pages/customer/HandoverPage";
import ContractsPage from '@/pages/customer/ContractsPage';
import WarehouseFacilitySelectionPage from '@/pages/customer/WarehouseFacilitySelectionPage';
import WarehouseMapPage, {InteractiveWarehouseRackDetailPage as WarehouseRackDetailPage} from '@/pages/customer/WarehouseMapPage';
import ProfilePage from '@/pages/customer/ProfilePage';
import PaymentHistoryPage from '@/pages/customer/PaymentHistoryPage';
import NotificationsPage from '@/pages/customer/NotificationsPage';
import RentalExtensionPage from '@/pages/customer/RentalExtensionPage';
import RentalAccessPage from '@/pages/customer/RentalAccessPage';
import InventoryRegisterPage from '@/pages/customer/InventoryRegisterPage';
import InventoryDetailPage from '@/pages/customer/InventoryDetailPage';
import InventoryMovementRequestPage from '@/pages/customer/InventoryMovementRequestPage';
import InventoryHistoryPage from '@/pages/customer/InventoryHistoryPage';
import FinancialDetailPage from '@/pages/customer/FinancialDetailPage';
import Placeholder from "@/components/common/Placeholder";
const AdminRoutes = lazy(() => import('@/routes/AdminRoutes'));
const BomRoutes = lazy(() => import('@/routes/BomRoutes'));
const StaffRoutes = lazy(() => import('@/routes/StaffRoutes'));
const ManagerRoutes = lazy(() => import('@/routes/ManagerRoutes'));
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/facilities" element={<FacilitiesPage />} />
        <Route path="/facilities/:facilityId" element={<PublicFacilityDetail />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/support" element={<SupportPublicPage />} />
      </Route>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route path="/portal" element={<CustomerGate><CustomerLayout /></CustomerGate>}>
        <Route index element={<MyStoragePage />} />
        <Route path="inventory" element={<MyInventoryPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="warehouse-map" element={<WarehouseFacilitySelectionPage />} />
        <Route path="warehouse-map/:facilityId" element={<WarehouseMapPage />} />
        <Route path="warehouse-map/:facilityId/racks/:rackId" element={<WarehouseRackDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="rentals/:id/extend" element={<RentalExtensionPage />} />
        <Route path="rentals/:id/access" element={<RentalAccessPage />} />
        <Route path="inventory/register" element={<InventoryRegisterPage />} />
        <Route path="inventory/:id" element={<InventoryDetailPage />} />
        <Route path="inventory/:id/inbound" element={<InventoryMovementRequestPage type="INBOUND" />} />
        <Route path="inventory/:id/outbound" element={<InventoryMovementRequestPage type="OUTBOUND" />} />
        <Route path="inventory/:id/history" element={<InventoryHistoryPage />} />
        <Route path="refunds/:id" element={<FinancialDetailPage kind="refund" />} />
        <Route path="charges/:id" element={<FinancialDetailPage kind="charge" />} />
        <Route path="support" element={<SupportPage />} />
        <Route
          path="contracts"
          element={<ContractsPage />}
        />
        <Route
          path="payments"
          element={<PaymentHistoryPage />}
        />
        <Route path="rent" element={<SelectStoragePage />} />
        <Route path="rent/period" element={<RentalPeriodPage />} />
        <Route path="rent/review" element={<ReviewReservationPage />} />
        <Route path="reservations/:id" element={<ReservationStatusPage />} />
        <Route path="contracts/:reservationId" element={<ContractPage />} />
        <Route path="payments/:reservationId" element={<PaymentPage />} />
        <Route path="handover/:reservationId" element={<HandoverPage />} />
      </Route>
      <Route path="/admin/*" element={<Suspense fallback={<div className="p-8 text-[#176B3A]" role="status">Loading administration workspace…</div>}><AdminRoutes /></Suspense>} />
      <Route path="/bom/*" element={<Suspense fallback={<div className="p-8 text-[#176B3A]" role="status">Loading business workspace…</div>}><BomRoutes /></Suspense>} />
      <Route path="/staff/*" element={<Suspense fallback={<div className="p-8 text-[#176B3A]" role="status">Loading staff workspace…</div>}><StaffRoutes /></Suspense>} />
      <Route path="/manager/*" element={<Suspense fallback={<div className="p-8 text-[#176B3A]" role="status">Loading facility workspace…</div>}><ManagerRoutes /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
