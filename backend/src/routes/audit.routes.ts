import { Router } from 'express';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';
import {
  adminGetLoginHistory,
  adminGetAuditLogs,
  bomGetLoginHistory,
  bomGetAuditLogs,
} from '../controllers/audit/audit.controller';

const router = Router();

router.use(requireAuth);

// Admin Routes
router.get('/admin/login-history/:userId', requireRole([UserRole.ADMIN]), adminGetLoginHistory);
router.get('/admin/audit-logs/:userId', requireRole([UserRole.ADMIN]), adminGetAuditLogs);

// BOM Routes
router.get('/bom/login-history/:userId', requireRole([UserRole.BOM]), bomGetLoginHistory);
router.get('/bom/audit-logs/:userId', requireRole([UserRole.BOM]), bomGetAuditLogs);

export default router;
