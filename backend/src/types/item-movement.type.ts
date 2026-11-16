import { Document, Types } from 'mongoose';
import { ManagedV3Pose } from './managed-inventory-v3.type';

export enum ItemMovementType { INBOUND = 'INBOUND', OUTBOUND = 'OUTBOUND', RELOCATION = 'RELOCATION' }

/** Schema v2 makes each movement's effect on receipt batches explicit. */
export enum MovementBatchAction { ADD = 'ADD', REMOVE = 'REMOVE', MOVE = 'MOVE' }
export type ItemMovementArithmeticPolicy = 'CANONICAL_V1';

export interface V3PlacementEffect {
  cellId: Types.ObjectId;
  topologyCertificationId: Types.ObjectId;
  topologyRevision: number;
  batchId?: string;
  physicalUnitId?: Types.ObjectId;
  quantity: number;
  quantityUnit: string;
  weightKg: number;
  volumeM3: number;
  supportReactionKg?: number;
  occupiedVolumeM3?: number;
  pose?: ManagedV3Pose;
}
export interface V3MovementEffect {
  action: 'ADD' | 'REMOVE' | 'MOVE';
  itemKind: 'A1_PHYSICAL_UNIT' | 'A2_BATCH';
  operationId: string;
  requestHash: string;
  accessSessionId: Types.ObjectId;
  inventoryRevision: number;
  ledgerRevision: number;
  topologyCertificationId: Types.ObjectId;
  topologyRevision: number;
  correlationId: string;
  source?: V3PlacementEffect[];
  destination?: V3PlacementEffect[];
  evidenceIds?: Types.ObjectId[];
}

/** V4 uses SKU Item Specification + receipt/instance identity; no A1/A2 or topology dependency. */
export interface ManagedStockEffectLine {
  /** Stable logical inbound row; several cell allocations may share one lineId. */
  lineId?: string;
  itemSpecId: Types.ObjectId;
  /** Placement owner for cross-Reservation V3 MOVE; absent means movement.managedReservationId. */
  reservationId?: Types.ObjectId;
  receiptId: string;
  itemInstanceId?: string;
  cellId: Types.ObjectId;
  quantity: number;
  quantityUnitSnapshot?: string;
  unitWeightKgSnapshot: number;
  unitVolumeM3Snapshot: number;
  unitDimensionsSnapshot: { widthM: number; depthM: number; heightM: number };
  allocatedWeightKg: number;
  allocatedVolumeM3: number;
  quantityBefore?: number;
  quantityAfter?: number;
}
export interface ManagedStockMovementEffect {
  action: MovementBatchAction;
  operationId: string;
  requestHash: string;
  ledgerRevision: number;
  /** Additive line contract version; absent on historical v4 events. */
  contractVersion?: 2;
  accessSessionId?: Types.ObjectId;
  reason?: string;
  notes?: string;
  customerAttestation?: { customerId: Types.ObjectId; attestedAt: Date; statement: string };
  source?: ManagedStockEffectLine[];
  destination?: ManagedStockEffectLine[];
}

export interface MovementBatchLine {
  /** Stable receipt batch identity. New batches use an ObjectId string. */
  batchId: string;
  /** Origin references are retained on REMOVE/MOVE lines for auditability. */
  receiptMovementId?: Types.ObjectId;
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
  movementCode?: string;
  referenceCode?: string;
  inspectionNote: string;
  handoverNote?: string;
  relocationNote?: string;
  physicalPackingConfirmed?: boolean;
  idempotencyKey: string;
  /** Missing on MI-03B/MI-04/MI-05 records, which are interpreted as schema v1. */
  schemaVersion?: 1 | 2 | 3 | 4;
  /** Missing/null means historical tolerance; new v2 writes must set CANONICAL_V1. */
  arithmeticPolicy?: ItemMovementArithmeticPolicy | null;
  /** Present and immutable for schema v2 events. */
  batchLines?: MovementBatchLine[];
  operationId?: string;
  v3Effect?: V3MovementEffect;
  itemSpecId?: Types.ObjectId;
  stockEffect?: ManagedStockMovementEffect;
}

export interface IItemMovement extends Document, ItemMovementFields {
  createdAt: Date;
}
