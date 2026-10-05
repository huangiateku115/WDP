import { isDatabaseConnected } from '../config/database';
import { Router, Request, Response, NextFunction } from 'express';

import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import facilityRoutes from './facility.routes';

const router = Router();

router.get('/health', (_req, res) => {
  const connected = isDatabaseConnected();
  res.status(connected ? 200 : 503).json({
    success: connected,
    service: 'wdp-backend',
    database: connected ? 'connected' : 'disconnected',
  });
});

/* GET home page. */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  res.json({ title: 'Welcome to Storage API' });
});

// Gắn các Routes con vào
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/facilities', facilityRoutes);

export default router;
