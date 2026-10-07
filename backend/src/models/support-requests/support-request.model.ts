import mongoose, { Schema } from 'mongoose';
import { ISupportRequest, RelatedEntityType, SupportCategory, SupportPriority, SupportStatus } from '../../types/support-request.type';

const relatedEntitySchema = new Schema({
  type: { type: String, required: true, trim: true, uppercase: true, enum: Object.values(RelatedEntityType), maxlength: 50 },
  id: { type: String, required: true, trim: true, maxlength: 100 },
}, { _id: false });

const schema = new Schema<ISupportRequest>({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', immutable: true },
  category: { type: String, enum: Object.values(SupportCategory), required: true },
  subject: { type: String, trim: true, required: true, maxlength: 200 },
  description: { type: String, trim: true, required: true, maxlength: 5000 },
  priority: { type: String, enum: Object.values(SupportPriority), default: SupportPriority.MEDIUM, required: true },
  status: { type: String, enum: Object.values(SupportStatus), default: SupportStatus.OPEN, required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, assignedAt: Date,
  resolutionNote: { type: String, trim: true, maxlength: 3000 }, resolvedAt: Date, closedAt: Date,
  escalatedAt: Date, escalatedTo: { type: Schema.Types.ObjectId, ref: 'User' }, slaDueAt: Date,
  relatedEntity: { type: relatedEntitySchema }, deletedAt: Date, deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ customerId:  1, status: 1, createdAt: -1 });
schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ assignedTo: 1, status: 1, createdAt: -1 });
schema.index({ deletedAt: 1 });
schema.index({ escalatedAt: 1, facilityId: 1 });

export default mongoose.model<ISupportRequest>('SupportRequest', schema);
