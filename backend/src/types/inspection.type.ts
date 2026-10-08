import { Document, Types } from 'mongoose';

export enum InspectionType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT'
}

export enum InspectionStatus {
  DRAFT = 'DRAFT',
  COMPLETED = 'COMPLETED'
}

export enum UnitCondition {
  EXCELLENT = 'EXCELLENT',
  GOOD = 'GOOD',
  DAMAGED = 'DAMAGED',
  NEEDS_CLEANING = 'NEEDS_CLEANING'
}

export interface IInspection extends Document {
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  storageUnitId: Types.ObjectId;
  inspectedBy: Types.ObjectId;
  
  type: InspectionType;
  status: InspectionStatus;
  
  condition: UnitCondition;
  notes?: string;
  images?: string[];
  
  damageFee: number;
  
  createdAt: Date;
  updatedAt: Date;
}
