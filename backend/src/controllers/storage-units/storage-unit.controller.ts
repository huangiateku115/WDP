import { RequestHandler } from 'express';
import { StorageUnitService as service } from '../../services/storage-units/storage-unit.service';
import { AuditService } from '../../services/audit/audit.service';
import { ActionType } from '../../types/audit.type';

export const createStorageUnit: RequestHandler = async (req, res, next) => {
  try { 
    const result = await service.createStorageUnit(req.params.facilityId, req.body, req.user);
    const actor = req.user as any;
    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.CREATE_STORAGE_UNIT,
      entityType: 'StorageUnit',
      entityId: (result as any)._id.toString(),
      after: result
    });
    res.status(201).json({ success: true, data: result }); 
  }
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
export const getUnitAvailability: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.getUnitAvailability(req.params.id, req.query, req.user) }); }
  catch (error) { next(error); }
};
export const updateStorageUnit: RequestHandler = async (req, res, next) => {
  try { 
    const result = await service.updateStorageUnit(req.params.id, req.body, req.user);
    const actor = req.user as any;
    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.UPDATE_STORAGE_UNIT,
      entityType: 'StorageUnit',
      entityId: req.params.id as string,
      after: req.body
    });
    res.json({ success: true, data: result }); 
  }
  catch (error) { next(error); }
};
export const updateStorageUnitStatus: RequestHandler = async (req, res, next) => {
  try { 
    const result = await service.updateStorageUnitStatus(req.params.id, req.body, req.user);
    const actor = req.user as any;
    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.UPDATE_STORAGE_UNIT_STATUS,
      entityType: 'StorageUnit',
      entityId: req.params.id as string,
      after: { status: req.body.status }
    });
    res.json({ success: true, data: result }); 
  }
  catch (error) { next(error); }
};
export const deleteStorageUnit: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.deleteStorageUnit(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
export const restoreStorageUnit: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await service.restoreStorageUnit(req.params.id, req.user) }); }
  catch (error) { next(error); }
};
