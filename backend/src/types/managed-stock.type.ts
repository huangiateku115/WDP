import { Types } from 'mongoose';
import { ItemMovementArithmeticPolicy } from './item-movement.type';

export enum ManagedStockErrorCode {
  INVALID_MOVEMENT = 'INVALID_MOVEMENT',
  NEGATIVE_STOCK = 'NEGATIVE_STOCK',
  BATCH_MISMATCH = 'BATCH_MISMATCH',
  PLACEMENT_LINEAGE_INVALID = 'PLACEMENT_LINEAGE_INVALID',
  ITEM_PROJECTION_MISMATCH = 'ITEM_PROJECTION_MISMATCH',
  CELL_COUNTER_MISMATCH = 'CELL_COUNTER_MISMATCH',
  RESERVATION_COUNTER_MISMATCH = 'RESERVATION_COUNTER_MISMATCH',
  CAPACITY_UNKNOWN = 'CAPACITY_UNKNOWN',
  CAPACITY_EXCEEDED = 'CAPACITY_EXCEEDED',
  FEATURE_DISABLED = 'FEATURE_DISABLED',
}

export type ManagedCapacityStatus = 'UNKNOWN' | 'EMPTY' | 'PARTIAL' | 'FULL';
export enum ManagedStockSource { LEDGER_V2 = 'LEDGER_V2', LEGACY_RECONCILED = 'LEGACY_RECONCILED' }
export type StockBatchArithmeticPolicy = 'COMPATIBILITY' | ItemMovementArithmeticPolicy;

export interface StockBatchBalance {
  batchId: string;
  receiptMovementId: Types.ObjectId | string;
  receiptRequestId?: Types.ObjectId | string;
  receivingInspectionEvidenceId?: Types.ObjectId | string;
  quantity: number;
  heldQuantity: number;
  quantityUnit: string;
  actualUnitWeightKg: number;
  actualUnitDimensionsM: { widthM: number; depthM: number; heightM: number };
  actualTotalWeightKg: number;
  actualTotalVolumeM3: number;
  receivedAt: Date;
  arithmeticPolicy: StockBatchArithmeticPolicy;
}

export interface InventoryStockBalanceFields {
  itemId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  managedReservationId: Types.ObjectId;
  currentCellId: Types.ObjectId | null;
  batches: StockBatchBalance[];
  onHandQuantity: number;
  heldQuantity: number;
  actualTotalWeightKg: number;
  actualTotalVolumeM3: number;
  schemaVersion: 1;
  source: ManagedStockSource;
  reconciledAt?: Date;
  reconciledThroughMovementId?: Types.ObjectId | null;
  version: number;
}

