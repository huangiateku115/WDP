import { Document, Types } from 'mongoose';

export interface IManagedFacilityCapacity extends Document {
  facilityId: Types.ObjectId;
  sellableCapacityM3: number;
  holdDurationMinutes: number;
  bookingVersion: number;
  isActive: boolean;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
