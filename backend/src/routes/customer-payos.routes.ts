import { Router } from 'express';
import * as PayosPaymentController from '../controllers/payments/payos-payment.controller';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();

router.post('/:id/payments/payos', requireRole([UserRole.CUSTOMER]), PayosPaymentController.createSelfStorageCheckout);
// Keep this literal route before /:paymentId so "payos" is not treated as an ID.
router.get('/:id/payments/payos', requireRole([UserRole.CUSTOMER]), PayosPaymentController.listSelfStoragePayments);
router.get('/:id/payments/payos/orders/:orderCode', requireRole([UserRole.CUSTOMER]), PayosPaymentController.lookupSelfStoragePayosOrder);
router.get('/:id/payments/:paymentId', requireRole([UserRole.CUSTOMER]), PayosPaymentController.getSelfStoragePaymentStatus);

export default router;
