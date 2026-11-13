import { Document, Types } from 'mongoose';

export enum ManagedV3OutboundState { PENDING = 'PENDING', CANCELLED = 'CANCELLED', CONFIRMED = 'CONFIRMED' }
export enum ManagedV3OutboundOperation { CREATE = 'CREATE', CANCEL = 'CANCEL', CONFIRM = 'CONFIRM' }
export interface ManagedV3OutboundAllocation {
  itemKind: 'A1_PHYSICAL_UNIT' | 'A2_BATCH'; batchId?: string; physicalUnitId?: Types.ObjectId; cellId: Types.ObjectId;
  quantity: number; quantityUnit: string; weightKg: number; volumeM3: number; receiptMovementId?: Types.ObjectId;
  topologyCertificationId: Types.ObjectId; topologyRevision: number; pose?: { xStartM: number; yStartM: number; rotationDeg: 0 | 90 };
}
export interface ManagedV3OutboundRequestFields {
  skuId: Types.ObjectId; reservationId: Types.ObjectId; customerId: Types.ObjectId; facilityId: Types.ObjectId;
  itemKind: 'A1_PHYSICAL_UNIT' | 'A2_BATCH'; requestedQuantity: number; quantityUnit: string; allocations: ManagedV3OutboundAllocation[];
  state: ManagedV3OutboundState; version: number; idempotencyKey: string; requestHash: string; createdAt: Date;
  cancelledAt?: Date; confirmedAt?: Date; confirmedMovementId?: Types.ObjectId; confirmedBy?: Types.ObjectId;
  customerAttestation?: { confirmedAt: Date; customerId: Types.ObjectId; text: string };
}
export interface IManagedV3OutboundRequest extends Document, ManagedV3OutboundRequestFields {}
export interface ManagedV3OutboundEventFields {
  requestId: Types.ObjectId; skuId: Types.ObjectId; reservationId: Types.ObjectId; customerId: Types.ObjectId; facilityId: Types.ObjectId;
  actorId: Types.ObjectId; operation: ManagedV3OutboundOperation; idempotencyKey: string; requestHash: string;
  resultingState: ManagedV3OutboundState; resultingVersion: number; allocationSnapshot: ManagedV3OutboundAllocation[];
  occurredAt: Date; movementId?: Types.ObjectId;
}
export interface IManagedV3OutboundEvent extends Document, ManagedV3OutboundEventFields {}
