import { RequestHandler } from 'express';
import { ManagedInventoryV3RelocationService as service, ManagedV3RelocationError } from '../../services/inventory-items/managed-inventory-v3-relocation.service';
import { ManagedRelocationDomainError } from '../../services/inventory-items/managed-inventory-v3-relocation.domain';

const run = (operation: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { res.json({ success: true, data: await operation(req) }); }
  catch (error) {
    if (error instanceof ManagedV3RelocationError || error instanceof ManagedRelocationDomainError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message }); return;
    }
    next(error);
  }
};
export const context = run(req => service.context(req.params.id, req.user!));
export const preview = run(req => service.preview(req.params.id, req.body, req.user!));
export const confirm = run(req => service.confirm(req.params.id, req.body, req.get('Idempotency-Key'), req.get('If-Match'), req.user!));
export const operation = run(req => service.operation(req.params.id, req.query.key, req.user!));
