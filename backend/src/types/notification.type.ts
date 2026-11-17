import { Document, Types } from 'mongoose';

export enum NotificationType {
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
  OVERDUE_ALERT = 'OVERDUE_ALERT',
  CONTRACT_SIGNED = 'CONTRACT_SIGNED',
  CHECKOUT_REMINDER = 'CHECKOUT_REMINDER',
  BOOKING_CREATED = 'BOOKING_CREATED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
  HANDOVER_PIN = 'HANDOVER_PIN',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  CHECKOUT_COMPLETED = 'CHECKOUT_COMPLETED',
  EXTENSION_CREATED = 'EXTENSION_CREATED',
  EXTENSION_PAID = 'EXTENSION_PAID',
  EXTENSION_CONFIRMED = 'EXTENSION_CONFIRMED',
  EXTENSION_REJECTED = 'EXTENSION_REJECTED',
  SIGNING_SLA_EXPIRED = 'SIGNING_SLA_EXPIRED',
  EXPIRING_SOON = 'EXPIRING_SOON'
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
