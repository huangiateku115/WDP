import { Document, Types } from 'mongoose';

export enum NotificationType {
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
  OVERDUE_ALERT = 'OVERDUE_ALERT',
  CONTRACT_SIGNED = 'CONTRACT_SIGNED',
  CHECKOUT_REMINDER = 'CHECKOUT_REMINDER'
}

export enum NotificationMethod {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  SMS = 'SMS'
}

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  sentVia: NotificationMethod[];
  
  createdAt: Date;
  updatedAt: Date;
}
