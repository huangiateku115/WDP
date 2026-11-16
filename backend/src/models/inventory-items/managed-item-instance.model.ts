import mongoose, { Schema } from 'mongoose';
import { IManagedItemInstance } from '../../types/managed-cell-stock.type';

const allocation = new Schema({
  cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true },
  weightKg: { type: Number, required: true, min: 0 },
  volumeM3: { type: Number, required: true, min: 0 },
}, { _id: false, strict: 'throw' });
const dimensions = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE },
  heightM: { type: Number, required: true, min: Number.MIN_VALUE },
}, { _id: false, strict: 'throw' });
const schema = new Schema<IManagedItemInstance>({
  itemInstanceId: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  itemSpecId: { type: Schema.Types.ObjectId, ref: 'ItemSpecification', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  sourceReceiptId: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
  quantity: { type: Number, required: true, enum: [1], default: 1, immutable: true },
  unitWeightKgSnapshot: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  unitVolumeM3Snapshot: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  unitDimensionsSnapshot: { type: dimensions, required: true, immutable: true },
  allocations: { type: [allocation], required: true },
  status: { type: String, required: true, enum: ['PLACED', 'REMOVED'], default: 'PLACED' },
  revision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ itemInstanceId: 1 }, { unique: true });
schema.index({ skuId: 1, itemSpecId: 1, reservationId: 1, status: 1 });
schema.index({ facilityId: 1, customerId: 1, reservationId: 1 });
schema.pre('validate', function () {
  if (this.quantity !== 1 || !Array.isArray(this.allocations) || (this.status === 'PLACED' && !this.allocations.length) || (this.status === 'REMOVED' && this.allocations.length)) this.invalidate('allocations', 'A placed item instance has a Cell footprint; a removed instance has none');
  if (new Set(this.allocations.map(row => String(row.cellId))).size !== this.allocations.length) this.invalidate('allocations', 'An item instance may allocate at most one load share per Cell');
  const weight = this.allocations.reduce((sum, row) => sum + Number(row.weightKg), 0);
  const volume = this.allocations.reduce((sum, row) => sum + Number(row.volumeM3), 0);
  const dimensions = this.unitDimensionsSnapshot;
  const expectedVolume = dimensions ? Math.round((dimensions.widthM * dimensions.depthM * dimensions.heightM + Number.EPSILON) * 1_000_000) / 1_000_000 : NaN;
  if (!Number.isFinite(expectedVolume) || Math.abs(expectedVolume - this.unitVolumeM3Snapshot) > 0.000001) this.invalidate('unitVolumeM3Snapshot', 'Item Instance dimensions must match its immutable unit volume snapshot');
  if (this.status === 'PLACED' && (!Number.isFinite(weight) || !Number.isFinite(volume) || Math.abs(weight - this.unitWeightKgSnapshot) > 0.001 || Math.abs(volume - this.unitVolumeM3Snapshot) > 0.000001)) this.invalidate('allocations', 'Cell allocations must conserve the item instance physical measurements');
});
export default mongoose.model<IManagedItemInstance>('ManagedItemInstance', schema);
