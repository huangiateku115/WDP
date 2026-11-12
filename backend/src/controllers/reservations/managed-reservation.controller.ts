import { Request, Response } from 'express';
import { ManagedReservationError, ManagedReservationService } from '../../services/reservations/managed-reservation.service';
import { ManagedClosureReadinessError, ManagedClosureReadinessService } from '../../services/reservations/managed-closure-readiness.service';

function handle(error: unknown, res: Response) {
  if (error instanceof ManagedReservationError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof ManagedClosureReadinessError) return res.status(error.status).json({ success: false, message: error.message });
  return res.status(500).json({ success: false, message: 'Internal Server Error' });
}
const endpoint = (run: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
  try { return res.status(status).json({ success: true, data: await run(req) }); }
  catch (error) { return handle(error, res); }
};

export const quote = endpoint(req => {
  if (!Array.isArray((req.body as any)?.cellIds) || !(req.body as any).cellIds.length) throw new ManagedReservationError(400, 'cellIds must select one or more Cells');
  return ManagedReservationService.quote(req.body);
});
export const create = endpoint(req => {
  if (!req.get('Idempotency-Key')) throw new ManagedReservationError(400, 'A valid Idempotency-Key header is required');
  return ManagedReservationService.create(req.body, req.user!, req.get('Idempotency-Key'));
}, 201);
export const configureCapacity = endpoint(req => ManagedReservationService.configureCapacity(req.params.facilityId, req.body, req.user!));
export const getCapacity = endpoint(req => ManagedReservationService.getCapacity(req.params.facilityId, req.query, req.user!));
export const get = endpoint(req => ManagedReservationService.get(req.params.id, req.user!));
export const getClosureReadiness = endpoint(req => ManagedClosureReadinessService.get(req.params.id, req.user!));
export const approve = endpoint(req => ManagedReservationService.approve(req.params.id, req.user!));
export const reject = endpoint(req => ManagedReservationService.reject(req.params.id, req.body, req.user!));
export const cancel = endpoint(req => ManagedReservationService.cancel(req.params.id, req.user!));
export const mockPay = endpoint(req => ManagedReservationService.mockPay(req.params.id, req.user!));
export const initiateDeposit = endpoint(req => ManagedReservationService.initiateDeposit(req.params.id, req.body, req.user!), 201);
export const confirmMockDeposit = endpoint(req => ManagedReservationService.confirmMockDeposit(req.params.id, req.body, req.user!));
export const activate = endpoint(req => ManagedReservationService.activate(req.params.id, req.user!));
export const confirmHandover = endpoint(req => ManagedReservationService.confirmHandover(req.params.id, req.body, req.user!));
