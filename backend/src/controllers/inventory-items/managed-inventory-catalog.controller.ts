import { RequestHandler } from 'express';
import { ManagedInventoryCatalogService as service } from '../../services/inventory-items/managed-inventory-catalog.service';

const run = (operation: (req: any) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json({ success: true, data: await operation(req) }); } catch (error) { next(error); }
};
const runList = (operation: (req: any) => Promise<{ data: unknown[]; pagination: unknown }>): RequestHandler => async (req, res, next) => {
  try { res.json({ success: true, ...await operation(req) }); } catch (error) { next(error); }
};
export const activeCategories = runList(req => service.list('category', req.query, req.user, true));
export const listCategories = runList(req => service.list('category', req.query, req.user));
export const getCategory = run(req => service.get('category', req.params.id, req.user));
export const createCategory = run(req => service.create('category', req.body, req.user), 201);
export const updateCategory = run(req => service.update('category', req.params.id, req.body, req.user));
export const removeCategory = run(req => service.remove('category', req.params.id, req.user));

export const activeQuantityUnits = runList(req => service.list('quantityUnit', req.query, req.user, true));
export const listQuantityUnits = runList(req => service.list('quantityUnit', req.query, req.user));
export const getQuantityUnit = run(req => service.get('quantityUnit', req.params.id, req.user));
export const createQuantityUnit = run(req => service.create('quantityUnit', req.body, req.user), 201);
export const updateQuantityUnit = run(req => service.update('quantityUnit', req.params.id, req.body, req.user));
export const removeQuantityUnit = run(req => service.remove('quantityUnit', req.params.id, req.user));
