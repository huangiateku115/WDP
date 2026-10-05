import { Router } from 'express';
import { login, logout } from '../controllers/auth/auth.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';

const router = Router();

// Đăng nhập
router.post('/login', login);

// Đăng xuất (Yêu cầu phải có Access Token hợp lệ mới được gọi)
router.post('/logout', requireAuth, logout);

export default router;
