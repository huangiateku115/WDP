import { Router } from 'express';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';
import * as controller from '../controllers/inventory-items/managed-outbound-request.controller';

const router = Router();
// Keep the static queue route ahead of the requestId matcher.
router.get('/staff-queue', requireAuth, requireRole([UserRole.FACILITY_STAFF]), controller.staffQueue);
router.get('/:requestId/staff-detail', requireAuth, requireRole([UserRole.FACILITY_STAFF]), controller.staffDetail);
router.get('/:requestId', requireAuth, requireRole([UserRole.CUSTOMER]), controller.get);
router.post('/:requestId/cancel', requireAuth, requireRole([UserRole.CUSTOMER]), controller.cancel);
router.post('/:requestId/confirm', requireAuth, requireRole([UserRole.FACILITY_STAFF]), controller.confirm);
export default router;
