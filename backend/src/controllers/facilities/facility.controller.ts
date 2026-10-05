import { RequestHandler } from 'express';
import { FacilityService } from '../../services/facilities/facility.service';

export const createFacility: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await FacilityService.createFacility(req.body) }); }
  catch (error) { next(error); }
};
export const getFacilities: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await FacilityService.getFacilities(req.query) }); }
  catch (error) { next(error); }
};
export const getFacilityById: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await FacilityService.getFacilityById(req.params.id) }); }
  catch (error) { next(error); }
};
export const updateFacility: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await FacilityService.updateFacility(req.params.id, req.body) }); }
  catch (error) { next(error); }
};
export const updateFacilityStatus: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await FacilityService.updateFacilityStatus(req.params.id, req.body) }); }
  catch (error) { next(error); }
};
