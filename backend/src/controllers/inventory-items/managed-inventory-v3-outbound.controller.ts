import { RequestHandler } from 'express';
import { ManagedInventoryV3OutboundService as service, ManagedV3OutboundError } from '../../services/inventory-items/managed-inventory-v3-outbound.service';
const run = (operation: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json({ success: true, data: await operation(req) }); }
  catch (error) { if (error instanceof ManagedV3OutboundError) { res.status(error.status).json({ success: false, code: error.code, message: error.message }); return; } next(error); }
};
export const context = run(req => service.context(req.params.id, req.user!));
export const preview = run(req => service.preview(req.params.id, req.body, req.user!));
export const confirm = (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) => run(r => service.confirm(r.params.id, r.body, r.get('Idempotency-Key'), r.get('If-Match'), r.user!))(req, res, next);
export const operation = run(req => service.operation(req.params.id, req.query.key, req.user!));
