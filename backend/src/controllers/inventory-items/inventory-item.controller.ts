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
export const requestInbound: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.requestInbound(req.params.id, req.user!) }); } catch (error) { next(error); }
};
export const confirmInbound: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.confirmInbound(req.params.id, req.body, req.user!) }); } catch (error) { next(error); }
};
export const rejectInbound: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.rejectInbound(req.params.id, req.body, req.user!) }); } catch (error) { next(error); }
};
export const movements: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.movements(req.params.id, req.user!) }); } catch (error) { next(error); }
};
