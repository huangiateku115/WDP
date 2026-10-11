import { Router } from 'express';
import * as controller from '../controllers/inventory-items/inventory-item.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
const customer = requireRole([UserRole.CUSTOMER]);
const readers = requireRole([UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF]);
const itemReaders = requireRole([UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF, UserRole.CUSTOMER]);

router.use(requireAuth);
router.post('/', customer, controller.create);
router.get('/me', customer, controller.listMine);
router.get('/', readers, controller.list);
router.get('/:id/placement-preview', itemReaders, controller.placementPreview);
router.get('/:id', itemReaders, controller.get);
router.patch('/:id', customer, controller.update);

export default router;
