import { Router } from 'express';
import * as AccessController from '../controllers/access/access.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
router.use(requireAuth);

router.post('/simulate-unlock', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), AccessController.simulateUnlock);
router.get('/me', requireRole([UserRole.CUSTOMER]), AccessController.getMyAccessLogs);

export default router;
