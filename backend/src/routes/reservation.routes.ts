import { Router } from 'express';
import * as ReservationController from '../controllers/reservations/reservation.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';
import * as ManagedReservationController from '../controllers/reservations/managed-reservation.controller';
import * as ManagedCheckinController from '../controllers/reservations/managed-checkin.controller';
import * as PayosPaymentController from '../controllers/payments/payos-payment.controller';

const router = Router();

// AI cũng gọi được Estimate (có thể đưa ra ngoài requireAuth nếu Public)
router.post('/estimate', ReservationController.estimateRent);

// Yêu cầu đăng nhập
router.use(requireAuth);

// Managed Inventory quota flow has independent validation, capacity locks and lifecycle guards.
router.post('/managed/quote', requireRole([UserRole.CUSTOMER]), ManagedReservationController.quote);
router.post('/managed', requireRole([UserRole.CUSTOMER]), ManagedReservationController.create);
router.get('/managed/capacity/:facilityId', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ManagedReservationController.getCapacity);
router.put('/managed/capacity/:facilityId', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ManagedReservationController.configureCapacity);
router.get('/managed/:id/closure-readiness', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ManagedReservationController.getClosureReadiness);
router.get('/managed/:id', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ManagedReservationController.get);
router.patch('/managed/:id/approve', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ManagedReservationController.approve);
router.patch('/managed/:id/reject', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ManagedReservationController.reject);
router.patch('/managed/:id/cancel', requireRole([UserRole.CUSTOMER]), ManagedReservationController.cancel);
router.post('/managed/:id/deposit', requireRole([UserRole.CUSTOMER]), ManagedReservationController.initiateDeposit);
router.post('/managed/:id/deposit/mock-confirm', requireRole([UserRole.CUSTOMER]), ManagedReservationController.confirmMockDeposit);
router.post('/managed/:id/contract', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedCheckinController.createContract);
router.post('/managed/:id/balance', requireRole([UserRole.CUSTOMER]), ManagedCheckinController.initiateBalance);
router.post('/managed/:id/balance/mock-confirm', requireRole([UserRole.CUSTOMER]), ManagedCheckinController.confirmMockBalance);
router.post('/managed/:id/mock-pay', requireRole([UserRole.CUSTOMER, UserRole.ADMIN, UserRole.BOM]), ManagedReservationController.mockPay);
router.patch('/managed/:id/activate', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ManagedReservationController.activate);
router.post('/managed/:id/handover', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedReservationController.confirmHandover);
router.post('/managed/:id/payments/payos', requireRole([UserRole.CUSTOMER]), PayosPaymentController.createSelfStorageCheckout);
router.get('/managed/:id/payments/payos', requireRole([UserRole.CUSTOMER]), PayosPaymentController.listSelfStoragePayments);
router.post('/managed/:id/payments/:paymentId/reconcile', requireRole([UserRole.CUSTOMER]), PayosPaymentController.reconcileCustomerPayment);
router.get('/managed/:id/payments/:paymentId', requireRole([UserRole.CUSTOMER]), PayosPaymentController.getSelfStoragePaymentStatus);

import { checkSigningSla } from '../jobs/signing-sla-checker.job';

// Signing SLA check endpoint (triggerable by Manager/Admin or cron runner)
router.post('/signing-sla/trigger', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), async (req, res) => {
  try {
    const result = await checkSigningSla();
    return res.json({ success: true, message: `Quét SLA hoàn tất. Đã hủy ${result.processedCount} đơn quá hạn.`, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Customer Routes
router.post('/:id/payments/payos', requireRole([UserRole.CUSTOMER]), PayosPaymentController.createSelfStorageCheckout);
// Keep this literal route before /:paymentId so "payos" is not treated as an ID.
router.get('/:id/payments/payos', requireRole([UserRole.CUSTOMER]), PayosPaymentController.listSelfStoragePayments);
router.post('/:id/payments/:paymentId/reconcile', requireRole([UserRole.CUSTOMER]), PayosPaymentController.reconcileCustomerPayment);
router.get('/:id/payments/payos/orders/:orderCode', requireRole([UserRole.CUSTOMER]), PayosPaymentController.lookupSelfStoragePayosOrder);
router.get('/:id/payments/:paymentId', requireRole([UserRole.CUSTOMER]), PayosPaymentController.getSelfStoragePaymentStatus);
router.post('/', requireRole([UserRole.CUSTOMER]), ReservationController.createReservation);
router.get('/me', requireRole([UserRole.CUSTOMER]), ReservationController.getMyReservations);
router.patch('/:id/cancel', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.cancelReservation);

// Thanh toán Cọc (Deposit)
router.post('/:id/deposit', requireRole([UserRole.CUSTOMER]), ReservationController.initiateDeposit);
router.post('/:id/deposit/mock-confirm', requireRole([UserRole.CUSTOMER]), ReservationController.confirmMockDeposit);

// Thanh toán Số dư còn lại (Balance) - Yêu cầu hợp đồng giấy đã được Staff tải ảnh bằng chứng
router.post('/:id/balance', requireRole([UserRole.CUSTOMER]), ReservationController.initiateBalance);
router.post('/:id/balance/mock-confirm', requireRole([UserRole.CUSTOMER]), ReservationController.confirmMockBalance);

// Staff Bàn giao & Kích hoạt kho (Handover)
router.post('/:id/handover', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.handoverReservation);

// Mock Payment API (100% full payment simulation for local testing)
router.post('/:id/mock-pay', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.mockPayReservation);
router.post('/:id/mock-pay-full', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.mockPayReservation);

// Phase 5: Checkout & Renew Routes
const staffAndFmRoles = [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM];
router.get('/checkout-queue', requireRole(staffAndFmRoles), ReservationController.getCheckoutQueue);
router.post('/:id/checkout-request', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.requestCheckout);
router.post('/:id/complete-checkout', requireRole(staffAndFmRoles), ReservationController.completeCheckout);
router.post('/:id/reject-checkout', requireRole(staffAndFmRoles), ReservationController.rejectCheckout);
router.post('/:id/renew-quote', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.renewQuote);
router.post('/:id/renew', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.renewReservation);

// View Reservation Detail (Customer xem đơn của mình, Staff/Admin/BOM xem toàn bộ)
router.get('/:id', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ReservationController.getReservationById);

// Facility Staff & Manager Routes
router.get('/facility/:facilityId', requireRole(staffAndFmRoles), ReservationController.getReservationsByFacility);
router.patch('/:id/approve', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.approveReservation);
router.patch('/:id/reject', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.rejectReservation);

export default router;
