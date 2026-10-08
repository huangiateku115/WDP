import { Router } from 'express';
import * as NotificationController from '../controllers/notifications/notification.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';

const router = Router();
router.use(requireAuth);

router.get('/me', NotificationController.getMyNotifications);
router.patch('/:id/read', NotificationController.markAsRead);

export default router;
