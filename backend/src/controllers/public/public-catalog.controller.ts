import { RequestHandler } from 'express';
import { PublicCatalogService as service } from '../../services/public/public-catalog.service';

export const listFacilities: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.listFacilities(req.query) }); } catch (e) { next(e); }
};
export const getFacility: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getFacility(req.params.id) }); } catch (e) { next(e); }
};
export const storageOptions: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.storageOptions(req.params.id) }); } catch (e) { next(e); }
};
export const pricing: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.pricing(req.params.id) }); } catch (e) { next(e); }
};
