import { Document, Types } from 'mongoose';

export enum ItemMovementType { INBOUND = 'INBOUND' }

export interface ItemMovementFields {
  itemId: Types.ObjectId;
  managedReservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  type: ItemMovementType;
  destinationCellId: Types.ObjectId;
  quantity: number;
  quantityUnit: string;
  actualUnitWeightKg: number;
  actualTotalWeightKg: number;
  actualUnitDimensionsM: { widthM: number; depthM: number; heightM: number };
  actualTotalVolumeM3: number;
  performedBy: Types.ObjectId;
  performedAt: Date;
  inspectionNote: string;
  idempotencyKey: string;
}

export interface IItemMovement extends Document, ItemMovementFields {
  createdAt: Date;
}
