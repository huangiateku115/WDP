import { Document, Types } from 'mongoose';

export enum ItemMovementType { INBOUND = 'INBOUND', OUTBOUND = 'OUTBOUND', RELOCATION = 'RELOCATION' }

export interface ItemMovementFields {
  itemId: Types.ObjectId;
  managedReservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  type: ItemMovementType;
  sourceCellId?: Types.ObjectId | null;
  destinationCellId?: Types.ObjectId | null;
  previousPlacementMovementId?: Types.ObjectId;
  quantity: number;
  quantityUnit: string;
  actualUnitWeightKg: number;
  actualTotalWeightKg: number;
  actualUnitDimensionsM: { widthM: number; depthM: number; heightM: number };
  actualTotalVolumeM3: number;
  performedBy: Types.ObjectId;
  performedAt: Date;
  inspectionNote: string;
  handoverNote?: string;
  relocationNote?: string;
  physicalPackingConfirmed?: boolean;
  idempotencyKey: string;
}

export interface IItemMovement extends Document, ItemMovementFields {
  createdAt: Date;
}
