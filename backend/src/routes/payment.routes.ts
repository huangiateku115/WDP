import { Router } from 'express';
import * as PayosPaymentController from '../controllers/payments/payos-payment.controller';

// This provider callback is public by design. Authenticity is established by the PayOS SDK signature verifier.
const router = Router();
router.post('/payos/webhook', PayosPaymentController.payosWebhook);
export default router;
