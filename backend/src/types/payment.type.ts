import { Document, Types } from 'mongoose';
import { FacilityServiceType } from './facility.type';

/** A reservation payment is an advance rent payment, not a refundable deposit. */
export enum PaymentPurpose {
  DEPOSIT = 'DEPOSIT',
  BALANCE = 'BALANCE',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

export enum PaymentProvider {
  PAYOS = 'PAYOS',
  MOCK = 'MOCK',
}

export interface IReservationPayment extends Document {
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  facilityId: Types.ObjectId;
  serviceType: FacilityServiceType;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  idempotencyKey: string;
  provider: PaymentProvider;
  providerReference?: string;
  status: PaymentStatus;
  succeededAt?: Date;
  failedAt?: Date;
  reconciliationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
