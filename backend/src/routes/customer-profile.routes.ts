import { Router } from 'express';
import * as CustomerProfileController from '../controllers/users/customer-profile.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();

// Bắt buộc đăng nhập
router.use(requireAuth);

// Khách hàng tự quản lý Profile
router.get('/me/profile', requireRole([UserRole.CUSTOMER]), CustomerProfileController.getMyProfile);
router.put('/me/profile', requireRole([UserRole.CUSTOMER]), CustomerProfileController.updateMyProfile);

// Nhân viên/Quản lý duyệt Profile khách
router.use(requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM]));
router.get('/', CustomerProfileController.getCustomers);
router.get('/:id', CustomerProfileController.getCustomerById);
router.patch('/:id/verify', CustomerProfileController.verifyProfile);

export default router;
