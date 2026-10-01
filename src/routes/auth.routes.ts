import { Router } from 'express';
import { syncUser } from '../controllers/auth/auth.controller';
import { verifyTokenOnly } from '../middlewares/auth/verifyToken';

const router = Router();

// Route này KHÔNG kiểm tra user trong DB (requireAuth), mà chỉ verify Token để lưu xuống DB.
router.post('/sync', verifyTokenOnly, syncUser);

export default router;
