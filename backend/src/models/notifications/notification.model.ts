import mongoose, { Schema } from 'mongoose';
import { INotification, NotificationType, NotificationMethod } from '../../types/notification.type';

const notificationSchema = new Schema<INotification>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: Object.values(NotificationType) },
  
  title: { type: String, required: true },
  content: { type: String, required: true },
  
  isRead: { type: Boolean, default: false },
  sentVia: [{ type: String, enum: Object.values(NotificationMethod) }],
  serviceType: { type: String, enum: ['SELF_STORAGE', 'MANAGED_INVENTORY'] },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility' },
  relatedEntityId: { type: Schema.Types.ObjectId },
  eventKey: { type: String, select: false },
  correlationId: { type: String, select: false }
}, { timestamps: true });

notificationSchema.index({ userId: 1, eventKey: 1 }, {
  name: 'uniq_notification_user_event_key', unique: true,
  partialFilterExpression: { eventKey: { $type: 'string' } },
});
notificationSchema.index({ userId: 1, createdAt: -1 }, { name: 'notification_user_created_at' });
notificationSchema.set('autoIndex', false);

export default mongoose.model<INotification>('Notification', notificationSchema);
