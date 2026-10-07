import mongoose, { Schema } from 'mongoose';
import { ISupportMessage } from '../../types/support-request.type';

const schema = new Schema<ISupportMessage>({
  supportRequestId: { type: Schema.Types.ObjectId, ref: 'SupportRequest', required: true, immutable: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  authorRole: { type: String, required: true, immutable: true },
  message: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
  isInternal: { type: Boolean, default: false, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ supportRequestId: 1, isInternal: 1, createdAt: 1 });
schema.index({ authorId: 1, createdAt: -1 });

export default mongoose.model<ISupportMessage>('SupportMessage', schema);
