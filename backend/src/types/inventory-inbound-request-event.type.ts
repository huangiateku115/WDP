import { HydratedDocument, Types } from 'mongoose';

export enum InventoryInboundRequestEventOperation { CREATE = 'CREATE', AMEND = 'AMEND', CANCEL = 'CANCEL', INSPECT = 'INSPECT', RETURN_COMPLETED = 'RETURN_COMPLETED', CONFIRM = 'CONFIRM' }
export enum InventoryInboundRequestEventScopeType { ITEM = 'ITEM', REQUEST = 'REQUEST' }

export interface InventoryInboundRequestEventFields {
  requestId: Types.ObjectId;
  itemId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  actorId: Types.ObjectId;
  operation: InventoryInboundRequestEventOperation;
  scopeType: InventoryInboundRequestEventScopeType;
  scopeId: Types.ObjectId;
  idempotencyKey: string;
  payloadHash: string;
  inputSnapshot: Record<string, unknown>;
  resultingState: string;
  resultingVersion: number;
  resultSnapshot: Record<string, unknown>;
  occurredAt: Date;
}

export type IInventoryInboundRequestEvent = HydratedDocument<InventoryInboundRequestEventFields>;
