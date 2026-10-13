import { RequestHandler } from 'express';
import { WarehouseMapService as service } from '../../services/warehouse-map/warehouse-map.service';

export const createZone: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.createZone(req.body, req.user) }); }
  catch (error) { next(error); }
};
export const listZones: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.listZones(req.query, req.user) }); }
  catch (error) { next(error); }
};
export const getZone: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getZone(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const updateZone: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.updateZone(req.params.id, req.body, req.user) }); }
  catch (error) { next(error); }
};
export const deleteZone: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.deleteZone(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const restoreZone: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.restoreZone(req.params.id, req.user) }); }
  catch (error) { next(error); }
};

export const createRack: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await service.createRack(req.body, req.user) }); }
  catch (error) { next(error); }
};
export const listRacks: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.listRacks(req.query, req.user) }); }
  catch (error) { next(error); }
};
export const getRack: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getRack(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const updateRack: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.updateRack(req.params.id, req.body, req.user) }); }
  catch (error) { next(error); }
};
export const deleteRack: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.deleteRack(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const restoreRack: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.restoreRack(req.params.id, req.user) }); }
  catch (error) { next(error); }
};

export const listCells: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.listCells(req.query, req.user) }); }
  catch (error) { next(error); }
};
export const getCell: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getCell(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const updateCell: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.updateCell(req.params.id, req.body, req.user) }); }
  catch (error) { next(error); }
};

export const warehouseMap: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.warehouseMap(req.query.facilityId, req.user, req.query) }); }
  catch (error) { next(error); }
};
export const rackDetailMap: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.rackDetailMap(req.params.id, req.user, req.query) }); }
  catch (error) { next(error); }
};
