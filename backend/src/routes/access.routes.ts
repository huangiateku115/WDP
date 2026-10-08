import { Router } from 'express';
import * as AccessController from '../controllers/access/access.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';

const router = Router();
router.use(requireAuth);

router.post('/simulate-unlock', AccessController.simulateUnlock);
router.get('/me', AccessController.getMyAccessLogs);

export default router;
