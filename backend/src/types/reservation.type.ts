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
  reservationCode: string;
  customerId: Types.ObjectId;
  facilityId: Types.ObjectId;
  
  serviceType: FacilityServiceType;
  /** Optional immutable key/hash used to replay Customer Self-Storage creation safely. */
  bookingIdempotencyKey?: string;
  bookingPayloadHash?: string;
  /** Absent on legacy records. Version 2 is never inferred from legacy status/payment fields. */
  bookingFlowVersion?: 2;
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
  handoverByStaffId?: Types.ObjectId;
  handoverAt?: Date;
  storageCondition?: string;
  
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
