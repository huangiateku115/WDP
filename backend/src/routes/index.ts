import { isDatabaseConnected } from '../config/database';
import { Router, Request, Response, NextFunction } from 'express';

import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import auditRoutes from './audit.routes';
import facilityRoutes from './facility.routes';
import storageUnitRoutes from './storage-unit.routes';
import pricingPolicyRoutes from './pricing-policy.routes';
import publicRoutes from './public.routes';
import maintenanceTicketRoutes from './maintenance-ticket.routes';
import supportRequestRoutes from './support-request.routes';

const router = Router();

router.get('/health', (_req, res) => {
  const connected = isDatabaseConnected();
  res.status(connected ? 200 : 503).json({
    success: connected,
    service: 'wdp-backend',
    database: connected ? 'connected' : 'disconnected',
  });
});

router.use('/public', publicRoutes);
router.use('/maintenance-tickets', maintenanceTicketRoutes);
router.use('/support-requests', supportRequestRoutes);

/* GET home page. */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  res.json({ title: 'Welcome to Storage API' });
});

// Gắn các Routes con vào
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/audit', auditRoutes);
router.use('/facilities', facilityRoutes);
router.use(storageUnitRoutes);
router.use(pricingPolicyRoutes);

export default router;
