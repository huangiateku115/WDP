import mongoose, { Schema } from 'mongoose';
import { IPhysicalUnit } from '../../types/managed-inventory-v3.type';

const dimensions = new Schema({ widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE }, heightM: { type: Number, required: true, min: Number.MIN_VALUE } }, { _id: false });
const placementPose = new Schema({ xStartM: { type: Number, required: true }, yStartM: { type: Number, required: true }, rotationDeg: { type: Number, required: true, enum: [0, 90] } }, { _id: false, strict: 'throw' });
const schema = new Schema<IPhysicalUnit>({
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  serial: { type: String, required: true, trim: true, maxlength: 120 },
  weightKg: { type: Number, required: true, min: Number.MIN_VALUE }, dimensionsM: { type: dimensions, required: true },
  volumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  currentPose: { type: placementPose, default: null },
  sourceMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', default: null, immutable: true },
  state: { type: String, enum: ['PREPARED', 'PLACED', 'REMOVED', 'QUARANTINED'], required: true, default: 'PREPARED' },
  revision: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ reservationId: 1, serial: 1 }, { unique: true });
schema.index({ skuId: 1, state: 1, updatedAt: -1 });
schema.index({ reservationId: 1, customerId: 1, facilityId: 1, state: 1, createdAt: -1 });
export default mongoose.model<IPhysicalUnit>('ManagedV3PhysicalUnit', schema);
