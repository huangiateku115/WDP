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

// ADMIN ROUTES (Yêu cầu quyền ADMIN)
router.use(requireRole([UserRole.ADMIN]));
router.post('/', UserController.adminCreateUser);
router.get('/', UserController.adminGetUsers);
router.put('/:id', UserController.adminUpdateUser);
router.patch('/:id/role', UserController.adminUpdateRole);
router.delete('/:id', UserController.adminSoftDelete);

export default router;
