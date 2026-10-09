import { Router } from 'express';
import * as controller from '../controllers/facilities/facility.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
const manage = requireRole([UserRole.ADMIN, UserRole.BOM]);
router.use(requireAuth);
router.get('/', controller.getFacilities);
router.get('/:id', controller.getFacilityById);
router.delete('/:id', manage, controller.deleteFacility);
router.post('/:id/restore', manage, controller.restoreFacility);
router.post('/', manage, controller.createFacility);
router.patch('/:id', manage, controller.updateFacility);
router.patch('/:id/status', manage, controller.updateFacilityStatus);
export default router;
