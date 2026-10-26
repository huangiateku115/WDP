import { Types } from 'mongoose';
import { InventoryInboundDimensionsM } from './inventory-inbound-request.type';

export type RepeatedInboundInspectionDecision = 'ACCEPTED' | 'DISCREPANCY' | 'REJECTED';

export interface RepeatedInboundEvidenceImage {
  uploadId: Types.ObjectId;
  secureUrl: string;
  publicId: string;
  sha256: string;
  width: number;
  height: number;
  format: 'jpg' | 'png' | 'webp';
}

export interface RepeatedInboundInspectionFields {
  requestId: Types.ObjectId;
  itemId: Types.ObjectId;
  reservationId: Types.ObjectId;
  facilityId: Types.ObjectId;
  attempt: number;
  requestVersion: number;
  inspectionKey: string;
  payloadHash: string;
  decision: RepeatedInboundInspectionDecision;
  receivedQuantity: number;
  actualUnitWeightKg: number;
  actualUnitDimensionsM: InventoryInboundDimensionsM;
  compatibleCellIds: Types.ObjectId[];
  packingLayoutVerified: boolean;
  custodyTaken: boolean;
  note: string;
  inspectedBy: Types.ObjectId;
  inspectedAt: Date;
  images: RepeatedInboundEvidenceImage[];
}
