import { Document, Types } from 'mongoose';
import { FacilityServiceType } from './facility.type';

export enum ReservationStatus {
  RESERVED = 'RESERVED',
  /** Version 2 Managed flow: advance rent deposit is settled; rental is not active. */
  DEPOSIT_PAID = 'DEPOSIT_PAID',
  /** Version 2 Managed flow: contract and advance rent balance are settled; handover is pending. */
  CHECKIN_READY = 'CHECKIN_READY',
  CONTRACTED = 'CONTRACTED',
  PAID = 'PAID',
  ACTIVE = 'ACTIVE',
  OVERDUE = 'OVERDUE',
  CHECKED_OUT = 'CHECKED_OUT',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED'
}

export interface IStatusHistory {
  status: ReservationStatus;
  actorId?: Types.ObjectId;
  reason?: string;
  createdAt: Date;
}

export interface IReservation extends Document {
  managedAccessRevision?: number;
  reservationCode: string;
  customerId: Types.ObjectId;
  facilityId: Types.ObjectId;
  
  serviceType: FacilityServiceType;
  termsAcceptance?: {
    documentCode: string;
    version: string;
    versionId: string;
    serviceType: FacilityServiceType;
    contentHash: string;
    acceptedAt: Date;
  };
  /** Optional immutable key/hash used to replay Customer Self-Storage creation safely. */
  bookingIdempotencyKey?: string;
  bookingPayloadHash?: string;
  /** Absent on legacy records. Version 2 is never inferred from legacy status/payment fields. */
  bookingFlowVersion?: 2 | 3;
  /** Explicit marker for bookings that must use one 100% PayOS checkout. Absent on legacy reservations. */
  rentalPaymentFlow?: 'FULL_UPFRONT_V1';
  rentalPricingSnapshot?: Record<string, unknown>;
  storageUnitId?: Types.ObjectId;
  /** Cells exclusively allocated to this Managed Inventory reservation. */
  allocatedCellIds?: Types.ObjectId[];
  allocatedCapacity?: number;
  /** Actual inbound volume consumed from this rental's quota. */
  usedCapacityM3?: number;
  /** Write token serializing inbound usage changes for this rental. */
  inventoryVersion?: number;
  /** Active Managed Inventory closure request; absent while no closure is pending. */
  activeClosureRequestId?: Types.ObjectId;
  managedPricingSnapshot?: Record<string, unknown>;
  paymentSimulation?: { simulated: boolean; provider: 'MOCK'; paidAt: Date; actorId: Types.ObjectId };
  balanceSettledAt?: Date;
  balanceSettledBy?: Types.ObjectId;
  depositPaymentId?: Types.ObjectId;
  balancePaymentId?: Types.ObjectId;
  fullPaymentId?: Types.ObjectId;
  /** Idempotency identity for a Backend-confirmed zero-balance V3 settlement. */
  balanceSettlementKey?: string;
  handoverByStaffId?: Types.ObjectId;
  handoverAt?: Date;
  storageCondition?: string;
  handoverAccessNotes?: string;
  
  /** Deadline for customer to arrive at facility, inspect unit and sign paper contract (default 3 days). */
  signingDeadline?: Date;
  paperContractProofUrl?: string;
  paperContractVerifiedBy?: Types.ObjectId;
  paperContractVerifiedAt?: Date;
  accessPinCode?: string;
  cancellationReason?: string;
  refundPenaltyPercent?: number;
  actualCheckoutDate?: Date;
  checkoutRequest?: {
    requestedAt: Date;
    note?: string;
    status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  };
  checkoutInspectionId?: Types.ObjectId;
  renewals?: Array<{
    renewalDate: Date;
    durationMonths: number;
    amount: number;
    paymentId?: Types.ObjectId;
    oldEndDate: Date;
    newEndDate: Date;
  }>;
  
  startDate: Date;
  endDate: Date;
  
  status: ReservationStatus;
  
  pricingPolicyId: Types.ObjectId;
  estimatedRent: number;
  depositAmount: number;
  taxAmount: number;
  discountAmount: number;
  
  expiresAt?: Date;
  
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectReason?: string;
  
  statusHistory: IStatusHistory[];
  
  createdAt: Date;
  updatedAt: Date;
}
