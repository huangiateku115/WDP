import { Request } from 'express';
import { LoginHistoryModel } from '../../models/audit/loginHistory.model';
import { ILoginHistory } from '../../types/audit.type';

export class LoginHistoryService {
  /**
   * Helper function to record a login or logout event.
   * Fire-and-forget to avoid blocking the main API response.
   */
  static record(req: Request, payload: Omit<ILoginHistory, 'ip' | 'device'>): void {
    try {
      const ip = req.ip || (req.socket.remoteAddress as string) || '';
      const device = req.headers['user-agent'] || 'Unknown Device';

      const historyData: ILoginHistory = {
        ...payload,
        ip,
        device,
      };

      // Run asynchronously without waiting
      LoginHistoryModel.create(historyData).catch((err) => {
        console.error('Failed to save Login History:', err);
      });
    } catch (error) {
      console.error('Error in LoginHistoryService.record:', error);
    }
  }
}
