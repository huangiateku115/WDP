import { RequestHandler } from 'express';
import { FacilityService } from '../../services/facilities/facility.service';
import { AuditService } from '../../services/audit/audit.service';
import { ActionType } from '../../types/audit.type';

export const createFacility: RequestHandler = async (req, res, next) => {
  try { 
    const result = await FacilityService.createFacility(req.body);
    const actor = req.user as any;
    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.CREATE_FACILITY,
      entityType: 'Facility',
      entityId: (result as any)._id.toString(),
      after: result
    });
    res.status(201).json({ success: true, data: result }); 
  }
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
  try { 
    const result = await FacilityService.updateFacility(req.params.id, req.body);
    const actor = req.user as any;
    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.UPDATE_FACILITY,
      entityType: 'Facility',
      entityId: req.params.id as string,
      after: req.body // Log payload body
    });
    res.json({ success: true, data: result }); 
  }
  catch (error) { next(error); }
};
export const updateFacilityStatus: RequestHandler = async (req, res, next) => {
  try { 
    const result = await FacilityService.updateFacilityStatus(req.params.id, req.body);
    const actor = req.user as any;
    AuditService.logAction({
      actorId: actor._id.toString(),
      actorRole: actor.role,
      action: ActionType.UPDATE_FACILITY_STATUS,
      entityType: 'Facility',
      entityId: req.params.id as string,
      after: { status: req.body.status }
    });
    res.json({ success: true, data: result }); 
  }
  catch (error) { next(error); }
};
