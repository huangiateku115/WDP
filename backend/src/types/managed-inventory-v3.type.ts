import { Document, Types } from 'mongoose';

export interface ManagedV3Scope {
  skuId: Types.ObjectId;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  facilityId: Types.ObjectId;
  revision: number;
}

export interface PhysicalUnitFields extends ManagedV3Scope {
  serial: string;
  weightKg: number;
  dimensionsM: { widthM: number; depthM: number; heightM: number };
  volumeM3: number;
  state: 'PREPARED' | 'PLACED' | 'REMOVED' | 'QUARANTINED';
}
export interface IPhysicalUnit extends Document, PhysicalUnitFields {}

export interface FootprintCell {
  cellId: Types.ObjectId;
  supportReactionKg: number;
  occupiedVolumeM3: number;
  topologyRevision: number;
}
export interface FootprintFields extends Omit<ManagedV3Scope, 'skuId'> {
  physicalUnitId: Types.ObjectId;
  cells: FootprintCell[];
  topologyCertificationId: Types.ObjectId;
  topologyRevision: number;
  verifiedAt: Date;
  state: 'ACTIVE' | 'RELEASED';
}
export interface IManagedV3Footprint extends Document, FootprintFields {}

export interface BatchPlacementFields extends ManagedV3Scope {
  batchId: string;
  cellId: Types.ObjectId;
  quantity: number;
  quantityUnit: string;
  weightKg: number;
  volumeM3: number;
  sourceMovementId: Types.ObjectId;
  state: 'ACTIVE' | 'DEPLETED';
}
export interface IManagedV3BatchPlacement extends Document, BatchPlacementFields {}
