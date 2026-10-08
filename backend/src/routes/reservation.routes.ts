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
router.post('/', ReservationController.createReservation);
router.get('/me', ReservationController.getMyReservations);
router.patch('/:id/cancel', ReservationController.cancelReservation);

// Mock Payment API (Cần quyền Customer hoặc Admin)
router.post('/:id/mock-pay', ReservationController.mockPayReservation);

// Facility Manager Routes
const fmRoles = [UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM];
router.get('/facility/:facilityId', requireRole(fmRoles), ReservationController.getReservationsByFacility);
router.get('/:id', requireRole(fmRoles), ReservationController.getReservationById);
router.patch('/:id/approve', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.approveReservation);
router.patch('/:id/reject', requireRole([UserRole.FACILITY_MANAGER, UserRole.ADMIN]), ReservationController.rejectReservation);

export default router;
