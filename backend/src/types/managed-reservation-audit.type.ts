import { Document, Types } from 'mongoose';

export enum ManagedReservationAction {
  QUOTA_CONFIGURED = 'QUOTA_CONFIGURED',
  CREATED = 'CREATED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  MOCK_PAYMENT = 'MOCK_PAYMENT',
  ACTIVATED = 'ACTIVATED',
  CONTRACT_SIGNED = 'CONTRACT_SIGNED',
}

export interface IManagedReservationAudit extends Document {
  facilityId: Types.ObjectId;
  reservationId?: Types.ObjectId;
  actorId: Types.ObjectId;
  action: ManagedReservationAction;
  fromStatus?: string;
  toStatus?: string;
  details?: Record<string, unknown>;
  createdAt: Date;
}
