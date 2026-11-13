import { Router } from 'express';
import * as AccessController from '../controllers/access/access.controller';
import * as ManagedAccessController from '../controllers/access/managed-access.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
router.use(requireAuth);

router.post('/simulate-unlock', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER, UserRole.ADMIN]), AccessController.simulateUnlock);
router.get('/me', requireRole([UserRole.CUSTOMER]), AccessController.getMyAccessLogs);

// Managed V3 Access Visit and Session API. These routes never call the legacy simulated PIN flow.
router.post('/managed-v3/visits', requireRole([UserRole.CUSTOMER]), ManagedAccessController.createVisit);
router.get('/managed-v3/visits/availability', requireRole([UserRole.CUSTOMER]), ManagedAccessController.visitAvailability);
router.get('/managed-v3/visits/me', requireRole([UserRole.CUSTOMER]), ManagedAccessController.myVisits);
router.get('/managed-v3/visits/facility', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedAccessController.facilityVisits);
router.get('/managed-v3/visits/facility/staff', requireRole([UserRole.FACILITY_MANAGER]), ManagedAccessController.facilityStaff);
router.get('/managed-v3/visits/:visitId', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedAccessController.visitDetail);
router.patch('/managed-v3/visits/:visitId', requireRole([UserRole.CUSTOMER]), ManagedAccessController.amendVisit);
router.post('/managed-v3/visits/:visitId/cancel', requireRole([UserRole.CUSTOMER]), ManagedAccessController.cancelVisit);
router.put('/managed-v3/visits/:visitId/assignment', requireRole([UserRole.FACILITY_MANAGER]), ManagedAccessController.assignStaff);
router.post('/managed-v3/visits/:visitId/check-in', requireRole([UserRole.FACILITY_STAFF]), ManagedAccessController.checkIn);
router.get('/managed-v3/sessions/me', requireRole([UserRole.CUSTOMER]), ManagedAccessController.customerSessions);
router.get('/managed-v3/sessions/facility', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedAccessController.facilitySessions);
router.get('/managed-v3/sessions/:sessionId', requireRole([UserRole.CUSTOMER, UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedAccessController.sessionDetail);
router.post('/managed-v3/sessions/:sessionId/check-out', requireRole([UserRole.FACILITY_STAFF]), ManagedAccessController.checkOut);
router.post('/managed-v3/sessions/:sessionId/revoke', requireRole([UserRole.FACILITY_STAFF, UserRole.FACILITY_MANAGER]), ManagedAccessController.revokeSession);

export default router;
