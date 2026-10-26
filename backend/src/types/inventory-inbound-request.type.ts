import { HydratedDocument, Types } from 'mongoose';

export enum InventoryInboundRequestState {
  PENDING_INSPECTION = 'PENDING_INSPECTION',
  DISCREPANCY = 'DISCREPANCY',
  ACCEPTED_PENDING_CONFIRMATION = 'ACCEPTED_PENDING_CONFIRMATION',
  RETURN_PENDING = 'RETURN_PENDING',
  REJECTED = 'REJECTED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

export enum InventoryInboundCustodyState {
  NOT_TAKEN = 'NOT_TAKEN',
  IN_CUSTODY = 'IN_CUSTODY',
  RETURNED = 'RETURNED',
}

export interface InventoryInboundDimensionsM {
  widthM: number;
  depthM: number;
  heightM: number;
}

export interface InventoryInboundRequestFields {
  itemId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  requestedQuantity: number;
  quantityUnit: string;
  declaredUnitWeightKg: number;
  declaredUnitDimensionsM: InventoryInboundDimensionsM;
  state: InventoryInboundRequestState;
  custodyState: InventoryInboundCustodyState;
  requestIdempotencyKey: string;
  creationPayloadHash: string;
  currentPayloadHash: string;
  currentInspectionAttemptId?: Types.ObjectId;
  acceptedEvidenceSnapshotId?: Types.ObjectId;
  confirmedMovementId?: Types.ObjectId;
  version: number;
  updatedAt?: Date;
}

export type IInventoryInboundRequest = HydratedDocument<InventoryInboundRequestFields>;
