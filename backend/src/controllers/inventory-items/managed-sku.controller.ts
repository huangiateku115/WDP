import { RequestHandler } from 'express';
import { ManagedSkuService } from '../../services/inventory-items/managed-sku.service';
const run = (fn: (req: any) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json({ success: true, data: await fn(req) }); } catch (error) { next(error); }
};
export const create = run(req => ManagedSkuService.create(req.body, req.user), 201);
// Keep the established collection envelope: data is the array, pagination is a sibling.
export const listMine: RequestHandler = async (req, res, next) => {
  try {
    res.json({ success: true, ...await ManagedSkuService.listMine(req.user, req.query) });
  } catch (error) { next(error); }
};
export const get = run(req => ManagedSkuService.get(req.params.id, req.user));
export const update = run(req => ManagedSkuService.update(req.params.id, req.body, req.get('If-Match'), req.user));
export const listSpecifications = run(req => ManagedSkuService.listSpecifications(req.params.skuId, req.user));
export const createSpecification = run(req => ManagedSkuService.createSpecification(req.params.skuId, req.body, req.user), 201);
export const updateSpecification = run(req => ManagedSkuService.updateSpecification(req.params.skuId, req.params.specId, req.body, req.get('If-Match'), req.user));
export const deleteSpecification = run(req => ManagedSkuService.deleteSpecification(req.params.skuId, req.params.specId, req.get('If-Match'), req.user));
