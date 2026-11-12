import { Document, Types } from 'mongoose';
import { FacilityServiceType } from './facility.type';

/** A reservation payment is an advance rent payment, not a refundable deposit. */
export enum PaymentPurpose {
  DEPOSIT = 'DEPOSIT',
  BALANCE = 'BALANCE',
  FULL_RENT = 'FULL_RENT',
  RENEWAL = 'RENEWAL',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

export enum PaymentProvider {
  PAYOS = 'PAYOS',
  MOCK = 'MOCK',
}

export enum PaymentApplicationStatus {
  NOT_APPLIED = 'NOT_APPLIED',
  APPLIED = 'APPLIED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

/** Provider-verified funds receipt is recorded independently from Reservation application. */
export enum ProviderSettlementStatus {
  NOT_VERIFIED = 'NOT_VERIFIED',
  VERIFIED = 'VERIFIED',
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
  checkoutState?: 'NOT_CREATED' | 'CREATING' | 'READY' | 'UNKNOWN' | 'FAILED' | 'CANCELLED' | 'RECONCILIATION_REQUIRED';
  cancelVerifiedAt?: Date;
  checkoutUrl?: string;
  qrCode?: string;
  transferDetails?: { bin: string; accountNumber: string; accountName: string; description: string };
  checkoutExpiresAt?: Date;
  providerPaymentLinkId?: string;
  providerCurrency?: string;
  providerCaptures?: Array<{
    eventHash: string;
    reference: string;
    amount: number;
    currency: string;
    transactionDateTime: string;
    receivedAt: Date;
  }>;
  providerOutcomeEvents?: Array<{
    eventHash: string;
    code: string;
    description: string;
    reference: string;
    amount: number;
    currency: string;
    paymentLinkId: string;
    transactionDateTime: string;
    receivedAt: Date;
  }>;
  providerSettlementStatus?: ProviderSettlementStatus;
  applicationStatus?: PaymentApplicationStatus;
  status: PaymentStatus;
  succeededAt?: Date;
  failedAt?: Date;
  reconciliationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
