import mongoose, { Schema } from 'mongoose';
import { InventoryStockBalanceFields, ManagedStockSource } from '../../types/managed-stock.type';
import { exactUnitsEqual, roundedProductUnits, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';

const dimensionsSchema = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE },
  heightM: { type: Number, required: true, min: Number.MIN_VALUE },
}, { _id: false });

const batchSchema = new Schema({
  batchId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128 },
  receiptMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', required: true },
  receiptRequestId: { type: Schema.Types.ObjectId },
  receivingInspectionEvidenceId: { type: Schema.Types.ObjectId, ref: 'ReceivingInspectionEvidence' },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  heldQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32 },
  actualUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  actualUnitDimensionsM: { type: dimensionsSchema, required: true },
  actualTotalWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  actualTotalVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  arithmeticPolicy: { type: String, enum: ['COMPATIBILITY', 'CANONICAL_V1'], required: true, default: 'COMPATIBILITY' },
  receivedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema<InventoryStockBalanceFields>({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  managedReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  currentCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', default: null },
  batches: { type: [batchSchema], default: [] },
  onHandQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  heldQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  actualTotalWeightKg: { type: Number, required: true, min: 0, default: 0 },
  actualTotalVolumeM3: { type: Number, required: true, min: 0, default: 0 },
  schemaVersion: { type: Number, enum: [1], required: true, default: 1 },
  source: { type: String, enum: Object.values(ManagedStockSource), required: true },
  reconciledAt: { type: Date },
  reconciledThroughMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', default: null },
  version: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

schema.index({ itemId: 1 }, { unique: true });
schema.index({ facilityId: 1, managedReservationId: 1, currentCellId: 1 });
schema.index({ customerId: 1, currentCellId: 1 });

schema.pre('validate', function () {
  const batchIds = (this.batches ?? []).map(batch => batch.batchId);
  if (new Set(batchIds).size !== batchIds.length) this.invalidate('batches', 'Stock balance cannot contain duplicate receipt batch IDs');
  const quantity = (this.batches ?? []).reduce((sum, batch) => sum + batch.quantity, 0);
  const heldQuantity = (this.batches ?? []).reduce((sum, batch) => sum + batch.heldQuantity, 0);
  const weight = (this.batches ?? []).reduce((sum, batch) => sum + batch.actualTotalWeightKg, 0);
  const volume = (this.batches ?? []).reduce((sum, batch) => sum + batch.actualTotalVolumeM3, 0);
  const invalidBatch = (this.batches ?? []).some(batch => {
    const unitVolume = batch.actualUnitDimensionsM.widthM * batch.actualUnitDimensionsM.depthM * batch.actualUnitDimensionsM.heightM;
    const canonicalWeight = roundedProductUnits([batch.actualUnitWeightKg], batch.quantity, 3);
    const canonicalVolume = roundedProductUnits([batch.actualUnitDimensionsM.widthM, batch.actualUnitDimensionsM.depthM,
      batch.actualUnitDimensionsM.heightM], batch.quantity, 6);
    if (batch.arithmeticPolicy === 'CANONICAL_V1') {
      return canonicalWeight === null || canonicalVolume === null ||
        !exactUnitsEqual(batch.actualTotalWeightKg, canonicalWeight, 3) ||
        !exactUnitsEqual(batch.actualTotalVolumeM3, canonicalVolume, 6);
    }
    if (batch.arithmeticPolicy !== 'COMPATIBILITY') return true;
    const expectedWeight = Math.round((batch.actualUnitWeightKg * batch.quantity + Number.EPSILON) * 1000) / 1000;
    const recordedWeight = Math.round((batch.actualTotalWeightKg + Number.EPSILON) * 1000) / 1000;
    const expectedVolume = Math.round((unitVolume * batch.quantity + Number.EPSILON) * 1_000_000) / 1_000_000;
    const recordedVolume = Math.round((batch.actualTotalVolumeM3 + Number.EPSILON) * 1_000_000) / 1_000_000;
    return Math.abs(expectedWeight - recordedWeight) > 0.001 || Math.abs(expectedVolume - recordedVolume) > 0.000001;
  });
  const weightUnits = sumExactPrecisionUnits((this.batches ?? []).map(batch => batch.actualTotalWeightKg), 3);
  const volumeUnits = sumExactPrecisionUnits((this.batches ?? []).map(batch => batch.actualTotalVolumeM3), 6);
  const invalidAggregate = weightUnits === null || volumeUnits === null ||
    !exactUnitsEqual(this.actualTotalWeightKg, weightUnits, 3) || !exactUnitsEqual(this.actualTotalVolumeM3, volumeUnits, 6);
  if (quantity !== this.onHandQuantity || heldQuantity !== this.heldQuantity || this.heldQuantity > this.onHandQuantity ||
      (this.batches ?? []).some(batch => batch.heldQuantity > batch.quantity) ||
      Math.abs(weight - this.actualTotalWeightKg) > 0.001 || Math.abs(volume - this.actualTotalVolumeM3) > 0.000001 || invalidBatch || invalidAggregate) {
    this.invalidate('batches', 'Stock totals must reconcile to receipt batch balances and held quantity');
  }
  if ((this.onHandQuantity === 0) !== (this.currentCellId == null)) {
    this.invalidate('currentCellId', 'A stock balance has a Cell exactly when on-hand quantity is positive');
  }
});

export default mongoose.model<InventoryStockBalanceFields>('InventoryStockBalance', schema);
