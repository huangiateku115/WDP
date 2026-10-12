import { Document, Types } from 'mongoose';

export enum StorageUnitSize { SMALL = 'SMALL', MEDIUM = 'MEDIUM', LARGE = 'LARGE' }
export enum StorageUnitStatus {
  AVAILABLE = 'AVAILABLE', HELD = 'HELD', OCCUPIED = 'OCCUPIED',
  MAINTENANCE = 'MAINTENANCE', INACTIVE = 'INACTIVE',
}
export interface UnitDimensions { lengthM: number; widthM: number; heightM: number }
export interface StorageUnitInput {
  unitCode: string;
  size: StorageUnitSize;
  dimensions: UnitDimensions;
  description?: string;
  images?: string[];
}
export interface IStorageUnit extends Document {
  facilityId: Types.ObjectId;
  unitCode: string;
  size: StorageUnitSize;
  dimensions: UnitDimensions;
  volumeM3: number;
  status: StorageUnitStatus;
  bookingVersion: number;
  description?: string;
  images?: string[];
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
