import mongoose, { Schema } from 'mongoose';
import { IItemMovement, ItemMovementType } from '../../types/item-movement.type';

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
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false });

schema.pre('validate', function () {
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
