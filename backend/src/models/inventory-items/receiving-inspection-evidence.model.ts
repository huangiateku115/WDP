import mongoose, { Schema } from 'mongoose';

const imageSchema = new Schema({
  uploadId: { type: Schema.Types.ObjectId, required: true },
  secureUrl: { type: String, required: true },
  publicId: { type: String, required: true },
  sha256: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  format: { type: String, enum: ['jpg', 'png', 'webp'], required: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  attempt: { type: Number, required: true, min: 1 },
  idempotencyKey: { type: String, maxlength: 128 },
  payloadHash: { type: String, required: true },
  decision: { type: String, enum: ['ACCEPTED', 'DISCREPANCY', 'REJECTED'], required: true },
  observedQuantity: { type: Number, required: true },
  observedUnitWeightKg: { type: Number, required: true },
  observedUnitDimensionsM: { type: Schema.Types.Mixed, required: true },
  compatibleCellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell' }],
  packingLayoutVerified: { type: Boolean, required: true },
  note: { type: String, required: true, maxlength: 1000 },
  custodyTaken: { type: Boolean, required: true },
  inspectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  inspectedAt: { type: Date, required: true },
  images: { type: [imageSchema], default: [] },
}, { timestamps: true, strict: 'throw', versionKey: false, optimisticConcurrency: false });

schema.index({ itemId: 1, attempt: 1 }, { unique: true });
schema.index({ itemId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
schema.pre('save', function () { if (!this.isNew) throw new Error('Receiving inspection evidence snapshots are immutable'); });
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Receiving inspection evidence snapshots are immutable');
});

export default mongoose.model('ReceivingInspectionEvidence', schema);
