import { RequestHandler } from 'express';
import { InventoryItemService as service } from '../../services/inventory-items/inventory-item.service';

export const create: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.create(req.body, req.user!) }); } catch (error) { next(error); }
};
export const listMine: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.listMine(req.query, req.user!) }); } catch (error) { next(error); }
};
export const list: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.list(req.query, req.user!) }); } catch (error) { next(error); }
};
export const get: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.get(req.params.id, req.user!) }); } catch (error) { next(error); }
};
export const update: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.update(req.params.id, req.body, req.user!) }); } catch (error) { next(error); }
};
export const placementPreview: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.placementPreview(req.params.id, req.query, req.user!) }); } catch (error) { next(error); }
};
