import mongoose, { Schema } from 'mongoose';

const schema = new Schema({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  idempotencyKey: { type: String, required: true },
  sha256: { type: String, required: true },
  secureUrl: { type: String, required: true, unique: true },
  publicId: { type: String, required: true, unique: true },
  generatedPublicId: { type: String, required: true },
  folder: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  format: { type: String, enum: ['jpg', 'png', 'webp'], required: true },
  status: { type: String, enum: ['UPLOADING', 'UNATTACHED', 'ATTACHED', 'DELETE_PENDING', 'DELETED'], required: true, index: true },
  snapshotId: { type: Schema.Types.ObjectId, ref: 'ReceivingInspectionEvidence' },
  quotaSlot: { type: Number, min: 0, max: 19 },
  uploadLeaseToken: String,
  uploadLeaseUntil: Date,
  cleanupLeaseToken: String,
  cleanupLeaseUntil: Date,
  expiresAt: { type: Date, required: true, index: true },
  nextDeleteAt: { type: Date, default: Date.now },
  deleteAttempts: { type: Number, default: 0 },
}, { timestamps: true, strict: 'throw' });

schema.index({ staffId: 1, itemId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ facilityId: 1, itemId: 1, quotaSlot: 1 }, { unique: true, partialFilterExpression: { quotaSlot: { $type: 'number' } } });
schema.index({ status: 1, expiresAt: 1, nextDeleteAt: 1 });

export default mongoose.model('ReceivingInspectionUpload', schema);
