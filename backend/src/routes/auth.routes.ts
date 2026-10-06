import { Router } from 'express';
import { login, logout, forgotPassword, resetPassword } from '../controllers/auth/auth.controller';
import { requireAuth } from '../middlewares/auth/requireAuth';

const router = Router();

// Đăng nhập
router.post('/login', login);

// Đăng xuất (Yêu cầu phải có Access Token hợp lệ mới được gọi)
router.post('/logout', requireAuth, logout);
// Quên mật khẩu
import rateLimit from 'express-rate-limit';
const forgotPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 phút
  max: 3, // Mỗi IP chỉ được xin 3 lần OTP trong 5 phút
  message: { success: false, message: 'Bạn đã xin OTP quá nhiều lần. Vui lòng thử lại sau 5 phút.' }
});

router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
