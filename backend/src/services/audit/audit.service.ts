import { Request } from 'express';
import { AuditLogModel } from '../../models/audit/audit.model';
import { IAuditLog } from '../../types/audit.type';

export class AuditService {
  /**
   * Helper function to log an action to the database.
   * Fire-and-forget to avoid blocking the main API response.
   */
  static logAction(payload: IAuditLog): void {
    try {
      // Run asynchronously without waiting
      AuditLogModel.create(payload).catch((err) => {
        console.error('Failed to save Audit Log:', err);
      });
    } catch (error) {
      console.error('Error in AuditService.logAction:', error);
    }
  }
}
