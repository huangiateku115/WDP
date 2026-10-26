import mongoose, { Schema } from 'mongoose';
import { ManagedOutboundRequestEventFields, ManagedOutboundRequestOperation, ManagedOutboundRequestState } from '../../types/managed-outbound-request.type';

const schema = new Schema<ManagedOutboundRequestEventFields>({
  requestId: { type: Schema.Types.ObjectId, ref: 'ManagedOutboundRequest', required: true, immutable: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  operation: { type: String, enum: Object.values(ManagedOutboundRequestOperation), required: true, immutable: true },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 128, immutable: true },
  payloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  inputSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  resultingState: { type: String, enum: Object.values(ManagedOutboundRequestState), required: true, immutable: true },
  resultingVersion: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  resultSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true, default: Date.now },
  movementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true },
  confirmedQuantity: { type: Number, min: 1, validate: Number.isSafeInteger, immutable: true },
}, { timestamps: false, strict: 'throw', versionKey: false });

schema.index({ itemId: 1, operation: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ requestId: 1, resultingVersion: 1 }, { unique: true });
schema.index({ requestId: 1, occurredAt: 1, _id: 1 });
schema.pre('validate', function () {
  if (this.operation === ManagedOutboundRequestOperation.CONFIRM &&
      (!this.movementId || !Number.isSafeInteger(this.confirmedQuantity) || this.confirmedQuantity! <= 0 ||
       ![ManagedOutboundRequestState.CONFIRMED, ManagedOutboundRequestState.PARTIALLY_FULFILLED].includes(this.resultingState as ManagedOutboundRequestState))) {
    this.invalidate('movementId', 'Confirmation event must link exactly one movement and positive fulfilled quantity');
  }
  if (this.operation === ManagedOutboundRequestOperation.CONFIRM &&
      (String(this.resultSnapshot?.confirmedMovementId ?? '') !== String(this.movementId ?? '') ||
       this.resultSnapshot?.confirmedQuantity !== this.confirmedQuantity)) {
    this.invalidate('resultSnapshot', 'Confirmation result snapshot must reference the same movement and fulfilled quantity');
  }
  if (this.operation !== ManagedOutboundRequestOperation.CONFIRM && (this.movementId || this.confirmedQuantity)) {
    this.invalidate('movementId', 'Only a confirmation event may reference an outbound movement');
  }
});
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Managed outbound request events are append-only');
});
schema.pre('save', function () { if (!this.isNew) throw new Error('Managed outbound request events are append-only'); });

export default mongoose.model<ManagedOutboundRequestEventFields>('ManagedOutboundRequestEvent', schema);
