import mongoose, { Schema } from 'mongoose';
import { INotification, NotificationType, NotificationMethod } from '../../types/notification.type';

const notificationSchema = new Schema<INotification>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: Object.values(NotificationType) },
  
  title: { type: String, required: true },
  content: { type: String, required: true },
  
  isRead: { type: Boolean, default: false },
  sentVia: [{ type: String, enum: Object.values(NotificationMethod) }]
}, { timestamps: true });

export default mongoose.model<INotification>('Notification', notificationSchema);
