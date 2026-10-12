import { Document, Types } from 'mongoose';

export enum InventoryItemStatus {
  REGISTERED = 'REGISTERED',
}

export interface InventoryItemDimensionsM {
  widthM: number;
  depthM: number;
  heightM: number;
}

export interface InventoryItemFields {
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  managedReservationId: Types.ObjectId;
  itemCode: string;
  name: string;
  category: string;
  description?: string;
  quantity: number;
  /** Number of identical handling units represented by this registered lot. */
  quantityUnit: string;
  unitWeightKg: number;
  unitDimensionsM: InventoryItemDimensionsM;
  unitVolumeM3: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  preferredCellId?: Types.ObjectId;
  /** Registration is descriptive only; physical placement is Staff-confirmed later. */
  currentCellId: Types.ObjectId | null;
  status: InventoryItemStatus;
  images: string[];
  createdBy: Types.ObjectId;
  deletedAt?: Date;
}

export interface IInventoryItem extends Document, InventoryItemFields {
  createdAt: Date;
  updatedAt: Date;
}
