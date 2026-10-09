import { Request } from 'express';
import { AuditLogModel } from '../../models/audit/audit.model';
import { IAuditLog } from '../../types/audit.type';

const PII_MASK_LIST = ['identityCard', 'creditCard', 'password', 'pinCode'];

export class AuditService {
  /**
   * Đệ quy lặp qua các field, nếu gặp field nằm trong danh sách cần Mask thì bôi đen bằng ******
   */
  static maskPII(data: any): any {
    if (!data) return data;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) {
      return data.map(item => this.maskPII(item));
    }

    const maskedData: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (PII_MASK_LIST.includes(key)) {
          maskedData[key] = '******';
        } else {
          maskedData[key] = this.maskPII(data[key]);
        }
      }
    }
    return maskedData;
  }

  /**
   * Helper function to log an action to the database.
   * Fire-and-forget to avoid blocking the main API response.
   */
  static logAction(payload: IAuditLog): void {
    try {
      // Clone payload để mask dữ liệu trước khi lưu
      const maskedPayload = { ...payload };
      if (maskedPayload.before) maskedPayload.before = this.maskPII(maskedPayload.before);
      if (maskedPayload.after) maskedPayload.after = this.maskPII(maskedPayload.after);

      // Run asynchronously without waiting
      AuditLogModel.create(maskedPayload).catch((err) => {
        console.error('Failed to save Audit Log:', err);
      });
    } catch (error) {
      console.error('Error in AuditService.logAction:', error);
    }
  }
}
