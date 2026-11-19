import { Request, Response } from 'express';
import { AdminReservationListService, ReservationListError } from '../../services/operations/admin-reservation-list.service';

export const listReservationsForAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await AdminReservationListService.list(req.query as Record<string, unknown>, req.user as any);
    res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof ReservationListError) { res.status(error.status).json({ success: false, code: error.code, message: error.message }); return; }
    res.status(500).json({ success: false, code: 'RESERVATION_LIST_FAILED', message: 'Unable to list reservations' });
  }
};
