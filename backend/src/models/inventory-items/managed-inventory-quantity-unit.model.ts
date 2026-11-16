import mongoose, { Schema } from 'mongoose';
import { IManagedInventoryQuantityUnit } from '../../types/managed-inventory-catalog.type';

const schema = new Schema<IManagedInventoryQuantityUnit>({
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 1000 },
  sortOrder: { type: Number, required: true, min: 0, max: 1000000, default: 0, validate: Number.isSafeInteger },
  isActive: { type: Boolean, required: true, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deletedAt: Date,
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

schema.index({ code: 1 }, { unique: true });
schema.index({ isActive: 1, sortOrder: 1, name: 1 });

export default mongoose.model<IManagedInventoryQuantityUnit>('ManagedInventoryQuantityUnit', schema);
