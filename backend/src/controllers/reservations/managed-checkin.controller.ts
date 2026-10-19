import { RequestHandler } from 'express';
import { ManagedCheckinError, ManagedCheckinService } from '../../services/reservations/managed-checkin.service';

const run = (operation: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json({ success: true, data: await operation(req) }); }
  catch (error) {
    if (error instanceof ManagedCheckinError) { res.status(error.status).json({ success: false, message: error.message }); return; }
    next(error);
  }
};

export const inspectItem = run(req => ManagedCheckinService.inspectItem(req.params.itemId, req.body, req.user!));
export const createContract = run(req => ManagedCheckinService.createOrRefreshContract(req.params.id, req.user!), 201);
export const signFacilityContract = run(req => ManagedCheckinService.signFacilityContract(req.params.id, req.user!));
export const initiateBalance = run(req => ManagedCheckinService.initiateBalance(req.params.id, req.body, req.user!), 201);
export const confirmMockBalance = run(req => ManagedCheckinService.confirmMockBalance(req.params.id, req.body, req.user!));
