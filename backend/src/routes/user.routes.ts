import { Router } from 'express';
import { getMe } from '../controllers/users/user.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';

const router = Router();

// Mọi route của user đều yêu cầu phải có Token hợp lệ VÀ đã tồn tại trong DB (đã qua bước Sync)
router.use(requireAuth);

router.get('/me', getMe);

export default router;
