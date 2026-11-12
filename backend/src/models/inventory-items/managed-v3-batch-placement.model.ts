import mongoose, { Schema } from 'mongoose';
import { IManagedV3BatchPlacement } from '../../types/managed-inventory-v3.type';

const schema = new Schema<IManagedV3BatchPlacement>({
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  batchId: { type: String, required: true, trim: true, maxlength: 120 }, cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, quantityUnit: { type: String, required: true, trim: true, maxlength: 32 },
  weightKg: { type: Number, required: true, min: Number.MIN_VALUE }, volumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  topologyCertificationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  topologyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  sourceMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', required: true },
  receiptMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', required: true, immutable: true },
  state: { type: String, enum: ['ACTIVE', 'DEPLETED'], required: true, default: 'ACTIVE' },
  revision: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ skuId: 1, batchId: 1, cellId: 1 }, { unique: true });
schema.index({ reservationId: 1, facilityId: 1, cellId: 1, state: 1 });
export default mongoose.model<IManagedV3BatchPlacement>('ManagedV3BatchPlacement', schema);
