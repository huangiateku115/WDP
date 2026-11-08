import { Request, Response } from 'express';
import { PayosPaymentError, payosPaymentService } from '../../services/payments/payos-payment.service';

function sendError(error: unknown, res: Response) {
  if (error instanceof PayosPaymentError) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  return res.status(500).json({ success: false, code: 'PAYMENT_PROCESSING_FAILED', message: 'Payment request could not be completed' });
}

export const createSelfStorageCheckout = async (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Object.keys(req.body).some(key => key !== 'purpose')) {
      return res.status(400).json({ success: false, code: 'INVALID_PAYMENT_REQUEST', message: 'Only purpose is accepted in the request body' });
    }
    const result = await payosPaymentService.createCheckout(req.params.id, req.body.purpose,
      req.get('Idempotency-Key'), req.user!._id);
    const { httpStatus, outcome, ...data } = result;
    return res.status(httpStatus).json({ success: true, outcome, data });
  } catch (error) { return sendError(error, res); }
};

export const getSelfStoragePaymentStatus = async (req: Request, res: Response) => {
  try {
    const data = await payosPaymentService.getCustomerStatus(req.params.paymentId, req.params.id, req.user!._id);
    return res.json({ success: true, data });
  } catch (error) { return sendError(error, res); }
};

export const listSelfStoragePayments = async (req: Request, res: Response) => {
  try {
    const data = await payosPaymentService.listCustomerPayments(req.params.id, req.user!._id, {
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    return res.json({ success: true, data });
  } catch (error) { return sendError(error, res); }
};

export const lookupSelfStoragePayosOrder = async (req: Request, res: Response) => {
  try {
    const data = await payosPaymentService.lookupCustomerPayosOrder(req.params.id, req.params.orderCode, req.user!._id);
    return res.json({ success: true, data });
  } catch (error) { return sendError(error, res); }
};

export const payosWebhook = async (req: Request, res: Response) => {
  try {
    const data = await payosPaymentService.handleWebhook(req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) { return sendError(error, res); }
};
