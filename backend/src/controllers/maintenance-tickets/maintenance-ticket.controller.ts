import { RequestHandler } from 'express';
import { MaintenanceTicketService as service } from '../../services/maintenance-tickets/maintenance-ticket.service';

export const create: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.create(req.body, req.user!) }); } catch (error) { next(error); }
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
export const assign: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.assign(req.params.id, req.body, req.user!) }); } catch (error) { next(error); }
};
export const unassign: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.unassign(req.params.id, req.user!) }); } catch (error) { next(error); }
};
export const updateStatus: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.updateStatus(req.params.id, req.body, req.user!) }); } catch (error) { next(error); }
};
export const softDelete: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.softDelete(req.params.id, req.user!) }); } catch (error) { next(error); }
};
export const restore: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.restore(req.params.id, req.user!) }); } catch (error) { next(error); }
};
