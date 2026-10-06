import { RequestHandler } from 'express';
import { StorageUnitService as service } from '../../services/storage-units/storage-unit.service';

export const createStorageUnit: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.createStorageUnit(req.params.facilityId, req.body, req.user) }); }
  catch (error) { next(error); }
};
export const getStorageUnits: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.getStorageUnits(req.params.facilityId, req.query, req.user) }); }
  catch (error) { next(error); }
};
export const getStorageUnitById: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getStorageUnitById(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const updateStorageUnit: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.updateStorageUnit(req.params.id, req.body, req.user) }); }
  catch (error) { next(error); }
};
export const updateStorageUnitStatus: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.updateStorageUnitStatus(req.params.id, req.body, req.user) }); }
  catch (error) { next(error); }
};
