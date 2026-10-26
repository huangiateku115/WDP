import mongoose, { Schema } from 'mongoose';
import {
  InventoryInboundRequestFields,
  InventoryInboundCustodyState,
  InventoryInboundRequestState,
} from '../../types/inventory-inbound-request.type';

const dimensionsSchema = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
  heightM: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
}, { _id: false, strict: 'throw' });

const unresolvedStates = [
  InventoryInboundRequestState.PENDING_INSPECTION,
  InventoryInboundRequestState.DISCREPANCY,
  InventoryInboundRequestState.ACCEPTED_PENDING_CONFIRMATION,
  InventoryInboundRequestState.RETURN_PENDING,
];

const schema = new Schema<InventoryInboundRequestFields>({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now },
  requestedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  quantityUnit: { type: String, required: true, trim: true, minlength: 1, maxlength: 32 },
  declaredUnitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
  declaredUnitDimensionsM: { type: dimensionsSchema, required: true },
  state: { type: String, enum: Object.values(InventoryInboundRequestState), required: true, default: InventoryInboundRequestState.PENDING_INSPECTION },
  custodyState: { type: String, enum: Object.values(InventoryInboundCustodyState), required: true, default: InventoryInboundCustodyState.NOT_TAKEN },
  requestIdempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 128, immutable: true },
  creationPayloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  currentPayloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  currentInspectionAttemptId: { type: Schema.Types.ObjectId, ref: 'RepeatedInboundInspection', default: null },
  acceptedEvidenceSnapshotId: { type: Schema.Types.ObjectId, ref: 'RepeatedInboundInspection' },
  confirmedMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement' },
  version: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: { createdAt: false, updatedAt: true }, strict: 'throw', versionKey: 'version', optimisticConcurrency: true });

schema.index({ itemId:  1, requestIdempotencyKey: 1 }, { unique: true });
schema.index({ itemId: 1 }, { unique: true, name: 'inventory_inbound_request_one_unresolved_per_item', partialFilterExpression: { state: { $in: unresolvedStates } } });
schema.index({ facilityId: 1, state: 1, createdAt: 1, _id: 1 });
schema.index({ reservationId: 1, customerId: 1, createdAt: -1, _id: -1 });

schema.pre('validate', function () {
  if (this.state === InventoryInboundRequestState.CONFIRMED && !this.confirmedMovementId) {
    this.invalidate('confirmedMovementId', 'Confirmed receipt request must reference its committed movement');
  }
  if (this.state === InventoryInboundRequestState.ACCEPTED_PENDING_CONFIRMATION &&
      (!this.acceptedEvidenceSnapshotId || this.custodyState !== InventoryInboundCustodyState.IN_CUSTODY)) {
    this.invalidate('acceptedEvidenceSnapshotId', 'Accepted request must reference its evidence snapshot and held custody');
  }
  if (this.state === InventoryInboundRequestState.REJECTED && this.custodyState === InventoryInboundCustodyState.IN_CUSTODY) {
    this.invalidate('custodyState', 'Rejected request cannot close while goods remain in Facility custody');
  }
  const dimensions = this.declaredUnitDimensionsM;
  if (dimensions && ![dimensions.widthM, dimensions.depthM, dimensions.heightM].every(value => Number.isFinite(value) && value > 0)) {
    this.invalidate('declaredUnitDimensionsM', 'Declared dimensions must be finite and positive');
  }
});

schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Inventory inbound request changes must use version-checked document saves');
});

export const inventoryInboundRequestUnresolvedStates = unresolvedStates;
export default mongoose.model<InventoryInboundRequestFields>('InventoryInboundRequest', schema);
