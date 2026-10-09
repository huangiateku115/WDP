import { Document, Types } from 'mongoose';
import { FacilityServiceType } from './facility.type';

export enum ReservationStatus {
  RESERVED = 'RESERVED',
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
  storageUnitId?: Types.ObjectId;
  allocatedCapacity?: number;
  storageCondition?: string;
  
  startDate: Date;
  endDate: Date;
  
  status: ReservationStatus;
  
  pricingPolicyId?: Types.ObjectId;
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
