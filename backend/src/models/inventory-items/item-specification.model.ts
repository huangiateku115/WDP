import mongoose, { Schema } from 'mongoose';
import { IItemSpecification, ItemSpecificationDimensionsM, ItemSpecificationStatus } from '../../types/item-specification.type';

const dimensions = new Schema<ItemSpecificationDimensionsM>({ widthM: { type: Number, required: true, min: Number.MIN_VALUE }, depthM: { type: Number, required: true, min: Number.MIN_VALUE }, heightM: { type: Number, required: true, min: Number.MIN_VALUE } }, { _id: false, strict: 'throw' });
const schema = new Schema<IItemSpecification>({
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 48 },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 2000 },
  quantityUnitId: { type: Schema.Types.ObjectId, ref: 'ManagedInventoryQuantityUnit', required: true },
  dimensionsM: { type: dimensions, required: true },
  unitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  unitVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  images: { type: [{ type: String, trim: true }], default: [] },
  revision: { type: Number, required: true, min: 0, default: 0 },
  /** Stock-operation fence shared by inbound and outbound; it does not revise the customer-facing specification. */
  inboundRevision: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: Object.values(ItemSpecificationStatus), required: true, default: ItemSpecificationStatus.ACTIVE },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  deletedAt: Date,
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ skuId: 1, code: 1 }, { unique: true });
schema.index({ customerId: 1, reservationId: 1, status: 1, createdAt: -1 });
schema.pre('validate', function () {
  const d = this.dimensionsM;
  const volume = d ? Math.round((d.widthM * d.depthM * d.heightM + Number.EPSILON) * 1_000_000) / 1_000_000 : NaN;
  if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(this.unitWeightKg) || this.unitWeightKg <= 0 || this.unitVolumeM3 !== volume) this.invalidate('unitVolumeM3', 'Item specification volume must equal width × depth × height rounded to 0.000001 m³');
});
export default mongoose.model<IItemSpecification>('ItemSpecification', schema);
