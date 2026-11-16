import mongoose, { Schema } from 'mongoose';
import { IManagedCellStock } from '../../types/managed-cell-stock.type';

const dimensions = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE },
  heightM: { type: Number, required: true, min: Number.MIN_VALUE },
}, { _id: false, strict: 'throw' });

const schema = new Schema<IManagedCellStock>({
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  itemSpecId: { type: Schema.Types.ObjectId, ref: 'ItemSpecification', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true, immutable: true },
  receiptId: { type: String, required: true, trim: true, minlength: 1, maxlength: 160, immutable: true },
  /** Unit snapshot from the Item Specification at receipt time; absent on early V4 drafts. */
  quantityUnitSnapshot: { type: String, trim: true, maxlength: 32, immutable: true },
  quantityOnHand: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  quantityHeld: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  quantityAvailable: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  unitWeightKgSnapshot: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  unitVolumeM3Snapshot: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  unitDimensionsSnapshot: { type: dimensions, required: true, immutable: true },
  totalWeightKg: { type: Number, required: true, min: 0 },
  totalVolumeM3: { type: Number, required: true, min: 0 },
  ledgerRevision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  revision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

schema.index({ skuId: 1, itemSpecId: 1, reservationId: 1, receiptId: 1, cellId: 1 }, { unique: true });
schema.index({ skuId: 1, itemSpecId: 1, reservationId: 1, cellId: 1 });
schema.index({ facilityId: 1, cellId: 1, reservationId: 1 });

schema.pre('validate', function () {
  const weight = Math.round((this.unitWeightKgSnapshot * this.quantityOnHand + Number.EPSILON) * 1000) / 1000;
  const volume = Math.round((this.unitVolumeM3Snapshot * this.quantityOnHand + Number.EPSILON) * 1_000_000) / 1_000_000;
  if (!Number.isSafeInteger(this.quantityOnHand) || !Number.isSafeInteger(this.quantityHeld) || this.quantityHeld > this.quantityOnHand ||
    this.quantityAvailable !== this.quantityOnHand - this.quantityHeld || !Number.isFinite(weight) || !Number.isFinite(volume) ||
    Math.abs(this.totalWeightKg - weight) > 0.001 || Math.abs(this.totalVolumeM3 - volume) > 0.000001) {
    this.invalidate('quantityAvailable', 'Cell Stock quantities and physical totals are inconsistent');
  }
});

export default mongoose.model<IManagedCellStock>('ManagedCellStock', schema);
