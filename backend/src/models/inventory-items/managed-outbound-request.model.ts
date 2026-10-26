import mongoose, { Schema } from 'mongoose';
import { ManagedOutboundRequestFields, ManagedOutboundRequestState } from '../../types/managed-outbound-request.type';

const allocationSchema = new Schema({
  batchId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128 },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  receiptMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', required: true, immutable: true },
  receiptRequestId: { type: Schema.Types.ObjectId, ref: 'InventoryInboundRequest', immutable: true },
  receivingInspectionEvidenceId: { type: Schema.Types.ObjectId, ref: 'ReceivingInspectionEvidence', immutable: true },
  receivedAt: { type: Date, required: true, immutable: true },
  arithmeticPolicy: { type: String, enum: ['COMPATIBILITY', 'CANONICAL_V1'], required: true, immutable: true },
}, { _id: false, strict: 'throw' });

const schema = new Schema<ManagedOutboundRequestFields>({
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now },
  requestedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  quantityUnit: { type: String, required: true, trim: true, minlength: 1, maxlength: 32, immutable: true },
  batchAllocations: { type: [allocationSchema], required: true, immutable: true },
  state: { type: String, enum: Object.values(ManagedOutboundRequestState), required: true, default: ManagedOutboundRequestState.PENDING },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 128, immutable: true },
  payloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  version: { type: Number, required: true, min: 0, default: 0 },
  // Terminal facts are written once by the corresponding versioned transition.
  // They cannot be immutable at schema level because that transition updates an existing request document.
  confirmedMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement' },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: { type: Date },
  confirmedQuantity: { type: Number, min: 1, validate: Number.isSafeInteger },
  cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: { type: Date },
}, { timestamps: { createdAt: false, updatedAt: true }, strict: 'throw', versionKey: 'version', optimisticConcurrency: true });

schema.index({ itemId:  1, idempotencyKey: 1 }, { unique: true });
schema.index({ itemId: 1 }, { unique: true, name: 'managed_outbound_one_pending_per_item', partialFilterExpression: { state: ManagedOutboundRequestState.PENDING } });
schema.index({ facilityId: 1, state: 1, createdAt: 1, _id: 1 });
schema.index({ reservationId: 1, customerId: 1, createdAt: -1, _id: -1 });

schema.pre('validate', function () {
  const ids = (this.batchAllocations ?? []).map(row => row.batchId);
  if (!ids.length || new Set(ids).size !== ids.length || (this.batchAllocations ?? []).some(row => !Number.isSafeInteger(row.quantity) || row.quantity <= 0) ||
      (this.batchAllocations ?? []).reduce((sum, row) => sum + row.quantity, 0) !== this.requestedQuantity) {
    this.invalidate('batchAllocations', 'Outbound batch allocations must uniquely sum to the requested quantity');
  }
  if (this.state === ManagedOutboundRequestState.CONFIRMED && (!this.confirmedMovementId || !this.confirmedBy || !this.confirmedAt)) {
    this.invalidate('confirmedMovementId', 'Confirmed request must reference its committed movement and actor');
  }
  if (this.state === ManagedOutboundRequestState.CONFIRMED && this.confirmedQuantity !== this.requestedQuantity) {
    this.invalidate('confirmedQuantity', 'Fully confirmed request quantity must equal requested quantity');
  }
  if (this.state === ManagedOutboundRequestState.PARTIALLY_FULFILLED &&
      (!this.confirmedMovementId || !this.confirmedBy || !this.confirmedAt || !Number.isSafeInteger(this.confirmedQuantity) ||
       this.confirmedQuantity! <= 0 || this.confirmedQuantity! >= this.requestedQuantity)) {
    this.invalidate('confirmedQuantity', 'Partially fulfilled request must reference a movement and a positive quantity below requested quantity');
  }
  if (this.state === ManagedOutboundRequestState.CANCELLED && (!this.cancelledBy || !this.cancelledAt)) {
    this.invalidate('cancelledAt', 'Cancelled request must record its actor and time');
  }
  if (this.state === ManagedOutboundRequestState.CANCELLED &&
      (this.confirmedMovementId || this.confirmedBy || this.confirmedAt || this.confirmedQuantity)) {
    this.invalidate('state', 'Cancelled request cannot contain confirmation fields');
  }
  if ([ManagedOutboundRequestState.CONFIRMED, ManagedOutboundRequestState.PARTIALLY_FULFILLED].includes(this.state) &&
      (this.cancelledBy || this.cancelledAt)) {
    this.invalidate('state', 'Confirmed request cannot contain cancellation fields');
  }
  if (this.state === ManagedOutboundRequestState.PENDING &&
      (this.confirmedMovementId || this.confirmedBy || this.confirmedAt || this.confirmedQuantity || this.cancelledBy || this.cancelledAt)) {
    this.invalidate('state', 'Pending request cannot contain terminal confirmation or cancellation fields');
  }
});

schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Managed outbound requests must use version-checked document saves');
});

export default mongoose.model<ManagedOutboundRequestFields>('ManagedOutboundRequest', schema);
