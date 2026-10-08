import mongoose, { Schema } from 'mongoose';
import { IStorageUnit, StorageUnitSize, StorageUnitStatus, UnitDimensions } from '../../types/storage-unit.type';

const positive = { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite };
const dimensionsSchema = new Schema<UnitDimensions>({
  lengthM: positive, widthM: positive, heightM: positive,
}, { _id: false });
const schema = new Schema<IStorageUnit>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  unitCode: { type: String, required: true, uppercase: true, trim: true },
  size: { type: String, enum: Object.values(StorageUnitSize), required: true },
  dimensions: { type: dimensionsSchema, required: true },
  volumeM3: positive,
  status: { type: String, enum: Object.values(StorageUnitStatus), default: StorageUnitStatus.AVAILABLE, required: true },
  bookingVersion: { type: Number, default: 0 },
  description: { type: String, trim: true },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ facilityId: 1, unitCode: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, size: 1 });
schema.index({ facilityId: 1, deletedAt: 1 });
schema.pre('validate', function () {
  if (this.dimensions) {
    this.volumeM3 = this.dimensions.lengthM * this.dimensions.widthM * this.dimensions.heightM;
  }
});
export default mongoose.model<IStorageUnit>('StorageUnit', schema);
