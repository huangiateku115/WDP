import mongoose, { Schema } from 'mongoose';
import {
  InventoryInboundRequestEventFields,
  InventoryInboundRequestEventOperation,
  InventoryInboundRequestEventScopeType,
} from '../../types/inventory-inbound-request-event.type';

const schema = new Schema<InventoryInboundRequestEventFields>({
  requestId: { type: Schema.Types.ObjectId, ref: 'InventoryInboundRequest', required: true, immutable: true },
  itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  operation: { type: String, enum: Object.values(InventoryInboundRequestEventOperation), required: true, immutable: true },
  scopeType: { type: String, enum: Object.values(InventoryInboundRequestEventScopeType), required: true, immutable: true },
  scopeId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 128, immutable: true },
  payloadHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  inputSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  resultingState: { type: String, required: true, immutable: true },
  resultingVersion: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  resultSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
  occurredAt: { type: Date, required: true, immutable: true, default: Date.now },
}, { timestamps: false, strict: 'throw', versionKey: false });

schema.index({ customerId: 1, scopeType: 1, scopeId: 1, operation: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ requestId: 1, resultingVersion: 1 }, { unique: true });
schema.index({ requestId: 1, occurredAt: 1, _id: 1 });

schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('Inventory inbound request events are append-only');
});
schema.pre('save', function () {
  if (!this.isNew) throw new Error('Inventory inbound request events are append-only');
});

export default mongoose.model<InventoryInboundRequestEventFields>('InventoryInboundRequestEvent', schema);
