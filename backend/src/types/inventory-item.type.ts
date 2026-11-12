import { Document, Types } from 'mongoose';

export enum InventoryItemStatus {
  REGISTERED = 'REGISTERED',
  PENDING_INBOUND = 'PENDING_INBOUND',
  /** Staff has received goods for inspection, but inventory is not committed to a Cell. */
  RECEIVED_PENDING_ACCEPTANCE = 'RECEIVED_PENDING_ACCEPTANCE',
  IN_STORAGE = 'IN_STORAGE',
  PENDING_OUTBOUND = 'PENDING_OUTBOUND',
  CHECKED_OUT = 'CHECKED_OUT',
}

export enum ReceivingCustodyStatus { NONE = 'NONE', IN_CUSTODY = 'IN_CUSTODY', RETURNED = 'RETURNED' }
export enum ReceivingInspectionDecision { ACCEPTED = 'ACCEPTED', DISCREPANCY = 'DISCREPANCY', REJECTED = 'REJECTED' }
export enum ManagedInventorySchemaVersion { V3 = 3 }

export interface InventoryItemDimensionsM {
  widthM: number;
  depthM: number;
  heightM: number;
}

export interface InventoryItemFields {
  /** V3 SKU identity marker; absent means a historical V1/V2 inventory record. */
  inventorySchemaVersion?: ManagedInventorySchemaVersion;
  managedV3Revision?: number;
  facilityId: Types.ObjectId;
  customerId: Types.ObjectId;
  managedReservationId: Types.ObjectId;
  itemCode: string;
  name: string;
  category: string;
  description?: string;
  quantity: number;
  /** Number of identical handling units represented by this registered lot. */
  quantityUnit: string;
  unitWeightKg: number;
  unitDimensionsM: InventoryItemDimensionsM;
  unitVolumeM3: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  preferredCellId?: Types.ObjectId;
  /** Registration is descriptive only; physical placement is Staff-confirmed later. */
  currentCellId: Types.ObjectId | null;
  status: InventoryItemStatus;
  inboundRequestedAt?: Date;
  inboundRequestedBy?: Types.ObjectId;
  inboundConfirmedAt?: Date;
  inboundConfirmedBy?: Types.ObjectId;
  inboundMovementId?: Types.ObjectId;
  /** Latest committed placement movement; absent on legacy records, null after checkout. */
  currentPlacementMovementId?: Types.ObjectId | null;
  inboundRejection?: { reason: string; rejectedAt: Date; rejectedBy: Types.ObjectId };
  inboundIdempotencyKey?: string;
  outboundRequestedAt?: Date;
  outboundRequestedBy?: Types.ObjectId;
  outboundConfirmedAt?: Date;
  outboundConfirmedBy?: Types.ObjectId;
  outboundMovementId?: Types.ObjectId;
  outboundHandoverNote?: string;
  outboundVerifiedQuantity?: number;
  outboundIdempotencyKey?: string;
  outboundRejection?: { reason: string; rejectedAt: Date; rejectedBy: Types.ObjectId };
  receivingCustodyStatus?: ReceivingCustodyStatus;
  receivingInspection?: {
    decision: ReceivingInspectionDecision;
    observedQuantity: number;
    observedUnitWeightKg: number;
    observedUnitDimensionsM: InventoryItemDimensionsM;
    compatibleWithCellIds: Types.ObjectId[];
    packingLayoutVerified: boolean;
    note: string;
    inspectedBy: Types.ObjectId;
    inspectedAt: Date;
  };
  createdAt?: Date;
  images: string[];
  createdBy: Types.ObjectId;
  deletedAt?: Date;
}

export interface IInventoryItem extends Document, InventoryItemFields {
  createdAt: Date;
  updatedAt: Date;
}
