import { Document, Types } from 'mongoose';

export interface ManagedV3Scope {
  skuId: Types.ObjectId;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  facilityId: Types.ObjectId;
  revision: number;
}
export interface ManagedV3Pose { xStartM: number; yStartM: number; rotationDeg: 0 | 90 }

export interface PhysicalUnitFields extends ManagedV3Scope {
  serial: string;
  weightKg: number;
  dimensionsM: { widthM: number; depthM: number; heightM: number };
  volumeM3: number;
  currentPose?: ManagedV3Pose | null;
  state: 'PREPARED' | 'PLACED' | 'REMOVED' | 'QUARANTINED';
  sourceMovementId?: Types.ObjectId | null;
}
export interface IPhysicalUnit extends Document, PhysicalUnitFields {}

export interface FootprintCell {
  cellId: Types.ObjectId;
  topologyCertificationId: Types.ObjectId;
  supportReactionKg: number;
  occupiedVolumeM3: number;
  topologyRevision: number;
}
export interface FootprintFields extends Omit<ManagedV3Scope, 'skuId'> {
  physicalUnitId: Types.ObjectId;
  cells: FootprintCell[];
  pose?: ManagedV3Pose;
  topologyCertificationId: Types.ObjectId;
  topologyRevision: number;
  verifiedAt: Date;
  state: 'ACTIVE' | 'RELEASED';
  sourceMovementId?: Types.ObjectId | null;
}
export interface IManagedV3Footprint extends Document, FootprintFields {}

export interface BatchPlacementFields extends ManagedV3Scope {
  batchId: string;
  cellId: Types.ObjectId;
  quantity: number;
  quantityUnit: string;
  weightKg: number;
  volumeM3: number;
  topologyCertificationId: Types.ObjectId;
  topologyRevision: number;
  sourceMovementId: Types.ObjectId;
  state: 'ACTIVE' | 'DEPLETED';
  receiptMovementId?: Types.ObjectId;
}
export interface IManagedV3BatchPlacement extends Document, BatchPlacementFields {}

export interface ManagedV3BatchProjectionLine {
  itemKind: 'A2_BATCH'; batchId: string; quantityUnit: string; cellId: Types.ObjectId | string; quantity: number;
  weightKg: number; volumeM3: number; heldQuantity: number; topologyCertificationId: Types.ObjectId | string; topologyRevision: number;
}
export interface ManagedV3PhysicalUnitProjection {
  itemKind: 'A1_PHYSICAL_UNIT'; physicalUnitId: Types.ObjectId | string; quantity: 1; quantityUnit: string; pose?: ManagedV3Pose;
  weightKg: number; volumeM3: number; cellIds: Array<Types.ObjectId | string>;
}
export interface ManagedV3CellProjection { cellId: Types.ObjectId | string; quantity: number; physicalUnitCount: number; weightKg: number; volumeM3: number }
export interface ManagedV3StockProjectionFields extends ManagedV3Scope {
  onHandQuantity: number; heldQuantity: number; availableQuantity: number; totalWeightKg: number; totalVolumeM3: number;
  byBatch: ManagedV3BatchProjectionLine[]; byPhysicalUnit: ManagedV3PhysicalUnitProjection[]; byCell: ManagedV3CellProjection[];
  lastMovementId?: Types.ObjectId | null; reconciledAt?: Date; ledgerRevision: number; projectionRevision: number;
}
export interface IManagedV3StockProjection extends Document, ManagedV3StockProjectionFields {}
