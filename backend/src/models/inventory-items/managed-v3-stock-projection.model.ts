import mongoose, { Schema } from 'mongoose';
import { IManagedV3StockProjection } from '../../types/managed-inventory-v3.type';

const placement = new Schema({ itemKind: { type: String, enum: ['A2_BATCH'], required: true }, batchId: { type: String, trim: true, maxlength: 128, required: true }, quantityUnit: { type: String, required: true, trim: true, maxlength: 32 }, physicalUnitId: { type: Schema.Types.ObjectId, ref: 'ManagedV3PhysicalUnit' },
  topologyCertificationId: { type: Schema.Types.ObjectId, required: true }, topologyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true }, quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  weightKg: { type: Number, required: true, min: Number.MIN_VALUE }, volumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  heldQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 }, }, { _id: false, strict: 'throw' });
const pose = new Schema({ xStartM: { type: Number, required: true }, yStartM: { type: Number, required: true }, rotationDeg: { type: Number, required: true, enum: [0, 90] } }, { _id: false, strict: 'throw' });
const physicalUnitProjection = new Schema({ itemKind: { type: String, enum: ['A1_PHYSICAL_UNIT'], required: true }, physicalUnitId: { type: Schema.Types.ObjectId, ref: 'ManagedV3PhysicalUnit', required: true }, quantity: { type: Number, required: true, enum: [1] }, pose: { type: pose },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32 }, weightKg: { type: Number, required: true, min: Number.MIN_VALUE }, volumeM3: { type: Number, required: true, min: Number.MIN_VALUE }, cellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell' }] }, { _id: false, strict: 'throw' });
const cellProjection = new Schema({ cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true }, quantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  physicalUnitCount: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }, weightKg: { type: Number, required: true, min: 0 }, volumeM3: { type: Number, required: true, min: 0 } }, { _id: false, strict: 'throw' });
const schema = new Schema<IManagedV3StockProjection>({
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  onHandQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  heldQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  availableQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  totalWeightKg: { type: Number, required: true, min: 0, default: 0 }, totalVolumeM3: { type: Number, required: true, min: 0, default: 0 },
  byBatch: { type: [placement], default: [] }, byPhysicalUnit: { type: [physicalUnitProjection], default: [] }, byCell: { type: [cellProjection], default: [] },
  lastMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', default: null }, reconciledAt: { type: Date },
  ledgerRevision: { type: Number, required: true, min: 0, default: 0 }, projectionRevision: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ skuId: 1 }, { unique: true });
schema.index({ customerId: 1, reservationId: 1, facilityId: 1, projectionRevision: 1 });
schema.index({ 'byCell.cellId': 1, facilityId: 1 });
schema.pre('validate', function () {
  const placements = [...(this.byBatch ?? [])];
  const qty = placements.reduce((n, row) => n + row.quantity, 0) + (this.byPhysicalUnit ?? []).length;
  const held = placements.reduce((n, row) => n + row.heldQuantity, 0);
  const weight = placements.reduce((n, row) => n + row.weightKg, 0) + (this.byPhysicalUnit ?? []).reduce((n, row) => n + row.weightKg, 0);
  const volume = placements.reduce((n, row) => n + row.volumeM3, 0) + (this.byPhysicalUnit ?? []).reduce((n, row) => n + row.volumeM3, 0);
  if (qty !== this.onHandQuantity || held !== this.heldQuantity || this.availableQuantity !== this.onHandQuantity - this.heldQuantity ||
      this.heldQuantity > this.onHandQuantity || !Number.isSafeInteger(qty) || !Number.isSafeInteger(held) ||
      placements.some(row => !row.batchId || (row as any).physicalUnitId != null) ||
      new Set((this.byPhysicalUnit ?? []).map(row => String(row.physicalUnitId))).size !== (this.byPhysicalUnit ?? []).length ||
      Math.abs(weight - this.totalWeightKg) > 0.001 || Math.abs(volume - this.totalVolumeM3) > 0.000001 ||
      [this.totalWeightKg, this.totalVolumeM3].some(value => !Number.isFinite(value) || value < 0)) {
    this.invalidate('byBatch', 'V3 stock projection totals must reconcile to physical placements and holds');
  }
});
export default mongoose.model<IManagedV3StockProjection>('ManagedV3StockProjection', schema);
