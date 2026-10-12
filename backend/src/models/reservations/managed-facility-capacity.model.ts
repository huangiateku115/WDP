import { model, Schema } from 'mongoose';
import { IManagedFacilityCapacity } from '../../types/managed-capacity.type';

const schema = new Schema<IManagedFacilityCapacity>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  sellableCapacityM3: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
  holdDurationMinutes: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  bookingVersion: { type: Number, required: true, default: 0, min: 0, validate: Number.isSafeInteger },
  isActive: { type: Boolean, required: true, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ facilityId: 1 }, { unique: true });

export default model<IManagedFacilityCapacity>('ManagedFacilityCapacity', schema);
