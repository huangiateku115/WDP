import { Document, Types } from 'mongoose';

export enum SupportCategory { RENTAL = 'RENTAL', ACCESS = 'ACCESS', PAYMENT = 'PAYMENT', ITEM = 'ITEM', LOCATION = 'LOCATION', OTHER = 'OTHER' }
export enum SupportPriority { LOW = 'LOW', MEDIUM = 'MEDIUM', HIGH = 'HIGH', URGENT = 'URGENT' }
export enum SupportStatus { OPEN = 'OPEN', ASSIGNED = 'ASSIGNED', IN_PROGRESS = 'IN_PROGRESS', RESOLVED = 'RESOLVED', CLOSED = 'CLOSED' }
export enum RelatedEntityType { FACILITY = 'FACILITY', STORAGE_UNIT = 'STORAGE_UNIT', RENTAL = 'RENTAL', PAYMENT = 'PAYMENT', ITEM = 'ITEM', LOCATION = 'LOCATION', OTHER = 'OTHER' }
export interface RelatedEntity { type: RelatedEntityType; id: string }
export interface ISupportRequest extends Document {
  customerId: Types.ObjectId; facilityId?: Types.ObjectId; category: SupportCategory; subject: string;
  description: string; priority: SupportPriority; status: SupportStatus; assignedTo?: Types.ObjectId;
  assignedAt?: Date; resolutionNote?: string; resolvedAt?: Date; closedAt?: Date;
  escalatedAt?: Date; escalatedTo?: Types.ObjectId; slaDueAt?: Date; relatedEntity?: RelatedEntity;
  deletedAt?: Date; deletedBy?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
export interface ISupportMessage extends Document {
  supportRequestId: Types.ObjectId; authorId: Types.ObjectId; authorRole: string; message: string;
  isInternal: boolean; createdAt: Date;
}
