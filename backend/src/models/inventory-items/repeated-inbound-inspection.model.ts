import mongoose, { Schema } from 'mongoose';
import { RepeatedInboundInspectionFields } from '../../types/repeated-inbound-inspection.type';

const imageSchema = new Schema({
  uploadId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  secureUrl: { type: String, required: true, immutable: true },
  publicId: { type: String, required: true, immutable: true },
  sha256: { type: String, required: true, immutable: true },
  width: { type: Number, required: true, immutable: true },
  height: { type: Number, required: true, immutable: true },
  format: { type: String, enum: ['jpg', 'png', 'webp'], required: true, immutable: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema<RepeatedInboundInspectionFields>({
  requestId: { type: Schema.Types.ObjectId, ref: 'InventoryInboundRequest', required: true, immutable: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  attempt: { type: Number, required: true, min: 1, immutable: true },
  requestVersion: { type: Number, required: true, min: 0, immutable: true },
  inspectionKey: { type: String, required: true, immutable: true },
  payloadHash: { type: String, required: true, immutable: true },
  decision: { type: String, enum: ['ACCEPTED', 'DISCREPANCY', 'REJECTED'], required: true, immutable: true },
  receivedQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  actualUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualUnitDimensionsM: { type: new Schema({ widthM: Number, depthM: Number, heightM: Number }, { _id: false, strict: 'throw' }), required: true, immutable: true },
  compatibleCellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell', immutable: true }],
  packingLayoutVerified: { type: Boolean, required: true, immutable: true },
  custodyTaken: { type: Boolean, required: true, immutable: true },
  note: { type: String, maxlength: 1000, required: true, immutable: true },
  inspectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  inspectedAt: { type: Date, required: true, immutable: true },
  images: { type: [imageSchema], default: [], immutable: true },
}, { timestamps: false, strict: 'throw', versionKey: false });

schema.index({ requestId:  1, attempt: 1 }, { unique: true });
schema.index({ requestId: 1, inspectionKey: 1 }, { unique: true });
schema.index({ itemId: 1, facilityId: 1, inspectedAt: 1, _id: 1 });
schema.pre('save', function () { if (!this.isNew) throw new Error('Repeated inbound inspection snapshots are immutable'); });
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Repeated inbound inspection snapshots are immutable');
});

export default mongoose.model<RepeatedInboundInspectionFields>('RepeatedInboundInspection', schema);
