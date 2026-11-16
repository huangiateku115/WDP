import { Document, Types } from 'mongoose';

export enum ItemSpecificationStatus { ACTIVE = 'ACTIVE', INACTIVE = 'INACTIVE', DELETED = 'DELETED' }
export interface ItemSpecificationDimensionsM { widthM: number; depthM: number; heightM: number }
export interface ItemSpecificationFields {
  skuId: Types.ObjectId; customerId: Types.ObjectId; reservationId: Types.ObjectId; facilityId: Types.ObjectId;
  code: string; name: string; description?: string; quantityUnitId: Types.ObjectId; dimensionsM: ItemSpecificationDimensionsM;
  unitWeightKg: number; unitVolumeM3: number; images: string[]; revision: number; inboundRevision?: number; status: ItemSpecificationStatus;
  createdBy: Types.ObjectId; deletedAt?: Date; deletedBy?: Types.ObjectId;
}
export interface IItemSpecification extends Document, ItemSpecificationFields { createdAt: Date; updatedAt: Date }
