import { Router } from 'express';
import * as ReservationController from '../controllers/reservations/reservation.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();

// AI cũng gọi được Estimate (có thể đưa ra ngoài requireAuth nếu Public)
router.post('/estimate', ReservationController.estimateRent);

// Yêu cầu đăng nhập
router.use(requireAuth);

// Customer Routes
router.post('/', requireRole([UserRole.CUSTOMER]), ReservationController.createReservation);
router.get('/me', requireRole([UserRole.CUSTOMER]), ReservationController.getMyReservations);
router.patch('/:id/cancel', requireRole([UserRole.CUSTOMER]), ReservationController.cancelReservation);

// Mock Payment API (Cần quyền Customer hoặc Admin / FM)
router.post('/:id/mock-pay', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.mockPayReservation);

// View Reservation Detail (Customer xem đơn của mình, Staff/Admin/BOM xem toàn bộ)
router.get('/:id', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]), ReservationController.getReservationById);

// Facility Manager Routes
const fmRoles = [UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM];
router.get('/facility/:facilityId', requireRole(fmRoles), ReservationController.getReservationsByFacility);
router.patch('/:id/approve', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.approveReservation);
router.patch('/:id/reject', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.rejectReservation);

export default router;
