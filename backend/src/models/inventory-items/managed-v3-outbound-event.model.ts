import mongoose, { Schema } from 'mongoose';
import { IManagedV3OutboundEvent, ManagedV3OutboundOperation, ManagedV3OutboundState } from '../../types/managed-inventory-v3-outbound.type';
const allocation = new Schema({ itemKind: { type: String, enum: ['A1_PHYSICAL_UNIT', 'A2_BATCH'], required: true }, batchId: String, physicalUnitId: Schema.Types.ObjectId,
  cellId: { type: Schema.Types.ObjectId, required: true }, quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, quantityUnit: { type: String, required: true },
  weightKg: { type: Number, required: true, min: Number.MIN_VALUE }, volumeM3: { type: Number, required: true, min: Number.MIN_VALUE }, receiptMovementId: Schema.Types.ObjectId,
  topologyCertificationId: { type: Schema.Types.ObjectId, required: true }, topologyRevision: { type: Number, required: true, min: 1 },
  pose: { type: new Schema({ xStartM: Number, yStartM: Number, rotationDeg: { type: Number, enum: [0, 90] } }, { _id: false, strict: 'throw' }) },
}, { _id: false, strict: 'throw', immutable: true });
const schema = new Schema<IManagedV3OutboundEvent>({
  requestId: { type: Schema.Types.ObjectId, ref: 'ManagedV3OutboundRequest', required: true, immutable: true }, skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true }, customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true }, facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true }, operation: { type: String, enum: Object.values(ManagedV3OutboundOperation), required: true, immutable: true },
  idempotencyKey: { type: String, required: true, minlength: 8, maxlength: 128, immutable: true }, requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/i, immutable: true },
  resultingState: { type: String, enum: Object.values(ManagedV3OutboundState), required: true, immutable: true }, resultingVersion: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, immutable: true },
  allocationSnapshot: { type: [allocation], required: true, immutable: true }, occurredAt: { type: Date, required: true, immutable: true }, movementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true },
}, { timestamps: false, strict: 'throw', versionKey: false });
schema.index({ skuId: 1, operation: 1, idempotencyKey: 1 }, { unique: true }); schema.index({ requestId: 1, resultingVersion: 1 }, { unique: true }); schema.index({ skuId: 1, occurredAt: 1, _id: 1 });
schema.pre('validate', function () {
  if (this.operation === ManagedV3OutboundOperation.CREATE && (this.resultingState !== ManagedV3OutboundState.PENDING || this.resultingVersion !== 0)) this.invalidate('resultingState', 'CREATE must establish PENDING revision zero');
  if (this.operation === ManagedV3OutboundOperation.CANCEL && this.resultingState !== ManagedV3OutboundState.CANCELLED) this.invalidate('resultingState', 'CANCEL must release the request hold');
  if (this.operation === ManagedV3OutboundOperation.CONFIRM && (this.resultingState !== ManagedV3OutboundState.CONFIRMED || !this.movementId)) this.invalidate('movementId', 'CONFIRM must link a canonical REMOVE movement');
});
schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany'], function () { throw new Error('V3 outbound events are append-only'); });
schema.pre('save', function () { if (!this.isNew) throw new Error('V3 outbound events are append-only'); });
export default mongoose.model<IManagedV3OutboundEvent>('ManagedV3OutboundEvent', schema);
