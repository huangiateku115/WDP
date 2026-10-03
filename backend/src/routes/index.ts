import { Router, Request, Response, NextFunction } from 'express';

import authRoutes from './auth.routes';
import userRoutes from './user.routes';

const router = Router();

/* GET home page. */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  res.json({ title: 'Welcome to Storage API' });
});

// Gắn các Routes con vào
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

export default router;
