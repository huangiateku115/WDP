import mongoose, { Schema } from 'mongoose';
import { IItemMovement, ItemMovementType, MovementBatchAction } from '../../types/item-movement.type';
import { exactUnitsEqual, roundedProductUnits, sumExactPrecisionUnits } from '../../utils/managed-stock-arithmetic';

const round = (value: number, places: number) => Math.round((value + Number.EPSILON) * 10 ** places) / 10 ** places;
const near = (left: number, right: number, tolerance: number) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;

const batchLineSchema = new Schema({
  batchId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128, immutable: true },
  receiptRequestId: { type: Schema.Types.ObjectId, immutable: true },
  receivingInspectionEvidenceId: { type: Schema.Types.ObjectId, ref: 'ReceivingInspectionEvidence', immutable: true },
  action: { type: String, enum: Object.values(MovementBatchAction), required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32, immutable: true },
  actualUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualUnitDimensionsM: { type: new Schema({
    widthM: { type: Number, required: true, min: Number.MIN_VALUE },
    depthM: { type: Number, required: true, min: Number.MIN_VALUE },
    heightM: { type: Number, required: true, min: Number.MIN_VALUE },
  }, { _id: false, immutable: true }), required: true, immutable: true },
  actualTotalWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualTotalVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema<IItemMovement>({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  managedReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  type: { type: String, enum: Object.values(ItemMovementType), required: true, immutable: true },
  sourceCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', immutable: true, default: null },
  destinationCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', immutable: true, default: null },
  previousPlacementMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true },
  quantity: { type: Number, required: true, min: 1, immutable: true },
  quantityUnit: { type: String, required: true, immutable: true },
  actualUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualTotalWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  actualUnitDimensionsM: {
    widthM: { type: Number, required: true, min: Number.MIN_VALUE },
    depthM: { type: Number, required: true, min: Number.MIN_VALUE },
    heightM: { type: Number, required: true, min: Number.MIN_VALUE },
  },
  actualTotalVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  performedAt: { type: Date, required: true, immutable: true },
  inspectionNote: { type: String, trim: true, maxlength: 1000, immutable: true },
  handoverNote: { type: String, trim: true, maxlength: 1000, immutable: true },
  relocationNote: { type: String, trim: true, maxlength: 1000, immutable: true },
  physicalPackingConfirmed: { type: Boolean, immutable: true },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
  // Missing version is intentionally treated as v1 for existing records.
  schemaVersion: { type: Number, enum: [1, 2], default: 1, immutable: true },
  arithmeticPolicy: { type: String, enum: ['CANONICAL_V1'], immutable: true },
  batchLines: { type: [batchLineSchema], default: undefined, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false });

schema.pre('validate', function () {
  if (this.arithmeticPolicy != null && (this.arithmeticPolicy !== 'CANONICAL_V1' || this.schemaVersion !== 2)) {
    this.invalidate('arithmeticPolicy', 'Arithmetic policy is supported only for schema v2 movements');
  }
  if (this.isNew && this.schemaVersion === 2 && this.arithmeticPolicy == null) {
    this.invalidate('arithmeticPolicy', 'New schema v2 movements require CANONICAL_V1 arithmetic');
  }
  if (this.type === ItemMovementType.INBOUND) {
    if (!this.destinationCellId || this.sourceCellId != null || !this.inspectionNote) {
      this.invalidate('destinationCellId', 'INBOUND must move from outside to a destination Cell');
    }
  } else if (this.type === ItemMovementType.OUTBOUND) {
    if (!this.sourceCellId || this.destinationCellId != null || !this.handoverNote) {
      this.invalidate('sourceCellId', 'OUTBOUND must move from a source Cell to outside');
    }
  } else if (this.type === ItemMovementType.RELOCATION) {
    if (!this.sourceCellId || !this.destinationCellId || this.sourceCellId.equals(this.destinationCellId) ||
        !this.previousPlacementMovementId || !this.relocationNote ||
        (this.quantity > 1 && this.physicalPackingConfirmed !== true)) {
      this.invalidate('destinationCellId', 'RELOCATION must move a whole lot between distinct Cells with placement lineage and a note');
    }
  }
  if (this.schemaVersion === 2) {
    const lines = this.batchLines ?? [];
    const expectedAction = this.type === ItemMovementType.INBOUND ? MovementBatchAction.ADD
      : this.type === ItemMovementType.OUTBOUND ? MovementBatchAction.REMOVE : MovementBatchAction.MOVE;
    const linesWeight = lines.reduce((sum, line) => sum + Number(line.actualTotalWeightKg), 0);
    const linesVolume = lines.reduce((sum, line) => sum + Number(line.actualTotalVolumeM3), 0);
    const canonical = this.arithmeticPolicy === 'CANONICAL_V1';
    const invalidLine = lines.some(line => {
      const dimensions = line.actualUnitDimensionsM;
      const validDimensions = dimensions && [dimensions.widthM, dimensions.depthM, dimensions.heightM]
        .every(value => Number.isFinite(value) && value > 0);
      const unitVolume = validDimensions ? dimensions.widthM * dimensions.depthM * dimensions.heightM : NaN;
      const canonicalWeight = roundedProductUnits([line.actualUnitWeightKg], line.quantity, 3);
      const canonicalVolume = roundedProductUnits([dimensions?.widthM, dimensions?.depthM, dimensions?.heightM].map(Number), line.quantity, 6);
      return line.action !== expectedAction || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        typeof line.quantityUnit !== 'string' || !line.quantityUnit.trim() || line.quantityUnit !== this.quantityUnit ||
        !Number.isFinite(line.actualUnitWeightKg) || line.actualUnitWeightKg <= 0 ||
        !Number.isFinite(line.actualTotalWeightKg) || line.actualTotalWeightKg <= 0 ||
        !Number.isFinite(line.actualTotalVolumeM3) || line.actualTotalVolumeM3 <= 0 || !validDimensions ||
        (canonical
          ? canonicalWeight === null || canonicalVolume === null ||
            !exactUnitsEqual(line.actualTotalWeightKg, canonicalWeight, 3) ||
            !exactUnitsEqual(line.actualTotalVolumeM3, canonicalVolume, 6)
          : !near(round(line.actualUnitWeightKg * line.quantity, 3), round(line.actualTotalWeightKg, 3), 0.001) ||
            !near(round(unitVolume * line.quantity, 6), round(line.actualTotalVolumeM3, 6), 0.000001));
    });
    const firstLine = lines[0];
    const firstDimensions = firstLine?.actualUnitDimensionsM;
    const parentMatchesFirstLine = firstLine && firstDimensions &&
      near(this.actualUnitWeightKg, firstLine.actualUnitWeightKg, 0.001) &&
      near(this.actualUnitDimensionsM?.widthM, firstDimensions.widthM, 0.000001) &&
      near(this.actualUnitDimensionsM?.depthM, firstDimensions.depthM, 0.000001) &&
      near(this.actualUnitDimensionsM?.heightM, firstDimensions.heightM, 0.000001);
    const canonicalWeightTotal = canonical ? sumExactPrecisionUnits(lines.map(line => line.actualTotalWeightKg), 3) : null;
    const canonicalVolumeTotal = canonical ? sumExactPrecisionUnits(lines.map(line => line.actualTotalVolumeM3), 6) : null;
    const parentTotalsInvalid = canonical
      ? canonicalWeightTotal === null || canonicalVolumeTotal === null ||
        !exactUnitsEqual(this.actualTotalWeightKg, canonicalWeightTotal, 3) ||
        !exactUnitsEqual(this.actualTotalVolumeM3, canonicalVolumeTotal, 6)
      : Math.abs(linesWeight - this.actualTotalWeightKg) > 0.001 || Math.abs(linesVolume - this.actualTotalVolumeM3) > 0.000001;
    if (!lines.length || invalidLine || !parentMatchesFirstLine ||
        lines.reduce((sum, line) => sum + line.quantity, 0) !== this.quantity || parentTotalsInvalid) {
      this.invalidate('batchLines', 'Schema v2 batch lines must match movement quantity, units, physical arithmetic, and parent totals');
    }
  } else if (this.batchLines !== undefined && this.batchLines !== null) {
    this.invalidate('batchLines', 'Batch lines require movement schema version 2');
  }
});

schema.index({ itemId: 1, performedAt: -1, _id: -1 });
schema.index({ facilityId: 1, performedAt: -1 });
schema.index({ managedReservationId: 1, performedAt: -1 });
schema.index({ itemId: 1, idempotencyKey: 1 }, { unique: true });

schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany'], function () {
  throw new Error('ItemMovement records are append-only');
});
schema.pre('save', function () {
  if (!this.isNew) throw new Error('ItemMovement records are append-only');
});
schema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('ItemMovement records are append-only');
});

export default mongoose.model<IItemMovement>('ItemMovement', schema);
