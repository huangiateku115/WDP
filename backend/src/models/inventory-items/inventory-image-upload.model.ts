import mongoose, { Schema } from 'mongoose';

export type InventoryImageUploadStatus = 'UPLOADING' | 'UNATTACHED' | 'ATTACHED' | 'DELETE_PENDING' | 'DELETED';

const schema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  managedReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  secureUrl: { type: String, required: true, unique: true },
  publicId: { type: String, required: true, unique: true },
  sha256: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  format: { type: String, enum: ['jpg', 'png', 'webp'], required: true },
  status: { type: String, enum: ['UPLOADING', 'UNATTACHED', 'ATTACHED', 'DELETE_PENDING', 'DELETED'], default: 'UPLOADING', required: true, index: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem' },
  quotaSlot: { type: Number, min: 0, max: 19 },
  folder: { type: String, required: true },
  generatedPublicId: { type: String, required: true },
  uploadLeaseToken: { type: String },
  uploadLeaseUntil: { type: Date },
  cleanupLeaseToken: { type: String },
  cleanupLeaseUntil: { type: Date },
  expiresAt: { type: Date, required: true, index: true },
  discardRequestedAt: { type: Date },
  deleteAttempts: { type: Number, default: 0, min: 0 },
  nextDeleteAt: { type: Date, default: Date.now },
  lastDeleteError: { type: String, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

schema.index({ customerId: 1, managedReservationId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ status: 1, expiresAt: 1, nextDeleteAt: 1 });
schema.index({ customerId: 1, managedReservationId: 1, quotaSlot: 1 }, {
  unique: true,
  partialFilterExpression: { quotaSlot: { $type: 'number' } },
});

export default mongoose.model('InventoryImageUpload', schema);
