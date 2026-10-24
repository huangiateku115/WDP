import { Document, Types } from 'mongoose';

export enum ItemMovementType { INBOUND = 'INBOUND', OUTBOUND = 'OUTBOUND', RELOCATION = 'RELOCATION' }

/** Schema v2 makes each movement's effect on receipt batches explicit. */
export enum MovementBatchAction { ADD = 'ADD', REMOVE = 'REMOVE', MOVE = 'MOVE' }
export type ItemMovementArithmeticPolicy = 'CANONICAL_V1';

export interface MovementBatchLine {
  /** Stable receipt batch identity. New batches use an ObjectId string. */
  batchId: string;
  /** Origin references are retained on REMOVE/MOVE lines for auditability. */
  receiptRequestId?: Types.ObjectId;
  receivingInspectionEvidenceId?: Types.ObjectId;
  action: MovementBatchAction;
  quantity: number;
  quantityUnit: string;
  actualUnitWeightKg: number;
  actualUnitDimensionsM: { widthM: number; depthM: number; heightM: number };
  actualTotalWeightKg: number;
  actualTotalVolumeM3: number;
}

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
  /** Missing on MI-03B/MI-04/MI-05 records, which are interpreted as schema v1. */
  schemaVersion?: 1 | 2;
  /** Missing/null means historical tolerance; new v2 writes must set CANONICAL_V1. */
  arithmeticPolicy?: ItemMovementArithmeticPolicy | null;
  /** Present and immutable for schema v2 events. */
  batchLines?: MovementBatchLine[];
}

export interface IItemMovement extends Document, ItemMovementFields {
  createdAt: Date;
}
