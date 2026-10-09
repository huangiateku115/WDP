import { Router } from 'express';
import * as controller from '../controllers/storage-units/storage-unit.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
const manage = requireRole([UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER]);
router.post('/facilities/:facilityId/storage-units', requireAuth, manage, controller.createStorageUnit);
router.get('/facilities/:facilityId/storage-units', requireAuth, controller.getStorageUnits);
router.get('/storage-units/:id', requireAuth, controller.getStorageUnitById);
router.patch('/storage-units/:id', requireAuth, manage, controller.updateStorageUnit);
router.patch('/storage-units/:id/status', requireAuth, manage, controller.updateStorageUnitStatus);
router.delete('/storage-units/:id', requireAuth, manage, controller.deleteStorageUnit);
router.post('/storage-units/:id/restore', requireAuth, manage, controller.restoreStorageUnit);
export default router;
