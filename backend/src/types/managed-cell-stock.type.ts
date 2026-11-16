import { Document, Types } from 'mongoose';

export interface ManagedStockDimensionsM {
  widthM: number;
  depthM: number;
  heightM: number;
}

/** Materialized quantity for one immutable receipt lot at one Cell. */
export interface IManagedCellStock extends Document {
  skuId: Types.ObjectId;
  itemSpecId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  cellId: Types.ObjectId;
  receiptId: string;
  quantityUnitSnapshot?: string;
  quantityOnHand: number;
  quantityHeld: number;
  quantityAvailable: number;
  unitWeightKgSnapshot: number;
  unitVolumeM3Snapshot: number;
  unitDimensionsSnapshot: ManagedStockDimensionsM;
  totalWeightKg: number;
  totalVolumeM3: number;
  ledgerRevision: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IManagedItemInstance extends Document {
  itemInstanceId: string;
  skuId: Types.ObjectId;
  itemSpecId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  sourceReceiptId: string;
  quantity: 1;
  unitWeightKgSnapshot: number;
  unitVolumeM3Snapshot: number;
  unitDimensionsSnapshot: ManagedStockDimensionsM;
  allocations: Array<{ cellId: Types.ObjectId; weightKg: number; volumeM3: number }>;
  status: 'PLACED' | 'REMOVED';
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CellReconciliationStatus = 'NOT_REQUIRED' | 'RECONCILED' | 'UNKNOWN' | 'MISMATCH' | 'NOT_CONFIGURED';
