import mongoose, { Schema } from 'mongoose';
import { IWarehouseZone } from '../../types/warehouse-map.type';

const schema = new Schema<IWarehouseZone>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  color: { type: String, trim: true },
  sortOrder: { type: Number, required: true, default: 0, min: 0 },
  isActive: { type: Boolean, required: true, default: true },
  structureVersion: { type: Number, required: true, default: 0, min: 0 },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Codes stay reserved after soft deletion so an old map reference cannot silently change meaning.
schema.index({ facilityId: 1, code: 1 }, { unique: true });
schema.index({ facilityId: 1, isActive: 1, sortOrder: 1 });
schema.index({ deletedAt: 1 });

export default mongoose.model<IWarehouseZone>('WarehouseZone', schema);
