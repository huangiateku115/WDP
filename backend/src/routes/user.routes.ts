import { Router } from 'express';
import * as UserController from '../controllers/users/user.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();

// PUBLIC ROUTES
router.post('/register', UserController.registerCustomer);

// USER ROUTES (Yêu cầu đăng nhập)
router.use(requireAuth);
router.get('/me', UserController.getMe);
router.put('/me/profile', UserController.updateMyProfile);
router.put('/me/password', UserController.changeMyPassword);

// Facility assignment management is available to administrators and facility managers.
const assignmentManagers = requireRole([UserRole.ADMIN, UserRole.FACILITY_MANAGER]);
router.patch('/:userId/facility-assignment', assignmentManagers, UserController.assignFacility);
router.delete('/:userId/facility-assignment', assignmentManagers, UserController.unassignFacility);

// ADMIN ROUTES (Yêu cầu quyền ADMIN)
router.use(requireRole([UserRole.ADMIN]));
router.post('/', UserController.adminCreateUser);
router.get('/', UserController.adminGetUsers);
router.put('/:id', UserController.adminUpdateUser);
router.patch('/:id/role', UserController.adminUpdateRole);
router.delete('/:id', UserController.adminSoftDelete);
router.patch('/:id/reactivate', UserController.adminReactivateUser);

export default router;
