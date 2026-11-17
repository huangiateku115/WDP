import mongoose from 'mongoose';
import NotificationModel from '../../models/notifications/notification.model';
import { NotificationMethod, NotificationType } from '../../types/notification.type';

export interface CreateInAppNotificationParams {
  userId: string | mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  content: string;
  sentVia: NotificationMethod[];
}

export class NotificationService {
  static resolveCustomerId(reservation: any): string | null {
    if (!reservation?.customerId) return null;
    if (typeof reservation.customerId === 'string') return reservation.customerId;
    if (reservation.customerId._id) return String(reservation.customerId._id);
    return String(reservation.customerId);
  }

  /**
   * Lưu thông báo In-App an toàn: không bao giờ throw lỗi ra luồng nghiệp vụ chính.
   * Mảng sentVia được truyền từ bên ngoài hàm gọi.
   */
  static async safeCreate(params: CreateInAppNotificationParams): Promise<boolean> {
    try {
      if (!params.userId || !mongoose.Types.ObjectId.isValid(String(params.userId))) {
        return false;
      }
      await NotificationModel.create({
        userId: new mongoose.Types.ObjectId(String(params.userId)),
        type: params.type,
        title: params.title,
        content: params.content,
        isRead: false,
        sentVia: Array.isArray(params.sentVia) ? params.sentVia : [NotificationMethod.IN_APP],
      });
      return true;
    } catch (error: any) {
      console.error('[NotificationService] Failed to create notification:', error?.message || error);
      return false;
    }
  }
}
