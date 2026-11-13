import { Request, Response } from 'express';
import { ManagedAccessError, ManagedAccessService } from '../../services/access/managed-access.service';

const actor = (req: Request) => req.user!;
function revision(req: Request) { const value = req.header('If-Match')?.replace(/^W\//, '').replace(/^"|"$/g, ''); return value === undefined ? undefined : Number(value); }
async function handle(res: Response, work: () => Promise<unknown>, status = 200) {
  try { const data = await work(); return res.status(status).json({ success: true, data }); }
  catch (error) { if (error instanceof ManagedAccessError) return res.status(error.status).json({ success: false, code: error.code, message: error.message }); return res.status(500).json({ success: false, code: 'ACCESS_OPERATION_FAILED', message: 'Không thể hoàn tất thao tác Access Visit/Session.' }); }
}
export const createVisit = (req: Request, res: Response) => handle(res, () => ManagedAccessService.createVisit(req.body, actor(req), req.header('Idempotency-Key')), 201);
export const visitAvailability = (req: Request, res: Response) => handle(res, () => ManagedAccessService.visitAvailability(req.query.reservationId, req.query.date, actor(req)));
export const myVisits = (req: Request, res: Response) => handle(res, () => ManagedAccessService.myVisits(actor(req)));
export const visitDetail = (req: Request, res: Response) => handle(res, () => ManagedAccessService.visitDetail(req.params.visitId, actor(req)));
export const amendVisit = (req: Request, res: Response) => handle(res, () => ManagedAccessService.amendVisit(req.params.visitId, req.body, actor(req), revision(req), req.header('Idempotency-Key')));
export const cancelVisit = (req: Request, res: Response) => handle(res, () => ManagedAccessService.cancelVisit(req.params.visitId, actor(req), revision(req)));
export const facilityVisits = (req: Request, res: Response) => handle(res, () => ManagedAccessService.facilityVisits(actor(req), typeof req.query.status === 'string' ? req.query.status : undefined));
export const facilityStaff = (req: Request, res: Response) => handle(res, () => ManagedAccessService.facilityStaff(actor(req)));
export const assignStaff = (req: Request, res: Response) => handle(res, () => ManagedAccessService.assignStaff(req.params.visitId, req.body, actor(req), revision(req)));
export const checkIn = (req: Request, res: Response) => handle(res, () => ManagedAccessService.checkIn(req.params.visitId, req.body, actor(req), req.header('Idempotency-Key')), 201);
export const customerSessions = (req: Request, res: Response) => handle(res, () => ManagedAccessService.customerSessions(actor(req)));
export const sessionDetail = (req: Request, res: Response) => handle(res, () => ManagedAccessService.sessionDetail(req.params.sessionId, actor(req)));
export const facilitySessions = (req: Request, res: Response) => handle(res, () => ManagedAccessService.facilitySessions(actor(req)));
export const checkOut = (req: Request, res: Response) => handle(res, () => ManagedAccessService.finishSession(req.params.sessionId, req.body, actor(req), revision(req), false));
export const revokeSession = (req: Request, res: Response) => handle(res, () => ManagedAccessService.finishSession(req.params.sessionId, req.body, actor(req), revision(req), true));
