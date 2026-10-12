import { Router } from 'express';
import * as InspectionController from '../controllers/inspections/inspection.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
router.use(requireAuth);

// Chỉ Staff mới được tạo/hoàn tất Biên bản Bàn giao
const staffRoles = [UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM];

router.post('/', requireRole(staffRoles), InspectionController.createInspection);
router.get('/', requireRole(staffRoles), InspectionController.getInspections);
router.patch('/:id/complete', requireRole(staffRoles), InspectionController.completeInspection);

export default router;
