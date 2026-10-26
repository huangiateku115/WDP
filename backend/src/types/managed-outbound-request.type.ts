import { HydratedDocument, Types } from 'mongoose';

export enum ManagedOutboundRequestState {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PARTIALLY_FULFILLED = 'PARTIALLY_FULFILLED',
  CANCELLED = 'CANCELLED',
}
export enum ManagedOutboundRequestOperation { CREATE = 'CREATE', CONFIRM = 'CONFIRM', CANCEL = 'CANCEL' }

export interface ManagedOutboundBatchAllocation {
  batchId: string;
  quantity: number;
  receiptMovementId: Types.ObjectId;
  receiptRequestId?: Types.ObjectId;
  receivingInspectionEvidenceId?: Types.ObjectId;
  receivedAt: Date | string;
  arithmeticPolicy: 'COMPATIBILITY' | 'CANONICAL_V1';
}

export interface ManagedOutboundRequestFields {
  itemId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  requestedQuantity: number;
  quantityUnit: string;
  batchAllocations: ManagedOutboundBatchAllocation[];
  state: ManagedOutboundRequestState;
  idempotencyKey: string;
  payloadHash: string;
  version: number;
  confirmedQuantity?: number;
  confirmedMovementId?: Types.ObjectId;
  confirmedBy?: Types.ObjectId;
  confirmedAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelledAt?: Date;
}

export type IManagedOutboundRequest = HydratedDocument<ManagedOutboundRequestFields>;

export interface ManagedOutboundRequestEventFields {
  requestId: Types.ObjectId;
  itemId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  actorId: Types.ObjectId;
  operation: ManagedOutboundRequestOperation;
  idempotencyKey: string;
  payloadHash: string;
  inputSnapshot: Record<string, unknown>;
  resultingState: ManagedOutboundRequestState;
  resultingVersion: number;
  resultSnapshot: Record<string, unknown>;
  occurredAt: Date;
  movementId?: Types.ObjectId;
  confirmedQuantity?: number;
}
